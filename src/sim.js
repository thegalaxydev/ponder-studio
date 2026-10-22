import { SHOW_FADE, boxesOf, boxPositions, durationOf, sortedActions } from './doc.js';
import { parseState, stateKey } from './structure.js';

const key = (x, y, z) => `${x},${y},${z}`;

export function simulate(doc, structure, tick) {
  const visible = new Set();
  const states = new Map();
  const speeds = new Map();
  const offsets = new Map();
  const texts = [];
  const outlines = [];
  const inputs = [];
  let camera = 0;
  if (doc.basePlate?.show !== false) {
    const bp = doc.basePlate ?? { x: 0, z: 0, size: 5 };
    for (let x = bp.x; x < bp.x + bp.size; x++) for (let z = bp.z; z < bp.z + bp.size; z++) if (structure.blockAt(x, 0, z)) visible.add(key(x, 0, z));
  }
  for (const a of sortedActions(doc)) {
    if (a.at > tick) break;
    const boxes = boxesOf(doc, a);
    const elapsed = tick - a.at;
    const dur = durationOf(a);
    switch (a.type) {
      case 'show':
        if (boxes) for (const [x, y, z] of boxPositions(boxes)) if (structure.blockAt(x, y, z)) visible.add(key(x, y, z));
        break;
      case 'hide':
        if (boxes && elapsed >= SHOW_FADE) for (const [x, y, z] of boxPositions(boxes)) visible.delete(key(x, y, z));
        break;
      case 'block_state':
        if (boxes) {
          let st;
          try {
            st = parseState(a.state);
          } catch {
            st = null;
          }
          if (st) for (const [x, y, z] of boxPositions(boxes)) states.set(key(x, y, z), stateKey(st.name, st.props));
        }
        break;
      case 'kinetic':
        if (boxes) for (const [x, y, z] of boxPositions(boxes)) speeds.set(key(x, y, z), a.speed);
        break;
      case 'move':
        if (boxes) {
          const f = dur ? Math.min(1, elapsed / dur) : 1;
          for (const [x, y, z] of boxPositions(boxes)) {
            const prev = offsets.get(key(x, y, z)) ?? [0, 0, 0];
            offsets.set(key(x, y, z), [prev[0] + a.offset[0] * f, prev[1] + a.offset[1] * f, prev[2] + a.offset[2] * f]);
          }
        }
        break;
      case 'rotate_camera':
        camera += a.degrees;
        break;
      case 'text':
        if (elapsed < dur) texts.push(a);
        break;
      case 'outline':
        if (elapsed < dur && boxes) outlines.push({ action: a, boxes });
        break;
      case 'input':
        if (elapsed < dur) inputs.push(a);
        break;
      default:
        break;
    }
  }
  return { visible, states, speeds, offsets, texts, outlines, inputs, camera };
}

export function anchorPoint(anchor) {
  if (!anchor) return null;
  const p = anchor.pos ?? [0, 0, 0];
  switch (anchor.kind) {
    case 'block':
      return [p[0] + 0.5, p[1] + 0.5, p[2] + 0.5];
    case 'top':
      return [p[0] + 0.5, p[1] + 1, p[2] + 0.5];
    case 'face': {
      const n = { up: [0, 1, 0], down: [0, -1, 0], north: [0, 0, -1], south: [0, 0, 1], west: [-1, 0, 0], east: [1, 0, 0] }[anchor.face ?? 'up'];
      return [p[0] + 0.5 + n[0] * 0.5, p[1] + 0.5 + n[1] * 0.5, p[2] + 0.5 + n[2] * 0.5];
    }
    case 'point':
      return anchor.point;
    default:
      return null;
  }
}
