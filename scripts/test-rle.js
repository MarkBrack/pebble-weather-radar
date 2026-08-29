'use strict';

var assert = require('assert');
var rle = require('../src/pkjs/rle');
var location = require('../src/pkjs/location');

function decode(encoded) {
  var output = [];
  var offset = 0;
  while (offset < encoded.length) {
    var control = encoded[offset++];
    if (control <= 127) {
      var literalLength = control + 1;
      assert.ok(offset + literalLength <= encoded.length, 'truncated literal');
      for (var i = 0; i < literalLength; i++) output.push(encoded[offset++]);
    } else {
      assert.notStrictEqual(control, 128, 'reserved PackBits control');
      assert.ok(offset < encoded.length, 'truncated run');
      var runLength = 257 - control;
      var value = encoded[offset++];
      for (var j = 0; j < runLength; j++) output.push(value);
    }
  }
  return new Uint8Array(output);
}

function roundTrip(input) {
  var encoded = rle.encode(input);
  assert.ok(encoded.length <= rle.maxEncodedSize(input.length));
  assert.deepStrictEqual(Array.from(decode(encoded)), Array.from(input));
  return encoded.length;
}

var pixelCount = 200 * 228;
var alternating = new Uint8Array(pixelCount);
for (var i = 0; i < alternating.length; i++) alternating[i] = i & 1;
assert.strictEqual(roundTrip(alternating), rle.maxEncodedSize(pixelCount));

var solid = new Uint8Array(pixelCount);
assert.ok(roundTrip(solid) < 800);

var random = new Uint8Array(pixelCount);
var seed = 0x12345678;
for (i = 0; i < random.length; i++) {
  seed = ((seed * 1664525) + 1013904223) >>> 0;
  random[i] = seed & 0xff;
}
roundTrip(random);

console.log('RLE tests passed; worst-case frame bytes=' + rle.maxEncodedSize(pixelCount));

function assertCoordinates(settings, expectedLatitude, expectedLongitude) {
  var coordinates = location.coordinatesFromSettings(settings);
  assert.ok(coordinates, 'expected valid manual coordinates');
  assert.strictEqual(coordinates.latitude, expectedLatitude);
  assert.strictEqual(coordinates.longitude, expectedLongitude);
}

assertCoordinates({
  MANUAL_LOCATION: true,
  MANUAL_LATITUDE: '54.623',
  MANUAL_LONGITUDE: '-1.302'
}, 54.623, -1.302);
assertCoordinates({
  MANUAL_LOCATION: 1,
  MANUAL_LATITUDE: '-90',
  MANUAL_LONGITUDE: '180'
}, -90, 180);

assert.strictEqual(location.coordinatesFromSettings({
  MANUAL_LOCATION: false,
  MANUAL_LATITUDE: '54.623',
  MANUAL_LONGITUDE: '-1.302'
}), null);
assert.strictEqual(location.coordinatesFromSettings({
  MANUAL_LOCATION: true,
  MANUAL_LATITUDE: '',
  MANUAL_LONGITUDE: '-1.302'
}), null);
assert.strictEqual(location.coordinatesFromSettings({
  MANUAL_LOCATION: true,
  MANUAL_LATITUDE: '91',
  MANUAL_LONGITUDE: '0'
}), null);
assert.strictEqual(location.coordinatesFromSettings({
  MANUAL_LOCATION: true,
  MANUAL_LATITUDE: '0',
  MANUAL_LONGITUDE: '-181'
}), null);

console.log('Location settings tests passed');
