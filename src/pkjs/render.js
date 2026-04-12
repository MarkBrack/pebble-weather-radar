var UPNG = require('./lib/UPNG');

var DISPLAY_WIDTH = 200;
var DISPLAY_HEIGHT = 228;
var BASE_SIZE = 512;
var TILE_SIZE = 256;
var RADAR_MAX_ZOOM = 7;

var MAP_STYLES = {
  osm_standard: {
    label: 'OSM Standard',
    attribution: 'OpenStreetMap',
    url: function(z, x, y) {
      return 'https://tile.openstreetmap.org/' + z + '/' + x + '/' + y + '.png';
    }
  }
};

var MAP_COLORS = {
  water: [255, 255, 255],
  land: [85, 170, 85],
  detail: [170, 255, 170],
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
  { dbz: 0, rgb: [130, 123, 105] },
  { dbz: 5, rgb: [146, 136, 113] },
  { dbz: 10, rgb: [206, 192, 135] },
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

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function wrapX(x, z) {
  var max = Math.pow(2, z);
  return ((x % max) + max) % max;
}

function colorDistanceSq(r1, g1, b1, r2, g2, b2) {
  var dr = r1 - r2;
  var dg = g1 - g2;
  var db = b1 - b2;
  return (dr * dr) + (dg * dg) + (db * db);
}

function latLonToWorldPixels(lat, lon, zoom) {
  var scale = TILE_SIZE * Math.pow(2, zoom);
  var x = ((lon + 180) / 360) * scale;
  var sinLat = Math.sin((lat * Math.PI) / 180);
  var y = (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * scale;
  return { x: x, y: y };
}

function getTileStyle(styleId) {
  return MAP_STYLES[styleId] || MAP_STYLES.osm_standard;
}

function getRenderValues(options) {
  var cropMode = options.cropMode === 'wide' ? 'wide' : 'standard';
  var cropScale = cropMode === 'wide' ? 2 : 1;
  var mapZoom = clamp(options.mapZoom || 8, 0, 18);
  var radarZoomCap = options.radarZoomCap || RADAR_MAX_ZOOM;
  var mapDetailMode = options.mapDetailMode === 'sharper' ? 'sharper' : 'native';
  var detailScale = mapDetailMode === 'sharper' ? 2 : 1;
  return {
    lat: options.lat,
    lon: options.lon,
    mapZoom: mapZoom,
    radarZoom: Math.min(mapZoom, radarZoomCap),
    cropMode: cropMode,
    cropScale: cropScale,
    cropWidth: DISPLAY_WIDTH * cropScale,
    cropHeight: DISPLAY_HEIGHT * cropScale,
    mapStyle: options.mapStyle || 'osm_standard',
    mapDetailMode: mapDetailMode,
    detailScale: detailScale,
    baseSize: options.baseSize || BASE_SIZE,
    radarColor: options.radarColor || 2,
    radarOptions: options.radarOptions || '1_1'
  };
}

function buildMapTilePlan(values) {
  var hiZoom = values.mapDetailMode === 'sharper' ? values.mapZoom + 1 : values.mapZoom;
  var sourceWidth = values.baseSize * values.detailScale;
  var sourceHeight = values.baseSize * values.detailScale;
  var tileStyle = getTileStyle(values.mapStyle);
  var center = latLonToWorldPixels(values.lat, values.lon, hiZoom);
  var left = center.x - sourceWidth / 2;
  var top = center.y - sourceHeight / 2;
  var startTileX = Math.floor(left / TILE_SIZE);
  var endTileX = Math.floor((left + sourceWidth - 1) / TILE_SIZE);
  var startTileY = Math.floor(top / TILE_SIZE);
  var endTileY = Math.floor((top + sourceHeight - 1) / TILE_SIZE);
  var maxY = Math.pow(2, hiZoom) - 1;
  var tiles = [];
  var tileX;
  var tileY;

  for (tileY = startTileY; tileY <= endTileY; tileY++) {
    if (tileY < 0 || tileY > maxY) {
      continue;
    }
    for (tileX = startTileX; tileX <= endTileX; tileX++) {
      tiles.push({
        tileX: tileX,
        tileY: tileY,
        url: tileStyle.url(hiZoom, wrapX(tileX, hiZoom), tileY)
      });
    }
  }

  return {
    hiZoom: hiZoom,
    left: left,
    top: top,
    center: center,
    sourceWidth: sourceWidth,
    sourceHeight: sourceHeight,
    tiles: tiles,
    tileStyle: tileStyle
  };
}

function fetchPngRgba(fetchArrayBuffer, url) {
  return fetchArrayBuffer(url).then(function(buffer) {
    var decoded = UPNG.decode(buffer);
    var frames = UPNG.toRGBA8(decoded);
    return {
      width: decoded.width,
      height: decoded.height,
      rgba: new Uint8Array(frames[0])
    };
  });
}

function blitTile(source, sourceWidth, sourceHeight, dest, destWidth, destHeight, destX, destY) {
  var startX = clamp(Math.ceil(-destX), 0, sourceWidth);
  var startY = clamp(Math.ceil(-destY), 0, sourceHeight);
  var endX = clamp(Math.floor(destWidth - destX), 0, sourceWidth);
  var endY = clamp(Math.floor(destHeight - destY), 0, sourceHeight);
  var x;
  var y;

  if (startX >= endX || startY >= endY) {
    return;
  }

  for (y = startY; y < endY; y++) {
    var targetRow = Math.floor(destY + y);
    for (x = startX; x < endX; x++) {
      var targetCol = Math.floor(destX + x);
      var sourceIndex = ((y * sourceWidth) + x) * 4;
      var targetIndex = ((targetRow * destWidth) + targetCol) * 4;
      dest[targetIndex] = source[sourceIndex];
      dest[targetIndex + 1] = source[sourceIndex + 1];
      dest[targetIndex + 2] = source[sourceIndex + 2];
      dest[targetIndex + 3] = source[sourceIndex + 3];
    }
  }
}

function assembleMapSource(plan, tileImages) {
  var source = new Uint8Array(plan.sourceWidth * plan.sourceHeight * 4);
  var i;

  for (i = 0; i < source.length; i += 4) {
    source[i] = 255;
    source[i + 1] = 255;
    source[i + 2] = 255;
    source[i + 3] = 255;
  }

  tileImages.forEach(function(entry) {
    var worldX = entry.tile.tileX * TILE_SIZE;
    var worldY = entry.tile.tileY * TILE_SIZE;
    var drawX = worldX - plan.left;
    var drawY = worldY - plan.top;
    blitTile(
      entry.image.rgba,
      entry.image.width,
      entry.image.height,
      source,
      plan.sourceWidth,
      plan.sourceHeight,
      drawX,
      drawY
    );
  });

  return source;
}

function downsample2x(source, sourceWidth, sourceHeight) {
  var outputWidth = Math.floor(sourceWidth / 2);
  var outputHeight = Math.floor(sourceHeight / 2);
  var output = new Uint8Array(outputWidth * outputHeight * 4);
  var x;
  var y;

  for (y = 0; y < outputHeight; y++) {
    var sourceY = y * 2;
    for (x = 0; x < outputWidth; x++) {
      var sourceX = x * 2;
      var outputIndex = ((y * outputWidth) + x) * 4;
      var baseIndex = ((sourceY * sourceWidth) + sourceX) * 4;
      var rightIndex = baseIndex + 4;
      var downIndex = baseIndex + (sourceWidth * 4);
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

  return {
    width: outputWidth,
    height: outputHeight,
    rgba: output
  };
}

function scaleMapSourceToBase(source, plan, baseSize) {
  if (plan.sourceWidth === baseSize && plan.sourceHeight === baseSize) {
    return {
      width: plan.sourceWidth,
      height: plan.sourceHeight,
      rgba: source.slice(0)
    };
  }

  if (plan.sourceWidth === baseSize * 2 && plan.sourceHeight === baseSize * 2) {
    return downsample2x(source, plan.sourceWidth, plan.sourceHeight);
  }

  throw new Error('Unsupported map source scale ' + plan.sourceWidth + 'x' + plan.sourceHeight);
}

function applyPebbleMapStyle(data) {
  var i;
  for (i = 0; i < data.length; i += 4) {
    var r = data[i];
    var g = data[i + 1];
    var b = data[i + 2];
    var luminance = (r * 299 + g * 587 + b * 114) / 1000;
    var chroma = Math.max(r, g, b) - Math.min(r, g, b);
    var target;

    if ((b > 150 && b >= g + 8 && b >= r + 20) ||
        (b > 180 && g > 180 && r < 210)) {
      target = MAP_COLORS.water;
    } else if (luminance > 205 || chroma < 16) {
      target = MAP_COLORS.land;
    } else if (g >= r - 8 && g >= b + 12 && luminance > 140) {
      target = MAP_COLORS.detail;
    } else if (r > 210 && g > 210 && b < 225) {
      target = MAP_COLORS.detail;
    } else {
      target = MAP_COLORS.land;
    }

    data[i] = target[0];
    data[i + 1] = target[1];
    data[i + 2] = target[2];
    data[i + 3] = 255;
  }
}

function radarBucketForPixel(r, g, b, alpha) {
  var bestDbz = null;
  var bestDistance = Infinity;
  var i;

  if (alpha < 48) {
    return null;
  }

  for (i = 0; i < UNIVERSAL_BLUE_KEYS.length; i++) {
    var sample = UNIVERSAL_BLUE_KEYS[i];
    var distance = colorDistanceSq(
      r, g, b,
      sample.rgb[0], sample.rgb[1], sample.rgb[2]
    );

    if (distance < bestDistance) {
      bestDistance = distance;
      bestDbz = sample.dbz;
    }
  }

  if (bestDbz === null || bestDbz < 15) {
    return null;
  }

  if (bestDbz < 20) {
    return {
      color: RAIN_COLORS.drizzle,
      dither: alpha < 112
    };
  }
  if (bestDbz < 30) {
    return {
      color: RAIN_COLORS.light,
      dither: alpha < 112
    };
  }
  if (bestDbz < 35) {
    return {
      color: RAIN_COLORS.moderate,
      dither: alpha < 112
    };
  }
  if (bestDbz < 40) {
    return {
      color: RAIN_COLORS.heavy,
      dither: alpha < 112
    };
  }
  if (bestDbz < 50) {
    return {
      color: RAIN_COLORS.intense,
      dither: alpha < 112
    };
  }
  return {
    color: RAIN_COLORS.extreme,
    dither: alpha < 112
  };
}

function sampleScaledRadar(radarImage, baseSize, mapZoom, radarZoom, x, y) {
  var zoomScale = Math.pow(2, mapZoom - radarZoom);
  var scaledRadarSize = baseSize * zoomScale;
  var radarLeft = (baseSize - scaledRadarSize) / 2;
  var radarTop = (baseSize - scaledRadarSize) / 2;
  var sourceX = ((x - radarLeft) / scaledRadarSize) * radarImage.width;
  var sourceY = ((y - radarTop) / scaledRadarSize) * radarImage.height;

  if (sourceX < 0 || sourceY < 0 ||
      sourceX >= radarImage.width || sourceY >= radarImage.height) {
    return null;
  }

  return {
    x: clamp(Math.floor(sourceX), 0, radarImage.width - 1),
    y: clamp(Math.floor(sourceY), 0, radarImage.height - 1)
  };
}

function overlayRadar(baseData, radarImage, values, overlayMode) {
  var x;
  var y;

  for (y = 0; y < values.baseSize; y++) {
    for (x = 0; x < values.baseSize; x++) {
      var samplePoint = sampleScaledRadar(radarImage, values.baseSize, values.mapZoom, values.radarZoom, x, y);
      var baseIndex = ((y * values.baseSize) + x) * 4;

      if (!samplePoint) {
        continue;
      }

      if (overlayMode === 'coverage') {
        baseData[baseIndex] = RAIN_COLORS.light[0];
        baseData[baseIndex + 1] = RAIN_COLORS.light[1];
        baseData[baseIndex + 2] = RAIN_COLORS.light[2];
        baseData[baseIndex + 3] = 255;
        continue;
      }

      var radarIndex = ((samplePoint.y * radarImage.width) + samplePoint.x) * 4;
      var rainSample = radarBucketForPixel(
        radarImage.rgba[radarIndex],
        radarImage.rgba[radarIndex + 1],
        radarImage.rgba[radarIndex + 2],
        radarImage.rgba[radarIndex + 3]
      );

      if (!rainSample) {
        continue;
      }

      if (rainSample.dither && ((x + y) % 2 === 1)) {
        continue;
      }

      baseData[baseIndex] = rainSample.color[0];
      baseData[baseIndex + 1] = rainSample.color[1];
      baseData[baseIndex + 2] = rainSample.color[2];
      baseData[baseIndex + 3] = 255;
    }
  }
}

function drawCrosshairIntoBuffer(data, width, height) {
  var cx = Math.floor(width / 2);
  var cy = Math.floor(height / 2);
  var delta;

  function paint(x, y) {
    if (x < 0 || x >= width || y < 0 || y >= height) {
      return;
    }
    var index = ((y * width) + x) * 4;
    data[index] = MAP_COLORS.crosshair[0];
    data[index + 1] = MAP_COLORS.crosshair[1];
    data[index + 2] = MAP_COLORS.crosshair[2];
    data[index + 3] = 255;
  }

  for (delta = -6; delta <= 6; delta++) {
    paint(cx + delta, cy);
    paint(cx, cy + delta);
  }
}

function cropBuffer(source, sourceWidth, left, top, width, height) {
  var output = new Uint8Array(width * height * 4);
  var y;

  for (y = 0; y < height; y++) {
    var sourceIndex = (((top + y) * sourceWidth) + left) * 4;
    output.set(source.subarray(sourceIndex, sourceIndex + (width * 4)), y * width * 4);
  }

  return output;
}

function cropAndScaleForPebble(composite, values) {
  var left = Math.floor((values.baseSize - values.cropWidth) / 2);
  var top = Math.floor((values.baseSize - values.cropHeight) / 2);
  var cropped = cropBuffer(composite, values.baseSize, left, top, values.cropWidth, values.cropHeight);

  if (values.cropScale === 1) {
    return cropped;
  }

  if (values.cropScale !== 2) {
    throw new Error('Unsupported crop scale ' + values.cropScale);
  }

  return downsample2x(cropped, values.cropWidth, values.cropHeight).rgba;
}

function quantizeToPebble8Bit(rgba) {
  var output = new Uint8Array(DISPLAY_WIDTH * DISPLAY_HEIGHT);
  var i;
  var pixel;

  for (i = 0, pixel = 0; i < rgba.length; i += 4, pixel++) {
    var r = Math.round(rgba[i] / 85);
    var g = Math.round(rgba[i + 1] / 85);
    var b = Math.round(rgba[i + 2] / 85);
    output[pixel] = 0xC0 | (r << 4) | (g << 2) | b;
  }

  return output;
}

function buildRadarUrl(framePath, size, radarZoom, lat, lon, color, options) {
  return 'https://tilecache.rainviewer.com' + framePath + '/' + size + '/' + radarZoom + '/' +
    lat.toFixed(6) + '/' + lon.toFixed(6) + '/' + color + '/' + options + '.png';
}

function buildCoverageUrl(size, radarZoom, lat, lon) {
  return 'https://tilecache.rainviewer.com/v2/coverage/0/' + size + '/' + radarZoom + '/' +
    lat.toFixed(6) + '/' + lon.toFixed(6) + '/0/0_0.png';
}

function summarizeFrame(rgba) {
  var counts = {};
  var i;
  var key;
  var topColors;

  for (i = 0; i < rgba.length; i += 4) {
    key = rgba[i] + ',' + rgba[i + 1] + ',' + rgba[i + 2];
    counts[key] = (counts[key] || 0) + 1;
  }

  topColors = Object.keys(counts).sort(function(a, b) {
    return counts[b] - counts[a];
  }).slice(0, 8).map(function(color) {
    return { color: color, count: counts[color] };
  });

  return {
    uniqueColorCount: Object.keys(counts).length,
    topColors: topColors
  };
}

function fetchTilesSerially(transport, tiles) {
  var results = [];

  return tiles.reduce(function(chain, tile) {
    return chain.then(function() {
      return fetchPngRgba(transport.fetchArrayBuffer, tile.url).then(function(image) {
        results.push({
          tile: tile,
          image: image
        });
      });
    });
  }, Promise.resolve()).then(function() {
    return results;
  });
}

function renderScene(transport, options) {
  var values = getRenderValues(options);
  var plan = buildMapTilePlan(values);
  var radarUrl = buildRadarUrl(
    options.framePath,
    values.baseSize,
    values.radarZoom,
    values.lat,
    values.lon,
    values.radarColor,
    values.radarOptions
  );
  var coverageUrl = buildCoverageUrl(
    values.baseSize,
    values.radarZoom,
    values.lat,
    values.lon
  );

  return fetchTilesSerially(transport, plan.tiles).then(function(tileImages) {
    var mapSource = assembleMapSource(plan, tileImages);
    var scaledMap = scaleMapSourceToBase(mapSource, plan, values.baseSize);
    return fetchPngRgba(transport.fetchArrayBuffer, radarUrl).then(function(radarImage) {
      return {
        mode: 'radar',
        radarImage: radarImage,
        mapSource: mapSource,
        scaledMap: scaledMap,
        tileImages: tileImages
      };
    }).catch(function() {
      return fetchPngRgba(transport.fetchArrayBuffer, coverageUrl).then(function(coverageImage) {
        return {
          mode: 'coverage',
          radarImage: coverageImage,
          mapSource: mapSource,
          scaledMap: scaledMap,
          tileImages: tileImages
        };
      });
    });
  }).then(function(state) {
    var composite = state.scaledMap.rgba.slice(0);
    applyPebbleMapStyle(composite);
    overlayRadar(composite, state.radarImage, values, state.mode);
    drawCrosshairIntoBuffer(composite, values.baseSize, values.baseSize);

    var pebbleRgba = cropAndScaleForPebble(composite, values);
    var pebble8Bit = quantizeToPebble8Bit(pebbleRgba);

    return {
      values: values,
      plan: plan,
      radarUrl: radarUrl,
      coverageUrl: coverageUrl,
      overlayMode: state.mode,
      mapSourceRgba: state.mapSource,
      mapSourceWidth: plan.sourceWidth,
      mapSourceHeight: plan.sourceHeight,
      compositeRgba: composite,
      compositeWidth: values.baseSize,
      compositeHeight: values.baseSize,
      pebbleRgba: pebbleRgba,
      pebble8Bit: pebble8Bit,
      summary: summarizeFrame(pebbleRgba)
    };
  });
}

module.exports = {
  DISPLAY_WIDTH: DISPLAY_WIDTH,
  DISPLAY_HEIGHT: DISPLAY_HEIGHT,
  BASE_SIZE: BASE_SIZE,
  RADAR_MAX_ZOOM: RADAR_MAX_ZOOM,
  MAP_COLORS: MAP_COLORS,
  RAIN_COLORS: RAIN_COLORS,
  getRenderValues: getRenderValues,
  buildMapTilePlan: buildMapTilePlan,
  renderScene: renderScene
};
