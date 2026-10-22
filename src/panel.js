import { DOCS_DIR } from './codegen.js';
import { button, clear, h } from './ui.js';
import { listFiles as listAll } from './files.js';

const M = 'ext.galaxy.ponder-studio.';

export async function openPanel(root) {
  const state = { docs: [], structures: [], status: null, scenes: [], error: null, playing: null };
  const listFiles = async (dir, suffix) => {
    try {
      return await listAll(dir, suffix);
    } catch {
      return [];
    }
  };
  const load = async (game = true) => {
    state.docs = [];
    for (const f of await listFiles(DOCS_DIR, '.ponderstudio.json')) {
      try {
        const r = await modsmith.readFile(f);
        state.docs.push({ file: f, doc: JSON.parse(r.content) });
      } catch (e) {
        state.docs.push({ file: f, error: e.message });
      }
    }
    const used = new Set(state.docs.map((d) => d.doc?.structure?.file));
    state.structures = (await listFiles('src/main/resources/assets', '.nbt')).filter((f) => /\/ponder\//.test(f) && !used.has(f));
    if (!game) {
      render();
      return;
    }
    try {
      state.status = await modsmith.call('bridge.call', { method: `${M}status`, params: {} });
      state.scenes = state.status.ponder ? await modsmith.call('bridge.call', { method: `${M}scenes`, params: {} }) : [];
      state.error = null;
    } catch (e) {
      state.status = null;
      state.scenes = [];
      state.error = /Start the game first/.test(e.message) ? 'The game is not running.' : /Unknown bridge method/.test(e.message) ? 'The companion mod is not in this game. Relaunch the client with the extension turned on.' : e.message;
    }
    render();
  };
  const play = async (component) => {
    try {
      await modsmith.call('bridge.call', { method: `${M}play`, params: { component } });
      modsmith.showGame();
    } catch (e) {
      modsmith.toast('error', e.message);
    }
  };
  const render = () => {
    clear(
      root,
      h('div', { class: 'panel-page' },
        h('header', { class: 'panel-head' }, h('h2', {}, 'Ponder Studio'), button('Refresh', () => load(true))),
        h('section', {}, h('h3', {}, 'Scenes in this project'), state.docs.length ? h('div', { class: 'list' }, state.docs.map((d) => h('button', { type: 'button', class: 'row', onClick: () => modsmith.openFile(d.file), title: d.file }, h('span', { class: 'grow ellipsis' }, d.doc?.scene?.title ?? d.file), h('span', { class: 'mute small' }, d.error ? 'unreadable' : `${d.doc.actions?.length ?? 0} actions`)))) : h('p', { class: 'mute' }, 'No storyboards yet. Open a structure below, or a .nbt under assets/<mod>/ponder/, and choose Create storyboard.')),
        h('section', {}, h('h3', {}, 'Structures without a storyboard'), state.structures.length ? h('div', { class: 'list' }, state.structures.map((f) => h('button', { type: 'button', class: 'row', onClick: () => modsmith.openFile(f), title: f }, h('span', { class: 'grow ellipsis' }, f.replace(/^src\/main\/resources\/assets\//, ''))))) : h('p', { class: 'mute small' }, 'None')),
        h('section', {}, h('h3', {}, 'Registered in the game'), state.status ? h('p', { class: 'mute small' }, `Create ${state.status.create ?? 'not installed'} · Ponder ${state.status.ponder ?? 'not installed'} · companion ${state.status.companion}`) : h('p', { class: 'mute small' }, state.error ?? ''), state.scenes.length ? h('div', { class: 'list' }, state.scenes.map((s) => h('div', { class: 'row' }, h('span', { class: 'grow ellipsis', title: s.schematic }, s.component), button('Play', () => play(s.component))))) : null)
      )
    );
  };
  render();
  await load();
  modsmith.onFilesChanged(() => load(false));
}
