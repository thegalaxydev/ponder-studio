import { parse } from 'java-parser';

export const SUPPORTED = [
  'CreateSceneBuilder scene = new CreateSceneBuilder(builder)',
  'scene.title("id", "Title")',
  'scene.configureBasePlate(x, z, size), scene.showBasePlate(), scene.scaleSceneView(f)',
  'scene.idle(ticks), scene.idleSeconds(seconds), scene.markAsFinished()',
  'scene.rotateCameraY(degrees), scene.addKeyframe()',
  'scene.world().showSection(selection, Direction.X), hideSection(selection, Direction.X)',
  'scene.world().setKineticSpeed(selection, speed)',
  'scene.world().showIndependentSection(selection, Direction.X), makeSectionIndependent(selection), moveSection(link, vector, ticks), rotateSection(link, x, y, z, ticks)',
  'scene.overlay().showText(ticks).text("...").pointAt(vector).placeNearTarget().colored(PonderPalette.X).attachKeyFrame().independent(y)',
  'scene.overlay().showOutline(PonderPalette.X, slot, selection, ticks)',
  'scene.overlay().showControls(vector, Pointing.X, ticks).rightClick().leftClick().scroll().whileSneaking().whileCTRL()',
  'Selection, BlockPos and Vec3 local variables built from util.select(), util.grid() and util.vector()',
  'util.select(): position, fromTo, cuboid, layer, layersFrom, column, everywhere and .add(...)'
];

const isToken = (n) => n && n.image !== undefined;
const kids = (n) => {
  if (!n || isToken(n)) return [];
  const out = [];
  for (const arr of Object.values(n.children)) for (const c of arr) out.push(c);
  return out.sort((a, b) => start(a) - start(b));
};
const start = (n) => (isToken(n) ? n.startOffset : n.location.startOffset);
const end = (n) => (isToken(n) ? n.endOffset : n.location.endOffset);
const child = (n, name) => n?.children?.[name]?.[0];
const all = (n, name, out = []) => {
  if (!n || isToken(n)) return out;
  if (n.name === name) out.push(n);
  for (const c of kids(n)) all(c, name, out);
  return out;
};

class Unsupported extends Error {}

function expr(n) {
  if (!n) throw new Unsupported('empty expression');
  switch (n.name) {
    case 'expression': {
      if (n.children.lambdaExpression) throw new Unsupported('lambda');
      return expr(child(n, 'conditionalExpression') ?? child(n, 'ternaryExpression') ?? kids(n)[0]);
    }
    case 'conditionalExpression':
    case 'ternaryExpression': {
      if (n.children.QuestionMark) throw new Unsupported('conditional expression');
      return expr(child(n, 'binaryExpression'));
    }
    case 'binaryExpression': {
      const parts = kids(n);
      if (parts.length === 1) return expr(parts[0]);
      let acc = expr(parts[0]);
      for (let i = 1; i < parts.length; i += 2) {
        const op = parts[i].image;
        const rhs = expr(parts[i + 1]);
        if (acc.kind !== 'num' || rhs.kind !== 'num') throw new Unsupported('arithmetic with non-constant values');
        const v = op === '+' ? acc.v + rhs.v : op === '-' ? acc.v - rhs.v : op === '*' ? acc.v * rhs.v : op === '/' ? (Number.isInteger(acc.v) && Number.isInteger(rhs.v) ? Math.trunc(acc.v / rhs.v) : acc.v / rhs.v) : NaN;
        if (!Number.isFinite(v)) throw new Unsupported(`operator ${op}`);
        acc = { kind: 'num', v };
      }
      return acc;
    }
    case 'unaryExpression': {
      const prefix = n.children.UnaryPrefixOperator?.map((t) => t.image) ?? [];
      if (n.children.UnarySuffixOperator) throw new Unsupported('increment or decrement');
      const v = expr(child(n, 'primary'));
      let out = v;
      for (const op of prefix.reverse()) {
        if (out.kind !== 'num') throw new Unsupported(`operator ${op}`);
        if (op === '-') out = { kind: 'num', v: -out.v };
        else if (op !== '+') throw new Unsupported(`operator ${op}`);
      }
      return out;
    }
    case 'primary':
      return primary(n);
    default:
      throw new Unsupported(n.name);
  }
}

