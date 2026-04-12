#include <pebble.h>

int main(void) {
	Window *w = window_create();
	window_stack_push(w, true);

	ModdableCreationRecord creation = {
		.recordSize = sizeof(ModdableCreationRecord),
		.stack = 384 * 16,    // stack bytes (384 entries)
		.slot  = 1024 * 16,   // heap slots: 1024 entries × 16 bytes
		.chunk = 32768,       // chunk heap: 32KB (default 8KB)
		.flags = 0
	};
	moddable_createMachine(&creation);

	app_event_loop();

	window_destroy(w);
}
