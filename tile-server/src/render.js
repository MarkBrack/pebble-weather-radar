import { VectorTile } from '@mapbox/vector-tile';
import Pbf from 'pbf';
import sharp from 'sharp';
import {
  TILE_SIZE,
  PALETTE,
  escapeXml,
  includePlace,
  placeRank,
  rgb,
  roadRank,
  roadWidths
} from './style.js';

const OUTPUT_PALETTE = Object.values(PALETTE);

function scaleFor(feature) {
  return TILE_SIZE / feature.extent;
}

function linePath(feature, closeRings = false) {
  const scale = scaleFor(feature);
  return feature.loadGeometry().map((line) => {
    if (!line.length) return '';
    const commands = [`M${(line[0].x * scale).toFixed(2)} ${(line[0].y * scale).toFixed(2)}`];
    for (let i = 1; i < line.length; i += 1) {
      commands.push(`L${(line[i].x * scale).toFixed(2)} ${(line[i].y * scale).toFixed(2)}`);
    }
    if (closeRings) commands.push('Z');
    return commands.join('');
  }).join('');
}

function firstPoint(feature) {
  const geometry = feature.loadGeometry();
  if (!geometry.length || !geometry[0].length) return null;
  const scale = scaleFor(feature);
  return {
    x: geometry[0][0].x * scale,
    y: geometry[0][0].y * scale
  };
}

function layerFeatures(tile, layerName) {
  const layer = tile.layers[layerName];
  if (!layer) return [];
  const features = [];
  for (let i = 0; i < layer.length; i += 1) features.push(layer.feature(i));
  return features;
}

function polygonElements(tile, layerName, filter = () => true) {
  return layerFeatures(tile, layerName)
    .filter((feature) => feature.type === 3 && filter(feature.properties))
    .map((feature) => `<path d="${linePath(feature, true)}"/>`)
    .join('');
}

function roadElements(tile, zoom, displayScale) {
  const roads = layerFeatures(tile, 'streets')
    .filter((feature) => feature.type === 2)
    .map((feature) => ({ feature, rank: roadRank(feature.properties.kind, zoom) }))
    .filter(({ rank }) => rank > 0)
    .sort((a, b) => a.rank - b.rank);

  const casings = [];
  const fills = [];
  for (const road of roads) {
    const path = linePath(road.feature);
    const widths = roadWidths(road.rank, zoom, displayScale);
    casings.push(`<path d="${path}" stroke-width="${widths.casing.toFixed(2)}"/>`);
    fills.push(`<path d="${path}" stroke-width="${widths.fill.toFixed(2)}"/>`);
  }
  return { casings: casings.join(''), fills: fills.join('') };
}

function placeElements(tile, zoom, displayScale) {
  const places = layerFeatures(tile, 'place_labels')
    .filter((feature) => feature.type === 1 && includePlace(feature.properties, zoom))
    .map((feature) => ({ feature, point: firstPoint(feature) }))
    .filter(({ point }) => point)
    .sort((a, b) => placeRank(b.feature.properties) - placeRank(a.feature.properties))
    .slice(0, zoom >= 10 ? 8 : 5);

  return places.map(({ feature, point }) => {
    const label = escapeXml(feature.properties.name);
    const baseSize = feature.properties.kind === 'capital' || feature.properties.kind === 'state_capital' ? 12 : 10;
    const size = baseSize * displayScale;
    const markerRadius = 2.2 * displayScale;
    const labelOffset = 4 * displayScale;
    const baselineOffset = 3 * displayScale;
    const x = point.x.toFixed(2);
    const y = point.y.toFixed(2);
    return `<circle cx="${x}" cy="${y}" r="${markerRadius.toFixed(1)}"/>` +
      `<text x="${(point.x + labelOffset).toFixed(2)}" y="${(point.y + baselineOffset).toFixed(2)}" font-size="${size}">${label}</text>`;
  }).join('');
}

export function vectorTileToSvg(buffer, zoom, variant = 'standard') {
  const displayScale = variant === 'wide' ? 2 : 1;
  const tile = new VectorTile(new Pbf(buffer));
  const ocean = polygonElements(tile, 'ocean');
  const water = polygonElements(tile, 'water_polygons', (properties) => properties.kind !== 'glacier');
  const roads = roadElements(tile, zoom, displayScale);
  const places = placeElements(tile, zoom, displayScale);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${TILE_SIZE}" height="${TILE_SIZE}" viewBox="0 0 ${TILE_SIZE} ${TILE_SIZE}">` +
    `<rect width="256" height="256" fill="${rgb(PALETTE.land)}"/>` +
    `<g fill="${rgb(PALETTE.water)}" fill-rule="evenodd">${ocean}${water}</g>` +
    `<g fill="none" stroke="${rgb(PALETTE.roadCasing)}" stroke-linecap="round" stroke-linejoin="round">${roads.casings}</g>` +
    `<g fill="none" stroke="${rgb(PALETTE.road)}" stroke-linecap="round" stroke-linejoin="round">${roads.fills}</g>` +
    `<g fill="${rgb(PALETTE.city)}" font-family="DejaVu Sans,sans-serif" font-weight="bold" ` +
      `stroke="${rgb(PALETTE.land)}" stroke-width="${2 * displayScale}" paint-order="stroke">${places}</g>` +
    '</svg>';
}

function nearestPaletteColor(r, g, b) {
  let best = OUTPUT_PALETTE[0];
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const color of OUTPUT_PALETTE) {
    const dr = r - color[0];
    const dg = g - color[1];
    const db = b - color[2];
    const distance = (dr * dr) + (dg * dg) + (db * db);
    if (distance < bestDistance) {
      best = color;
      bestDistance = distance;
    }
  }
  return best;
}

export async function quantizeToPebblePalette(input) {
  const { data, info } = await sharp(input)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  for (let i = 0; i < data.length; i += info.channels) {
    const color = nearestPaletteColor(data[i], data[i + 1], data[i + 2]);
    data[i] = color[0];
    data[i + 1] = color[1];
    data[i + 2] = color[2];
  }

  return sharp(data, {
    raw: { width: info.width, height: info.height, channels: info.channels }
  }).png({ palette: true, colours: OUTPUT_PALETTE.length, compressionLevel: 9 }).toBuffer();
}

export async function renderVectorTile(buffer, zoom, variant = 'standard') {
  return quantizeToPebblePalette(Buffer.from(vectorTileToSvg(buffer, zoom, variant)));
}
