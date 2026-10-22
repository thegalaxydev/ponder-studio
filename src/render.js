import { connectedIndex, connectedUV, faceFrame } from './blockmodel.js';

const VS = `attribute vec3 aPos;
attribute vec2 aUv;
attribute vec4 aColor;
uniform mat4 uMvp;
varying vec2 vUv;
varying vec4 vColor;
void main() {
  gl_Position = uMvp * vec4(aPos, 1.0);
  vUv = aUv;
  vColor = aColor;
}`;

const FS = `precision mediump float;
uniform sampler2D uTex;
varying vec2 vUv;
varying vec4 vColor;
void main() {
  vec4 c = texture2D(uTex, vUv) * vColor;
  if (c.a < 0.08) discard;
  gl_FragColor = c;
}`;

const STRIDE = 9;

function mat4Perspective(fov, aspect, near, far) {
  const f = 1 / Math.tan(fov / 2);
  const nf = 1 / (near - far);
  return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
}

function mat4LookAt(eye, target, up) {
  const z = norm(sub(eye, target));
  const x = norm(cross(up, z));
  const y = cross(z, x);
  return new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, eye), -dot(y, eye), -dot(z, eye), 1]);
}

function mat4Mul(a, b) {
  const o = new Float32Array(16);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += a[k * 4 + j] * b[i * 4 + k];
    o[i * 4 + j] = s;
  }
  return o;
}

function mat4Invert(m) {
  const inv = new Float32Array(16);
  inv[0] = m[5] * m[10] * m[15] - m[5] * m[11] * m[14] - m[9] * m[6] * m[15] + m[9] * m[7] * m[14] + m[13] * m[6] * m[11] - m[13] * m[7] * m[10];
  inv[4] = -m[4] * m[10] * m[15] + m[4] * m[11] * m[14] + m[8] * m[6] * m[15] - m[8] * m[7] * m[14] - m[12] * m[6] * m[11] + m[12] * m[7] * m[10];
  inv[8] = m[4] * m[9] * m[15] - m[4] * m[11] * m[13] - m[8] * m[5] * m[15] + m[8] * m[7] * m[13] + m[12] * m[5] * m[11] - m[12] * m[7] * m[9];
  inv[12] = -m[4] * m[9] * m[14] + m[4] * m[10] * m[13] + m[8] * m[5] * m[14] - m[8] * m[6] * m[13] - m[12] * m[5] * m[10] + m[12] * m[6] * m[9];
  inv[1] = -m[1] * m[10] * m[15] + m[1] * m[11] * m[14] + m[9] * m[2] * m[15] - m[9] * m[3] * m[14] - m[13] * m[2] * m[11] + m[13] * m[3] * m[10];
  inv[5] = m[0] * m[10] * m[15] - m[0] * m[11] * m[14] - m[8] * m[2] * m[15] + m[8] * m[3] * m[14] + m[12] * m[2] * m[11] - m[12] * m[3] * m[10];
  inv[9] = -m[0] * m[9] * m[15] + m[0] * m[11] * m[13] + m[8] * m[1] * m[15] - m[8] * m[3] * m[13] - m[12] * m[1] * m[11] + m[12] * m[3] * m[9];
  inv[13] = m[0] * m[9] * m[14] - m[0] * m[10] * m[13] - m[8] * m[1] * m[14] + m[8] * m[2] * m[13] + m[12] * m[1] * m[10] - m[12] * m[2] * m[9];
  inv[2] = m[1] * m[6] * m[15] - m[1] * m[7] * m[14] - m[5] * m[2] * m[15] + m[5] * m[3] * m[14] + m[13] * m[2] * m[7] - m[13] * m[3] * m[6];
  inv[6] = -m[0] * m[6] * m[15] + m[0] * m[7] * m[14] + m[4] * m[2] * m[15] - m[4] * m[3] * m[14] - m[12] * m[2] * m[7] + m[12] * m[3] * m[6];
  inv[10] = m[0] * m[5] * m[15] - m[0] * m[7] * m[13] - m[4] * m[1] * m[15] + m[4] * m[3] * m[13] + m[12] * m[1] * m[7] - m[12] * m[3] * m[5];
  inv[14] = -m[0] * m[5] * m[14] + m[0] * m[6] * m[13] + m[4] * m[1] * m[14] - m[4] * m[2] * m[13] - m[12] * m[1] * m[6] + m[12] * m[2] * m[5];
  inv[3] = -m[1] * m[6] * m[11] + m[1] * m[7] * m[10] + m[5] * m[2] * m[11] - m[5] * m[3] * m[10] - m[9] * m[2] * m[7] + m[9] * m[3] * m[6];
  inv[7] = m[0] * m[6] * m[11] - m[0] * m[7] * m[10] - m[4] * m[2] * m[11] + m[4] * m[3] * m[10] + m[8] * m[2] * m[7] - m[8] * m[3] * m[6];
  inv[11] = -m[0] * m[5] * m[11] + m[0] * m[7] * m[9] + m[4] * m[1] * m[11] - m[4] * m[3] * m[9] - m[8] * m[1] * m[7] + m[8] * m[3] * m[5];
  inv[15] = m[0] * m[5] * m[10] - m[0] * m[6] * m[9] - m[4] * m[1] * m[10] + m[4] * m[2] * m[9] + m[8] * m[1] * m[6] - m[8] * m[2] * m[5];
  let det = m[0] * inv[0] + m[1] * inv[4] + m[2] * inv[8] + m[3] * inv[12];
  det = det ? 1 / det : 0;
  for (let i = 0; i < 16; i++) inv[i] *= det;
  return inv;
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a) => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

