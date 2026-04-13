import Poco from "commodetto/Poco";
import Timer from "timer";
import Message from "pebble/message";
import Button from "pebble/button";

import DynamicPebbleBitmap from "./dynamic-pebble-bitmap";
import RadarOverlay from "./radar-overlay";

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
	"BG_TOTAL_BYTES",
	"BG_OFFSET",
	"BG_CHUNK",
	"RADAR_FRAME_COUNT",
	"RADAR_FRAME_INDEX",
	"RADAR_TOTAL_BYTES",
	"RADAR_OFFSET",
	"RADAR_CHUNK",
	"RADAR_BATCH_DONE",
	"STATUS_TEXT"
];

// Pebble 8-bit palette for radar overlay indices 0-6
// 0 = transparent (never drawn)
const RADAR_PALETTE = [
	0x00,  // 0 = transparent
	0xEF,  // 1 = drizzle  (170,255,255) → r2 g3 b3
	0xCB,  // 2 = light    (0,170,255)   → r0 g2 b3
	0xC6,  // 3 = moderate (0,85,170)    → r0 g1 b2
	0xFC,  // 4 = heavy    (255,255,0)   → r3 g3 b0
	0xF8,  // 5 = intense  (255,170,0)   → r3 g2 b0
	0xE0   // 6 = extreme  (170,0,0)     → r2 g0 b0
];

const STATUS_BG = 0b11000000;
const STATUS_FG = 0b11111111;

const state = {
	cropMode: CROP_WIDE,
	statusText: "Starting...",

	// Background stored as one contiguous RLE buffer.
	bgBuffer: null,
	bgReceiving: null,  // { expected, received, buffer: Uint8Array }

	// Radar frames stored as contiguous RLE buffers.
	radarFrames: [],
	radarFrameCount: 0,
	radarReceiving: null,  // { index, expected, received, buffer: Uint8Array }

	// Animation state
	currentFrame: 0,
	frameReady: false,
	pendingRequest: false,
	canWrite: false
};

const render = new Poco(screen);
const statusFont = new render.Font("Gothic-Regular", 24);
const bgDecoder = new DynamicPebbleBitmap(DISPLAY_WIDTH, DISPLAY_HEIGHT);
const radarOverlay = new RadarOverlay(DISPLAY_WIDTH, DISPLAY_HEIGHT);

let message;
let selectButton;
let backButton;
let upButton;
let downButton;

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

const DOT_RADIUS = 3;
const DOT_SPACING = 10;
const DOT_COLOR_ACTIVE = 0b11000000;   // black
const DOT_COLOR_INACTIVE = 0b11101010; // grey (r2 g2 b2)
const DOT_Y = DISPLAY_HEIGHT - 8;

function drawPageDots() {
	const count = state.radarFrames.length;
	if (count <= 1) return;
	const totalWidth = (count - 1) * DOT_SPACING;
	const startX = Math.floor((DISPLAY_WIDTH - totalWidth) / 2);
	for (let i = 0; i < count; i++) {
		const color = (i === state.currentFrame) ? DOT_COLOR_ACTIVE : DOT_COLOR_INACTIVE;
		const cx = startX + (i * DOT_SPACING);
		// Draw a filled circle approximation using filled rectangles
		render.fillRectangle(color, cx - 3, DOT_Y - 1, 7, 3);
		render.fillRectangle(color, cx - 2, DOT_Y - 2, 5, 5);
		render.fillRectangle(color, cx - 1, DOT_Y - 3, 3, 7);
	}
}

function compositeFrame() {
	if (!state.bgBuffer) return;

	render.begin();

	// 1. Draw background from stored RLE data
	bgDecoder.reset();
	bgDecoder.decodeChunk(render, state.bgBuffer);

	// 2. Overlay radar if available
	if (state.radarFrames.length > 0 &&
		state.currentFrame >= 0 &&
		state.currentFrame < state.radarFrames.length) {
		const frame = state.radarFrames[state.currentFrame];
		if (frame) {
			radarOverlay.reset();
			radarOverlay.decodeChunk(render, frame, RADAR_PALETTE);
		}
	}

	// 3. Draw page dots
	drawPageDots();

	render.end();
	state.frameReady = true;
	state.statusText = "";
}

function setStatus(text) {
	state.statusText = text || "";
	if (state.frameReady && text !== "Zooming in" && text !== "Zooming out") return;
	render.begin();
	if (state.frameReady) {
		// Overlay status on existing frame
		drawStatus(state.statusText);
	} else {
		render.fillRectangle(0xC0, 0, 0, DISPLAY_WIDTH, DISPLAY_HEIGHT);
		drawStatus(state.statusText);
	}
	render.end();
}

