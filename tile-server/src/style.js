export const TILE_SIZE = 256;

export const PALETTE = Object.freeze({
  city: [0, 0, 0],
  roadCasing: [0, 85, 0],
  land: [85, 170, 85],
  road: [170, 255, 170],
  water: [255, 255, 255]
});

const ROAD_RANK = Object.freeze({
  motorway: 4,
  trunk: 3,
  primary: 2,
  secondary: 1
});

export function roadRank(kind, zoom) {
  const rank = ROAD_RANK[kind] || 0;
  if (rank >= 3) return rank;
  if (rank === 2 && zoom >= 8) return rank;
  if (rank === 1 && zoom >= 9) return rank;
  return 0;
}

export function roadWidths(rank, zoom, displayScale = 1) {
  const zoomBoost = Math.max(0, zoom - 8) * 0.18;
  return {
    casing: Math.min(5, 1.4 + (rank * 0.55) + zoomBoost) * displayScale,
    fill: Math.min(3.4, 0.7 + (rank * 0.38) + zoomBoost) * displayScale
  };
}

export function includePlace(properties, zoom) {
  const kind = properties.kind;
  const population = Number(properties.population) || 0;
  if (!properties.name) return false;
  if (kind === 'capital' || kind === 'state_capital') return zoom >= 4;
  if (kind === 'city') return zoom >= 6 && (zoom >= 9 || population >= 100000);
  if (kind === 'town') return zoom >= 10 && population >= 25000;
  return false;
}

export function labelPlacement(point, label, fontSize, displayScale = 1) {
  const offset = 4 * displayScale;
  const estimatedWidth = label.length * fontSize * 0.58;
  const roomOnRight = TILE_SIZE - point.x - offset;
  const roomOnLeft = point.x - offset;
  const placeOnLeft = estimatedWidth > roomOnRight && roomOnLeft > roomOnRight;
  return {
    x: placeOnLeft ? point.x - offset : point.x + offset,
    y: Math.max(fontSize + 2, Math.min(TILE_SIZE - 3, point.y + (3 * displayScale))),
    anchor: placeOnLeft ? 'end' : 'start'
  };
}

export function placeRank(properties) {
  const population = Number(properties.population) || 0;
  const kindBoost = properties.kind === 'capital' ? 1000000000 :
    properties.kind === 'state_capital' ? 500000000 :
    properties.kind === 'city' ? 100000000 : 0;
  return kindBoost + population;
}

export function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

export function rgb(color) {
  return `rgb(${color[0]},${color[1]},${color[2]})`;
}
