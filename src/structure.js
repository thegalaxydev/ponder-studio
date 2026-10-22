import { T, clone, get, readNbtFile, set, tag, writeNbtFile } from './nbt.js';

export function stateKey(name, props) {
  const keys = Object.keys(props ?? {}).sort();
  return keys.length ? `${name}[${keys.map((k) => `${k}=${props[k]}`).join(',')}]` : name;
}

export function parseState(text) {
  const m = /^\s*([a-z0-9_.-]+:)?([a-z0-9_./-]+)\s*(?:\[(.*)\])?\s*$/.exec(text);
  if (!m) throw new Error(`${text} is not a block state like minecraft:oak_log[axis=y]`);
  const name = `${m[1] ?? 'minecraft:'}${m[2]}`;
  const props = {};
  if (m[3] && m[3].trim()) {
    for (const part of m[3].split(',')) {
      const [k, v] = part.split('=').map((x) => x?.trim());
      if (!k || v === undefined || v === '') throw new Error(`${part} is not a property like axis=y`);
      props[k] = v;
    }
  }
  return { name, props };
}

function paletteEntryState(entry) {
  const name = get(entry, 'Name')?.v ?? 'minecraft:air';
  const props = {};
  const p = get(entry, 'Properties');
  if (p && p.t === T.COMPOUND) for (const [k, v] of p.v) props[k] = String(v.v);
  return { name, props };
}

function posKey(x, y, z) {
  return `${x},${y},${z}`;
}

export class Structure {
  constructor(file) {
    this.file = file;
    this.root = file.root;
    if (this.root.t !== T.COMPOUND) throw new Error('The structure file is not an NBT compound');
    this.palettes = get(this.root, 'palettes');
    this.palette = get(this.root, 'palette') ?? (this.palettes?.v?.[0] ?? null);
    if (!this.palette) {
      this.palette = tag.list(T.COMPOUND, []);
      set(this.root, 'palette', this.palette);
    }
    this.blocks = get(this.root, 'blocks');
    if (!this.blocks) {
      this.blocks = tag.list(T.COMPOUND, []);
      set(this.root, 'blocks', this.blocks);
    }
    this.reindex();
  }

  static async load(bytes) {
    return new Structure(await readNbtFile(bytes));
  }

  static empty(size = [5, 3, 5], dataVersion = 3955) {
    const root = tag.compound([
      ['size', tag.list(T.INT, size.map((n) => tag.int(n)))],
      ['entities', tag.list(T.COMPOUND, [])],
      ['blocks', tag.list(T.COMPOUND, [])],
      ['palette', tag.list(T.COMPOUND, [])],
      ['DataVersion', tag.int(dataVersion)]
    ]);
    return new Structure({ name: '', root, compressed: true });
  }

  async toBytes() {
    return writeNbtFile({ name: this.file.name, root: this.root }, this.file.compressed !== false);
  }

  reindex() {
    this.index = new Map();
    this.paletteKeys = new Map();
    this.paletteStates = this.palette.v.map(paletteEntryState);
    this.paletteStates.forEach((s, i) => {
      const k = stateKey(s.name, s.props);
      if (!this.paletteKeys.has(k)) this.paletteKeys.set(k, i);
    });
    this.blocks.v.forEach((b, i) => {
      const pos = get(b, 'pos');
      if (!pos || pos.v.length < 3) return;
      this.index.set(posKey(pos.v[0].v, pos.v[1].v, pos.v[2].v), i);
    });
  }

  get size() {
    const s = get(this.root, 'size');
    return s ? s.v.map((x) => x.v) : [0, 0, 0];
  }

  set size(v) {
    set(this.root, 'size', tag.list(T.INT, v.map((n) => tag.int(n))));
  }

  get dataVersion() {
    return get(this.root, 'DataVersion')?.v ?? null;
  }

  get entities() {
    return get(this.root, 'entities')?.v ?? [];
  }

  *positions() {
    for (const b of this.blocks.v) {
      const pos = get(b, 'pos');
      if (!pos) continue;
      yield [pos.v[0].v, pos.v[1].v, pos.v[2].v, b];
    }
  }

  entryAt(x, y, z) {
    const i = this.index.get(posKey(x, y, z));
    return i === undefined ? null : this.blocks.v[i];
  }

  blockAt(x, y, z) {
    const b = this.entryAt(x, y, z);
    if (!b) return null;
    const pi = get(b, 'state')?.v ?? 0;
    const state = this.paletteStates[pi] ?? { name: 'minecraft:air', props: {} };
    return { name: state.name, props: { ...state.props }, key: stateKey(state.name, state.props), paletteIndex: pi, nbt: get(b, 'nbt') ?? null };
  }

