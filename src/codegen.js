import { compileStoryboard, sortedActions, ACTIONS } from './doc.js';
import { sha256 } from './sha256.js';

export const GENERATOR_VERSION = 1;
export const LOCK_FILE = 'src/main/ponderstudio/ponderstudio.lock.json';
export const DOCS_DIR = 'src/main/ponderstudio';

export const ADAPTERS = [
  {
    id: 'neoforge-1.21.1-ponder-1.0',
    loader: 'neoforge',
    minecraft: '1.21.1',
    ponder: { min: '1.0.0', below: '2.0.0' },
    create: { min: '6.0.0', below: '7.0.0' },
    capabilities: ['show', 'hide', 'block_state', 'move', 'rotate', 'text', 'outline', 'input', 'rotate_camera', 'keyframe', 'kinetic'],
    needsCreate: ['kinetic']
  }
];

const parts = (v) => String(v ?? '').split(/[-+]/)[0].split('.').map((p) => Number(p) || 0);
export function compareVersions(a, b) {
  const pa = parts(a);
  const pb = parts(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return Math.sign(d);
  }
  return 0;
}

export function pickAdapter({ loader, minecraft, ponder, create }) {
  const problems = [];
  const adapter = ADAPTERS.find((a) => a.loader === loader && a.minecraft === minecraft);
  if (!adapter) return { adapter: null, problems: [`Exporting Java for ${loader ?? 'this loader'} ${minecraft ?? ''} is not supported yet; supported: ${ADAPTERS.map((a) => `${a.loader} ${a.minecraft}`).join(', ')}`] };
  if (ponder && (compareVersions(ponder, adapter.ponder.min) < 0 || compareVersions(ponder, adapter.ponder.below) >= 0)) problems.push(`Ponder ${ponder} is outside the supported range ${adapter.ponder.min} to below ${adapter.ponder.below}`);
  if (create && (compareVersions(create, adapter.create.min) < 0 || compareVersions(create, adapter.create.below) >= 0)) problems.push(`Create ${create} is outside the supported range ${adapter.create.min} to below ${adapter.create.below}`);
  return { adapter, problems };
}

export function javaIdentifier(text, upper) {
  const words = String(text).split(/[^A-Za-z0-9]+/).filter(Boolean);
  let s = words.map((w, i) => (i === 0 && !upper ? w[0].toLowerCase() + w.slice(1) : w[0].toUpperCase() + w.slice(1))).join('');
  if (!s) s = upper ? 'Scene' : 'value';
  if (/^[0-9]/.test(s)) s = `${upper ? 'S' : 's'}${s}`;
  return JAVA_KEYWORDS.has(s) ? `${s}_` : s;
}

const JAVA_KEYWORDS = new Set('abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for goto if implements import instanceof int interface long native new package private protected public return short static strictfp super switch synchronized this throw throws transient try void volatile while true false null var record yield'.split(' '));

export function sceneClassName(doc) {
  return doc.export?.className || `${javaIdentifier(doc.scene.id.split('/').pop(), true)}Scene`;
}

export function javaString(s) {
  let out = '"';
  for (const ch of String(s)) {
    const c = ch.codePointAt(0);
    if (ch === '"') out += '\\"';
    else if (ch === '\\') out += '\\\\';
    else if (ch === '\n') out += '\\n';
    else if (ch === '\t') out += '\\t';
    else if (ch === '\r') out += '\\r';
    else if (c < 0x20 || c > 0x7e) {
      if (c > 0xffff) {
        const hi = Math.floor((c - 0x10000) / 0x400) + 0xd800;
        const lo = ((c - 0x10000) % 0x400) + 0xdc00;
        out += `\\u${hi.toString(16).padStart(4, '0')}\\u${lo.toString(16).padStart(4, '0')}`;
      } else out += `\\u${c.toString(16).padStart(4, '0')}`;
    } else out += ch;
  }
  return `${out}"`;
}

function num(n) {
  if (Number.isInteger(n)) return String(n);
  return String(Number(n));
}

function floatLit(n) {
  return `${num(n)}f`;
}

function dbl(n) {
  return Number.isInteger(n) ? `${n}` : num(n);
}

function selectionExpr(boxes) {
  return boxes
    .map((b, i) => {
      const single = b[0] === b[3] && b[1] === b[4] && b[2] === b[5];
      const e = single ? `util.select().position(${b[0]}, ${b[1]}, ${b[2]})` : `util.select().fromTo(${b.join(', ')})`;
      return i === 0 ? e : `.add(${e})`;
    })
    .join('');
}

