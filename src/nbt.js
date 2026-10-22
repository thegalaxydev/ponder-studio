export const T = { END: 0, BYTE: 1, SHORT: 2, INT: 3, LONG: 4, FLOAT: 5, DOUBLE: 6, BYTE_ARRAY: 7, STRING: 8, LIST: 9, COMPOUND: 10, INT_ARRAY: 11, LONG_ARRAY: 12 };
export const TYPE_NAMES = ['end', 'byte', 'short', 'int', 'long', 'float', 'double', 'byte_array', 'string', 'list', 'compound', 'int_array', 'long_array'];

export function decodeMutf8(bytes, start, len) {
  let out = '';
  let i = start;
  const end = start + len;
  while (i < end) {
    const a = bytes[i++];
    if (a < 0x80) out += String.fromCharCode(a);
    else if ((a & 0xe0) === 0xc0) out += String.fromCharCode(((a & 0x1f) << 6) | (bytes[i++] & 0x3f));
    else {
      const b = bytes[i++];
      const c = bytes[i++];
      out += String.fromCharCode(((a & 0x0f) << 12) | ((b & 0x3f) << 6) | (c & 0x3f));
    }
  }
  return out;
}

export function encodeMutf8(str) {
  const out = [];
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    if (c >= 1 && c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
  }
  return Uint8Array.from(out);
}

class Reader {
  constructor(bytes) {
    this.b = bytes;
    this.v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.p = 0;
  }
  need(n) {
    if (this.p + n > this.b.length) throw new Error('The NBT data ends early');
  }
  u8() {
    this.need(1);
    return this.b[this.p++];
  }
  i8() {
    this.need(1);
    return this.v.getInt8(this.p++);
  }
  i16() {
    this.need(2);
    const x = this.v.getInt16(this.p);
    this.p += 2;
    return x;
  }
  u16() {
    this.need(2);
    const x = this.v.getUint16(this.p);
    this.p += 2;
    return x;
  }
  i32() {
    this.need(4);
    const x = this.v.getInt32(this.p);
    this.p += 4;
    return x;
  }
  i64() {
    this.need(8);
    const x = this.v.getBigInt64(this.p);
    this.p += 8;
    return x;
  }
  f32() {
    this.need(4);
    const bits = this.v.getUint32(this.p);
    const x = this.v.getFloat32(this.p);
    this.p += 4;
    return { value: x, bits };
  }
  f64() {
    this.need(8);
    const bits = this.v.getBigUint64(this.p);
    const x = this.v.getFloat64(this.p);
    this.p += 8;
    return { value: x, bits };
  }
  str() {
    const len = this.u16();
    this.need(len);
    const s = decodeMutf8(this.b, this.p, len);
    this.p += len;
    return s;
  }
  payload(t, depth) {
    if (depth > 512) throw new Error('The NBT data is nested too deeply');
    switch (t) {
      case T.BYTE:
        return { t, v: this.i8() };
      case T.SHORT:
        return { t, v: this.i16() };
      case T.INT:
        return { t, v: this.i32() };
      case T.LONG:
        return { t, v: this.i64() };
      case T.FLOAT: {
        const f = this.f32();
        return { t, v: f.value, bits: f.bits };
      }
      case T.DOUBLE: {
        const f = this.f64();
        return { t, v: f.value, bits: f.bits };
      }
      case T.BYTE_ARRAY: {
        const n = this.i32();
        this.need(n);
        const v = new Int8Array(this.b.slice(this.p, this.p + n).buffer);
        this.p += n;
        return { t, v };
      }
      case T.STRING:
        return { t, v: this.str() };
      case T.LIST: {
        const et = this.u8();
        const n = this.i32();
        const v = [];
        for (let i = 0; i < n; i++) v.push(this.payload(et, depth + 1));
        return { t, et, v };
      }
      case T.COMPOUND: {
        const v = [];
        for (;;) {
          const ct = this.u8();
          if (ct === T.END) break;
          const name = this.str();
          v.push([name, this.payload(ct, depth + 1)]);
        }
        return { t, v };
      }
      case T.INT_ARRAY: {
        const n = this.i32();
        const v = new Int32Array(n);
        for (let i = 0; i < n; i++) v[i] = this.i32();
        return { t, v };
      }
      case T.LONG_ARRAY: {
        const n = this.i32();
        const v = new BigInt64Array(n);
        for (let i = 0; i < n; i++) v[i] = this.i64();
        return { t, v };
      }
      default:
        throw new Error(`Unknown NBT tag type ${t} at byte ${this.p}`);
    }
  }
}

