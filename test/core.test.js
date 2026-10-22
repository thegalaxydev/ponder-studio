import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { unzipSync } from 'fflate';
import { T, get, parseSnbt, readNbt, readNbtFile, toSnbt, writeNbt, set, tag } from '../src/nbt.js';
import { History, Structure, parseState, stateKey } from '../src/structure.js';
import { compileStoryboard, diagnose, endTick, newDocument } from '../src/doc.js';
import { generateScene, mergeLang, planExport, pickAdapter, javaString } from '../src/codegen.js';
import { sha256 } from '../src/sha256.js';

const fixture = (name) => new Uint8Array(fs.readFileSync(path.join(__dirname, 'fixtures', name)));
const createJar = path.join(__dirname, '..', 'companion', 'neoforge-1.21.1', 'libs', 'create-1.21.1-6.0.10.jar');

describe('NBT', () => {
  it('writes every Create Ponder structure back byte for byte', () => {
    const files = fs.existsSync(createJar) ? unzipSync(fs.readFileSync(createJar), { filter: (f) => /^assets\/create\/ponder\/.+\.nbt$/.test(f.name) }) : { 'cog_small.nbt': fixture('cog_small.nbt'), 'shaft_relay.nbt': fixture('shaft_relay.nbt') };
    const names = Object.keys(files);
    expect(names.length).toBeGreaterThan(1);
    for (const name of names) {
      const raw = new Uint8Array(zlib.gunzipSync(files[name]));
      const doc = readNbt(raw);
      expect(doc.trailing, name).toBe(0);
      expect(Buffer.from(writeNbt(doc)).equals(Buffer.from(raw)), name).toBe(true);
    }
  });

  it('keeps tag types, key order, float bits, longs and modified UTF-8 strings', () => {
    const root = tag.compound([
      ['z', tag.byte(-3)],
      ['a', tag.short(300)],
      ['0', tag.long(-9007199254740993n)],
      ['f', { t: T.FLOAT, v: 0.1, bits: 0x3dcccccd }],
      ['nan', { t: T.FLOAT, v: NaN, bits: 0x7fc00001 }],
      ['d', tag.double(-0)],
      ['s', tag.string('café \u0000 😀')],
      ['bytes', { t: T.BYTE_ARRAY, v: Int8Array.from([-128, 0, 127]) }],
      ['longs', { t: T.LONG_ARRAY, v: BigInt64Array.from([1n, -1n]) }],
      ['empty', tag.list(T.STRING, [])],
      ['nested', tag.list(T.LIST, [tag.list(T.INT, [tag.int(1)])])]
    ]);
    const bytes = writeNbt({ name: 'root', root });
    const back = readNbt(bytes);
    expect(back.name).toBe('root');
    expect(back.root.v.map(([k]) => k)).toEqual(['z', 'a', '0', 'f', 'nan', 'd', 's', 'bytes', 'longs', 'empty', 'nested']);
    expect(get(back.root, '0').v).toBe(-9007199254740993n);
    expect(get(back.root, 'nan').bits).toBe(0x7fc00001);
    expect(Object.is(get(back.root, 'd').v, -0)).toBe(true);
    expect(get(back.root, 's').v).toBe('café \u0000 😀');
    expect(get(back.root, 'empty').et).toBe(T.STRING);
    expect(Buffer.from(writeNbt(back)).equals(Buffer.from(bytes))).toBe(true);
  });

  it('round-trips SNBT for the typed inspector', () => {
    const t = parseSnbt('{Speed: 32.0f, Count: 3b, Id: "create:cogwheel", Ids: [I; 1, 2], Items: [{Slot: 0b}], Big: 5L}');
    expect(get(t, 'Speed')).toMatchObject({ t: T.FLOAT, v: 32 });
    expect(get(t, 'Count')).toMatchObject({ t: T.BYTE, v: 3 });
    expect(get(t, 'Big')).toMatchObject({ t: T.LONG, v: 5n });
    expect(toSnbt(parseSnbt(toSnbt(t)))).toBe(toSnbt(t));
    expect(() => parseSnbt('[1, "a"]')).toThrow(/mixes tag types/);
  });
});

