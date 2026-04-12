// Streaming RLE decoder: decodes (colour, count) pairs directly to screen.
// No large buffer needed - just 2 bytes of carry state between chunks.
export default class DynamicPebbleBitmap {
	constructor(width, height) {
		this.width = width;
		this.height = height;
		// cursor for next pixel position
		this.cx = 0;
		this.cy = 0;
		// carry: pending colour byte without its count yet
		this.carryColor = -1;
	}

	// Call once when a new frame begins
	reset() {
		this.cx = 0;
		this.cy = 0;
		this.carryColor = -1;
	}

	// Decode one RLE chunk (ArrayBuffer) directly via Poco fillRectangle.
	// render.begin() must have been called before the first chunk.
	decodeChunk(render, buffer) {
		const bytes = new Uint8Array(buffer);
		const len = bytes.byteLength;
		const width = this.width;
		const height = this.height;
		let i = 0;

		// If we had a lone colour byte from the previous chunk, pair it now
		if (this.carryColor >= 0) {
			if (i >= len) return; // no count yet, wait for next chunk
			this._run(render, this.carryColor, bytes[i++], width, height);
			this.carryColor = -1;
		}

		while (i < len) {
			const color = bytes[i++];
			if (i >= len) {
				// Count byte split across chunk boundary - carry colour
				this.carryColor = color;
				break;
			}
			this._run(render, color, bytes[i++], width, height);
		}
	}

	_run(render, color, count, width, height) {
		let {cx, cy} = this;
		while (count > 0 && cy < height) {
			const runLen = Math.min(count, width - cx);
			render.fillRectangle(color, cx, cy, runLen, 1);
			count -= runLen;
			cx += runLen;
			if (cx >= width) { cx = 0; cy++; }
		}
		this.cx = cx;
		this.cy = cy;
	}
}
