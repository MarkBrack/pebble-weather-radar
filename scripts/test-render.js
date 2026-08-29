'use strict';

var assert = require('assert');
var renderer = require('../src/pkjs/render');

function rgba(width, height, color) {
  var output = new Uint8Array(width * height * 4);
  for (var i = 0; i < output.length; i += 4) {
    output[i] = color[0];
    output[i + 1] = color[1];
    output[i + 2] = color[2];
    output[i + 3] = 255;
  }
  return output;
}

function pixel(data, width, x, y) {
  var index = ((y * width) + x) * 4;
  return Array.from(data.slice(index, index + 3));
}

// OSM Carto's inland-water blue must map to the same white used for the sea.
var source = new Uint8Array([
  170, 211, 223, 255,
  242, 239, 233, 255
]);
var classes = renderer.applyPebbleMapStyle(source);
assert.deepStrictEqual(Array.from(source.slice(0, 3)), renderer.MAP_COLORS.water);
assert.deepStrictEqual(Array.from(source.slice(4, 7)), renderer.MAP_COLORS.land);

// In wide mode, retain narrow water polygons instead of averaging them into
// green land. Requiring half of the source block avoids widening one-pixel map
// details which happen to use a similar blue.
var values = {
  baseSize: 4,
  cropWidth: 4,
  cropHeight: 4,
  cropScale: 2
};
var styled = rgba(4, 4, renderer.MAP_COLORS.land);
var mapClasses = new Uint8Array(16);
var waterIndex = ((1 * 4) + 1) * 4;
styled.set([255, 255, 255, 255], waterIndex);
mapClasses[5] = classes[0];
styled.set([255, 255, 255, 255], waterIndex - 4);
mapClasses[4] = classes[0];

var scaled = renderer.cropAndScaleMapForPebble(styled, mapClasses, values);
assert.deepStrictEqual(pixel(scaled, 2, 0, 0), renderer.MAP_COLORS.water);
assert.deepStrictEqual(pixel(scaled, 2, 1, 1), renderer.MAP_COLORS.land);

console.log('Map rendering tests passed');
