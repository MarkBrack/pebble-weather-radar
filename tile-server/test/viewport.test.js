import assert from 'node:assert/strict';
import test from 'node:test';
import {
  VIEWPORT_HEIGHT,
  VIEWPORT_WIDTH,
  buildViewportPlan,
  layoutPlaceLabels
} from '../src/viewport.js';

test('standard and wide plans produce a watch-sized view at one and two-times scale', () => {
  const standard = buildViewportPlan(54.623, -1.302, 8, 'standard');
  const wide = buildViewportPlan(54.623, -1.302, 8, 'wide');

  assert.equal(standard.sourceWidth, VIEWPORT_WIDTH);
  assert.equal(standard.sourceHeight, VIEWPORT_HEIGHT);
  assert.equal(wide.sourceWidth, VIEWPORT_WIDTH * 2);
  assert.equal(wide.sourceHeight, VIEWPORT_HEIGHT * 2);
  assert.equal(standard.centerX, wide.centerX);
  assert.equal(standard.centerY, wide.centerY);
  assert.ok(wide.tiles.length >= standard.tiles.length);
});

test('labels near the right edge are placed to the left without clipping', () => {
  const [label] = layoutPlaceLabels([
    { name: 'Newcastle upon Tyne', kind: 'city', rank: 100, x: 190, y: 60 }
  ], 8);

  assert.equal(label.anchor, 'end');
  assert.ok(label.box.left >= 2);
  assert.ok(label.box.right <= VIEWPORT_WIDTH - 2);
});

test('nearby labels are moved so their text does not collide', () => {
  const labels = layoutPlaceLabels([
    { name: 'Sunderland', kind: 'city', rank: 100, x: 100, y: 100 },
    { name: 'Nearby', kind: 'town', rank: 1, x: 101, y: 101 }
  ], 8);

  assert.equal(labels.length, 2);
  assert.equal(labels[0].name, 'Sunderland');
  const first = labels[0].box;
  const second = labels[1].box;
  assert.equal(
    first.left < second.right && first.right > second.left &&
      first.top < second.bottom && first.bottom > second.top,
    false
  );
});
