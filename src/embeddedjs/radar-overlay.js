// PackBits RLE decoder for a complete palette-indexed radar overlay.
// Index 0 is transparent; indices 1-6 map to rain intensity colours.
export default class RadarOverlay {
	constructor(width, height) {
		this.width = width;
		this.height = height;
		this.cx = 0;
		this.cy = 0;
	}

	reset() {
		this.cx = 0;
		this.cy = 0;
	}

	decode(render, buffer, palette) {
		const bytes = new Uint8Array(buffer);
		let offset = 0;

		while (offset < bytes.byteLength) {
			const control = bytes[offset++];
			if (control <= 127) {
				const count = control + 1;
				if ((offset + count) > bytes.byteLength) return false;
				for (let i = 0; i < count; i++) {
					if (!this._run(render, bytes[offset++], 1, palette)) return false;
				}
			}
			else if (control >= 129) {
				if (offset >= bytes.byteLength) return false;
				if (!this._run(render, bytes[offset++], 257 - control, palette)) return false;
			}
			else {
				return false;
			}
		}

		return this.cx === 0 && this.cy === this.height;
	}

	_run(render, index, count, palette) {
		let {cx, cy} = this;
		const remaining = ((this.height - cy) * this.width) - cx;
		if (count > remaining || index >= palette.length) return false;

		while (count > 0) {
			const runLength = Math.min(count, this.width - cx);
			if (index !== 0) {
				render.fillRectangle(palette[index], cx, cy, runLength, 1);
			}
			count -= runLength;
			cx += runLength;
			if (cx >= this.width) {
				cx = 0;
				cy++;
			}
		}

		this.cx = cx;
		this.cy = cy;
		return true;
	}
}
