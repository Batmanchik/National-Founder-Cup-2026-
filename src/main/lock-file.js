// Снимок заблокированной сессии на диске. Если Nazar убьют (диспетчер задач, kill),
// при следующем запуске сессия восстановится с того же места.
const fs = require('fs');
const { writeJsonAtomic, readJsonSafe } = require('../shared/fsutil');

const SAVE_EVERY_MS = 10000;

class LockFile {
  constructor(file) {
    this.file = file;
    this.lastSave = 0;
  }

  /** Сохраняет снимок (не чаще раза в 10 с, если не force). Незаблокированные сессии не храним. */
  save(session, force = false) {
    if (!session || !session.strict || session.surrendered) return this.clear();
    if (!force && Date.now() - this.lastSave < SAVE_EVERY_MS) return;
    this.lastSave = Date.now();
    try {
      writeJsonAtomic(this.file, session.snapshot());
    } catch (err) {
      console.error('[lock]', err.message);
    }
  }

  /** Удаляет снимок синхронно: иначе при быстром выходе сессия «воскреснет» при следующем запуске. */
  clear() {
    try {
      fs.rmSync(this.file, { force: true });
    } catch (err) {
      console.error('[lock]', err.message);
    }
  }

  load() {
    return readJsonSafe(this.file);
  }
}

module.exports = { LockFile };
