const DIRS = {
  down: [0, -1, 0],
  up: [0, 1, 0],
  north: [0, 0, -1],
  south: [0, 0, 1],
  west: [-1, 0, 0],
  east: [1, 0, 0]
};

const SHADE = { up: 1, down: 0.5, north: 0.8, south: 0.8, west: 0.6, east: 0.6 };

function corners(dir, f, t) {
  const [x1, y1, z1] = f;
  const [x2, y2, z2] = t;
  switch (dir) {
    case 'north':
      return [[x2, y2, z1], [x1, y2, z1], [x1, y1, z1], [x2, y1, z1]];
    case 'south':
      return [[x1, y2, z2], [x2, y2, z2], [x2, y1, z2], [x1, y1, z2]];
    case 'west':
      return [[x1, y2, z1], [x1, y2, z2], [x1, y1, z2], [x1, y1, z1]];
    case 'east':
      return [[x2, y2, z2], [x2, y2, z1], [x2, y1, z1], [x2, y1, z2]];
    case 'up':
      return [[x1, y2, z1], [x2, y2, z1], [x2, y2, z2], [x1, y2, z2]];
    default:
      return [[x1, y1, z2], [x2, y1, z2], [x2, y1, z1], [x1, y1, z1]];
  }
}

function defaultUv(dir, f, t) {
  const [x1, y1, z1] = f;
  const [x2, y2, z2] = t;
  switch (dir) {
    case 'down':
      return [x1, 16 - z2, x2, 16 - z1];
    case 'up':
      return [x1, z1, x2, z2];
    case 'north':
      return [16 - x2, 16 - y2, 16 - x1, 16 - y1];
    case 'south':
      return [x1, 16 - y2, x2, 16 - y1];
    case 'west':
      return [z1, 16 - y2, z2, 16 - y1];
    default:
      return [16 - z2, 16 - y2, 16 - z1, 16 - y1];
  }
}

function rotateAxis(p, axis, angle, origin) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const [x, y, z] = [p[0] - origin[0], p[1] - origin[1], p[2] - origin[2]];
  let r;
  if (axis === 'x') r = [x, y * c - z * s, y * s + z * c];
  else if (axis === 'y') r = [x * c + z * s, y, -x * s + z * c];
  else r = [x * c - y * s, x * s + y * c, z];
  return [r[0] + origin[0], r[1] + origin[1], r[2] + origin[2]];
}

function elementTransform(rotation) {
  if (!rotation || !rotation.angle) return (p) => p;
  const angle = (rotation.angle * Math.PI) / 180;
  const origin = rotation.origin ?? [8, 8, 8];
  const axis = rotation.axis ?? 'y';
  const scale = rotation.rescale ? 1 / Math.cos(angle) : 1;
  return (p) => {
    const r = rotateAxis(p, axis, angle, origin);
    if (scale === 1) return r;
    return r.map((v, i) => (['x', 'y', 'z'][i] === axis ? v : origin[i] + (v - origin[i]) * scale));
  };
}

function blockTransform(x, y) {
  const ax = (-(x ?? 0) * Math.PI) / 180;
  const ay = (-(y ?? 0) * Math.PI) / 180;
  const c = [8, 8, 8];
  return (p) => {
    let r = ax ? rotateAxis(p, 'x', ax, c) : p;
    r = ay ? rotateAxis(r, 'y', ay, c) : r;
    return r.map((v) => Math.round(v * 1e5) / 1e5);
  };
}

const snapDir = (v) => v.map((n) => Math.round(n));

function textureOf(model, ref) {
  if (typeof ref !== 'string') return null;
  if (!ref.startsWith('#')) return ref.includes(':') ? ref : `minecraft:${ref}`;
  return model.textures?.[ref.slice(1)] ?? null;
}

export function bakeState(block, models) {
  const faces = [];
  const boxes = [];
  let full = false;
  let particle = null;
  for (const part of block?.parts ?? []) {
    const model = models[part.model];
    if (!model) continue;
    particle ??= model.textures?.particle ?? null;
    const place = blockTransform(part.x, part.y);
    const turn = (v) => snapDir(blockTransform(part.x, part.y)([v[0] * 8 + 8, v[1] * 8 + 8, v[2] * 8 + 8]).map((n) => (n - 8) / 8));
    for (const el of Array.isArray(model.elements) ? model.elements : []) {
      if (!Array.isArray(el.from) || !Array.isArray(el.to)) continue;
      const tf = elementTransform(el.rotation);
      const lo = place(el.from);
      const hi = place(el.to);
      boxes.push([Math.min(lo[0], hi[0]) / 16, Math.min(lo[1], hi[1]) / 16, Math.min(lo[2], hi[2]) / 16, Math.max(lo[0], hi[0]) / 16, Math.max(lo[1], hi[1]) / 16, Math.max(lo[2], hi[2]) / 16]);
      if (el.from.every((v) => v <= 0) && el.to.every((v) => v >= 16) && !el.rotation?.angle) full = true;
      for (const [dir, face] of Object.entries(el.faces ?? {})) {
        if (!DIRS[dir] || !face) continue;
        const uv = Array.isArray(face.uv) && face.uv.length === 4 ? face.uv : defaultUv(dir, el.from, el.to);
        const quad = [[uv[0], uv[1]], [uv[2], uv[1]], [uv[2], uv[3]], [uv[0], uv[3]]];
        const k = (((face.rotation ?? 0) / 90) % 4 + 4) % 4;
        const uvs = [0, 1, 2, 3].map((i) => quad[(i - k + 4) % 4]);
        const verts = corners(dir, el.from, el.to).map((p) => place(tf(p)).map((v) => v / 16));
        const normal = turn(DIRS[dir]);
        const shadeDir = Object.keys(DIRS).find((d) => DIRS[d].every((v, i) => v === normal[i])) ?? dir;
        faces.push({
          verts,
          uv: uvs,
          texture: textureOf(model, face.texture),
          cull: typeof face.cullface === 'string' && DIRS[face.cullface] ? turn(DIRS[face.cullface]) : null,
          shade: el.shade === false ? 1 : SHADE[shadeDir],
          tint: typeof face.tintindex === 'number' ? face.tintindex : -1
        });
      }
    }
  }
  return { faces, boxes, full, particle, modelled: faces.length > 0 };
}

