export default class RLEBuffer extends Native("RLEBuffer_destructor") {
	constructor(byteLength) {
		super();
		native("RLEBuffer_constructor").call(this, byteLength);
	}

	get byteLength() {
		return native("RLEBuffer_get_byteLength").call(this);
	}

	write(offset, source) {
		native("RLEBuffer_write").call(this, offset, source);
	}

	close() {
		native("RLEBuffer_close").call(this);
	}
}
