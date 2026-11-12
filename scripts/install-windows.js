// Запасной способ установки из исходников (без сборки Setup.exe): Nazar.exe в папке программ пользователя,
// ярлыки на рабочем столе и в меню «Пуск». Запуск: npm run install-app
// Обычным пользователям лучше ставить готовый Nazar-Setup.exe (npm run dist или GitHub Releases).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { makeIco } = require('./make-icon');

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
