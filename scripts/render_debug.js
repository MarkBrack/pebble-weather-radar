#!/usr/bin/env node

var fs = require('fs');
var https = require('https');
var path = require('path');
var renderer = require('../src/pkjs/render');

var BUILD_DIR = path.join(__dirname, '..', 'build');
var DEFAULT_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
  'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
  'Accept-Language': 'en-GB,en;q=0.9',
  'Referer': 'https://www.openstreetmap.org/'
};

function fetchJson(url) {
  return new Promise(function(resolve, reject) {
    https.get(url, { headers: DEFAULT_HEADERS }, function(response) {
      if (response.statusCode < 200 || response.statusCode >= 300) {
        reject(new Error('HTTP ' + response.statusCode + ' for ' + url));
        return;
      }

      var chunks = [];
      response.on('data', function(chunk) {
        chunks.push(chunk);
      });
      response.on('end', function() {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      });
    }).on('error', reject);
  });
}

function fetchArrayBuffer(url) {
  return new Promise(function(resolve, reject) {
    https.get(url, { headers: DEFAULT_HEADERS }, function(response) {
      if (response.statusCode < 200 || response.statusCode >= 300) {
        reject(new Error('HTTP ' + response.statusCode + ' for ' + url));
        return;
      }

      var chunks = [];
      response.on('data', function(chunk) {
        chunks.push(chunk);
      });
      response.on('end', function() {
        var buffer = Buffer.concat(chunks);
        resolve(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
      });
    }).on('error', reject);
  });
}

function writePpm(filePath, width, height, rgba) {
  var header = Buffer.from('P6\n' + width + ' ' + height + '\n255\n', 'ascii');
  var rgb = Buffer.alloc(width * height * 3);
  var i;
  var p;

  for (i = 0, p = 0; i < rgba.length; i += 4) {
    rgb[p++] = rgba[i];
    rgb[p++] = rgba[i + 1];
    rgb[p++] = rgba[i + 2];
  }

  fs.writeFileSync(filePath, Buffer.concat([header, rgb]));
}

function ensureBuildDir() {
  if (!fs.existsSync(BUILD_DIR)) {
    fs.mkdirSync(BUILD_DIR, { recursive: true });
  }
}

function parseArgs(argv) {
  var options = {
    lat: 54.623,
    lon: -1.302,
    zoom: 8,
    cropMode: 'standard'
  };

  argv.forEach(function(arg) {
    var parts = arg.split('=');
    if (parts.length !== 2) {
      return;
    }

    if (parts[0] === '--lat') {
      options.lat = Number(parts[1]);
    } else if (parts[0] === '--lon') {
      options.lon = Number(parts[1]);
    } else if (parts[0] === '--zoom') {
      options.zoom = Number(parts[1]);
    } else if (parts[0] === '--crop') {
      options.cropMode = parts[1] === 'wide' ? 'wide' : 'standard';
    }
  });

  return options;
}

ensureBuildDir();

var args = parseArgs(process.argv.slice(2));

fetchJson('https://api.rainviewer.com/public/weather-maps.json').then(function(payload) {
  if (!payload || !payload.radar || !payload.radar.past || !payload.radar.past.length) {
    throw new Error('RainViewer returned no radar frames');
  }

  return renderer.renderScene({
    fetchArrayBuffer: fetchArrayBuffer
  }, {
    lat: args.lat,
    lon: args.lon,
    mapZoom: args.zoom,
    cropMode: args.cropMode,
    mapStyle: 'osm_standard',
    mapDetailMode: 'native',
    baseSize: renderer.BASE_SIZE,
    radarZoomCap: renderer.RADAR_MAX_ZOOM,
    radarColor: 2,
    radarOptions: '1_1',
    framePath: payload.radar.past[payload.radar.past.length - 1].path
  });
}).then(function(result) {
  writePpm(path.join(BUILD_DIR, 'debug_map_source_' + args.cropMode + '.ppm'),
    result.mapSourceWidth, result.mapSourceHeight, result.mapSourceRgba);
  writePpm(path.join(BUILD_DIR, 'debug_composite_' + args.cropMode + '.ppm'),
    result.compositeWidth, result.compositeHeight, result.compositeRgba);
  writePpm(path.join(BUILD_DIR, 'debug_pebble_' + args.cropMode + '.ppm'),
    renderer.DISPLAY_WIDTH, renderer.DISPLAY_HEIGHT, result.pebbleRgba);

  console.log('Rendered debug images for ' + args.cropMode + ' crop');
  console.log('Tile count: ' + result.plan.tiles.length + ' at zoom ' + result.plan.hiZoom);
  console.log('Overlay mode: ' + result.overlayMode);
  console.log('Unique pebble colors: ' + result.summary.uniqueColorCount);
  result.summary.topColors.forEach(function(entry) {
    console.log(entry.color + ' ' + entry.count);
  });
}).catch(function(error) {
  console.error(error.message);
  process.exit(1);
});
