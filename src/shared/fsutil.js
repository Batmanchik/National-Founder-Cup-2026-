// Надёжная запись JSON: сначала во временный файл, потом переименование.
// Если приложение упадёт посреди записи, старый файл останется целым.
const fs = require('fs');
const path = require('path');

function writeJsonAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
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
