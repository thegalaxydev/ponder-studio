export const FORMAT = 'ponderstudio';
export const VERSION = 1;
export const TICKS_PER_SECOND = 20;
export const SHOW_FADE = 15;

export const DIRECTIONS = ['down', 'up', 'north', 'south', 'west', 'east'];
export const PALETTE = ['white', 'black', 'red', 'green', 'blue', 'slow', 'medium', 'fast', 'input', 'output'];
export const POINTING = ['down', 'up', 'left', 'right'];
export const TRACKS = [
  { id: 'structure', label: 'Structure' },
  { id: 'text', label: 'Text' },
  { id: 'highlights', label: 'Highlights' },
  { id: 'camera', label: 'Camera' },
  { id: 'kinetics', label: 'Kinetics' }
];

export const ACTIONS = {
  show: { label: 'Reveal', track: 'structure', selection: true, defaults: { direction: 'down' } },
  hide: { label: 'Hide', track: 'structure', selection: true, defaults: { direction: 'up' } },
  block_state: { label: 'Change block state', track: 'structure', selection: true, defaults: { state: 'minecraft:stone', particles: false } },
  move: { label: 'Move section', track: 'structure', selection: true, duration: true, defaults: { offset: [0, 1, 0], duration: 20 } },
  rotate: { label: 'Rotate section', track: 'structure', selection: true, duration: true, defaults: { rotation: [0, 90, 0], duration: 20 } },
  text: { label: 'Caption', track: 'text', duration: true, defaults: { text: 'Describe this step', duration: 60, placeNearTarget: true, color: null, keyframe: true } },
  outline: { label: 'Highlight', track: 'highlights', selection: true, duration: true, defaults: { color: 'green', duration: 60 } },
  input: { label: 'Interaction hint', track: 'highlights', duration: true, defaults: { pointing: 'down', click: 'right', item: null, sneaking: false, ctrl: false, duration: 40 } },
  rotate_camera: { label: 'Rotate camera', track: 'camera', defaults: { degrees: 90 } },
  keyframe: { label: 'Keyframe', track: 'camera', defaults: {} },
  kinetic: { label: 'Kinetic speed', track: 'kinetics', selection: true, defaults: { speed: 32 } }
};

export function trackOf(action) {
  return ACTIONS[action.type]?.track ?? 'structure';
}

export function durationOf(action) {
  if (ACTIONS[action.type]?.duration) return Math.max(0, action.duration ?? 0);
  if (action.type === 'show' || action.type === 'hide') return SHOW_FADE;
  return 0;
}

export function seconds(ticks) {
  return (ticks / TICKS_PER_SECOND).toFixed(2).replace(/\.?0+$/, '');
}

export function newDocument({ namespace, sceneId, title, component, structureFile, schematic, size = 5 }) {
  return {
    format: FORMAT,
    version: VERSION,
    scene: { namespace, id: sceneId, title, component, tags: [] },
    structure: { file: structureFile, schematic },
    basePlate: { x: 0, z: 0, size, show: true },
    scale: null,
    length: null,
    selections: [],
    actions: [],
    items: [],
    compatibility: { studio: VERSION },
    export: {}
  };
}

const SCENE_ID = /^[a-z0-9_./-]+$/;
const RL = /^[a-z0-9_.-]+:[a-z0-9_./-]+$/;

export function validateDocument(doc) {
  const problems = [];
  if (!doc || typeof doc !== 'object') return ['The document is not a JSON object'];
  if (doc.format !== FORMAT) problems.push(`format must be "${FORMAT}"`);
  if (doc.version !== VERSION) problems.push(`version ${doc.version} is not supported (this Ponder Studio reads version ${VERSION})`);
  const s = doc.scene ?? {};
  if (!SCENE_ID.test(s.id ?? '')) problems.push('scene.id must use lowercase letters, digits, underscores, dots, dashes and slashes');
  if (!/^[a-z0-9_.-]+$/.test(s.namespace ?? '')) problems.push('scene.namespace must be the mod id');
  if (!RL.test(s.component ?? '')) problems.push('scene.component must be an item id like create:cogwheel');
  if (typeof s.title !== 'string' || !s.title.trim()) problems.push('scene.title is required');
  if (typeof doc.structure?.file !== 'string') problems.push('structure.file is required');
  const ids = new Set();
  for (const sel of doc.selections ?? []) {
    if (ids.has(sel.id)) problems.push(`selection id ${sel.id} is used twice`);
    ids.add(sel.id);
  }
  const actionIds = new Set();
  for (const a of doc.actions ?? []) {
    if (!ACTIONS[a.type]) problems.push(`action ${a.id}: unknown type ${a.type}`);
    if (!Number.isInteger(a.at) || a.at < 0) problems.push(`action ${a.id}: at must be a whole number of ticks`);
    if (actionIds.has(a.id)) problems.push(`action id ${a.id} is used twice`);
    actionIds.add(a.id);
  }
  return problems;
}

export function boxesOf(doc, action) {
  if (Array.isArray(action.boxes)) return action.boxes;
  const sel = (doc.selections ?? []).find((s) => s.id === action.selection);
  return sel ? sel.boxes : null;
}

