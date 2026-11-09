// Поведение и отрисовка Акыла: гуляет по низу экрана, бегает к центру при отвлечении,
// прыгает от радости, спит на перерыве, его можно перетащить мышкой (он падает обратно на «пол»).
/* global NazarSprites */
(function () {
  'use strict';
  const S = NazarSprites;
  const SCALE = 5;
  const W = S.WIDTH * SCALE;
  const H = S.HEIGHT * SCALE;
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

  class Buddy {
    constructor(el, canvas) {
      this.el = el;
      this.canvas = canvas;
      canvas.width = W;
      canvas.height = H;
      this.ctx = canvas.getContext('2d');
      this.ctx.imageSmoothingEnabled = false;
      this.x = -W;
      this.y = this.ground();
      this.vy = 0;
      this.facing = 1;
      this.mode = 'walk'; // walk | idle | run | fall | drag | sleep
      this.mood = 'normal'; // normal | happy | worried
      this.targetX = 160;
      this.idleUntil = 0;
      this.jumpT = 0;
      this.talkingUntil = 0;
      this.nextBlink = performance.now() + 2500;
      this.t = 0;
      this.onMove = null;
      this._last = performance.now();
      this._loop = this._loop.bind(this);
      requestAnimationFrame(this._loop);
    }

    get width() { return W; }
    get height() { return H; }
    ground() { return window.innerHeight - H - GROUND_GAP; }

    walkTo(x) { this.targetX = this._clampX(x); this.mode = 'walk'; }
    runTo(x) { this.targetX = this._clampX(x); this.mode = 'run'; }
    jump() { this.jumpT = 0.45; }
    sleep() { this.mode = 'sleep'; }
    wake() { if (this.mode === 'sleep') { this.mode = 'idle'; this.idleUntil = performance.now() + 800; this.jump(); } }
    talk(ms) { this.talkingUntil = performance.now() + ms; }
    setMood(m) { this.mood = m; }

    startDrag() { this.mode = 'drag'; }
    dragTo(x, y) { this.x = this._clampX(x); this.y = Math.min(this.ground(), Math.max(0, y)); }
    drop() { this.mode = 'fall'; this.vy = 0; }

    _clampX(x) { return Math.max(4, Math.min(window.innerWidth - W - 4, x)); }

    _pickWanderTarget() {
      const span = Math.min(420, window.innerWidth / 2);
      this.walkTo(this.x + (Math.random() * 2 - 1) * span);
    }

    _update(dt, now) {
      this.t += dt;
      if (this.jumpT > 0) this.jumpT = Math.max(0, this.jumpT - dt);
      const g = this.ground();
      switch (this.mode) {
        case 'walk':
        case 'run': {
          const speed = this.mode === 'run' ? 260 : 45;
          const dx = this.targetX - this.x;
          if (Math.abs(dx) < 3) {
            if (this.mode === 'run') this.jump();
            this.mode = 'idle';
            this.idleUntil = now + 2500 + Math.random() * 5000;
          } else {
            this.facing = dx > 0 ? 1 : -1;
            this.x += Math.sign(dx) * Math.min(Math.abs(dx), speed * dt);
          }
          this.y = g;
          break;
        }
        case 'idle':
          this.y = g;
          if (now > this.idleUntil && this.mood !== 'worried') this._pickWanderTarget();
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

    _frameOpts(now) {
      const moving = this.mode === 'walk' || this.mode === 'run' || this.mode === 'drag';
      const stepRate = this.mode === 'run' ? 0.09 : 0.18;
      const legs = moving ? (Math.floor(this.t / stepRate) % 2 ? 'walkA' : 'walkB') : 'stand';
      let eyes = 'open';
      if (now > this.nextBlink) {
        eyes = 'blink';
        if (now > this.nextBlink + 140) this.nextBlink = now + 2500 + Math.random() * 3000;
      }
      let mouth = this.mood === 'happy' ? 'smile' : this.mood === 'worried' ? 'worried' : 'neutral';
      if (now < this.talkingUntil && Math.floor(this.t / 0.14) % 2) mouth = 'talk';
      let arms = this.jumpT > 0 || this.mode === 'drag' ? 'up' : 'down';
      if (this.mode === 'sleep') {
        eyes = 'blink';
        mouth = 'neutral';
        arms = 'down';
      }
      return { eyes, mouth, arms, legs, sweat: this.mood === 'worried' ? 'yes' : 'no' };
    }

    _draw(now) {
      const ctx = this.ctx;
      ctx.clearRect(0, 0, W, H);
      ctx.save();
      if (this.facing < 0) {
        ctx.translate(W, 0);
        ctx.scale(-1, 1);
      }
      ctx.drawImage(renderFrame(this._frameOpts(now)), 0, 0, W, H);
      ctx.restore();
      // Прыжок — синусоида; при сне — лёгкое «дыхание».
      const hop = this.jumpT > 0 ? Math.sin((this.jumpT / 0.45) * Math.PI) * 28 : 0;
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
