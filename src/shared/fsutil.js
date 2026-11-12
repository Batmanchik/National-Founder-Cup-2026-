// Надёжная запись JSON: сначала во временный файл, потом переименование.
// Если приложение упадёт посреди записи, старый файл останется целым.
const fs = require('fs');
const path = require('path');

function writeJsonAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  const text = JSON.stringify(data, null, 2);
  fs.writeFileSync(tmp, text);
  try {
    fs.renameSync(tmp, file);
  } catch {
    // В Windows файл иногда держит антивирус или индексатор: пишем напрямую, чтобы данные не пропали.
    fs.writeFileSync(file, text);
    fs.rmSync(tmp, { force: true });
  }
}

// Читает JSON. Нет файла — возвращает null. Файл повреждён — откладывает его в .broken, чтобы не затереть.
function readJsonSafe(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    try {
      fs.copyFileSync(file, `${file}.broken`);
    } catch {
      /* не удалось сохранить копию — продолжаем с чистыми данными */
    }
    return null;
  }
}

module.exports = { writeJsonAtomic, readJsonSafe };
