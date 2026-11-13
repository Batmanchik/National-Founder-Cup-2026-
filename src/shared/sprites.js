// Пиксельный спрайт ментора «Акыл», 24×30 пикселей.
// Кадр собирается слоями: тело → глаза → рот → капля пота → руки (и предметы) → ноги.
// Слои рисуют только заливку; чёрный контур вокруг фигуры строится автоматически в конце,
// поэтому новые позы и предметы сразу получают аккуратную обводку.
// Файл работает и в Node (main-процесс, тесты), и в браузере (renderer).
(function (root) {
  'use strict';

  const WIDTH = 24;
  const HEIGHT = 30;
  const HEAD_ROWS = 15; // голова с волосами — для иконки в трее

  const PALETTE = {
    o: '#1a1c2c', // контур
    h: '#3b2a26', // волосы
    H: '#5c4036', // блик на волосах
    s: '#f4c7a1', // кожа
    S: '#d9a07a', // тень кожи
    e: '#1a1c2c', // зрачки и брови
    i: '#ffffff', // блик в глазах
    r: '#f08f8f', // румянец
    m: '#8c3a3a', // рот
    t: '#e0606a', // язык
    c: '#2ec4b6', // худи
    L: '#6fe3d8', // свет на худи
    C: '#1d8a80', // тень худи
    n: '#f4f4e8', // шнурки
    y: '#ffd166', // логотип и наконечники шнурков
    p: '#3b4a7a', // штаны
    P: '#2a355c', // тень штанов
    b: '#22223b', // кеды
    q: '#e8e8e8', // подошва
    d: '#6ec6ff', // капля пота
    D: '#c9ecff', // блик капли
    g: '#9aa5b1', // крышка ноутбука
    k: '#5c6670', // клавиатура
    w: '#e8f1f2', // логотип на крышке
    B: '#d1495b', // обложка книги
    W: '#fff8e7', // страницы
  };

  // ---------- Рисовалка ----------
  function canvas() {
    return Array.from({ length: HEIGHT }, () => Array(WIDTH).fill('.'));
  }
  const inside = (x, y) => x >= 0 && y >= 0 && x < WIDTH && y < HEIGHT;
  function px(g, x, y, c) {
    if (inside(x, y)) g[y][x] = c;
  }
  function rect(g, x, y, w, h, c) {
    for (let j = 0; j < h; j++) for (let k = 0; k < w; k++) px(g, x + k, y + j, c);
  }
  function hline(g, x1, x2, y, c) {
    for (let x = x1; x <= x2; x++) px(g, x, y, c);
  }
  // Зеркально по вертикальной оси (для симметричных деталей).
  const mx = (x) => WIDTH - 1 - x;
  function mirrorPx(g, x, y, c) {
    px(g, x, y, c);
    px(g, mx(x), y, c);
  }
  function mirrorRect(g, x, y, w, h, c) {
    rect(g, x, y, w, h, c);
    rect(g, mx(x + w - 1), y, w, h, c);
  }
  function clear(g, x, y, w, h) {
    rect(g, x, y, w, h, '.');
  }

  // Контур: каждая пустая клетка рядом с заливкой (по 4 соседям) становится чёрной.
  function outline(g) {
    const out = g.map((row) => row.slice());
    for (let y = 0; y < HEIGHT; y++)
      for (let x = 0; x < WIDTH; x++) {
        if (g[y][x] !== '.') continue;
        const near = [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ].some(([dx, dy]) => inside(x + dx, y + dy) && g[y + dy][x + dx] !== '.' && g[y + dy][x + dx] !== 'o');
        if (near) out[y][x] = 'o';
      }
    return out;
  }

  // ---------- Тело ----------
  function body(g) {
    // Волосы: макушка, чёлка, виски
    hline(g, 8, 15, 1, 'h');
    hline(g, 6, 17, 2, 'h');
    rect(g, 5, 3, 14, 2, 'h');
    hline(g, 9, 12, 2, 'H'); // блик на макушке
    hline(g, 7, 8, 3, 'H');
    // Лицо
    rect(g, 6, 5, 12, 8, 's');
    hline(g, 7, 16, 12, 's');
    hline(g, 8, 15, 13, 'S'); // подбородок в тени
    // Чёлка: сплошная, с «прядками» вниз
    hline(g, 6, 17, 5, 'h');
    px(g, 7, 6, 'h');
    px(g, 15, 6, 'h');
    px(g, 16, 6, 'h');
    // Виски и уши
    mirrorRect(g, 5, 5, 1, 3, 'h');
    mirrorRect(g, 5, 8, 1, 2, 's');
    mirrorPx(g, 5, 9, 'S');
    // Тень под чёлкой
    hline(g, 8, 14, 6, 'S');
    // Румянец
    hline(g, 7, 8, 10, 'r');
    hline(g, 15, 16, 10, 'r');

    // Худи: капюшон-воротник, корпус, свет слева и тень справа
    hline(g, 7, 16, 14, 'C');
    rect(g, 5, 15, 14, 8, 'c');
    rect(g, 4, 15, 1, 2, 'c'); // плечи — к ним крепятся рукава
    rect(g, 19, 15, 1, 2, 'c');
    rect(g, 6, 15, 1, 7, 'L');
    rect(g, 17, 15, 1, 8, 'C');
    hline(g, 5, 18, 23, 'C'); // резинка внизу
    // Шнурки капюшона
    rect(g, 10, 15, 1, 3, 'n');
    rect(g, 13, 15, 1, 3, 'n');
    px(g, 10, 18, 'y');
    px(g, 13, 18, 'y');
    // Карман-кенгуру
    hline(g, 8, 15, 20, 'C');
    rect(g, 8, 21, 1, 2, 'C');
    rect(g, 15, 21, 1, 2, 'C');

    // Руки по швам (их заменяют варианты рук)
    armsDown(g);

    // Штаны
    hline(g, 7, 16, 24, 'p');
    rect(g, 7, 25, 4, 2, 'p');
    rect(g, 13, 25, 4, 2, 'p');
    rect(g, 7, 24, 1, 3, 'P');
    rect(g, 13, 25, 1, 2, 'P');
    // Кеды с белой подошвой
    rect(g, 6, 27, 5, 1, 'b');
    rect(g, 13, 27, 5, 1, 'b');
    hline(g, 6, 10, 28, 'q');
    hline(g, 13, 17, 28, 'q');
  }

  // ---------- Руки ----------
  // Рукав отстоит от туловища на пиксель — между ними автоматически ложится контур.
  function sleeve(g, x, y, h, side) {
    rect(g, x, y, 2, h, 'c');
    rect(g, side < 0 ? x : x + 1, y, 1, h, 'C'); // наружная сторона в тени
  }
  function armsDown(g) {
    sleeve(g, 2, 16, 6, -1);
    sleeve(g, 20, 16, 6, 1);
    hline(g, 2, 3, 15, 'c');
    hline(g, 20, 21, 15, 'c');
    hline(g, 2, 3, 21, 'C');
    hline(g, 20, 21, 21, 'C');
    rect(g, 2, 22, 2, 2, 's');
    rect(g, 20, 22, 2, 2, 's');
  }
  function clearArms(g) {
    clear(g, 0, 7, 4, 17);
    clear(g, 20, 7, 4, 17);
  }
  function armUp(g, side, handX) {
    const x = side < 0 ? 2 : 20;
    rect(g, x, 10, 2, 5, 'c');
    rect(g, side < 0 ? x : x + 1, 10, 1, 5, 'C');
    hline(g, x, x + 1, 10, 'C');
    rect(g, handX, 8, 2, 2, 's');
  }
  function armDownOne(g, side) {
    const x = side < 0 ? 2 : 20;
    sleeve(g, x, 16, 6, side);
    hline(g, x, x + 1, 15, 'c');
    hline(g, x, x + 1, 21, 'C');
    rect(g, x, 22, 2, 2, 's');
  }
  function fists(g, raise) {
    // Согнутые руки, кулаки у плеч
    for (const side of [-1, 1]) {
      const x = side < 0 ? 2 : 20;
      rect(g, x, 14, 2, 4, 'c');
      rect(g, side < 0 ? x : x + 1, 14, 1, 4, 'C');
      const fx = side < 0 ? (raise ? 1 : 2) : raise ? 21 : 20;
      rect(g, fx, raise ? 11 : 12, 2, 2, 's');
      px(g, side < 0 ? fx + 1 : fx, raise ? 12 : 13, 'S');
    }
  }
  function sideArmsTo(g, handY, handInset) {
    // Рукава к предмету в руках
    for (const side of [-1, 1]) {
      const x = side < 0 ? 4 : 18;
      rect(g, x, 15, 2, handY - 15, 'c');
      rect(g, side < 0 ? x : x + 1, 15, 1, handY - 15, 'C');
      const hx = side < 0 ? 4 + handInset : 18 - handInset;
      rect(g, hx, handY, 2, 2, 's');
    }
  }
  function laptop(g, typing) {
    rect(g, 7, 17, 10, 5, 'g');
    hline(g, 7, 16, 17, 'k'); // верхний край крышки
    rect(g, 11, 18, 2, 2, 'w');
    hline(g, 6, 17, 22, 'k');
    if (typing) {
      rect(g, 7, 21, 2, 2, 's');
      rect(g, 15, 21, 2, 2, 's');
      sideArmsTo(g, 21, 3);
      rect(g, 4, 21, 3, 2, '.');
      rect(g, 17, 21, 3, 2, '.');
      rect(g, 6, 20, 2, 1, 'c');
      rect(g, 16, 20, 2, 1, 'c');
    } else {
      sideArmsTo(g, 19, 1);
    }
  }
  function book(g) {
    rect(g, 7, 17, 10, 6, 'B');
    rect(g, 11, 17, 2, 6, 'W');
    hline(g, 8, 10, 18, 'W');
    hline(g, 13, 15, 18, 'W');
    hline(g, 8, 10, 20, 'W');
    hline(g, 13, 15, 20, 'W');
    sideArmsTo(g, 19, 1);
  }

  // ---------- Части-варианты ----------
  const eyeAt = (g, x, y, h = 3, shine = true) => {
    rect(g, x, y, 2, h, 'e');
    if (shine) px(g, x, y, 'i');
  };

  const PARTS = {
    eyes: {
      open: (g) => {
        eyeAt(g, 8, 7);
        eyeAt(g, 14, 7);
      },
      blink: (g) => {
        hline(g, 8, 9, 9, 'e');
        hline(g, 14, 15, 9, 'e');
      },
      left: (g) => {
        eyeAt(g, 7, 7);
        eyeAt(g, 13, 7);
      },
      right: (g) => {
        eyeAt(g, 9, 7);
        eyeAt(g, 15, 7);
      },
      // Глаза-дуги ^^
      happy: (g) => {
        hline(g, 8, 9, 8, 'e');
        hline(g, 14, 15, 8, 'e');
        px(g, 7, 9, 'e');
        px(g, 10, 9, 'e');
        px(g, 13, 9, 'e');
        px(g, 16, 9, 'e');
        hline(g, 6, 7, 10, 'r');
        hline(g, 16, 17, 10, 'r');
        hline(g, 8, 8, 10, 's');
        hline(g, 15, 15, 10, 's');
      },
      // Смотрит вниз, в ноутбук или книгу
      down: (g) => {
        eyeAt(g, 8, 8, 2, false);
        eyeAt(g, 14, 8, 2, false);
        hline(g, 8, 9, 7, 'S'); // веки
        hline(g, 14, 15, 7, 'S');
      },
      // Злой: брови к переносице, прищур, румянец во всю щёку
      angry: (g) => {
        px(g, 7, 6, 'e');
        hline(g, 8, 9, 7, 'e');
        px(g, 10, 8, 'e');
        px(g, 16, 6, 'e');
        hline(g, 14, 15, 7, 'e');
        px(g, 13, 8, 'e');
        eyeAt(g, 8, 8, 2);
        eyeAt(g, 14, 8, 2);
        hline(g, 6, 9, 10, 'r');
        hline(g, 14, 17, 10, 'r');
      },
    },
    mouth: {
      neutral: (g) => hline(g, 11, 12, 11, 'm'),
      talk: (g) => {
        rect(g, 10, 11, 4, 2, 'm');
        hline(g, 11, 12, 12, 't');
      },
      smile: (g) => {
        hline(g, 10, 13, 11, 'm');
        px(g, 9, 10, 'm');
        px(g, 14, 10, 'm');
      },
      worried: (g) => {
        hline(g, 11, 12, 11, 'm');
        px(g, 10, 12, 'm');
        px(g, 13, 12, 'm');
      },
      yawn: (g) => {
        rect(g, 11, 11, 2, 3, 'm');
        px(g, 11, 13, 't');
        px(g, 12, 13, 't');
      },
      shout: (g) => {
        rect(g, 10, 11, 4, 3, 'm');
        hline(g, 11, 12, 13, 't');
      },
      frown: (g) => {
        hline(g, 10, 13, 11, 'm');
        px(g, 9, 12, 'm');
        px(g, 14, 12, 'm');
      },
      // Мат запикан: рот закрыт чёрной цензурной полоской
      censor: (g) => rect(g, 8, 11, 8, 2, 'o'),
    },
    sweat: {
      no: () => {},
      yes: (g) => {
        px(g, 21, 4, 'd');
        rect(g, 20, 5, 2, 2, 'd');
        px(g, 20, 5, 'D');
      },
    },
    arms: {
      down: () => {},
      up: (g) => {
        clearArms(g);
        armUp(g, -1, 2);
        armUp(g, 1, 20);
      },
      // Машет правой рукой (два кадра)
      wave: (g) => {
        clearArms(g);
        armDownOne(g, -1);
        armUp(g, 1, 21);
      },
      wave2: (g) => {
        clearArms(g);
        armDownOne(g, -1);
        armUp(g, 1, 20);
      },
      // Трясёт кулаками (два кадра)
      fist: (g) => {
        clearArms(g);
        fists(g, true);
      },
      fist2: (g) => {
        clearArms(g);
        fists(g, false);
      },
      // Держит ноутбук / печатает
      laptop: (g) => {
        clearArms(g);
        laptop(g, false);
      },
      laptop2: (g) => {
        clearArms(g);
        laptop(g, true);
      },
      book: (g) => {
        clearArms(g);
        book(g);
      },
    },
    legs: {
      stand: () => {},
      // Шаг: ноги врозь
      walkA: (g) => {
        clear(g, 5, 25, 14, 4);
        rect(g, 6, 25, 4, 2, 'p');
        rect(g, 14, 25, 4, 2, 'p');
        rect(g, 6, 25, 1, 2, 'P');
        rect(g, 5, 27, 5, 1, 'b');
        rect(g, 14, 27, 5, 1, 'b');
        hline(g, 5, 9, 28, 'q');
        hline(g, 14, 18, 28, 'q');
      },
      // Шаг: ноги вместе
      walkB: (g) => {
        clear(g, 5, 25, 14, 4);
        rect(g, 9, 25, 6, 2, 'p');
        rect(g, 9, 25, 1, 2, 'P');
        rect(g, 8, 27, 8, 1, 'b');
        hline(g, 8, 15, 28, 'q');
      },
    },
  };

  const ORDER = ['eyes', 'mouth', 'sweat', 'arms', 'legs'];
  const DEFAULTS = { eyes: 'open', mouth: 'neutral', sweat: 'no', arms: 'down', legs: 'stand' };

  // Собрать кадр: frame({ eyes: 'blink', mouth: 'smile', arms: 'up', legs: 'walkA', sweat: 'yes' }) → массив строк
  function frame(opts = {}) {
    const g = canvas();
    body(g);
    for (const key of ORDER) {
      const variant = opts[key] || DEFAULTS[key];
      const draw = PARTS[key][variant];
      if (!draw) throw new Error(`Нет варианта ${key}=${variant}`);
      draw(g);
    }
    return outline(g).map((row) => row.join(''));
  }

  const api = { WIDTH, HEIGHT, HEAD_ROWS, PALETTE, PARTS, frame };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.NazarSprites = api;
})(typeof self !== 'undefined' ? self : this);