export function boxGeometry(boxes, texture, full) {
  const faces = [];
  for (const b of boxes) {
    const f = [b[0] * 16, b[1] * 16, b[2] * 16];
    const t = [b[3] * 16, b[4] * 16, b[5] * 16];
    for (const dir of Object.keys(DIRS)) {
      const uv = defaultUv(dir, f, t);
      faces.push({
        verts: corners(dir, f, t).map((p) => p.map((v) => v / 16)),
        uv: [[uv[0], uv[1]], [uv[2], uv[1]], [uv[2], uv[3]], [uv[0], uv[3]]],
        texture,
        cull: full ? DIRS[dir] : null,
        shade: SHADE[dir],
        tint: -1
      });
    }
  }
  return { faces, boxes, full, particle: texture, modelled: false };
}

const GRASS = [0.47, 0.75, 0.35];
const FOLIAGE = [0.35, 0.68, 0.19];

export function tintFor(name, props) {
  const base = name.split(':').pop();
  if (base === 'redstone_wire') {
    const p = Number(props?.power ?? 0) / 15;
    return [0.3 + p * 0.7, 0, 0];
  }
  if (/water|bubble_column/.test(base)) return [0.25, 0.46, 0.89];
  if (/birch_leaves/.test(base)) return [0.5, 0.65, 0.33];
  if (/spruce_leaves/.test(base)) return [0.38, 0.6, 0.38];
  if (/leaves|vine|lily_pad/.test(base)) return FOLIAGE;
  if (/stem/.test(base)) return [0.6, 0.75, 0.2];
  return GRASS;
}

export function faceFrame(face) {
  if (!face.cull) return null;
  const at = (u, v) => face.uv.findIndex((p) => p[0] === u && p[1] === v);
  const [a, b, c, d] = [at(0, 0), at(16, 0), at(16, 16), at(0, 16)];
  if (a < 0 || b < 0 || c < 0 || d < 0) return null;
  const step = (p, q) => p.map((x, i) => x - q[i]);
  const right = step(face.verts[b], face.verts[a]);
  const up = step(face.verts[a], face.verts[d]);
  const unit = (v) => v.every((x) => x === 0 || Math.abs(x) === 1) && v.filter((x) => x !== 0).length === 1;
  return unit(right) && unit(up) ? { right, up } : null;
}

export function connectedIndex({ up, down, left, right, topLeft, topRight, bottomLeft, bottomRight }) {
  const borders = !up + !down + !left + !right;
  let tileX = (up ? 1 : 0) + (down ? 2 : 0);
  let tileY = (left ? 1 : 0) + (right ? 2 : 0);
  if (borders === 0) {
    if (topRight) tileX++;
    if (topLeft) tileX += 2;
    if (bottomRight) tileY += 2;
    if (bottomLeft) tileY++;
  }
  if (borders === 1) {
    if (!right && (topLeft || bottomLeft)) {
      tileY = 4;
      tileX = -1 + (bottomLeft ? 1 : 0) + (topLeft ? 1 : 0) * 2;
    }
    if (!left && (topRight || bottomRight)) {
      tileY = 5;
      tileX = -1 + (bottomRight ? 1 : 0) + (topRight ? 1 : 0) * 2;
    }
    if (!down && (topLeft || topRight)) {
      tileY = 6;
      tileX = -1 + (topLeft ? 1 : 0) + (topRight ? 1 : 0) * 2;
    }
    if (!up && (bottomLeft || bottomRight)) {
      tileY = 7;
      tileX = -1 + (bottomLeft ? 1 : 0) + (bottomRight ? 1 : 0) * 2;
    }
  }
  if (borders === 2 && ((up && left && topLeft) || (down && left && bottomLeft) || (up && right && topRight) || (down && right && bottomRight))) tileX += 3;
  return tileX + 8 * tileY;
}

export function connectedUV(uv, index) {
  return uv.map(([u, v]) => [((index % 8) * 16 + u) / 8, (Math.floor(index / 8) * 16 + v) / 8]);
}
