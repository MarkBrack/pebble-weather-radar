#include "xsmc.h"

#include <stdint.h>
#include <stdlib.h>
#include <string.h>

// PackBits worst case for the 200 x 228 display:
// one literal control byte for every 128 input bytes.
#define MAX_RLE_BUFFER_BYTES 45957

void RLEBuffer_destructor(void *data)
{
	free(data);
}

void RLEBuffer_constructor(xsMachine *the)
{
	xsIntegerValue byte_length = xsmcToInteger(xsArg(0));
	uint8_t *data;

	if ((byte_length <= 0) || (byte_length > MAX_RLE_BUFFER_BYTES)) {
		xsRangeError("bad RLE buffer length");
	}

	data = malloc((size_t)byte_length);
	if (!data) {
		xsUnknownError("RLE buffer allocation failed");
	}

	xsmcSetHostBuffer(xsThis, data, byte_length);
}

void RLEBuffer_get_byteLength(xsMachine *the)
{
	xsmcSetInteger(xsResult, xsmcGetHostBufferLength(xsThis));
}

void RLEBuffer_write(xsMachine *the)
{
	uint8_t *destination = xsmcGetHostData(xsThis);
	xsIntegerValue destination_length = xsmcGetHostBufferLength(xsThis);
	xsIntegerValue offset = xsmcToInteger(xsArg(0));
	uint8_t *source;
	xsUnsignedValue source_length;

	xsmcGetBufferReadable(xsArg(1), (void **)&source, &source_length);
	if (!destination || (offset < 0) || ((xsUnsignedValue)offset > (xsUnsignedValue)destination_length) ||
		(source_length > ((xsUnsignedValue)destination_length - (xsUnsignedValue)offset))) {
		xsRangeError("RLE write out of range");
	}

	memcpy(destination + offset, source, source_length);
}

void RLEBuffer_close(xsMachine *the)
{
	void *data = xsmcGetHostData(xsThis);

	if (!data) {
		return;
	}

	free(data);
	xsmcSetHostBuffer(xsThis, NULL, 0);
}
