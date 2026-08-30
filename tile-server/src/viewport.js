import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { extractPlaceLabels, quantizeToPebblePalette } from './render.js';
import { PALETTE, TILE_SIZE, escapeXml, rgb } from './style.js';

export const VIEWPORT_WIDTH = 200;
export const VIEWPORT_HEIGHT = 228;
const MAX_MERCATOR_LATITUDE = 85.05112878;
const VIEW_STYLE_VERSION = 'v1';

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function wrapX(x, zoom) {
  const limit = 2 ** zoom;
  return ((x % limit) + limit) % limit;
}

export function latLonToWorldPixels(latitude, longitude, zoom) {
  const lat = clamp(latitude, -MAX_MERCATOR_LATITUDE, MAX_MERCATOR_LATITUDE);
  const scale = TILE_SIZE * (2 ** zoom);
  const sinLatitude = Math.sin(lat * Math.PI / 180);
  return {
    x: ((longitude + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + sinLatitude) / (1 - sinLatitude)) / (4 * Math.PI)) * scale
  };
}

export function buildViewportPlan(latitude, longitude, zoom, mode) {
  const displayScale = mode === 'wide' ? 2 : 1;
  const sourceWidth = VIEWPORT_WIDTH * displayScale;
  const sourceHeight = VIEWPORT_HEIGHT * displayScale;
  const world = latLonToWorldPixels(latitude, longitude, zoom);
  const centerX = Math.round(world.x);
  const centerY = Math.round(world.y);
  const left = centerX - (sourceWidth / 2);
  const top = centerY - (sourceHeight / 2);
  const startTileX = Math.floor(left / TILE_SIZE);
  const endTileX = Math.floor((left + sourceWidth - 1) / TILE_SIZE);
  const startTileY = Math.floor(top / TILE_SIZE);
  const endTileY = Math.floor((top + sourceHeight - 1) / TILE_SIZE);
  const maximumTileY = (2 ** zoom) - 1;
  const tiles = [];

  for (let tileY = startTileY; tileY <= endTileY; tileY += 1) {
    if (tileY < 0 || tileY > maximumTileY) continue;
    for (let tileX = startTileX; tileX <= endTileX; tileX += 1) {
      tiles.push({
        logicalX: tileX,
        logicalY: tileY,
        coords: { z: zoom, x: wrapX(tileX, zoom), y: tileY }
      });
    }
  }

  return {
    latitude,
    longitude,
    zoom,
    mode: displayScale === 2 ? 'wide' : 'standard',
    displayScale,
    sourceWidth,
    sourceHeight,
    centerX,
    centerY,
    left,
    top,
    startTileX,
    endTileX,
    startTileY,
    endTileY,
    tiles
  };
}

function boxesOverlap(a, b) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

function labelCandidates(place, fontSize) {
  const gap = 4;
  const width = Math.min(VIEWPORT_WIDTH - 4, Math.max(12, place.name.length * fontSize * 0.58));
  const height = fontSize + 3;
  const centerBaseline = place.y + (fontSize * 0.35);

  return [
    {
      textX: place.x + gap, textY: centerBaseline, anchor: 'start',
      box: { left: place.x + gap, top: centerBaseline - fontSize, right: place.x + gap + width, bottom: centerBaseline + 3 }
    },
    {
      textX: place.x - gap, textY: centerBaseline, anchor: 'end',
      box: { left: place.x - gap - width, top: centerBaseline - fontSize, right: place.x - gap, bottom: centerBaseline + 3 }
    },
    {
      textX: place.x, textY: place.y - gap, anchor: 'middle',
      box: { left: place.x - (width / 2), top: place.y - gap - fontSize, right: place.x + (width / 2), bottom: place.y - gap + 3 }
    },
    {
      textX: place.x, textY: place.y + fontSize + gap, anchor: 'middle',
      box: { left: place.x - (width / 2), top: place.y + gap, right: place.x + (width / 2), bottom: place.y + fontSize + gap + 3 }
    }
  ];
}

function boxFitsViewport(box) {
  const margin = 2;
  return box.left >= margin && box.top >= margin &&
    box.right <= VIEWPORT_WIDTH - margin && box.bottom <= VIEWPORT_HEIGHT - margin;
}

export function layoutPlaceLabels(places, zoom) {
  const occupied = [];
  const placed = [];
  const maximumLabels = zoom >= 10 ? 8 : 5;

  for (const place of places.slice().sort((a, b) => b.rank - a.rank)) {
    if (placed.length >= maximumLabels) break;
    const fontSize = place.kind === 'capital' || place.kind === 'state_capital' ? 12 : 10;
    const candidate = labelCandidates(place, fontSize).find((position) =>
      boxFitsViewport(position.box) && !occupied.some((box) => boxesOverlap(box, position.box)));
    if (!candidate) continue;
    occupied.push(candidate.box);
    placed.push({ ...place, markerX: place.x, markerY: place.y, ...candidate, fontSize });
  }
  return placed;
}

