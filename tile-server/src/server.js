import { createServer } from 'node:http';
import { tokenMatches } from './auth.js';
import { TileService, etagFor, parseTileCoordinates } from './tile-service.js';
import { ViewportService } from './viewport.js';

const port = Number(process.env.PORT) || 8080;
const tileServerToken = process.env.TILE_SERVER_TOKEN || null;
const service = new TileService({ cacheDir: process.env.CACHE_DIR });
const viewportService = new ViewportService(service);

function sendJson(response, status, payload) {
  const body = Buffer.from(JSON.stringify(payload));
  response.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': body.length,
    'Access-Control-Allow-Origin': '*'
  });
  response.end(body);
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  if (request.method === 'OPTIONS') {
    response.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'If-None-Match, X-Tile-Token'
    });
    return response.end();
  }
  if (url.pathname === '/healthz') return sendJson(response, 200, { status: 'ok' });

  if (!tokenMatches(tileServerToken, request.headers['x-tile-token'])) {
    return sendJson(response, 401, { error: 'Invalid or missing tile token' });
  }

  const viewportMatch = url.pathname.match(
    /^\/maps\/(v1|v2)\/(standard|wide)\/(\d+)\/(-?\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)\.png$/
  );
  if (viewportMatch) {
    const mode = viewportMatch[2];
    const zoom = Number(viewportMatch[3]);
    const latitude = Number(viewportMatch[4]);
    const longitude = Number(viewportMatch[5]);
    if (!Number.isInteger(zoom) || zoom < 0 || zoom > 14 ||
        !Number.isFinite(latitude) || latitude < -85.05112878 || latitude > 85.05112878 ||
        !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      return sendJson(response, 400, { error: 'Invalid viewport coordinates' });
    }

    try {
      const result = await viewportService.getViewport(latitude, longitude, zoom, mode);
      const etag = etagFor(result.png);
      if (request.headers['if-none-match'] === etag) {
        response.writeHead(304, {
          ETag: etag,
          'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
          'Access-Control-Allow-Origin': '*'
        });
        return response.end();
      }
      response.writeHead(200, {
        'Content-Type': 'image/png',
        'Content-Length': result.png.length,
        'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
        ETag: etag,
        'X-Viewport-Cache': result.cache,
        'X-Map-Attribution': 'OpenStreetMap contributors',
        'Access-Control-Allow-Origin': '*'
      });
      return response.end(result.png);
    } catch (error) {
      console.error(error);
      return sendJson(response, 502, { error: 'Unable to render map viewport' });
    }
  }

  const match = url.pathname.match(/^\/tiles\/(v1|v1-wide|v2|v2-wide)\/(\d+)\/(\d+)\/(\d+)\.png$/);
  if (!match) {
    return sendJson(response, 404, {
      error: 'Not found',
      viewportTemplate: '/maps/v2/{mode}/{z}/{latitude}/{longitude}.png',
      tileTemplate: '/tiles/v2/{z}/{x}/{y}.png',
      wideTileTemplate: '/tiles/v2-wide/{z}/{x}/{y}.png',
      attribution: '© OpenStreetMap contributors'
    });
  }

  const variant = /-wide$/.test(match[1]) ? 'wide' : 'standard';
  const coords = parseTileCoordinates(match[2], match[3], match[4]);
  if (!coords) return sendJson(response, 400, { error: 'Invalid slippy tile coordinates' });

  try {
    const result = await service.getTile(coords, variant);
    const etag = etagFor(result.png);
    if (request.headers['if-none-match'] === etag) {
      response.writeHead(304, {
        ETag: etag,
        'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
        'Access-Control-Allow-Origin': '*'
      });
      return response.end();
    }
    response.writeHead(200, {
      'Content-Type': 'image/png',
      'Content-Length': result.png.length,
      'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
      ETag: etag,
      'X-Tile-Cache': result.cache,
      'X-Map-Attribution': 'OpenStreetMap contributors',
      'Access-Control-Allow-Origin': '*'
    });
    response.end(result.png);
  } catch (error) {
    console.error(error);
    sendJson(response, 502, { error: 'Unable to render upstream vector tile' });
  }
});

server.listen(port, '0.0.0.0', () => {
  console.log(`Pebble tile demo listening on http://0.0.0.0:${port}`);
});
