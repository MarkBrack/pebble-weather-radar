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

	// Background (stored as array of RLE chunk ArrayBuffers)
	bgChunks: null,
	bgReceiving: null,  // { expected, received, chunks: [] }

	// Radar frames (array of arrays of RLE chunk ArrayBuffers)
	radarFrames: [],
	radarFrameCount: 0,
	radarReceiving: null,  // { index, expected, received, chunks: [] }

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

function cropLabel() {
	return state.cropMode === CROP_WIDE ? "Wide" : "Std";
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

function drawFrameIndicator() {
	if (state.radarFrames.length <= 1) return;
	const text = (state.currentFrame + 1) + "/" + state.radarFrames.length;
	const textWidth = render.getTextWidth(text, statusFont);
	const boxWidth = textWidth + 10;
	const boxHeight = 22;
	const x = DISPLAY_WIDTH - boxWidth - 2;
	const y = DISPLAY_HEIGHT - boxHeight - 2;
	render.fillRectangle(STATUS_BG, x, y, boxWidth, boxHeight);
	render.drawText(text, statusFont, STATUS_FG, x + 5, y);
}

function compositeFrame() {
	if (!state.bgChunks) return;

	render.begin();

	// 1. Draw background from stored RLE chunks
	bgDecoder.reset();
	for (let i = 0; i < state.bgChunks.length; i++) {
		bgDecoder.decodeChunk(render, state.bgChunks[i]);
	}

	// 2. Overlay radar if available
	if (state.radarFrames.length > 0 &&
		state.currentFrame >= 0 &&
		state.currentFrame < state.radarFrames.length) {
		const chunks = state.radarFrames[state.currentFrame];
		if (chunks) {
			radarOverlay.reset();
			for (let i = 0; i < chunks.length; i++) {
				radarOverlay.decodeChunk(render, chunks[i], RADAR_PALETTE);
			}
		}
	}

	// 3. Draw frame position indicator
	drawFrameIndicator();

	render.end();
	state.frameReady = true;
	state.statusText = "";
}

function setStatus(text) {
	state.statusText = text || "";
	if (state.frameReady) return; // don't overwrite displayed frame
	render.begin();
	render.fillRectangle(0xC0, 0, 0, DISPLAY_WIDTH, DISPLAY_HEIGHT);
	drawStatus(state.statusText);
	render.end();
}

function queueFrameRequest() {
	state.pendingRequest = true;
	state.frameReady = false;
	setStatus(cropLabel() + "...");
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

// --- Background receiving ---

function beginBg(map) {
	const width = map.get("FRAME_WIDTH");
	const height = map.get("FRAME_HEIGHT");
	const total = map.get("BG_TOTAL_BYTES");

	if ((width !== DISPLAY_WIDTH) || (height !== DISPLAY_HEIGHT) || !total) {
		setStatus("Size error");
		return;
	}

	state.bgReceiving = {
		expected: total,
		received: 0,
		chunks: []
	};
	state.bgChunks = null;
	state.radarFrames = [];
	state.radarFrameCount = 0;
	state.currentFrame = 0;
	state.frameReady = false;
	setStatus("Map...");
}

function handleBgChunk(map) {
	const bg = state.bgReceiving;
	if (!bg) return;

	const offset = map.get("BG_OFFSET");
	const chunk = map.get("BG_CHUNK");
	if (offset === undefined || !(chunk instanceof ArrayBuffer)) return;

	bg.chunks.push(chunk);
	bg.received += chunk.byteLength;

	if (bg.received >= bg.expected) {
		state.bgChunks = bg.chunks;
		state.bgReceiving = null;
		console.log("watch: BG received, " + bg.expected + " bytes in " + bg.chunks.length + " chunks");
	}
}

// --- Radar frame receiving ---

function beginRadar(map) {
	const index = map.get("RADAR_FRAME_INDEX");
	const count = map.get("RADAR_FRAME_COUNT");
	const total = map.get("RADAR_TOTAL_BYTES");
	if (index === undefined || !count || !total) return;

	state.radarFrameCount = count;
	state.radarReceiving = {
		index: index,
		expected: total,
		received: 0,
		chunks: []
	};
	setStatus("Rain " + (index + 1) + "/" + count);
}

function handleRadarChunk(map) {
	const rx = state.radarReceiving;
	if (!rx) return;

	const offset = map.get("RADAR_OFFSET");
	const chunk = map.get("RADAR_CHUNK");
	if (offset === undefined || !(chunk instanceof ArrayBuffer)) return;

	rx.chunks.push(chunk);
	rx.received += chunk.byteLength;

	if (rx.received >= rx.expected) {
		// Store completed radar frame as array of chunks
		while (state.radarFrames.length <= rx.index) {
			state.radarFrames.push(null);
		}
		state.radarFrames[rx.index] = rx.chunks;
		state.radarReceiving = null;
		console.log("watch: radar frame " + (rx.index + 1) + " received, " + rx.expected + " bytes in " + rx.chunks.length + " chunks");
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
				queueFrameRequest();
			}
			break;
		case "back":
			if (state.cropMode === CROP_STANDARD) {
				state.cropMode = CROP_WIDE;
				if (backButton) {
					backButton.close();
					backButton = null;
				}
				queueFrameRequest();
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
