#include "/tmp/.pebble-sdk/SDKs/current/toolchain/moddable/xs/includes/xsmc.h"
#include "/tmp/.pebble-sdk/SDKs/current/toolchain/moddable/modules/commodetto/commodettoBitmapFormat.h"

#include <pebble.h>

typedef uint8_t CommodettoBitmapFormat;
typedef uint16_t CommodettoDimension;

typedef struct {
	CommodettoDimension w;
	CommodettoDimension h;
	CommodettoBitmapFormat format;
	int8_t havePointer;
	void *bufferSlot;
	union {
		void *data;
		int32_t offset;
	} bits;
	uint32_t byteLength;
} CommodettoBitmapRecord, *CommodettoBitmap;

typedef struct {
	GBitmap *bitmap;
	uint16_t width;
	uint16_t height;
	uint16_t row_bytes;
	uint32_t byte_length;
} DynamicPebbleBitmapRecord, *DynamicPebbleBitmap;

void xs_dynamicpebblebitmap_destructor(void *data) {
	DynamicPebbleBitmap bitmap = data;
	if (!bitmap) {
		return;
	}

	if (bitmap->bitmap) {
		gbitmap_destroy(bitmap->bitmap);
	}
	free(bitmap);
}

static const xsHostHooks xsDynamicPebbleBitmapHooks = {
	xs_dynamicpebblebitmap_destructor,
	NULL,
	NULL
};

void xs_dynamicpebblebitmap(xsMachine *the) {
	xsIntegerValue width = xsmcToInteger(xsArg(0));
	xsIntegerValue height = xsmcToInteger(xsArg(1));
	DynamicPebbleBitmap dynamic = calloc(1, sizeof(DynamicPebbleBitmapRecord));
	if (!dynamic) {
		xsUnknownError("no memory");
	}

	dynamic->bitmap = gbitmap_create_blank(GSize((int16_t)width, (int16_t)height), GBitmapFormat8Bit);
	if (!dynamic->bitmap) {
		free(dynamic);
		xsUnknownError("gbitmap_create_blank failed");
	}

	dynamic->width = (uint16_t)width;
	dynamic->height = (uint16_t)height;
	dynamic->row_bytes = gbitmap_get_bytes_per_row(dynamic->bitmap);
	dynamic->byte_length = dynamic->row_bytes * dynamic->height;

	CommodettoBitmap cb = xsmcGetHostChunk(xsThis);
	cb->w = dynamic->width;
	cb->h = dynamic->height;
	cb->bits.data = dynamic->bitmap;
	cb->format = kCommodettoBitmapPebble;
	cb->havePointer = true;
	cb->bufferSlot = NULL;
	cb->byteLength = 0;

	xsmcSetHostData(xsThis, dynamic);
	xsSetHostHooks(xsThis, (xsHostHooks *)&xsDynamicPebbleBitmapHooks);
}

void xs_dynamicpebblebitmap_update(xsMachine *the) {
	DynamicPebbleBitmap dynamic = xsmcGetHostDataValidate(xsThis, (void *)&xsDynamicPebbleBitmapHooks);
	xsUnsignedValue count;
	uint8_t *source;
	xsIntegerValue offset = 0;
	xsIntegerValue byte_length = -1;

	xsmcGetBufferReadable(xsArg(0), (void **)&source, &count);
	if (xsmcArgc > 1) {
		offset = xsmcToInteger(xsArg(1));
	}
	if (xsmcArgc > 2) {
		byte_length = xsmcToInteger(xsArg(2));
	}

	if ((offset < 0) || ((xsUnsignedValue)offset > count)) {
		xsRangeError("bad offset");
	}
	source += offset;
	count -= offset;

	if (byte_length >= 0) {
		if ((xsUnsignedValue)byte_length > count) {
			xsRangeError("bad byteLength");
		}
		count = byte_length;
	}

	if (count != dynamic->byte_length) {
		xsRangeError("bad frame length");
	}

	memcpy(gbitmap_get_data(dynamic->bitmap), source, count);
}

void xs_dynamicpebblebitmap_close(xsMachine *the) {
	DynamicPebbleBitmap dynamic = xsmcGetHostData(xsThis);
	if (!dynamic) {
		return;
	}

	xs_dynamicpebblebitmap_destructor(dynamic);
	xsmcSetHostData(xsThis, NULL);
	xsmcSetHostDestructor(xsThis, NULL);
}
