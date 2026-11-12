// Иконка трея рисуется из того же пиксельного спрайта (голова Акыла), без файлов-картинок.
const { nativeImage } = require('electron');
const S = require('../shared/sprites');

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function makeTrayIcon() {
  const size = 32; // 16pt при scaleFactor 2
  const rows = S.frame({ mouth: 'smile', eyes: 'happy' }).slice(0, S.HEAD_ROWS); // только голова
  const scale = Math.max(1, Math.floor(size / Math.max(S.WIDTH, rows.length)));
  const buf = Buffer.alloc(size * size * 4); // BGRA
  const offY = Math.floor((size - rows.length * scale) / 2);
  const offX = Math.floor((size - S.WIDTH * scale) / 2);
  rows.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      const color = S.PALETTE[ch];
      if (!color) return;
      const [r, g, b] = hexToRgb(color);
      for (let dy = 0; dy < scale; dy++)
        for (let dx = 0; dx < scale; dx++) {
          const i = ((offY + y * scale + dy) * size + (offX + x * scale + dx)) * 4;
          buf[i] = b;
          buf[i + 1] = g;
          buf[i + 2] = r;
          buf[i + 3] = 255;
        }
    });
  });
  return nativeImage.createFromBitmap(buf, { width: size, height: size, scaleFactor: 2 });
}

module.exports = { makeTrayIcon };