function labelsToSvg(labels) {
  const elements = labels.map((label) =>
    `<circle cx="${label.markerX.toFixed(2)}" cy="${label.markerY.toFixed(2)}" r="2.2"/>` +
    `<text x="${label.textX.toFixed(2)}" y="${label.textY.toFixed(2)}" ` +
      `text-anchor="${label.anchor}" font-size="${label.fontSize}">${escapeXml(label.name)}</text>`
  ).join('');

  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${VIEWPORT_WIDTH}" height="${VIEWPORT_HEIGHT}">` +
      `<g fill="${rgb(PALETTE.city)}" font-family="DejaVu Sans,sans-serif" font-weight="bold" ` +
        `stroke="${rgb(PALETTE.land)}" stroke-width="2" paint-order="stroke">${elements}</g>` +
    '</svg>'
  );
}

function collectPlaces(plan, vectorTiles) {
  const places = [];
  const seen = new Set();

  vectorTiles.forEach(({ tile, buffer }) => {
    for (const place of extractPlaceLabels(buffer, plan.zoom)) {
      const worldX = (tile.logicalX * TILE_SIZE) + place.x;
      const worldY = (tile.logicalY * TILE_SIZE) + place.y;
      const x = (worldX - plan.left) / plan.displayScale;
      const y = (worldY - plan.top) / plan.displayScale;
      if (x < 0 || x >= VIEWPORT_WIDTH || y < 0 || y >= VIEWPORT_HEIGHT) continue;
      const key = `${place.kind}|${place.name}|${Math.round(worldX)}|${Math.round(worldY)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      places.push({ ...place, x, y });
    }
  });
  return places;
}

export class ViewportService {
  constructor(tileService) {
    this.tileService = tileService;
    this.inFlight = new Map();
  }

  cachePath(plan) {
    return path.join(
      this.tileService.cacheDir,
      'viewport', VIEW_STYLE_VERSION, plan.mode, String(plan.zoom),
      String(plan.centerX), `${plan.centerY}.png`
    );
  }

  async createViewport(plan, filePath) {
    const baseVariant = plan.mode === 'wide' ? 'base-wide' : 'base-standard';
    const renderedTiles = await Promise.all(plan.tiles.map(async (tile) => ({
      tile,
      png: (await this.tileService.getTile(tile.coords, baseVariant)).png
    })));
    const columns = plan.endTileX - plan.startTileX + 1;
    const rows = plan.endTileY - plan.startTileY + 1;
    const mosaic = await sharp({
      create: {
        width: columns * TILE_SIZE,
        height: rows * TILE_SIZE,
        channels: 3,
        background: { r: PALETTE.land[0], g: PALETTE.land[1], b: PALETTE.land[2] }
      }
    }).composite(renderedTiles.map(({ tile, png }) => ({
      input: png,
      left: (tile.logicalX - plan.startTileX) * TILE_SIZE,
      top: (tile.logicalY - plan.startTileY) * TILE_SIZE
    }))).png().toBuffer();

    let base = await sharp(mosaic).extract({
      left: plan.left - (plan.startTileX * TILE_SIZE),
      top: plan.top - (plan.startTileY * TILE_SIZE),
      width: plan.sourceWidth,
      height: plan.sourceHeight
    }).png().toBuffer();
    if (plan.displayScale === 2) {
      base = await sharp(base).resize(VIEWPORT_WIDTH, VIEWPORT_HEIGHT).png().toBuffer();
    }

    const vectorTiles = await Promise.all(plan.tiles.map(async (tile) => ({
      tile,
      buffer: await this.tileService.getVectorTile(tile.coords)
    })));
    const labels = layoutPlaceLabels(collectPlaces(plan, vectorTiles), plan.zoom);
    const labelled = labels.length ?
      await sharp(base).composite([{ input: labelsToSvg(labels), left: 0, top: 0 }]).png().toBuffer() : base;
    const png = await quantizeToPebblePalette(labelled);

    await mkdir(path.dirname(filePath), { recursive: true });
    const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporaryPath, png);
    await rename(temporaryPath, filePath);
    return png;
  }

  async getViewport(latitude, longitude, zoom, mode) {
    const plan = buildViewportPlan(latitude, longitude, zoom, mode);
    const filePath = this.cachePath(plan);
    const cached = await this.tileService.readFreshCache(filePath);
    if (cached) return { png: cached, cache: 'HIT', plan };

    if (!this.inFlight.has(filePath)) {
      this.inFlight.set(filePath, this.createViewport(plan, filePath)
        .finally(() => this.inFlight.delete(filePath)));
    }
    return { png: await this.inFlight.get(filePath), cache: 'MISS', plan };
  }
}
