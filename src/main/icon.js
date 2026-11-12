// Иконка трея и окна: голова Акыла из того же спрайта, без файлов-картинок.
const { nativeImage } = require('electron');
const S = require('../shared/sprites');
const { rasterize } = require('../shared/raster');

const SIZE = 32; // 16pt при scaleFactor 2

function makeTrayIcon() {
  const head = S.frame({ mouth: 'smile', eyes: 'happy' }).slice(0, S.HEAD_ROWS);
  const buf = rasterize(head, { size: SIZE, order: 'bgra' });
  return nativeImage.createFromBitmap(buf, { width: SIZE, height: SIZE, scaleFactor: 2 });
}

module.exports = { makeTrayIcon };
