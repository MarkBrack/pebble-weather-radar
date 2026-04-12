import Poco from "commodetto/Poco";
import Timer from "timer";
import Message from "pebble/message";
import Button from "pebble/button";

import DynamicPebbleBitmap from "./dynamic-pebble-bitmap";

const DISPLAY_WIDTH = 200;
const DISPLAY_HEIGHT = 228;
const MAP_ZOOM = 8;

const CROP_STANDARD = 0;
const CROP_WIDE = 1;

const MESSAGE_KEYS = [
	"REQUEST_FRAME",
	"MAP_ZOOM",
	"MAP_CROP_MODE",
	"FRAME_WIDTH",
	"FRAME_HEIGHT",
	"FRAME_TOTAL_BYTES",
	"FRAME_OFFSET",
	"FRAME_CHUNK",
	"FRAME_NO_CHANGE",
	"STATUS_TEXT"
];

const STATUS_BG = 0b11000000;
const STATUS_FG = 0b11111111;

const state = {
	cropMode: CROP_WIDE,
	statusText: "Starting...",
	expectedBytes: 0,
	receivedBytes: 0,
	lastProgressBucket: -1,
	pendingRequest: false,
	canWrite: false,
	lastCompleteKey: "",
	frameReady: false
};

const render = new Poco(screen);
const statusFont = new render.Font("Gothic-Regular", 24);
const frameBitmap = new DynamicPebbleBitmap(DISPLAY_WIDTH, DISPLAY_HEIGHT);

// True while render.begin() has been called but render.end() not yet called.
// Used for streaming draw during frame receive.
let renderOpen = false;

function closeRender() {
	if (renderOpen) {
		renderOpen = false;
		render.end();
	}
}

let message;
let selectButton;
let backButton;

function cropLabel() {
	return state.cropMode === CROP_WIDE ? "Wide" : "Std";
}

function requestKey() {
	return MAP_ZOOM + ":" + state.cropMode;
}

function drawStatus(text) {
	const safe = text || "";
	const textWidth = render.getTextWidth(safe, statusFont);
	const boxWidth = Math.min(DISPLAY_WIDTH - 16, Math.max(72, textWidth + 18));
	const boxHeight = 32;
	const x = Math.floor((DISPLAY_WIDTH - boxWidth) / 2);
	const y = Math.floor((DISPLAY_HEIGHT - boxHeight) / 2);
	render.fillRectangle(STATUS_BG, x, y, boxWidth, boxHeight);
	render.drawText(safe, statusFont, STATUS_FG, x + 9, y + 4);
}

function redraw() {
	if (renderOpen) return; // mid-frame streaming, skip
	// Can't redraw the radar frame (it was streamed), so only draw when
	// we have status text to show *and* no frame yet, or when clearing a
	// non-frame screen.
	if (state.frameReady) return; // frame is on the framebuffer already
	if (!state.statusText) return; // nothing to display
	render.begin();
	render.fillRectangle(0xC0, 0, 0, DISPLAY_WIDTH, DISPLAY_HEIGHT);
	drawStatus(state.statusText);
	render.end();
}

function setStatus(text) {
	state.statusText = text || "";
	if (!renderOpen) { redraw(); }
}

function queueFrameRequest() {
	state.pendingRequest = true;
	setStatus(`${cropLabel()}...`);
	if (state.canWrite) {
		flushFrameRequest();
	}
}

function flushFrameRequest() {
	if (!state.pendingRequest || !state.canWrite || !message) {
		return;
	}

	state.pendingRequest = false;
	state.canWrite = false;
	message.write(new Map([
		["REQUEST_FRAME", 1],
		["MAP_ZOOM", MAP_ZOOM],
		["MAP_CROP_MODE", state.cropMode]
	]));
}

