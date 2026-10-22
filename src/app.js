import { ACTIONS, DIRECTIONS, PALETTE, POINTING, TRACKS, boxesOf, compileStoryboard, diagnose, durationOf, endTick, newDocument, nextId, normalizeBox, seconds, stableJson, validateDocument } from './doc.js';
import { History, Structure, parseState, stateKey } from './structure.js';
import { Viewport, boxLines, colorFor, shapeFor } from './render.js';
import { Atlas } from './atlas.js';
import { bakeState, boxGeometry, tintFor } from './blockmodel.js';
import { Timeline } from './timeline.js';
import { nbtInspector } from './inspector.js';
import { simulate, anchorPoint } from './sim.js';
import { DOCS_DIR, LOCK_FILE, pickAdapter, planExport, structureProblem } from './codegen.js';
import { b64ToBytes, bytesToB64, button, checkbox, clear, confirmDialog, field, form, h, menu, modal, numberInput, select, textInput } from './ui.js';
import { importJava } from './importer.js';
import { listFiles } from './files.js';

const M = 'ext.galaxy.ponder-studio.';
const VERIFIED = { create: '6.0.10', ponder: '1.0.82+mc1.21.1' };
const ANIMATED_PARTS = {
  'create:powered_shaft': (props) => [['create:shaft', { axis: props?.axis ?? 'y' }]]
};
const swatchColors = new Map();
const key = (x, y, z) => `${x},${y},${z}`;
const unkey = (k) => k.split(',').map(Number);

class Studio {
  constructor(root, ctx) {
    this.root = root;
    this.ctx = ctx;
    this.mode = 'build';
    this.tool = 'select';
    this.brush = 'minecraft:stone';
    this.selection = new Set();
    this.lastPick = null;
    this.hover = null;
    this.activeAction = null;
    this.layer = { mode: 'all', y: 0 };
    this.time = 0;
    this.playing = false;
    this.speed = 1;
    this.ghosts = true;
    this.leftTab = 'palette';
    this.blocks = [];
    this.items = [];
    this.registryNote = '';
    this.structure = null;
    this.doc = null;
    this.docHistory = { undo: [], redo: [] };
    this.dirty = { structure: false, doc: false };
    this.mtime = { structure: null, doc: null };
    this.mc = { status: null, state: null, error: null, busy: false };
    this.clipboard = null;
    this.paletteFilter = '';
    this.externalChange = null;
    this.atlas = new Atlas();
    this.models = {};
    this.blockDefs = new Map();
    this.baked = new Map();
    this.wanted = new Map();
    this.loadingModels = false;
    this.textureError = null;
  }

  geometry(name, props) {
    const k = stateKey(name, props);
    let g = this.baked.get(k);
    if (g) return g;
    const def = this.blockDefs.get(k);
    if (def) {
      g = bakeState(def, this.models);
      for (const [extraName, extraProps] of ANIMATED_PARTS[name]?.(props) ?? []) {
        const extra = this.geometry(extraName, extraProps);
        if (!extra.modelled) return extra;
        g = { ...g, faces: [...g.faces, ...extra.faces], boxes: [...g.boxes, ...extra.boxes] };
      }
      if (!g.modelled) {
        const shape = shapeFor(name, props);
        g = boxGeometry(shape.boxes, g.particle, shape.full);
      }
      this.baked.set(k, g);
      return g;
    }
    if (!this.textureError) this.wanted.set(k, { name, properties: props ?? {} });
    const shape = shapeFor(name, props);
    return boxGeometry(shape.boxes, null, shape.full);
  }

  async loadModels() {
    if (this.loadingModels || !this.wanted.size || this.textureError) return;
    this.loadingModels = true;
    const batch = [...this.wanted.entries()].slice(0, 256);
    for (const [k] of batch) this.wanted.delete(k);
    try {
      const r = await modsmith.call('assets.blocks', { blocks: batch.map(([, b]) => b) });
      Object.assign(this.models, r.models ?? {});
      Object.assign(this.atlas.connected, r.connected ?? {});
      await this.atlas.add(r.images ?? {});
      (r.blocks ?? []).forEach((b, i) => {
        this.blockDefs.set(batch[i][0], b);
        const particle = b.parts?.map((p) => this.models[p.model]?.textures?.particle).find(Boolean);
        const average = this.atlas.rect(particle)?.average;
        if (average && !swatchColors.has(b.name)) swatchColors.set(b.name, average);
      });
      this.baked.clear();
    } catch (e) {
      this.textureError = /permission to use assets\.blocks|Unknown method/.test(e.message) ? 'Block textures need Modsmith 0.1.16 or newer' : `Block textures are unavailable: ${e.message}`;
      this.wanted.clear();
    } finally {
      this.loadingModels = false;
    }
    if (this.structure) this.refresh();
  }

  async boot({ structureFile, docFile }) {
    this.root.replaceChildren(h('div', { class: 'loading' }, 'Loading Ponder Studio…'));
    try {
      if (docFile) {
        await this.loadDoc(docFile);
        await this.loadStructure(this.doc.structure.file);
      } else {
        await this.loadStructure(structureFile);
        this.docs = await this.findDocs();
        const match = this.docs.find((d) => d.doc.structure?.file === structureFile);
        if (match) await this.loadDoc(match.file);
      }
    } catch (e) {
      this.root.replaceChildren(h('div', { class: 'fatal' }, h('h2', {}, 'Ponder Studio could not open this file'), h('p', {}, e.message)));
      return;
    }
    this.layout();
    this.loadRegistry();
    this.refreshMinecraft();
    modsmith.onBridgeEvent((event, data) => {
      if (event === `${M}state`) {
        this.mc.state = data;
        this.renderToolbar();
        this.renderTimeline();
      }
    });
    modsmith.onFilesChanged(() => this.checkExternal());
    modsmith.onThemeChange(() => this.viewport?.setBackground(getComputedStyle(document.documentElement).getPropertyValue('--workspace') || getComputedStyle(document.documentElement).getPropertyValue('--bg')));
    window.addEventListener('keydown', (e) => this.onKey(e));
    this.frameCamera();
    this.refresh();
  }

  async readText(file) {
    const r = await modsmith.readFile(file);
    if (r.binary) throw new Error(`${file} is not a text file`);
    return r;
  }

  async loadStructure(file) {
    const r = await modsmith.readFile(file);
    const bytes = r.binary ? b64ToBytes(r.content) : new TextEncoder().encode(r.content);
    this.structure = await Structure.load(bytes);
    this.structureFile = file;
    this.mtime.structure = r.mtime;
    this.history = new History(this.structure, () => {
      this.dirty.structure = true;
      this.refresh();
    });
    this.dirty.structure = false;
  }

  async loadDoc(file) {
    const r = await this.readText(file);
    const doc = JSON.parse(r.content);
    const problems = validateDocument(doc);
    if (problems.length) throw new Error(`${file}: ${problems.join('; ')}`);
    this.doc = doc;
    this.docFile = file;
    this.mtime.doc = r.mtime;
    this.dirty.doc = false;
    this.docHistory = { undo: [], redo: [] };
    this.mode = 'storyboard';
  }

  async findDocs() {
    let files = [];
    try {
      files = await listFiles(DOCS_DIR, '.ponderstudio.json');
    } catch {
      return [];
    }
    const out = [];
    for (const f of files) {
      try {
        out.push({ file: f, doc: JSON.parse((await this.readText(f)).content) });
      } catch (e) {
        out.push({ file: f, doc: null, error: e.message });
      }
    }
    return out;
  }

  async loadRegistry() {
    try {
      const idx = await modsmith.call('registry.index', {});
      this.blocks = idx.blocks ?? [];
      this.items = idx.items ?? [];
      this.registryNote = idx.pending ? 'Downloading Minecraft data for the block list…' : '';
      this.blockIds = new Set(this.blocks.map((b) => b.id));
      this.renderLists();
      this.renderLeft();
      this.renderRight();
      if (idx.pending) setTimeout(() => this.loadRegistry(), 4000);
    } catch (e) {
      this.registryNote = `The block list is unavailable: ${e.message}`;
      this.renderLeft();
    }
  }

  layout() {
    this.toolbar = h('header', { class: 'toolbar' });
    this.left = h('aside', { class: 'left' });
    this.right = h('aside', { class: 'right' });
    this.canvas = h('canvas', { class: 'viewport' });
    this.labels = h('div', { class: 'labels' });
    this.badge = h('div', { class: 'badge' });
    this.layerBar = h('div', { class: 'layer-bar' });
    this.notice = h('div', { class: 'notice-area' });
    this.center = h('section', { class: 'center' }, this.canvas, this.labels, this.badge, this.layerBar, this.notice);
    this.timelineEl = h('div', { class: 'timeline' });
    this.splitter = h('div', { class: 'splitter', title: 'Drag to resize the timeline' });
    this.bottom = h('footer', { class: 'bottom' }, this.splitter, this.timelineEl);
    this.datalists = h('div', { hidden: true });
    clear(this.root, this.toolbar, h('div', { class: 'main' }, this.left, this.center, this.right), this.bottom, this.datalists);
    this.viewport = new Viewport(this.canvas);
    this.viewport.setBackground(getComputedStyle(document.documentElement).getPropertyValue('--workspace') || getComputedStyle(document.documentElement).getPropertyValue('--bg'));
    this.viewport.onRender = () => this.placeLabels();
    this.timeline = new Timeline(this.timelineEl, {
      select: (id) => this.selectAction(id),
      seek: (t) => this.seek(t),
      change: (id, patch, label) => this.editDoc(label, (d) => Object.assign(d.actions.find((a) => a.id === id), patch)),
      add: (track, anchor) => this.addActionMenu(anchor, track),
      rerender: () => this.renderTimeline()
    });
    this.bindViewport();
    this.bindSplitter();
    new ResizeObserver(() => this.viewport.requestRender()).observe(this.canvas);
  }

  bindSplitter() {
    this.splitter.addEventListener('mousedown', (e) => {
      const startY = e.clientY;
      const startH = this.bottom.offsetHeight;
      const move = (ev) => {
        this.bottom.style.height = `${Math.max(90, Math.min(window.innerHeight - 200, startH - (ev.clientY - startY)))}px`;
        this.viewport.requestRender();
      };
      const up = () => {
        window.removeEventListener('mousemove', move);
        window.removeEventListener('mouseup', up);
      };
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
    });
  }