describe('structure editing', () => {
  it('reads blocks, edits with undo and redo, and restores the exact original bytes', async () => {
    const original = fixture('cog_small.nbt');
    const s = await Structure.load(original);
    const rawBefore = writeNbt({ name: s.file.name, root: s.root });
    expect(s.size.every((n) => n > 0)).toBe(true);
    const [x, y, z] = [...s.positions()].find(([, , , b]) => get(b, 'nbt'))?.slice(0, 3) ?? [...s.positions()][0];
    const before = s.blockAt(x, y, z);
    const h = new History(s);
    h.apply('place', [{ x: 9, y: 9, z: 9, after: { key: 'minecraft:stone', nbt: null } }]);
    h.apply('replace', [{ x, y, z, after: { key: 'minecraft:gold_block', nbt: null } }]);
    expect(s.blockAt(9, 9, 9).name).toBe('minecraft:stone');
    expect(s.blockAt(x, y, z).name).toBe('minecraft:gold_block');
    expect(s.size).toEqual([Math.max(s.size[0], 10), Math.max(s.size[1], 10), Math.max(s.size[2], 10)]);
    h.undo();
    h.undo();
    expect(s.blockAt(9, 9, 9)).toBeNull();
    expect(s.blockAt(x, y, z).key).toBe(before.key);
    expect(s.blockAt(x, y, z).nbt ? toSnbt(s.blockAt(x, y, z).nbt) : null).toBe(before.nbt ? toSnbt(before.nbt) : null);
    h.redo();
    expect(s.blockAt(9, 9, 9).name).toBe('minecraft:stone');
    h.undo();
    s.size = JSON.parse(JSON.stringify(readNbt(rawBefore).root.v.find(([n]) => n === 'size')[1].v.map((t) => t.v)));
    const after = writeNbt({ name: s.file.name, root: s.root });
    const pal = (raw) => readNbt(raw).root.v.find(([n]) => n === 'palette')[1].v.length;
    expect(pal(after)).toBe(pal(rawBefore) + 2);
    const strip = (raw) => {
      const r = readNbt(raw).root;
      r.v = r.v.filter(([n]) => n !== 'palette');
      return Buffer.from(writeNbt({ name: '', root: r }));
    };
    expect(strip(after).equals(strip(rawBefore))).toBe(true);
  });

  it('never drops unknown blocks or their block entity data', async () => {
    const s = await Structure.load(fixture('shaft_relay.nbt'));
    const [x, y, z, b] = [...s.positions()][0];
    const pi = get(b, 'state').v;
    set(s.palette.v[pi], 'Name', tag.string('unknownmod:mystery'));
    set(b, 'nbt', tag.compound([['Secret', tag.int(42)], ['id', tag.string('unknownmod:mystery')]]));
    s.reindex();
    const h = new History(s);
    h.apply('other edit', [{ x: x + 20, y, z, after: { key: 'minecraft:stone', nbt: null } }]);
    const reloaded = await Structure.load(await s.toBytes());
    const kept = reloaded.blockAt(x, y, z);
    expect(kept.name).toBe('unknownmod:mystery');
    expect(get(kept.nbt, 'Secret').v).toBe(42);
  });

  it('parses and prints block states', () => {
    expect(parseState('create:shaft[axis=x]')).toEqual({ name: 'create:shaft', props: { axis: 'x' } });
    expect(parseState('stone')).toEqual({ name: 'minecraft:stone', props: {} });
    expect(stateKey('create:cogwheel', { waterlogged: 'false', axis: 'y' })).toBe('create:cogwheel[axis=y,waterlogged=false]');
    expect(() => parseState('Not A Block')).toThrow();
  });
});