export function readNbt(bytes) {
  const r = new Reader(bytes);
  const t = r.u8();
  if (t !== T.COMPOUND) throw new Error('The NBT data does not start with a compound tag');
  const name = r.str();
  const root = r.payload(t, 0);
  return { name, root, trailing: bytes.length - r.p };
}

class Writer {
  constructor() {
    this.buf = new Uint8Array(1 << 16);
    this.v = new DataView(this.buf.buffer);
    this.p = 0;
  }
  grow(n) {
    if (this.p + n <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < this.p + n) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.buf.subarray(0, this.p));
    this.buf = next;
    this.v = new DataView(next.buffer);
  }
  u8(x) {
    this.grow(1);
    this.buf[this.p++] = x & 0xff;
  }
  i16(x) {
    this.grow(2);
    this.v.setInt16(this.p, x);
    this.p += 2;
  }
  u16(x) {
    this.grow(2);
    this.v.setUint16(this.p, x);
    this.p += 2;
  }
  i32(x) {
    this.grow(4);
    this.v.setInt32(this.p, x);
    this.p += 4;
  }
  i64(x) {
    this.grow(8);
    this.v.setBigInt64(this.p, BigInt(x));
    this.p += 8;
  }
  bytes(b) {
    this.grow(b.length);
    this.buf.set(b, this.p);
    this.p += b.length;
  }
  str(s) {
    const b = encodeMutf8(s);
    if (b.length > 65535) throw new Error('An NBT string is longer than 65535 bytes');
    this.u16(b.length);
    this.bytes(b);
  }
  payload(tag) {
    switch (tag.t) {
      case T.BYTE:
        this.u8(tag.v);
        break;
      case T.SHORT:
        this.i16(tag.v);
        break;
      case T.INT:
        this.i32(tag.v);
        break;
      case T.LONG:
        this.i64(tag.v);
        break;
      case T.FLOAT:
        this.grow(4);
        if (tag.bits !== undefined && sameFloat(tag)) this.v.setUint32(this.p, tag.bits);
        else this.v.setFloat32(this.p, tag.v);
        this.p += 4;
        break;
      case T.DOUBLE:
        this.grow(8);
        if (tag.bits !== undefined && sameDouble(tag)) this.v.setBigUint64(this.p, tag.bits);
        else this.v.setFloat64(this.p, tag.v);
        this.p += 8;
        break;
      case T.BYTE_ARRAY:
        this.i32(tag.v.length);
        this.bytes(new Uint8Array(tag.v.buffer, tag.v.byteOffset, tag.v.length));
        break;
      case T.STRING:
        this.str(tag.v);
        break;
      case T.LIST: {
        const et = tag.v.length ? tag.v[0].t : tag.et ?? T.END;
        this.u8(et);
        this.i32(tag.v.length);
        for (const item of tag.v) {
          if (item.t !== et) throw new Error('An NBT list mixes tag types');
          this.payload(item);
        }
        break;
      }
      case T.COMPOUND:
        for (const [name, child] of tag.v) {
          this.u8(child.t);
          this.str(name);
          this.payload(child);
        }
        this.u8(T.END);
        break;
      case T.INT_ARRAY:
        this.i32(tag.v.length);
        for (const x of tag.v) this.i32(x);
        break;
      case T.LONG_ARRAY:
        this.i32(tag.v.length);
        for (const x of tag.v) this.i64(x);
        break;
      default:
        throw new Error(`Cannot write NBT tag type ${tag.t}`);
    }
  }
}

function sameFloat(tag) {
  const dv = new DataView(new ArrayBuffer(4));
  dv.setUint32(0, tag.bits);
  const decoded = dv.getFloat32(0);
  return Object.is(decoded, tag.v) || (Number.isNaN(decoded) && Number.isNaN(tag.v));
}

function sameDouble(tag) {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setBigUint64(0, tag.bits);
  const decoded = dv.getFloat64(0);
  return Object.is(decoded, tag.v) || (Number.isNaN(decoded) && Number.isNaN(tag.v));
}

export function writeNbt(doc) {
  const w = new Writer();
  w.u8(T.COMPOUND);
  w.str(doc.name ?? '');
  w.payload(doc.root);
  return w.buf.slice(0, w.p);
}