  snapshot(x, y, z) {
    const b = this.blockAt(x, y, z);
    return b ? { key: b.key, nbt: b.nbt ? clone(b.nbt) : null, entry: clone(this.entryAt(x, y, z)) } : null;
  }

  paletteIndexFor(key) {
    if (this.paletteKeys.has(key)) return this.paletteKeys.get(key);
    const { name, props } = parseState(key);
    const entry = [['Name', tag.string(name)]];
    const names = Object.keys(props);
    if (names.length) entry.push(['Properties', tag.compound(names.map((k) => [k, tag.string(props[k])]))]);
    this.palette.v.push(tag.compound(entry));
    const i = this.palette.v.length - 1;
    this.paletteStates.push({ name, props });
    this.paletteKeys.set(stateKey(name, props), i);
    if (this.palettes) for (const p of this.palettes.v.slice(1)) p.v.push(clone(this.palette.v[i]));
    return i;
  }

  put(x, y, z, snap) {
    const k = posKey(x, y, z);
    const i = this.index.get(k);
    if (!snap) {
      if (i === undefined) return;
      this.blocks.v.splice(i, 1);
      this.reindexBlocks();
      return;
    }
    const pi = this.paletteIndexFor(snap.key);
    if (snap.entry) {
      const restored = clone(snap.entry);
      set(restored, 'state', tag.int(pi));
      if (i !== undefined) this.blocks.v[i] = restored;
      else {
        this.blocks.v.push(restored);
        this.index.set(k, this.blocks.v.length - 1);
        this.grow(x, y, z);
      }
      return;
    }
    if (i !== undefined) {
      const b = this.blocks.v[i];
      set(b, 'state', tag.int(pi));
      const old = get(b, 'nbt');
      if (snap.nbt) set(b, 'nbt', clone(snap.nbt));
      else if (old) b.v.splice(b.v.findIndex(([n]) => n === 'nbt'), 1);
      return;
    }
    const entry = [
      ['pos', tag.list(T.INT, [tag.int(x), tag.int(y), tag.int(z)])],
      ['state', tag.int(pi)]
    ];
    if (snap.nbt) entry.push(['nbt', clone(snap.nbt)]);
    this.blocks.v.push(tag.compound(entry));
    this.index.set(k, this.blocks.v.length - 1);
    this.grow(x, y, z);
  }

  reindexBlocks() {
    this.index = new Map();
    this.blocks.v.forEach((b, i) => {
      const pos = get(b, 'pos');
      if (pos) this.index.set(posKey(pos.v[0].v, pos.v[1].v, pos.v[2].v), i);
    });
  }

  grow(x, y, z) {
    const [sx, sy, sz] = this.size;
    const next = [Math.max(sx, x + 1), Math.max(sy, y + 1), Math.max(sz, z + 1)];
    if (next[0] !== sx || next[1] !== sy || next[2] !== sz) this.size = next;
  }

  bounds() {
    const [sx, sy, sz] = this.size;
    return { min: [0, 0, 0], max: [sx - 1, sy - 1, sz - 1] };
  }

  usedStates() {
    const counts = new Map();
    for (const [, , , b] of this.positions()) {
      const pi = get(b, 'state')?.v ?? 0;
      const s = this.paletteStates[pi];
      if (!s) continue;
      const k = stateKey(s.name, s.props);
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    return counts;
  }
}

export class History {
  constructor(structure, onChange = () => {}) {
    this.structure = structure;
    this.undoStack = [];
    this.redoStack = [];
    this.onChange = onChange;
  }

  apply(label, changes) {
    const diff = [];
    for (const c of changes) {
      const before = this.structure.snapshot(c.x, c.y, c.z);
      const after = c.after;
      if (JSON.stringify(before?.key ?? null) === JSON.stringify(after?.key ?? null) && !c.nbtChanged) continue;
      diff.push({ x: c.x, y: c.y, z: c.z, before, after });
      this.structure.put(c.x, c.y, c.z, after);
    }
    if (!diff.length) return null;
    this.undoStack.push({ label, diff });
    if (this.undoStack.length > 200) this.undoStack.shift();
    this.redoStack = [];
    this.onChange();
    return diff;
  }

  undo() {
    const e = this.undoStack.pop();
    if (!e) return null;
    for (const d of [...e.diff].reverse()) this.structure.put(d.x, d.y, d.z, d.before);
    this.redoStack.push(e);
    this.onChange();
    return e.label;
  }

  redo() {
    const e = this.redoStack.pop();
    if (!e) return null;
    for (const d of e.diff) this.structure.put(d.x, d.y, d.z, d.after);
    this.undoStack.push(e);
    this.onChange();
    return e.label;
  }

  get canUndo() {
    return this.undoStack.length > 0;
  }

  get canRedo() {
    return this.redoStack.length > 0;
  }
}