const NAMED = {
  'minecraft:stone': '#7d7d7d', 'minecraft:smooth_stone': '#a1a1a1', 'minecraft:cobblestone': '#6b6b6b', 'minecraft:dirt': '#8b5d3b', 'minecraft:grass_block': '#5e9c3a', 'minecraft:oak_planks': '#b08b52', 'minecraft:spruce_planks': '#755533', 'minecraft:snow_block': '#f2f6f7', 'minecraft:white_concrete': '#cfd5d6', 'minecraft:gold_block': '#f3d64a', 'minecraft:iron_block': '#d9d9d9', 'minecraft:glass': '#c7e6f0', 'minecraft:water': '#3b62d6', 'minecraft:redstone_wire': '#b02020', 'minecraft:lever': '#7b6440',
  'create:shaft': '#9aa0a6', 'create:powered_shaft': '#9aa0a6', 'create:cogwheel': '#b48a55', 'create:large_cogwheel': '#a87c48', 'create:andesite_casing': '#a59b8c', 'create:brass_casing': '#c69a4b', 'create:copper_casing': '#b56e45', 'create:creative_motor': '#8e5cc4', 'create:water_wheel': '#8a6a3e', 'create:speedometer': '#c9b37a', 'create:gearbox': '#a59b8c', 'create:encased_chain_drive': '#a59b8c', 'create:belt': '#3a3a3a', 'create:mechanical_press': '#a59b8c'
};

export function colorFor(name) {
  if (NAMED[name]) return hex(NAMED[name]);
  const base = name.split(':').pop();
  if (/glass/.test(base)) return [0.75, 0.9, 0.95, 0.45];
  if (/log|wood|planks|stairs|fence/.test(base) && /oak|birch|spruce|jungle|acacia|dark|mangrove|cherry/.test(base)) return hex('#9c7748');
  if (/casing/.test(base)) return hex('#a59b8c');
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const hue = (h % 360) / 360;
  return hsl(hue, 0.35, 0.55);
}

function hex(s) {
  return [parseInt(s.slice(1, 3), 16) / 255, parseInt(s.slice(3, 5), 16) / 255, parseInt(s.slice(5, 7), 16) / 255, 1];
}

function hsl(h, s, l) {
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t) => {
    t = (t + 1) % 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [f(h + 1 / 3), f(h), f(h - 1 / 3), 1];
}

