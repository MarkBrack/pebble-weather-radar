#include <pebble.h>
#include "message_keys.auto.h"

#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

#define FRAME_WIDTH 200
#define FRAME_HEIGHT 228
#define FRAME_PIXELS (FRAME_WIDTH * FRAME_HEIGHT)
#define MAX_RLE_FRAME_BYTES 45957
#define MAX_RADAR_FRAMES 5
#define RLE_ARENA_BYTES 72000
#define RLE_ARENA_RETRY_BYTES 1024
#define FRAME_INTERVAL_MS 1000
#define LATEST_FRAME_PAUSE_MS 3000
#define MANUAL_RESUME_MS 3000

typedef struct {
	uint8_t *data;
	uint32_t length;
	time_t timestamp;
} RLEFrame;

typedef struct {
	uint8_t *data;
	uint32_t total;
	uint32_t offset;
	int8_t radar_index;
} RLEReceive;

static Window *s_window;
static Layer *s_layer;
static AppTimer *s_refresh_timer;
static AppTimer *s_animation_timer;
static uint8_t *s_arena;
static uint32_t s_arena_capacity;
static uint32_t s_arena_used;
static RLEFrame s_background;
static RLEFrame s_radar[MAX_RADAR_FRAMES];
static uint8_t s_radar_count;
static uint8_t s_current_frame;
static uint8_t s_crop_mode = 1;
static bool s_background_ready;
static bool s_ignore_chunks;
static bool s_no_rain;
static bool s_loading_radar;
static RLEReceive s_receive;
static char s_status[64] = "Waiting for phone...";

static void schedule_animation(uint32_t delay_ms);

static const uint8_t s_radar_palette[] = {
	0x00, 0xEF, 0xCB, 0xC6, 0xFC, 0xF8, 0xE0
};

static void set_status(const char *status)
{
	if (!status) {
		return;
	}
	strncpy(s_status, status, sizeof(s_status) - 1);
	s_status[sizeof(s_status) - 1] = '\0';
	if (s_layer) {
		layer_mark_dirty(s_layer);
	}
}

static void reserve_arena(void)
{
	uint32_t capacity = RLE_ARENA_BYTES;

	while (capacity > 0) {
		s_arena = malloc(capacity);
		if (s_arena) {
			s_arena_capacity = capacity;
			return;
		}
		capacity = capacity <= RLE_ARENA_RETRY_BYTES
			? 0
			: capacity - RLE_ARENA_RETRY_BYTES;
	}
}

static void reset_batch(void)
{
	if (s_animation_timer) {
		app_timer_cancel(s_animation_timer);
		s_animation_timer = NULL;
	}
	s_arena_used = 0;
	memset(&s_background, 0, sizeof(s_background));
	memset(s_radar, 0, sizeof(s_radar));
	memset(&s_receive, 0, sizeof(s_receive));
	s_receive.radar_index = -1;
	s_radar_count = 0;
	s_current_frame = 0;
	s_background_ready = false;
	s_ignore_chunks = false;
	s_no_rain = false;
	s_loading_radar = false;
}

static uint8_t *arena_allocate(uint32_t length)
{
	uint8_t *result;

	if (!length || length > MAX_RLE_FRAME_BYTES ||
		length > s_arena_capacity - s_arena_used) {
		return NULL;
	}
	result = s_arena + s_arena_used;
	s_arena_used += length;
	return result;
}

static bool draw_run(
	GContext *ctx, uint8_t value, uint32_t count, bool overlay,
	uint16_t *x, uint16_t *y)
{
	if (count > FRAME_PIXELS - (((uint32_t)*y * FRAME_WIDTH) + *x)) {
		return false;
	}
	if (overlay && value >= ARRAY_LENGTH(s_radar_palette)) {
		return false;
	}

	while (count) {
		uint16_t run = count < (uint32_t)(FRAME_WIDTH - *x)
			? (uint16_t)count
			: (uint16_t)(FRAME_WIDTH - *x);
		if (!overlay || value != 0) {
			uint8_t color = overlay ? s_radar_palette[value] : value;
			graphics_context_set_fill_color(ctx, (GColor){ .argb = color });
			graphics_fill_rect(ctx, GRect(*x, *y, run, 1), 0, GCornerNone);
		}
		count -= run;
		*x += run;
		if (*x == FRAME_WIDTH) {
			*x = 0;
			(*y)++;
		}
	}
	return true;
}

