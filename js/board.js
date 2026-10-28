// Холст с масштабом, перемещением и выбором клетки. Общий для игры и админки.
export class BoardView {
  constructor({ stage, canvas, W, H, palette, onSelect }) {
    this.stage = stage; this.cvs = canvas; this.ctx = canvas.getContext('2d');
    this.W = W; this.H = H; this.PAL = palette; this.onSelect = onSelect || (() => {});
    this.RGB = palette.map(h => [parseInt(h.slice(1,3),16), parseInt(h.slice(3,5),16), parseInt(h.slice(5,7),16)]);
    this.pix = new Uint8Array(W * H);
    this.off = document.createElement('canvas'); this.off.width = W; this.off.height = H;
    this.offCtx = this.off.getContext('2d');
    this.img = this.offCtx.createImageData(W, H);
    this.img.data.fill(255);
    this.scale = 6; this.ox = 0; this.oy = 0; this.dpr = 1;
    this.dirty = true; this.imgDirty = true;
    this.sel = null; this.ghostColor = null;
    this.overlays = [];            // функции (ctx, view) => void для доп. отрисовки
    this._bindInput();
    window.addEventListener('resize', () => this.resize());
    this.resize(); this.fit();
    const loop = () => { if (this.dirty) { this.dirty = false; this.draw(); } requestAnimationFrame(loop); };
    loop();
  }

  setPixel(x, y, c) {
    if (x < 0 || y < 0 || x >= this.W || y >= this.H) return;
    const i = y * this.W + x;
    if (this.pix[i] === c) return;
    this.pix[i] = c;
    const [r, g, b] = this.RGB[c] || this.RGB[0];
    const d = this.img.data; d[i*4] = r; d[i*4+1] = g; d[i*4+2] = b; d[i*4+3] = 255;
    this.imgDirty = true; this.dirty = true;
  }
  getPixel(x, y) { return this.pix[y * this.W + x]; }
  clearAll() { this.pix.fill(0); this.img.data.fill(255); this.imgDirty = true; this.dirty = true; }
  redraw() { this.dirty = true; }

  resize() {
    this.dpr = window.devicePixelRatio || 1;
    const r = this.stage.getBoundingClientRect();
    this.cvs.width = Math.max(1, Math.round(r.width * this.dpr));
    this.cvs.height = Math.max(1, Math.round(r.height * this.dpr));
    this.dirty = true;
  }
  fit() {
    const r = this.stage.getBoundingClientRect();
    this.scale = Math.max(1, Math.min((r.width - 40) / this.W, (r.height - 40) / this.H));
    this.ox = (r.width - this.W * this.scale) / 2; this.oy = (r.height - this.H * this.scale) / 2;
    this.dirty = true;
  }
  zoomAt(f, sx, sy) {
    const ns = Math.min(60, Math.max(1, this.scale * f));
    this.ox = sx - (sx - this.ox) * (ns / this.scale);
    this.oy = sy - (sy - this.oy) * (ns / this.scale);
    this.scale = ns; this.dirty = true;
  }
  zoomCenter(f) { const r = this.stage.getBoundingClientRect(); this.zoomAt(f, r.width / 2, r.height / 2); }
  toCell(sx, sy) {
    const x = Math.floor((sx - this.ox) / this.scale), y = Math.floor((sy - this.oy) / this.scale);
    return (x >= 0 && y >= 0 && x < this.W && y < this.H) ? { x, y } : null;
  }
  select(c) { this.sel = c; this.dirty = true; this.onSelect(c); }

  cellRect(x, y) { return [this.ox + x * this.scale, this.oy + y * this.scale, this.scale]; }

