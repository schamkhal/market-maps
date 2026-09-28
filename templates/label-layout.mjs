// Label placement for the map, DOM-free so it can be tested in node.
// The page measures text with its own SVG text engine and passes that in as
// `measure`; the tests pass a character-width approximation.
//
// Guarantees, checked by label-layout.test.mjs:
//  - a placed label never overlaps another label or a quadrant name (≤ 12px²);
//  - a placed label never covers another company's mark;
//  - a leader line never runs through another mark or label;
//  - a label stays within reach of its own mark (a leader shows the way);
//  - on phone-width charts, leaders never cross and no label sits nearer
//    another company's mark than its own. Wider charts may relax those two
//    rules rather than drop a label.
// Labels may use the empty margin above and to the right of the plot.
// A label that tries close positions first, then farther ones, and still
// cannot meet the rules is left off (`null`); its mark keeps its tooltip,
// accessible name and profile.

const overlapArea = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
// The leader runs from the mark's centre to the nearest point of its label box.
export const leaderEnd = (node, box) => ({ x: clamp(node.x, box.x, box.x + box.w), y: clamp(node.y, box.y, box.y + box.h) });
function segmentsCross(a1, a2, b1, b2) {
  const turn = (p, q, r) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
  return turn(a1, a2, b1) * turn(a1, a2, b2) < 0 && turn(b1, b2, a1) * turn(b1, b2, a2) < 0;
}
// Does a leader line pass through a label box (not merely touch its edge)?
function segmentHitsBox(p, q, box) {
  const inside = t => { const x = p.x + (q.x - p.x) * t, y = p.y + (q.y - p.y) * t; return x > box.x + 1 && x < box.x + box.w - 1 && y > box.y + 1 && y < box.y + box.h - 1; };
  for (let t = .05; t < 1; t += .1) if (inside(t)) return true;
  return false;
}
const gapTo = (point, box) => { const end = leaderEnd(point, box); return Math.hypot(end.x - point.x, end.y - point.y) - point.r; };
export const geometry = { overlapArea, segmentsCross, segmentHitsBox, gapTo };
// A leader is drawn once the label sits clearly away from its mark.
export const leaderShown = (node, box, compact) => gapTo(node, box) > (compact ? 9 : 17);

// Chart frame for a given pixel width: the map is drawn at the frame's real
// width, so it re-lays out rather than scrolling sideways.
export function chartFrame(width, baseRadius = 40) {
  const compact = width < 700;
  const W = Math.max(300, Math.round(width));
  const H = compact ? Math.round(clamp(W * 1.4, 440, 600)) : Math.round(clamp(W * .46, 460, 560));
  const m = compact ? { l: 40, r: 14, t: 30, b: 62 } : { l: 74, r: 62, t: 39, b: 74 };
  const maxRadius = baseRadius * clamp(W / 1160, .55, 1.1);
  return { compact, W, H, m, maxRadius };
}

// Quadrant names sit in the plot's corners and occupy space labels must avoid.
export function quadrantLabels({ names, W, H, m, compact, measure }) {
  if (!names) return [];
  const inset = compact ? 6 : 10, size = compact ? 11 : 13;
  return [['topLeft', m.l + inset, m.t + inset + size, 'start'], ['topRight', W - m.r - inset, m.t + inset + size, 'end'], ['bottomLeft', m.l + inset, H - m.b - inset, 'start'], ['bottomRight', W - m.r - inset, H - m.b - inset, 'end']]
    .map(([key, x, y, anchor]) => {
      const text = String(names[key] ?? '').toUpperCase(), w = measure(text, 'quadrant-label');
      return { key, text, x, y, anchor, box: { x: anchor === 'end' ? x - w - 3 : x - 3, y: y - size, w: w + 6, h: size + 5 } };
    });
}

/**
 * @param nodes   [{ id, x, y, r, name, value }] — `value` is the second line
 * @param fixed   boxes labels must avoid (quadrant names)
 * @returns {{ labels: Map<string, {box, full, name, value, score} | null>, hidden: number }}
 */
export function placeLabels(args) {
  // Names come before values. When a name cannot be placed, the labels around
  // it give up their value line (it stays in the tooltip and profile) and the
  // layout runs again, until every name fits or nothing more can be freed.
  const nameOnly = new Set();
  let result = attempt(args, nameOnly);
  for (let round = 0; round < 4 && result.hidden; round++) {
    const missing = args.nodes.filter(node => !result.labels.get(node.id));
    const before = nameOnly.size;
    for (const miss of missing) for (const other of args.nodes) {
      if (Math.hypot(other.x - miss.x, other.y - miss.y) < 120 + 60 * round) nameOnly.add(other.id);
    }
    if (nameOnly.size === before) break;
    const next = attempt(args, nameOnly);
    if (next.hidden <= result.hidden) result = next;
  }
  return result;
}

