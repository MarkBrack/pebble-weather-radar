#include <pebble.h>

int main(void) {
	Window *w = window_create();
	window_stack_push(w, true);

	moddable_createMachine(NULL);

	app_event_loop();

	window_destroy(w);
}