function anchorExpr(anchor, imports) {
  if (!anchor) return null;
  const p = anchor.pos ?? [0, 0, 0];
  switch (anchor.kind) {
    case 'block':
      return `util.vector().centerOf(${p.join(', ')})`;
    case 'top':
      return `util.vector().topOf(${p.join(', ')})`;
    case 'face':
      imports.add('net.minecraft.core.Direction');
      return `util.vector().blockSurface(util.grid().at(${p.join(', ')}), Direction.${String(anchor.face ?? 'up').toUpperCase()})`;
    case 'point':
      return `util.vector().of(${anchor.point.map(dbl).join(', ')})`;
    default:
      return null;
  }
}

export function generateScene(doc, pkg, options = {}) {
  const board = compileStoryboard(doc);
  const className = sceneClassName(doc);
  const imports = new Set(['net.createmod.ponder.api.scene.SceneBuilder', 'net.createmod.ponder.api.scene.SceneBuildingUtil']);
  const usesCreate = options.create !== false && board.actions.some((a) => a.type === 'kinetic');
  if (usesCreate) imports.add('com.simibubi.create.foundation.ponder.CreateSceneBuilder');
  const body = [];
  const helpers = [];
  const locals = new Map();
  const localNames = new Set(['scene', 'builder', 'util']);
  const selectionVar = (a) => {
    const expr = selectionExpr(a.selection);
    const key = expr;
    if (locals.has(key)) return locals.get(key).name;
    const named = (doc.selections ?? []).find((s) => s.id === a.section);
    let base = javaIdentifier(named?.name ?? a.section ?? 'selection', false);
    let name = base;
    let n = 2;
    while (localNames.has(name)) name = `${base}${n++}`;
    localNames.add(name);
    locals.set(key, { name, expr });
    return name;
  };
  const sections = new Map();
  const lang = {};
  const langPrefix = `${board.namespace}.ponder.${board.sceneId}`;
  lang[`${langPrefix}.header`] = board.title;
  let textIndex = 1;
  let now = 0;
  const stmts = [];
  for (const a of board.actions) {
    if (a.at > now) {
      stmts.push(`scene.idle(${a.at - now});`);
      now = a.at;
    }
    switch (a.type) {
      case 'show':
        imports.add('net.minecraft.core.Direction');
        stmts.push(`scene.world().showSection(${selectionVar(a)}, Direction.${(a.direction ?? 'down').toUpperCase()});`);
        break;
      case 'hide':
        imports.add('net.minecraft.core.Direction');
        stmts.push(`scene.world().hideSection(${selectionVar(a)}, Direction.${(a.direction ?? 'up').toUpperCase()});`);
        break;
      case 'block_state':
        helpers.push('state');
        stmts.push(`scene.world().setBlocks(${selectionVar(a)}, state(${javaString(a.state)}), ${a.particles ? 'true' : 'false'});`);
        break;
      case 'move':
      case 'rotate': {
        imports.add('net.createmod.ponder.api.element.ElementLink');
        imports.add('net.createmod.ponder.api.element.WorldSectionElement');
        const sel = selectionVar(a);
        let link = sections.get(a.section);
        if (!link) {
          let name = `${javaIdentifier(sel, false)}Section`;
          while (localNames.has(name)) name = `${name}2`;
          localNames.add(name);
          link = name;
          sections.set(a.section, link);
          stmts.push(`ElementLink<WorldSectionElement> ${link} = scene.world().makeSectionIndependent(${sel});`);
        }
        if (a.type === 'move') {
          imports.add('net.minecraft.world.phys.Vec3');
          stmts.push(`scene.world().moveSection(${link}, new Vec3(${a.offset.map(dbl).join(', ')}), ${a.duration ?? 20});`);
        } else stmts.push(`scene.world().rotateSection(${link}, ${a.rotation.map(dbl).join(', ')}, ${a.duration ?? 20});`);
        break;
      }
      case 'text': {
        let s = `scene.overlay().showText(${a.duration ?? 60})`;
        if (a.color) {
          imports.add('net.createmod.ponder.api.PonderPalette');
          s += `\n\t.colored(PonderPalette.${a.color.toUpperCase()})`;
        }
        s += `\n\t.text(${javaString(a.text ?? '')})`;
        const anchor = anchorExpr(a.anchor, imports);
        s += anchor ? `\n\t.pointAt(${anchor})` : `\n\t.independent(${a.screenY ?? 0})`;
        if (a.placeNearTarget) s += '\n\t.placeNearTarget()';
        if (a.keyframe) s += '\n\t.attachKeyFrame()';
        stmts.push(`${s};`);
        lang[`${langPrefix}.text_${textIndex++}`] = a.text ?? '';
        break;
      }
      case 'outline':
        imports.add('net.createmod.ponder.api.PonderPalette');
        stmts.push(`scene.overlay().showOutline(PonderPalette.${(a.color ?? 'white').toUpperCase()}, ${javaString(a.id)}, ${selectionVar(a)}, ${a.duration ?? 60});`);
        break;
      case 'input': {
        imports.add('net.createmod.catnip.math.Pointing');
        let s = `scene.overlay().showControls(${anchorExpr(a.anchor, imports)}, Pointing.${(a.pointing ?? 'down').toUpperCase()}, ${a.duration ?? 60})`;
        if (a.click === 'right') s += '\n\t.rightClick()';
        if (a.click === 'left') s += '\n\t.leftClick()';
        if (a.click === 'scroll') s += '\n\t.scroll()';
        if (a.item) {
          helpers.push('item');
          s += `\n\t.withItem(item(${javaString(a.item)}))`;
        }
        if (a.sneaking) s += '\n\t.whileSneaking()';
        if (a.ctrl) s += '\n\t.whileCTRL()';
        stmts.push(`${s};`);
        break;
      }
      case 'rotate_camera':
        stmts.push(`scene.rotateCameraY(${floatLit(a.degrees)});`);
        break;
      case 'keyframe':
        stmts.push('scene.addKeyframe();');
        break;
      case 'kinetic':
        stmts.push(`scene.world().setKineticSpeed(${selectionVar(a)}, ${floatLit(a.speed)});`);
        break;
      default:
        break;
    }
  }
  if (board.end > now) stmts.push(`scene.idle(${board.end - now});`);
  stmts.push('scene.markAsFinished();');
  body.push(usesCreate ? 'CreateSceneBuilder scene = new CreateSceneBuilder(builder);' : 'SceneBuilder scene = builder;');
  body.push(`scene.title(${javaString(board.sceneId)}, ${javaString(board.title)});`);
  body.push(`scene.configureBasePlate(${board.basePlate.x}, ${board.basePlate.z}, ${board.basePlate.size});`);
  if (board.scale) body.push(`scene.scaleSceneView(${floatLit(board.scale)});`);
  if (board.showBasePlate) body.push('scene.showBasePlate();');
  if (locals.size) imports.add('net.createmod.ponder.api.scene.Selection');
  for (const { name, expr } of locals.values()) body.push(`Selection ${name} = ${expr};`);
  body.push(...stmts);
  const helperCode = [];
  if (helpers.includes('state')) {
    imports.add('net.minecraft.commands.arguments.blocks.BlockStateParser');
    imports.add('net.minecraft.core.registries.BuiltInRegistries');
    imports.add('net.minecraft.world.level.block.state.BlockState');
    helperCode.push(`\tprivate static BlockState state(String text) {\n\t\ttry {\n\t\t\treturn BlockStateParser.parseForBlock(BuiltInRegistries.BLOCK.asLookup(), text, false).blockState();\n\t\t} catch (Exception e) {\n\t\t\tthrow new IllegalArgumentException("Invalid block state " + text, e);\n\t\t}\n\t}`);
  }
  if (helpers.includes('item')) {
    imports.add('net.minecraft.core.registries.BuiltInRegistries');
    imports.add('net.minecraft.resources.ResourceLocation');
    imports.add('net.minecraft.world.item.ItemStack');
    helperCode.push(`\tprivate static ItemStack item(String id) {\n\t\treturn new ItemStack(BuiltInRegistries.ITEM.get(ResourceLocation.parse(id)));\n\t}`);
  }
  const lines = [];
  lines.push(`package ${pkg}.scenes;`, '');
  for (const i of [...imports].sort()) lines.push(`import ${i};`);
  lines.push('', `public final class ${className} {`, `\tprivate ${className}() {`, '\t}', '');
  lines.push('\tpublic static void program(SceneBuilder builder, SceneBuildingUtil util) {');
  for (const b of body) lines.push(...b.split('\n').map((l) => `\t\t${l}`));
  lines.push('\t}');
  for (const h of helperCode) lines.push('', h);
  lines.push('}', '');
  return { className, fqcn: `${pkg}.scenes.${className}`, content: lines.join('\n'), lang };
}