function attempt({ nodes, W, H, m, compact, measure, fixed = [] }, nameOnly) {
  // Where a label may sit: the plot, plus the empty margin above it and to its
  // right. The left and bottom margins hold ticks and axis titles.
  const area = { left: m.l + 2, right: W - 4, top: 4, bottom: H - m.b - 2 };
  const outsidePlot = box => box.y < m.t || box.x + box.w > W - m.r;
  const marks = nodes.map(point => ({ x: point.x - point.r - 3, y: point.y - point.r - 3, w: 2 * point.r + 6, h: 2 * point.r + 6 }));
  const placed = new Map();
  const nodeById = new Map(nodes.map(node => [node.id, node]));
  const cost = (box, node, exclude) => {
    let value = 0;
    for (const [id, prior] of placed) if (id !== exclude) value += overlapArea(box, prior) * 20;
    for (const other of fixed) value += overlapArea(box, other) * 20;
    marks.forEach((mark, index) => { if (!(box.onMark && nodes[index] === node)) value += overlapArea(box, mark) * 12; });
    const end = leaderEnd(node, box);
    const length = Math.hypot(end.x - node.x, end.y - node.y);
    value += Math.max(0, length - node.r - 7) * .35;
    // A leader drawn through another label or mark reads as pointing at the wrong one.
    value += leaderConflicts(box, node, exclude) * 150;
    if (ambiguous(node, box)) value += 60;
    return value;
  };
  // Leaders that cross a mark, a label or another leader: this label's own
  // leader through others, and others' leaders through this label.
  function leaderConflicts(box, node, exclude, crossings = true) {
    const end = leaderEnd(node, box), long = Math.hypot(end.x - node.x, end.y - node.y) > node.r + 9;
    let count = 0;
    if (long) marks.forEach((mark, index) => { if (nodes[index] !== node && segmentHitsBox(node, end, mark)) count++; });
    for (const [id, prior] of placed) {
      if (id === exclude) continue;
      if (long && segmentHitsBox(node, end, prior)) count++;
      const other = nodeById.get(id), otherEnd = leaderEnd(other, prior);
      const otherLong = Math.hypot(otherEnd.x - other.x, otherEnd.y - other.y) > other.r + 9;
      if (otherLong && segmentHitsBox(other, otherEnd, box)) count++;
      if (crossings && long && otherLong && segmentsCross(node, end, other, otherEnd)) count++;
    }
    return count;
  }
  // A label must sit closer to its own mark than to any other, or a reader
  // will pair it with the wrong company. A drawn leader says which mark a
  // label belongs to, so a leadered label only needs to keep clear of others.
  const ambiguous = (node, box) => {
    const own = gapTo(node, box), limit = leaderShown(node, box, compact) ? 12 : own - 2;
    return nodes.some(other => other !== node && gapTo(other, box) < limit);
  };
  // Area this box shares with other labels and the quadrant names. Labels
  // may sit over empty chart, never over each other.
  const collision = (box, exclude) => {
    let area = 0;
    for (const [id, prior] of placed) if (id !== exclude) area += overlapArea(box, prior);
    for (const other of fixed) area += overlapArea(box, other);
    return area;
  };
  // Close positions first; a label that fits nowhere close tries farther
  // out, with a leader, before it is left off.
  const reach = compact ? [0, 4, 8, 14, 22, 32] : [0, 8, 16, 24, 36, 52, 72, 96];
  const farReach = compact ? [44, 58, 74] : [124, 156, 190];
  const nearLimit = compact ? 30 : 110, farLimit = compact ? 84 : 200;
  const candidatesFor = (node, w, h, steps) => {
    const gap = Math.max(node.r, 6) + (compact ? 4 : 7), list = [];
    for (const extra of steps) {
      const offsets = [[gap + extra, -h / 2], [-w - gap - extra, -h / 2], [-w / 2, -h - gap - extra], [-w / 2, gap + extra], [gap + extra, -h - gap - extra], [-w - gap - extra, -h - gap - extra], [gap + extra, gap + extra], [-w - gap - extra, gap + extra]];
      offsets.forEach(([dx, dy], index) => {
        const box = { x: node.x + dx, y: node.y + dy, w, h };
        const clamped = { x: clamp(box.x, area.left, area.right - w), y: clamp(box.y, area.top, area.bottom - h) };
        const placed = { ...box, ...clamped };
        // A spot inside the plot beats an equally good one in the margin.
        list.push({ ...placed, preference: extra * .45 + index * .35 + (Math.abs(box.x - clamped.x) + Math.abs(box.y - clamped.y)) * 3 + (outsidePlot(placed) ? 6 : 0) });
      });
    }
    // Last resort for a big bubble in a crowd: the label sits on the bubble itself.
    if (2 * node.r >= h + 4) list.push({ x: node.x - w / 2, y: node.y - h / 2, w, h, preference: 30, onMark: true });
    return list;
  };
  // The far pass also looks between the eight compass directions: sixteen
  // bearings, each box turned so its nearest edge faces the mark.
  const bearingsFor = (node, w, h, steps) => {
    const gap = Math.max(node.r, 6) + (compact ? 4 : 7), list = [];
    for (const extra of steps) for (let i = 0; i < 16; i++) {
      if (i % 2 === 0) continue;   // the compass directions are already covered
      const angle = i * Math.PI / 8, d = gap + extra, px = node.x + d * Math.cos(angle), py = node.y + d * Math.sin(angle);
      const box = { x: Math.cos(angle) > .38 ? px : Math.cos(angle) < -.38 ? px - w : px - w / 2, y: Math.sin(angle) > .38 ? py : Math.sin(angle) < -.38 ? py - h : py - h / 2, w, h };
      const clamped = { x: clamp(box.x, area.left, area.right - w), y: clamp(box.y, area.top, area.bottom - h) };
      const placed = { ...box, ...clamped };
      list.push({ ...placed, preference: extra * .45 + 3 + (Math.abs(box.x - clamped.x) + Math.abs(box.y - clamped.y)) * 3 + (outsidePlot(placed) ? 6 : 0) });
    }
    return list;
  };
  const tooFar = (node, box, limit = nearLimit) => { const end = leaderEnd(node, box); return Math.hypot(end.x - node.x, end.y - node.y) > node.r + limit; };
  const coversMark = (box, node) => nodes.some(other => other !== node && overlapArea(box, { x: other.x - other.r, y: other.y - other.r, w: 2 * other.r, h: 2 * other.r }) > 4);
  // A usable spot: no label overlap, no leader through a mark, label or
  // another leader, not over another company's mark, not nearer another
  // company's mark than its own, not far from its own. A wide chart may relax
  // leader crossings and nearness rather than lose a label; narrow ones may not.
  // `crossings`: leaders may not cross. `nearness`: the label must sit nearest
  // its own mark — always (true), never (false), or only when no leader is
  // drawn ('unlessLeader'), since a leader already shows which mark it names.
  const valid = (box, node, { crossings = true, nearness = true } = {}, limit = nearLimit) => collision(box, node.id) <= 12
    && !coversMark(box, node) && !tooFar(node, box, limit)
    && leaderConflicts(box, node, node.id, crossings) === 0
    && (nearness === false || (nearness === 'unlessLeader' && leaderShown(node, box, compact)) || !ambiguous(node, box));
  const STRICT = { crossings: true, nearness: true }, RELAXED = { crossings: false, nearness: false };
  // Phones keep leaders from crossing even in the last resort.
  const PHONE_LAST_RESORT = { crossings: true, nearness: 'unlessLeader' };
  // The first pass keeps labels close and, below 1,000px, strict. The far
  // pass, for labels the first could not place, reaches further and relaxes
  // crossings and nearness (on phones, nearness only).
  const best = (node, w, h, far = false) => {
    const steps = far ? [...reach, ...farReach] : reach;
    const scored = [...candidatesFor(node, w, h, steps), ...(far ? bearingsFor(node, w, h, steps) : [])]
      .map(box => ({ box, score: box.preference + cost(box, node, node.id) })).sort((a, b) => a.score - b.score);
    const passes = far ? [STRICT, compact ? PHONE_LAST_RESORT : RELAXED] : (W >= 1000 ? [STRICT, RELAXED] : [STRICT]);
    for (const rules of passes) {
      const hit = scored.find(({ box }) => valid(box, node, rules, far ? farLimit : nearLimit));
      if (hit) return { ...hit, collides: false };
    }
    return { ...scored[0], collides: true };
  };

  // Desktop places crowded marks first; phones place the biggest first, since
  // there some labels will not fit. Each label tries its full name + value
  // form; if that only fits by colliding, a name-only form competes with it.
  const crowd = n => nodes.filter(other => other !== n && Math.hypot(other.x - n.x, other.y - n.y) < 120).length;
  const ordered = [...nodes].sort(compact ? (a, b) => b.r - a.r || crowd(b) - crowd(a) : (a, b) => crowd(b) - crowd(a) || b.r - a.r);
  const labels = new Map();
  const choose = (node, far = false) => {
    const { name, value } = node;
    const nameWidth = measure(name, 'map-label');
    const compactForm = best(node, nameWidth + (compact ? 8 : 10), compact ? 17 : 20, far);
    let chosen = { ...compactForm, full: false };
    if (!compact && !nameOnly.has(node.id)) {
      const fullForm = best(node, Math.max(nameWidth, measure(value, 'value-label')) + 12, 36, far);
      if (!fullForm.collides && (compactForm.collides || fullForm.score <= compactForm.score + 40)) chosen = { ...fullForm, full: true };
    }
    return chosen.collides ? null : { box: chosen.box, full: chosen.full, score: chosen.score, name, value };
  };
  for (const node of ordered) {
    const label = choose(node);
    labels.set(node.id, label);
    if (label) placed.set(node.id, label.box);
  }
  // Refine: with every other label now known, re-place each one in turn.
  // Early choices were made blind to later ones; this lets them move, and lets
  // a label dropped earlier return if a gap has opened.
  for (let pass = 0; pass < 2; pass++) {
    let moved = false;
    for (const node of ordered) {
      const id = node.id, current = labels.get(id);
      placed.delete(id);
      const currentScore = current ? cost(current.box, node, id) + (current.box.preference ?? 0) : Infinity;
      const next = choose(node);
      if (next && next.score + 1 < currentScore) { labels.set(id, next); moved = true; }
      const kept = labels.get(id);
      if (kept) placed.set(id, kept.box);
    }
    if (!moved) break;
  }
  // Far pass: every label still missing tries farther positions before it is dropped.
  const put = (id, label) => { labels.set(id, label); if (label) placed.set(id, label.box); else placed.delete(id); };
  for (const node of ordered) {
    if (!labels.get(node.id)) put(node.id, choose(node, true));
  }
  // Repair: a label that still has no room may borrow a neighbour's spot, as
  // long as the neighbour then finds another. Either both fit or nothing moves.
  for (const node of ordered) {
    if (labels.get(node.id)) continue;
    const neighbours = nodes.filter(other => other !== node && labels.get(other.id) && Math.hypot(other.x - node.x, other.y - node.y) < (compact ? 90 : 160))
      .sort((a, b) => Math.hypot(a.x - node.x, a.y - node.y) - Math.hypot(b.x - node.x, b.y - node.y));
    for (const other of neighbours) {
      const theirs = labels.get(other.id);
      put(other.id, null);
      const mine = choose(node, true);
      if (mine) {
        put(node.id, mine);
        const moved = choose(other, true);
        if (moved) { put(other.id, moved); break; }
        put(node.id, null);
      }
      put(other.id, theirs);
    }
  }
  const hidden = [...labels.values()].filter(label => !label).length;

  // Untangle: where two leader lines cross, try swapping their labels' places.
  // A swap must leave both labels valid, not merely lower the total cost.
  const labelled = nodes.filter(node => labels.get(node.id));
  const total = () => {
    let sum = 0;
    for (const [id, box] of placed) sum += cost(box, nodeById.get(id), id) + collision(box, id) * 20;
    return sum;
  };
  const moveTo = (box, target, node) => ({ ...box, x: clamp(target.x + target.w / 2 < node.x ? target.x + target.w - box.w : target.x, area.left, area.right - box.w), y: clamp(target.y + (target.h - box.h) / 2, area.top, area.bottom - box.h) });
  for (let pass = 0; pass < 3; pass++) {
    let swapped = false;
    for (let i = 0; i < labelled.length; i++) for (let j = i + 1; j < labelled.length; j++) {
      const a = labelled[i], b = labelled[j], la = labels.get(a.id), lb = labels.get(b.id);
      if (!segmentsCross(a, leaderEnd(a, la.box), b, leaderEnd(b, lb.box))) continue;
      const before = total();
      const nextA = moveTo(la.box, lb.box, b), nextB = moveTo(lb.box, la.box, a);
      placed.set(a.id, nextA); placed.set(b.id, nextB);
      if (!ambiguous(a, nextA) && !ambiguous(b, nextB) && valid(nextA, a, RELAXED) && valid(nextB, b, RELAXED) && total() < before) {
        la.box = nextA; lb.box = nextB; swapped = true;
      } else { placed.set(a.id, la.box); placed.set(b.id, lb.box); }
    }
    if (!swapped) break;
  }
  return { labels, hidden };
}