static bool draw_rle(GContext *ctx, const RLEFrame *frame, bool overlay)
{
	uint32_t offset = 0;
	uint16_t x = 0;
	uint16_t y = 0;

	if (!frame->data || !frame->length) {
		return false;
	}
	while (offset < frame->length) {
		uint8_t control = frame->data[offset++];
		if (control <= 127) {
			uint32_t count = (uint32_t)control + 1;
			if (offset + count > frame->length) {
				return false;
			}
			while (count--) {
				if (!draw_run(ctx, frame->data[offset++], 1, overlay, &x, &y)) {
					return false;
				}
			}
		}
		else if (control >= 129) {
			if (offset >= frame->length ||
				!draw_run(ctx, frame->data[offset++], 257 - control, overlay, &x, &y)) {
				return false;
			}
		}
		else {
			return false;
		}
	}
	return x == 0 && y == FRAME_HEIGHT;
}

static void draw_map_message(GContext *ctx, const char *message)
{
	GRect message_box = GRect(17, 86, FRAME_WIDTH - 34, 52);
	graphics_context_set_fill_color(ctx, GColorWhite);
	graphics_fill_rect(ctx, message_box, 3, GCornersAll);
	graphics_context_set_stroke_color(ctx, GColorBlack);
	graphics_draw_round_rect(ctx, message_box, 3);
	graphics_context_set_text_color(ctx, GColorBlack);
	graphics_draw_text(
		ctx, message, fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD),
		GRect(22, 91, FRAME_WIDTH - 44, 42),
		GTextOverflowModeWordWrap, GTextAlignmentCenter, NULL);
}

static void layer_update(Layer *layer, GContext *ctx)
{
	char age_text[16];
	graphics_context_set_fill_color(ctx, GColorWhite);
	graphics_fill_rect(ctx, layer_get_bounds(layer), 0, GCornerNone);

	if (!s_background_ready) {
		graphics_context_set_text_color(ctx, GColorBlack);
		graphics_draw_text(
			ctx, s_status, fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD),
			GRect(8, 70, FRAME_WIDTH - 16, 88),
			GTextOverflowModeWordWrap, GTextAlignmentCenter, NULL);
		return;
	}

	if (!draw_rle(ctx, &s_background, false)) {
		set_status("Invalid map data");
		return;
	}
	if (s_current_frame < s_radar_count) {
		draw_rle(ctx, &s_radar[s_current_frame], true);
		if (s_radar[s_current_frame].timestamp > 0) {
			time_t now = time(NULL);
			long age_seconds = (long)(now - s_radar[s_current_frame].timestamp);
			long age_minutes = age_seconds > 0 ? (age_seconds + 30) / 60 : 0;
			snprintf(age_text, sizeof(age_text), "-%ld min", age_minutes);
			graphics_context_set_text_color(ctx, GColorBlack);
			graphics_draw_text(
				ctx, age_text, fonts_get_system_font(FONT_KEY_GOTHIC_14_BOLD),
				GRect(4, 202, 62, 20),
				GTextOverflowModeTrailingEllipsis, GTextAlignmentLeft, NULL);
		}
	}
	if (s_radar_count > 1) {
		int16_t start_x = (FRAME_WIDTH - ((s_radar_count * 7) - 2)) / 2;
		for (uint8_t i = 0; i < s_radar_count; i++) {
			uint8_t frame_index = s_radar_count - 1 - i;
			graphics_context_set_fill_color(ctx, GColorBlack);
			graphics_fill_rect(ctx, GRect(start_x + (i * 7), 218, 5, 5), 0, GCornerNone);
			if (frame_index == s_current_frame) {
				graphics_context_set_fill_color(ctx, GColorWhite);
				graphics_fill_rect(ctx, GRect(start_x + (i * 7) + 1, 219, 3, 3), 0, GCornerNone);
			}
		}
	}
	if (s_loading_radar) {
		draw_map_message(ctx, "Getting radar data...");
	}
	else if (s_no_rain) {
		draw_map_message(ctx, "No rain in your area");
	}
}

static uint32_t tuple_uint(DictionaryIterator *iterator, uint32_t key, uint32_t fallback)
{
	Tuple *tuple = dict_find(iterator, key);
	return tuple ? tuple->value->uint32 : fallback;
}