function demoDoc() {
  const d = newDocument({ namespace: 'gemtools', sceneId: 'cogwheel_intro', title: 'Relaying rotation with cogwheels', component: 'create:cogwheel', structureFile: 'src/main/resources/assets/gemtools/ponder/cogwheel_intro.nbt', schematic: 'cogwheel_intro' });
  d.selections = [
    { id: 'shaft', name: 'Shaft', boxes: [[2, 1, 0, 2, 1, 1]] },
    { id: 'cog', name: 'Cogwheel', boxes: [[2, 1, 2, 2, 1, 2]] }
  ];
  d.actions = [
    { id: 'a3', type: 'text', at: 20, text: 'Cogwheels pass rotation to neighbours.', duration: 60, anchor: { kind: 'face', pos: [2, 1, 2], face: 'up' }, placeNearTarget: true, keyframe: true, color: null },
    { id: 'a1', type: 'show', at: 5, selection: 'shaft', direction: 'down' },
    { id: 'a2', type: 'show', at: 15, selection: 'cog', direction: 'down' },
    { id: 'a4', type: 'kinetic', at: 20, selection: 'shaft', speed: 32 },
    { id: 'a5', type: 'kinetic', at: 20, selection: 'cog', speed: -32 },
    { id: 'a6', type: 'text', at: 40, text: 'They spin the other way.', duration: 40, anchor: { kind: 'block', pos: [2, 1, 2] }, placeNearTarget: false, keyframe: false, color: 'blue' }
  ];
  return d;
}

describe('storyboard timing', () => {
  it('keeps overlapping actions and orders same-tick actions as authored', () => {
    const board = compileStoryboard(demoDoc());
    expect(board.actions.map((a) => `${a.at}:${a.id}`)).toEqual(['5:a1', '15:a2', '20:a3', '20:a4', '20:a5', '40:a6']);
    expect(board.end).toBe(100);
    expect(endTick({ ...demoDoc(), length: 200 })).toBe(200);
    expect(board.actions.find((a) => a.id === 'a4').selection).toEqual([[2, 1, 0, 2, 1, 1]]);
  });

  it('reports broken targets after structure edits', () => {
    const s = Structure.empty([5, 2, 5]);
    s.put(2, 1, 0, { key: 'create:shaft[axis=z]', nbt: null });
    const d = demoDoc();
    d.actions.push({ id: 'a7', type: 'show', at: 1, selection: 'missing' });
    const out = diagnose(d, s);
    expect(out).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: 'a2', message: expect.stringMatching(/covers no blocks/) }),
      expect.objectContaining({ action: 'a7', message: 'The selection missing no longer exists' }),
      expect.objectContaining({ action: 'a3', message: 'The anchor block at 2 1 2 is empty' })
    ]));
  });
});