export function shapeFor(name, props) {
  const base = name.split(':').pop();
  const axis = props?.axis ?? (props?.facing === 'up' || props?.facing === 'down' ? 'y' : props?.facing === 'east' || props?.facing === 'west' ? 'x' : props?.facing ? 'z' : 'y');
  const along = (lo, hi, w0, w1) => (axis === 'x' ? [lo, w0, w0, hi, w1, w1] : axis === 'y' ? [w0, lo, w0, w1, hi, w1] : [w0, w0, lo, w1, w1, hi]);
  const disc = (r0, r1, t0, t1) => (axis === 'x' ? [t0, r0, r0, t1, r1, r1] : axis === 'y' ? [r0, t0, r0, r1, t1, r1] : [r0, r0, t0, r1, r1, t1]);
  if (/^(powered_)?shaft$/.test(base)) return { boxes: [along(0, 1, 0.375, 0.625)], full: false };
  if (base === 'cogwheel') return { boxes: [disc(0.06, 0.94, 0.375, 0.625), along(0, 1, 0.375, 0.625)], full: false };
  if (base === 'large_cogwheel') return { boxes: [disc(-0.44, 1.44, 0.375, 0.625), along(0, 1, 0.375, 0.625)], full: false };
  if (/_slab$/.test(base)) return props?.type === 'top' ? { boxes: [[0, 0.5, 0, 1, 1, 1]], full: false } : props?.type === 'double' ? { boxes: [[0, 0, 0, 1, 1, 1]], full: true } : { boxes: [[0, 0, 0, 1, 0.5, 1]], full: false };
  if (/carpet|pressure_plate|redstone_wire|rail/.test(base)) return { boxes: [[0, 0, 0, 1, 0.0625, 1]], full: false };
  if (base === 'belt' && (props?.slope ?? 'horizontal') === 'horizontal') return { boxes: [[0, 0.0625, 0, 1, 0.3125, 1]], full: false };
  if (/torch|lantern|flower|sapling|button|lever/.test(base)) return { boxes: [[0.375, 0, 0.375, 0.625, 0.625, 0.625]], full: false };
  if (/fence|wall$|pane|bars/.test(base)) return { boxes: [[0.375, 0, 0.375, 0.625, 1, 0.625]], full: false };
  return { boxes: [[0, 0, 0, 1, 1, 1]], full: true };
}

