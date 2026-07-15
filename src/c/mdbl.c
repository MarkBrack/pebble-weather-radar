#include <pebble.h>

int main(void) {
	Window *w = window_create();
	window_stack_push(w, true);

	ModdableCreationRecord creation = {
		.recordSize = sizeof(ModdableCreationRecord),
		.stack = 384 * 16,    // stack bytes (384 entries)
		.slot  = 768 * 16,    // JS object slots: 12KB
		.chunk = 16384,       // transient JS data; retained RLE uses native buffers
		.flags = 0
	};
	moddable_createMachine(&creation);

	app_event_loop();

	window_destroy(w);
}
