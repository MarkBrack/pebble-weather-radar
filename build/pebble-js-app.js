/******/ (function(modules) { // webpackBootstrap
/******/ 	// The module cache
/******/ 	var installedModules = {};
/******/
/******/ 	// The require function
/******/ 	function __webpack_require__(moduleId) {
/******/
/******/ 		// Check if module is in cache
/******/ 		if(installedModules[moduleId])
/******/ 			return installedModules[moduleId].exports;
/******/
/******/ 		// Create a new module (and put it into the cache)
/******/ 		var module = installedModules[moduleId] = {
/******/ 			exports: {},
/******/ 			id: moduleId,
/******/ 			loaded: false
/******/ 		};
/******/
/******/ 		// Execute the module function
/******/ 		modules[moduleId].call(module.exports, module, module.exports, __webpack_require__);
/******/
/******/ 		// Flag the module as loaded
/******/ 		module.loaded = true;
/******/
/******/ 		// Return the exports of the module
/******/ 		return module.exports;
/******/ 	}
/******/
/******/
/******/ 	// expose the modules object (__webpack_modules__)
/******/ 	__webpack_require__.m = modules;
/******/
/******/ 	// expose the module cache
/******/ 	__webpack_require__.c = installedModules;
/******/
/******/ 	// __webpack_public_path__
/******/ 	__webpack_require__.p = "";
/******/
/******/ 	// Load entry module and return exports
/******/ 	return __webpack_require__(0);
/******/ })
/************************************************************************/
/******/ ([
/* 0 */
/***/ (function(module, exports, __webpack_require__) {

	__webpack_require__(1);
	module.exports = __webpack_require__(2);


/***/ }),
/* 1 */
/***/ (function(module, exports) {

	/**
	 * Copyright 2024 Google LLC
	 *
	 * Licensed under the Apache License, Version 2.0 (the "License");
	 * you may not use this file except in compliance with the License.
	 * You may obtain a copy of the License at
	 *
	 *     http://www.apache.org/licenses/LICENSE-2.0
	 *
	 * Unless required by applicable law or agreed to in writing, software
	 * distributed under the License is distributed on an "AS IS" BASIS,
	 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
	 * See the License for the specific language governing permissions and
	 * limitations under the License.
	 */
	
	(function(p) {
	  if (!p === undefined) {
	    console.error('Pebble object not found!?');
	    return;
	  }
	
	  // Aliases:
	  p.on = p.addEventListener;
	  p.off = p.removeEventListener;
	
	  // For Android (WebView-based) pkjs, print stacktrace for uncaught errors:
	  if (typeof window !== 'undefined' && window.addEventListener) {
	    window.addEventListener('error', function(event) {
	      if (event.error && event.error.stack) {
	        console.error('' + event.error + '\n' + event.error.stack);
	      }
	    });
	  }
	
	})(Pebble);


/***/ }),
/* 2 */
/***/ (function(module, exports, __webpack_require__) {

	var UPNG = __webpack_require__(3);
	
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


/***/ }),
/* 3 */
/***/ (function(module, exports, __webpack_require__) {

	
	;(function(){
	var UPNG = {};
	
	// Make available for import by `require()`
	var pako;
	if (true) {module.exports = UPNG;}  else {window.UPNG = UPNG;}
	if (true) {pako = __webpack_require__(4);}  else {pako = window.pako;}
	function log() { if (typeof process=="undefined" || process.env.NODE_ENV=="development") console.log.apply(console, arguments);  }
	(function(UPNG, pako){
	
		
	
		
	
	UPNG.toRGBA8 = function(out)
	{
		var w = out.width, h = out.height;
		if(out.tabs.acTL==null) return [UPNG.toRGBA8.decodeImage(out.data, w, h, out).buffer];
		
		var frms = [];
		if(out.frames[0].data==null) out.frames[0].data = out.data;
		
		var img, empty = new Uint8Array(w*h*4);
		for(var i=0; i<out.frames.length; i++)
		{
			var frm = out.frames[i];
			var fx=frm.rect.x, fy=frm.rect.y, fw = frm.rect.width, fh = frm.rect.height;
			var fdata = UPNG.toRGBA8.decodeImage(frm.data, fw,fh, out);
			
			if(i==0) img = fdata;
			else if(frm.blend  ==0) UPNG._copyTile(fdata, fw, fh, img, w, h, fx, fy, 0);
			else if(frm.blend  ==1) UPNG._copyTile(fdata, fw, fh, img, w, h, fx, fy, 1);
			
			frms.push(img.buffer);  img = img.slice(0);
			
			if     (frm.dispose==0) {}
			else if(frm.dispose==1) UPNG._copyTile(empty, fw, fh, img, w, h, fx, fy, 0);
			else if(frm.dispose==2) {
				var pi = i-1;
				while(out.frames[pi].dispose==2) pi--;
				img = new Uint8Array(frms[pi]).slice(0);
			}
		}
		return frms;
	}
	UPNG.toRGBA8.decodeImage = function(data, w, h, out)
	{
		var area = w*h, bpp = UPNG.decode._getBPP(out);
		var bpl = Math.ceil(w*bpp/8);	// bytes per line
	
		var bf = new Uint8Array(area*4), bf32 = new Uint32Array(bf.buffer);
		var ctype = out.ctype, depth = out.depth;
		var rs = UPNG._bin.readUshort;
		
		//console.log(ctype, depth);
	
		if     (ctype==6) { // RGB + alpha
			var qarea = area<<2;
			if(depth== 8) for(var i=0; i<qarea;i++) {  bf[i] = data[i];  /*if((i&3)==3 && data[i]!=0) bf[i]=255;*/ }
			if(depth==16) for(var i=0; i<qarea;i++) {  bf[i] = data[i<<1];  }
		}
		else if(ctype==2) {	// RGB
			var ts=out.tabs["tRNS"], tr=-1, tg=-1, tb=-1;
			if(ts) {  tr=ts[0];  tg=ts[1];  tb=ts[2];  }
			if(depth== 8) for(var i=0; i<area; i++) {  var qi=i<<2, ti=i*3;  bf[qi] = data[ti];  bf[qi+1] = data[ti+1];  bf[qi+2] = data[ti+2];  bf[qi+3] = 255;
				if(tr!=-1 && data[ti]   ==tr && data[ti+1]   ==tg && data[ti+2]   ==tb) bf[qi+3] = 0;  }
			if(depth==16) for(var i=0; i<area; i++) {  var qi=i<<2, ti=i*6;  bf[qi] = data[ti];  bf[qi+1] = data[ti+2];  bf[qi+2] = data[ti+4];  bf[qi+3] = 255;
				if(tr!=-1 && rs(data,ti)==tr && rs(data,ti+2)==tg && rs(data,ti+4)==tb) bf[qi+3] = 0;  }
		}
		else if(ctype==3) {	// palette
			var p=out.tabs["PLTE"], ap=out.tabs["tRNS"], tl=ap?ap.length:0;
			//console.log(p, ap);
			if(depth==1) for(var y=0; y<h; y++) {  var s0 = y*bpl, t0 = y*w;
				for(var i=0; i<w; i++) { var qi=(t0+i)<<2, j=((data[s0+(i>>3)]>>(7-((i&7)<<0)))& 1), cj=3*j;  bf[qi]=p[cj];  bf[qi+1]=p[cj+1];  bf[qi+2]=p[cj+2];  bf[qi+3]=(j<tl)?ap[j]:255;  }
			}
			if(depth==2) for(var y=0; y<h; y++) {  var s0 = y*bpl, t0 = y*w;
				for(var i=0; i<w; i++) { var qi=(t0+i)<<2, j=((data[s0+(i>>2)]>>(6-((i&3)<<1)))& 3), cj=3*j;  bf[qi]=p[cj];  bf[qi+1]=p[cj+1];  bf[qi+2]=p[cj+2];  bf[qi+3]=(j<tl)?ap[j]:255;  }
			}
			if(depth==4) for(var y=0; y<h; y++) {  var s0 = y*bpl, t0 = y*w;
				for(var i=0; i<w; i++) { var qi=(t0+i)<<2, j=((data[s0+(i>>1)]>>(4-((i&1)<<2)))&15), cj=3*j;  bf[qi]=p[cj];  bf[qi+1]=p[cj+1];  bf[qi+2]=p[cj+2];  bf[qi+3]=(j<tl)?ap[j]:255;  }
			}
			if(depth==8) for(var i=0; i<area; i++ ) {  var qi=i<<2, j=data[i]                      , cj=3*j;  bf[qi]=p[cj];  bf[qi+1]=p[cj+1];  bf[qi+2]=p[cj+2];  bf[qi+3]=(j<tl)?ap[j]:255;  }
		}
		else if(ctype==4) {	// gray + alpha
			if(depth== 8)  for(var i=0; i<area; i++) {  var qi=i<<2, di=i<<1, gr=data[di];  bf[qi]=gr;  bf[qi+1]=gr;  bf[qi+2]=gr;  bf[qi+3]=data[di+1];  }
			if(depth==16)  for(var i=0; i<area; i++) {  var qi=i<<2, di=i<<2, gr=data[di];  bf[qi]=gr;  bf[qi+1]=gr;  bf[qi+2]=gr;  bf[qi+3]=data[di+2];  }
		}
		else if(ctype==0) {	// gray
			var tr = out.tabs["tRNS"] ? out.tabs["tRNS"] : -1;
			if(depth== 1) for(var i=0; i<area; i++) {  var gr=255*((data[i>>3]>>(7 -((i&7)   )))& 1), al=(gr==tr*255)?0:255;  bf32[i]=(al<<24)|(gr<<16)|(gr<<8)|gr;  }
			if(depth== 2) for(var i=0; i<area; i++) {  var gr= 85*((data[i>>2]>>(6 -((i&3)<<1)))& 3), al=(gr==tr* 85)?0:255;  bf32[i]=(al<<24)|(gr<<16)|(gr<<8)|gr;  }
			if(depth== 4) for(var i=0; i<area; i++) {  var gr= 17*((data[i>>1]>>(4 -((i&1)<<2)))&15), al=(gr==tr* 17)?0:255;  bf32[i]=(al<<24)|(gr<<16)|(gr<<8)|gr;  }
			if(depth== 8) for(var i=0; i<area; i++) {  var gr=data[i  ] , al=(gr           ==tr)?0:255;  bf32[i]=(al<<24)|(gr<<16)|(gr<<8)|gr;  }
			if(depth==16) for(var i=0; i<area; i++) {  var gr=data[i<<1], al=(rs(data,i<<1)==tr)?0:255;  bf32[i]=(al<<24)|(gr<<16)|(gr<<8)|gr;  }
		}
		return bf;
	}
	
	
	
	UPNG.decode = function(buff)
	{
		var data = new Uint8Array(buff), offset = 8, bin = UPNG._bin, rUs = bin.readUshort, rUi = bin.readUint;
		var out = {tabs:{}, frames:[]};
		var dd = new Uint8Array(data.length), doff = 0;	 // put all IDAT data into it
		var fd, foff = 0;	// frames
		
		var mgck = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
		for(var i=0; i<8; i++) if(data[i]!=mgck[i]) throw "The input is not a PNG file!";
	
		while(offset<data.length)
		{
			var len  = bin.readUint(data, offset);  offset += 4;
			var type = bin.readASCII(data, offset, 4);  offset += 4;
			//log(type,len);
			
			if     (type=="IHDR")  {  UPNG.decode._IHDR(data, offset, out);  }
			else if(type=="IDAT") {
				for(var i=0; i<len; i++) dd[doff+i] = data[offset+i];
				doff += len;
			}
			else if(type=="acTL")  {
				out.tabs[type] = {  num_frames:rUi(data, offset), num_plays:rUi(data, offset+4)  };
				fd = new Uint8Array(data.length);
			}
			else if(type=="fcTL")  {
				if(foff!=0) {  var fr = out.frames[out.frames.length-1];
					fr.data = UPNG.decode._decompress(out, fd.slice(0,foff), fr.rect.width, fr.rect.height);  foff=0;
				}
				var rct = {x:rUi(data, offset+12),y:rUi(data, offset+16),width:rUi(data, offset+4),height:rUi(data, offset+8)};
				var del = rUs(data, offset+22);  del = rUs(data, offset+20) / (del==0?100:del);
				var frm = {rect:rct, delay:Math.round(del*1000), dispose:data[offset+24], blend:data[offset+25]};
				//console.log(frm);
				out.frames.push(frm);
			}
			else if(type=="fdAT") {
				for(var i=0; i<len-4; i++) fd[foff+i] = data[offset+i+4];
				foff += len-4;
			}
			else if(type=="pHYs") {
				out.tabs[type] = [bin.readUint(data, offset), bin.readUint(data, offset+4), data[offset+8]];
			}
			else if(type=="cHRM") {
				out.tabs[type] = [];
				for(var i=0; i<8; i++) out.tabs[type].push(bin.readUint(data, offset+i*4));
			}
			else if(type=="tEXt") {
				if(out.tabs[type]==null) out.tabs[type] = {};
				var nz = bin.nextZero(data, offset);
				var keyw = bin.readASCII(data, offset, nz-offset);
				var text = bin.readASCII(data, nz+1, offset+len-nz-1);
				out.tabs[type][keyw] = text;
			}
			else if(type=="iTXt") {
				if(out.tabs[type]==null) out.tabs[type] = {};
				var nz = 0, off = offset;
				nz = bin.nextZero(data, off);
				var keyw = bin.readASCII(data, off, nz-off);  off = nz + 1;
				var cflag = data[off], cmeth = data[off+1];  off+=2;
				nz = bin.nextZero(data, off);
				var ltag = bin.readASCII(data, off, nz-off);  off = nz + 1;
				nz = bin.nextZero(data, off);
				var tkeyw = bin.readUTF8(data, off, nz-off);  off = nz + 1;
				var text  = bin.readUTF8(data, off, len-(off-offset));
				out.tabs[type][keyw] = text;
			}
			else if(type=="PLTE") {
				out.tabs[type] = bin.readBytes(data, offset, len);
			}
			else if(type=="hIST") {
				var pl = out.tabs["PLTE"].length/3;
				out.tabs[type] = [];  for(var i=0; i<pl; i++) out.tabs[type].push(rUs(data, offset+i*2));
			}
			else if(type=="tRNS") {
				if     (out.ctype==3) out.tabs[type] = bin.readBytes(data, offset, len);
				else if(out.ctype==0) out.tabs[type] = rUs(data, offset);
				else if(out.ctype==2) out.tabs[type] = [ rUs(data,offset),rUs(data,offset+2),rUs(data,offset+4) ];
				//else console.log("tRNS for unsupported color type",out.ctype, len);
			}
			else if(type=="gAMA") out.tabs[type] = bin.readUint(data, offset)/100000;
			else if(type=="sRGB") out.tabs[type] = data[offset];
			else if(type=="bKGD")
			{
				if     (out.ctype==0 || out.ctype==4) out.tabs[type] = [rUs(data, offset)];
				else if(out.ctype==2 || out.ctype==6) out.tabs[type] = [rUs(data, offset), rUs(data, offset+2), rUs(data, offset+4)];
				else if(out.ctype==3) out.tabs[type] = data[offset];
			}
			else if(type=="IEND") {
				if(foff!=0) {  var fr = out.frames[out.frames.length-1];
					fr.data = UPNG.decode._decompress(out, fd.slice(0,foff), fr.rect.width, fr.rect.height);  foff=0;
				}	
				out.data = UPNG.decode._decompress(out, dd, out.width, out.height);  break;
			}
			//else {  log("unknown chunk type", type, len);  }
			offset += len;
			var crc = bin.readUint(data, offset);  offset += 4;
		}
		delete out.compress;  delete out.interlace;  delete out.filter;
		return out;
	}
	
	UPNG.decode._decompress = function(out, dd, w, h) {
		if(out.compress ==0) dd = UPNG.decode._inflate(dd);
	
		if     (out.interlace==0) dd = UPNG.decode._filterZero(dd, out, 0, w, h);
		else if(out.interlace==1) dd = UPNG.decode._readInterlace(dd, out);
		return dd;
	}
	
	UPNG.decode._inflate = function(data) {  return pako["inflate"](data);  }
	
	UPNG.decode._readInterlace = function(data, out)
	{
		var w = out.width, h = out.height;
		var bpp = UPNG.decode._getBPP(out), cbpp = bpp>>3, bpl = Math.ceil(w*bpp/8);
		var img = new Uint8Array( h * bpl );
		var di = 0;
	
		var starting_row  = [ 0, 0, 4, 0, 2, 0, 1 ];
		var starting_col  = [ 0, 4, 0, 2, 0, 1, 0 ];
		var row_increment = [ 8, 8, 8, 4, 4, 2, 2 ];
		var col_increment = [ 8, 8, 4, 4, 2, 2, 1 ];
	
		var pass=0;
		while(pass<7)
		{
			var ri = row_increment[pass], ci = col_increment[pass];
			var sw = 0, sh = 0;
			var cr = starting_row[pass];  while(cr<h) {  cr+=ri;  sh++;  }
			var cc = starting_col[pass];  while(cc<w) {  cc+=ci;  sw++;  }
			var bpll = Math.ceil(sw*bpp/8);
			UPNG.decode._filterZero(data, out, di, sw, sh);
	
			var y=0, row = starting_row[pass];
			while(row<h)
			{
				var col = starting_col[pass];
				var cdi = (di+y*bpll)<<3;
	
				while(col<w)
				{
					if(bpp==1) {
						var val = data[cdi>>3];  val = (val>>(7-(cdi&7)))&1;
						img[row*bpl + (col>>3)] |= (val << (7-((col&3)<<0)));
					}
					if(bpp==2) {
						var val = data[cdi>>3];  val = (val>>(6-(cdi&7)))&3;
						img[row*bpl + (col>>2)] |= (val << (6-((col&3)<<1)));
					}
					if(bpp==4) {
						var val = data[cdi>>3];  val = (val>>(4-(cdi&7)))&15;
						img[row*bpl + (col>>1)] |= (val << (4-((col&1)<<2)));
					}
					if(bpp>=8) {
						var ii = row*bpl+col*cbpp;
						for(var j=0; j<cbpp; j++) img[ii+j] = data[(cdi>>3)+j];
					}
					cdi+=bpp;  col+=ci;
				}
				y++;  row += ri;
			}
			if(sw*sh!=0) di += sh * (1 + bpll);
			pass = pass + 1;
		}
		return img;
	}
	
	UPNG.decode._getBPP = function(out) {
		var noc = [1,null,3,1,2,null,4][out.ctype];
		return noc * out.depth;
	}
	
	UPNG.decode._filterZero = function(data, out, off, w, h)
	{
		var bpp = UPNG.decode._getBPP(out), bpl = Math.ceil(w*bpp/8), paeth = UPNG.decode._paeth;
		bpp = Math.ceil(bpp/8);
	
		for(var y=0; y<h; y++)  {
			var i = off+y*bpl, di = i+y+1;
			var type = data[di-1];
	
			if     (type==0) for(var x=  0; x<bpl; x++) data[i+x] = data[di+x];
			else if(type==1) {
				for(var x=  0; x<bpp; x++) data[i+x] = data[di+x];
				for(var x=bpp; x<bpl; x++) data[i+x] = (data[di+x] + data[i+x-bpp])&255;
			}
			else if(y==0) {
				for(var x=  0; x<bpp; x++) data[i+x] = data[di+x];
				if(type==2) for(var x=bpp; x<bpl; x++) data[i+x] = (data[di+x])&255;
				if(type==3) for(var x=bpp; x<bpl; x++) data[i+x] = (data[di+x] + (data[i+x-bpp]>>1) )&255;
				if(type==4) for(var x=bpp; x<bpl; x++) data[i+x] = (data[di+x] + paeth(data[i+x-bpp], 0, 0) )&255;
			}
			else {
				if(type==2) { for(var x=  0; x<bpl; x++) data[i+x] = (data[di+x] + data[i+x-bpl])&255;  }
	
				if(type==3) { for(var x=  0; x<bpp; x++) data[i+x] = (data[di+x] + (data[i+x-bpl]>>1))&255;
				              for(var x=bpp; x<bpl; x++) data[i+x] = (data[di+x] + ((data[i+x-bpl]+data[i+x-bpp])>>1) )&255;  }
	
				if(type==4) { for(var x=  0; x<bpp; x++) data[i+x] = (data[di+x] + paeth(0, data[i+x-bpl], 0))&255;
							  for(var x=bpp; x<bpl; x++) data[i+x] = (data[di+x] + paeth(data[i+x-bpp], data[i+x-bpl], data[i+x-bpp-bpl]) )&255;  }
			}
		}
		return data;
	}
	
	UPNG.decode._paeth = function(a,b,c)
	{
		var p = a+b-c, pa = Math.abs(p-a), pb = Math.abs(p-b), pc = Math.abs(p-c);
		if (pa <= pb && pa <= pc)  return a;
		else if (pb <= pc)  return b;
		return c;
	}
	
	UPNG.decode._IHDR = function(data, offset, out)
	{
		var bin = UPNG._bin;
		out.width  = bin.readUint(data, offset);  offset += 4;
		out.height = bin.readUint(data, offset);  offset += 4;
		out.depth     = data[offset];  offset++;
		out.ctype     = data[offset];  offset++;
		out.compress  = data[offset];  offset++;
		out.filter    = data[offset];  offset++;
		out.interlace = data[offset];  offset++;
	}
	
	UPNG._bin = {
		nextZero   : function(data,p)  {  while(data[p]!=0) p++;  return p;  },
		readUshort : function(buff,p)  {  return (buff[p]<< 8) | buff[p+1];  },
		writeUshort: function(buff,p,n){  buff[p] = (n>>8)&255;  buff[p+1] = n&255;  },
		readUint   : function(buff,p)  {  return (buff[p]*(256*256*256)) + ((buff[p+1]<<16) | (buff[p+2]<< 8) | buff[p+3]);  },
		writeUint  : function(buff,p,n){  buff[p]=(n>>24)&255;  buff[p+1]=(n>>16)&255;  buff[p+2]=(n>>8)&255;  buff[p+3]=n&255;  },
		readASCII  : function(buff,p,l){  var s = "";  for(var i=0; i<l; i++) s += String.fromCharCode(buff[p+i]);  return s;    },
		writeASCII : function(data,p,s){  for(var i=0; i<s.length; i++) data[p+i] = s.charCodeAt(i);  },
		readBytes  : function(buff,p,l){  var arr = [];   for(var i=0; i<l; i++) arr.push(buff[p+i]);   return arr;  },
		pad : function(n) { return n.length < 2 ? "0" + n : n; },
		readUTF8 : function(buff, p, l) {
			var s = "", ns;
			for(var i=0; i<l; i++) s += "%" + UPNG._bin.pad(buff[p+i].toString(16));
			try {  ns = decodeURIComponent(s); }
			catch(e) {  return UPNG._bin.readASCII(buff, p, l);  }
			return  ns;
		}
	}
	UPNG._copyTile = function(sb, sw, sh, tb, tw, th, xoff, yoff, mode)
	{
		var w = Math.min(sw,tw), h = Math.min(sh,th);
		var si=0, ti=0;
		for(var y=0; y<h; y++)
			for(var x=0; x<w; x++)
			{
				if(xoff>=0 && yoff>=0) {  si = (y*sw+x)<<2;  ti = (( yoff+y)*tw+xoff+x)<<2;  }
				else                   {  si = ((-yoff+y)*sw-xoff+x)<<2;  ti = (y*tw+x)<<2;  }
				
				if     (mode==0) {  tb[ti] = sb[si];  tb[ti+1] = sb[si+1];  tb[ti+2] = sb[si+2];  tb[ti+3] = sb[si+3];  }
				else if(mode==1) {
					var fa = sb[si+3]*(1/255), fr=sb[si]*fa, fg=sb[si+1]*fa, fb=sb[si+2]*fa; 
					var ba = tb[ti+3]*(1/255), br=tb[ti]*ba, bg=tb[ti+1]*ba, bb=tb[ti+2]*ba; 
					
					var ifa=1-fa, oa = fa+ba*ifa, ioa = (oa==0?0:1/oa);
					tb[ti+3] = 255*oa;  
					tb[ti+0] = (fr+br*ifa)*ioa;  
					tb[ti+1] = (fg+bg*ifa)*ioa;   
					tb[ti+2] = (fb+bb*ifa)*ioa;  
				}
				else if(mode==2){	// copy only differences, otherwise zero
					var fa = sb[si+3], fr=sb[si], fg=sb[si+1], fb=sb[si+2]; 
					var ba = tb[ti+3], br=tb[ti], bg=tb[ti+1], bb=tb[ti+2]; 
					if(fa==ba && fr==br && fg==bg && fb==bb) {  tb[ti]=0;  tb[ti+1]=0;  tb[ti+2]=0;  tb[ti+3]=0;  }
					else {  tb[ti]=fr;  tb[ti+1]=fg;  tb[ti+2]=fb;  tb[ti+3]=fa;  }
				}
				else if(mode==3){	// check if can be blended
					var fa = sb[si+3], fr=sb[si], fg=sb[si+1], fb=sb[si+2]; 
					var ba = tb[ti+3], br=tb[ti], bg=tb[ti+1], bb=tb[ti+2]; 
					if(fa==ba && fr==br && fg==bg && fb==bb) continue;
					//if(fa!=255 && ba!=0) return false;
					if(fa<220 && ba>20) return false;
				}
			}
		return true;
	}
	
	
	
	UPNG.encode = function(bufs, w, h, ps, dels, forbidPlte)
	{
		if(ps==null) ps=0;
		if(forbidPlte==null) forbidPlte = false;
		var data = new Uint8Array(bufs[0].byteLength*bufs.length+100);
		var wr=[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
		for(var i=0; i<8; i++) data[i]=wr[i];
		var offset = 8,  bin = UPNG._bin, crc = UPNG.crc.crc, wUi = bin.writeUint, wUs = bin.writeUshort, wAs = bin.writeASCII;
	
		var nimg = UPNG.encode.compressPNG(bufs, w, h, ps, forbidPlte);
	
		wUi(data,offset, 13);     offset+=4;
		wAs(data,offset,"IHDR");  offset+=4;
		wUi(data,offset,w);  offset+=4;
		wUi(data,offset,h);  offset+=4;
		data[offset] = nimg.depth;  offset++;  // depth
		data[offset] = nimg.ctype;  offset++;  // ctype
		data[offset] = 0;  offset++;  // compress
		data[offset] = 0;  offset++;  // filter
		data[offset] = 0;  offset++;  // interlace
		wUi(data,offset,crc(data,offset-17,17));  offset+=4; // crc
	
		// 9 bytes to say, that it is sRGB
		wUi(data,offset, 1);      offset+=4;
		wAs(data,offset,"sRGB");  offset+=4;
		data[offset] = 1;  offset++;
		wUi(data,offset,crc(data,offset-5,5));  offset+=4; // crc
	
		var anim = bufs.length>1;
		if(anim) {
			wUi(data,offset, 8);      offset+=4;
			wAs(data,offset,"acTL");  offset+=4;
			wUi(data,offset, bufs.length);      offset+=4;
			wUi(data,offset, 0);      offset+=4;
			wUi(data,offset,crc(data,offset-12,12));  offset+=4; // crc
		}
	
		if(nimg.ctype==3) {
			var dl = nimg.plte.length;
			wUi(data,offset, dl*3);  offset+=4;
			wAs(data,offset,"PLTE");  offset+=4;
			for(var i=0; i<dl; i++){
				var ti=i*3, c=nimg.plte[i], r=(c)&255, g=(c>>8)&255, b=(c>>16)&255;
				data[offset+ti+0]=r;  data[offset+ti+1]=g;  data[offset+ti+2]=b;
			}
			offset+=dl*3;
			wUi(data,offset,crc(data,offset-dl*3-4,dl*3+4));  offset+=4; // crc
	
			if(nimg.gotAlpha) {
				wUi(data,offset, dl);  offset+=4;
				wAs(data,offset,"tRNS");  offset+=4;
				for(var i=0; i<dl; i++)  data[offset+i]=(nimg.plte[i]>>24)&255;
				offset+=dl;
				wUi(data,offset,crc(data,offset-dl-4,dl+4));  offset+=4; // crc
			}
		}
		
		var fi = 0;
		for(var j=0; j<nimg.frames.length; j++)
		{
			var fr = nimg.frames[j];
			if(anim) {
				wUi(data,offset, 26);     offset+=4;
				wAs(data,offset,"fcTL");  offset+=4;
				wUi(data, offset, fi++);   offset+=4;
				wUi(data, offset, fr.rect.width );   offset+=4;
				wUi(data, offset, fr.rect.height);   offset+=4;
				wUi(data, offset, fr.rect.x);   offset+=4;
				wUi(data, offset, fr.rect.y);   offset+=4;
				wUs(data, offset, dels[j]);   offset+=2;
				wUs(data, offset,  1000);   offset+=2;
				data[offset] = fr.dispose;  offset++;	// dispose
				data[offset] = fr.blend  ;  offset++;	// blend
				wUi(data,offset,crc(data,offset-30,30));  offset+=4; // crc
			}
					
			var imgd = fr.cimg, dl = imgd.length;
			wUi(data,offset, dl+(j==0?0:4));     offset+=4;
			var ioff = offset;
			wAs(data,offset,(j==0)?"IDAT":"fdAT");  offset+=4;
			if(j!=0) {  wUi(data, offset, fi++);  offset+=4;  }
			for(var i=0; i<dl; i++) data[offset+i] = imgd[i];
			offset += dl;
			wUi(data,offset,crc(data,ioff,offset-ioff));  offset+=4; // crc
		}
	
		wUi(data,offset, 0);     offset+=4;
		wAs(data,offset,"IEND");  offset+=4;
		wUi(data,offset,crc(data,offset-4,4));  offset+=4; // crc
	
		return data.buffer.slice(0,offset);
	}
	
	UPNG.encode.compressPNG = function(bufs, w, h, ps, forbidPlte)
	{
		var out = UPNG.encode.compress(bufs, w, h, ps, false, forbidPlte);
		for(var i=0; i<bufs.length; i++) {
			var frm = out.frames[i], nw=frm.rect.width, nh=frm.rect.height, bpl=frm.bpl, bpp=frm.bpp;
			var fdata = new Uint8Array(nh*bpl+nh);
			frm.cimg = UPNG.encode._filterZero(frm.img,nh,bpp,bpl,fdata);
		}	
		return out;
	}
	
	UPNG.encode.compress = function(bufs, w, h, ps, forGIF, forbidPlte)
	{
		if(forbidPlte==null) forbidPlte = false;
		
		var ctype = 6, depth = 8, bpp = 4, alphaAnd=255
		
		for(var j=0; j<bufs.length; j++)  {  // when not quantized, other frames can contain colors, that are not in an initial frame
			var img = new Uint8Array(bufs[j]), ilen = img.length;
			for(var i=0; i<ilen; i+=4) alphaAnd &= img[i+3];
		}
		var gotAlpha = (alphaAnd)!=255;
		
		var cmap={}, plte=[];  if(bufs.length!=0) {  cmap[0]=0;  plte.push(0);  if(ps!=0) ps--;  } 
		
		
		if(ps!=0) {
			var qres = UPNG.quantize(bufs, ps, forGIF);  bufs = qres.bufs;
			for(var i=0; i<qres.plte.length; i++) {  var c=qres.plte[i].est.rgba;  if(cmap[c]==null) {  cmap[c]=plte.length;  plte.push(c);  }     }
		}
		else {
			// what if ps==0, but there are <=256 colors?  we still need to detect, if the palette could be used
			for(var j=0; j<bufs.length; j++)  {  // when not quantized, other frames can contain colors, that are not in an initial frame
				var img32 = new Uint32Array(bufs[j]), ilen = img32.length;
				for(var i=0; i<ilen; i++) {
					var c = img32[i];
					if((i<w || (c!=img32[i-1] && c!=img32[i-w])) && cmap[c]==null) {  cmap[c]=plte.length;  plte.push(c);  if(plte.length>=300) break;  }
				}
			}
		}
		
		var brute = gotAlpha ? forGIF : false;		// brute : frames can only be copied, not "blended"
		var cc=plte.length;  //console.log(cc);
		if(cc<=256 && forbidPlte==false) {
			if(cc<= 2) depth=1;  else if(cc<= 4) depth=2;  else if(cc<=16) depth=4;  else depth=8;
			if(forGIF) depth=8;
			gotAlpha = true;
		}
		
		
		var frms = [];
		for(var j=0; j<bufs.length; j++)
		{
			var cimg = new Uint8Array(bufs[j]), cimg32 = new Uint32Array(cimg.buffer);
			
			var nx=0, ny=0, nw=w, nh=h, blend=0;
			if(j!=0 && !brute) {
				var tlim = (forGIF || j==1 || frms[frms.length-2].dispose==2)?1:2, tstp = 0, tarea = 1e9;
				for(var it=0; it<tlim; it++)
				{
					var pimg = new Uint8Array(bufs[j-1-it]), p32 = new Uint32Array(bufs[j-1-it]);
					var mix=w,miy=h,max=-1,may=-1;
					for(var y=0; y<h; y++) for(var x=0; x<w; x++) {
						var i = y*w+x;
						if(cimg32[i]!=p32[i]) {
							if(x<mix) mix=x;  if(x>max) max=x;
							if(y<miy) miy=y;  if(y>may) may=y;
						}
					}
					var sarea = (max==-1) ? 1 : (max-mix+1)*(may-miy+1);
					if(sarea<tarea) {
						tarea = sarea;  tstp = it;  
						if(max==-1) {  nx=ny=0;  nw=nh=1;  }
						else {  nx = mix; ny = miy; nw = max-mix+1; nh = may-miy+1;  }
					}
				}
				
				var pimg = new Uint8Array(bufs[j-1-tstp]);
				if(tstp==1) frms[frms.length-1].dispose = 2;
				
				var nimg = new Uint8Array(nw*nh*4), nimg32 = new Uint32Array(nimg.buffer);
				UPNG.   _copyTile(pimg,w,h, nimg,nw,nh, -nx,-ny, 0);
				if(UPNG._copyTile(cimg,w,h, nimg,nw,nh, -nx,-ny, 3)) {
					UPNG._copyTile(cimg,w,h, nimg,nw,nh, -nx,-ny, 2);  blend = 1;
				}
				else {
					UPNG._copyTile(cimg,w,h, nimg,nw,nh, -nx,-ny, 0);  blend = 0;
				}
				cimg = nimg;  cimg32 = new Uint32Array(cimg.buffer);
			}
			var bpl = 4*nw;
			if(cc<=256 && forbidPlte==false) {
				bpl = Math.ceil(depth*nw/8);
				var nimg = new Uint8Array(bpl*nh);
				for(var y=0; y<nh; y++) {  var i=y*bpl, ii=y*nw;
					if     (depth==8) for(var x=0; x<nw; x++) nimg[i+(x)   ]   =  (cmap[cimg32[ii+x]]             );
					else if(depth==4) for(var x=0; x<nw; x++) nimg[i+(x>>1)]  |=  (cmap[cimg32[ii+x]]<<(4-(x&1)*4));
					else if(depth==2) for(var x=0; x<nw; x++) nimg[i+(x>>2)]  |=  (cmap[cimg32[ii+x]]<<(6-(x&3)*2));
					else if(depth==1) for(var x=0; x<nw; x++) nimg[i+(x>>3)]  |=  (cmap[cimg32[ii+x]]<<(7-(x&7)*1));
				}
				cimg=nimg;  ctype=3;  bpp=1;
			}
			else if(gotAlpha==false && bufs.length==1) {	// some next "reduced" frames may contain alpha for blending
				var nimg = new Uint8Array(nw*nh*3), area=nw*nh;
				for(var i=0; i<area; i++) { var ti=i*3, qi=i*4;  nimg[ti]=cimg[qi];  nimg[ti+1]=cimg[qi+1];  nimg[ti+2]=cimg[qi+2];  }
				cimg=nimg;  ctype=2;  bpp=3;  bpl=3*nw;
			}
			frms.push({rect:{x:nx,y:ny,width:nw,height:nh}, img:cimg, bpl:bpl, bpp:bpp, blend:blend, dispose:brute?1:0});
		}
		return {ctype:ctype, depth:depth, plte:plte, gotAlpha:gotAlpha, frames:frms  };
	}
	
	UPNG.encode._filterZero = function(img,h,bpp,bpl,data)
	{
		var fls = [];
		for(var t=0; t<5; t++) {  if(h*bpl>500000 && (t==2 || t==3 || t==4)) continue;
			for(var y=0; y<h; y++) UPNG.encode._filterLine(data, img, y, bpl, bpp, t);
			fls.push(pako["deflate"](data));  if(bpp==1) break;
		}
		var ti, tsize=1e9;
		for(var i=0; i<fls.length; i++) if(fls[i].length<tsize) {  ti=i;  tsize=fls[i].length;  }
		return fls[ti];
	}
	UPNG.encode._filterLine = function(data, img, y, bpl, bpp, type)
	{
		var i = y*bpl, di = i+y, paeth = UPNG.decode._paeth
		data[di]=type;  di++;
	
		if(type==0) for(var x=0; x<bpl; x++) data[di+x] = img[i+x];
		else if(type==1) {
			for(var x=  0; x<bpp; x++) data[di+x] =  img[i+x];
			for(var x=bpp; x<bpl; x++) data[di+x] = (img[i+x]-img[i+x-bpp]+256)&255;
		}
		else if(y==0) {
			for(var x=  0; x<bpp; x++) data[di+x] = img[i+x];
	
			if(type==2) for(var x=bpp; x<bpl; x++) data[di+x] = img[i+x];
			if(type==3) for(var x=bpp; x<bpl; x++) data[di+x] = (img[i+x] - (img[i+x-bpp]>>1) +256)&255;
			if(type==4) for(var x=bpp; x<bpl; x++) data[di+x] = (img[i+x] - paeth(img[i+x-bpp], 0, 0) +256)&255;
		}
		else {
			if(type==2) { for(var x=  0; x<bpl; x++) data[di+x] = (img[i+x]+256 - img[i+x-bpl])&255;  }
			if(type==3) { for(var x=  0; x<bpp; x++) data[di+x] = (img[i+x]+256 - (img[i+x-bpl]>>1))&255;
						  for(var x=bpp; x<bpl; x++) data[di+x] = (img[i+x]+256 - ((img[i+x-bpl]+img[i+x-bpp])>>1))&255;  }
			if(type==4) { for(var x=  0; x<bpp; x++) data[di+x] = (img[i+x]+256 - paeth(0, img[i+x-bpl], 0))&255;
						  for(var x=bpp; x<bpl; x++) data[di+x] = (img[i+x]+256 - paeth(img[i+x-bpp], img[i+x-bpl], img[i+x-bpp-bpl]))&255;  }
		}
	}
	
	UPNG.crc = {
		table : ( function() {
		   var tab = new Uint32Array(256);
		   for (var n=0; n<256; n++) {
				var c = n;
				for (var k=0; k<8; k++) {
					if (c & 1)  c = 0xedb88320 ^ (c >>> 1);
					else        c = c >>> 1;
				}
				tab[n] = c;  }
			return tab;  })(),
		update : function(c, buf, off, len) {
			for (var i=0; i<len; i++)  c = UPNG.crc.table[(c ^ buf[off+i]) & 0xff] ^ (c >>> 8);
			return c;
		},
		crc : function(b,o,l)  {  return UPNG.crc.update(0xffffffff,b,o,l) ^ 0xffffffff;  }
	}
	
	
	UPNG.quantize = function(bufs, ps, roundAlpha)
	{	
		var imgs = [], totl = 0;
		for(var i=0; i<bufs.length; i++) {  imgs.push(UPNG.encode.alphaMul(new Uint8Array(bufs[i]), roundAlpha));  totl+=bufs[i].byteLength;  }
		
		var nimg = new Uint8Array(totl), nimg32 = new Uint32Array(nimg.buffer), noff=0;
		for(var i=0; i<imgs.length; i++) {
			var img = imgs[i], il = img.length;
			for(var j=0; j<il; j++) nimg[noff+j] = img[j];
			noff += il;
		}
		
		var root = {i0:0, i1:nimg.length, bst:null, est:null, tdst:0, left:null, right:null };  // basic statistic, extra statistic
		root.bst = UPNG.quantize.stats(  nimg,root.i0, root.i1  );  root.est = UPNG.quantize.estats( root.bst );
		var leafs = [root];
		
		while(leafs.length<ps)
		{
			var maxL = 0, mi=0;
			for(var i=0; i<leafs.length; i++) if(leafs[i].est.L > maxL) {  maxL=leafs[i].est.L;  mi=i;  }
			if(maxL<1e-3) break;
			var node = leafs[mi];
			
			var s0 = UPNG.quantize.splitPixels(nimg,nimg32, node.i0, node.i1, node.est.e, node.est.eMq255);
			
			var ln = {i0:node.i0, i1:s0, bst:null, est:null, tdst:0, left:null, right:null };  ln.bst = UPNG.quantize.stats( nimg, ln.i0, ln.i1 );  
			ln.est = UPNG.quantize.estats( ln.bst );
			var rn = {i0:s0, i1:node.i1, bst:null, est:null, tdst:0, left:null, right:null };  rn.bst = {R:[], m:[], N:node.bst.N-ln.bst.N};
			for(var i=0; i<16; i++) rn.bst.R[i] = node.bst.R[i]-ln.bst.R[i];
			for(var i=0; i< 4; i++) rn.bst.m[i] = node.bst.m[i]-ln.bst.m[i];
			rn.est = UPNG.quantize.estats( rn.bst );
			
			node.left = ln;  node.right = rn;
			leafs[mi]=ln;  leafs.push(rn);
		}
		leafs.sort(function(a,b) {  return b.bst.N-a.bst.N;  });
		
		for(var ii=0; ii<imgs.length; ii++) {
			var planeDst = UPNG.quantize.planeDst;
			var sb = new Uint8Array(imgs[ii].buffer), tb = new Uint32Array(imgs[ii].buffer), len = sb.length;
			
			var stack = [], si=0;
			for(var i=0; i<len; i+=4) {
				var r=sb[i]*(1/255), g=sb[i+1]*(1/255), b=sb[i+2]*(1/255), a=sb[i+3]*(1/255);
				
				//  exact, but too slow :(
				//var nd = UPNG.quantize.getNearest(root, r, g, b, a);
				var nd = root;
				while(nd.left) nd = (planeDst(nd.est,r,g,b,a)<=0) ? nd.left : nd.right;
				
				tb[i>>2] = nd.est.rgba;
			}
			imgs[ii]=tb.buffer;
		}
		return {  bufs:imgs, plte:leafs  };
	}
	UPNG.quantize.getNearest = function(nd, r,g,b,a)
	{
		if(nd.left==null) {  nd.tdst = UPNG.quantize.dist(nd.est.q,r,g,b,a);  return nd;  }
		var planeDst = UPNG.quantize.planeDst(nd.est,r,g,b,a);
		
		var node0 = nd.left, node1 = nd.right;
		if(planeDst>0) {  node0=nd.right;  node1=nd.left;  }
		
		var ln = UPNG.quantize.getNearest(node0, r,g,b,a);
		if(ln.tdst<=planeDst*planeDst) return ln;
		var rn = UPNG.quantize.getNearest(node1, r,g,b,a);
		return rn.tdst<ln.tdst ? rn : ln;
	}
	UPNG.quantize.planeDst = function(est, r,g,b,a) {  var e = est.e;  return e[0]*r + e[1]*g + e[2]*b + e[3]*a - est.eMq;  }
	UPNG.quantize.dist     = function(q,   r,g,b,a) {  var d0=r-q[0], d1=g-q[1], d2=b-q[2], d3=a-q[3];  return d0*d0+d1*d1+d2*d2+d3*d3;  }
	
	UPNG.quantize.splitPixels = function(nimg, nimg32, i0, i1, e, eMq)
	{
		var vecDot = UPNG.quantize.vecDot;
		i1-=4;
		var shfs = 0;
		while(i0<i1)
		{
			while(vecDot(nimg, i0, e)<=eMq) i0+=4;
			while(vecDot(nimg, i1, e)> eMq) i1-=4;
			if(i0>=i1) break;
			
			var t = nimg32[i0>>2];  nimg32[i0>>2] = nimg32[i1>>2];  nimg32[i1>>2]=t;
			
			i0+=4;  i1-=4;
		}
		while(vecDot(nimg, i0, e)>eMq) i0-=4;
		return i0+4;
	}
	UPNG.quantize.vecDot = function(nimg, i, e)
	{
		return nimg[i]*e[0] + nimg[i+1]*e[1] + nimg[i+2]*e[2] + nimg[i+3]*e[3];
	}
	UPNG.quantize.stats = function(nimg, i0, i1){
		var R = [0,0,0,0,  0,0,0,0,  0,0,0,0,  0,0,0,0];
		var m = [0,0,0,0];
		var N = (i1-i0)>>2;
		for(var i=i0; i<i1; i+=4)
		{
			var r = nimg[i]*(1/255), g = nimg[i+1]*(1/255), b = nimg[i+2]*(1/255), a = nimg[i+3]*(1/255);
			//var r = nimg[i], g = nimg[i+1], b = nimg[i+2], a = nimg[i+3];
			m[0]+=r;  m[1]+=g;  m[2]+=b;  m[3]+=a;
			
			R[ 0] += r*r;  R[ 1] += r*g;  R[ 2] += r*b;  R[ 3] += r*a;  
			               R[ 5] += g*g;  R[ 6] += g*b;  R[ 7] += g*a; 
			                              R[10] += b*b;  R[11] += b*a;  
			                                             R[15] += a*a;  
		}
		R[4]=R[1];  R[8]=R[2];  R[12]=R[3];  R[9]=R[6];  R[13]=R[7];  R[14]=R[11];
		
		return {R:R, m:m, N:N};
	}
	UPNG.quantize.estats = function(stats){
		var R = stats.R, m = stats.m, N = stats.N;
		
		var m0 = m[0], m1 = m[1], m2 = m[2], m3 = m[3], iN = (N==0 ? 0 : 1/N);
		var Rj = [
			R[ 0] - m0*m0*iN,  R[ 1] - m0*m1*iN,  R[ 2] - m0*m2*iN,  R[ 3] - m0*m3*iN,  
			R[ 4] - m1*m0*iN,  R[ 5] - m1*m1*iN,  R[ 6] - m1*m2*iN,  R[ 7] - m1*m3*iN,
			R[ 8] - m2*m0*iN,  R[ 9] - m2*m1*iN,  R[10] - m2*m2*iN,  R[11] - m2*m3*iN,  
			R[12] - m3*m0*iN,  R[13] - m3*m1*iN,  R[14] - m3*m2*iN,  R[15] - m3*m3*iN 
		];
		
		var A = Rj, M = UPNG.M4;
		var b = [0.5,0.5,0.5,0.5], mi = 0, tmi = 0;
		
		if(N!=0)
		for(var i=0; i<10; i++) {
			b = M.multVec(A, b);  tmi = Math.sqrt(M.dot(b,b));  b = M.sml(1/tmi,  b);
			if(Math.abs(tmi-mi)<1e-9) break;  mi = tmi;
		}	
		//b = [0,0,1,0];  mi=N;
		var q = [m0*iN, m1*iN, m2*iN, m3*iN];
		var eMq255 = M.dot(M.sml(255,q),b);
		
		var ia = (q[3]<0.001) ? 0 : 1/q[3];
		
		return {  Cov:Rj, q:q, e:b, L:mi,  eMq255:eMq255, eMq : M.dot(b,q),
					rgba: (((Math.round(255*q[3])<<24) | (Math.round(255*q[2]*ia)<<16) |  (Math.round(255*q[1]*ia)<<8) | (Math.round(255*q[0]*ia)<<0))>>>0)  };
	}
	UPNG.M4 = {
		multVec : function(m,v) {
				return [
					m[ 0]*v[0] + m[ 1]*v[1] + m[ 2]*v[2] + m[ 3]*v[3],
					m[ 4]*v[0] + m[ 5]*v[1] + m[ 6]*v[2] + m[ 7]*v[3],
					m[ 8]*v[0] + m[ 9]*v[1] + m[10]*v[2] + m[11]*v[3],
					m[12]*v[0] + m[13]*v[1] + m[14]*v[2] + m[15]*v[3]
				];
		},
		dot : function(x,y) {  return  x[0]*y[0]+x[1]*y[1]+x[2]*y[2]+x[3]*y[3];  },
		sml : function(a,y) {  return [a*y[0],a*y[1],a*y[2],a*y[3]];  }
	}
	
	UPNG.encode.alphaMul = function(img, roundA) {
		var nimg = new Uint8Array(img.length), area = img.length>>2; 
		for(var i=0; i<area; i++) {
			var qi=i<<2, ia=img[qi+3];   
			if(roundA) ia = ((ia<128))?0:255;
			var a = ia*(1/255);
			nimg[qi+0] = img[qi+0]*a;  nimg[qi+1] = img[qi+1]*a;  nimg[qi+2] = img[qi+2]*a;  nimg[qi+3] = ia;
		}
		return nimg;
	}
	
		
		
		
		
		
	
	
	})(UPNG, pako);
	})();


/***/ }),
/* 4 */
/***/ (function(module, exports, __webpack_require__) {

	/*! pako 2.1.0 https://github.com/nodeca/pako @license (MIT AND Zlib) */
	!function(e,t){ true?t(exports):"function"==typeof define&&define.amd?define(["exports"],t):t((e="undefined"!=typeof globalThis?globalThis:e||self).pako={})}(this,(function(e){"use strict";var t=(e,t,i,n)=>{let a=65535&e|0,r=e>>>16&65535|0,o=0;for(;0!==i;){o=i>2e3?2e3:i,i-=o;do{a=a+t[n++]|0,r=r+a|0}while(--o);a%=65521,r%=65521}return a|r<<16|0};const i=new Uint32Array((()=>{let e,t=[];for(var i=0;i<256;i++){e=i;for(var n=0;n<8;n++)e=1&e?3988292384^e>>>1:e>>>1;t[i]=e}return t})());var n=(e,t,n,a)=>{const r=i,o=a+n;e^=-1;for(let i=a;i<o;i++)e=e>>>8^r[255&(e^t[i])];return-1^e};const a=16209;var r=function(e,t){let i,n,r,o,s,l,d,f,c,h,u,w,b,m,k,_,g,p,v,x,y,E,R,A;const Z=e.state;i=e.next_in,R=e.input,n=i+(e.avail_in-5),r=e.next_out,A=e.output,o=r-(t-e.avail_out),s=r+(e.avail_out-257),l=Z.dmax,d=Z.wsize,f=Z.whave,c=Z.wnext,h=Z.window,u=Z.hold,w=Z.bits,b=Z.lencode,m=Z.distcode,k=(1<<Z.lenbits)-1,_=(1<<Z.distbits)-1;e:do{w<15&&(u+=R[i++]<<w,w+=8,u+=R[i++]<<w,w+=8),g=b[u&k];t:for(;;){if(p=g>>>24,u>>>=p,w-=p,p=g>>>16&255,0===p)A[r++]=65535&g;else{if(!(16&p)){if(0==(64&p)){g=b[(65535&g)+(u&(1<<p)-1)];continue t}if(32&p){Z.mode=16191;break e}e.msg="invalid literal/length code",Z.mode=a;break e}v=65535&g,p&=15,p&&(w<p&&(u+=R[i++]<<w,w+=8),v+=u&(1<<p)-1,u>>>=p,w-=p),w<15&&(u+=R[i++]<<w,w+=8,u+=R[i++]<<w,w+=8),g=m[u&_];i:for(;;){if(p=g>>>24,u>>>=p,w-=p,p=g>>>16&255,!(16&p)){if(0==(64&p)){g=m[(65535&g)+(u&(1<<p)-1)];continue i}e.msg="invalid distance code",Z.mode=a;break e}if(x=65535&g,p&=15,w<p&&(u+=R[i++]<<w,w+=8,w<p&&(u+=R[i++]<<w,w+=8)),x+=u&(1<<p)-1,x>l){e.msg="invalid distance too far back",Z.mode=a;break e}if(u>>>=p,w-=p,p=r-o,x>p){if(p=x-p,p>f&&Z.sane){e.msg="invalid distance too far back",Z.mode=a;break e}if(y=0,E=h,0===c){if(y+=d-p,p<v){v-=p;do{A[r++]=h[y++]}while(--p);y=r-x,E=A}}else if(c<p){if(y+=d+c-p,p-=c,p<v){v-=p;do{A[r++]=h[y++]}while(--p);if(y=0,c<v){p=c,v-=p;do{A[r++]=h[y++]}while(--p);y=r-x,E=A}}}else if(y+=c-p,p<v){v-=p;do{A[r++]=h[y++]}while(--p);y=r-x,E=A}for(;v>2;)A[r++]=E[y++],A[r++]=E[y++],A[r++]=E[y++],v-=3;v&&(A[r++]=E[y++],v>1&&(A[r++]=E[y++]))}else{y=r-x;do{A[r++]=A[y++],A[r++]=A[y++],A[r++]=A[y++],v-=3}while(v>2);v&&(A[r++]=A[y++],v>1&&(A[r++]=A[y++]))}break}}break}}while(i<n&&r<s);v=w>>3,i-=v,w-=v<<3,u&=(1<<w)-1,e.next_in=i,e.next_out=r,e.avail_in=i<n?n-i+5:5-(i-n),e.avail_out=r<s?s-r+257:257-(r-s),Z.hold=u,Z.bits=w};const o=15,s=new Uint16Array([3,4,5,6,7,8,9,10,11,13,15,17,19,23,27,31,35,43,51,59,67,83,99,115,131,163,195,227,258,0,0]),l=new Uint8Array([16,16,16,16,16,16,16,16,17,17,17,17,18,18,18,18,19,19,19,19,20,20,20,20,21,21,21,21,16,72,78]),d=new Uint16Array([1,2,3,4,5,7,9,13,17,25,33,49,65,97,129,193,257,385,513,769,1025,1537,2049,3073,4097,6145,8193,12289,16385,24577,0,0]),f=new Uint8Array([16,16,16,16,17,17,18,18,19,19,20,20,21,21,22,22,23,23,24,24,25,25,26,26,27,27,28,28,29,29,64,64]);var c=(e,t,i,n,a,r,c,h)=>{const u=h.bits;let w,b,m,k,_,g,p=0,v=0,x=0,y=0,E=0,R=0,A=0,Z=0,S=0,T=0,O=null;const U=new Uint16Array(16),D=new Uint16Array(16);let I,B,N,C=null;for(p=0;p<=o;p++)U[p]=0;for(v=0;v<n;v++)U[t[i+v]]++;for(E=u,y=o;y>=1&&0===U[y];y--);if(E>y&&(E=y),0===y)return a[r++]=20971520,a[r++]=20971520,h.bits=1,0;for(x=1;x<y&&0===U[x];x++);for(E<x&&(E=x),Z=1,p=1;p<=o;p++)if(Z<<=1,Z-=U[p],Z<0)return-1;if(Z>0&&(0===e||1!==y))return-1;for(D[1]=0,p=1;p<o;p++)D[p+1]=D[p]+U[p];for(v=0;v<n;v++)0!==t[i+v]&&(c[D[t[i+v]]++]=v);if(0===e?(O=C=c,g=20):1===e?(O=s,C=l,g=257):(O=d,C=f,g=0),T=0,v=0,p=x,_=r,R=E,A=0,m=-1,S=1<<E,k=S-1,1===e&&S>852||2===e&&S>592)return 1;for(;;){I=p-A,c[v]+1<g?(B=0,N=c[v]):c[v]>=g?(B=C[c[v]-g],N=O[c[v]-g]):(B=96,N=0),w=1<<p-A,b=1<<R,x=b;do{b-=w,a[_+(T>>A)+b]=I<<24|B<<16|N|0}while(0!==b);for(w=1<<p-1;T&w;)w>>=1;if(0!==w?(T&=w-1,T+=w):T=0,v++,0==--U[p]){if(p===y)break;p=t[i+c[v]]}if(p>E&&(T&k)!==m){for(0===A&&(A=E),_+=x,R=p-A,Z=1<<R;R+A<y&&(Z-=U[R+A],!(Z<=0));)R++,Z<<=1;if(S+=1<<R,1===e&&S>852||2===e&&S>592)return 1;m=T&k,a[m]=E<<24|R<<16|_-r|0}}return 0!==T&&(a[_+T]=p-A<<24|64<<16|0),h.bits=E,0},h={Z_NO_FLUSH:0,Z_PARTIAL_FLUSH:1,Z_SYNC_FLUSH:2,Z_FULL_FLUSH:3,Z_FINISH:4,Z_BLOCK:5,Z_TREES:6,Z_OK:0,Z_STREAM_END:1,Z_NEED_DICT:2,Z_ERRNO:-1,Z_STREAM_ERROR:-2,Z_DATA_ERROR:-3,Z_MEM_ERROR:-4,Z_BUF_ERROR:-5,Z_NO_COMPRESSION:0,Z_BEST_SPEED:1,Z_BEST_COMPRESSION:9,Z_DEFAULT_COMPRESSION:-1,Z_FILTERED:1,Z_HUFFMAN_ONLY:2,Z_RLE:3,Z_FIXED:4,Z_DEFAULT_STRATEGY:0,Z_BINARY:0,Z_TEXT:1,Z_UNKNOWN:2,Z_DEFLATED:8};const{Z_FINISH:u,Z_BLOCK:w,Z_TREES:b,Z_OK:m,Z_STREAM_END:k,Z_NEED_DICT:_,Z_STREAM_ERROR:g,Z_DATA_ERROR:p,Z_MEM_ERROR:v,Z_BUF_ERROR:x,Z_DEFLATED:y}=h,E=16180,R=16190,A=16191,Z=16192,S=16194,T=16199,O=16200,U=16206,D=16209,I=e=>(e>>>24&255)+(e>>>8&65280)+((65280&e)<<8)+((255&e)<<24);function B(){this.strm=null,this.mode=0,this.last=!1,this.wrap=0,this.havedict=!1,this.flags=0,this.dmax=0,this.check=0,this.total=0,this.head=null,this.wbits=0,this.wsize=0,this.whave=0,this.wnext=0,this.window=null,this.hold=0,this.bits=0,this.length=0,this.offset=0,this.extra=0,this.lencode=null,this.distcode=null,this.lenbits=0,this.distbits=0,this.ncode=0,this.nlen=0,this.ndist=0,this.have=0,this.next=null,this.lens=new Uint16Array(320),this.work=new Uint16Array(288),this.lendyn=null,this.distdyn=null,this.sane=0,this.back=0,this.was=0}const N=e=>{if(!e)return 1;const t=e.state;return!t||t.strm!==e||t.mode<E||t.mode>16211?1:0},C=e=>{if(N(e))return g;const t=e.state;return e.total_in=e.total_out=t.total=0,e.msg="",t.wrap&&(e.adler=1&t.wrap),t.mode=E,t.last=0,t.havedict=0,t.flags=-1,t.dmax=32768,t.head=null,t.hold=0,t.bits=0,t.lencode=t.lendyn=new Int32Array(852),t.distcode=t.distdyn=new Int32Array(592),t.sane=1,t.back=-1,m},z=e=>{if(N(e))return g;const t=e.state;return t.wsize=0,t.whave=0,t.wnext=0,C(e)},F=(e,t)=>{let i;if(N(e))return g;const n=e.state;return t<0?(i=0,t=-t):(i=5+(t>>4),t<48&&(t&=15)),t&&(t<8||t>15)?g:(null!==n.window&&n.wbits!==t&&(n.window=null),n.wrap=i,n.wbits=t,z(e))},L=(e,t)=>{if(!e)return g;const i=new B;e.state=i,i.strm=e,i.window=null,i.mode=E;const n=F(e,t);return n!==m&&(e.state=null),n};let M,H,j=!0;const K=e=>{if(j){M=new Int32Array(512),H=new Int32Array(32);let t=0;for(;t<144;)e.lens[t++]=8;for(;t<256;)e.lens[t++]=9;for(;t<280;)e.lens[t++]=7;for(;t<288;)e.lens[t++]=8;for(c(1,e.lens,0,288,M,0,e.work,{bits:9}),t=0;t<32;)e.lens[t++]=5;c(2,e.lens,0,32,H,0,e.work,{bits:5}),j=!1}e.lencode=M,e.lenbits=9,e.distcode=H,e.distbits=5},P=(e,t,i,n)=>{let a;const r=e.state;return null===r.window&&(r.wsize=1<<r.wbits,r.wnext=0,r.whave=0,r.window=new Uint8Array(r.wsize)),n>=r.wsize?(r.window.set(t.subarray(i-r.wsize,i),0),r.wnext=0,r.whave=r.wsize):(a=r.wsize-r.wnext,a>n&&(a=n),r.window.set(t.subarray(i-n,i-n+a),r.wnext),(n-=a)?(r.window.set(t.subarray(i-n,i),0),r.wnext=n,r.whave=r.wsize):(r.wnext+=a,r.wnext===r.wsize&&(r.wnext=0),r.whave<r.wsize&&(r.whave+=a))),0};var Y={inflateReset:z,inflateReset2:F,inflateResetKeep:C,inflateInit:e=>L(e,15),inflateInit2:L,inflate:(e,i)=>{let a,o,s,l,d,f,h,B,C,z,F,L,M,H,j,Y,G,X,W,q,J,Q,V=0;const $=new Uint8Array(4);let ee,te;const ie=new Uint8Array([16,17,18,0,8,7,9,6,10,5,11,4,12,3,13,2,14,1,15]);if(N(e)||!e.output||!e.input&&0!==e.avail_in)return g;a=e.state,a.mode===A&&(a.mode=Z),d=e.next_out,s=e.output,h=e.avail_out,l=e.next_in,o=e.input,f=e.avail_in,B=a.hold,C=a.bits,z=f,F=h,Q=m;e:for(;;)switch(a.mode){case E:if(0===a.wrap){a.mode=Z;break}for(;C<16;){if(0===f)break e;f--,B+=o[l++]<<C,C+=8}if(2&a.wrap&&35615===B){0===a.wbits&&(a.wbits=15),a.check=0,$[0]=255&B,$[1]=B>>>8&255,a.check=n(a.check,$,2,0),B=0,C=0,a.mode=16181;break}if(a.head&&(a.head.done=!1),!(1&a.wrap)||(((255&B)<<8)+(B>>8))%31){e.msg="incorrect header check",a.mode=D;break}if((15&B)!==y){e.msg="unknown compression method",a.mode=D;break}if(B>>>=4,C-=4,J=8+(15&B),0===a.wbits&&(a.wbits=J),J>15||J>a.wbits){e.msg="invalid window size",a.mode=D;break}a.dmax=1<<a.wbits,a.flags=0,e.adler=a.check=1,a.mode=512&B?16189:A,B=0,C=0;break;case 16181:for(;C<16;){if(0===f)break e;f--,B+=o[l++]<<C,C+=8}if(a.flags=B,(255&a.flags)!==y){e.msg="unknown compression method",a.mode=D;break}if(57344&a.flags){e.msg="unknown header flags set",a.mode=D;break}a.head&&(a.head.text=B>>8&1),512&a.flags&&4&a.wrap&&($[0]=255&B,$[1]=B>>>8&255,a.check=n(a.check,$,2,0)),B=0,C=0,a.mode=16182;case 16182:for(;C<32;){if(0===f)break e;f--,B+=o[l++]<<C,C+=8}a.head&&(a.head.time=B),512&a.flags&&4&a.wrap&&($[0]=255&B,$[1]=B>>>8&255,$[2]=B>>>16&255,$[3]=B>>>24&255,a.check=n(a.check,$,4,0)),B=0,C=0,a.mode=16183;case 16183:for(;C<16;){if(0===f)break e;f--,B+=o[l++]<<C,C+=8}a.head&&(a.head.xflags=255&B,a.head.os=B>>8),512&a.flags&&4&a.wrap&&($[0]=255&B,$[1]=B>>>8&255,a.check=n(a.check,$,2,0)),B=0,C=0,a.mode=16184;case 16184:if(1024&a.flags){for(;C<16;){if(0===f)break e;f--,B+=o[l++]<<C,C+=8}a.length=B,a.head&&(a.head.extra_len=B),512&a.flags&&4&a.wrap&&($[0]=255&B,$[1]=B>>>8&255,a.check=n(a.check,$,2,0)),B=0,C=0}else a.head&&(a.head.extra=null);a.mode=16185;case 16185:if(1024&a.flags&&(L=a.length,L>f&&(L=f),L&&(a.head&&(J=a.head.extra_len-a.length,a.head.extra||(a.head.extra=new Uint8Array(a.head.extra_len)),a.head.extra.set(o.subarray(l,l+L),J)),512&a.flags&&4&a.wrap&&(a.check=n(a.check,o,L,l)),f-=L,l+=L,a.length-=L),a.length))break e;a.length=0,a.mode=16186;case 16186:if(2048&a.flags){if(0===f)break e;L=0;do{J=o[l+L++],a.head&&J&&a.length<65536&&(a.head.name+=String.fromCharCode(J))}while(J&&L<f);if(512&a.flags&&4&a.wrap&&(a.check=n(a.check,o,L,l)),f-=L,l+=L,J)break e}else a.head&&(a.head.name=null);a.length=0,a.mode=16187;case 16187:if(4096&a.flags){if(0===f)break e;L=0;do{J=o[l+L++],a.head&&J&&a.length<65536&&(a.head.comment+=String.fromCharCode(J))}while(J&&L<f);if(512&a.flags&&4&a.wrap&&(a.check=n(a.check,o,L,l)),f-=L,l+=L,J)break e}else a.head&&(a.head.comment=null);a.mode=16188;case 16188:if(512&a.flags){for(;C<16;){if(0===f)break e;f--,B+=o[l++]<<C,C+=8}if(4&a.wrap&&B!==(65535&a.check)){e.msg="header crc mismatch",a.mode=D;break}B=0,C=0}a.head&&(a.head.hcrc=a.flags>>9&1,a.head.done=!0),e.adler=a.check=0,a.mode=A;break;case 16189:for(;C<32;){if(0===f)break e;f--,B+=o[l++]<<C,C+=8}e.adler=a.check=I(B),B=0,C=0,a.mode=R;case R:if(0===a.havedict)return e.next_out=d,e.avail_out=h,e.next_in=l,e.avail_in=f,a.hold=B,a.bits=C,_;e.adler=a.check=1,a.mode=A;case A:if(i===w||i===b)break e;case Z:if(a.last){B>>>=7&C,C-=7&C,a.mode=U;break}for(;C<3;){if(0===f)break e;f--,B+=o[l++]<<C,C+=8}switch(a.last=1&B,B>>>=1,C-=1,3&B){case 0:a.mode=16193;break;case 1:if(K(a),a.mode=T,i===b){B>>>=2,C-=2;break e}break;case 2:a.mode=16196;break;case 3:e.msg="invalid block type",a.mode=D}B>>>=2,C-=2;break;case 16193:for(B>>>=7&C,C-=7&C;C<32;){if(0===f)break e;f--,B+=o[l++]<<C,C+=8}if((65535&B)!=(B>>>16^65535)){e.msg="invalid stored block lengths",a.mode=D;break}if(a.length=65535&B,B=0,C=0,a.mode=S,i===b)break e;case S:a.mode=16195;case 16195:if(L=a.length,L){if(L>f&&(L=f),L>h&&(L=h),0===L)break e;s.set(o.subarray(l,l+L),d),f-=L,l+=L,h-=L,d+=L,a.length-=L;break}a.mode=A;break;case 16196:for(;C<14;){if(0===f)break e;f--,B+=o[l++]<<C,C+=8}if(a.nlen=257+(31&B),B>>>=5,C-=5,a.ndist=1+(31&B),B>>>=5,C-=5,a.ncode=4+(15&B),B>>>=4,C-=4,a.nlen>286||a.ndist>30){e.msg="too many length or distance symbols",a.mode=D;break}a.have=0,a.mode=16197;case 16197:for(;a.have<a.ncode;){for(;C<3;){if(0===f)break e;f--,B+=o[l++]<<C,C+=8}a.lens[ie[a.have++]]=7&B,B>>>=3,C-=3}for(;a.have<19;)a.lens[ie[a.have++]]=0;if(a.lencode=a.lendyn,a.lenbits=7,ee={bits:a.lenbits},Q=c(0,a.lens,0,19,a.lencode,0,a.work,ee),a.lenbits=ee.bits,Q){e.msg="invalid code lengths set",a.mode=D;break}a.have=0,a.mode=16198;case 16198:for(;a.have<a.nlen+a.ndist;){for(;V=a.lencode[B&(1<<a.lenbits)-1],j=V>>>24,Y=V>>>16&255,G=65535&V,!(j<=C);){if(0===f)break e;f--,B+=o[l++]<<C,C+=8}if(G<16)B>>>=j,C-=j,a.lens[a.have++]=G;else{if(16===G){for(te=j+2;C<te;){if(0===f)break e;f--,B+=o[l++]<<C,C+=8}if(B>>>=j,C-=j,0===a.have){e.msg="invalid bit length repeat",a.mode=D;break}J=a.lens[a.have-1],L=3+(3&B),B>>>=2,C-=2}else if(17===G){for(te=j+3;C<te;){if(0===f)break e;f--,B+=o[l++]<<C,C+=8}B>>>=j,C-=j,J=0,L=3+(7&B),B>>>=3,C-=3}else{for(te=j+7;C<te;){if(0===f)break e;f--,B+=o[l++]<<C,C+=8}B>>>=j,C-=j,J=0,L=11+(127&B),B>>>=7,C-=7}if(a.have+L>a.nlen+a.ndist){e.msg="invalid bit length repeat",a.mode=D;break}for(;L--;)a.lens[a.have++]=J}}if(a.mode===D)break;if(0===a.lens[256]){e.msg="invalid code -- missing end-of-block",a.mode=D;break}if(a.lenbits=9,ee={bits:a.lenbits},Q=c(1,a.lens,0,a.nlen,a.lencode,0,a.work,ee),a.lenbits=ee.bits,Q){e.msg="invalid literal/lengths set",a.mode=D;break}if(a.distbits=6,a.distcode=a.distdyn,ee={bits:a.distbits},Q=c(2,a.lens,a.nlen,a.ndist,a.distcode,0,a.work,ee),a.distbits=ee.bits,Q){e.msg="invalid distances set",a.mode=D;break}if(a.mode=T,i===b)break e;case T:a.mode=O;case O:if(f>=6&&h>=258){e.next_out=d,e.avail_out=h,e.next_in=l,e.avail_in=f,a.hold=B,a.bits=C,r(e,F),d=e.next_out,s=e.output,h=e.avail_out,l=e.next_in,o=e.input,f=e.avail_in,B=a.hold,C=a.bits,a.mode===A&&(a.back=-1);break}for(a.back=0;V=a.lencode[B&(1<<a.lenbits)-1],j=V>>>24,Y=V>>>16&255,G=65535&V,!(j<=C);){if(0===f)break e;f--,B+=o[l++]<<C,C+=8}if(Y&&0==(240&Y)){for(X=j,W=Y,q=G;V=a.lencode[q+((B&(1<<X+W)-1)>>X)],j=V>>>24,Y=V>>>16&255,G=65535&V,!(X+j<=C);){if(0===f)break e;f--,B+=o[l++]<<C,C+=8}B>>>=X,C-=X,a.back+=X}if(B>>>=j,C-=j,a.back+=j,a.length=G,0===Y){a.mode=16205;break}if(32&Y){a.back=-1,a.mode=A;break}if(64&Y){e.msg="invalid literal/length code",a.mode=D;break}a.extra=15&Y,a.mode=16201;case 16201:if(a.extra){for(te=a.extra;C<te;){if(0===f)break e;f--,B+=o[l++]<<C,C+=8}a.length+=B&(1<<a.extra)-1,B>>>=a.extra,C-=a.extra,a.back+=a.extra}a.was=a.length,a.mode=16202;case 16202:for(;V=a.distcode[B&(1<<a.distbits)-1],j=V>>>24,Y=V>>>16&255,G=65535&V,!(j<=C);){if(0===f)break e;f--,B+=o[l++]<<C,C+=8}if(0==(240&Y)){for(X=j,W=Y,q=G;V=a.distcode[q+((B&(1<<X+W)-1)>>X)],j=V>>>24,Y=V>>>16&255,G=65535&V,!(X+j<=C);){if(0===f)break e;f--,B+=o[l++]<<C,C+=8}B>>>=X,C-=X,a.back+=X}if(B>>>=j,C-=j,a.back+=j,64&Y){e.msg="invalid distance code",a.mode=D;break}a.offset=G,a.extra=15&Y,a.mode=16203;case 16203:if(a.extra){for(te=a.extra;C<te;){if(0===f)break e;f--,B+=o[l++]<<C,C+=8}a.offset+=B&(1<<a.extra)-1,B>>>=a.extra,C-=a.extra,a.back+=a.extra}if(a.offset>a.dmax){e.msg="invalid distance too far back",a.mode=D;break}a.mode=16204;case 16204:if(0===h)break e;if(L=F-h,a.offset>L){if(L=a.offset-L,L>a.whave&&a.sane){e.msg="invalid distance too far back",a.mode=D;break}L>a.wnext?(L-=a.wnext,M=a.wsize-L):M=a.wnext-L,L>a.length&&(L=a.length),H=a.window}else H=s,M=d-a.offset,L=a.length;L>h&&(L=h),h-=L,a.length-=L;do{s[d++]=H[M++]}while(--L);0===a.length&&(a.mode=O);break;case 16205:if(0===h)break e;s[d++]=a.length,h--,a.mode=O;break;case U:if(a.wrap){for(;C<32;){if(0===f)break e;f--,B|=o[l++]<<C,C+=8}if(F-=h,e.total_out+=F,a.total+=F,4&a.wrap&&F&&(e.adler=a.check=a.flags?n(a.check,s,F,d-F):t(a.check,s,F,d-F)),F=h,4&a.wrap&&(a.flags?B:I(B))!==a.check){e.msg="incorrect data check",a.mode=D;break}B=0,C=0}a.mode=16207;case 16207:if(a.wrap&&a.flags){for(;C<32;){if(0===f)break e;f--,B+=o[l++]<<C,C+=8}if(4&a.wrap&&B!==(4294967295&a.total)){e.msg="incorrect length check",a.mode=D;break}B=0,C=0}a.mode=16208;case 16208:Q=k;break e;case D:Q=p;break e;case 16210:return v;default:return g}return e.next_out=d,e.avail_out=h,e.next_in=l,e.avail_in=f,a.hold=B,a.bits=C,(a.wsize||F!==e.avail_out&&a.mode<D&&(a.mode<U||i!==u))&&P(e,e.output,e.next_out,F-e.avail_out),z-=e.avail_in,F-=e.avail_out,e.total_in+=z,e.total_out+=F,a.total+=F,4&a.wrap&&F&&(e.adler=a.check=a.flags?n(a.check,s,F,e.next_out-F):t(a.check,s,F,e.next_out-F)),e.data_type=a.bits+(a.last?64:0)+(a.mode===A?128:0)+(a.mode===T||a.mode===S?256:0),(0===z&&0===F||i===u)&&Q===m&&(Q=x),Q},inflateEnd:e=>{if(N(e))return g;let t=e.state;return t.window&&(t.window=null),e.state=null,m},inflateGetHeader:(e,t)=>{if(N(e))return g;const i=e.state;return 0==(2&i.wrap)?g:(i.head=t,t.done=!1,m)},inflateSetDictionary:(e,i)=>{const n=i.length;let a,r,o;return N(e)?g:(a=e.state,0!==a.wrap&&a.mode!==R?g:a.mode===R&&(r=1,r=t(r,i,n,0),r!==a.check)?p:(o=P(e,i,n,n),o?(a.mode=16210,v):(a.havedict=1,m)))},inflateInfo:"pako inflate (from Nodeca project)"};const G=(e,t)=>Object.prototype.hasOwnProperty.call(e,t);var X=function(e){const t=Array.prototype.slice.call(arguments,1);for(;t.length;){const i=t.shift();if(i){if("object"!=typeof i)throw new TypeError(i+"must be non-object");for(const t in i)G(i,t)&&(e[t]=i[t])}}return e},W=e=>{let t=0;for(let i=0,n=e.length;i<n;i++)t+=e[i].length;const i=new Uint8Array(t);for(let t=0,n=0,a=e.length;t<a;t++){let a=e[t];i.set(a,n),n+=a.length}return i};let q=!0;try{String.fromCharCode.apply(null,new Uint8Array(1))}catch(e){q=!1}const J=new Uint8Array(256);for(let e=0;e<256;e++)J[e]=e>=252?6:e>=248?5:e>=240?4:e>=224?3:e>=192?2:1;J[254]=J[254]=1;var Q=e=>{if("function"==typeof TextEncoder&&TextEncoder.prototype.encode)return(new TextEncoder).encode(e);let t,i,n,a,r,o=e.length,s=0;for(a=0;a<o;a++)i=e.charCodeAt(a),55296==(64512&i)&&a+1<o&&(n=e.charCodeAt(a+1),56320==(64512&n)&&(i=65536+(i-55296<<10)+(n-56320),a++)),s+=i<128?1:i<2048?2:i<65536?3:4;for(t=new Uint8Array(s),r=0,a=0;r<s;a++)i=e.charCodeAt(a),55296==(64512&i)&&a+1<o&&(n=e.charCodeAt(a+1),56320==(64512&n)&&(i=65536+(i-55296<<10)+(n-56320),a++)),i<128?t[r++]=i:i<2048?(t[r++]=192|i>>>6,t[r++]=128|63&i):i<65536?(t[r++]=224|i>>>12,t[r++]=128|i>>>6&63,t[r++]=128|63&i):(t[r++]=240|i>>>18,t[r++]=128|i>>>12&63,t[r++]=128|i>>>6&63,t[r++]=128|63&i);return t},V=(e,t)=>{const i=t||e.length;if("function"==typeof TextDecoder&&TextDecoder.prototype.decode)return(new TextDecoder).decode(e.subarray(0,t));let n,a;const r=new Array(2*i);for(a=0,n=0;n<i;){let t=e[n++];if(t<128){r[a++]=t;continue}let o=J[t];if(o>4)r[a++]=65533,n+=o-1;else{for(t&=2===o?31:3===o?15:7;o>1&&n<i;)t=t<<6|63&e[n++],o--;o>1?r[a++]=65533:t<65536?r[a++]=t:(t-=65536,r[a++]=55296|t>>10&1023,r[a++]=56320|1023&t)}}return((e,t)=>{if(t<65534&&e.subarray&&q)return String.fromCharCode.apply(null,e.length===t?e:e.subarray(0,t));let i="";for(let n=0;n<t;n++)i+=String.fromCharCode(e[n]);return i})(r,a)},$=(e,t)=>{(t=t||e.length)>e.length&&(t=e.length);let i=t-1;for(;i>=0&&128==(192&e[i]);)i--;return i<0||0===i?t:i+J[e[i]]>t?i:t},ee={2:"need dictionary",1:"stream end",0:"","-1":"file error","-2":"stream error","-3":"data error","-4":"insufficient memory","-5":"buffer error","-6":"incompatible version"};var te=function(){this.input=null,this.next_in=0,this.avail_in=0,this.total_in=0,this.output=null,this.next_out=0,this.avail_out=0,this.total_out=0,this.msg="",this.state=null,this.data_type=2,this.adler=0};var ie=function(){this.text=0,this.time=0,this.xflags=0,this.os=0,this.extra=null,this.extra_len=0,this.name="",this.comment="",this.hcrc=0,this.done=!1};const ne=Object.prototype.toString,{Z_NO_FLUSH:ae,Z_FINISH:re,Z_OK:oe,Z_STREAM_END:se,Z_NEED_DICT:le,Z_STREAM_ERROR:de,Z_DATA_ERROR:fe,Z_MEM_ERROR:ce}=h;function he(e){this.options=X({chunkSize:65536,windowBits:15,to:""},e||{});const t=this.options;t.raw&&t.windowBits>=0&&t.windowBits<16&&(t.windowBits=-t.windowBits,0===t.windowBits&&(t.windowBits=-15)),!(t.windowBits>=0&&t.windowBits<16)||e&&e.windowBits||(t.windowBits+=32),t.windowBits>15&&t.windowBits<48&&0==(15&t.windowBits)&&(t.windowBits|=15),this.err=0,this.msg="",this.ended=!1,this.chunks=[],this.strm=new te,this.strm.avail_out=0;let i=Y.inflateInit2(this.strm,t.windowBits);if(i!==oe)throw new Error(ee[i]);if(this.header=new ie,Y.inflateGetHeader(this.strm,this.header),t.dictionary&&("string"==typeof t.dictionary?t.dictionary=Q(t.dictionary):"[object ArrayBuffer]"===ne.call(t.dictionary)&&(t.dictionary=new Uint8Array(t.dictionary)),t.raw&&(i=Y.inflateSetDictionary(this.strm,t.dictionary),i!==oe)))throw new Error(ee[i])}function ue(e,t){const i=new he(t);if(i.push(e),i.err)throw i.msg||ee[i.err];return i.result}he.prototype.push=function(e,t){const i=this.strm,n=this.options.chunkSize,a=this.options.dictionary;let r,o,s;if(this.ended)return!1;for(o=t===~~t?t:!0===t?re:ae,"[object ArrayBuffer]"===ne.call(e)?i.input=new Uint8Array(e):i.input=e,i.next_in=0,i.avail_in=i.input.length;;){for(0===i.avail_out&&(i.output=new Uint8Array(n),i.next_out=0,i.avail_out=n),r=Y.inflate(i,o),r===le&&a&&(r=Y.inflateSetDictionary(i,a),r===oe?r=Y.inflate(i,o):r===fe&&(r=le));i.avail_in>0&&r===se&&i.state.wrap>0&&0!==e[i.next_in];)Y.inflateReset(i),r=Y.inflate(i,o);switch(r){case de:case fe:case le:case ce:return this.onEnd(r),this.ended=!0,!1}if(s=i.avail_out,i.next_out&&(0===i.avail_out||r===se))if("string"===this.options.to){let e=$(i.output,i.next_out),t=i.next_out-e,a=V(i.output,e);i.next_out=t,i.avail_out=n-t,t&&i.output.set(i.output.subarray(e,e+t),0),this.onData(a)}else this.onData(i.output.length===i.next_out?i.output:i.output.subarray(0,i.next_out));if(r!==oe||0!==s){if(r===se)return r=Y.inflateEnd(this.strm),this.onEnd(r),this.ended=!0,!0;if(0===i.avail_in)break}}return!0},he.prototype.onData=function(e){this.chunks.push(e)},he.prototype.onEnd=function(e){e===oe&&("string"===this.options.to?this.result=this.chunks.join(""):this.result=W(this.chunks)),this.chunks=[],this.err=e,this.msg=this.strm.msg};var we=he,be=ue,me=function(e,t){return(t=t||{}).raw=!0,ue(e,t)},ke=ue,_e=h,ge={Inflate:we,inflate:be,inflateRaw:me,ungzip:ke,constants:_e};e.Inflate=we,e.constants=_e,e.default=ge,e.inflate=be,e.inflateRaw=me,e.ungzip=ke,Object.defineProperty(e,"__esModule",{value:!0})}));


/***/ })
/******/ ]);
//# sourceMappingURL=pebble-js-app.js.map