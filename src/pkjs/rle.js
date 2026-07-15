'use strict';

function maxEncodedSize(inputLength) {
  return inputLength + Math.ceil(inputLength / 128);
}

// PackBits RLE: repeated runs use two bytes; mixed data is stored in literal
// blocks of at most 128 bytes. This guarantees a small, calculable worst case.
function encode(bytes) {
  var output = [];
  var offset = 0;

  function runLengthAt(index) {
    var length = 1;
    while (index + length < bytes.length &&
           bytes[index + length] === bytes[index] &&
           length < 128) {
      length++;
    }
    return length;
  }

  while (offset < bytes.length) {
    var runLength = runLengthAt(offset);
    if (runLength >= 3) {
      output.push(257 - runLength, bytes[offset]);
      offset += runLength;
      continue;
    }

    var literalStart = offset;
    while (offset < bytes.length && (offset - literalStart) < 128) {
      runLength = runLengthAt(offset);
      if (runLength >= 3) break;
      offset += Math.min(runLength, 128 - (offset - literalStart));
    }

    var literalLength = offset - literalStart;
    output.push(literalLength - 1);
    for (var i = 0; i < literalLength; i++) {
      output.push(bytes[literalStart + i]);
    }
  }

  return new Uint8Array(output);
}

module.exports = {
  encode: encode,
  maxEncodedSize: maxEncodedSize
};
