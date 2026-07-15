var renderer = require('./render');
var rle = require('./rle');

var CHUNK_SIZE = 128;
var MAX_RADAR_FRAMES = 3;
var FRAME_PIXELS = renderer.DISPLAY_WIDTH * renderer.DISPLAY_HEIGHT;
var MAX_RLE_FRAME_BYTES = rle.maxEncodedSize(FRAME_PIXELS);
var MAX_BATCH_RLE_BYTES = 56000;
var RAINVIEWER_API = 'https://api.rainviewer.com/public/weather-maps.json';
var DEFAULT_HEADERS = {
  'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
  'Accept-Language': 'en-GB,en;q=0.9',
  'Referer': 'https://www.openstreetmap.org/',
  'User-Agent': 'Mozilla/5.0 (Linux; PebbleKitJS) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36'
};
var HARDCODED_LOCATION = {
  latitude: 21.307,
  longitude: -157.858
};

var refreshInFlight = false;
var queuedRequest = null;

function xhr(url, responseType) {
  return new Promise(function(resolve, reject) {
    var request = new XMLHttpRequest();
    request.open('GET', url, true);
    if (responseType) {
      request.responseType = responseType;
    }
    Object.keys(DEFAULT_HEADERS).forEach(function(header) {
      try {
        request.setRequestHeader(header, DEFAULT_HEADERS[header]);
      } catch (error) {}
    });
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

var transport = {
  fetchArrayBuffer: function(url) {
    return xhr(url, 'arraybuffer');
  }
};

function sendMessage(payload) {
  return new Promise(function(resolve, reject) {
    Pebble.sendAppMessage(payload, resolve, reject);
  });
}

function reportStatus(message) {
  return sendMessage({
    STATUS_TEXT: message.slice(0, 63)
  }).catch(function() {});
}

var statusChain = Promise.resolve();

function queueStatus(message) {
  statusChain = statusChain.then(function() {
    return reportStatus(message);
  });
  return statusChain;
}

function getLocation() {
  return new Promise(function(resolve) {
    var settled = false;
    var fallbackTimer = setTimeout(function() {
      if (settled) return;
      settled = true;
      console.log('GPS timed out, using fallback location');
      resolve(HARDCODED_LOCATION);
    }, 12000);

    function finish(coords) {
      if (settled) return;
      settled = true;
      clearTimeout(fallbackTimer);
      resolve(coords);
    }

    navigator.geolocation.getCurrentPosition(
      function(pos) {
        finish({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude
        });
      },
      function() {
        console.log('GPS failed, using fallback location');
        finish(HARDCODED_LOCATION);
      },
      { timeout: 10000, maximumAge: 300000 }
    );
  });
}

function normalizeRequest(payload) {
  var zoom = payload && payload.MAP_ZOOM ? payload.MAP_ZOOM : 8;
  var cropModeValue = payload && payload.MAP_CROP_MODE ? payload.MAP_CROP_MODE : 0;
  return {
    mapZoom: zoom,
    cropMode: cropModeValue === 1 ? 'wide' : 'standard'
  };
}

// --- Send background ---

function sendBackground(bgRle) {
  console.log('Sending BG RLE, size=' + bgRle.length);
  if (bgRle.length > MAX_RLE_FRAME_BYTES) {
    throw new Error('Map frame too large');
  }

  return sendMessage({
    FRAME_WIDTH: renderer.DISPLAY_WIDTH,
    FRAME_HEIGHT: renderer.DISPLAY_HEIGHT,
    BG_TOTAL_BYTES: bgRle.length
  }).then(function() {
    var offset = 0;
    function sendNext() {
	  if (offset >= bgRle.length) return Promise.resolve();
	  var end = Math.min(offset + CHUNK_SIZE, bgRle.length);
	  var chunk = Array.prototype.slice.call(bgRle.subarray(offset, end));
	  var currentOffset = offset;
	  offset = end;
	  return sendMessage({ BG_OFFSET: currentOffset, BG_CHUNK: chunk }).then(sendNext);
    }
    return sendNext();
  });
}

// --- Send radar frames ---

function sendRadarFrame(radarRle, index, count) {
  console.log('Sending radar frame ' + (index + 1) + '/' + count + ', size=' + radarRle.length);
  if (radarRle.length > MAX_RLE_FRAME_BYTES) {
    throw new Error('Radar frame too large');
  }

  return sendMessage({
    RADAR_FRAME_INDEX: index,
    RADAR_FRAME_COUNT: count,
    RADAR_TOTAL_BYTES: radarRle.length
  }).then(function() {
    var offset = 0;
    function sendNext() {
	  if (offset >= radarRle.length) return Promise.resolve();
	  var end = Math.min(offset + CHUNK_SIZE, radarRle.length);
	  var chunk = Array.prototype.slice.call(radarRle.subarray(offset, end));
	  var currentOffset = offset;
	  offset = end;
	  return sendMessage({ RADAR_OFFSET: currentOffset, RADAR_CHUNK: chunk }).then(sendNext);
    }
    return sendNext();
  });
}

function sendBatchDone() {
  console.log('Sending batch done');
  return sendMessage({ RADAR_BATCH_DONE: 1 });
}

// --- Fetch radar timestamps ---

function fetchRadarTimestamps() {
	console.log('Fetching RainViewer radar timestamps');
	return fetchJson(RAINVIEWER_API).then(function(payload) {
		if (!payload || !payload.radar || !payload.radar.past || !payload.radar.past.length) {
			throw new Error('No radar data from RainViewer');
		}
		var past = payload.radar.past;
		var frames = past.slice(-MAX_RADAR_FRAMES).reverse();
		if (payload.radar.nowcast && payload.radar.nowcast.length) {
			var nowcastSlots = MAX_RADAR_FRAMES - frames.length;
			if (nowcastSlots > 0) {
				frames = frames.concat(payload.radar.nowcast.slice(0, nowcastSlots));
			}
		}
		console.log('Got ' + frames.length + ' radar frame candidates');
		return frames;
	});
}

function collectRadarFrames(radarTimestamps, transport, values, bgRleLength) {
	var frameCount = radarTimestamps.length;
	var i = 0;
	var accepted = [];
	var acceptedRadarBytes = 0;

	function renderNext() {
		if (i >= frameCount) {
			return accepted;
		}

		var frame = radarTimestamps[i];
		var currentIdx = i;
		i++;
		console.log('Rendering radar candidate ' + (currentIdx + 1) + '/' + frameCount);
		return renderer.renderRadarOverlay(transport, frame.path, values).then(function(result) {
			var radarRle = rle.encode(result.paletteIndexed);
			if (radarRle.length > MAX_RLE_FRAME_BYTES) {
				console.log('Skipping oversized radar frame, size=' + radarRle.length);
				return renderNext();
			}
			if ((bgRleLength + acceptedRadarBytes + radarRle.length) > MAX_BATCH_RLE_BYTES) {
				console.log('Radar frame budget full after accepting ' + accepted.length + ' frame(s)');
				return accepted;
			}

			accepted.push(radarRle);
			acceptedRadarBytes += radarRle.length;
			return renderNext();
		});
	}

	return renderNext();
}

function sendRadarFrames(radarFrames) {
	var chronological = radarFrames.slice().reverse();
	var frameCount = chronological.length;
	var i = 0;

	function sendNext() {
		if (i >= frameCount) {
			return sendBatchDone();
		}

		var radarRle = chronological[i];
		var index = i;
		i++;
		return sendRadarFrame(radarRle, index, frameCount).then(sendNext);
	}

	return sendNext();
}

// --- Main refresh pipeline ---

function refreshFrame(request) {
  var normalized = normalizeRequest(request);
  console.log('Refresh requested zoom=' + normalized.mapZoom + ' crop=' + normalized.cropMode);

  if (refreshInFlight) {
    queuedRequest = normalized;
    console.log('Refresh in flight, queueing');
    return;
  }

  refreshInFlight = true;

  queueStatus('Locating...').then(getLocation).then(function(coords) {
    console.log('Using coordinates ' + coords.latitude + ',' + coords.longitude);
    return queueStatus('Fetching radar...').then(fetchRadarTimestamps).then(function(radarTimestamps) {
      var options = {
        lat: coords.latitude,
        lon: coords.longitude,
        mapZoom: normalized.mapZoom,
        cropMode: normalized.cropMode,
        mapStyle: 'osm_standard',
        mapDetailMode: 'native',
        baseSize: renderer.BASE_SIZE,
        radarZoomCap: renderer.RADAR_MAX_ZOOM,
        radarColor: 2,
        radarOptions: '1_1'
      };

      // 1. Render and send background
      return queueStatus('Rendering map...').then(function() {
        return renderer.renderBackgroundOnly(transport, options);
      }).then(function(bgResult) {
        console.log('Background rendered');
		var bgRle = rle.encode(bgResult.pebble8Bit);
        return queueStatus('Sending map...').then(function() {
          return sendBackground(bgRle);
        }).then(function() {
		  // 2. Render newest candidates first, then send accepted frames oldest-to-newest.
		  var values = bgResult.values;
          return queueStatus('Rendering radar...').then(function() {
		    return collectRadarFrames(radarTimestamps, transport, values, bgRle.length);
          })
		    .then(sendRadarFrames);
		});
	  });
	});
  }).then(function() {
    console.log('Batch refresh complete');
  }).catch(function(error) {
    console.log('Refresh error: ' + error.message);
    reportStatus(error.message);
  }).then(function() {
    refreshInFlight = false;
    if (queuedRequest) {
      var next = queuedRequest;
      queuedRequest = null;
      refreshFrame(next);
    }
  });
}

Pebble.addEventListener('ready', function() {
  console.log('PebbleKit JS ready');
  Pebble.sendAppMessage({ STATUS_TEXT: 'Ready' }, function() {
    console.log('Phone greeting sent OK');
  }, function(e) {
    console.log('Phone greeting failed: ' + (e && e.message ? e.message : JSON.stringify(e)));
  });
});

Pebble.addEventListener('appmessage', function(event) {
  var payload = event ? event.payload : null;
  if (!payload || !payload.REQUEST_FRAME) {
    console.log('Ignoring appmessage without refresh request');
    return;
  }
  console.log('Received appmessage requesting refresh');
  refreshFrame(payload);
});
