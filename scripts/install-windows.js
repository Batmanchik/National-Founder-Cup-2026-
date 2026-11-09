// Устанавливает Nazar как обычное приложение Windows: Nazar.exe в папке программ пользователя,
// ярлыки на рабочем столе и в меню «Пуск». Запуск: npm run install-app
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { spawnSync } = require('child_process');
const S = require('../src/shared/sprites');

if (process.platform !== 'win32') {
  console.error('Этот установщик работает только в Windows.');
  process.exit(1);
}

const ROOT = path.join(__dirname, '..');
const TARGET = path.join(process.env.LOCALAPPDATA, 'Programs', 'Nazar');
const EXE = path.join(TARGET, 'Nazar.exe');
const DIST = path.join(ROOT, 'node_modules', 'electron', 'dist');
const APP = path.join(TARGET, 'resources', 'app');

function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { stdio: 'inherit', shell: cmd === 'npm' || cmd === 'npx', ...opts });
  if (res.status !== 0) throw new Error(`Команда завершилась с ошибкой: ${cmd} ${args.join(' ')}`);
}

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// Иконка 256×256 из спрайта Акыла: PNG внутри контейнера ICO.
function makeIco() {
  const size = 256;
  const scale = Math.floor(size / Math.max(S.WIDTH, S.HEIGHT));
  const offX = Math.floor((size - S.WIDTH * scale) / 2);
  const offY = Math.floor((size - S.HEIGHT * scale) / 2);
  const px = Buffer.alloc(size * size * 4);
  S.frame({ mouth: 'smile' }).forEach((row, y) => {
    [...row].forEach((ch, x) => {
      const color = S.PALETTE[ch];
      if (!color) return;
      const [r, g, b] = hexToRgb(color);
      for (let dy = 0; dy < scale; dy++)
        for (let dx = 0; dx < scale; dx++) {
          const i = ((offY + y * scale + dy) * size + offX + x * scale + dx) * 4;
          px[i] = r;
          px[i + 1] = g;
          px[i + 2] = b;
          px[i + 3] = 255;
        }
    });
  });
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
  const header = Buffer.alloc(22);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);
  header.writeUInt16LE(1, 10);
  header.writeUInt16LE(32, 12);
  header.writeUInt32LE(png.length, 14);
  header.writeUInt32LE(22, 18);
  return Buffer.concat([header, png]);
}

function createShortcuts() {
  const script = `
$shell = New-Object -ComObject WScript.Shell
$places = @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs'))
foreach ($dir in $places) {
  $s = $shell.CreateShortcut((Join-Path $dir 'Nazar.lnk'))
  $s.TargetPath = $env:NAZAR_EXE
  $s.WorkingDirectory = $env:NAZAR_DIR
  $s.IconLocation = $env:NAZAR_ICO
  $s.Description = 'Nazar — ментор Акыл'
  $s.Save()
  Write-Output (Join-Path $dir 'Nazar.lnk')
}`;
  run('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], {
    env: { ...process.env, NAZAR_EXE: EXE, NAZAR_DIR: TARGET, NAZAR_ICO: path.join(TARGET, 'Nazar.ico') },
  });
}

function main() {
  if (!fs.existsSync(path.join(DIST, 'electron.exe'))) {
    console.log('Скачиваю Electron…');
    run('npx', ['install-electron'], { cwd: ROOT });
  }

  // Удаляем только свою предыдущую установку.
  spawnSync('taskkill', ['/IM', 'Nazar.exe', '/F'], { stdio: 'ignore' });
  if (fs.existsSync(TARGET)) {
    if (!fs.existsSync(EXE)) throw new Error(`Папка ${TARGET} существует, но это не установка Nazar. Удали её вручную.`);
    fs.rmSync(TARGET, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  }

  console.log(`Копирую приложение в ${TARGET}`);
  fs.cpSync(DIST, TARGET, { recursive: true });
  fs.renameSync(path.join(TARGET, 'electron.exe'), EXE);
  fs.rmSync(path.join(TARGET, 'resources', 'default_app.asar'), { force: true });

  fs.mkdirSync(APP, { recursive: true });
  fs.cpSync(path.join(ROOT, 'src'), path.join(APP, 'src'), { recursive: true });
  for (const file of ['package.json', 'package-lock.json']) fs.copyFileSync(path.join(ROOT, file), path.join(APP, file));

  console.log('Ставлю зависимости…');
  run('npm', ['ci', '--omit=dev', '--ignore-scripts', '--no-fund', '--no-audit'], { cwd: APP });

  fs.writeFileSync(path.join(TARGET, 'Nazar.ico'), makeIco());
  createShortcuts();
  console.log(`Готово. Запускай Nazar ярлыком на рабочем столе (${os.userInfo().username}).`);
}

main();