function beginIncomingFrame(map) {
	const width = map.get("FRAME_WIDTH");
	const height = map.get("FRAME_HEIGHT");
	const total = map.get("FRAME_TOTAL_BYTES");

	if ((width !== DISPLAY_WIDTH) || (height !== DISPLAY_HEIGHT) || !total) {
		state.expectedBytes = 0;
		state.receivedBytes = 0;
		setStatus("Bad frame size");
		return false;
	}

	closeRender(); // close any stale open render
	frameBitmap.reset();
	render.begin();
	renderOpen = true;

	state.expectedBytes = total;
	state.receivedBytes = 0;
	state.lastProgressBucket = -1;
	return true;
}

function finishIncomingFrame() {
	if (state.receivedBytes !== state.expectedBytes) {
		return;
	}

	state.lastCompleteKey = requestKey();
	state.statusText = "";
	state.frameReady = true;
	closeRender();
}

function handleChunk(map) {
	const offset = map.get("FRAME_OFFSET");
	const chunk = map.get("FRAME_CHUNK");

	if ((offset === undefined) || !(chunk instanceof ArrayBuffer) || !state.expectedBytes) {
		return;
	}

	const chunkLen = chunk.byteLength;
	if ((offset !== state.receivedBytes) || ((offset + chunkLen) > state.expectedBytes)) {
		state.expectedBytes = 0;
		state.receivedBytes = 0;
		closeRender();
		setStatus("Chunk error");
		return;
	}

	// Stream-decode RLE directly to screen (render is already open)
	frameBitmap.decodeChunk(render, chunk);
	state.receivedBytes += chunkLen;

	if (state.expectedBytes > 0) {
		const progressBucket = Math.floor((state.receivedBytes * 10) / state.expectedBytes);
		if (progressBucket !== state.lastProgressBucket && state.receivedBytes < state.expectedBytes) {
			state.lastProgressBucket = progressBucket;
		}
	}

	if (state.receivedBytes === state.expectedBytes) {
		finishIncomingFrame();
	}
}

function handleNoChange() {
	state.expectedBytes = 0;
	state.receivedBytes = 0;
	state.statusText = "";
	if (state.frameReady) {
		redraw();
	}
}

function onReadable() {
	console.log("watch: onReadable");
	const map = message.read();
	if (!map) {
		console.log("watch: onReadable empty");
		return;
	}

	// Phone STATUS_TEXT is used only for bootstrap greeting (triggers onWritable chain).
	// We don't display it — watch manages its own status overlays to avoid
	// stale text stuck on the framebuffer after streaming decode.

	if (map.has("FRAME_NO_CHANGE") && map.get("FRAME_NO_CHANGE")) {
		handleNoChange();
		return;
	}

	if (map.has("FRAME_WIDTH") && map.has("FRAME_HEIGHT") && map.has("FRAME_TOTAL_BYTES")) {
		if (!beginIncomingFrame(map)) {
			return;
		}
	}

	handleChunk(map);
}

function onWritable() {
	console.log("watch: onWritable");
	state.canWrite = true;
	flushFrameRequest();
}

function onSuspend() {
	console.log("watch: onSuspend");
	state.canWrite = false;
}

function handleButton(pushed, which) {
	if (!pushed) {
		return;
	}

	switch (which) {
		case "select":
			if (state.cropMode === CROP_WIDE) {
				state.cropMode = CROP_STANDARD;
				// Override back button so we can intercept it
				if (!backButton) {
					backButton = new Button({
						types: ["back"],
						onPush: handleButton
					});
				}
				queueFrameRequest();
			}
			break;
		case "back":
			if (state.cropMode === CROP_STANDARD) {
				state.cropMode = CROP_WIDE;
				// Release back button so next back exits the app
				if (backButton) {
					backButton.close();
					backButton = null;
				}
				queueFrameRequest();
			}
			break;
		default:
			return;
	}
}

console.log("Rain Radar Alloy runtime active.");

setStatus("Connecting...");

message = new Message({
	keys: MESSAGE_KEYS,
	input: 768,
	output: 64,
	onReadable,
	onWritable,
	onSuspend
});

selectButton = new Button({
	types: ["select"],
	onPush: handleButton
});
// backButton created dynamically when entering Standard crop mode

queueFrameRequest();

// Refresh radar every 4 minutes to keep app alive and data current
Timer.set(() => { queueFrameRequest(); }, 240000, 240000);
