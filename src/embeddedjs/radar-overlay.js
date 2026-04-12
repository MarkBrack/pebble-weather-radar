// Radar overlay RLE decoder: palette-indexed (index, count) pairs.
// Index 0 = transparent (skip), indices 1-6 = rain intensity colors.
// Supports streaming decode across multiple chunks with carry state.
export default class RadarOverlay {
	constructor(width, height) {
		this.width = width;
		this.height = height;
		this.cx = 0;
		this.cy = 0;
		this.carryIndex = -1;
	}

	reset() {
		this.cx = 0;
		this.cy = 0;
		this.carryIndex = -1;
	}

	// Decode one RLE chunk. render.begin() must have been called.
	decodeChunk(render, buffer, palette) {
		const bytes = new Uint8Array(buffer);
		const len = bytes.byteLength;
		const width = this.width;
		const height = this.height;
		let i = 0;

		// Handle carry from previous chunk
		if (this.carryIndex >= 0) {
			if (i >= len) return;
			this._run(render, this.carryIndex, bytes[i++], palette, width, height);
			this.carryIndex = -1;
		}

		while (i < len) {
			const index = bytes[i++];
			if (i >= len) {
				this.carryIndex = index;
				break;
			}
			this._run(render, index, bytes[i++], palette, width, height);
		}
	}

	_run(render, index, count, palette, width, height) {
		let {cx, cy} = this;
		if (index === 0) {
			// Transparent: advance cursor without drawing
			while (count > 0 && cy < height) {
				const skip = Math.min(count, width - cx);
				cx += skip;
				count -= skip;
				if (cx >= width) { cx = 0; cy++; }
			}
		} else {
			// Rain pixel: draw with palette color
			const color = palette[index];
			while (count > 0 && cy < height) {
				const runLen = Math.min(count, width - cx);
				render.fillRectangle(color, cx, cy, runLen, 1);
				count -= runLen;
				cx += runLen;
				if (cx >= width) { cx = 0; cy++; }
			}
		}
		this.cx = cx;
		this.cy = cy;
	}
}
