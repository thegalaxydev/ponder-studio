import { ACTIONS, TRACKS, durationOf, endTick, seconds, trackOf } from './doc.js';
import { h } from './ui.js';

export class Timeline {
  constructor(el, cb) {
    this.el = el;
    this.cb = cb;
    this.scale = 6;
    this.snap = 5;
    el.addEventListener(
      'wheel',
      (e) => {
        if (!e.ctrlKey) return;
        e.preventDefault();
        const before = this.scale;
        this.scale = Math.max(1.5, Math.min(40, this.scale * Math.exp(-e.deltaY * 0.0015)));
        if (before !== this.scale) this.cb.rerender();
      },
      { passive: false }
    );
  }

  ticksAt(clientX, scroller) {
    const r = scroller.getBoundingClientRect();
    return Math.max(0, Math.round((clientX - r.left + scroller.scrollLeft - 8) / this.scale));
  }

  render({ doc, time, mcTime, selected, diagnostics }) {
    const end = Math.max(endTick(doc), time + 40, 200);
    const width = end * this.scale + 80;
    const issues = new Map();
    for (const d of diagnostics) if (!issues.has(d.action) || d.level === 'error') issues.set(d.action, d);
    const scroller = this.el.querySelector('.tl-scroll');
    const scrollLeft = scroller?.scrollLeft ?? 0;
    const ruler = h('div', { class: 'tl-ruler', style: { width: `${width}px` } });
    const major = this.scale >= 10 ? 10 : this.scale >= 4 ? 20 : 40;
    for (let t = 0; t <= end; t += major / 2) {
      const isMajor = t % major === 0;
      ruler.append(h('div', { class: `tl-tick ${isMajor ? 'major' : ''}`, style: { left: `${8 + t * this.scale}px` } }, isMajor ? h('span', {}, `${t}`, h('small', {}, ` ${seconds(t)}s`)) : null));
    }
    const rows = TRACKS.map((track) => {
      const lane = h('div', { class: 'tl-lane', style: { width: `${width}px` }, dataset: { track: track.id } });
      for (const a of doc.actions.filter((x) => trackOf(x) === track.id)) {
        const meta = ACTIONS[a.type];
        const dur = durationOf(a);
        const issue = issues.get(a.id);
        const bar = h(
          'div',
          {
            class: `tl-action ${meta?.duration ? 'span' : 'instant'} ${selected === a.id ? 'selected' : ''} ${issue ? `issue ${issue.level}` : ''}`,
            style: { left: `${8 + a.at * this.scale}px`, width: meta?.duration ? `${Math.max(6, dur * this.scale)}px` : undefined },
            title: `${meta?.label ?? a.type} at ${a.at} ticks (${seconds(a.at)} s)${meta?.duration ? `, ${dur} ticks` : ''}${issue ? `\n${issue.message}` : ''}`,
            dataset: { id: a.id }
          },
          h('span', { class: 'tl-label' }, label(a))
        );
        if (meta?.duration) bar.append(h('div', { class: 'tl-handle', dataset: { handle: '1' } }));
        bar.addEventListener('mousedown', (e) => this.dragAction(e, a, bar));
        lane.append(bar);
      }
      lane.addEventListener('mousedown', (e) => {
        if (e.target !== lane) return;
        this.cb.select(null);
        this.cb.seek(this.ticksAt(e.clientX, this.el.querySelector('.tl-scroll')));
      });
      return h('div', { class: 'tl-row' }, h('div', { class: 'tl-head' }, track.label, h('button', { type: 'button', class: 'icon', title: `Add a ${track.label.toLowerCase()} action at the playhead`, onClick: (e) => this.cb.add(track.id, e.currentTarget) }, '+')), lane);
    });
    const playhead = h('div', { class: 'tl-playhead', style: { left: `${8 + time * this.scale}px` } });
    const mcHead = mcTime == null ? null : h('div', { class: 'tl-playhead mc', style: { left: `${8 + mcTime * this.scale}px` }, title: `Minecraft is at tick ${mcTime}` });
    const endMark = h('div', { class: 'tl-end', style: { left: `${8 + endTick(doc) * this.scale}px` }, title: `The scene ends at ${endTick(doc)} ticks` });
    const lanes = h('div', { class: 'tl-lanes' }, rows.map((r) => r.lastChild));
    const scroll = h('div', { class: 'tl-scroll' }, h('div', { class: 'tl-inner', style: { width: `${width}px` } }, ruler, lanes, endMark, playhead, mcHead));
    ruler.addEventListener('mousedown', (e) => {
      const seek = (ev) => this.cb.seek(this.ticksAt(ev.clientX, scroll));
      seek(e);
      const move = (ev) => seek(ev);
      const up = () => {
        window.removeEventListener('mousemove', move);
        window.removeEventListener('mouseup', up);
      };
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
    });
    const heads = h('div', { class: 'tl-heads' }, h('div', { class: 'tl-corner' }, h('span', {}, 'ticks'), h('small', {}, '20 / s')), rows.map((r) => r.firstChild));
    this.el.replaceChildren(heads, scroll);
    scroll.scrollLeft = scrollLeft;
  }

  dragAction(e, a, bar) {
    if (e.button !== 0) return;
    e.stopPropagation();
    this.cb.select(a.id);
    const resizing = e.target.dataset.handle === '1';
    const startX = e.clientX;
    const startAt = a.at;
    const startDur = a.duration ?? 0;
    let moved = false;
    const snap = (v, ev) => (ev.altKey ? v : Math.round(v / this.snap) * this.snap);
    const move = (ev) => {
      const dt = (ev.clientX - startX) / this.scale;
      if (Math.abs(ev.clientX - startX) > 2) moved = true;
      if (!moved) return;
      if (resizing) {
        const d = Math.max(1, snap(startDur + dt, ev));
        bar.style.width = `${Math.max(6, d * this.scale)}px`;
        bar.dataset.preview = String(d);
      } else {
        const at = Math.max(0, snap(startAt + dt, ev));
        bar.style.left = `${8 + at * this.scale}px`;
        bar.dataset.preview = String(at);
      }
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      if (!moved || bar.dataset.preview === undefined) return;
      const v = Number(bar.dataset.preview);
      if (resizing) this.cb.change(a.id, { duration: v }, 'Change duration');
      else this.cb.change(a.id, { at: v }, 'Move action');
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  }
}

function label(a) {
  switch (a.type) {
    case 'text':
      return a.text || 'Caption';
    case 'kinetic':
      return `${a.speed} RPM`;
    case 'rotate_camera':
      return `${a.degrees}°`;
    case 'show':
      return `Reveal ${a.selectionName ?? ''}`.trim();
    default:
      return ACTIONS[a.type]?.label ?? a.type;
  }
}