export function normalizeBox(b) {
  return [Math.min(b[0], b[3]), Math.min(b[1], b[4]), Math.min(b[2], b[5]), Math.max(b[0], b[3]), Math.max(b[1], b[4]), Math.max(b[2], b[5])];
}

export function* boxPositions(boxes) {
  for (const raw of boxes) {
    const b = normalizeBox(raw);
    for (let x = b[0]; x <= b[3]; x++) for (let y = b[1]; y <= b[4]; y++) for (let z = b[2]; z <= b[5]; z++) yield [x, y, z];
  }
}

export function sortedActions(doc) {
  return (doc.actions ?? []).map((a, i) => ({ a, i })).sort((p, q) => p.a.at - q.a.at || p.i - q.i).map((p) => p.a);
}

export function endTick(doc) {
  const last = (doc.actions ?? []).reduce((m, a) => Math.max(m, a.at + durationOf(a)), 0);
  return Number.isInteger(doc.length) && doc.length > 0 ? doc.length : last + 20;
}

export function diagnose(doc, structure) {
  const out = [];
  const bounds = structure?.bounds();
  for (const a of doc.actions ?? []) {
    const meta = ACTIONS[a.type];
    if (!meta) {
      out.push({ action: a.id, level: 'error', message: `Unknown action type ${a.type}` });
      continue;
    }
    if (meta.selection) {
      const boxes = boxesOf(doc, a);
      if (!boxes) {
        out.push({ action: a.id, level: 'error', message: a.selection ? `The selection ${a.selection} no longer exists` : 'Choose blocks for this action' });
        continue;
      }
      if (!boxes.length) {
        out.push({ action: a.id, level: 'error', message: 'The selection is empty' });
        continue;
      }
      if (structure) {
        let inside = 0;
        let filled = 0;
        let total = 0;
        for (const [x, y, z] of boxPositions(boxes)) {
          total++;
          if (x >= bounds.min[0] && y >= bounds.min[1] && z >= bounds.min[2] && x <= bounds.max[0] && y <= bounds.max[1] && z <= bounds.max[2]) inside++;
          if (structure.blockAt(x, y, z)) filled++;
          if (total > 200000) break;
        }
        if (inside < total) out.push({ action: a.id, level: 'warning', message: `${total - inside} selected position${total - inside === 1 ? ' is' : 's are'} outside the structure` });
        if (!filled) out.push({ action: a.id, level: 'warning', message: 'The selection covers no blocks; the structure may have changed since it was chosen' });
      }
    }
    if (a.type === 'kinetic' && !Number.isFinite(a.speed)) out.push({ action: a.id, level: 'error', message: 'Set a speed in RPM' });
    if ((a.type === 'text' || a.type === 'input') && a.anchor && ['block', 'top', 'face'].includes(a.anchor.kind) && structure) {
      const [x, y, z] = a.anchor.pos;
      if (!structure.blockAt(x, y, z)) out.push({ action: a.id, level: 'warning', message: `The anchor block at ${x} ${y} ${z} is empty` });
    }
    if (a.type === 'text' && !String(a.text ?? '').trim()) out.push({ action: a.id, level: 'warning', message: 'The caption has no text' });
    if (a.type === 'input' && (!a.anchor || a.anchor.kind === 'none')) out.push({ action: a.id, level: 'error', message: 'An interaction hint needs a block, face or point' });
  }
  return out;
}

const TRANSPORT_FIELDS = {
  show: ['direction'],
  hide: ['direction'],
  block_state: ['state', 'particles'],
  move: ['offset', 'duration'],
  rotate: ['rotation', 'duration'],
  text: ['text', 'duration', 'anchor', 'color', 'placeNearTarget', 'keyframe', 'screenY'],
  outline: ['color', 'duration'],
  input: ['anchor', 'pointing', 'duration', 'item', 'click', 'sneaking', 'ctrl'],
  rotate_camera: ['degrees'],
  keyframe: [],
  kinetic: ['speed']
};

export function compileStoryboard(doc) {
  const actions = [];
  for (const a of sortedActions(doc)) {
    const meta = ACTIONS[a.type];
    if (!meta) continue;
    const out = { id: a.id, type: a.type, at: a.at };
    if (meta.selection) {
      const boxes = boxesOf(doc, a);
      if (!boxes || !boxes.length) continue;
      out.selection = boxes.map(normalizeBox);
      out.section = a.section ?? a.selection ?? a.id;
    }
    for (const f of TRANSPORT_FIELDS[a.type]) if (a[f] !== undefined) out[f] = a[f];
    actions.push(out);
  }
  return {
    format: 1,
    namespace: doc.scene.namespace,
    sceneId: doc.scene.id,
    title: doc.scene.title,
    component: doc.scene.component,
    basePlate: { x: doc.basePlate?.x ?? 0, z: doc.basePlate?.z ?? 0, size: doc.basePlate?.size ?? 5 },
    showBasePlate: doc.basePlate?.show !== false,
    ...(doc.scale ? { scale: doc.scale } : {}),
    end: endTick(doc),
    actions
  };
}

export function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function nextId(prefix, existing) {
  let n = 1;
  const used = new Set(existing);
  while (used.has(`${prefix}${n}`)) n++;
  return `${prefix}${n}`;
}