async function pipe(bytes, stream) {
  const res = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await res.arrayBuffer());
}

export function isGzip(bytes) {
  return bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

export async function gunzip(bytes) {
  return pipe(bytes, new DecompressionStream('gzip'));
}

export async function gzip(bytes) {
  return pipe(bytes, new CompressionStream('gzip'));
}

export async function readNbtFile(bytes) {
  const compressed = isGzip(bytes);
  const raw = compressed ? await gunzip(bytes) : bytes;
  return { ...readNbt(raw), compressed };
}

export async function writeNbtFile(doc, compressed = true) {
  const raw = writeNbt(doc);
  return compressed ? gzip(raw) : raw;
}

export function get(tag, name) {
  if (!tag || tag.t !== T.COMPOUND) return undefined;
  const e = tag.v.find(([n]) => n === name);
  return e ? e[1] : undefined;
}

export function set(tag, name, child) {
  const i = tag.v.findIndex(([n]) => n === name);
  if (i >= 0) tag.v[i] = [name, child];
  else tag.v.push([name, child]);
}

export function remove(tag, name) {
  const i = tag.v.findIndex(([n]) => n === name);
  if (i >= 0) tag.v.splice(i, 1);
}

export const tag = {
  byte: (v) => ({ t: T.BYTE, v }),
  short: (v) => ({ t: T.SHORT, v }),
  int: (v) => ({ t: T.INT, v: v | 0 }),
  long: (v) => ({ t: T.LONG, v: BigInt(v) }),
  float: (v) => ({ t: T.FLOAT, v: Math.fround(v) }),
  double: (v) => ({ t: T.DOUBLE, v }),
  string: (v) => ({ t: T.STRING, v }),
  list: (et, v) => ({ t: T.LIST, et, v }),
  compound: (entries = []) => ({ t: T.COMPOUND, v: entries }),
  intArray: (arr) => ({ t: T.INT_ARRAY, v: Int32Array.from(arr) })
};

export function clone(tag) {
  switch (tag.t) {
    case T.LIST:
      return { t: tag.t, et: tag.et, v: tag.v.map(clone) };
    case T.COMPOUND:
      return { t: tag.t, v: tag.v.map(([n, c]) => [n, clone(c)]) };
    case T.BYTE_ARRAY:
      return { t: tag.t, v: new Int8Array(tag.v) };
    case T.INT_ARRAY:
      return { t: tag.t, v: new Int32Array(tag.v) };
    case T.LONG_ARRAY:
      return { t: tag.t, v: new BigInt64Array(tag.v) };
    default:
      return { ...tag };
  }
}

const SNBT_PLAIN = /^[A-Za-z0-9._+-]+$/;

function snbtKey(k) {
  return SNBT_PLAIN.test(k) ? k : JSON.stringify(k);
}

function snbtNumber(v, suffix) {
  if (!Number.isFinite(v)) return `${Number.isNaN(v) ? 'NaN' : v > 0 ? 'Infinity' : '-Infinity'}${suffix}`;
  const s = String(v);
  return `${s.includes('.') || s.includes('e') ? s : `${s}.0`}${suffix}`;
}

export function toSnbt(tag, indent = '') {
  const next = `${indent}  `;
  switch (tag.t) {
    case T.BYTE:
      return `${tag.v}b`;
    case T.SHORT:
      return `${tag.v}s`;
    case T.INT:
      return String(tag.v);
    case T.LONG:
      return `${tag.v}L`;
    case T.FLOAT:
      return snbtNumber(tag.v, 'f');
    case T.DOUBLE:
      return snbtNumber(tag.v, 'd');
    case T.STRING:
      return JSON.stringify(tag.v);
    case T.BYTE_ARRAY:
      return `[B;${Array.from(tag.v, (x) => `${x}B`).join(',')}]`;
    case T.INT_ARRAY:
      return `[I;${Array.from(tag.v).join(',')}]`;
    case T.LONG_ARRAY:
      return `[L;${Array.from(tag.v, (x) => `${x}L`).join(',')}]`;
    case T.LIST:
      if (!tag.v.length) return '[]';
      if (tag.v.every((x) => x.t !== T.COMPOUND && x.t !== T.LIST)) return `[${tag.v.map((x) => toSnbt(x)).join(', ')}]`;
      return `[\n${tag.v.map((x) => next + toSnbt(x, next)).join(',\n')}\n${indent}]`;
    case T.COMPOUND:
      if (!tag.v.length) return '{}';
      return `{\n${tag.v.map(([k, c]) => `${next}${snbtKey(k)}: ${toSnbt(c, next)}`).join(',\n')}\n${indent}}`;
    default:
      return '?';
  }
}

export function parseSnbt(text) {
  let i = 0;
  const s = text;
  const ws = () => {
    while (i < s.length && /\s/.test(s[i])) i++;
  };
  const fail = (msg) => {
    throw new Error(`${msg} at character ${i + 1}`);
  };
  const expect = (c) => {
    ws();
    if (s[i] !== c) fail(`Expected ${c}`);
    i++;
  };
  const quoted = () => {
    const q = s[i++];
    let out = '';
    while (i < s.length && s[i] !== q) {
      if (s[i] === '\\') {
        i++;
        const e = s[i++];
        out += e === 'n' ? '\n' : e === 't' ? '\t' : e;
      } else out += s[i++];
    }
    if (s[i] !== q) fail('Unterminated string');
    i++;
    return out;
  };
  const bare = () => {
    const start = i;
    while (i < s.length && /[A-Za-z0-9._+-]/.test(s[i])) i++;
    if (start === i) fail('Expected a value');
    return s.slice(start, i);
  };
  const scalar = (word) => {
    let m;
    if ((m = /^([-+]?\d+)[bB]$/.exec(word))) return { t: T.BYTE, v: Number(m[1]) };
    if ((m = /^([-+]?\d+)[sS]$/.exec(word))) return { t: T.SHORT, v: Number(m[1]) };
    if ((m = /^([-+]?\d+)[lL]$/.exec(word))) return { t: T.LONG, v: BigInt(m[1]) };
    if ((m = /^([-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)[fF]$/i.exec(word))) return { t: T.FLOAT, v: Math.fround(Number(m[1])) };
    if ((m = /^([-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)[dD]$/i.exec(word))) return { t: T.DOUBLE, v: Number(m[1]) };
    if (/^[-+]?\d+$/.test(word)) return { t: T.INT, v: Number(word) };
    if (/^[-+]?(?:\d+\.\d*|\.\d+|\d+)(?:e[-+]?\d+)?$/i.test(word)) return { t: T.DOUBLE, v: Number(word) };
    if (word === 'true') return { t: T.BYTE, v: 1 };
    if (word === 'false') return { t: T.BYTE, v: 0 };
    return { t: T.STRING, v: word };
  };
  const value = () => {
    ws();
    const c = s[i];
    if (c === '{') {
      i++;
      const v = [];
      ws();
      if (s[i] === '}') {
        i++;
        return { t: T.COMPOUND, v };
      }
      for (;;) {
        ws();
        const key = s[i] === '"' || s[i] === "'" ? quoted() : bare();
        expect(':');
        v.push([key, value()]);
        ws();
        if (s[i] === ',') {
          i++;
          continue;
        }
        expect('}');
        return { t: T.COMPOUND, v };
      }
    }
    if (c === '[') {
      i++;
      ws();
      const typed = /^[BIL];/.exec(s.slice(i, i + 2));
      if (typed) {
        i += 2;
        const items = [];
        ws();
        while (s[i] !== ']') {
          items.push(bare());
          ws();
          if (s[i] === ',') i++;
          ws();
        }
        i++;
        if (typed[0][0] === 'B') return { t: T.BYTE_ARRAY, v: Int8Array.from(items.map((x) => Number(x.replace(/[bB]$/, '')))) };
        if (typed[0][0] === 'I') return { t: T.INT_ARRAY, v: Int32Array.from(items.map(Number)) };
        return { t: T.LONG_ARRAY, v: BigInt64Array.from(items.map((x) => BigInt(x.replace(/[lL]$/, '')))) };
      }
      const v = [];
      if (s[i] === ']') {
        i++;
        return { t: T.LIST, et: T.END, v };
      }
      for (;;) {
        v.push(value());
        ws();
        if (s[i] === ',') {
          i++;
          continue;
        }
        expect(']');
        if (v.some((x) => x.t !== v[0].t)) fail('A list mixes tag types');
        return { t: T.LIST, et: v[0].t, v };
      }
    }
    if (c === '"' || c === "'") return { t: T.STRING, v: quoted() };
    return scalar(bare());
  };
  const out = value();
  ws();
  if (i < s.length) fail('Unexpected text after the value');
  return out;
}