export class Viewport {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl', { antialias: true, alpha: false, preserveDrawingBuffer: true });
    if (!gl) throw new Error('WebGL is not available, so the structural preview cannot be shown');
    this.gl = gl;
    const sh = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    this.prog = prog;
    this.aPos = gl.getAttribLocation(prog, 'aPos');
    this.aUv = gl.getAttribLocation(prog, 'aUv');
    this.aColor = gl.getAttribLocation(prog, 'aColor');
    this.uMvp = gl.getUniformLocation(prog, 'uMvp');
    this.uTex = gl.getUniformLocation(prog, 'uTex');
    this.texture = gl.createTexture();
    this.atlas = null;
    this.atlasVersion = -1;
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));
    this.textureFilters();
    this.buffers = { opaque: gl.createBuffer(), clear: gl.createBuffer(), lines: gl.createBuffer(), overlay: gl.createBuffer() };
    this.counts = { opaque: 0, clear: 0, lines: 0, overlay: 0 };
    this.camera = { target: [2.5, 1, 2.5], yaw: -0.75, pitch: 0.55, dist: 12 };
    this.background = [0.07, 0.08, 0.09];
    this.cells = new Map();
    this.size = [5, 3, 5];
    this.pending = false;
  }

  textureFilters() {
    const gl = this.gl;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  setAtlas(atlas) {
    this.atlas = atlas;
    if (!atlas || atlas.version === this.atlasVersion || !atlas.canvas.width) return;
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlas.canvas);
    this.textureFilters();
    this.atlasVersion = atlas.version;
  }

  setBackground(css) {
    const m = /#([0-9a-f]{6})/i.exec(css ?? '');
    if (m) this.background = hex(`#${m[1]}`).slice(0, 3);
    this.requestRender();
  }

  frame(size) {
    const [sx, sy, sz] = size;
    this.camera.target = [sx / 2, sy / 3, sz / 2];
    this.camera.dist = Math.max(6, Math.hypot(sx, sy, sz) * 1.4);
    this.requestRender();
  }

  setScene({ cells, size, basePlate, lines = [], overlayLines = [] }) {
    this.cells = cells;
    this.size = size;
    const opaque = [];
    const clear = [];
    const atlas = this.atlas;
    const white = atlas?.white ?? { u0: 0, v0: 0, u1: 0, v1: 0 };
    const sprite = (id) => atlas?.rect(id) ?? null;
    const see = (c) => {
      if (c.solid !== undefined) return c.solid;
      c.solid = !!c.full && !c.ghost && c.color[3] >= 1 && !c.geo.faces.some((f) => sprite(f.texture)?.translucent);
      return c.solid;
    };
    const solid = (x, y, z) => {
      const c = cells.get(`${x},${y},${z}`);
      return !!c && see(c);
    };
    const links = (c, { right, up }, normal) => {
      const same = (h, v) => {
        const p = c.pos.map((x, i) => x + right[i] * h + up[i] * v);
        const o = cells.get(p.join(','));
        if (!o || o.name !== c.name || o.ghost) return false;
        return cells.get(p.map((x, i) => x + normal[i]).join(','))?.name !== c.name;
      };
      return { up: same(0, 1), down: same(0, -1), left: same(-1, 0), right: same(1, 0), topLeft: same(-1, 1), topRight: same(1, 1), bottomLeft: same(-1, -1), bottomRight: same(1, -1) };
    };
    for (const c of cells.values()) {
      c.solid = undefined;
      const alpha = c.ghost ? 0.22 : c.color[3];
      const pick = c.tint ?? [1, 1, 1];
      for (const f of c.geo.faces) {
        if (f.cull && !c.ghost && solid(c.x + f.cull[0], c.y + f.cull[1], c.z + f.cull[2])) continue;
        const s = sprite(f.texture);
        const base = s ? [1, 1, 1] : c.color;
        const tint = f.tint >= 0 && s ? c.foliage ?? [1, 1, 1] : [1, 1, 1];
        const col = [base[0] * f.shade * tint[0] * pick[0], base[1] * f.shade * tint[1] * pick[1], base[2] * f.shade * tint[2] * pick[2], alpha];
        let r = s ?? white;
        let uv = f.uv;
        const sheet = s && !c.ghost && c.name ? atlas.sheet(f.texture) : null;
        const frame = sheet && faceFrame(f);
        if (frame) {
          r = sheet;
          uv = connectedUV(f.uv, connectedIndex(links(c, frame, f.cull)));
        }
        const target = c.ghost || alpha < 1 || s?.translucent ? clear : opaque;
        const du = r.u1 - r.u0;
        const dv = r.v1 - r.v0;
        const eu = Math.min(Math.abs(du) * 0.002, 0.0001);
        const ev = Math.min(Math.abs(dv) * 0.002, 0.0001);
        const vtx = f.verts.map((p, i) => {
          const u = Math.min(r.u1 - eu, Math.max(r.u0 + eu, r.u0 + (uv[i][0] / 16) * du));
          const v = Math.min(r.v1 - ev, Math.max(r.v0 + ev, r.v0 + (uv[i][1] / 16) * dv));
          return [c.x + p[0], c.y + p[1], c.z + p[2], u, v, ...col];
        });
        for (const i of [0, 1, 2, 0, 2, 3]) target.push(...vtx[i]);
      }
    }
    const grid = [];
    const bp = basePlate ?? { x: 0, z: 0, size: Math.max(size[0], size[2]) };
    const gc = [0.5, 0.55, 0.6, 0.35];
    for (let i = 0; i <= bp.size; i++) {
      grid.push(bp.x + i, 0.001, bp.z, ...gc, bp.x + i, 0.001, bp.z + bp.size, ...gc);
      grid.push(bp.x, 0.001, bp.z + i, ...gc, bp.x + bp.size, 0.001, bp.z + i, ...gc);
    }
    const bc = [0.4, 0.45, 0.5, 0.5];
    const [sx, sy, sz] = size;
    const corners = [[0, 0, 0], [sx, 0, 0], [sx, 0, sz], [0, 0, sz], [0, sy, 0], [sx, sy, 0], [sx, sy, sz], [0, sy, sz]];
    for (const [a, b] of [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]]) grid.push(...corners[a], ...bc, ...corners[b], ...bc);
    this.upload('opaque', opaque);
    this.upload('clear', clear);
    this.upload('lines', [...grid, ...lines]);
    this.upload('overlay', overlayLines);
    this.requestRender();
  }

  setOverlay(overlayLines) {
    this.upload('overlay', overlayLines);
    this.requestRender();
  }

  upload(name, data) {
    const gl = this.gl;
    let out = data;
    if (name === 'lines' || name === 'overlay') {
      const w = this.atlas?.white ?? { u0: 0, v0: 0 };
      out = [];
      for (let i = 0; i + 7 <= data.length; i += 7) out.push(data[i], data[i + 1], data[i + 2], w.u0, w.v0, data[i + 3], data[i + 4], data[i + 5], data[i + 6]);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers[name]);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(out), gl.DYNAMIC_DRAW);
    this.counts[name] = out.length / STRIDE;
  }

  eye() {
    const { target, yaw, pitch, dist } = this.camera;
    return [target[0] + Math.cos(pitch) * Math.cos(yaw) * dist, target[1] + Math.sin(pitch) * dist, target[2] + Math.cos(pitch) * Math.sin(yaw) * dist];
  }

  matrices() {
    const w = this.canvas.clientWidth || 1;
    const h = this.canvas.clientHeight || 1;
    const proj = mat4Perspective(0.8, w / h, 0.1, 1000);
    const view = mat4LookAt(this.eye(), this.camera.target, [0, 1, 0]);
    return { mvp: mat4Mul(proj, view), w, h };
  }

  requestRender() {
    if (this.pending) return;
    this.pending = true;
    requestAnimationFrame(() => {
      this.pending = false;
      this.render();
    });
  }

  render() {
    const gl = this.gl;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.floor(this.canvas.clientWidth * dpr));
    const h = Math.max(1, Math.floor(this.canvas.clientHeight * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    gl.viewport(0, 0, w, h);
    gl.clearColor(...this.background, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.prog);
    gl.uniformMatrix4fv(this.uMvp, false, this.matrices().mvp);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.uniform1i(this.uTex, 0);
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    this.draw('opaque', gl.TRIANGLES);
    this.draw('lines', gl.LINES);
    gl.depthMask(false);
    this.draw('clear', gl.TRIANGLES);
    gl.depthMask(true);
    gl.disable(gl.DEPTH_TEST);
    this.draw('overlay', gl.LINES);
    this.onRender?.();
  }

  draw(name, mode) {
    if (!this.counts[name]) return;
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers[name]);
    gl.enableVertexAttribArray(this.aPos);
    gl.vertexAttribPointer(this.aPos, 3, gl.FLOAT, false, STRIDE * 4, 0);
    gl.enableVertexAttribArray(this.aUv);
    gl.vertexAttribPointer(this.aUv, 2, gl.FLOAT, false, STRIDE * 4, 12);
    gl.enableVertexAttribArray(this.aColor);
    gl.vertexAttribPointer(this.aColor, 4, gl.FLOAT, false, STRIDE * 4, 20);
    gl.drawArrays(mode, 0, this.counts[name]);
  }

  project(p) {
    const { mvp, w, h } = this.matrices();
    const x = mvp[0] * p[0] + mvp[4] * p[1] + mvp[8] * p[2] + mvp[12];
    const y = mvp[1] * p[0] + mvp[5] * p[1] + mvp[9] * p[2] + mvp[13];
    const ww = mvp[3] * p[0] + mvp[7] * p[1] + mvp[11] * p[2] + mvp[15];
    if (ww <= 0) return null;
    return [((x / ww + 1) / 2) * w, ((1 - y / ww) / 2) * h];
  }

  ray(sx, sy) {
    const { mvp, w, h } = this.matrices();
    const inv = mat4Invert(mvp);
    const nx = (sx / w) * 2 - 1;
    const ny = 1 - (sy / h) * 2;
    const unproject = (z) => {
      const x = inv[0] * nx + inv[4] * ny + inv[8] * z + inv[12];
      const y = inv[1] * nx + inv[5] * ny + inv[9] * z + inv[13];
      const zz = inv[2] * nx + inv[6] * ny + inv[10] * z + inv[14];
      const ww = inv[3] * nx + inv[7] * ny + inv[11] * z + inv[15];
      return [x / ww, y / ww, zz / ww];
    };
    const a = unproject(-1);
    const b = unproject(1);
    return { origin: a, dir: norm(sub(b, a)) };
  }

  pick(sx, sy, isSolid) {
    const { origin, dir } = this.ray(sx, sy);
    const [sxz, syz, szz] = this.size;
    const lo = [-1, -1, -1];
    const hi = [sxz + 1, syz + 2, szz + 1];
    let tmin = 0;
    let tmax = 1e9;
    for (let i = 0; i < 3; i++) {
      if (Math.abs(dir[i]) < 1e-9) {
        if (origin[i] < lo[i] || origin[i] > hi[i]) return this.pickPlane(origin, dir);
        continue;
      }
      let t1 = (lo[i] - origin[i]) / dir[i];
      let t2 = (hi[i] - origin[i]) / dir[i];
      if (t1 > t2) [t1, t2] = [t2, t1];
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
    }
    if (tmin > tmax) return this.pickPlane(origin, dir);
    const p = [origin[0] + dir[0] * (tmin + 1e-4), origin[1] + dir[1] * (tmin + 1e-4), origin[2] + dir[2] * (tmin + 1e-4)];
    const cell = p.map(Math.floor);
    const step = dir.map((d) => (d > 0 ? 1 : -1));
    const tDelta = dir.map((d) => (Math.abs(d) < 1e-9 ? 1e9 : Math.abs(1 / d)));
    const tMax = dir.map((d, i) => (Math.abs(d) < 1e-9 ? 1e9 : ((d > 0 ? cell[i] + 1 - p[i] : p[i] - cell[i]) / Math.abs(d))));
    let face = [0, 0, 0];
    for (let n = 0; n < 512; n++) {
      const boxes = isSolid(cell[0], cell[1], cell[2]);
      if (boxes) {
        const hit = rayBoxes(origin, dir, cell, boxes === true ? [[0, 0, 0, 1, 1, 1]] : boxes);
        if (hit) return { pos: [...cell], face: hit.face, block: true };
      }
      let axis = 0;
      if (tMax[1] < tMax[axis]) axis = 1;
      if (tMax[2] < tMax[axis]) axis = 2;
      cell[axis] += step[axis];
      tMax[axis] += tDelta[axis];
      face = [0, 0, 0];
      face[axis] = -step[axis];
      if (cell[axis] < lo[axis] - 1 || cell[axis] > hi[axis] + 1) break;
    }
    return this.pickPlane(origin, dir);
  }

  pickPlane(origin, dir) {
    if (Math.abs(dir[1]) < 1e-6) return null;
    const t = (0 - origin[1]) / dir[1];
    if (t < 0) return null;
    const x = Math.floor(origin[0] + dir[0] * t);
    const z = Math.floor(origin[2] + dir[2] * t);
    return { pos: [x, -1, z], face: [0, 1, 0], block: false };
  }

  orbit(dx, dy) {
    this.camera.yaw += dx * 0.008;
    this.camera.pitch = Math.max(-1.45, Math.min(1.45, this.camera.pitch + dy * 0.008));
    this.requestRender();
  }

  pan(dx, dy) {
    const eye = this.eye();
    const fwd = norm(sub(this.camera.target, eye));
    const right = norm(cross(fwd, [0, 1, 0]));
    const up = cross(right, fwd);
    const s = this.camera.dist * 0.0015;
    this.camera.target = [this.camera.target[0] - right[0] * dx * s + up[0] * dy * s, this.camera.target[1] - right[1] * dx * s + up[1] * dy * s, this.camera.target[2] - right[2] * dx * s + up[2] * dy * s];
    this.requestRender();
  }

  zoom(delta) {
    this.camera.dist = Math.max(2, Math.min(300, this.camera.dist * Math.exp(delta * 0.0012)));
    this.requestRender();
  }
}

