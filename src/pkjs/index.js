var renderer = require('./render');

var CHUNK_SIZE = 512;
var MAX_RADAR_FRAMES = 8;
var RAINVIEWER_API = 'https://api.rainviewer.com/public/weather-maps.json';
var DEFAULT_HEADERS = {
  'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
  'Accept-Language': 'en-GB,en;q=0.9',
  'Referer': 'https://www.openstreetmap.org/',
  'User-Agent': 'Mozilla/5.0 (Linux; PebbleKitJS) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36'
};
var HARDCODED_LOCATION = {
  latitude: 54.623,
  longitude: -1.302
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

function rleEncode(bytes) {
  var result = [];
  var i = 0;
  while (i < bytes.length) {
    var val = bytes[i];
    var count = 1;
    while (i + count < bytes.length && bytes[i + count] === val && count < 255) {
      count++;
    }
    result.push(val, count);
    i += count;
  }
  return new Uint8Array(result);
}

function reportStatus(message) {
  return sendMessage({
    STATUS_TEXT: message.slice(0, 63)
  }).catch(function() {});
}

function getLocation() {
  return Promise.resolve(HARDCODED_LOCATION);
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
    var frames = past.slice(-MAX_RADAR_FRAMES);
    if (payload.radar.nowcast && payload.radar.nowcast.length) {
      var nowcastSlots = MAX_RADAR_FRAMES - frames.length;
      if (nowcastSlots > 0) {
        frames = frames.concat(payload.radar.nowcast.slice(0, nowcastSlots));
      }
    }
    console.log('Got ' + frames.length + ' radar frames');
    return frames;
  });
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

  getLocation().then(function(coords) {
    console.log('Using coordinates ' + coords.latitude + ',' + coords.longitude);
    return fetchRadarTimestamps().then(function(radarTimestamps) {
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
      return renderer.renderBackgroundOnly(transport, options).then(function(bgResult) {
        console.log('Background rendered');
        var bgRle = rleEncode(bgResult.pebble8Bit);
        return sendBackground(bgRle).then(function() {
          // 2. Render and send each radar frame
          var values = bgResult.values;
          var frameCount = radarTimestamps.length;
          var i = 0;

          function sendNextRadar() {
            if (i >= frameCount) {
              return sendBatchDone();
            }
            var frame = radarTimestamps[i];
            var currentIdx = i;
            i++;
            console.log('Rendering radar frame ' + (currentIdx + 1) + '/' + frameCount);
            return renderer.renderRadarOverlay(transport, frame.path, values).then(function(result) {
              var radarRle = rleEncode(result.paletteIndexed);
              return sendRadarFrame(radarRle, currentIdx, frameCount);
            }).then(sendNextRadar);
          }

          return sendNextRadar();
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
  console.log('Received appmessage requesting refresh');
  refreshFrame(event ? event.payload : null);
});
