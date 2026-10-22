const PAD = 1;

export class Atlas {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.images = new Map();
    this.sprites = new Map();
    this.connected = {};
    this.white = { u0: 0.5, v0: 0.5, u1: 0.5, v1: 0.5, translucent: false, average: [1, 1, 1] };
    this.version = 0;
    this.pack();
  }

  async add(images) {
    let changed = false;
    for (const [id, data] of Object.entries(images ?? {})) {
      if (this.images.has(id)) continue;
      try {
        const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
        this.images.set(id, await createImageBitmap(new Blob([bytes], { type: 'image/png' })));
      } catch {
        this.images.set(id, null);
      }
      changed = true;
    }
    if (changed) this.pack();
    return changed;
  }

  has(id) {
    return this.images.has(id);
  }

  rect(id) {
    return (id && this.sprites.get(id)) || null;
  }

  sheet(id) {
    const to = this.connected[id];
    const base = this.images.get(id);
    const sheet = to && this.images.get(to);
    return base && sheet && sheet.width === base.width * 8 ? this.rect(to) : null;
  }

  pack() {
    const list = [...this.images]
      .filter(([, b]) => b)
      .map(([id, b]) => ({ id, b, w: b.width, h: Math.min(b.width, b.height) }))
      .sort((a, b) => b.h - a.h || b.w - a.w);
    let size = 256;
    let places;
    for (;;) {
      places = shelf(list, size);
      if (places || size >= 8192) break;
      size *= 2;
    }
    if (!places) places = shelf(list.slice(0, 1), size) ?? [];
    this.canvas.width = size;
    this.canvas.height = size;
    const ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    ctx.clearRect(0, 0, size, size);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 4, 4);
    this.white = { u0: 2 / size, v0: 2 / size, u1: 2 / size, v1: 2 / size, translucent: false, average: [1, 1, 1] };
    this.sprites = new Map();
    for (const p of places) {
      const { b, w, h } = p.item;
      for (const [dx, dy, sx, sy, sw, sh] of [
        [0, 0, 0, 0, w, h],
        [-PAD, 0, 0, 0, 1, h],
        [w, 0, w - 1, 0, 1, h],
        [0, -PAD, 0, 0, w, 1],
        [0, h, 0, h - 1, w, 1]
      ]) ctx.drawImage(b, sx, sy, sw, sh, p.x + dx, p.y + dy, sw, sh);
      const px = ctx.getImageData(p.x, p.y, w, h).data;
      let translucent = false;
      let r = 0;
      let g = 0;
      let bl = 0;
      let n = 0;
      for (let i = 0; i < px.length; i += 4) {
        const a = px[i + 3];
        if (a > 0 && a < 250) translucent = true;
        if (a > 0) {
          r += px[i];
          g += px[i + 1];
          bl += px[i + 2];
          n++;
        }
      }
      this.sprites.set(p.item.id, { u0: p.x / size, v0: p.y / size, u1: (p.x + w) / size, v1: (p.y + h) / size, translucent, average: n ? [r / n / 255, g / n / 255, bl / n / 255] : [1, 1, 1] });
    }
    this.version++;
  }
}

function shelf(list, size) {
  const out = [];
  let x = 4 + PAD * 2;
  let y = PAD;
  let row = 4;
  for (const item of list) {
    if (x + item.w + PAD > size) {
      x = PAD;
      y += row + PAD * 2;
      row = 0;
    }
    if (y + item.h + PAD > size) return null;
    out.push({ item, x, y });
    x += item.w + PAD * 2;
    row = Math.max(row, item.h);
  }
  return out;
}
