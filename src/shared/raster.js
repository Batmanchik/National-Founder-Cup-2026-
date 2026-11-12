// Растеризация кадра спрайта в пиксельный буфер (Node). Нужна иконке в трее и иконкам установщика.
const S = require('./sprites');
const { hexToRgb } = require('./util');

/**
 * Рисует строки спрайта в квадратный буфер size×size по центру, с целым масштабом.
 * @param {string[]} rows кадр из S.frame()
 * @param {{ size: number, order?: 'rgba' | 'bgra' }} opts
 * @returns {Buffer} size*size*4 байт
 */
function rasterize(rows, { size, order = 'rgba' }) {
  const width = rows[0].length;
  const scale = Math.max(1, Math.floor(size / Math.max(width, rows.length)));
  const offX = Math.floor((size - width * scale) / 2);
  const offY = Math.floor((size - rows.length * scale) / 2);
  const buf = Buffer.alloc(size * size * 4);
  rows.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      const color = S.PALETTE[ch];
      if (!color) return;
      const [r, g, b] = hexToRgb(color);
      const [c0, c2] = order === 'bgra' ? [b, r] : [r, b];
      for (let dy = 0; dy < scale; dy++)
        for (let dx = 0; dx < scale; dx++) {
          const i = ((offY + y * scale + dy) * size + offX + x * scale + dx) * 4;
          buf[i] = c0;
          buf[i + 1] = g;
          buf[i + 2] = c2;
          buf[i + 3] = 255;
        }
    });
  });
  return buf;
}

module.exports = { rasterize };
