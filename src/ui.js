export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k in el && k !== 'list') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function clear(el, ...children) {
  el.replaceChildren();
  for (const c of children.flat(Infinity)) if (c !== null && c !== undefined && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}

export function button(label, onClick, opts = {}) {
  return h('button', { class: opts.class, title: opts.title, disabled: opts.disabled, onClick, type: 'button' }, label);
}

export function field(label, input, hint) {
  return h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), input, hint ? h('span', { class: 'hint' }, hint) : null);
}

export function numberInput(value, onChange, opts = {}) {
  const el = h('input', { type: 'number', value: value ?? '', step: opts.step ?? 1, min: opts.min, max: opts.max, class: opts.class });
  el.addEventListener('change', () => {
    const v = el.value === '' ? null : Number(el.value);
    if (v !== null && !Number.isFinite(v)) return;
    onChange(opts.integer && v !== null ? Math.round(v) : v);
  });
  return el;
}

export function textInput(value, onChange, opts = {}) {
  const el = h('input', { type: 'text', value: value ?? '', placeholder: opts.placeholder, class: opts.class, spellcheck: false });
  if (opts.list) el.setAttribute('list', opts.list);
  el.addEventListener('change', () => onChange(el.value));
  return el;
}

export function select(value, options, onChange) {
  const el = h('select', {}, options.map((o) => (typeof o === 'string' ? h('option', { value: o, selected: o === value }, o) : h('option', { value: o.value, selected: o.value === value }, o.label))));
  el.addEventListener('change', () => onChange(el.value));
  return el;
}

export function checkbox(checked, onChange, label) {
  const el = h('input', { type: 'checkbox', checked: !!checked });
  el.addEventListener('change', () => onChange(el.checked));
  return h('label', { class: 'check' }, el, label);
}

let layer = null;

export function modal(title, body, actions) {
  return new Promise((resolve) => {
    const close = (v) => {
      layer?.remove();
      layer = null;
      resolve(v);
    };
    layer?.remove();
    const card = h('div', { class: 'modal', role: 'dialog', 'aria-label': title }, h('h2', {}, title), body, h('div', { class: 'modal-actions' }, actions.map((a) => button(a.label, async () => {
      if (a.validate && !(await a.validate())) return;
      close(a.value);
    }, { class: a.primary ? 'primary' : a.danger ? 'danger' : '' }))));
    layer = h('div', { class: 'modal-layer', onKeydown: (e) => e.key === 'Escape' && close(null) }, card);
    document.body.append(layer);
    setTimeout(() => card.querySelector('input,textarea,select,button.primary')?.focus(), 0);
  });
}

export async function confirmDialog(title, text, ok = 'OK', danger = false) {
  return (await modal(title, h('p', {}, text), [{ label: 'Cancel', value: false }, { label: ok, value: true, primary: !danger, danger }])) === true;
}

export async function form(title, fields, ok = 'OK') {
  const values = {};
  const rows = fields.map((f) => {
    values[f.key] = f.value ?? '';
    const input = f.options ? select(values[f.key], f.options, (v) => (values[f.key] = v)) : h(f.multiline ? 'textarea' : 'input', { value: values[f.key], placeholder: f.placeholder ?? '', spellcheck: false });
    if (!f.options) input.addEventListener('input', () => (values[f.key] = input.value));
    if (f.list) input.setAttribute('list', f.list);
    return field(f.label, input, f.hint);
  });
  const err = h('div', { class: 'error' });
  const res = await modal(title, h('div', { class: 'form' }, rows, err), [
    { label: 'Cancel', value: null },
    {
      label: ok,
      value: 'ok',
      primary: true,
      validate: () => {
        for (const f of fields) {
          const msg = f.check?.(values[f.key], values);
          if (msg) {
            err.textContent = msg;
            return false;
          }
        }
        return true;
      }
    }
  ]);
  return res === 'ok' ? values : null;
}

export function menu(anchor, items) {
  document.querySelector('.menu-pop')?.remove();
  const r = anchor.getBoundingClientRect();
  const pop = h('div', { class: 'menu-pop', style: { left: `${r.left}px`, top: `${r.bottom + 2}px` } }, items.map((it) => (it === '-' ? h('div', { class: 'menu-sep' }) : h('button', { type: 'button', disabled: it.disabled, title: it.title, onClick: () => {
    pop.remove();
    it.run();
  } }, it.label))));
  document.body.append(pop);
  const off = (e) => {
    if (!pop.contains(e.target)) {
      pop.remove();
      document.removeEventListener('mousedown', off, true);
    }
  };
  setTimeout(() => document.addEventListener('mousedown', off, true), 0);
}

export function b64ToBytes(b64) {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function bytesToB64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