function rayBoxes(origin, dir, cell, boxes) {
  let best = null;
  for (const b of boxes) {
    const lo = [cell[0] + b[0], cell[1] + b[1], cell[2] + b[2]];
    const hi = [cell[0] + b[3], cell[1] + b[4], cell[2] + b[5]];
    let tmin = -Infinity;
    let tmax = Infinity;
    let axis = 0;
    let sign = 0;
    let ok = true;
    for (let i = 0; i < 3; i++) {
      if (Math.abs(dir[i]) < 1e-12) {
        if (origin[i] < lo[i] || origin[i] > hi[i]) ok = false;
        continue;
      }
      const t1 = (lo[i] - origin[i]) / dir[i];
      const t2 = (hi[i] - origin[i]) / dir[i];
      const near = Math.min(t1, t2);
      const far = Math.max(t1, t2);
      if (near > tmin) {
        tmin = near;
        axis = i;
        sign = dir[i] > 0 ? -1 : 1;
      }
      tmax = Math.min(tmax, far);
    }
    if (!ok || tmin > tmax || tmax < 0) continue;
    if (!best || tmin < best.t) {
      const face = [0, 0, 0];
      face[axis] = sign;
      best = { t: tmin, face };
    }
  }
  return best;
}

export function boxLines(box, color, grow = 0.004) {
  const [x0, y0, z0, x1, y1, z1] = [box[0] - grow, box[1] - grow, box[2] - grow, box[3] + 1 + grow, box[4] + 1 + grow, box[5] + 1 + grow];
  const c = [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]];
  const out = [];
  for (const [a, b] of [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]]) out.push(...c[a], ...color, ...c[b], ...color);
  return out;
}