export function schematicPath(doc) {
  if (doc.structure?.schematic) return doc.structure.schematic;
  const m = /assets\/([^/]+)\/ponder\/(.+)\.nbt$/.exec(doc.structure?.file ?? '');
  return m ? m[2] : doc.scene.id;
}

export function structureProblem(doc) {
  const m = /^src\/main\/resources\/assets\/([^/]+)\/ponder\/(.+)\.nbt$/.exec(doc.structure?.file ?? '');
  if (!m) return `The structure must be saved under src/main/resources/assets/${doc.scene.namespace}/ponder/ so Ponder can load it`;
  if (m[1] !== doc.scene.namespace) return `The structure is in the ${m[1]} namespace but the scene belongs to ${doc.scene.namespace}`;
  return null;
}

export function generatePlugin(docs, pkg, modId) {
  const sorted = [...docs].sort((a, b) => a.scene.id.localeCompare(b.scene.id));
  const imports = new Set(['net.createmod.ponder.api.registration.PonderPlugin', 'net.createmod.ponder.api.registration.PonderSceneRegistrationHelper', 'net.createmod.ponder.foundation.PonderIndex', 'net.minecraft.resources.ResourceLocation']);
  const regs = [];
  for (const d of sorted) {
    const cls = sceneClassName(d);
    imports.add(`${pkg}.scenes.${cls}`);
    const comps = [d.scene.component, ...(d.items ?? []).filter((x) => x !== d.scene.component)];
    for (const c of comps) regs.push(`\t\thelper.addStoryBoard(ResourceLocation.parse(${javaString(c)}), ${javaString(schematicPath(d))}, ${cls}::program);`);
  }
  const lines = [`package ${pkg};`, ''];
  for (const i of [...imports].sort()) lines.push(`import ${i};`);
  lines.push('', 'public final class PonderStudioPlugin implements PonderPlugin {', '\tpublic static void install() {', '\t\tPonderIndex.addPlugin(new PonderStudioPlugin());', '\t}', '', '\t@Override', '\tpublic String getModId() {', `\t\treturn ${javaString(modId)};`, '\t}', '', '\t@Override', '\tpublic void registerScenes(PonderSceneRegistrationHelper<ResourceLocation> helper) {', ...regs, '\t}', '}', '');
  return lines.join('\n');
}