static void begin_background(DictionaryIterator *iterator)
{
	uint32_t width = tuple_uint(iterator, MESSAGE_KEY_FRAME_WIDTH, 0);
	uint32_t height = tuple_uint(iterator, MESSAGE_KEY_FRAME_HEIGHT, 0);
	uint32_t total = tuple_uint(iterator, MESSAGE_KEY_BG_TOTAL_BYTES, 0);

	reset_batch();
	if (width != FRAME_WIDTH || height != FRAME_HEIGHT ||
		!(s_background.data = arena_allocate(total))) {
		s_ignore_chunks = true;
		set_status(total > s_arena_capacity ? "Map exceeds memory" : "Invalid map header");
		return;
	}
	s_background.length = total;
	s_receive.data = s_background.data;
	s_receive.total = total;
	s_receive.radar_index = -1;
	s_ignore_chunks = false;
	set_status("Receiving map...");
}

static void receive_chunk(
	DictionaryIterator *iterator, uint32_t offset_key, uint32_t chunk_key)
{
	Tuple *chunk = dict_find(iterator, chunk_key);
	uint32_t offset = tuple_uint(iterator, offset_key, UINT32_MAX);

	if (s_ignore_chunks) {
		return;
	}
	if (!s_receive.data || !chunk || offset != s_receive.offset ||
		chunk->length > s_receive.total - s_receive.offset) {
		s_receive.data = NULL;
		set_status("Transfer error");
		return;
	}
	memcpy(s_receive.data + s_receive.offset, chunk->value->data, chunk->length);
	s_receive.offset += chunk->length;
	if (s_receive.offset == s_receive.total) {
		if (s_receive.radar_index >= 0) {
			uint8_t index = (uint8_t)s_receive.radar_index;
			if (index < MAX_RADAR_FRAMES) {
				s_radar[index].data = s_receive.data;
				s_radar[index].length = s_receive.total;
				if (s_radar_count <= index) {
					s_radar_count = index + 1;
				}
			}
		}
		else {
			s_background_ready = true;
			s_loading_radar = true;
			layer_mark_dirty(s_layer);
		}
		s_receive.data = NULL;
	}
}

static void begin_radar(DictionaryIterator *iterator)
{
	uint32_t index = tuple_uint(iterator, MESSAGE_KEY_RADAR_FRAME_INDEX, UINT32_MAX);
	uint32_t timestamp = tuple_uint(iterator, MESSAGE_KEY_RADAR_FRAME_TIME, 0);
	uint32_t total = tuple_uint(iterator, MESSAGE_KEY_RADAR_TOTAL_BYTES, 0);
	uint8_t *data;

	memset(&s_receive, 0, sizeof(s_receive));
	s_receive.radar_index = -1;
	if (index >= MAX_RADAR_FRAMES || !(data = arena_allocate(total))) {
		// Capacity is a normal stopping condition: ignore older frames.
		s_ignore_chunks = true;
		return;
	}
	s_ignore_chunks = false;
	s_receive.data = data;
	s_receive.total = total;
	s_receive.radar_index = (int8_t)index;
	s_radar[index].timestamp = (time_t)timestamp;
	s_loading_radar = true;
	set_status("Receiving radar...");
}

static void inbox_received(DictionaryIterator *iterator, void *context)
{
	Tuple *status = dict_find(iterator, MESSAGE_KEY_STATUS_TEXT);
	(void)context;

	if (status && status->type == TUPLE_CSTRING) {
		set_status(status->value->cstring);
	}
	if (dict_find(iterator, MESSAGE_KEY_BG_TOTAL_BYTES)) {
		begin_background(iterator);
	}
	else if (dict_find(iterator, MESSAGE_KEY_BG_CHUNK)) {
		receive_chunk(iterator, MESSAGE_KEY_BG_OFFSET, MESSAGE_KEY_BG_CHUNK);
	}
	else if (dict_find(iterator, MESSAGE_KEY_RADAR_TOTAL_BYTES)) {
		begin_radar(iterator);
	}
	else if (dict_find(iterator, MESSAGE_KEY_RADAR_CHUNK)) {
		receive_chunk(iterator, MESSAGE_KEY_RADAR_OFFSET, MESSAGE_KEY_RADAR_CHUNK);
	}
	else if (dict_find(iterator, MESSAGE_KEY_RADAR_BATCH_DONE)) {
		Tuple *has_rain = dict_find(iterator, MESSAGE_KEY_HAS_RAIN);
		s_current_frame = s_radar_count > 0 ? s_radar_count - 1 : 0;
		s_loading_radar = false;
		s_no_rain = has_rain && has_rain->value->uint32 == 0;
		set_status("Ready");
		layer_mark_dirty(s_layer);
		if (s_radar_count > 1) {
			schedule_animation(FRAME_INTERVAL_MS);
		}
	}
}

