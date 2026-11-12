// Поведение и отрисовка Акыла.
// Он живёт внизу экрана и ведёт себя по ситуации, но спокойно, чтобы не отвлекать:
//  • без сессии гуляет, читает книжку, потягивается, оглядывается;
//  • во время фокуса стоит на месте и «работает рядом» на ноутбуке (почти без движения);
//  • при отвлечении волнуется и бежит к центру (это делает app.js по событию);
//  • на перерыве спит; ночью чаще зевает;
//  • следит глазами за курсором, машет, когда наводишь на него мышь;
//  • его можно перетащить мышкой (он падает обратно на «пол»).
/* global NazarSprites */
(function () {
  'use strict';
  const S = NazarSprites;
  const SIZES = { small: 3, medium: 4, large: 5 };
  const GROUND_GAP = 18; // место под HUD

  const cache = new Map();
  function renderFrame(opts) {
    const key = JSON.stringify(opts);
    if (cache.has(key)) return cache.get(key);
    const c = document.createElement('canvas');
    c.width = S.WIDTH;
    c.height = S.HEIGHT;
    const ctx = c.getContext('2d');
    S.frame(opts).forEach((row, y) => {
      [...row].forEach((ch, x) => {
        const color = S.PALETTE[ch];
        if (!color) return;
        ctx.fillStyle = color;
        ctx.fillRect(x, y, 1, 1);
      });
    });
    cache.set(key, c);
    return c;
  }

  const rand = (a, b) => a + Math.random() * (b - a);
  const isNight = () => {
    const h = new Date().getHours();
    return h >= 23 || h < 5;
  };

  class Buddy {
    constructor(el, canvas) {
      this.el = el;
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.setSize('medium');
      this.x = -this.w;
      this.y = this.ground();
      this.vy = 0;
      this.facing = 1;
      this.mode = 'walk'; // walk | idle | run | fall | drag | sleep
      this.mood = 'normal'; // normal | happy | worried
      this.context = 'none'; // none | focus | distraction | break — что сейчас делает человек
      this.targetX = 160;
      this.idleUntil = 0;
      this.jumpT = 0;
      this.talkingUntil = 0;
      this.nextBlink = performance.now() + 2500;
      this.nextAct = performance.now() + 4000;
      this.act = null; // { name, until } — короткое занятие: wave, stretch, yawn, look, read, cheer
      this.lookAt = null; // { x, y } курсора, если он рядом
      this.homeX = null; // где стоял до пробежки к центру
      this.angry = false;
      this.nextStomp = 0;
      this.t = 0;
      this.onMove = null;
      this._last = performance.now();
      this._loop = this._loop.bind(this);
      requestAnimationFrame(this._loop);
    }

    setSize(name) {
      const scale = SIZES[name] || SIZES.medium;
      if (scale === this.scale) return;
      this.scale = scale;
      this.w = S.WIDTH * scale;
      this.h = S.HEIGHT * scale;
      this.canvas.width = this.w;
      this.canvas.height = this.h;
      this.ctx.imageSmoothingEnabled = false;
      this.el.style.setProperty('--buddy-scale', scale);
      if (this.mode && this.mode !== 'drag') this.y = this.ground();
    }

    get width() { return this.w; }
    get height() { return this.h; }
    ground() { return window.innerHeight - this.h - GROUND_GAP; }

    walkTo(x) { this.targetX = this._clampX(x); this.mode = 'walk'; this.act = null; }
    // Бежит к x (например, к центру при отвлечении) и запоминает, где стоял, чтобы потом вернуться.
    runTo(x) {
      if (this.homeX == null && this.mode !== 'run') this.homeX = this.x;
      this.targetX = this._clampX(x);
      this.mode = 'run';
      this.act = null;
    }
    // Возвращается на своё место, чтобы не мешать в центре экрана.
    goHome() {
      if (this.homeX == null || this.mode === 'drag' || this.mode === 'sleep') return;
      const x = this.homeX;
      this.homeX = null;
      this.walkTo(x);
    }
    jump() { this.jumpT = 0.45; }
    sleep() { this.mode = 'sleep'; this.act = null; }
    wake() { if (this.mode === 'sleep') { this.mode = 'idle'; this.idleUntil = performance.now() + 800; this.jump(); } }
    talk(ms) { this.talkingUntil = performance.now() + ms; }
    setMood(m) { this.mood = m; }
    // Злится, пока человек сидит в ленте: брови домиком, кричит, трясёт кулаками и топает.
    setAngry(on) {
      this.angry = Boolean(on);
      if (on) this.act = null;
    }

    // Что делает человек: от этого зависит, чем занят Акыл.
    setContext(ctx) {
      if (ctx === this.context) return;
      this.context = ctx;
      if (this.act && (this.act.name === 'read' || this.act.name === 'work')) this.act = null;
      this.nextAct = performance.now() + rand(800, 2000);
    }

    // Короткое занятие на ms миллисекунд (если он не бежит, не спит и его не тащат).
    doAct(name, ms) {
      if (this.mode !== 'idle' && this.mode !== 'walk') return false;
      if (this.mode === 'walk') this.mode = 'idle';
      this.act = { name, until: performance.now() + ms };
      this.idleUntil = Math.max(this.idleUntil, this.act.until + 500);
      return true;
    }
    wave() { return this.doAct('wave', 1400); }
    cheer() { this.jump(); return this.doAct('cheer', 1600); }
    lookToward(x, y) { this.lookAt = x == null ? null : { x, y }; }

    startDrag() { this.mode = 'drag'; this.act = null; }
    dragTo(x, y) { this.x = this._clampX(x); this.y = Math.min(this.ground(), Math.max(0, y)); }
    drop() { this.mode = 'fall'; this.vy = 0; this.homeX = null; }

    _clampX(x) { return Math.max(4, Math.min(window.innerWidth - this.w - 4, x)); }

    _pickWanderTarget() {
      const span = Math.min(420, window.innerWidth / 2);
      this.walkTo(this.x + (Math.random() * 2 - 1) * span);
    }

    // Выбор следующего занятия, пока он стоит. Во время фокуса — только тихие занятия на месте.
    _chooseAct(now) {
      this.nextAct = now + rand(6000, 14000);
      if (this.context === 'focus') {
        // Работает рядом; изредка потягивается или зевает (ночью чаще).
        const r = Math.random();
        if (r < (isNight() ? 0.25 : 0.08)) return this.doAct('yawn', 1800);
        if (r < 0.15) return this.doAct('stretch', 1200);
        return this.doAct('work', rand(15000, 30000));
      }
      if (this.context === 'distraction') return this.doAct('look', 1500);
      const options = [
        ['look', 1600, 3],
        ['read', rand(8000, 16000), 2],
        ['stretch', 1200, 1],
        ['yawn', 1800, isNight() ? 3 : 0.5],
        ['wander', 0, 3],
      ];
      let total = options.reduce((s, o) => s + o[2], 0);
      let r = Math.random() * total;
      for (const [name, ms, weight] of options) {
        if ((r -= weight) > 0) continue;
        if (name === 'wander') return this._pickWanderTarget();
        return this.doAct(name, ms);
      }
      return null;
    }

    _update(dt, now) {
      this.t += dt;
      if (this.jumpT > 0) this.jumpT = Math.max(0, this.jumpT - dt);
      if (this.act && now > this.act.until) this.act = null;
      const g = this.ground();
      switch (this.mode) {
        case 'walk':
        case 'run': {
          const speed = this.mode === 'run' ? 260 : 45;
          const dx = this.targetX - this.x;
          if (Math.abs(dx) < 3) {
            if (this.mode === 'run') this.jump();
            this.mode = 'idle';
            this.idleUntil = now + rand(2500, 7500);
          } else {
            this.facing = dx > 0 ? 1 : -1;
            this.x += Math.sign(dx) * Math.min(Math.abs(dx), speed * dt);
          }
          this.y = g;
          break;
        }
        case 'idle':
          this.y = g;
          if (this.angry) {
            // Топает: короткие подскоки раз в ~1,2 с
            if (now > this.nextStomp) {
              this.jumpT = 0.18;
              this.nextStomp = now + rand(900, 1500);
            }
            break;
          }
          if (this.act) break;
          // Во время фокуса не гуляет: стоит там, где его оставили.
          if (now > this.nextAct) this._chooseAct(now);
          else if (now > this.idleUntil && this.context === 'none' && this.mood !== 'worried' && Math.random() < 0.002) this._pickWanderTarget();
          break;
        case 'fall':
          this.vy += 2200 * dt;
          this.y += this.vy * dt;
          if (this.y >= g) {
            this.y = g;
            this.mode = 'idle';
            this.idleUntil = now + 1500;
            this.jump();
          }
          break;
        case 'sleep':
          this.y = g;
          break;
        default:
          break;
      }
    }

    // Куда смотрят глаза: на курсор, если он рядом, или по занятию.
    _eyes(now) {
      if (now > this.nextBlink) {
        if (now > this.nextBlink + 140) this.nextBlink = now + rand(2500, 5500);
        return 'blink';
      }
      const name = this.act && this.act.name;
      if (name === 'work' || name === 'read') return 'down';
      if (name === 'wave' || name === 'cheer' || this.mood === 'happy') return 'happy';
      if (name === 'yawn') return 'blink';
      let dir = 0;
      if (this.lookAt) {
        const cx = this.x + this.w / 2;
        const d = this.lookAt.x - cx;
        if (Math.abs(d) > this.w * 0.6) dir = Math.sign(d);
      } else if (name === 'look') {
        dir = Math.sin(this.t * 2.2) > 0 ? 1 : -1;
      }
      if (!dir) return 'open';
      // Кадр отражается, когда он смотрит влево, поэтому сторона взгляда тоже отражается.
      return dir * this.facing > 0 ? 'right' : 'left';
    }

    _frameOpts(now) {
      const moving = this.mode === 'walk' || this.mode === 'run' || this.mode === 'drag';
      const stepRate = this.mode === 'run' ? 0.09 : 0.18;
      const legs = moving ? (Math.floor(this.t / stepRate) % 2 ? 'walkA' : 'walkB') : 'stand';
      let eyes = this._eyes(now);
      let mouth = this.mood === 'happy' ? 'smile' : this.mood === 'worried' ? 'worried' : 'neutral';
      let arms = this.jumpT > 0 || this.mode === 'drag' ? 'up' : 'down';
      const name = this.act && this.act.name;
      if (name === 'wave') arms = Math.floor(this.t / 0.22) % 2 ? 'wave' : 'wave2';
      if (name === 'cheer' || name === 'stretch') arms = 'up';
      if (name === 'read') arms = 'book';
      if (name === 'work') {
        // Печатает короткими «очередями» с паузами — движение почти незаметно краем глаза.
        const typing = Math.sin(this.t * 0.9) > 0.2;
        arms = typing && Math.floor(this.t / 0.2) % 2 ? 'laptop2' : 'laptop';
      }
      if (name === 'yawn') mouth = 'yawn';
      if (name === 'cheer' || name === 'wave') mouth = 'smile';
      if (now < this.talkingUntil && Math.floor(this.t / 0.14) % 2) mouth = 'talk';
      if (this.angry && this.mode !== 'sleep' && this.mode !== 'drag') {
        const beat = Math.floor(this.t / 0.16) % 2;
        eyes = now > this.nextBlink ? 'blink' : 'angry';
        arms = this.mode === 'run' ? 'fist' : beat ? 'fist' : 'fist2';
        // Пока ругается: крик чередуется с цензурной полоской — мат «запикан».
        const slow = Math.floor(this.t / 0.3) % 3;
        mouth = now < this.talkingUntil ? (slow === 0 ? 'shout' : 'censor') : 'frown';
      }
      if (this.mode === 'sleep') {
        eyes = 'blink';
        mouth = 'neutral';
        arms = 'down';
      }
      return { eyes, mouth, arms, legs, sweat: this.mood === 'worried' && !this.angry ? 'yes' : 'no' };
    }

    _draw(now) {
      const ctx = this.ctx;
      ctx.clearRect(0, 0, this.w, this.h);
      ctx.save();
      if (this.facing < 0) {
        ctx.translate(this.w, 0);
        ctx.scale(-1, 1);
      }
      ctx.drawImage(renderFrame(this._frameOpts(now)), 0, 0, this.w, this.h);
      ctx.restore();
      // Прыжок — синусоида; при сне — лёгкое «дыхание».
      const hopPx = this.scale * 5.6;
      const hop = this.jumpT > 0 ? Math.sin((this.jumpT / 0.45) * Math.PI) * hopPx : 0;
      const breathe = this.mode === 'sleep' ? Math.round(Math.sin(this.t * 2) * 1.5) : 0;
      this.el.style.transform = `translate(${Math.round(this.x)}px, ${Math.round(this.y - hop + breathe)}px)`;
      if (this.onMove) this.onMove(this.x, this.y - hop);
    }

    _loop(now) {
      const dt = Math.min(0.05, (now - this._last) / 1000);
      this._last = now;
      this._update(dt, now);
      this._draw(now);
      requestAnimationFrame(this._loop);
    }
  }

  window.Buddy = Buddy;
})();
