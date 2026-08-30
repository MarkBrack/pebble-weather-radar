'use strict';

var assert = require('assert');
var tileSource = require('../src/pkjs/tile-source');

assert.strictEqual(tileSource.normalizeServerUrl(' http://192.168.1.10:8080/ '),
  'http://192.168.1.10:8080');
assert.strictEqual(tileSource.normalizeServerUrl('https://tiles.example.test/base///'),
  'https://tiles.example.test/base');
assert.strictEqual(tileSource.normalizeServerUrl(''), null);
assert.strictEqual(tileSource.normalizeServerUrl('192.168.1.10:8080'), null);
assert.strictEqual(tileSource.normalizeServerUrl('javascript:alert(1)'), null);

assert.strictEqual(
  tileSource.getServerUrl(),
  'https://ada.tailadb379.ts.net:8443/weather-radar'
);

console.log('Tile source settings tests passed');