  draw() {
    const { ctx, W, H, scale, ox, oy } = this;
    if (this.imgDirty) { this.offCtx.putImageData(this.img, 0, 0); this.imgDirty = false; }
    const css = getComputedStyle(document.documentElement);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.cvs.width, this.cvs.height);
    ctx.fillStyle = css.getPropertyValue('--board-shadow').trim() || 'rgba(0,0,0,.2)';
    ctx.fillRect(ox + 4, oy + 4, W * scale, H * scale);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.off, ox, oy, W * scale, H * scale);
    if (scale >= 14) {
      ctx.strokeStyle = 'rgba(0,0,0,.08)'; ctx.lineWidth = 1; ctx.beginPath();
      for (let x = 0; x <= W; x++) { const px = Math.round(ox + x * scale) + .5; ctx.moveTo(px, oy); ctx.lineTo(px, oy + H * scale); }
      for (let y = 0; y <= H; y++) { const py = Math.round(oy + y * scale) + .5; ctx.moveTo(ox, py); ctx.lineTo(ox + W * scale, py); }
      ctx.stroke();
    }
    for (const f of this.overlays) f(ctx, this);
    if (this.sel) {
      const [x, y, s] = this.cellRect(this.sel.x, this.sel.y);
      if (this.ghostColor != null) { ctx.fillStyle = this.PAL[this.ghostColor]; ctx.globalAlpha = .75; ctx.fillRect(x, y, s, s); ctx.globalAlpha = 1; }
      ctx.lineWidth = 2; ctx.strokeStyle = '#000'; ctx.strokeRect(x - 1.5, y - 1.5, s + 3, s + 3);
      ctx.strokeStyle = '#fff'; ctx.strokeRect(x - 3.5, y - 3.5, s + 7, s + 7);
    }
  }

  _bindInput() {
    const st = this.stage, pts = new Map(); let moved = false, pinch = null;
    st.addEventListener('pointerdown', e => {
      if (e.target !== this.cvs) return;
      st.setPointerCapture(e.pointerId);
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY });
      if (pts.size === 1) moved = false;
      if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) }; moved = true; }
    });
    st.addEventListener('pointermove', e => {
      const p = pts.get(e.pointerId); if (!p) return;
      const r = st.getBoundingClientRect();
      if (pts.size === 1) {
        if (Math.hypot(e.clientX - p.sx, e.clientY - p.sy) > 5) moved = true;
        if (moved) { this.ox += e.clientX - p.x; this.oy += e.clientY - p.y; this.dirty = true; }
      } else if (pts.size === 2 && pinch) {
        p.x = e.clientX; p.y = e.clientY;
        const [a, b] = [...pts.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y);
        this.zoomAt(d / pinch.d, (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top); pinch.d = d; return;
      }
      p.x = e.clientX; p.y = e.clientY;
    });
    const up = e => {
      if (!pts.has(e.pointerId)) return;
      pts.delete(e.pointerId); if (pts.size < 2) pinch = null;
      if (!moved && pts.size === 0) {
        const r = st.getBoundingClientRect(); const c = this.toCell(e.clientX - r.left, e.clientY - r.top);
        if (c) this.select(c);
      }
    };
    st.addEventListener('pointerup', up);
    st.addEventListener('pointercancel', e => { pts.delete(e.pointerId); pinch = null; });
    st.addEventListener('wheel', e => {
      e.preventDefault(); const r = st.getBoundingClientRect();
      this.zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });
  }

  // PNG всего поля 1 клетка = 1 пиксель × k
  toPNG(k = 8) {
    const c = document.createElement('canvas'); c.width = this.W * k; c.height = this.H * k;
    const x = c.getContext('2d'); x.imageSmoothingEnabled = false;
    this.offCtx.putImageData(this.img, 0, 0);
    x.drawImage(this.off, 0, 0, c.width, c.height);
    return c.toDataURL('image/png');
  }
}

export function paletteButtons(container, palette, initial, onPick) {
  palette.forEach((h, i) => {
    const b = document.createElement('button');
    b.className = 'sw'; b.style.background = h; b.type = 'button';
    b.setAttribute('aria-label', 'Цвет ' + h); b.setAttribute('aria-pressed', i === initial);
    b.onclick = () => { [...container.children].forEach((c, j) => c.setAttribute('aria-pressed', j === i)); onPick(i); };
    container.appendChild(b);
  });
}
