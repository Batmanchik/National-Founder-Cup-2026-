// Нейросетевой голос Акыла: Piper (через sherpa-onnx), работает офлайн и без ключей.
// Если модели или движка нет (например, запуск из исходников без `npm run voice`), голос недоступен,
// и интерфейс говорит системным синтезатором.
const fs = require('fs');
const path = require('path');

let tts = null;
let triedInit = false;
let asyncOk = true;
const cache = new Map(); // текст -> WAV, чтобы частые фразы не генерировать заново

// Мат запикан: символы и *пи-и-ип* читаем как «пи-ип», эмодзи и кавычки выбрасываем.
function cleanForSpeech(text) {
  return String(text || '')
    .replace(/\S*[#@$%&*]{2,}\S*/g, ' пи-ип ')
    .replace(/(?<!\p{L})\*?пи(?:-+и*)+п\*?/giu, ' пи-ип ')
    .replace(/[^\p{L}\p{N}\s.,!?:;—–-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function voiceDir(app) {
  return app && app.isPackaged ? path.join(process.resourcesPath, 'voice') : path.join(__dirname, '..', '..', 'voice');
}

function init(app) {
  if (triedInit) return tts;
  triedInit = true;
  try {
    const dir = voiceDir(app);
    const m = JSON.parse(fs.readFileSync(path.join(dir, 'voice.json'), 'utf8'));
    const sherpa = require('sherpa-onnx-node');
    tts = new sherpa.OfflineTts({
      model: {
        vits: { model: path.join(dir, m.model), tokens: path.join(dir, m.tokens), dataDir: path.join(dir, m.dataDir) },
        numThreads: 2,
      },
      maxNumSentences: 2,
    });
  } catch (err) {
    console.warn('[voice] нейросетевой голос недоступен:', err.message);
    tts = null;
  }
  return tts;
}

// Float32 [-1..1] -> WAV PCM 16 бит, моно.
function toWav(samples, sampleRate) {
  const data = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    data.writeInt16LE(Math.round(v * 32767), i * 2);
  }
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + data.length, 4);
  h.write('WAVE', 8);
  h.write('fmt ', 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); // PCM
  h.writeUInt16LE(1, 22); // моно
  h.writeUInt32LE(sampleRate, 24);
  h.writeUInt32LE(sampleRate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

async function speak(app, text) {
  const clean = cleanForSpeech(text).slice(0, 400);
  if (!clean || !init(app)) return null;
  if (cache.has(clean)) return cache.get(clean);
  // enableExternalBuffer: false — Electron запрещает нативным модулям отдавать «внешние» буферы памяти.
  const req = { text: clean, sid: 0, speed: 1.05, enableExternalBuffer: false };
  let audio = null;
  // В Electron асинхронная генерация sherpa-onnx бывает недоступна («TTS settlement failed»):
  // тогда навсегда переходим на синхронную — короткая фраза занимает ~0,3 с.
  if (asyncOk && tts.generateAsync) {
    try {
      audio = await tts.generateAsync(req);
    } catch {
      asyncOk = false;
    }
  }
  if (!audio) audio = tts.generate(req);
  const wav = toWav(audio.samples, audio.sampleRate);
  cache.set(clean, wav);
  if (cache.size > 60) cache.delete(cache.keys().next().value);
  return wav;
}

const available = (app) => Boolean(init(app));

module.exports = { speak, available, cleanForSpeech, toWav };
