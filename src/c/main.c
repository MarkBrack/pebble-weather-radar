#include <pebble.h>

#define DISPLAY_WIDTH 144
#define DISPLAY_HEIGHT 168
#define DEFAULT_ZOOM 8
#define MIN_ZOOM 7
#define MAX_ZOOM 10

static Window *s_main_window;
static BitmapLayer *s_bitmap_layer;
static TextLayer *s_status_layer;
static GBitmap *s_bitmap;

static uint32_t s_expected_bytes;
static uint32_t s_received_bytes;
static uint8_t s_current_zoom = DEFAULT_ZOOM;
static bool s_has_frame;
static char s_status_buffer[64];

static void show_status(const char *text) {
  snprintf(s_status_buffer, sizeof(s_status_buffer), "%s", text ? text : "");
  text_layer_set_text(s_status_layer, s_status_buffer);
  layer_set_hidden(text_layer_get_layer(s_status_layer), false);
}

static void hide_status(void) {
  layer_set_hidden(text_layer_get_layer(s_status_layer), true);
}

static void destroy_bitmap(void) {
  if (s_bitmap) {
    bitmap_layer_set_bitmap(s_bitmap_layer, NULL);
    gbitmap_destroy(s_bitmap);
    s_bitmap = NULL;
  }
}

static bool ensure_bitmap(uint16_t width, uint16_t height) {
  if (width != DISPLAY_WIDTH || height != DISPLAY_HEIGHT) {
    show_status("Bad frame size");
    return false;
  }

  destroy_bitmap();
  s_bitmap = gbitmap_create_blank(GSize(width, height), GBitmapFormat8Bit);
  if (!s_bitmap) {
    show_status("No bitmap mem");
    return false;
  }

  bitmap_layer_set_bitmap(s_bitmap_layer, s_bitmap);
  return true;
}

static void request_frame(void) {
  static char status_buffer[24];
  snprintf(status_buffer, sizeof(status_buffer), "Loading z%d...", s_current_zoom);
  show_status(status_buffer);

  DictionaryIterator *iter = NULL;
  AppMessageResult result = app_message_outbox_begin(&iter);
  if (result != APP_MSG_OK || !iter) {
    show_status("Send failed");
    return;
  }

  dict_write_uint8(iter, MESSAGE_KEY_REQUEST_FRAME, 1);
  dict_write_uint8(iter, MESSAGE_KEY_MAP_ZOOM, s_current_zoom);
  result = app_message_outbox_send();
  if (result != APP_MSG_OK) {
    show_status("Send failed");
  }
}

static void inbox_received_callback(DictionaryIterator *iterator, void *context) {
  Tuple *status_tuple = dict_find(iterator, MESSAGE_KEY_STATUS_TEXT);
  if (status_tuple) {
    show_status(status_tuple->value->cstring);
  }

  Tuple *width_tuple = dict_find(iterator, MESSAGE_KEY_FRAME_WIDTH);
  Tuple *height_tuple = dict_find(iterator, MESSAGE_KEY_FRAME_HEIGHT);
  Tuple *total_tuple = dict_find(iterator, MESSAGE_KEY_FRAME_TOTAL_BYTES);
  if (width_tuple && height_tuple && total_tuple) {
    uint16_t width = (uint16_t)width_tuple->value->uint32;
    uint16_t height = (uint16_t)height_tuple->value->uint32;
    if (!ensure_bitmap(width, height)) {
      return;
    }

    s_expected_bytes = total_tuple->value->uint32;
    s_received_bytes = 0;
    s_has_frame = false;
  }

  Tuple *offset_tuple = dict_find(iterator, MESSAGE_KEY_FRAME_OFFSET);
  Tuple *chunk_tuple = dict_find(iterator, MESSAGE_KEY_FRAME_CHUNK);
  if (!offset_tuple || !chunk_tuple || !s_bitmap) {
    return;
  }

  uint32_t offset = offset_tuple->value->uint32;
  if (offset != s_received_bytes) {
    show_status("Chunk order err");
    s_received_bytes = 0;
    s_expected_bytes = 0;
    return;
  }

  uint8_t *bitmap_data = gbitmap_get_data(s_bitmap);
  if (!bitmap_data) {
    show_status("Bitmap access err");
    return;
  }

  if (offset + chunk_tuple->length > s_expected_bytes) {
    show_status("Chunk size err");
    s_received_bytes = 0;
    s_expected_bytes = 0;
    return;
  }

  memcpy(bitmap_data + offset, chunk_tuple->value->data, chunk_tuple->length);
  s_received_bytes += chunk_tuple->length;

  if (s_expected_bytes > 0 && s_received_bytes >= s_expected_bytes) {
    bitmap_layer_set_bitmap(s_bitmap_layer, s_bitmap);
    layer_mark_dirty(bitmap_layer_get_layer(s_bitmap_layer));
    s_has_frame = true;
    hide_status();
  }
}

