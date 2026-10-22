import { T, TYPE_NAMES, clone, parseSnbt, toSnbt } from './nbt.js';
import { button, h, select } from './ui.js';

const RANGES = { [T.BYTE]: [-128, 127], [T.SHORT]: [-32768, 32767], [T.INT]: [-2147483648, 2147483647] };
const LONG_MIN = -(2n ** 63n);
const LONG_MAX = 2n ** 63n - 1n;

function blank(t) {
  switch (t) {
    case T.BYTE:
    case T.SHORT:
    case T.INT:
    case T.FLOAT:
    case T.DOUBLE:
      return { t, v: 0 };
    case T.LONG:
      return { t, v: 0n };
    case T.STRING:
      return { t, v: '' };
    case T.LIST:
      return { t, et: T.END, v: [] };
    case T.COMPOUND:
      return { t, v: [] };
    case T.BYTE_ARRAY:
      return { t, v: new Int8Array(0) };
    case T.INT_ARRAY:
      return { t, v: new Int32Array(0) };
    case T.LONG_ARRAY:
      return { t, v: new BigInt64Array(0) };
    default:
      return { t: T.STRING, v: '' };
  }
}

function parseValue(t, text) {
  const s = text.trim();
  if (t === T.LONG) {
    if (!/^-?\d+$/.test(s)) throw new Error('A long must be a whole number');
    const v = BigInt(s);
    if (v < LONG_MIN || v > LONG_MAX) throw new Error('The value does not fit in a long');
    return v;
  }
  if (t === T.STRING) return text;
  const n = Number(s);
  if (s === '' || !Number.isFinite(n)) throw new Error('Enter a number');
  if (RANGES[t]) {
    if (!Number.isInteger(n)) throw new Error(`A ${TYPE_NAMES[t]} must be a whole number`);
    const [lo, hi] = RANGES[t];
    if (n < lo || n > hi) throw new Error(`A ${TYPE_NAMES[t]} must be between ${lo} and ${hi}`);
    return n;
  }
  if (t === T.FLOAT) return Math.fround(n);
  return n;
}

const ADDABLE = [T.BYTE, T.SHORT, T.INT, T.LONG, T.FLOAT, T.DOUBLE, T.STRING, T.COMPOUND, T.LIST, T.INT_ARRAY];