export function generateClient(pkg, modId) {
  return [
    `package ${pkg};`,
    '',
    'import net.neoforged.api.distmarker.Dist;',
    'import net.neoforged.bus.api.SubscribeEvent;',
    'import net.neoforged.fml.ModList;',
    'import net.neoforged.fml.common.EventBusSubscriber;',
    'import net.neoforged.fml.event.lifecycle.FMLClientSetupEvent;',
    '',
    `@EventBusSubscriber(modid = ${javaString(modId)}, bus = EventBusSubscriber.Bus.MOD, value = Dist.CLIENT)`,
    'public final class PonderStudioClient {',
    '\tprivate PonderStudioClient() {',
    '\t}',
    '',
    '\t@SubscribeEvent',
    '\tpublic static void onClientSetup(FMLClientSetupEvent event) {',
    '\t\tif (ModList.get().isLoaded("ponder")) {',
    '\t\t\tevent.enqueueWork(PonderStudioPlugin::install);',
    '\t\t}',
    '\t}',
    '}',
    ''
  ].join('\n');
}

export function javaPath(pkg, cls) {
  return `src/main/java/${pkg.replace(/\./g, '/')}/${cls}.java`;
}

export function langPath(namespace) {
  return `src/main/resources/assets/${namespace}/lang/en_us.json`;
}

export function planOutputs(docs, { pkg, modId }) {
  const files = {};
  const lang = {};
  const problems = [];
  for (const d of docs) {
    const sp = structureProblem(d);
    if (sp) problems.push(`${d.scene.id}: ${sp}`);
    if (d.scene.namespace !== modId) problems.push(`${d.scene.id}: the scene namespace ${d.scene.namespace} must be the mod id ${modId}`);
    const g = generateScene(d, pkg);
    files[javaPath(`${pkg}.scenes`, g.className)] = g.content;
    const lp = langPath(d.scene.namespace);
    lang[lp] = { ...(lang[lp] ?? {}), ...g.lang };
  }
  const names = new Map();
  const ids = new Set();
  for (const d of docs) {
    const id = `${d.scene.namespace}:${d.scene.id}`;
    if (ids.has(id)) problems.push(`${id} is used by more than one storyboard; scene ids must be unique`);
    ids.add(id);
    const c = sceneClassName(d);
    if (names.has(c)) problems.push(`${d.scene.id} and ${names.get(c)} would both generate ${c}; set export.className on one of them`);
    names.set(c, d.scene.id);
  }
  files[javaPath(pkg, 'PonderStudioPlugin')] = generatePlugin(docs, pkg, modId);
  files[javaPath(pkg, 'PonderStudioClient')] = generateClient(pkg, modId);
  return { files, lang, problems };
}

