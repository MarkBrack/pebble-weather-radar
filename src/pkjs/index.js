var UPNG = require('./lib/UPNG');

var DISPLAY_WIDTH = 144;
var DISPLAY_HEIGHT = 168;
var BASE_SIZE = 512;
var INTERNAL_SCALE = 2;
var INTERNAL_SIZE = BASE_SIZE * INTERNAL_SCALE;
var TILE_SIZE = 256;
var DEFAULT_ZOOM = 8;
var RADAR_MAX_ZOOM = 7;
var CHUNK_SIZE = 512;
var OSM_HOST = 'https://tile.openstreetmap.org';
var RAINVIEWER_API = 'https://api.rainviewer.com/public/weather-maps.json';
var refreshInFlight = false;
var queuedZoom = null;

var MAP_COLORS = {
  water: [0, 0, 0],
  land: [85, 85, 0],
  detail: [85, 85, 85],
  crosshair: [255, 255, 255]
};

var RAIN_COLORS = {
  drizzle: [170, 255, 255],
  light: [0, 170, 255],
  moderate: [0, 85, 170],
  heavy: [255, 255, 0],
  intense: [255, 170, 0],
  extreme: [170, 0, 0]
};

var UNIVERSAL_BLUE_KEYS = [
  { dbz: 15, rgb: [136, 221, 238] },
  { dbz: 20, rgb: [0, 163, 224] },
  { dbz: 25, rgb: [0, 119, 170] },
  { dbz: 30, rgb: [0, 85, 136] },
  { dbz: 35, rgb: [255, 238, 0] },
  { dbz: 40, rgb: [255, 170, 0] },
  { dbz: 45, rgb: [255, 68, 0] },
  { dbz: 50, rgb: [193, 0, 0] },
  { dbz: 55, rgb: [255, 170, 255] }
];

function xhr(url, responseType) {
  return new Promise(function(resolve, reject) {
    var request = new XMLHttpRequest();
    request.open('GET', url, true);
    if (responseType) {
      request.responseType = responseType;
    }
    request.onload = function() {
      if (request.status >= 200 && request.status < 300) {
        resolve(request.response);
      } else {
        reject(new Error('HTTP ' + request.status + ' for ' + url));
      }
    };
    request.onerror = function() {
      reject(new Error('Network error for ' + url));
    };
    request.send();
  });
}

function fetchJson(url) {
  return xhr(url, 'text').then(function(text) {
    return JSON.parse(text);
  });
}

