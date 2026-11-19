/* Pixelary art export: draws finished pixel drawings onto a canvas and saves them as PNG. */
(() => {
  const INK = '#1d1135';
  const PINK = '#ff3ea5';
  const CHAOS = ['#ff5f6d', '#ffc371', '#47e5bc', '#845ef7', '#ff3ea5', '#22b8ff', '#ffe14d', '#7cf35f'];

  /** Draw one pixel grid into a square of side `px` at (x, y). */
  function drawGrid(ctx, art, x, y, px) {
    const n = art.gridSize;
    const pad = Math.max(3, px * 0.015);
    const gap = n > 10 ? 1.5 : 3;
    const cell = (px - pad * 2 - gap * (n - 1)) / n;
    ctx.fillStyle = INK;
    roundRect(ctx, x, y, px, px, px * 0.04);
    ctx.fill();
    for (let i = 0; i < n * n; i++) {
      const cx = x + pad + (i % n) * (cell + gap);
      const cy = y + pad + Math.floor(i / n) * (cell + gap);
      ctx.fillStyle = art.grid[i] || '#ffffff';
      roundRect(ctx, cx, cy, cell, cell, Math.min(4, cell * 0.15));
      ctx.fill();
    }
  }

  /** Small canvas with just the drawing, for on-page thumbnails. */
  function thumbnail(art, px = 300) {
    const c = document.createElement('canvas');
    c.width = c.height = px;
    drawGrid(c.getContext('2d'), art, 0, 0, px);
    return c;
  }

  /**
   * Full keepsake image: "Pixelary" title, a subtitle, and a card per drawing
   * showing the word and the artist's name.
   */
  async function renderArtImage(artworks, subtitle) {
    try {
      await Promise.all([document.fonts.load('56px Bungee'), document.fonts.load('600 20px Fredoka')]);
    } catch { /* fall back to system fonts */ }

    const S = 2; // render at 2x for crisp images
    const cols = Math.min(artworks.length, 3);
    const rows = Math.ceil(artworks.length / cols);
    const gridPx = 260, cardPad = 18, cardW = gridPx + cardPad * 2, cardH = gridPx + cardPad * 2 + 70;
    const gapX = 28, gapY = 32, margin = 40, headerH = 140, footerH = 40;
    const W = Math.max(520, margin * 2 + cols * cardW + (cols - 1) * gapX);
    const H = headerH + rows * cardH + (rows - 1) * gapY + footerH + margin;

    const canvas = document.createElement('canvas');
    canvas.width = W * S;
    canvas.height = H * S;
    const ctx = canvas.getContext('2d');
    ctx.scale(S, S);

    // background
    const bg = ctx.createLinearGradient(0, 0, W, H);
    ['#ff5f6d', '#ffc371', '#47e5bc', '#845ef7'].forEach((c, i) => bg.addColorStop(i / 3, c));
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // title: rainbow letters with a hard ink shadow
    ctx.textBaseline = 'alphabetic';
    ctx.font = '56px Bungee, Impact, sans-serif';
    const title = 'PIXELARY';
    const letters = [...title].map((ch) => ({ ch, w: ctx.measureText(ch).width }));
    let tx = (W - letters.reduce((a, l) => a + l.w + 2, -2)) / 2;
    letters.forEach((l, i) => {
      ctx.fillStyle = INK;
      ctx.fillText(l.ch, tx + 4, 84);
      ctx.fillStyle = CHAOS[i % CHAOS.length];
      ctx.fillText(l.ch, tx, 80);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = INK;
      ctx.strokeText(l.ch, tx, 80);
      tx += l.w + 2;
    });
    ctx.font = '600 22px Fredoka, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = INK;
    ctx.fillText(subtitle, W / 2, 118);

    // cards
    const rowW = (count) => count * cardW + (count - 1) * gapX;
    artworks.forEach((art, i) => {
      const r = Math.floor(i / cols), c = i % cols;
      const inRow = Math.min(cols, artworks.length - r * cols);
      const x0 = (W - rowW(inRow)) / 2 + c * (cardW + gapX);
      const y0 = headerH + r * (cardH + gapY);
      ctx.save();
      ctx.translate(x0 + cardW / 2, y0 + cardH / 2);
      ctx.rotate(((i % 2 ? 1 : -1) * 1.2 * Math.PI) / 180);
      ctx.translate(-cardW / 2, -cardH / 2);
      ctx.fillStyle = INK;
      roundRect(ctx, 6, 6, cardW, cardH, 18);
      ctx.fill();
      ctx.fillStyle = '#fffdf7';
      roundRect(ctx, 0, 0, cardW, cardH, 18);
      ctx.fill();
      ctx.lineWidth = 4;
      ctx.strokeStyle = INK;
      ctx.stroke();
      drawGrid(ctx, art, cardPad, cardPad, gridPx);
      ctx.textAlign = 'center';
      ctx.font = `${fitFont(ctx, art.word.toUpperCase(), cardW - 20, 26)}px Bungee, Impact, sans-serif`;
      ctx.fillStyle = PINK;
      ctx.fillText(art.word.toUpperCase(), cardW / 2, gridPx + cardPad + 38);
      ctx.lineWidth = 1;
      ctx.strokeText(art.word.toUpperCase(), cardW / 2, gridPx + cardPad + 38);
      ctx.font = '600 18px Fredoka, sans-serif';
      ctx.fillStyle = INK;
      ctx.fillText(`by ${art.avatar} ${art.artist}`, cardW / 2, gridPx + cardPad + 64);
      ctx.restore();
    });

    // footer
    ctx.font = '500 14px Fredoka, sans-serif';
    ctx.fillStyle = INK;
    ctx.textAlign = 'center';
    ctx.fillText(new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }), W / 2, H - 22);
    return canvas;
  }

  function fitFont(ctx, text, maxW, size) {
    let s = size;
    while (s > 12) {
      ctx.font = `${s}px Bungee, Impact, sans-serif`;
      if (ctx.measureText(text).width <= maxW) break;
      s -= 2;
    }
    return s;
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  async function save(artworks, subtitle, filename) {
    const canvas = await renderArtImage(artworks, subtitle);
    const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'art';

  window.PixelArt = { drawGrid, thumbnail, renderArtImage, save, slug };
})();