export function nbtInspector(tag, onApply) {
  let work = clone(tag);
  let snbtMode = false;
  let dirty = false;
  const err = h('div', { class: 'error' });
  const body = h('div', { class: 'nbt-tree' });
  const root = h('div', { class: 'nbt' });
  const markDirty = () => {
    dirty = true;
    renderBar();
  };
  const bar = h('div', { class: 'nbt-bar' });
  const renderBar = () => {
    bar.replaceChildren(
      button(snbtMode ? 'Tree' : 'SNBT', () => {
        if (snbtMode) {
          try {
            work = parseSnbt(body.querySelector('textarea').value);
            if (work.t !== T.COMPOUND) throw new Error('The block entity data must be a compound');
            err.textContent = '';
          } catch (e) {
            err.textContent = e.message;
            return;
          }
        }
        snbtMode = !snbtMode;
        render();
      }),
      button('Apply', () => {
        if (snbtMode) {
          try {
            work = parseSnbt(body.querySelector('textarea').value);
            if (work.t !== T.COMPOUND) throw new Error('The block entity data must be a compound');
          } catch (e) {
            err.textContent = e.message;
            return;
          }
        }
        err.textContent = '';
        dirty = false;
        onApply(clone(work));
        renderBar();
      }, { class: 'primary', disabled: !dirty && !snbtMode }),
      button('Revert', () => {
        work = clone(tag);
        dirty = false;
        err.textContent = '';
        render();
      }, { disabled: !dirty })
    );
  };
  const node = (t, label, onRename, onDelete, depth) => {
    const row = h('div', { class: 'nbt-row', style: { paddingLeft: `${depth * 12}px` } });
    const badge = h('span', { class: `nbt-type t${t.t}`, title: TYPE_NAMES[t.t] }, TYPE_NAMES[t.t]);
    const name = onRename
      ? h('input', { class: 'nbt-key', value: label, spellcheck: false, onChange: (e) => {
          onRename(e.target.value);
          markDirty();
        } })
      : h('span', { class: 'nbt-key static' }, label);
    const del = onDelete ? button('×', () => {
      onDelete();
      markDirty();
      render();
    }, { class: 'icon', title: 'Remove' }) : null;
    if (t.t === T.COMPOUND || t.t === T.LIST) {
      const open = h('details', { open: depth < 2 });
      const children = h('div');
      if (t.t === T.COMPOUND) {
        t.v.forEach((entry, i) => children.append(node(entry[1], entry[0], (k) => (entry[0] = k), () => t.v.splice(i, 1), depth + 1)));
        const typeSel = select(String(T.STRING), ADDABLE.map((x) => ({ value: String(x), label: TYPE_NAMES[x] })), () => {});
        children.append(h('div', { class: 'nbt-row add', style: { paddingLeft: `${(depth + 1) * 12}px` } }, typeSel, button('Add field', () => {
          let k = 'new_key';
          let n = 1;
          while (t.v.some(([x]) => x === k)) k = `new_key_${n++}`;
          t.v.push([k, blank(Number(typeSel.value))]);
          markDirty();
          render();
        })));
      } else {
        t.v.forEach((item, i) => children.append(node(item, `[${i}]`, null, () => t.v.splice(i, 1), depth + 1)));
        const et = t.v.length ? t.v[0].t : t.et;
        if (et && et !== T.END) children.append(h('div', { class: 'nbt-row add', style: { paddingLeft: `${(depth + 1) * 12}px` } }, button(`Add ${TYPE_NAMES[et]}`, () => {
          t.v.push(blank(et));
          markDirty();
          render();
        })));
        else {
          const typeSel = select(String(T.STRING), ADDABLE.map((x) => ({ value: String(x), label: TYPE_NAMES[x] })), () => {});
          children.append(h('div', { class: 'nbt-row add', style: { paddingLeft: `${(depth + 1) * 12}px` } }, typeSel, button('Add item', () => {
            t.et = Number(typeSel.value);
            t.v.push(blank(t.et));
            markDirty();
            render();
          })));
        }
      }
      open.append(h('summary', {}, row), children);
      row.append(name, badge, h('span', { class: 'mute' }, `${t.v.length} ${t.t === T.COMPOUND ? 'fields' : 'items'}`), del);
      return open;
    }
    let editor;
    if (t.t === T.BYTE_ARRAY || t.t === T.INT_ARRAY || t.t === T.LONG_ARRAY) {
      editor = h('input', { class: 'nbt-val', value: toSnbt(t), spellcheck: false, onChange: (e) => {
        try {
          const parsed = parseSnbt(e.target.value);
          if (parsed.t !== t.t) throw new Error(`Keep the ${TYPE_NAMES[t.t]} type`);
          t.v = parsed.v;
          e.target.classList.remove('bad');
          err.textContent = '';
          markDirty();
        } catch (x) {
          e.target.classList.add('bad');
          err.textContent = x.message;
        }
      } });
    } else {
      editor = h('input', { class: 'nbt-val', value: t.t === T.LONG ? t.v.toString() : String(t.v), spellcheck: false, onChange: (e) => {
        try {
          t.v = parseValue(t.t, e.target.value);
          delete t.bits;
          e.target.classList.remove('bad');
          err.textContent = '';
          markDirty();
        } catch (x) {
          e.target.classList.add('bad');
          err.textContent = x.message;
        }
      } });
    }
    row.append(name, badge, editor, del);
    return row;
  };
  const render = () => {
    if (snbtMode) body.replaceChildren(h('textarea', { class: 'snbt', spellcheck: false, value: toSnbt(work), onInput: markDirty }));
    else body.replaceChildren(node(work, '(block entity)', null, null, 0));
    renderBar();
  };
  render();
  root.append(bar, err, body);
  return root;
}
