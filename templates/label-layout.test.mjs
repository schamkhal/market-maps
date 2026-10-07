import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { configureCategories, markRadius, labelFor, valueLabel, MAX_RADIUS } from './map-model.mjs';
import { placeLabels, chartFrame, quadrantLabels, leaderEnd, leaderShown, geometry } from './label-layout.mjs';

const { overlapArea, segmentsCross, segmentHitsBox, gapTo, insideBubble } = geometry;
// Every published map keeps the same promises, so each data file is checked.
const MARKETS = new URL('../data/markets/', import.meta.url);
const markets = fs.readdirSync(MARKETS).filter(f => f.endsWith('.json')).sort()
  .map(f => JSON.parse(fs.readFileSync(new URL(f, MARKETS), 'utf8')));

// Character-width stand-ins for the page's fonts (DM Sans 600 12.5px, DM Mono 11px / 10.5px).
const measure = (text, cls) => text.length * (cls === 'map-label' ? 7.2 : cls === 'quadrant-label' ? 7.2 : 6.6);
const rowsOf = doc => doc.companies.map(c => ({
  id: c.id, name: c.name, shortName: c.shortName, company: c.company, brand: c.brand, cls: c.class,
  valuation: c.lastRound.postMoneyUsd, raised: c.metrics?.totalRaisedUsd ?? null,
  conf: c.lastRound.confidence, valConf: c.lastRound.postMoneyConfidence ?? c.lastRound.confidence,
  raisedConf: c.metrics?.totalRaisedConfidence ?? null,
  scores: Object.fromEntries(Object.entries(c.axes).map(([k, v]) => [k, v.score])),
}));
const verticalAxes = doc => [doc.market.axes.y.key, doc.market.axes.yAlt?.key].filter(Boolean);

function layout(doc, width, axis, size) {
  configureCategories(doc.market.categories, doc.market.allDescription);
  const rows = rowsOf(doc), xKey = doc.market.axes.x.key;
  const frame = chartFrame(width, MAX_RADIUS);
  const { W, H, m, compact, maxRadius } = frame;
  const max = Math.max(0, ...rows.filter(c => c.cls !== 'platform').map(c => c[size] || 0)) || 1;
  const nodes = rows.map(c => ({
    id: c.id, name: labelFor(c), value: valueLabel(c, size),
    x: m.l + c.scores[xKey] / 100 * (W - m.l - m.r),
    y: H - m.b - c.scores[axis] / 100 * (H - m.t - m.b),
    r: markRadius(c, size, max, maxRadius),
  }));
  const fixed = quadrantLabels({ names: doc.market.quadrants?.[axis], W, H, m, compact, measure }).map(q => q.box);
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
      const mark = { x: o.x - o.r - 3, y: o.y - o.r - 3, w: 2 * o.r + 6, h: 2 * o.r + 6 };
      // A leader starting inside a bigger bubble has to leave it; it may cross no other.
      if (long && !insideBubble(a.node, o) && segmentHitsBox(a.node, end, mark)) problems.push(`${a.node.id}'s leader runs through ${o.id}'s mark`);
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

for (const doc of markets) {
  const id = doc.market.id, count = doc.companies.length;
  for (const width of [1320, 1276, 1000, 900, 760, 700, 500, 400, 343, 333]) {
    for (const axis of verticalAxes(doc)) {
      for (const size of ['valuation', 'raised', 'equal']) {
        test(`${id}: labels keep their promises at ${width}px · ${axis} · ${size}`, () => {
          const run = layout(doc, width, axis, size);
          assert.deepEqual(invariants(run), []);
          assert.equal(run.result.labels.size, count, 'every company is accounted for');
          assert.equal(run.result.hidden, [...run.result.labels.values()].filter(l => !l).length);
        });
      }
    }
  }

  test(`${id}: from 500px up, every company is named in every view`, () => {
    // Resizing the window or switching the bubble area must never drop a name.
    const missing = [];
    for (let width = 500; width <= 1400; width += 20) for (const axis of verticalAxes(doc)) for (const size of ['valuation', 'raised', 'equal']) {
      const { result } = layout(doc, width, axis, size);
      for (const [company, label] of result.labels) if (!label) missing.push(`${width}px ${axis}/${size}: ${company}`);
    }
    assert.deepEqual(missing, []);
  });
  test(`${id}: from a 1,280px window up, every figure shows beside its name`, () => {
    // The chart is 1,176px wide in a 1,280px window and stops growing at 1,320px.
    const missing = [];
    for (let width = 1176; width <= 1320; width += 16) for (const axis of verticalAxes(doc)) for (const size of ['valuation', 'raised']) {
      const { nodes, result } = layout(doc, width, axis, size);
      for (const node of nodes) if (node.value && !result.labels.get(node.id)?.full) missing.push(`${width}px ${axis}/${size}: ${node.id}`);
    }
    assert.deepEqual(missing, []);
  });
  test(`${id}: on phones at most two names give way (three on the very narrowest charts), and only in the densest views`, () => {
    // 333px is the chart on a 375px-wide phone; 375px and 400px are wider phones.
    for (const width of [333, 343, 375, 400]) for (const axis of verticalAxes(doc)) for (const size of ['valuation', 'raised', 'equal']) {
      assert.ok(layout(doc, width, axis, size).result.hidden <= (width <= 343 ? 3 : 2), `${width}px ${axis}/${size}`);
    }
  });
}

test('layout is deterministic', () => {
  const doc = markets[0];
  const a = layout(doc, 1000, doc.market.axes.y.key, 'valuation').result, b = layout(doc, 1000, doc.market.axes.y.key, 'valuation').result;
  assert.deepEqual([...a.labels], [...b.labels]);
});
