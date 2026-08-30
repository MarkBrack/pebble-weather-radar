import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { renderVectorTile } from './render.js';

const STYLE_VERSION = 'v1';
const DEFAULT_UPSTREAM = 'https://vector.openstreetmap.org/shortbread_v1/{z}/{x}/{y}.mvt';
const MIN_CACHE_SECONDS = 7 * 24 * 60 * 60;

export function parseTileCoordinates(zValue, xValue, yValue) {
  const z = Number(zValue);
  const x = Number(xValue);
  const y = Number(yValue);
  if (![z, x, y].every(Number.isInteger) || z < 0 || z > 14) return null;
  const limit = 2 ** z;
  if (x < 0 || y < 0 || x >= limit || y >= limit) return null;
  return { z, x, y };
}

export class TileService {
  constructor(options = {}) {
    this.cacheDir = options.cacheDir || path.resolve('.cache/tiles');
    this.upstreamTemplate = options.upstreamTemplate || process.env.OSM_VECTOR_TILE_URL || DEFAULT_UPSTREAM;
    this.userAgent = options.userAgent || process.env.OSM_USER_AGENT ||
      'pebble-weather-radar-tile-demo/0.1 (+https://github.com/MarkBrack/pebble-weather-radar)';
    this.cacheSeconds = Math.max(Number(options.cacheSeconds || process.env.UPSTREAM_CACHE_SECONDS) || 0, MIN_CACHE_SECONDS);
    this.fetch = options.fetch || globalThis.fetch;
    this.render = options.render || renderVectorTile;
    this.inFlight = new Map();
  }

  cachePath({ z, x, y }, variant = 'standard') {
    const styleKey = variant === 'wide' ? `${STYLE_VERSION}-wide` : STYLE_VERSION;
    return path.join(this.cacheDir, styleKey, String(z), String(x), `${y}.png`);
  }

  upstreamUrl({ z, x, y }) {
    return this.upstreamTemplate
      .replace('{z}', String(z))
      .replace('{x}', String(x))
      .replace('{y}', String(y));
  }

  async readFreshCache(filePath) {
    try {
      const details = await stat(filePath);
      if ((Date.now() - details.mtimeMs) / 1000 >= this.cacheSeconds) return null;
      return readFile(filePath);
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }

  async createTile(coords, variant, filePath) {
    const response = await this.fetch(this.upstreamUrl(coords), {
      headers: {
        Accept: 'application/vnd.mapbox-vector-tile, application/x-protobuf',
        'User-Agent': this.userAgent
      },
      signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) throw new Error(`Vector upstream returned HTTP ${response.status}`);

    const vectorTile = Buffer.from(await response.arrayBuffer());
    const png = await this.render(vectorTile, coords.z, variant);
    await mkdir(path.dirname(filePath), { recursive: true });
    const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporaryPath, png);
    await rename(temporaryPath, filePath);
    return png;
  }

  async getTile(coords, variant = 'standard') {
    const filePath = this.cachePath(coords, variant);
    const cached = await this.readFreshCache(filePath);
    if (cached) return { png: cached, cache: 'HIT' };

    if (!this.inFlight.has(filePath)) {
      this.inFlight.set(filePath, this.createTile(coords, variant, filePath)
        .finally(() => this.inFlight.delete(filePath)));
    }
    return { png: await this.inFlight.get(filePath), cache: 'MISS' };
  }
}

export function etagFor(buffer) {
  return `"${createHash('sha256').update(buffer).digest('base64url').slice(0, 20)}"`;
}
