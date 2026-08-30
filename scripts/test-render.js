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
  'http://tiles.test/maps/v2/standard/8/54.623000/-1.302000.png'
);
assert.strictEqual(
  renderer.buildViewportUrl(Object.assign({}, wideServerValues, { tileServerUrl: 'http://tiles.test/' })),
  'http://tiles.test/maps/v2/wide/8/54.623000/-1.302000.png'
);

function testTileServerTimeoutFallback() {
  var encodedTile = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAQAAAAEAAQMAAABmvDolAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAADUExURfLv6REKL5sAAAAHdElNRQfqCB4SHDO9uLJ8AAAAJXRFWHRkYXRlOmNyZWF0ZQAyMDI2LTA4LTMwVDE4OjI4OjUxKzAwOjAwRna0jQAAACV0RVh0ZGF0ZTptb2RpZnkAMjAyNi0wOC0zMFQxODoyODo1MSswMDowMDcrDDEAAAAodEVYdGRhdGU6dGltZXN0YW1wADIwMjYtMDgtMzBUMTg6Mjg6NTErMDA6MDBgPi3uAAAAH0lEQVRo3u3BAQ0AAADCoPdPbQ43oAAAAAAAAAAAvg0hAAABfxmcpwAAAABJRU5ErkJggg==',
    'base64'
  );
  var tilePng = encodedTile.buffer.slice(
    encodedTile.byteOffset,
    encodedTile.byteOffset + encodedTile.byteLength
  );
  var requestedUrls = [];
  var viewportHeaders;
  var transport = {
    fetchArrayBuffer: function(url, timeoutMs, headers) {
      requestedUrls.push(url);
      if (url.indexOf('/maps/v2/') !== -1) {
        viewportHeaders = headers;
        return new Promise(function() {});
      }
      return Promise.resolve(tilePng);
    }
  };

  return renderer.renderBackgroundOnly(transport, {
    lat: 54.623,
    lon: -1.302,
    mapZoom: 8,
    cropMode: 'standard',
    tileServerUrl: 'http://tiles.test',
    tileServerToken: 'test-secret',
    viewportTimeoutMs: 5
  }).then(function(result) {
    assert.strictEqual(result.usedFallback, true);
    assert.ok(result.fallbackReason.indexOf('timed out') !== -1);
    assert.strictEqual(result.values.tileServerUrl, null);
    assert.ok(requestedUrls[0].indexOf('/maps/v2/standard/') !== -1);
    assert.strictEqual(viewportHeaders['X-Tile-Token'], 'test-secret');
    assert.ok(requestedUrls.slice(1).every(function(url) {
      return url.indexOf('https://tile.openstreetmap.org/') === 0;
    }));
  });
}

testTileServerTimeoutFallback().then(function() {
  console.log('Map rendering tests passed');
}).catch(function(error) {
  console.error(error);
  process.exitCode = 1;
});
