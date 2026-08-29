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

var storage = {
  getItem: function() {
    return JSON.stringify({ TILE_SERVER_URL: 'http://10.0.0.2:8080/' });
  }
};
assert.strictEqual(tileSource.getServerUrl(storage), 'http://10.0.0.2:8080');

console.log('Tile source settings tests passed');
