// Скачивает нейросетевой голос Акыла (Piper, офлайн, без ключей) в папку voice/.
// Модель весит ~63 МБ, поэтому в git её нет: скрипт запускается перед сборкой установщика.
// Голос выбирается переменной NAZAR_VOICE (denis, dmitri, irina, ruslan), по умолчанию dmitri.
const fs = require('fs');
const path = require('path');
const https = require('https');
const { spawnSync } = require('child_process');

const VOICES = ['denis', 'dmitri', 'irina', 'ruslan'];
const voice = process.env.NAZAR_VOICE || 'dmitri';
if (!VOICES.includes(voice)) {
  console.error(`Неизвестный голос «${voice}». Есть: ${VOICES.join(', ')}`);
  process.exit(1);
}
const name = `vits-piper-ru_RU-${voice}-medium`;
const url = `https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/${name}.tar.bz2`;
const OUT = path.join(__dirname, '..', 'voice');
const MANIFEST = path.join(OUT, 'voice.json');

function download(link, file, redirects = 5) {
  return new Promise((resolve, reject) => {
    https
      .get(link, { headers: { 'User-Agent': 'nazar-build' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) {
          res.resume();
          return resolve(download(res.headers.location, file, redirects - 1));
        }
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} для ${link}`));
        const out = fs.createWriteStream(file);
        res.pipe(out);
        out.on('finish', () => out.close(resolve));
        out.on('error', reject);
      })
      .on('error', reject);
  });
}

async function main() {
  try {
    const have = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
    if (have.voice === voice && fs.existsSync(path.join(OUT, have.model))) {
      console.log(`Голос «${voice}» уже скачан.`);
      return;
    }
  } catch {
    /* голоса ещё нет */
  }
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  const archive = path.join(OUT, `${name}.tar.bz2`);
  console.log(`Скачиваю голос «${voice}» (~63 МБ)…`);
  await download(url, archive);
  const res = spawnSync('tar', ['-xjf', archive, '-C', OUT], { stdio: 'inherit' });
  if (res.status !== 0) throw new Error('Не удалось распаковать архив (нужна команда tar)');
  fs.rmSync(archive);
  const src = path.join(OUT, name);
  for (const entry of fs.readdirSync(src)) fs.renameSync(path.join(src, entry), path.join(OUT, entry));
  fs.rmSync(src, { recursive: true, force: true });
  fs.writeFileSync(
    MANIFEST,
    JSON.stringify({ voice, model: `ru_RU-${voice}-medium.onnx`, tokens: 'tokens.txt', dataDir: 'espeak-ng-data' }, null, 2)
  );
  console.log(`Готово: голос «${voice}» в ${OUT}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