function detectIndent(text) {
  const m = /\n([ \t]+)"/.exec(text);
  return m ? m[1] : '  ';
}

export function mergeLang(currentText, planned, owned, forced = []) {
  let current = {};
  if (currentText != null && currentText.trim()) {
    try {
      current = JSON.parse(currentText);
    } catch (e) {
      return { error: `The language file is not valid JSON: ${e.message}` };
    }
  }
  const conflicts = [];
  const next = { ...current };
  const added = [];
  for (const [k, v] of Object.entries(planned)) {
    const cur = current[k];
    if (cur === undefined) {
      added.push(k);
      continue;
    }
    if (cur === v) continue;
    if ((owned[k] === undefined || cur !== owned[k]) && !forced.includes(k)) conflicts.push({ key: k, current: cur, planned: v });
  }
  const removed = [];
  for (const [k, v] of Object.entries(owned)) {
    if (planned[k] !== undefined) continue;
    if (current[k] === v) {
      delete next[k];
      removed.push(k);
    }
  }
  const kept = new Set(conflicts.map((c) => c.key));
  for (const k of Object.keys(next)) if (planned[k] !== undefined && !kept.has(k)) next[k] = planned[k];
  for (const k of added.sort()) next[k] = planned[k];
  const indent = currentText ? detectIndent(currentText) : '  ';
  const text = `${JSON.stringify(next, null, indent)}\n`;
  return { text, conflicts, added, removed, changed: text !== currentText };
}

export function planExport({ docs, pkg, modId, current, lock, force = [] }) {
  const { files, lang, problems } = planOutputs(docs, { pkg, modId });
  const prev = lock?.files ?? {};
  const writes = [];
  const conflicts = [];
  for (const [path, content] of Object.entries(files)) {
    const cur = current[path];
    if (cur === content) continue;
    if (cur != null && (!prev[path] || sha256(cur) !== prev[path].sha256) && !force.includes(path)) {
      conflicts.push({ path, reason: prev[path] ? 'changed outside Ponder Studio since the last export' : 'already exists and was not written by Ponder Studio' });
      continue;
    }
    writes.push({ path, content });
  }
  const langWrites = [];
  const ownedLang = lock?.lang ?? {};
  const nextLang = {};
  for (const [path, planned] of Object.entries(lang)) {
    const forcedKeys = force.filter((f) => f.startsWith(`${path}#`)).map((f) => f.slice(path.length + 1));
    const merged = mergeLang(current[path], planned, ownedLang[path] ?? {}, forcedKeys);
    if (merged.error) {
      conflicts.push({ path, reason: merged.error });
      continue;
    }
    for (const c of merged.conflicts) conflicts.push({ path: `${path}#${c.key}`, reason: `has the hand-written value ${JSON.stringify(c.current)}; Ponder Studio would write ${JSON.stringify(c.planned)}` });
    if (merged.changed) langWrites.push({ path, content: merged.text, added: merged.added, removed: merged.removed });
    const owned = {};
    for (const [k, v] of Object.entries(planned)) if (!merged.conflicts.some((c) => c.key === k)) owned[k] = v;
    nextLang[path] = Object.fromEntries(Object.entries(owned).sort(([a], [b]) => a.localeCompare(b)));
  }
  const stale = Object.keys(prev).filter((p) => !(p in files));
  const nextFiles = {};
  for (const [path, content] of Object.entries(files)) {
    if (conflicts.some((c) => c.path === path)) {
      if (prev[path]) nextFiles[path] = prev[path];
      continue;
    }
    nextFiles[path] = { sha256: sha256(content) };
  }
  const nextLock = {
    format: 'ponderstudio-lock',
    version: 1,
    generator: GENERATOR_VERSION,
    files: Object.fromEntries(Object.entries(nextFiles).sort(([a], [b]) => a.localeCompare(b))),
    lang: Object.fromEntries(Object.entries(nextLang).sort(([a], [b]) => a.localeCompare(b)))
  };
  return { writes, langWrites, conflicts, stale, problems, lock: nextLock };
}

export function actionSummary(a) {
  return ACTIONS[a.type]?.label ?? a.type;
}

export { sortedActions };
