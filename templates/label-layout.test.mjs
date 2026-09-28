import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { configureCategories, bubbleRadius, labelFor, valueLabel, MAX_RADIUS } from './map-model.mjs';
import { placeLabels, chartFrame, quadrantLabels, leaderEnd, leaderShown, geometry } from './label-layout.mjs';

const { overlapArea, segmentsCross, segmentHitsBox, gapTo } = geometry;
const dataset = JSON.parse(fs.readFileSync(new URL('../data/markets/personal-ai-agents.json', import.meta.url), 'utf8'));
configureCategories(dataset.market.categories);

// Character-width stand-ins for the page's fonts (DM Sans 600 12.5px, DM Mono 11px / 10.5px).
const measure = (text, cls) => text.length * (cls === 'map-label' ? 7.2 : cls === 'quadrant-label' ? 7.2 : 6.6);
const rows = dataset.companies.map(c => ({
  id: c.id, name: c.name, shortName: c.shortName, company: c.company, brand: c.brand, cls: c.class,
  valuation: c.lastRound.postMoneyUsd, raised: c.metrics?.totalRaisedUsd ?? null,
  conf: c.lastRound.confidence, valConf: c.lastRound.postMoneyConfidence ?? c.lastRound.confidence,
  raisedConf: c.metrics?.totalRaisedConfidence ?? null,
  scores: Object.fromEntries(Object.entries(c.axes).map(([k, v]) => [k, v.score])),
}));

function layout(width, axis, size) {
  const frame = chartFrame(width, MAX_RADIUS);
  const { W, H, m, compact, maxRadius } = frame;
  const max = Math.max(0, ...rows.filter(c => c.cls !== 'platform').map(c => c[size] || 0)) || 1;
  const nodes = rows.map(c => ({
    id: c.id, name: labelFor(c), value: valueLabel(c, size),
    x: m.l + c.scores.autonomy / 100 * (W - m.l - m.r),
    y: H - m.b - c.scores[axis] / 100 * (H - m.t - m.b),
    r: bubbleRadius(c, size, max, maxRadius),
  }));
  const fixed = quadrantLabels({ names: dataset.market.quadrants[axis], W, H, m, compact, measure }).map(q => q.box);
  return { frame, nodes, fixed, result: placeLabels({ nodes, W, H, m, compact, measure, fixed }) };
}

function invariants({ frame, nodes, fixed, result }) {
  const { compact } = frame;
  const placed = nodes.filter(n => result.labels.get(n.id)).map(n => ({ node: n, box: result.labels.get(n.id).box }));
  const problems = [];
  const leader = ({ node, box }) => {
    const end = leaderEnd(node, box);
    return { end, long: Math.hypot(end.x - node.x, end.y - node.y) > node.r + 9 };
  };
  for (const a of placed) {
    const { end, long } = leader(a);
    for (const f of fixed) if (overlapArea(a.box, f) > 12) problems.push(`${a.node.id} overlaps a quadrant name`);
    for (const o of nodes) {
      if (o === a.node) continue;
      if (overlapArea(a.box, { x: o.x - o.r, y: o.y - o.r, w: 2 * o.r, h: 2 * o.r }) > 4) problems.push(`${a.node.id}'s label covers ${o.id}'s mark`);
      if (long && segmentHitsBox(a.node, end, { x: o.x - o.r - 3, y: o.y - o.r - 3, w: 2 * o.r + 6, h: 2 * o.r + 6 })) problems.push(`${a.node.id}'s leader runs through ${o.id}'s mark`);
    }
    if (Math.hypot(end.x - a.node.x, end.y - a.node.y) > a.node.r + (compact ? 84 : 200)) problems.push(`${a.node.id}'s label is too far from its mark`);
    for (const b of placed) {
      if (b === a) continue;
      if (a.node.id < b.node.id && overlapArea(a.box, b.box) > 12) problems.push(`${a.node.id} and ${b.node.id} overlap`);
      if (long && segmentHitsBox(a.node, end, b.box)) problems.push(`${a.node.id}'s leader runs through ${b.node.id}'s label`);
      if (compact && a.node.id < b.node.id) {
        const other = leader(b);
        if (long && other.long && segmentsCross(a.node, end, b.node, other.end)) problems.push(`${a.node.id} and ${b.node.id} leaders cross`);
      }
    }
    // On phones a label with no leader must sit nearest its own mark; with a
    // leader, the line itself shows which mark it belongs to.
    if (compact && !leaderShown(a.node, a.box, compact)) {
      const own = gapTo(a.node, a.box);
      for (const o of nodes) if (o !== a.node && gapTo(o, a.box) < own - 2) problems.push(`${a.node.id}'s label sits nearer ${o.id}`);
    }
  }
  return problems;
}

for (const width of [1320, 1276, 1000, 900, 760, 700, 500, 400, 343, 333]) {
  for (const axis of ['breadth', 'distribution']) {
    for (const size of ['valuation', 'raised', 'equal']) {
      test(`labels keep their promises at ${width}px · ${axis} · ${size}`, () => {
        const run = layout(width, axis, size);
        assert.deepEqual(invariants(run), []);
        assert.equal(run.result.labels.size, rows.length, 'every company is accounted for');
        assert.equal(run.result.hidden, [...run.result.labels.values()].filter(l => !l).length);
      });
    }
  }
}

test('from 500px up, every company is named in every view', () => {
  // Resizing the window or switching the bubble area must never drop a name.
  const missing = [];
  for (let width = 500; width <= 1400; width += 20) for (const axis of ['breadth', 'distribution']) for (const size of ['valuation', 'raised', 'equal']) {
    const { result } = layout(width, axis, size);
    for (const [id, label] of result.labels) if (!label) missing.push(`${width}px ${axis}/${size}: ${id}`);
  }
  assert.deepEqual(missing, []);
});
test('on the narrowest phones at most two names give way, and only in the densest views', () => {
  // 333px is the chart on a 375px-wide phone.
  for (const width of [333, 343, 375, 400]) for (const axis of ['breadth', 'distribution']) for (const size of ['valuation', 'raised', 'equal']) {
    assert.ok(layout(width, axis, size).result.hidden <= 2, `${width}px ${axis}/${size}`);
  }
});

test('layout is deterministic', () => {
  const a = layout(1000, 'breadth', 'valuation').result, b = layout(1000, 'breadth', 'valuation').result;
  assert.deepEqual([...a.labels], [...b.labels]);
});
