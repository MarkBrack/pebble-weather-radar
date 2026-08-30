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

var prestyled = new Uint8Array([
  255, 255, 255, 255,
  0, 0, 0, 255,
  170, 255, 170, 255
]);
var prestyledClasses = renderer.classifyPrestyledMap(prestyled);
assert.deepStrictEqual(Array.from(prestyled), [
  255, 255, 255, 255,
  0, 0, 0, 255,
  170, 255, 170, 255
]);
assert.deepStrictEqual(Array.from(prestyledClasses), [2, 0, 1]);

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

var standardServerValues = renderer.getRenderValues({
  lat: 54.623, lon: -1.302, mapZoom: 8, cropMode: 'standard',
  tileServerUrl: 'http://tiles.test'
});
var wideServerValues = renderer.getRenderValues({
  lat: 54.623, lon: -1.302, mapZoom: 8, cropMode: 'wide',
  tileServerUrl: 'http://tiles.test'
});
assert.ok(renderer.buildMapTilePlan(standardServerValues).tiles[0].url.indexOf('/tiles/v2/') !== -1);
assert.ok(renderer.buildMapTilePlan(wideServerValues).tiles[0].url.indexOf('/tiles/v2-wide/') !== -1);
assert.strictEqual(
  renderer.buildViewportUrl(standardServerValues),
  'http://tiles.test/maps/v1/standard/8/54.623000/-1.302000.png'
);
assert.strictEqual(
  renderer.buildViewportUrl(Object.assign({}, wideServerValues, { tileServerUrl: 'http://tiles.test/' })),
  'http://tiles.test/maps/v1/wide/8/54.623000/-1.302000.png'
);

console.log('Map rendering tests passed');
