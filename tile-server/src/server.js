import { createServer } from 'node:http';
import { TileService, etagFor, parseTileCoordinates } from './tile-service.js';

const port = Number(process.env.PORT) || 8080;
const service = new TileService({ cacheDir: process.env.CACHE_DIR });

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
      'Access-Control-Allow-Headers': 'If-None-Match'
    });
    return response.end();
  }
  if (url.pathname === '/healthz') return sendJson(response, 200, { status: 'ok' });

  const match = url.pathname.match(/^\/tiles\/v1\/(\d+)\/(\d+)\/(\d+)\.png$/);
  if (!match) {
    return sendJson(response, 404, {
      error: 'Not found',
      tileTemplate: '/tiles/v1/{z}/{x}/{y}.png',
      attribution: '© OpenStreetMap contributors'
    });
  }

  const coords = parseTileCoordinates(match[1], match[2], match[3]);
  if (!coords) return sendJson(response, 400, { error: 'Invalid slippy tile coordinates' });

  try {
    const result = await service.getTile(coords);
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