function literal(n) {
  const t = kids(n)[0];
  const tok = isToken(t) ? t : kids(t)[0];
  const img = tok.image;
  if (tok.tokenType.name === 'StringLiteral') {
    try {
      return { kind: 'str', v: JSON.parse(img.replace(/\\'/g, "'")) };
    } catch {
      return { kind: 'str', v: img.slice(1, -1) };
    }
  }
  if (/^(true|false)$/.test(img)) return { kind: 'bool', v: img === 'true' };
  if (img === 'null') return { kind: 'null' };
  const num = Number(img.replace(/[_lLfFdD]$/g, '').replace(/_/g, ''));
  if (!Number.isFinite(num)) throw new Unsupported(`literal ${img}`);
  return { kind: 'num', v: num };
}

function primary(n) {
  const prefix = child(n, 'primaryPrefix');
  const segs = [];
  let base = null;
  const p = kids(prefix)[0];
  if (isToken(p) && p.image === 'this') base = { kind: 'this' };
  else if (p.name === 'literal') base = literal(p);
  else if (p.name === 'parenthesisExpression') base = expr(child(p, 'expression'));
  else if (p.name === 'newExpression') {
    const u = child(p, 'unqualifiedClassInstanceCreationExpression');
    if (!u) throw new Unsupported('array creation');
    const type = child(u, 'classOrInterfaceTypeToInstantiate');
    const name = (type?.children?.Identifier ?? []).map((t) => t.image).join('.');
    const args = argList(child(u, 'argumentList'));
    base = { kind: 'new', type: name, args };
  } else if (p.name === 'fqnOrRefType') {
    for (const part of kids(p)) {
      if (isToken(part)) continue;
      const common = child(part, 'fqnOrRefTypePartCommon');
      const id = common?.children?.Identifier?.[0]?.image;
      if (!id) throw new Unsupported('type expression');
      segs.push({ name: id });
    }
  } else throw new Unsupported(p.name ?? p.image);
  for (const s of n.children.primarySuffix ?? []) {
    const inv = child(s, 'methodInvocationSuffix');
    if (inv) {
      if (!segs.length) throw new Unsupported('call on an expression');
      segs[segs.length - 1].args = argList(child(inv, 'argumentList'));
      continue;
    }
    const id = s.children.Identifier?.[0]?.image;
    if (id) {
      segs.push({ name: id });
      continue;
    }
    throw new Unsupported('array access or method reference');
  }
  if (base && segs.length) return { kind: 'chain', base, segs };
  if (base) return base;
  return { kind: 'chain', base: null, segs };
}

function argList(n) {
  if (!n) return [];
  return (n.children.expression ?? []).map(expr);
}

class Interp {
  constructor() {
    this.vars = new Map();
    this.sceneVars = new Set(['scene', 'builder']);
    this.now = 0;
    this.actions = [];
    this.selections = [];
    this.unsupported = [];
    this.sceneId = null;
    this.title = null;
    this.basePlate = null;
    this.end = null;
    this.n = 0;
  }

  num(e) {
    if (e?.kind === 'num') return e.v;
    if (e?.kind === 'chain' && !e.base && e.segs.length === 1 && !e.segs[0].args) {
      const v = this.vars.get(e.segs[0].name);
      if (v?.kind === 'num') return v.v;
    }
    throw new Unsupported('a value that is not a constant number');
  }

  str(e) {
    if (e?.kind === 'str') return e.v;
    throw new Unsupported('text that is not a string literal');
  }

  constName(e, type) {
    if (e?.kind === 'chain' && !e.base && e.segs.length === 2 && e.segs[0].name === type && !e.segs[1].args) return e.segs[1].name.toLowerCase();
    throw new Unsupported(`a ${type} value`);
  }

  pos(e) {
    const v = this.lookup(e);
    if (v?.kind === 'pos') return v.pos;
    if (e?.kind === 'chain' && !e.base && e.segs[0].name === 'util' && e.segs[1]?.name === 'grid' && e.segs[2]?.name === 'at') return e.segs[2].args.map((a) => this.num(a));
    if (e?.kind === 'new' && e.type === 'BlockPos') return e.args.map((a) => this.num(a));
    throw new Unsupported('a block position');
  }

  lookup(e) {
    if (e?.kind === 'chain' && !e.base && e.segs.length === 1 && !e.segs[0].args) return this.vars.get(e.segs[0].name) ?? null;
    return null;
  }

  selection(e) {
    const v = this.lookup(e);
    if (v?.kind === 'sel') return v;
    if (!(e?.kind === 'chain' && !e.base && e.segs[0].name === 'util' && e.segs[1]?.name === 'select')) throw new Unsupported('a selection');
    const boxes = [];
    const segs = e.segs.slice(2);
    if (!segs.length) throw new Unsupported('a selection');
    const first = segs[0];
    const a = first.args ?? [];
    const size = this.basePlate?.size ?? 5;
    const bx = this.basePlate?.x ?? 0;
    const bz = this.basePlate?.z ?? 0;
    switch (first.name) {
      case 'position':
        if (a.length === 3) {
          const p = a.map((x) => this.num(x));
          boxes.push([...p, ...p]);
        } else {
          const p = this.pos(a[0]);
          boxes.push([...p, ...p]);
        }
        break;
      case 'fromTo':
        if (a.length === 6) boxes.push(a.map((x) => this.num(x)));
        else boxes.push([...this.pos(a[0]), ...this.pos(a[1])]);
        break;
      case 'cuboid': {
        const o = this.pos(a[0]);
        const s = a[1]?.kind === 'new' ? a[1].args.map((x) => this.num(x)) : this.pos(a[1]);
        boxes.push([o[0], o[1], o[2], o[0] + s[0], o[1] + s[1], o[2] + s[2]]);
        break;
      }
      case 'layer': {
        const y = this.num(a[0]);
        boxes.push([bx, y, bz, bx + size - 1, y, bz + size - 1]);
        break;
      }
      case 'layers': {
        const y = this.num(a[0]);
        const hgt = this.num(a[1]);
        boxes.push([bx, y, bz, bx + size - 1, y + hgt - 1, bz + size - 1]);
        break;
      }
      case 'layersFrom': {
        const y = this.num(a[0]);
        boxes.push([bx, y, bz, bx + size - 1, y + 31, bz + size - 1]);
        break;
      }
      case 'column': {
        const x = this.num(a[0]);
        const z = this.num(a[1]);
        boxes.push([x, 0, z, x, 31, z]);
        break;
      }
      case 'everywhere':
        boxes.push([bx, 0, bz, bx + size - 1, 31, bz + size - 1]);
        break;
      default:
        throw new Unsupported(`util.select().${first.name}`);
    }
    for (const s of segs.slice(1)) {
      if (s.name !== 'add') throw new Unsupported(`selection .${s.name}()`);
      boxes.push(...this.selection(s.args[0]).boxes);
    }
    return { kind: 'sel', boxes };
  }

  namedSelection(sel, hint) {
    const sig = JSON.stringify(sel.boxes);
    const found = this.selections.find((s) => JSON.stringify(s.boxes) === sig);
    if (found) return found.id;
    const id = `sel${this.selections.length + 1}`;
    this.selections.push({ id, name: sel.name ?? hint ?? `Selection ${this.selections.length + 1}`, boxes: sel.boxes });
    return id;
  }

  vector(e) {
    const v = this.lookup(e);
    if (v?.kind === 'vec') return v.anchor;
    if (e?.kind === 'new' && e.type === 'Vec3') return { kind: 'point', point: e.args.map((x) => this.num(x)) };
    if (!(e?.kind === 'chain' && !e.base && e.segs[0].name === 'util' && e.segs[1]?.name === 'vector')) throw new Unsupported('a position vector');
    const s = e.segs[2];
    const a = s?.args ?? [];
    const posOf = (args) => (args.length === 3 ? args.map((x) => this.num(x)) : this.pos(args[0]));
    switch (s?.name) {
      case 'centerOf':
        return { kind: 'block', pos: posOf(a) };
      case 'topOf':
        return { kind: 'top', pos: posOf(a) };
      case 'blockSurface':
        if (a.length > 2) throw new Unsupported('blockSurface with a margin');
        return { kind: 'face', pos: this.pos(a[0]), face: this.constName(a[1], 'Direction') };
      case 'of':
        return { kind: 'point', point: a.map((x) => this.num(x)) };
      default:
        throw new Unsupported(`util.vector().${s?.name}`);
    }
  }

  add(a) {
    this.actions.push({ id: `a${++this.n}`, at: this.now, ...a });
  }

  sceneCall(e) {
    if (!(e?.kind === 'chain' && !e.base && this.sceneVars.has(e.segs[0].name))) return null;
    return e.segs.slice(1);
  }

  statement(e) {
    const segs = this.sceneCall(e);
    if (!segs || !segs.length) throw new Unsupported('a call that is not on the scene builder');
    const [s0, ...rest] = segs;
    const a = s0.args ?? [];
    if (!rest.length) {
      switch (s0.name) {
        case 'title':
          this.sceneId = this.str(a[0]);
          this.title = this.str(a[1]);
          return;
        case 'configureBasePlate':
          this.basePlate = { x: this.num(a[0]), z: this.num(a[1]), size: this.num(a[2]), show: this.basePlate?.show ?? false };
          return;
        case 'showBasePlate':
          this.basePlate = { ...(this.basePlate ?? { x: 0, z: 0, size: 5 }), show: true };
          return;
        case 'scaleSceneView':
          this.scale = this.num(a[0]);
          return;
        case 'idle':
          this.now += this.num(a[0]);
          return;
        case 'idleSeconds':
          this.now += this.num(a[0]) * 20;
          return;
        case 'markAsFinished':
          this.end = this.now;
          return;
        case 'rotateCameraY':
          this.add({ type: 'rotate_camera', degrees: this.num(a[0]) });
          return;
        case 'addKeyframe':
        case 'addLazyKeyframe':
          this.add({ type: 'keyframe' });
          return;
        default:
          throw new Unsupported(`scene.${s0.name}()`);
      }
    }
    const [s1, ...more] = rest;
    const b = s1.args ?? [];
    if (s0.name === 'world' && !more.length) {
      switch (s1.name) {
        case 'showSection': {
          const sel = this.selection(b[0]);
          this.add({ type: 'show', selection: this.namedSelection(sel), direction: this.constName(b[1], 'Direction') });
          return;
        }
        case 'hideSection': {
          const sel = this.selection(b[0]);
          this.add({ type: 'hide', selection: this.namedSelection(sel), direction: this.constName(b[1], 'Direction') });
          return;
        }
        case 'setKineticSpeed': {
          const sel = this.selection(b[0]);
          this.add({ type: 'kinetic', selection: this.namedSelection(sel), speed: this.num(b[1]) });
          return;
        }
        case 'moveSection':
        case 'rotateSection': {
          const link = this.lookup(b[0]);
          if (link?.kind !== 'link') throw new Unsupported('a section link that was not created in this method');
          if (s1.name === 'moveSection') {
            const v = this.vector(b[1]);
            if (v.kind !== 'point') throw new Unsupported('a move offset that is not a plain vector');
            this.add({ type: 'move', selection: link.selection, section: link.selection, offset: v.point, duration: this.num(b[2]) });
          } else this.add({ type: 'rotate', selection: link.selection, section: link.selection, rotation: [this.num(b[1]), this.num(b[2]), this.num(b[3])], duration: this.num(b[4]) });
          return;
        }
        default:
          throw new Unsupported(`scene.world().${s1.name}()`);
      }
    }
    if (s0.name === 'overlay') {
      if (s1.name === 'showText') {
        const act = { type: 'text', duration: this.num(b[0]), text: '', anchor: null, placeNearTarget: false, keyframe: false, color: null };
        for (const m of more) {
          const ma = m.args ?? [];
          if (m.name === 'text') {
            if (ma.length !== 1) throw new Unsupported('text with format parameters');
            act.text = this.str(ma[0]);
          } else if (m.name === 'pointAt') act.anchor = this.vector(ma[0]);
          else if (m.name === 'placeNearTarget') act.placeNearTarget = true;
          else if (m.name === 'attachKeyFrame') act.keyframe = true;
          else if (m.name === 'colored') act.color = this.constName(ma[0], 'PonderPalette');
          else if (m.name === 'independent') act.screenY = ma.length ? this.num(ma[0]) : 0;
          else throw new Unsupported(`text .${m.name}()`);
        }
        this.add(act);
        return;
      }
      if (s1.name === 'showOutline' && !more.length) {
        const sel = this.selection(b[2]);
        this.add({ type: 'outline', color: this.constName(b[0], 'PonderPalette'), selection: this.namedSelection(sel), duration: this.num(b[3]) });
        return;
      }
      if (s1.name === 'showControls') {
        const act = { type: 'input', anchor: this.vector(b[0]), pointing: this.constName(b[1], 'Pointing'), duration: this.num(b[2]), click: null, item: null, sneaking: false, ctrl: false };
        for (const m of more) {
          if (m.name === 'rightClick') act.click = 'right';
          else if (m.name === 'leftClick') act.click = 'left';
          else if (m.name === 'scroll') act.click = 'scroll';
          else if (m.name === 'whileSneaking') act.sneaking = true;
          else if (m.name === 'whileCTRL') act.ctrl = true;
          else throw new Unsupported(`controls .${m.name}()`);
        }
        this.add(act);
        return;
      }
    }
    throw new Unsupported(`scene.${s0.name}().${s1.name}()`);
  }

  declare(name, type, init) {
    if (init?.kind === 'new' && /SceneBuilder$/.test(init.type)) {
      this.sceneVars.add(name);
      return;
    }
    if (type === 'Selection') {
      const sel = this.selection(init);
      this.vars.set(name, { ...sel, name: humanize(name) });
      this.namedSelection({ ...sel, name: humanize(name) });
      return;
    }
    if (type === 'BlockPos') {
      this.vars.set(name, { kind: 'pos', pos: this.pos(init) });
      return;
    }
    if (type === 'Vec3') {
      this.vars.set(name, { kind: 'vec', anchor: this.vector(init) });
      return;
    }
    if (/^(int|long|float|double)$/.test(type)) {
      this.vars.set(name, { kind: 'num', v: this.num(init) });
      return;
    }
    if (/^ElementLink/.test(type)) {
      const segs = this.sceneCall(init);
      if (segs && segs[0]?.name === 'world' && (segs[1]?.name === 'showIndependentSection' || segs[1]?.name === 'makeSectionIndependent') && segs.length === 2) {
        const sel = this.selection(segs[1].args[0]);
        const id = this.namedSelection(sel, humanize(name));
        if (segs[1].name === 'showIndependentSection') this.add({ type: 'show', selection: id, direction: this.constName(segs[1].args[1], 'Direction') });
        this.vars.set(name, { kind: 'link', selection: id });
        return;
      }
    }
    throw new Unsupported(`a ${type} variable`);
  }
}

function humanize(name) {
  return name.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());
}

function typeName(n) {
  const ids = all(n, 'unannClassType').flatMap((c) => c.children.Identifier?.map((t) => t.image) ?? []);
  if (ids.length) return ids.join('.');
  const prim = all(n, 'unannPrimitiveType')[0];
  if (prim) return kids(prim).map((k) => (isToken(k) ? k.image : kids(k).map((x) => (isToken(x) ? x.image : kids(x)[0]?.image)).join(''))).join('');
  return 'var';
}

export function importJava(source, file = 'Scene.java') {
  const cst = parse(source);
  const lineOf = (offset) => source.slice(0, offset).split('\n').length;
  const methods = [];
  for (const m of all(cst, 'methodDeclaration')) {
    const header = child(m, 'methodHeader');
    const decl = child(header, 'methodDeclarator');
    const name = decl.children.Identifier[0].image;
    const params = all(decl, 'formalParameter').map((p) => typeName(p));
    if (!params.some((p) => /SceneBuilder$/.test(p)) || !params.some((p) => /SceneBuildingUtil$/.test(p))) continue;
    const paramNames = all(decl, 'variableDeclaratorId').map((v) => v.children.Identifier[0].image);
    const it = new Interp();
    const builderParam = paramNames[params.findIndex((p) => /SceneBuilder$/.test(p))];
    it.sceneVars = new Set([builderParam]);
    const body = child(child(m, 'methodBody'), 'block');
    const statements = body ? (child(child(body, 'blockStatements'), 'blockStatement') ? body.children.blockStatements[0].children.blockStatement : []) : [];
    for (const st of statements) {
      const text = source.slice(start(st), end(st) + 1).replace(/\s+/g, ' ').trim();
      try {
        const lv = all(st, 'localVariableDeclaration')[0];
        if (lv && kids(st)[0].name === 'localVariableDeclarationStatement') {
          const type = typeName(child(lv, 'localVariableType'));
          for (const vd of all(lv, 'variableDeclarator')) {
            const vname = all(vd, 'variableDeclaratorId')[0].children.Identifier[0].image;
            const init = child(child(vd, 'variableInitializer'), 'expression');
            it.declare(vname, type, init ? expr(init) : null);
          }
          continue;
        }
        const stmt = child(st, 'statement');
        const es = stmt && all(stmt, 'expressionStatement')[0];
        const direct = stmt && kids(stmt)[0]?.name === 'statementWithoutTrailingSubstatement' && kids(kids(stmt)[0])[0]?.name === 'expressionStatement';
        if (!es || !direct) throw new Unsupported('control flow');
        it.statement(expr(child(child(es, 'statementExpression'), 'expression')));
      } catch (e) {
        if (!(e instanceof Unsupported)) throw e;
        it.unsupported.push({ line: lineOf(start(st)), text: text.length > 140 ? `${text.slice(0, 137)}...` : text, reason: e.message });
      }
    }
    methods.push({
      name,
      file,
      line: lineOf(start(m)),
      sceneId: it.sceneId,
      title: it.title,
      basePlate: it.basePlate,
      scale: it.scale ?? null,
      selections: it.selections,
      actions: it.actions,
      end: it.end ?? (it.now > 0 ? it.now : null),
      unsupported: it.unsupported
    });
  }
  return { methods };
}