function fetchPngRgba(url) {
  return xhr(url, 'arraybuffer').then(function(buffer) {
    var decoded = UPNG.decode(buffer);
    var frames = UPNG.toRGBA8(decoded);
    return {
      width: decoded.width,
      height: decoded.height,
      rgba: new Uint8Array(frames[0])
    };
  });
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function wrap(value, modulo) {
  var wrapped = value % modulo;
  return wrapped < 0 ? wrapped + modulo : wrapped;
}

function lonToWorldPixelX(lon, zoom) {
  var scale = TILE_SIZE * Math.pow(2, zoom);
  return (lon + 180) / 360 * scale;
}

function latToWorldPixelY(lat, zoom) {
  var sinLat = Math.sin(lat * Math.PI / 180);
  var scale = TILE_SIZE * Math.pow(2, zoom);
  return (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * scale;
}

function copyTileIntoBuffer(source, sourceWidth, sourceHeight, dest, regionLeft, regionTop, zoomHi, tileX, tileY) {
  var worldX = tileX * TILE_SIZE;
  var worldY = tileY * TILE_SIZE;
  var destX = worldX - regionLeft;
  var destY = worldY - regionTop;
  var startX = clamp(Math.ceil(-destX), 0, TILE_SIZE);
  var startY = clamp(Math.ceil(-destY), 0, TILE_SIZE);
  var endX = clamp(Math.floor(INTERNAL_SIZE - destX), 0, TILE_SIZE);
  var endY = clamp(Math.floor(INTERNAL_SIZE - destY), 0, TILE_SIZE);

  if (startX >= endX || startY >= endY) {
    return;
  }

  for (var y = startY; y < endY; y++) {
    var targetRow = Math.floor(destY + y);
    if (targetRow < 0 || targetRow >= INTERNAL_SIZE) {
      continue;
    }

    for (var x = startX; x < endX; x++) {
      var targetCol = Math.floor(destX + x);
      if (targetCol < 0 || targetCol >= INTERNAL_SIZE) {
        continue;
      }

      var sourceIndex = ((y * sourceWidth) + x) * 4;
      var targetIndex = ((targetRow * INTERNAL_SIZE) + targetCol) * 4;
      dest[targetIndex] = source[sourceIndex];
      dest[targetIndex + 1] = source[sourceIndex + 1];
      dest[targetIndex + 2] = source[sourceIndex + 2];
      dest[targetIndex + 3] = source[sourceIndex + 3];
    }
  }
}

function downsample2x(source, sourceSize) {
  var output = new Uint8Array(BASE_SIZE * BASE_SIZE * 4);
  for (var y = 0; y < BASE_SIZE; y++) {
    var sourceY = y * 2;
    for (var x = 0; x < BASE_SIZE; x++) {
      var sourceX = x * 2;
      var outputIndex = ((y * BASE_SIZE) + x) * 4;
      var baseIndex = ((sourceY * sourceSize) + sourceX) * 4;
      var rightIndex = baseIndex + 4;
      var downIndex = baseIndex + (sourceSize * 4);
      var diagonalIndex = downIndex + 4;

      output[outputIndex] = (source[baseIndex] + source[rightIndex] +
        source[downIndex] + source[diagonalIndex]) >> 2;
      output[outputIndex + 1] = (source[baseIndex + 1] + source[rightIndex + 1] +
        source[downIndex + 1] + source[diagonalIndex + 1]) >> 2;
      output[outputIndex + 2] = (source[baseIndex + 2] + source[rightIndex + 2] +
        source[downIndex + 2] + source[diagonalIndex + 2]) >> 2;
      output[outputIndex + 3] = (source[baseIndex + 3] + source[rightIndex + 3] +
        source[downIndex + 3] + source[diagonalIndex + 3]) >> 2;
    }
  }
  return output;
}

function colorDistanceSq(r1, g1, b1, r2, g2, b2) {
  var dr = r1 - r2;
  var dg = g1 - g2;
  var db = b1 - b2;
  return (dr * dr) + (dg * dg) + (db * db);
}

function applyMapStyle(buffer) {
  for (var i = 0; i < buffer.length; i += 4) {
    var r = buffer[i];
    var g = buffer[i + 1];
    var b = buffer[i + 2];
    var luminance = (r * 299 + g * 587 + b * 114) / 1000;
    var target;

    if (b > r + 16 && b > g + 8) {
      target = MAP_COLORS.water;
    } else if (luminance > 180 || Math.abs(r - g) + Math.abs(g - b) < 18) {
      target = MAP_COLORS.detail;
    } else {
      target = MAP_COLORS.land;
    }

    buffer[i] = target[0];
    buffer[i + 1] = target[1];
    buffer[i + 2] = target[2];
    buffer[i + 3] = 255;
  }
}

function radarBucketForPixel(r, g, b, alpha) {
  if (alpha < 32) {
    return null;
  }

  var bestMatch = null;
  var bestDistance = Infinity;

  for (var i = 0; i < UNIVERSAL_BLUE_KEYS.length; i++) {
    var sample = UNIVERSAL_BLUE_KEYS[i];
    var distance = colorDistanceSq(r, g, b,
      sample.rgb[0], sample.rgb[1], sample.rgb[2]);

    if (distance < bestDistance) {
      bestDistance = distance;
      bestMatch = sample.dbz;
    }
  }

  if (bestMatch === null || bestMatch < 15) {
    return null;
  }

  if (bestMatch < 20) {
    return RAIN_COLORS.drizzle;
  }
  if (bestMatch < 30) {
    return RAIN_COLORS.light;
  }
  if (bestMatch < 35) {
    return RAIN_COLORS.moderate;
  }
  if (bestMatch < 40) {
    return RAIN_COLORS.heavy;
  }
  if (bestMatch < 50) {
    return RAIN_COLORS.intense;
  }
  return RAIN_COLORS.extreme;
}

function overlayRadar(base, radar) {
  for (var i = 0; i < base.length; i += 4) {
    var rainColor = radarBucketForPixel(radar[i], radar[i + 1], radar[i + 2], radar[i + 3]);
    if (!rainColor) {
      continue;
    }

    base[i] = rainColor[0];
    base[i + 1] = rainColor[1];
    base[i + 2] = rainColor[2];
    base[i + 3] = 255;
  }
}

function drawCrosshair(buffer, width, height) {
  var cx = Math.floor(width / 2);
  var cy = Math.floor(height / 2);

  function paint(x, y) {
    if (x < 0 || x >= width || y < 0 || y >= height) {
      return;
    }
    var index = ((y * width) + x) * 4;
    buffer[index] = MAP_COLORS.crosshair[0];
    buffer[index + 1] = MAP_COLORS.crosshair[1];
    buffer[index + 2] = MAP_COLORS.crosshair[2];
    buffer[index + 3] = 255;
  }

  for (var delta = -6; delta <= 6; delta++) {
    paint(cx + delta, cy);
    paint(cx, cy + delta);
  }
}

function cropCenter(buffer, sourceWidth, sourceHeight, targetWidth, targetHeight) {
  var left = Math.floor((sourceWidth - targetWidth) / 2);
  var top = Math.floor((sourceHeight - targetHeight) / 2);
  var output = new Uint8Array(targetWidth * targetHeight * 4);

  for (var y = 0; y < targetHeight; y++) {
    var sourceIndex = (((top + y) * sourceWidth) + left) * 4;
    var destIndex = y * targetWidth * 4;
    output.set(buffer.subarray(sourceIndex, sourceIndex + (targetWidth * 4)), destIndex);
  }

  return output;
}

function quantizeToPebble8Bit(rgba) {
  var output = new Uint8Array(DISPLAY_WIDTH * DISPLAY_HEIGHT);

  for (var i = 0, pixel = 0; i < rgba.length; i += 4, pixel++) {
    var r = Math.round(rgba[i] / 85);
    var g = Math.round(rgba[i + 1] / 85);
    var b = Math.round(rgba[i + 2] / 85);
    output[pixel] = 0xC0 | (r << 4) | (g << 2) | b;
  }

  return output;
}

function buildTileList(lat, lon, zoom) {
  var zoomHi = zoom + 1;
  var tileCount = Math.pow(2, zoomHi);
  var centerX = lonToWorldPixelX(lon, zoomHi);
  var centerY = latToWorldPixelY(lat, zoomHi);
  var regionLeft = centerX - (INTERNAL_SIZE / 2);
  var regionTop = centerY - (INTERNAL_SIZE / 2);
  var startTileX = Math.floor(regionLeft / TILE_SIZE);
  var endTileX = Math.floor((regionLeft + INTERNAL_SIZE - 1) / TILE_SIZE);
  var startTileY = Math.floor(regionTop / TILE_SIZE);
  var endTileY = Math.floor((regionTop + INTERNAL_SIZE - 1) / TILE_SIZE);
  var tiles = [];

  for (var tileY = startTileY; tileY <= endTileY; tileY++) {
    if (tileY < 0 || tileY >= tileCount) {
      continue;
    }
    for (var tileX = startTileX; tileX <= endTileX; tileX++) {
      tiles.push({
        url: OSM_HOST + '/' + zoomHi + '/' + wrap(tileX, tileCount) + '/' + tileY + '.png',
        tileX: tileX,
        tileY: tileY
      });
    }
  }

  return {
    tiles: tiles,
    regionLeft: regionLeft,
    regionTop: regionTop,
    zoomHi: zoomHi
  };
}

function latestRadarFrame() {
  return fetchJson(RAINVIEWER_API).then(function(payload) {
    if (!payload || !payload.host || !payload.radar || !payload.radar.past || !payload.radar.past.length) {
      throw new Error('RainViewer returned no radar frames');
    }
    var frame = payload.radar.past[payload.radar.past.length - 1];
    return {
      host: payload.host,
      path: frame.path
    };
  });
}

function fetchTilesSerially(tiles) {
  var results = [];

  return tiles.reduce(function(chain, tile) {
    return chain.then(function() {
      return fetchPngRgba(tile.url).then(function(image) {
        results.push({
          image: image,
          tileX: tile.tileX,
          tileY: tile.tileY
        });
      });
    });
  }, Promise.resolve()).then(function() {
    return results;
  });
}

function buildRadarUrl(frame, lat, lon, zoom) {
  var radarZoom = Math.min(zoom, RADAR_MAX_ZOOM);
  return frame.host + frame.path + '/' + BASE_SIZE + '/' + radarZoom + '/' +
    lat.toFixed(6) + '/' + lon.toFixed(6) + '/2/0_0.png';
}

function renderFrame(lat, lon, zoom) {
  var tilePlan = buildTileList(lat, lon, zoom);

  return Promise.all([
    latestRadarFrame(),
    fetchTilesSerially(tilePlan.tiles)
  ]).then(function(results) {
    var radarFrame = results[0];
    var tileImages = results[1];
    var highResMap = new Uint8Array(INTERNAL_SIZE * INTERNAL_SIZE * 4);

    for (var i = 0; i < highResMap.length; i += 4) {
      highResMap[i] = 255;
      highResMap[i + 1] = 255;
      highResMap[i + 2] = 255;
      highResMap[i + 3] = 255;
    }

    tileImages.forEach(function(tile) {
      copyTileIntoBuffer(
        tile.image.rgba,
        tile.image.width,
        tile.image.height,
        highResMap,
        tilePlan.regionLeft,
        tilePlan.regionTop,
        tilePlan.zoomHi,
        tile.tileX,
        tile.tileY
      );
    });

    return fetchPngRgba(buildRadarUrl(radarFrame, lat, lon, zoom)).then(function(radarImage) {
      var baseMap = downsample2x(highResMap, INTERNAL_SIZE);
      applyMapStyle(baseMap);
      overlayRadar(baseMap, radarImage.rgba);
      drawCrosshair(baseMap, BASE_SIZE, BASE_SIZE);
      var cropped = cropCenter(baseMap, BASE_SIZE, BASE_SIZE, DISPLAY_WIDTH, DISPLAY_HEIGHT);
      return quantizeToPebble8Bit(cropped);
    });
  });
}

function sendMessage(payload) {
  return new Promise(function(resolve, reject) {
    Pebble.sendAppMessage(payload, resolve, reject);
  });
}

function sendFrame(bytes) {
  return sendMessage({
    FRAME_WIDTH: DISPLAY_WIDTH,
    FRAME_HEIGHT: DISPLAY_HEIGHT,
    FRAME_TOTAL_BYTES: bytes.length,
    STATUS_TEXT: 'Sending frame...'
  }).then(function() {
    var offset = 0;

    function sendNextChunk() {
      if (offset >= bytes.length) {
        return Promise.resolve();
      }

      var nextOffset = Math.min(offset + CHUNK_SIZE, bytes.length);
      var chunk = Array.prototype.slice.call(bytes.subarray(offset, nextOffset));
      var currentOffset = offset;
      offset = nextOffset;

      return sendMessage({
        FRAME_OFFSET: currentOffset,
        FRAME_CHUNK: chunk
      }).then(sendNextChunk);
    }

    return sendNextChunk();
  });
}

function reportError(message) {
  return sendMessage({
    STATUS_TEXT: message.slice(0, 63)
  }).catch(function() {});
}

function getLocation() {
  return new Promise(function(resolve, reject) {
    navigator.geolocation.getCurrentPosition(function(position) {
      resolve(position.coords);
    }, function(error) {
      reject(new Error('Location failed: ' + error.message));
    }, {
      enableHighAccuracy: false,
      timeout: 20000,
      maximumAge: 300000
    });
  });
}

function refreshFrame(zoom) {
  var selectedZoom = clamp(zoom || DEFAULT_ZOOM, 0, 18);
  if (refreshInFlight) {
    queuedZoom = selectedZoom;
    return;
  }

  refreshInFlight = true;
  reportError('Locating...').then(function() {
    return getLocation();
  }).then(function(coords) {
    return reportError('Fetching radar...').then(function() {
      return renderFrame(coords.latitude, coords.longitude, selectedZoom);
    });
  }).then(function(bytes) {
    return sendFrame(bytes);
  }).then(function() {
    return reportError('');
  }).catch(function(error) {
    console.log(error.message);
    reportError(error.message);
  }).then(function() {
    refreshInFlight = false;
    if (queuedZoom !== null && queuedZoom !== selectedZoom) {
      var nextZoom = queuedZoom;
      queuedZoom = null;
      refreshFrame(nextZoom);
    } else {
      queuedZoom = null;
    }
  });
}

Pebble.addEventListener('ready', function() {
  console.log('PebbleKit JS ready');
});

Pebble.addEventListener('appmessage', function(event) {
  var zoom = DEFAULT_ZOOM;
  if (event && event.payload && event.payload.MAP_ZOOM) {
    zoom = event.payload.MAP_ZOOM;
  }
  refreshFrame(zoom);
});