  bindViewport() {
    const c = this.canvas;
    let drag = null;
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('mousedown', (e) => {
      const r = c.getBoundingClientRect();
      drag = { button: e.button, x: e.clientX, y: e.clientY, sx: e.clientX - r.left, sy: e.clientY - r.top, moved: false, shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey, alt: e.altKey };
    });
    window.addEventListener('mousemove', (e) => {
      const r = c.getBoundingClientRect();
      if (!drag) {
        if (e.target === c) {
          const p = this.pickAt(e.clientX - r.left, e.clientY - r.top);
          const k = p ? key(...p.pos) : null;
          if (k !== (this.hover ? key(...this.hover.pos) : null)) {
            this.hover = p;
            this.updateOverlay();
          }
        }
        return;
      }
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      if (Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) > 3) drag.moved = true;
      if (!drag.moved) return;
      if (drag.button === 2 && !drag.shift) this.viewport.orbit(dx, -dy);
      else if (drag.button === 1 || (drag.button === 2 && drag.shift)) this.viewport.pan(dx, dy);
      else if (drag.button === 0) {
        if (this.tool === 'select') {
          drag.rect = [Math.min(drag.sx, e.clientX - r.left), Math.min(drag.sy, e.clientY - r.top), Math.max(drag.sx, e.clientX - r.left), Math.max(drag.sy, e.clientY - r.top)];
          this.showMarquee(drag.rect);
        } else this.viewport.orbit(dx, -dy);
      }
      drag.x = e.clientX;
      drag.y = e.clientY;
    });
    window.addEventListener('mouseup', (e) => {
      if (!drag) return;
      const d = drag;
      drag = null;
      this.showMarquee(null);
      if (d.button !== 0) return;
      if (d.rect) {
        this.marqueeSelect(d.rect, d.ctrl ? 'add' : d.alt ? 'remove' : 'set');
        return;
      }
      if (!d.moved) this.clickTool(this.pickAt(d.sx, d.sy), d);
    });
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.viewport.zoom(e.deltaY);
    }, { passive: false });
  }

  showMarquee(rect) {
    let m = this.center.querySelector('.marquee');
    if (!rect) {
      m?.remove();
      return;
    }
    if (!m) {
      m = h('div', { class: 'marquee' });
      this.center.append(m);
    }
    Object.assign(m.style, { left: `${rect[0]}px`, top: `${rect[1]}px`, width: `${rect[2] - rect[0]}px`, height: `${rect[3] - rect[1]}px` });
  }

  marqueeSelect(rect, op) {
    const next = op === 'set' ? new Set() : new Set(this.selection);
    for (const [x, y, z] of this.structure.positions()) {
      if (!this.layerVisible(y)) continue;
      const p = this.viewport.project([x + 0.5, y + 0.5, z + 0.5]);
      if (!p || p[0] < rect[0] || p[0] > rect[2] || p[1] < rect[1] || p[1] > rect[3]) continue;
      if (op === 'remove') next.delete(key(x, y, z));
      else next.add(key(x, y, z));
    }
    this.selection = next;
    this.refresh();
  }

  layerVisible(y) {
    if (this.layer.mode === 'below') return y <= this.layer.y;
    if (this.layer.mode === 'only') return y === this.layer.y;
    return true;
  }

  pickAt(sx, sy) {
    return this.viewport.pick(sx, sy, (x, y, z) => {
      if (!this.layerVisible(y)) return null;
      const b = this.structure.blockAt(x, y, z);
      if (!b || b.name === 'minecraft:air' || b.name === 'minecraft:structure_void') return null;
      return this.geometry(b.name, b.props).boxes;
    });
  }

  clickTool(p, mods) {
    if (!p) {
      if (this.tool === 'select' && !mods.ctrl) {
        this.selection = new Set();
        this.refresh();
      }
      return;
    }
    const [x, y, z] = p.pos;
    const adjacent = p.block ? [x + p.face[0], y + p.face[1], z + p.face[2]] : [x, 0, z];
    this.lastPick = { pos: p.block ? [x, y, z] : null, face: faceName(p.face) };
    switch (this.tool) {
      case 'select': {
        if (!p.block) return;
        const k = key(x, y, z);
        if (mods.shift && this.selectionAnchor) {
          const a = this.selectionAnchor;
          const b = [Math.min(a[0], x), Math.min(a[1], y), Math.min(a[2], z), Math.max(a[0], x), Math.max(a[1], y), Math.max(a[2], z)];
          for (let i = b[0]; i <= b[3]; i++) for (let j = b[1]; j <= b[4]; j++) for (let l = b[2]; l <= b[5]; l++) if (this.structure.blockAt(i, j, l) && this.layerVisible(j)) this.selection.add(key(i, j, l));
        } else if (mods.ctrl) {
          if (this.selection.has(k)) this.selection.delete(k);
          else this.selection.add(k);
        } else this.selection = new Set([k]);
        this.selectionAnchor = [x, y, z];
        this.refresh();
        break;
      }
      case 'place':
        this.history.apply('Place block', [{ x: adjacent[0], y: adjacent[1], z: adjacent[2], after: { key: this.brush, nbt: null } }]);
        break;
      case 'remove':
        if (p.block) this.history.apply('Remove block', [{ x, y, z, after: null }]);
        break;
      case 'replace':
        if (p.block) this.history.apply('Replace block', [{ x, y, z, after: { key: this.brush, nbt: null } }]);
        break;
      case 'eyedropper':
        if (p.block) {
          this.brush = this.structure.blockAt(x, y, z).key;
          this.tool = 'place';
          this.toast(`Picked ${this.brush}`);
          this.refresh();
        }
        break;
      default:
        break;
    }
  }

  frameCamera() {
    this.viewport.frame(this.structure.size);
  }

  refresh() {
    this.diagnostics = this.doc ? diagnose(this.doc, this.structure) : [];
    this.buildScene();
    this.renderToolbar();
    this.renderLeft();
    this.renderRight();
    this.renderTimeline();
    this.renderLayerBar();
    this.renderBadge();
  }

  buildScene() {
    const cells = new Map();
    const sim = this.mode === 'storyboard' && this.doc ? simulate(this.doc, this.structure, this.time) : null;
    this.sim = sim;
    for (const [x, y, z] of this.structure.positions()) {
      if (!this.layerVisible(y)) continue;
      const k = key(x, y, z);
      const b = this.structure.blockAt(x, y, z);
      if (!b || b.name === 'minecraft:air' || b.name === 'minecraft:structure_void') continue;
      const stateK = sim?.states.get(k) ?? b.key;
      let st;
      try {
        st = parseState(stateK);
      } catch {
        st = { name: b.name, props: b.props };
      }
      const geo = this.geometry(st.name, st.props);
      const off = sim?.offsets.get(k) ?? [0, 0, 0];
      const ghost = sim ? !sim.visible.has(k) : false;
      if (ghost && !this.ghosts) continue;
      const color = colorFor(st.name);
      const selected = this.selection.has(k);
      cells.set(k, { name: st.name, pos: [x, y, z], x: x + off[0], y: y + off[1], z: z + off[2], geo, boxes: geo.boxes, full: geo.full && !off.some(Boolean), color, foliage: tintFor(st.name, st.props), ghost, tint: selected ? [1.25, 1.25, 0.7] : undefined });
    }
    this.viewport.setAtlas(this.atlas);
    if (this.wanted.size) void this.loadModels();
    const lines = [];
    const overlay = [];
    if (this.doc && this.mode === 'storyboard' && this.activeAction) {
      const a = this.doc.actions.find((x) => x.id === this.activeAction);
      const boxes = a ? boxesOf(this.doc, a) : null;
      if (boxes) for (const b of boxes) overlay.push(...boxLines(normalizeBox(b), [0.4, 0.85, 1, 1], 0.02));
    }
    if (sim) for (const o of sim.outlines) for (const b of o.boxes) overlay.push(...boxLines(normalizeBox(b), paletteColor(o.action.color), 0.03));
    this.viewport.setScene({ cells, size: this.structure.size, basePlate: this.doc?.basePlate ?? { x: 0, z: 0, size: Math.max(this.structure.size[0], this.structure.size[2]) }, lines, overlayLines: overlay });
    this.updateOverlay();
  }

  updateOverlay() {
    const extra = [];
    for (const k of this.selection) {
      const [x, y, z] = unkey(k);
      extra.push(...boxLines([x, y, z, x, y, z], [1, 0.85, 0.2, 1], 0.01));
    }
    if (this.hover) {
      const [x, y, z] = this.hover.pos;
      if (this.hover.block) extra.push(...boxLines([x, y, z, x, y, z], [1, 1, 1, 0.9], 0.015));
      else extra.push(...boxLines([x, 0, z, x, 0, z], [1, 1, 1, 0.4], 0.0));
    }
    const base = [];
    if (this.doc && this.mode === 'storyboard' && this.activeAction) {
      const a = this.doc.actions.find((x) => x.id === this.activeAction);
      const boxes = a ? boxesOf(this.doc, a) : null;
      if (boxes) for (const b of boxes) base.push(...boxLines(normalizeBox(b), [0.4, 0.85, 1, 1], 0.02));
    }
    if (this.sim) for (const o of this.sim.outlines) for (const b of o.boxes) base.push(...boxLines(normalizeBox(b), paletteColor(o.action.color), 0.03));
    this.viewport.setOverlay([...base, ...extra]);
  }

  placeLabels() {
    const items = [];
    if (this.sim) {
      for (const t of this.sim.texts) items.push({ cls: 'caption', text: t.text, point: anchorPoint(t.anchor), color: t.color });
      for (const t of this.sim.inputs) items.push({ cls: 'input-hint', text: `${t.click ? `${t.click} click` : 'hint'}${t.item ? ` with ${t.item}` : ''}${t.sneaking ? ' while sneaking' : ''}`, point: anchorPoint(t.anchor) });
      for (const [k, speed] of this.sim.speeds) {
        if (!this.sim.visible.has(k)) continue;
        const [x, y, z] = unkey(k);
        items.push({ cls: 'speed', text: `${speed} RPM`, point: [x + 0.5, y + 1.05, z + 0.5] });
      }
    }
    this.labels.replaceChildren(
      ...items.map((it, i) => {
        const p = it.point ? this.viewport.project(it.point) : [16, 16 + i * 30];
        if (!p) return null;
        return h('div', { class: `label ${it.cls} ${it.color ? `pal-${it.color}` : ''}`, style: { left: `${p[0]}px`, top: `${p[1]}px` } }, it.text);
      }).filter(Boolean)
    );
  }

  renderBadge() {
    const note = this.textureError ?? (this.loadingModels || this.wanted.size ? 'Loading block textures…' : 'Block entities and animations are not drawn');
    clear(this.badge, this.mode === 'storyboard' && this.doc ? `Preview · tick ${this.time} (${seconds(this.time)} s) · play in Minecraft for the real scene` : `Preview · ${note}`);
  }

  renderLayerBar() {
    const [, sy] = this.structure.size;
    clear(
      this.layerBar,
      select(this.layer.mode, [{ value: 'all', label: 'All layers' }, { value: 'below', label: 'Up to layer' }, { value: 'only', label: 'Only layer' }], (v) => {
        this.layer.mode = v;
        this.refresh();
      }),
      this.layer.mode === 'all' ? null : numberInput(this.layer.y, (v) => {
        this.layer.y = Math.max(0, Math.min(sy - 1, v ?? 0));
        this.refresh();
      }, { integer: true, min: 0, max: sy - 1 }),
      this.mode === 'storyboard' ? checkbox(this.ghosts, (v) => {
        this.ghosts = v;
        this.refresh();
      }, 'Show hidden blocks') : null,
      button('Frame', () => this.frameCamera(), { title: 'Fit the structure in view' })
    );
  }

  renderLists() {
    clear(this.datalists, h('datalist', { id: 'ps-blocks' }, this.blocks.slice(0, 5000).map((b) => h('option', { value: b.id }, b.name))), h('datalist', { id: 'ps-items' }, this.items.slice(0, 5000).map((b) => h('option', { value: b.id }, b.name))));
  }

  renderToolbar() {
    if (!this.toolbar) return;
    const modeSeg = h('div', { class: 'seg' }, ['build', 'storyboard'].map((m) => button(m === 'build' ? 'Build' : 'Storyboard', () => this.setMode(m), { class: this.mode === m ? 'on' : '' })));
    const tools = this.mode === 'build' ? h('div', { class: 'seg' }, [['select', 'Select', 'Click to select, Shift+click for a box, Ctrl+click to add, drag for a marquee'], ['place', 'Place', 'Place the brush block on the clicked face'], ['remove', 'Remove', 'Remove the clicked block'], ['replace', 'Replace', 'Replace the clicked block with the brush'], ['eyedropper', 'Pick', 'Pick the clicked block as the brush']].map(([id, label, title]) => button(label, () => {
      this.tool = id;
      this.renderToolbar();
    }, { class: this.tool === id ? 'on' : '', title }))) : null;
    const undo = h('div', { class: 'seg' }, button('Undo', () => this.undo(), { disabled: !this.canUndo(), title: 'Ctrl+Z' }), button('Redo', () => this.redo(), { disabled: !this.canRedo(), title: 'Ctrl+Y' }));
    const play = this.mode === 'storyboard' && this.doc ? h('div', { class: 'seg' }, button(this.playing ? 'Pause' : 'Play', () => this.togglePlay(), { title: 'Play the structural preview (Space)' }), button('Restart', () => this.seek(0)), select(String(this.speed), ['0.25', '0.5', '1', '2', '4'].map((v) => ({ value: v, label: `${v}×` })), (v) => (this.speed = Number(v))), h('span', { class: 'time' }, `${this.time} / ${endTick(this.doc)} ticks`)) : null;
    const st = this.mc.state;
    const mcOpen = st?.open;
    const mc = h(
      'div',
      { class: 'seg mc' },
      this.doc ? button(this.mc.busy ? 'Starting…' : 'Play in Minecraft', () => this.playInMinecraft(), { class: 'primary', disabled: this.mc.busy, title: 'Build the scene with the real Create/Ponder in the running game' }) : null,
      mcOpen ? button(st.paused ? 'Resume' : 'Pause', () => this.control(st.paused ? 'resume' : 'pause')) : null,
      mcOpen ? button('Restart', () => this.control('restart')) : null,
      mcOpen ? select(String(st.speed ?? 1), ['0.25', '0.5', '1', '2', '4'].map((v) => ({ value: v, label: `${v}×` })), (v) => this.control('speed', { speed: Number(v) })) : null,
      mcOpen ? h('span', { class: 'time' }, `MC ${st.currentTime}/${st.totalTime}`) : null,
      button('Show game', () => modsmith.showGame(), { title: 'Switch to the Client tab' })
    );
    const files = h('div', { class: 'seg' }, button(this.dirty.structure || this.dirty.doc ? 'Save*' : 'Save', () => this.save(), { title: 'Ctrl+S' }), this.doc ? button('Export…', () => this.exportDialog(), { title: 'Generate the structure, Java storyboard, registration and language entries' }) : button('Create storyboard', () => this.createStoryboard(), { class: 'primary' }));
    clear(this.toolbar, modeSeg, tools, undo, play, h('div', { class: 'spacer' }), mc, files);
  }

  setMode(m) {
    if (m === 'storyboard' && !this.doc) {
      this.createStoryboard();
      return;
    }
    this.mode = m;
    this.playing = false;
    this.refresh();
  }

  renderLeft() {
    if (!this.left) return;
    const tabs = h('div', { class: 'tabs' }, [['scenes', 'Scenes'], ['palette', 'Blocks'], ['selections', 'Selections']].map(([id, label]) => button(label, () => {
      this.leftTab = id;
      this.renderLeft();
    }, { class: this.leftTab === id ? 'on' : '' })));
    let body;
    if (this.leftTab === 'palette') body = this.paletteView();
    else if (this.leftTab === 'selections') body = this.selectionsView();
    else body = this.scenesView();
    clear(this.left, tabs, body);
  }

  paletteView() {
    const filter = h('input', { type: 'search', placeholder: 'Search blocks', value: this.paletteFilter, spellcheck: false });
    const list = h('div', { class: 'list' });
    const used = [...this.structure.usedStates().entries()].sort((a, b) => b[1] - a[1]);
    const fill = () => {
      const q = filter.value.trim().toLowerCase();
      this.paletteFilter = filter.value;
      const usedRows = used.filter(([k]) => !q || k.includes(q)).map(([k, n]) => {
        const name = k.split('[')[0];
        const unknown = this.blockIds?.size && !this.blockIds.has(name);
        return h('button', { type: 'button', class: `row ${this.brush === k ? 'on' : ''} ${unknown ? 'unknown' : ''}`, title: unknown ? `${k} is not in the project’s block list yet. It is kept exactly as it is.` : k, onClick: () => this.setBrush(k) }, swatch(name), h('span', { class: 'grow ellipsis' }, k), h('span', { class: 'mute' }, n));
      });
      const reg = this.blocks.filter((b) => !q || b.id.includes(q) || (b.name ?? '').toLowerCase().includes(q)).slice(0, 300).map((b) => h('button', { type: 'button', class: `row ${this.brush === b.id ? 'on' : ''}`, title: b.id, onClick: () => this.setBrush(b.id) }, swatch(b.id), h('span', { class: 'grow ellipsis' }, b.name || b.id), h('span', { class: 'mute small' }, b.id.split(':')[0])));
      clear(list, h('div', { class: 'list-head' }, 'In this structure'), usedRows, h('div', { class: 'list-head' }, 'All blocks'), this.registryNote ? h('div', { class: 'mute small pad' }, this.registryNote) : null, reg);
    };
    filter.addEventListener('input', fill);
    fill();
    const brush = h('div', { class: 'brush' }, h('span', { class: 'mute' }, 'Brush'), textInput(this.brush, (v) => {
      try {
        const st = parseState(v);
        this.setBrush(stateKey(st.name, st.props));
      } catch (e) {
        this.toast(e.message, 'error');
      }
    }, { list: 'ps-blocks' }));
    return h('div', { class: 'panel' }, brush, filter, list);
  }

  setBrush(k) {
    this.brush = k;
    if (this.tool === 'select' || this.tool === 'remove' || this.tool === 'eyedropper') this.tool = 'place';
    this.renderToolbar();
    this.renderLeft();
  }

  selectionsView() {
    if (!this.doc) return h('div', { class: 'panel pad' }, h('p', { class: 'mute' }, 'Named selections belong to a storyboard.'), button('Create storyboard', () => this.createStoryboard(), { class: 'primary' }));
    const rows = this.doc.selections.map((s) => {
      const count = [...boxesPositionsCount(s.boxes)];
      const broken = s.boxes.length === 0 || ![...iterBoxes(s.boxes)].some(([x, y, z]) => this.structure.blockAt(x, y, z));
      const uses = this.doc.actions.filter((a) => a.selection === s.id).length;
      return h(
        'div',
        { class: `sel-item ${broken ? 'issue' : ''}` },
        h('input', { class: 'sel-name', value: s.name, spellcheck: false, 'aria-label': 'Selection name', onChange: (e) => this.editDoc('Rename selection', (d) => (d.selections.find((x) => x.id === s.id).name = e.target.value || s.name)) }),
        h('div', { class: 'sel-meta' },
        h('span', { class: 'mute small grow', title: broken ? 'This selection covers no blocks of the current structure' : '' }, `${count[0]} pos · ${uses} use${uses === 1 ? '' : 's'}${broken ? ' · no blocks' : ''}`),
        button('Select', () => {
          this.selection = new Set([...iterBoxes(s.boxes)].filter(([x, y, z]) => this.structure.blockAt(x, y, z)).map((p) => key(...p)));
          this.refresh();
        }),
        button('Update', () => this.editDoc('Update selection', (d) => (d.selections.find((x) => x.id === s.id).boxes = this.selectionBoxes())), { disabled: !this.selection.size, title: 'Replace with the current selection' }),
        button('×', () => {
          if (uses) {
            this.toast(`${s.name} is used by ${uses} action${uses === 1 ? '' : 's'}`, 'error');
            return;
          }
          this.editDoc('Delete selection', (d) => (d.selections = d.selections.filter((x) => x.id !== s.id)));
        }, { class: 'icon', title: 'Delete' }))
      );
    });
    return h('div', { class: 'panel' }, h('div', { class: 'pad' }, button('Save current selection', () => this.saveSelection(), { disabled: !this.selection.size, class: 'primary' })), h('div', { class: 'list' }, rows.length ? rows : h('p', { class: 'mute pad' }, 'Select blocks in the viewport and save them here to reuse them in several actions.')));
  }

  scenesView() {
    const wrap = h('div', { class: 'panel' });
    const docs = this.docs ?? [];
    const st = this.mc.status;
    wrap.append(
      h('div', { class: 'list-head' }, 'In this project'),
      h('div', { class: 'list' }, docs.length ? docs.map((d) => h('button', { type: 'button', class: `row ${d.file === this.docFile ? 'on' : ''}`, onClick: () => modsmith.openFile(d.file), title: d.file }, h('span', { class: 'grow ellipsis' }, d.doc?.scene?.title ?? d.file), h('span', { class: 'mute small' }, d.doc?.scene?.id ?? 'unreadable'))) : h('p', { class: 'mute pad' }, 'No Ponder Studio scenes yet.')),
      h('div', { class: 'pad row-buttons' }, button('New scene…', () => this.newScene()), button('Import Java…', () => this.importDialog()), button('Refresh', async () => {
        this.docs = await this.findDocs();
        await this.refreshMinecraft();
        this.renderLeft();
      })),
      h('div', { class: 'list-head' }, 'Registered in the game'),
      this.mc.scenes?.length
        ? h('div', { class: 'list' }, this.mc.scenes.map((s) => h('div', { class: 'row' }, h('span', { class: 'grow ellipsis', title: s.schematic }, s.component), button('Play', () => this.playRegistered(s.component)))))
        : h('p', { class: 'mute pad small' }, st ? 'No scenes are registered, or Ponder is not installed.' : this.mcHint())
    );
    if (!this.docs) this.findDocs().then((d) => {
      this.docs = d;
      this.renderLeft();
    });
    return wrap;
  }

  mcHint() {
    return this.mc.error ?? 'Launch the client with Create and this extension turned on to play scenes in Minecraft.';
  }

  renderRight() {
    if (!this.right) return;
    const parts = [];
    if (this.mode === 'storyboard' && this.doc) {
      const a = this.doc.actions.find((x) => x.id === this.activeAction);
      parts.push(a ? this.actionEditor(a) : this.sceneEditor());
    } else parts.push(this.blockEditor());
    clear(this.right, parts);
  }

  blockEditor() {
    const sel = [...this.selection].map(unkey);
    if (!sel.length) {
      const [sx, sy, sz] = this.structure.size;
      const unknown = this.blockIds?.size ? [...this.structure.usedStates().keys()].map((k) => k.split('[')[0]).filter((n, i, all) => !this.blockIds.has(n) && all.indexOf(n) === i) : [];
      return h('div', { class: 'panel pad' }, h('h3', {}, 'Structure'), h('p', { class: 'mute small' }, this.structureFile), h('p', {}, `${sx} × ${sy} × ${sz} · ${this.structure.blocks.v.length} blocks · DataVersion ${this.structure.dataVersion ?? 'unknown'}`), unknown.length ? h('div', { class: 'callout warn' }, h('strong', {}, 'Blocks not in the project’s block list yet'), h('p', { class: 'small' }, 'They are kept exactly as they are. Mods from a run configuration join the list after the configuration is launched once. In the game, a block shows as air only if no installed mod adds it.'), h('ul', {}, unknown.map((u) => h('li', {}, u)))) : null, h('p', { class: 'mute small' }, 'Click a block to edit it. Right-drag to orbit, Shift+right-drag or middle-drag to pan, wheel to zoom.'), this.basePlateEditor());
    }
    if (sel.length > 1) {
      const xs = sel.map((p) => p[0]);
      const ys = sel.map((p) => p[1]);
      const zs = sel.map((p) => p[2]);
      return h('div', { class: 'panel pad' }, h('h3', {}, `${sel.length} blocks selected`), h('p', { class: 'mute small' }, `From ${Math.min(...xs)} ${Math.min(...ys)} ${Math.min(...zs)} to ${Math.max(...xs)} ${Math.max(...ys)} ${Math.max(...zs)}`), h('div', { class: 'row-buttons' }, button('Replace with brush', () => this.history.apply('Replace blocks', sel.map(([x, y, z]) => ({ x, y, z, after: { key: this.brush, nbt: null } })))), button('Remove', () => this.history.apply('Remove blocks', sel.map(([x, y, z]) => ({ x, y, z, after: null })))), button('Copy', () => this.copy()), this.doc ? button('Save as selection', () => this.saveSelection()) : null));
    }
    const [x, y, z] = sel[0];
    const b = this.structure.blockAt(x, y, z);
    if (!b) return h('div', { class: 'panel pad' }, 'Empty position');
    const unknown = this.blockIds?.size && !this.blockIds.has(b.name);
    const props = Object.entries(b.props);
    const setProp = (k, v) => {
      const next = { ...b.props };
      if (v === null) delete next[k];
      else next[k] = v;
      this.history.apply('Change block state', [{ x, y, z, after: { key: stateKey(b.name, next), nbt: b.nbt } }]);
    };
    const newProp = textInput('', (v) => {
      const m = /^([a-z0-9_]+)\s*=\s*(.+)$/.exec(v.trim());
      if (!m) return this.toast('Write a property like axis=x', 'error');
      setProp(m[1], m[2]);
    }, { placeholder: 'add property, e.g. axis=x' });
    return h(
      'div',
      { class: 'panel pad' },
      h('h3', {}, b.name),
      h('p', { class: 'mute small' }, `Position ${x} ${y} ${z}`),
      unknown ? h('div', { class: 'callout warn small' }, 'This block is not in the project’s block list. It is kept exactly as it is.') : null,
      field('Block', textInput(b.name, (v) => {
        try {
          const st = parseState(v);
          this.history.apply('Change block', [{ x, y, z, after: { key: stateKey(st.name, { ...b.props, ...st.props }), nbt: b.nbt } }]);
        } catch (e) {
          this.toast(e.message, 'error');
        }
      }, { list: 'ps-blocks' })),
      h('h4', {}, 'Block state'),
      props.length ? props.map(([k, v]) => h('div', { class: 'prop' }, h('span', { class: 'grow' }, k), textInput(v, (nv) => setProp(k, nv.trim() || null)), button('×', () => setProp(k, null), { class: 'icon' }))) : h('p', { class: 'mute small' }, 'No properties'),
      newProp,
      h('h4', {}, 'Block entity data'),
      b.nbt ? nbtInspector(b.nbt, (nbt) => this.history.apply('Edit block entity', [{ x, y, z, after: { key: b.key, nbt }, nbtChanged: true }])) : h('div', {}, h('p', { class: 'mute small' }, 'None'), button('Add block entity data', () => this.history.apply('Add block entity', [{ x, y, z, after: { key: b.key, nbt: { t: 10, v: [] } }, nbtChanged: true }]))),
      h('div', { class: 'row-buttons' }, button('Use as brush', () => this.setBrush(b.key)), button('Copy', () => this.copy()), button('Remove', () => this.history.apply('Remove block', [{ x, y, z, after: null }])))
    );
  }

  basePlateEditor() {
    if (!this.doc) return null;
    const bp = this.doc.basePlate;
    return h('div', {}, h('h4', {}, 'Base plate and origin'), h('div', { class: 'grid3' }, field('X', numberInput(bp.x, (v) => this.editDoc('Base plate', (d) => (d.basePlate.x = v ?? 0)), { integer: true })), field('Z', numberInput(bp.z, (v) => this.editDoc('Base plate', (d) => (d.basePlate.z = v ?? 0)), { integer: true })), field('Size', numberInput(bp.size, (v) => this.editDoc('Base plate', (d) => (d.basePlate.size = Math.max(1, v ?? 1))), { integer: true, min: 1 }))), checkbox(bp.show !== false, (v) => this.editDoc('Base plate', (d) => (d.basePlate.show = v)), 'Show the base plate at the start'), h('p', { class: 'mute small' }, 'The origin is the north-west corner (lowest X and Z), which is nearest the initial camera.'));
  }

  sceneEditor() {
    const s = this.doc.scene;
    return h(
      'div',
      { class: 'panel pad' },
      h('h3', {}, 'Scene'),
      field('Title', textInput(s.title, (v) => this.editDoc('Title', (d) => (d.scene.title = v)))),
      field('Scene id', textInput(s.id, (v) => this.editDoc('Scene id', (d) => (d.scene.id = v.trim()))), `Language keys: ${s.namespace}.ponder.${s.id}.*`),
      field('Item', textInput(s.component, (v) => this.editDoc('Item', (d) => (d.scene.component = v.trim())), { list: 'ps-items' }), 'Pressing W on this item opens the scene'),
      field('Also show for', textInput((this.doc.items ?? []).join(', '), (v) => this.editDoc('Items', (d) => (d.items = v.split(',').map((x) => x.trim()).filter(Boolean))), { list: 'ps-items' })),
      field('Length (ticks)', numberInput(this.doc.length, (v) => this.editDoc('Length', (d) => (d.length = v && v > 0 ? v : null)), { integer: true, min: 1 }), `Ends at ${endTick(this.doc)} ticks (${seconds(endTick(this.doc))} s)`),
      this.basePlateEditor(),
      h('h4', {}, 'Problems'),
      this.diagnostics.length ? h('ul', { class: 'diag' }, this.diagnostics.map((d) => h('li', { class: d.level, onClick: () => this.selectAction(d.action) }, `${d.action}: ${d.message}`))) : h('p', { class: 'mute small' }, 'None'),
      this.doc.imported ? this.importedNote() : null,
      h('p', { class: 'mute small' }, 'Select blocks in the viewport, then use + on a timeline track or Add action.'),
      button('Add action…', (e) => this.addActionMenu(e.currentTarget), { class: 'primary' })
    );
  }

  importedNote() {
    const im = this.doc.imported;
    return h('div', { class: 'callout' }, h('strong', {}, 'Imported from Java'), h('p', { class: 'small' }, `${im.source}, method ${im.method}. The original file is unchanged.`), button('Open the source', () => modsmith.openFile(im.source)), im.unsupported?.length ? h('div', {}, h('p', { class: 'small' }, `${im.unsupported.length} statement${im.unsupported.length === 1 ? ' was' : 's were'} not imported because they are custom logic:`), h('ul', { class: 'small' }, im.unsupported.slice(0, 30).map((u) => h('li', {}, `line ${u.line}: ${u.text}`)))) : null);
  }

  actionEditor(a) {
    const meta = ACTIONS[a.type];
    const set = (label, fn) => this.editDoc(label, (d) => fn(d.actions.find((x) => x.id === a.id)));
    const rows = [];
    rows.push(h('h3', {}, meta.label), h('p', { class: 'mute small' }, `Track: ${TRACKS.find((t) => t.id === meta.track).label} · id ${a.id}`));
    rows.push(h('div', { class: 'grid2' }, field('Start (ticks)', numberInput(a.at, (v) => set('Start', (x) => (x.at = Math.max(0, v ?? 0))), { integer: true, min: 0 }), `${seconds(a.at)} s`), meta.duration ? field('Duration (ticks)', numberInput(a.duration, (v) => set('Duration', (x) => (x.duration = Math.max(1, v ?? 1))), { integer: true, min: 1 }), `${seconds(a.duration ?? 0)} s`) : h('div', { class: 'mute small' }, durationOf(a) ? `Fades in over ${durationOf(a)} ticks` : 'Instant')));
    if (meta.selection) {
      const opts = [{ value: '', label: '(choose)' }, ...this.doc.selections.map((s) => ({ value: s.id, label: s.name }))];
      rows.push(field('Blocks', h('div', { class: 'row-inline' }, select(a.selection ?? '', opts, (v) => set('Selection', (x) => {
        x.selection = v || undefined;
        delete x.boxes;
      })), button('Use selected', () => {
        if (!this.selection.size) return this.toast('Select blocks in the viewport first', 'error');
        const id = this.ensureNamedSelection();
        set('Selection', (x) => {
          x.selection = id;
          delete x.boxes;
        });
      }))));
    }
    switch (a.type) {
      case 'show':
      case 'hide':
        rows.push(field('Direction', select(a.direction, DIRECTIONS, (v) => set('Direction', (x) => (x.direction = v))), a.type === 'show' ? 'Where the blocks fade in from' : 'Where the blocks fade out to'));
        break;
      case 'block_state':
        rows.push(field('New state', textInput(a.state, (v) => set('Block state', (x) => (x.state = v.trim())), { list: 'ps-blocks' })), checkbox(a.particles, (v) => set('Particles', (x) => (x.particles = v)), 'Break particles'));
        break;
      case 'move':
        rows.push(field('Offset X Y Z', vecInput(a.offset, (v) => set('Offset', (x) => (x.offset = v)))));
        break;
      case 'rotate':
        rows.push(field('Rotation X Y Z (degrees)', vecInput(a.rotation, (v) => set('Rotation', (x) => (x.rotation = v)))));
        break;
      case 'text':
        rows.push(field('Text', h('textarea', { value: a.text ?? '', rows: 3, onChange: (e) => set('Caption text', (x) => (x.text = e.target.value)) })), this.anchorEditor(a, set), field('Colour', select(a.color ?? '', [{ value: '', label: 'default' }, ...PALETTE], (v) => set('Colour', (x) => (x.color = v || null)))), checkbox(a.placeNearTarget, (v) => set('Placement', (x) => (x.placeNearTarget = v)), 'Place near the target'), checkbox(a.keyframe, (v) => set('Keyframe', (x) => (x.keyframe = v)), 'Keyframe (a chapter mark on the progress bar)'));
        break;
      case 'outline':
        rows.push(field('Colour', select(a.color ?? 'white', PALETTE, (v) => set('Colour', (x) => (x.color = v)))));
        break;
      case 'input':
        rows.push(this.anchorEditor(a, set), field('Pointing', select(a.pointing, POINTING, (v) => set('Pointing', (x) => (x.pointing = v)))), field('Click', select(a.click ?? '', [{ value: '', label: 'none' }, 'right', 'left', 'scroll'], (v) => set('Click', (x) => (x.click = v || null)))), field('Item', textInput(a.item ?? '', (v) => set('Item', (x) => (x.item = v.trim() || null)), { list: 'ps-items', placeholder: 'optional, e.g. create:wrench' })), checkbox(a.sneaking, (v) => set('Sneaking', (x) => (x.sneaking = v)), 'While sneaking'), checkbox(a.ctrl, (v) => set('Ctrl', (x) => (x.ctrl = v)), 'While holding Ctrl'));
        break;
      case 'rotate_camera':
        rows.push(field('Degrees', numberInput(a.degrees, (v) => set('Camera', (x) => (x.degrees = v ?? 0)), { step: 15 }), 'Positive turns the view clockwise'));
        break;
      case 'kinetic':
        rows.push(field('Speed (RPM)', numberInput(a.speed, (v) => set('Speed', (x) => (x.speed = v ?? 0)), { step: 8 }), 'Negative speeds turn the other way. Needs Create.'));
        break;
      default:
        break;
    }
    const issues = this.diagnostics.filter((d) => d.action === a.id);
    if (issues.length) rows.push(h('ul', { class: 'diag' }, issues.map((d) => h('li', { class: d.level }, d.message))));
    rows.push(h('div', { class: 'row-buttons' }, button('Duplicate', () => this.duplicateAction(a.id), { title: 'Ctrl+D' }), button('Delete', () => this.deleteAction(a.id), { class: 'danger', title: 'Delete' }), button('Done', () => this.selectAction(null))));
    return h('div', { class: 'panel pad' }, rows);
  }

  anchorEditor(a, set) {
    const an = a.anchor ?? { kind: 'none' };
    return h(
      'div',
      { class: 'anchor' },
      field('Anchor', select(an.kind, [{ value: 'none', label: a.type === 'text' ? 'none (screen text)' : 'none' }, { value: 'block', label: 'block centre' }, { value: 'top', label: 'top of block' }, { value: 'face', label: 'block face' }, { value: 'point', label: 'position' }], (v) => set('Anchor', (x) => (x.anchor = v === 'none' ? null : { ...defaultAnchor(this, v) })))),
      an.kind === 'face' ? field('Face', select(an.face ?? 'up', DIRECTIONS, (v) => set('Face', (x) => (x.anchor.face = v)))) : null,
      ['block', 'top', 'face'].includes(an.kind) ? field('Block', vecInput(an.pos, (v) => set('Anchor', (x) => (x.anchor.pos = v.map(Math.round))))) : null,
      an.kind === 'point' ? field('Position', vecInput(an.point, (v) => set('Anchor', (x) => (x.anchor.point = v)), 0.1)) : null,
      button('Use clicked block and face', () => {
        if (!this.lastPick?.pos) return this.toast('Click a block in the viewport first', 'error');
        set('Anchor', (x) => (x.anchor = { kind: 'face', pos: this.lastPick.pos, face: this.lastPick.face ?? 'up' }));
      })
    );
  }

  renderTimeline() {
    if (!this.timelineEl) return;
    if (this.mode !== 'storyboard' || !this.doc) {
      this.bottom.style.display = 'none';
      this.viewport?.requestRender();
      return;
    }
    this.bottom.style.display = '';
    const mcTime = this.mc.state?.open && this.mc.state.source === 'preview' ? this.mc.state.currentTime : null;
    this.timeline.render({ doc: this.doc, time: this.time, mcTime, selected: this.activeAction, diagnostics: this.diagnostics });
  }

  selectAction(id) {
    this.activeAction = id;
    if (id) {
      const a = this.doc.actions.find((x) => x.id === id);
      if (a && this.time < a.at) this.time = a.at;
    }
    this.refresh();
  }

  seek(t) {
    this.time = Math.max(0, Math.round(t));
    this.buildScene();
    this.renderToolbar();
    this.renderTimeline();
    this.renderBadge();
    if (this.mc.state?.open && this.mc.state.source === 'preview' && this.followGame) this.control('seek', { tick: this.time });
  }

  togglePlay() {
    this.playing = !this.playing;
    if (this.playing) {
      if (this.time >= endTick(this.doc)) this.time = 0;
      let last = performance.now();
      let acc = 0;
      const step = (now) => {
        if (!this.playing) return;
        acc += ((now - last) / 50) * this.speed;
        last = now;
        if (acc >= 1) {
          const n = Math.floor(acc);
          acc -= n;
          this.seek(this.time + n);
          if (this.time >= endTick(this.doc)) {
            this.playing = false;
            this.renderToolbar();
            return;
          }
        }
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }
    this.renderToolbar();
  }

  editDoc(label, fn) {
    const before = JSON.stringify(this.doc);
    fn(this.doc);
    const after = JSON.stringify(this.doc);
    if (before === after) return;
    this.docHistory.undo.push({ label, before });
    if (this.docHistory.undo.length > 300) this.docHistory.undo.shift();
    this.docHistory.redo = [];
    this.lastEdit = 'doc';
    this.dirty.doc = true;
    this.refresh();
  }

  canUndo() {
    return (this.history?.canUndo ?? false) || this.docHistory.undo.length > 0;
  }

  canRedo() {
    return (this.history?.canRedo ?? false) || this.docHistory.redo.length > 0;
  }

  undo() {
    if (this.mode === 'storyboard' && this.docHistory.undo.length) {
      const e = this.docHistory.undo.pop();
      this.docHistory.redo.push({ label: e.label, before: JSON.stringify(this.doc) });
      this.doc = JSON.parse(e.before);
      this.dirty.doc = true;
      this.toast(`Undid ${e.label}`);
      this.refresh();
      return;
    }
    const l = this.history.undo();
    if (l) this.toast(`Undid ${l}`);
    else if (this.docHistory.undo.length) {
      this.mode = 'storyboard';
      this.undo();
    }
  }

  redo() {
    if (this.mode === 'storyboard' && this.docHistory.redo.length) {
      const e = this.docHistory.redo.pop();
      this.docHistory.undo.push({ label: e.label, before: JSON.stringify(this.doc) });
      this.doc = JSON.parse(e.before);
      this.dirty.doc = true;
      this.toast(`Redid ${e.label}`);
      this.refresh();
      return;
    }
    const l = this.history.redo();
    if (l) this.toast(`Redid ${l}`);
  }

  selectionBoxes() {
    const pts = [...this.selection].map(unkey).sort((a, b) => a[1] - b[1] || a[2] - b[2] || a[0] - b[0]);
    const boxes = [];
    const left = new Set(this.selection);
    for (const [x, y, z] of pts) {
      if (!left.has(key(x, y, z))) continue;
      let x2 = x;
      while (left.has(key(x2 + 1, y, z))) x2++;
      let z2 = z;
      const rowOk = (zz) => {
        for (let i = x; i <= x2; i++) if (!left.has(key(i, y, zz))) return false;
        return true;
      };
      while (rowOk(z2 + 1)) z2++;
      let y2 = y;
      const layerOk = (yy) => {
        for (let i = x; i <= x2; i++) for (let k = z; k <= z2; k++) if (!left.has(key(i, yy, k))) return false;
        return true;
      };
      while (layerOk(y2 + 1)) y2++;
      for (let i = x; i <= x2; i++) for (let j = y; j <= y2; j++) for (let k = z; k <= z2; k++) left.delete(key(i, j, k));
      boxes.push([x, y, z, x2, y2, z2]);
    }
    return boxes;
  }

  ensureNamedSelection() {
    const boxes = this.selectionBoxes();
    const sig = JSON.stringify(boxes);
    const existing = this.doc.selections.find((s) => JSON.stringify(s.boxes) === sig);
    if (existing) return existing.id;
    const id = nextId('sel', this.doc.selections.map((s) => s.id));
    const name = this.selection.size === 1 ? (() => {
      const [x, y, z] = unkey([...this.selection][0]);
      return this.structure.blockAt(x, y, z)?.name.split(':').pop().replace(/_/g, ' ') ?? 'block';
    })() : `Selection ${this.doc.selections.length + 1}`;
    let unique = name;
    let n = 2;
    while (this.doc.selections.some((s) => s.name === unique)) unique = `${name} ${n++}`;
    this.editDoc('Save selection', (d) => d.selections.push({ id, name: unique, boxes }));
    return id;
  }

  async saveSelection() {
    if (!this.selection.size) return;
    const id = this.ensureNamedSelection();
    const s = this.doc.selections.find((x) => x.id === id);
    const v = await form('Name the selection', [{ key: 'name', label: 'Name', value: s.name }], 'Save');
    if (v?.name?.trim()) this.editDoc('Rename selection', (d) => (d.selections.find((x) => x.id === id).name = v.name.trim()));
    this.leftTab = 'selections';
    this.renderLeft();
  }

  addActionMenu(anchor, track) {
    const types = Object.entries(ACTIONS).filter(([, m]) => !track || m.track === track);
    menu(anchor, types.map(([type, m]) => ({ label: m.label, run: () => this.addAction(type) })));
  }

  addAction(type) {
    const meta = ACTIONS[type];
    const a = { id: nextId('a', this.doc.actions.map((x) => x.id)), type, at: this.time, ...structuredClone(meta.defaults) };
    if (meta.selection) {
      if (this.selection.size) a.selection = this.ensureNamedSelection();
      else if (this.doc.selections.length) a.selection = this.doc.selections[this.doc.selections.length - 1].id;
    }
    if ((type === 'text' || type === 'input') && (this.lastPick?.pos || this.selection.size)) {
      const pos = this.lastPick?.pos ?? unkey([...this.selection][0]);
      a.anchor = type === 'text' ? { kind: 'face', pos, face: this.lastPick?.face ?? 'up' } : { kind: 'face', pos, face: this.lastPick?.face ?? 'up' };
    }
    this.editDoc(`Add ${meta.label.toLowerCase()}`, (d) => d.actions.push(a));
    this.selectAction(a.id);
  }

  duplicateAction(id) {
    const a = this.doc.actions.find((x) => x.id === id);
    if (!a) return;
    const copy = { ...structuredClone(a), id: nextId('a', this.doc.actions.map((x) => x.id)), at: a.at + Math.max(10, durationOf(a)) };
    this.editDoc('Duplicate action', (d) => d.actions.push(copy));
    this.selectAction(copy.id);
  }

  deleteAction(id) {
    this.editDoc('Delete action', (d) => (d.actions = d.actions.filter((x) => x.id !== id)));
    this.activeAction = null;
    this.refresh();
  }

  copy() {
    const pts = [...this.selection].map(unkey);
    if (!pts.length) return;
    const min = [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.min(...pts.map((p) => p[2]))];
    this.clipboard = pts.map(([x, y, z]) => ({ d: [x - min[0], y - min[1], z - min[2]], snap: this.structure.snapshot(x, y, z) }));
    this.toast(`Copied ${pts.length} block${pts.length === 1 ? '' : 's'}`);
  }

  paste() {
    if (!this.clipboard) return;
    const target = this.hover ? (this.hover.block ? [this.hover.pos[0] + (this.hover.face?.[0] ?? 0), this.hover.pos[1] + (this.hover.face?.[1] ?? 1), this.hover.pos[2] + (this.hover.face?.[2] ?? 0)] : [this.hover.pos[0], 0, this.hover.pos[2]]) : [0, 1, 0];
    const changes = this.clipboard.map((c) => ({ x: target[0] + c.d[0], y: target[1] + c.d[1], z: target[2] + c.d[2], after: c.snap ? { key: c.snap.key, nbt: c.snap.nbt } : null }));
    this.history.apply('Paste', changes);
    this.selection = new Set(changes.map((c) => key(c.x, c.y, c.z)));
    this.refresh();
  }

  onKey(e) {
    if (e.target.closest?.('input, textarea, select')) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) {
      e.preventDefault();
      this.undo();
    } else if (mod && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) {
      e.preventDefault();
      this.redo();
    } else if (mod && e.key.toLowerCase() === 's') {
      e.preventDefault();
      this.save();
    } else if (mod && e.key.toLowerCase() === 'c' && this.mode === 'build') this.copy();
    else if (mod && e.key.toLowerCase() === 'v' && this.mode === 'build') this.paste();
    else if (mod && e.key.toLowerCase() === 'd' && this.activeAction) {
      e.preventDefault();
      this.duplicateAction(this.activeAction);
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      if (this.mode === 'storyboard' && this.activeAction) this.deleteAction(this.activeAction);
      else if (this.mode === 'build' && this.selection.size) this.history.apply('Remove blocks', [...this.selection].map(unkey).map(([x, y, z]) => ({ x, y, z, after: null })));
    } else if (e.key === ' ' && this.mode === 'storyboard') {
      e.preventDefault();
      this.togglePlay();
    } else if (e.key === 'Escape') {
      this.selection = new Set();
      this.activeAction = null;
      this.refresh();
    }
  }

  async save() {
    try {
      if (this.dirty.structure) {
        const bytes = await this.structure.toBytes();
        const r = await modsmith.writeFile(this.structureFile, bytesToB64(bytes), { encoding: 'base64', expectedMtime: this.mtime.structure ?? undefined, create: this.mtime.structure == null });
        this.mtime.structure = r.mtime;
        this.dirty.structure = false;
      }
      if (this.doc && this.dirty.doc) {
        const r = await modsmith.writeFile(this.docFile, stableJson(this.doc), { expectedMtime: this.mtime.doc ?? undefined, create: this.mtime.doc == null });
        this.mtime.doc = r.mtime;
        this.dirty.doc = false;
      }
      this.externalChange = null;
      this.toast('Saved', 'success');
      this.renderToolbar();
      this.renderNotice();
    } catch (e) {
      if (/changed on disk/.test(e.message)) {
        this.externalChange = e.message;
        this.renderNotice();
      } else this.toast(e.message, 'error');
    }
  }

  async checkExternal() {
    const checks = [];
    if (this.structureFile && this.mtime.structure != null) checks.push(['structure', this.structureFile]);
    if (this.docFile && this.mtime.doc != null) checks.push(['doc', this.docFile]);
    for (const [kind, file] of checks) {
      let r;
      try {
        r = await modsmith.readFile(file);
      } catch {
        continue;
      }
      if (Math.abs(r.mtime - this.mtime[kind]) <= 1) continue;
      if (!this.dirty[kind]) {
        if (kind === 'structure') await this.loadStructure(file);
        else await this.loadDoc(file);
        this.toast(`${file} changed on disk and was reloaded`);
        this.refresh();
      } else {
        this.externalChange = `${file} changed on disk while you have unsaved changes`;
        this.renderNotice();
      }
    }
  }

  renderNotice() {
    clear(
      this.notice,
      this.externalChange
        ? h('div', { class: 'callout warn' }, h('span', {}, this.externalChange), button('Reload from disk', async () => {
            this.externalChange = null;
            await this.loadStructure(this.structureFile);
            if (this.docFile) await this.loadDoc(this.docFile);
            this.refresh();
            this.renderNotice();
          }), button('Keep mine and overwrite', () => this.forceSave()))
        : null
    );
  }

  async forceSave() {
    try {
      if (this.dirty.structure) {
        const r = await modsmith.writeFile(this.structureFile, bytesToB64(await this.structure.toBytes()), { encoding: 'base64', create: true });
        this.mtime.structure = r.mtime;
        this.dirty.structure = false;
      }
      if (this.doc && this.dirty.doc) {
        const r = await modsmith.writeFile(this.docFile, stableJson(this.doc), { create: true });
        this.mtime.doc = r.mtime;
        this.dirty.doc = false;
      }
      this.externalChange = null;
      this.renderNotice();
      this.renderToolbar();
      this.toast('Saved', 'success');
    } catch (e) {
      this.toast(e.message, 'error');
    }
  }

  async createStoryboard() {
    const ws = modsmith.context.workspace ?? {};
    const m = /assets\/([^/]+)\/ponder\/(.+)\.nbt$/.exec(this.structureFile);
    const base = (m ? m[2] : this.structureFile.split('/').pop().replace(/\.nbt$/, '')).toLowerCase().replace(/[^a-z0-9_./-]/g, '_');
    const v = await form('Create a storyboard', [
      { key: 'id', label: 'Scene id', value: base, check: (x) => (/^[a-z0-9_./-]+$/.test(x) ? null : 'Use lowercase letters, digits, underscores, dots, dashes and slashes') },
      { key: 'title', label: 'Title', value: base.split('/').pop().replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()), check: (x) => (x.trim() ? null : 'Enter a title') },
      { key: 'component', label: 'Item that opens the scene', value: '', placeholder: 'create:cogwheel', list: 'ps-items', check: (x) => (/^[a-z0-9_.-]+:[a-z0-9_./-]+$/.test(x.trim()) ? null : 'Enter an item id like create:cogwheel') }
    ], 'Create');
    if (!v) return;
    const namespace = m?.[1] ?? ws.modId ?? 'mymod';
    const doc = newDocument({ namespace, sceneId: v.id.trim(), title: v.title.trim(), component: v.component.trim(), structureFile: this.structureFile, schematic: m ? m[2] : v.id.trim(), size: Math.max(this.structure.size[0], this.structure.size[2]) });
    if (ws.loader || ws.minecraft) doc.compatibility = { ...doc.compatibility, loader: ws.loader, minecraft: ws.minecraft };
    this.doc = doc;
    this.docFile = `${DOCS_DIR}/${doc.scene.id}.ponderstudio.json`;
    this.mtime.doc = null;
    this.dirty.doc = true;
    this.mode = 'storyboard';
    await this.save();
    this.docs = await this.findDocs();
    this.refresh();
    const sp = structureProblem(doc);
    if (sp) this.toast(sp, 'error');
  }

  async newScene() {
    const ws = modsmith.context.workspace ?? {};
    if (!ws.modId) return this.toast('This project has no mod id in modsmith.json', 'error');
    const v = await form('New Ponder scene', [
      { key: 'id', label: 'Scene id', value: '', placeholder: 'cogwheel_intro', check: (x) => (/^[a-z0-9_./-]+$/.test(x) ? null : 'Use lowercase letters, digits, underscores, dots, dashes and slashes') },
      { key: 'title', label: 'Title', value: '', check: (x) => (x.trim() ? null : 'Enter a title') },
      { key: 'component', label: 'Item that opens the scene', value: '', placeholder: 'create:cogwheel', list: 'ps-items', check: (x) => (/^[a-z0-9_.-]+:[a-z0-9_./-]+$/.test(x.trim()) ? null : 'Enter an item id like create:cogwheel') },
      { key: 'size', label: 'Base plate size', value: '5', check: (x) => (/^\d+$/.test(x) && Number(x) >= 1 && Number(x) <= 32 ? null : 'Between 1 and 32') },
      { key: 'block', label: 'Base plate block', value: 'minecraft:snow_block', list: 'ps-blocks' }
    ], 'Create');
    if (!v) return;
    const size = Number(v.size);
    const s = Structure.empty([size, 4, size]);
    for (let x = 0; x < size; x++) for (let z = 0; z < size; z++) s.put(x, 0, z, { key: v.block.trim() || 'minecraft:snow_block', nbt: null });
    const id = v.id.trim();
    const structureFile = `src/main/resources/assets/${ws.modId}/ponder/${id}.nbt`;
    const doc = newDocument({ namespace: ws.modId, sceneId: id, title: v.title.trim(), component: v.component.trim(), structureFile, schematic: id, size });
    doc.compatibility = { ...doc.compatibility, loader: ws.loader, minecraft: ws.minecraft };
    const docFile = `${DOCS_DIR}/${id}.ponderstudio.json`;
    try {
      await modsmith.writeFile(structureFile, bytesToB64(await s.toBytes()), { encoding: 'base64', create: true });
      await modsmith.writeFile(docFile, stableJson(doc), { create: true });
      this.docs = await this.findDocs();
      modsmith.openFile(docFile);
    } catch (e) {
      this.toast(e.message, 'error');
    }
  }

  async callGame(name, params = {}) {
    return modsmith.call('bridge.call', { method: `${M}${name}`, params });
  }

  async refreshMinecraft() {
    try {
      this.mc.status = await this.callGame('status');
      this.mc.state = this.mc.status.screen ?? null;
      this.mc.error = null;
      if (this.mc.status.ponder) this.mc.scenes = await this.callGame('scenes').catch(() => []);
    } catch (e) {
      this.mc.status = null;
      this.mc.error = gameError(e.message);
    }
    this.renderToolbar();
    if (this.leftTab === 'scenes') this.renderLeft();
  }

  async playInMinecraft() {
    if (!this.doc) return;
    const errors = this.diagnostics.filter((d) => d.level === 'error');
    if (errors.length && !(await confirmDialog('Play with problems?', `${errors.length} action${errors.length === 1 ? ' has' : 's have'} problems and will be skipped. Play anyway?`, 'Play'))) return;
    this.mc.busy = true;
    this.renderToolbar();
    try {
      await this.refreshMinecraft();
      if (!this.mc.status) throw new Error(this.mc.error);
      if (!this.mc.status.ponder) throw new Error('Ponder is not installed in this game. Add Create (which includes Ponder) to the run configuration and launch again.');
      if (!this.mc.status.inWorld) {
        const ok = await confirmDialog('Open a test world?', 'Ponder scenes need a loaded world. Create a flat test world in the running client?', 'Open world');
        if (!ok) return;
        await modsmith.call('world.open', { name: 'Ponder Studio', create: true, flat: true });
        for (let i = 0; i < 90; i++) {
          await new Promise((r) => setTimeout(r, 1000));
          const st = await this.callGame('status').catch(() => null);
          if (st?.inWorld) break;
        }
      }
      const bytes = await this.structure.toBytes();
      const res = await this.callGame('preview', { structure: bytesToB64(bytes), storyboard: compileStoryboard(this.doc), startAt: 0 });
      this.mc.state = res;
      if (res.warnings?.length) await modal('The game reported problems', h('ul', {}, res.warnings.map((w) => h('li', {}, w))), [{ label: 'OK', value: true, primary: true }]);
      modsmith.showGame();
    } catch (e) {
      this.toast(gameError(e.message), 'error');
    } finally {
      this.mc.busy = false;
      this.renderToolbar();
      this.renderTimeline();
    }
  }

  async playRegistered(component) {
    try {
      this.mc.state = await this.callGame('play', { component });
      modsmith.showGame();
    } catch (e) {
      this.toast(gameError(e.message), 'error');
    }
    this.renderToolbar();
  }

  async control(action, extra = {}) {
    try {
      this.mc.state = await this.callGame('control', { action, ...extra });
    } catch (e) {
      this.toast(gameError(e.message), 'error');
    }
    this.renderToolbar();
    this.renderTimeline();
  }

  async javaPackage() {
    if (this.doc.export?.javaPackage) return this.doc.export.javaPackage;
    let files = [];
    try {
      files = await listFiles('src/main/java', '.java');
    } catch {
      return null;
    }
    for (const f of files.sort((a, b) => a.length - b.length)) {
      try {
        const text = (await this.readText(f)).content;
        if (!/@Mod\s*\(/.test(text)) continue;
        const m = /^\s*package\s+([\w.]+)\s*;/m.exec(text);
        if (m) return `${m[1]}.ponder`;
      } catch {
        continue;
      }
    }
    return null;
  }

  async readMaybe(file) {
    try {
      const r = await modsmith.readFile(file);
      return r.binary ? null : r.content;
    } catch {
      return null;
    }
  }

  async exportDialog() {
    await this.save();
    const ws = modsmith.context.workspace ?? {};
    const modId = ws.modId;
    if (!modId) return this.toast('This project has no mod id in modsmith.json', 'error');
    const versions = { loader: ws.loader, minecraft: ws.minecraft, ponder: this.mc.status?.ponder ?? null, create: this.mc.status?.create ?? null };
    const { adapter, problems: adapterProblems } = pickAdapter(versions);
    if (!adapter) return modal('Export is not available', h('p', {}, adapterProblems.join(' ')), [{ label: 'OK', value: true, primary: true }]);
    const pkg = await this.javaPackage();
    if (!pkg) return this.toast('Could not find the mod class (@Mod) to choose a Java package; set export.javaPackage in the document', 'error');
    this.docs = await this.findDocs();
    const docs = this.docs.filter((d) => d.doc && !validateDocument(d.doc).length).map((d) => (d.file === this.docFile ? this.doc : d.doc));
    const lockText = await this.readMaybe(LOCK_FILE);
    const lock = lockText ? JSON.parse(lockText) : null;
    const plannedPaths = new Set();
    const prelim = planExport({ docs, pkg, modId, current: {}, lock: null });
    for (const w of prelim.writes) plannedPaths.add(w.path);
    for (const w of prelim.langWrites) plannedPaths.add(w.path);
    const current = {};
    for (const p of plannedPaths) current[p] = await this.readMaybe(p);
    let force = [];
    const plan = () => planExport({ docs, pkg, modId, current, lock, force });
    let result = plan();
    const gradle = await this.buildSetupStatus();
    const box = h('div', { class: 'export' });
    const draw = () => {
      clear(
        box,
        h('p', {}, `Package ${pkg} · ${docs.length} scene${docs.length === 1 ? '' : 's'} · ${adapter.id}${versions.create ? ` · Create ${versions.create}` : ''}${versions.ponder ? ` · Ponder ${versions.ponder}` : ''}`),
        !versions.ponder ? h('p', { class: 'callout warn small' }, `The game is not running, so the installed Create and Ponder versions could not be checked. The verified combination is Create ${VERIFIED.create} with Ponder ${VERIFIED.ponder}.`) : null,
        adapterProblems.length ? h('ul', { class: 'diag' }, adapterProblems.map((p) => h('li', { class: 'warning' }, p))) : null,
        result.problems.length ? h('ul', { class: 'diag' }, result.problems.map((p) => h('li', { class: 'error' }, p))) : null,
        h('h4', {}, 'Files'),
        h('ul', { class: 'files' }, result.writes.map((w) => h('li', {}, `${current[w.path] == null ? 'create' : 'update'} ${w.path}`)), result.langWrites.map((w) => h('li', {}, `${w.path}: ${w.added.length} new, ${w.removed.length} removed language entries`)), !result.writes.length && !result.langWrites.length ? h('li', { class: 'mute' }, 'Everything is up to date') : null),
        result.conflicts.length ? h('div', {}, h('h4', {}, 'Changed outside Ponder Studio'), h('p', { class: 'small' }, 'These are not overwritten unless you tick them.'), result.conflicts.map((c) => checkbox(force.includes(c.path), (v) => {
          force = v ? [...force, c.path] : force.filter((x) => x !== c.path);
          result = plan();
          draw();
        }, `${c.path}: ${c.reason}`))) : null,
        result.stale.length ? h('div', {}, h('h4', {}, 'No longer generated'), h('ul', { class: 'small' }, result.stale.map((s) => h('li', {}, `${s} (delete it by hand if it is not needed)`)))) : null,
        h('h4', {}, 'Build setup'),
        gradle.ok ? h('p', { class: 'small' }, gradle.message) : h('div', { class: 'callout warn small' }, h('p', {}, gradle.message), button('Add the Create and Ponder compile dependencies', async () => {
          await this.setupBuild(gradle);
          Object.assign(gradle, await this.buildSetupStatus());
          draw();
        }))
      );
    };
    draw();
    const go = await modal('Export', box, [{ label: 'Cancel', value: null }, { label: 'Export', value: 'go', primary: true }]);
    if (go !== 'go') return;
    if (result.problems.length) return this.toast(result.problems[0], 'error');
    try {
      for (const w of result.writes) await modsmith.writeFile(w.path, w.content, { create: true });
      for (const w of result.langWrites) await modsmith.writeFile(w.path, w.content, { create: true });
      await modsmith.writeFile(LOCK_FILE, stableJson(result.lock), { create: true });
      const written = result.writes.length + result.langWrites.length;
      this.toast(`Exported ${written} file${written === 1 ? '' : 's'}${result.conflicts.length ? `; ${result.conflicts.length} left unchanged` : ''}`, 'success');
      if (!written) return;
      const build = await confirmDialog('Build the project now?', 'Compile the generated storyboard with Gradle to check it.', 'Build');
      if (build) {
        const op = await modsmith.call('project.build', {});
        this.toast(`Build started (${op?.id ?? 'see Tasks'})`);
      }
    } catch (e) {
      this.toast(e.message, 'error');
    }
  }

  async buildSetupStatus() {
    const gradle = await this.readMaybe('build.gradle');
    const extra = await this.readMaybe('ponderstudio.gradle');
    const deps = await this.readMaybe('modsmith.dependencies.gradle');
    const all = [gradle, extra, deps].filter(Boolean).join('\n');
    if (/net\.createmod\.ponder/.test(all)) return { ok: true, message: 'The project compiles against Ponder.' };
    return { ok: false, gradle, message: 'The project does not compile against Create and Ponder yet, so the exported storyboard will not build. Ponder Studio can add a ponderstudio.gradle file with compile-only dependencies and apply it from build.gradle.' };
  }

  async setupBuild(status) {
    const create = this.mc.status?.create ?? VERIFIED.create;
    const ponder = this.mc.status?.ponder ?? VERIFIED.ponder;
    const minecraft = modsmith.context.workspace?.minecraft ?? '1.21.1';
    const content = [
      'repositories {',
      '\tmaven {',
      "\t\tname = 'Create'",
      "\t\turl = 'https://maven.createmod.net'",
      '\t\tcontent {',
      "\t\t\tincludeGroup 'com.simibubi.create'",
      "\t\t\tincludeGroup 'net.createmod.ponder'",
      '\t\t}',
      '\t}',
      '}',
      '',
      'dependencies {',
      `\tcompileOnly('com.simibubi.create:create-${minecraft}:${create}-+:slim') { transitive = false }`,
      `\tcompileOnly('net.createmod.ponder:ponder-neoforge:${ponder}') { transitive = false }`,
      '}',
      ''
    ].join('\n');
    try {
      await modsmith.writeFile('ponderstudio.gradle', content, { create: true });
      if (status.gradle != null && !/apply from:\s*['"]ponderstudio\.gradle['"]/.test(status.gradle)) {
        const nl = status.gradle.includes('\r\n') ? '\r\n' : '\n';
        await modsmith.writeFile('build.gradle', `${status.gradle.replace(/\s*$/, '')}${nl}${nl}apply from: 'ponderstudio.gradle'${nl}`);
      }
      this.toast('Added ponderstudio.gradle. Create still needs to be a runtime mod of the run configuration to play the scene.', 'success');
    } catch (e) {
      this.toast(e.message, 'error');
    }
  }

  async importDialog() {
    let files = [];
    try {
      files = await listFiles('src/main/java', '.java');
    } catch (e) {
      return this.toast(e.message, 'error');
    }
    const candidates = [];
    for (const f of files) {
      const t = await this.readMaybe(f);
      if (t && /SceneBuilder/.test(t)) candidates.push(f);
    }
    if (!candidates.length) return this.toast('No Java files with Ponder storyboards were found in src/main/java', 'error');
    const v = await form('Import a storyboard from Java', [{ key: 'file', label: 'Java file', value: candidates[0], options: candidates }], 'Next');
    if (!v) return;
    const source = await this.readMaybe(v.file);
    let res;
    try {
      res = importJava(source, v.file);
    } catch (e) {
      return this.toast(`The file could not be parsed: ${e.message}`, 'error');
    }
    if (!res.methods.length) return this.toast('No storyboard methods (SceneBuilder, SceneBuildingUtil) were found', 'error');
    const pick = await form('Choose the storyboard', [{ key: 'method', label: 'Method', value: res.methods[0].name, options: res.methods.map((m) => ({ value: m.name, label: `${m.name} (${m.actions.length} actions, ${m.unsupported.length} not imported)` })) }, { key: 'structure', label: 'Structure file', value: '', placeholder: `src/main/resources/assets/${modsmith.context.workspace?.modId ?? 'mymod'}/ponder/...nbt` }, { key: 'component', label: 'Item that opens the scene', value: '', list: 'ps-items', check: (x) => (/^[a-z0-9_.-]+:[a-z0-9_./-]+$/.test(x.trim()) ? null : 'Enter an item id like create:cogwheel') }], 'Import');
    if (!pick) return;
    const m = res.methods.find((x) => x.name === pick.method);
    const ws = modsmith.context.workspace ?? {};
    const doc = newDocument({ namespace: ws.modId ?? 'mymod', sceneId: m.sceneId ?? pick.method.toLowerCase(), title: m.title ?? pick.method, component: pick.component.trim(), structureFile: pick.structure.trim(), schematic: undefined, size: m.basePlate?.size ?? 5 });
    if (m.basePlate) doc.basePlate = { ...doc.basePlate, ...m.basePlate };
    doc.selections = m.selections;
    doc.actions = m.actions;
    doc.length = m.end ?? null;
    doc.imported = { source: v.file, method: pick.method, unsupported: m.unsupported };
    doc.export = { className: `${pick.method.replace(/^./, (c) => c.toUpperCase())}StudioScene` };
    let docFile = `${DOCS_DIR}/${doc.scene.id}.ponderstudio.json`;
    for (let n = 2; (await this.readMaybe(docFile)) != null; n++) docFile = `${DOCS_DIR}/${doc.scene.id}_imported${n === 2 ? '' : n - 1}.ponderstudio.json`;
    try {
      await modsmith.writeFile(docFile, stableJson(doc), { create: true });
      modsmith.openFile(docFile);
    } catch (e) {
      this.toast(e.message, 'error');
    }
  }

  toast(text, kind = 'info') {
    const t = h('div', { class: `toast ${kind}` }, text);
    let area = document.querySelector('.toasts');
    if (!area) {
      area = h('div', { class: 'toasts' });
      document.body.append(area);
    }
    area.append(t);
    setTimeout(() => t.remove(), kind === 'error' ? 8000 : 3500);
  }
}

function faceName(n) {
  if (!n) return 'up';
  if (n[1] === 1) return 'up';
  if (n[1] === -1) return 'down';
  if (n[2] === -1) return 'north';
  if (n[2] === 1) return 'south';
  if (n[0] === -1) return 'west';
  if (n[0] === 1) return 'east';
  return 'up';
}

function defaultAnchor(studio, kind) {
  const pos = studio.lastPick?.pos ?? (studio.selection.size ? unkey([...studio.selection][0]) : [0, 1, 0]);
  if (kind === 'point') return { kind, point: [pos[0] + 0.5, pos[1] + 1, pos[2] + 0.5] };
  if (kind === 'face') return { kind, pos, face: studio.lastPick?.face ?? 'up' };
  return { kind, pos };
}

function vecInput(v, onChange, step = 1) {
  const vals = [...(v ?? [0, 0, 0])];
  return h('div', { class: 'vec' }, [0, 1, 2].map((i) => numberInput(vals[i], (n) => {
    vals[i] = n ?? 0;
    onChange([...vals]);
  }, { step })));
}

function* iterBoxes(boxes) {
  for (const raw of boxes) {
    const b = normalizeBox(raw);
    for (let x = b[0]; x <= b[3]; x++) for (let y = b[1]; y <= b[4]; y++) for (let z = b[2]; z <= b[5]; z++) yield [x, y, z];
  }
}

function* boxesPositionsCount(boxes) {
  let n = 0;
  for (const raw of boxes) {
    const b = normalizeBox(raw);
    n += (b[3] - b[0] + 1) * (b[4] - b[1] + 1) * (b[5] - b[2] + 1);
  }
  yield n;
}

function swatch(name) {
  const c = swatchColors.get(name) ?? colorFor(name);
  return h('span', { class: 'swatch', style: { background: `rgb(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)})` } });
}

function paletteColor(name) {
  const m = { white: [0.93, 0.93, 0.93], black: [0.13, 0.07, 0.07], red: [1, 0.36, 0.42], green: [0.55, 0.73, 0.32], blue: [0.37, 0.42, 0.69], slow: [0.13, 1, 0.13], medium: [0, 0.52, 1], fast: [1, 0.33, 1], input: [0.5, 0.8, 0.88], output: [0.87, 0.76, 0.4] }[name ?? 'white'] ?? [1, 1, 1];
  return [...m, 1];
}

function gameError(message) {
  if (/Start the game first/.test(message)) return 'The game is not running. Launch the client (with Create in the run configuration) to play scenes in Minecraft.';
  if (/Bridge is not connected/.test(message)) return 'The game is starting or the development bridge is off for this run configuration.';
  if (/Unknown bridge method/i.test(message)) return 'The Ponder Studio companion mod is not in this game. Turn the extension on and relaunch the client.';
  return message;
}

export async function openStructure(root, ctx) {
  const s = new Studio(root, ctx);
  await s.boot({ structureFile: ctx.file });
  return s;
}

export async function openDocument(root, ctx) {
  const s = new Studio(root, ctx);
  await s.boot({ docFile: ctx.file });
  return s;
}