describe('Java export', () => {
  it('generates the storyboard deterministically with Ponder scheduling and lang keys', () => {
    const a = generateScene(demoDoc(), 'com.example.gemtools.ponder');
    const b = generateScene(JSON.parse(JSON.stringify(demoDoc())), 'com.example.gemtools.ponder');
    expect(a.content).toBe(b.content);
    expect(a.className).toBe('CogwheelIntroScene');
    expect(a.content).toContain('CreateSceneBuilder scene = new CreateSceneBuilder(builder);');
    const order = ['scene.idle(5);', 'showSection(shaft, Direction.DOWN)', 'scene.idle(10);', 'showSection(cogwheel, Direction.DOWN)', 'scene.idle(5);', 'showText(60)', 'setKineticSpeed(shaft, 32f)', 'setKineticSpeed(cogwheel, -32f)', 'scene.idle(20);', 'showText(40)', 'scene.idle(60);', 'scene.markAsFinished();'];
    let at = 0;
    for (const o of order) {
      const i = a.content.indexOf(o, at);
      expect(i, o).toBeGreaterThan(-1);
      at = i;
    }
    expect(a.lang).toEqual({ 'gemtools.ponder.cogwheel_intro.header': 'Relaying rotation with cogwheels', 'gemtools.ponder.cogwheel_intro.text_1': 'Cogwheels pass rotation to neighbours.', 'gemtools.ponder.cogwheel_intro.text_2': 'They spin the other way.' });
    expect(a.content).not.toMatch(/\/\/|\/\*/);
    expect(javaString('a"b\\cé')).toBe('"a\\"b\\\\c\\u00e9"');
  });

  it('tracks ownership, refuses to overwrite hand-written code, and does not duplicate lang entries', () => {
    const docs = [demoDoc()];
    const opts = { docs, pkg: 'com.example.gemtools.ponder', modId: 'gemtools' };
    const handLang = '{\n    "item.gemtools.ruby": "Ruby"\n}\n';
    const first = planExport({ ...opts, current: { 'src/main/resources/assets/gemtools/lang/en_us.json': handLang }, lock: null });
    expect(first.conflicts).toEqual([]);
    expect(first.writes.map((w) => w.path).sort()).toEqual([
      'src/main/java/com/example/gemtools/ponder/PonderStudioClient.java',
      'src/main/java/com/example/gemtools/ponder/PonderStudioPlugin.java',
      'src/main/java/com/example/gemtools/ponder/scenes/CogwheelIntroScene.java'
    ]);
    const lang = first.langWrites[0];
    expect(JSON.parse(lang.content)).toEqual({ 'item.gemtools.ruby': 'Ruby', 'gemtools.ponder.cogwheel_intro.header': 'Relaying rotation with cogwheels', 'gemtools.ponder.cogwheel_intro.text_1': 'Cogwheels pass rotation to neighbours.', 'gemtools.ponder.cogwheel_intro.text_2': 'They spin the other way.' });
    expect(lang.content).toMatch(/^\{\n {4}"item/);
    const disk = { 'src/main/resources/assets/gemtools/lang/en_us.json': lang.content };
    for (const w of first.writes) disk[w.path] = w.content;
    const again = planExport({ ...opts, current: disk, lock: first.lock });
    expect(again.writes).toEqual([]);
    expect(again.langWrites).toEqual([]);
    expect(again.conflicts).toEqual([]);
    const edited = { ...disk, 'src/main/java/com/example/gemtools/ponder/PonderStudioPlugin.java': `${disk['src/main/java/com/example/gemtools/ponder/PonderStudioPlugin.java']}\n` };
    const docs2 = [{ ...demoDoc(), scene: { ...demoDoc().scene, title: 'New title' } }];
    const third = planExport({ ...opts, docs: docs2, current: edited, lock: first.lock });
    expect(third.conflicts.map((c) => c.path)).toEqual(['src/main/java/com/example/gemtools/ponder/PonderStudioPlugin.java']);
    expect(third.writes.map((w) => w.path)).toEqual(['src/main/java/com/example/gemtools/ponder/scenes/CogwheelIntroScene.java']);
    expect(JSON.parse(third.langWrites[0].content)['gemtools.ponder.cogwheel_intro.header']).toBe('New title');
    const handEdited = { ...disk, 'src/main/resources/assets/gemtools/lang/en_us.json': disk['src/main/resources/assets/gemtools/lang/en_us.json'].replace('They spin the other way.', 'Hand-tuned wording') };
    const fourth = planExport({ ...opts, current: handEdited, lock: first.lock });
    expect(fourth.conflicts).toEqual([expect.objectContaining({ path: 'src/main/resources/assets/gemtools/lang/en_us.json#gemtools.ponder.cogwheel_intro.text_2' })]);
    const forced = planExport({ ...opts, current: edited, lock: first.lock, force: ['src/main/java/com/example/gemtools/ponder/PonderStudioPlugin.java'] });
    expect(forced.conflicts).toEqual([]);
    const twin = { ...demoDoc(), export: { className: 'TwinScene' } };
    expect(planExport({ ...opts, docs: [demoDoc(), twin], current: {}, lock: null }).problems).toEqual(['gemtools:cogwheel_intro is used by more than one storyboard; scene ids must be unique']);
    expect(sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('removes lang keys it owned once their text is gone, but keeps hand-written ones', () => {
    const owned = { 'x.ponder.s.text_2': 'old' };
    const r = mergeLang('{\n  "keep": "me",\n  "x.ponder.s.text_2": "old"\n}\n', { 'x.ponder.s.header': 'T' }, owned);
    expect(JSON.parse(r.text)).toEqual({ keep: 'me', 'x.ponder.s.header': 'T' });
    expect(r.removed).toEqual(['x.ponder.s.text_2']);
  });

  it('reports versions without an adapter', () => {
    expect(pickAdapter({ loader: 'neoforge', minecraft: '1.21.1', ponder: '1.0.82+mc1.21.1', create: '6.0.10' }).problems).toEqual([]);
    expect(pickAdapter({ loader: 'fabric', minecraft: '1.21.1' }).adapter).toBeNull();
    expect(pickAdapter({ loader: 'neoforge', minecraft: '1.21.1', ponder: '2.1.0' }).problems[0]).toMatch(/outside the supported range/);
  });
});
