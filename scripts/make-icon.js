// Иконка приложения из спрайта Акыла (без файлов-картинок в исходниках).
// npm run icons записывает build/icon.png и build/icon.ico для electron-builder.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const S = require('../src/shared/sprites');
const { rasterize } = require('../src/shared/raster');

// Квадратный PNG size×size из спрайта Акыла.
function makePng(size = 256) {
  const px = rasterize(S.frame({ mouth: 'smile' }), { size });
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  return png;
}

// Иконка Windows: несколько PNG разных размеров в одном контейнере ICO (чёткая и в трее, и на рабочем столе).
const ICO_SIZES = [32, 48, 64, 128, 256];

function makeIco() {
  const images = ICO_SIZES.map((size) => ({ size, png: makePng(size) }));
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2); // тип: иконка
  header.writeUInt16LE(images.length, 4);
  let offset = 6 + 16 * images.length;
  const dir = images.map(({ size, png }) => {
    const e = Buffer.alloc(16);
    e[0] = size >= 256 ? 0 : size; // 0 значит 256
    e[1] = size >= 256 ? 0 : size;
    e.writeUInt16LE(1, 4); // плоскости
    e.writeUInt16LE(32, 6); // бит на пиксель
    e.writeUInt32LE(png.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += png.length;
    return e;
  });
  return Buffer.concat([header, ...dir, ...images.map((x) => x.png)]);
}

function writeIcons(dir = path.join(__dirname, '..', 'build')) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'icon.png'), makePng(512));
  fs.writeFileSync(path.join(dir, 'icon.ico'), makeIco());
  return dir;
}

if (require.main === module) console.log(`Иконки записаны в ${writeIcons()}`);

module.exports = { makePng, makeIco, writeIcons };