static void request_refresh(void)
{
	DictionaryIterator *iterator;
	if (app_message_outbox_begin(&iterator) != APP_MSG_OK) {
		set_status("Phone unavailable");
		return;
	}
	dict_write_uint8(iterator, MESSAGE_KEY_REQUEST_FRAME, 1);
	dict_write_uint8(iterator, MESSAGE_KEY_MAP_ZOOM, 8);
	dict_write_uint8(iterator, MESSAGE_KEY_MAP_CROP_MODE, s_crop_mode);
	dict_write_uint32(iterator, MESSAGE_KEY_RLE_BUDGET_BYTES, s_arena_capacity);
	dict_write_end(iterator);
	if (app_message_outbox_send() != APP_MSG_OK) {
		set_status("Send failed");
	}
	else {
		set_status("Requesting radar...");
	}
}

static void refresh_timer_callback(void *context)
{
	(void)context;
	request_refresh();
	s_refresh_timer = app_timer_register(240000, refresh_timer_callback, NULL);
}

static void animation_timer_callback(void *context)
{
	uint32_t next_delay = FRAME_INTERVAL_MS;
	(void)context;
	s_animation_timer = NULL;

	if (s_radar_count <= 1 || s_loading_radar) {
		return;
	}
	if (s_current_frame == 0) {
		s_current_frame = s_radar_count - 1;
	}
	else {
		s_current_frame--;
		if (s_current_frame == 0) {
			next_delay = LATEST_FRAME_PAUSE_MS;
		}
	}
	layer_mark_dirty(s_layer);
	schedule_animation(next_delay);
}

static void schedule_animation(uint32_t delay_ms)
{
	if (s_animation_timer) {
		app_timer_cancel(s_animation_timer);
	}
	s_animation_timer = app_timer_register(delay_ms, animation_timer_callback, NULL);
}

static void resume_animation_after_navigation(void)
{
	if (s_radar_count > 1) {
		schedule_animation(MANUAL_RESUME_MS);
	}
}

static void up_click(ClickRecognizerRef recognizer, void *context)
{
	(void)recognizer;
	(void)context;
	if (s_current_frame > 0) {
		s_current_frame--;
		layer_mark_dirty(s_layer);
	}
	resume_animation_after_navigation();
}

static void down_click(ClickRecognizerRef recognizer, void *context)
{
	(void)recognizer;
	(void)context;
	if (s_current_frame + 1 < s_radar_count) {
		s_current_frame++;
		layer_mark_dirty(s_layer);
	}
	resume_animation_after_navigation();
}

static void select_click(ClickRecognizerRef recognizer, void *context)
{
	(void)recognizer;
	(void)context;
	s_crop_mode = !s_crop_mode;
	request_refresh();
}

static void click_config_provider(void *context)
{
	(void)context;
	window_single_click_subscribe(BUTTON_ID_UP, up_click);
	window_single_click_subscribe(BUTTON_ID_DOWN, down_click);
	window_single_click_subscribe(BUTTON_ID_SELECT, select_click);
}

static void init(void)
{
	reserve_arena();
	reset_batch();

	s_window = window_create();
	s_layer = layer_create(GRect(0, 0, FRAME_WIDTH, FRAME_HEIGHT));
	layer_set_update_proc(s_layer, layer_update);
	layer_add_child(window_get_root_layer(s_window), s_layer);
	window_set_click_config_provider(s_window, click_config_provider);
	window_stack_push(s_window, true);

	app_message_register_inbox_received(inbox_received);
	app_message_open(512, 128);
	request_refresh();
	s_refresh_timer = app_timer_register(240000, refresh_timer_callback, NULL);
}

static void deinit(void)
{
	if (s_refresh_timer) {
		app_timer_cancel(s_refresh_timer);
	}
	if (s_animation_timer) {
		app_timer_cancel(s_animation_timer);
	}
	app_message_deregister_callbacks();
	layer_destroy(s_layer);
	window_destroy(s_window);
	free(s_arena);
}

int main(void)
{
	init();
	app_event_loop();
	deinit();
}