function queueFrameRequest(zoomLabel) {
	state.pendingRequest = true;
	state.frameReady = false;
	setStatus(zoomLabel || "Loading...");
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

function clearBatchBuffers() {
	state.bgBuffer = null;
	state.bgReceiving = null;
	state.radarFrames = [];
	state.radarFrameCount = 0;
	state.radarReceiving = null;
	state.currentFrame = 0;
	state.frameReady = false;
}

// --- Background receiving ---

function beginBg(map) {
	const width = map.get("FRAME_WIDTH");
	const height = map.get("FRAME_HEIGHT");
	const total = map.get("BG_TOTAL_BYTES");

	if ((width !== DISPLAY_WIDTH) || (height !== DISPLAY_HEIGHT) || !total) {
		setStatus("Size error");
		return;
	}

	// Release the previous batch before allocating the next large receive buffer.
	clearBatchBuffers();

	state.bgReceiving = {
		expected: total,
		received: 0,
		buffer: new Uint8Array(total)
	};
}

function handleBgChunk(map) {
	const bg = state.bgReceiving;
	if (!bg) return;

	const offset = map.get("BG_OFFSET");
	const chunk = map.get("BG_CHUNK");
	if (offset === undefined || !(chunk instanceof ArrayBuffer)) return;

	const chunkBytes = new Uint8Array(chunk);
	if (offset !== bg.received || (offset + chunkBytes.byteLength) > bg.expected) {
		state.bgReceiving = null;
		setStatus("BG chunk error");
		return;
	}

	bg.buffer.set(chunkBytes, offset);
	bg.received += chunkBytes.byteLength;

	if (bg.received >= bg.expected) {
		state.bgBuffer = bg.buffer.buffer;
		state.bgReceiving = null;
		console.log("watch: BG received, " + bg.expected + " bytes");
	}
}

// --- Radar frame receiving ---

function beginRadar(map) {
	const index = map.get("RADAR_FRAME_INDEX");
	const count = map.get("RADAR_FRAME_COUNT");
	const total = map.get("RADAR_TOTAL_BYTES");
	if (index === undefined || !count || !total) return;

	state.radarFrameCount = count;
	state.radarReceiving = null;
	state.radarReceiving = {
		index: index,
		expected: total,
		received: 0,
		buffer: new Uint8Array(total)
	};
}

function handleRadarChunk(map) {
	const rx = state.radarReceiving;
	if (!rx) return;

	const offset = map.get("RADAR_OFFSET");
	const chunk = map.get("RADAR_CHUNK");
	if (offset === undefined || !(chunk instanceof ArrayBuffer)) return;

	const chunkBytes = new Uint8Array(chunk);
	if (offset !== rx.received || (offset + chunkBytes.byteLength) > rx.expected) {
		state.radarReceiving = null;
		setStatus("Radar chunk error");
		return;
	}

	rx.buffer.set(chunkBytes, offset);
	rx.received += chunkBytes.byteLength;

	if (rx.received >= rx.expected) {
		// Store completed radar frame as one buffer to minimize XS allocations.
		while (state.radarFrames.length <= rx.index) {
			state.radarFrames.push(null);
		}
		state.radarFrames[rx.index] = rx.buffer.buffer;
		state.radarReceiving = null;
		console.log("watch: radar frame " + (rx.index + 1) + " received, " + rx.expected + " bytes");
	}
}

function handleBatchDone() {
	console.log("watch: batch complete, " + state.radarFrames.length + " frames");
	// Show the most recent frame (last in array)
	state.currentFrame = state.radarFrames.length - 1;
	compositeFrame();
}

// --- Message handling ---

function onReadable() {
	const map = message.read();
	if (!map) return;

	// Background header (includes FRAME_WIDTH, FRAME_HEIGHT, BG_TOTAL_BYTES)
	if (map.has("BG_TOTAL_BYTES")) {
		beginBg(map);
		return;
	}

	// Background chunk
	if (map.has("BG_OFFSET") && map.has("BG_CHUNK")) {
		handleBgChunk(map);
		return;
	}

	// Radar frame header
	if (map.has("RADAR_FRAME_INDEX") && map.has("RADAR_TOTAL_BYTES")) {
		beginRadar(map);
		return;
	}

	// Radar chunk
	if (map.has("RADAR_OFFSET") && map.has("RADAR_CHUNK")) {
		handleRadarChunk(map);
		return;
	}

	// Batch complete
	if (map.has("RADAR_BATCH_DONE")) {
		handleBatchDone();
		return;
	}

	// STATUS_TEXT: bootstrap greeting only (triggers onWritable chain)
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

// --- Button handling ---

function handleButton(pushed, which) {
	if (!pushed) return;

	switch (which) {
		case "select":
			if (state.cropMode === CROP_WIDE) {
				state.cropMode = CROP_STANDARD;
				if (!backButton) {
					backButton = new Button({
						types: ["back"],
						onPush: handleButton
					});
				}
				queueFrameRequest("Zooming in");
			}
			break;
		case "back":
			if (state.cropMode === CROP_STANDARD) {
				state.cropMode = CROP_WIDE;
				if (backButton) {
					backButton.close();
					backButton = null;
				}
				queueFrameRequest("Zooming out");
			}
			break;
		case "up":
			// Newer frame (higher index = more recent)
			if (state.radarFrames.length > 1 &&
				state.currentFrame < state.radarFrames.length - 1) {
				state.currentFrame++;
				compositeFrame();
			}
			break;
		case "down":
			// Older frame (lower index = older)
			if (state.radarFrames.length > 1 && state.currentFrame > 0) {
				state.currentFrame--;
				compositeFrame();
			}
			break;
	}
}

// --- Initialization ---

console.log("Rain Radar Alloy runtime active.");

setStatus("Loading...");

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
upButton = new Button({
	types: ["up"],
	onPush: handleButton
});
downButton = new Button({
	types: ["down"],
	onPush: handleButton
});
// backButton created dynamically when entering Standard crop mode

queueFrameRequest();

// Refresh radar every 4 minutes
Timer.set(() => { queueFrameRequest(); }, 240000, 240000);