static void inbox_dropped_callback(AppMessageResult reason, void *context) {
  APP_LOG(APP_LOG_LEVEL_ERROR, "Message dropped: %d", reason);
  show_status("Message dropped");
}

static void outbox_failed_callback(DictionaryIterator *iterator, AppMessageResult reason,
                                   void *context) {
  APP_LOG(APP_LOG_LEVEL_ERROR, "Outbox failed: %d", reason);
  show_status("Phone link error");
}

static void select_click_handler(ClickRecognizerRef recognizer, void *context) {
  request_frame();
}

static void up_click_handler(ClickRecognizerRef recognizer, void *context) {
  if (s_current_zoom < MAX_ZOOM) {
    s_current_zoom++;
  }
  request_frame();
}

static void down_click_handler(ClickRecognizerRef recognizer, void *context) {
  if (s_current_zoom > MIN_ZOOM) {
    s_current_zoom--;
  }
  request_frame();
}

static void click_config_provider(void *context) {
  window_single_click_subscribe(BUTTON_ID_SELECT, select_click_handler);
  window_single_click_subscribe(BUTTON_ID_UP, up_click_handler);
  window_single_click_subscribe(BUTTON_ID_DOWN, down_click_handler);
}

static void main_window_load(Window *window) {
  Layer *root_layer = window_get_root_layer(window);
  GRect bounds = layer_get_bounds(root_layer);

  s_bitmap_layer = bitmap_layer_create(bounds);
  bitmap_layer_set_background_color(s_bitmap_layer, GColorBlack);
  layer_add_child(root_layer, bitmap_layer_get_layer(s_bitmap_layer));

  s_status_layer = text_layer_create(GRect(8, 60, bounds.size.w - 16, 48));
  text_layer_set_background_color(s_status_layer, GColorBlack);
  text_layer_set_text_color(s_status_layer, GColorWhite);
  text_layer_set_font(s_status_layer, fonts_get_system_font(FONT_KEY_GOTHIC_24_BOLD));
  text_layer_set_text_alignment(s_status_layer, GTextAlignmentCenter);
  text_layer_set_overflow_mode(s_status_layer, GTextOverflowModeWordWrap);
  text_layer_set_text(s_status_layer, "Loading...");
  layer_add_child(root_layer, text_layer_get_layer(s_status_layer));
}

static void main_window_unload(Window *window) {
  destroy_bitmap();
  bitmap_layer_destroy(s_bitmap_layer);
  text_layer_destroy(s_status_layer);
}

static void init(void) {
  s_main_window = window_create();
  window_set_background_color(s_main_window, GColorBlack);
  window_set_click_config_provider(s_main_window, click_config_provider);
  window_set_window_handlers(s_main_window, (WindowHandlers) {
    .load = main_window_load,
    .unload = main_window_unload
  });
  window_stack_push(s_main_window, true);

  app_message_register_inbox_received(inbox_received_callback);
  app_message_register_inbox_dropped(inbox_dropped_callback);
  app_message_register_outbox_failed(outbox_failed_callback);
  app_message_open(1024, 1024);

  request_frame();
}

static void deinit(void) {
  destroy_bitmap();
  app_message_deregister_callbacks();
  window_destroy(s_main_window);
}

int main(void) {
  init();
  app_event_loop();
  deinit();
}
