// Пиксельный спрайт ментора «Акыл».
// Спрайт 16x19 пикселей описан строками: каждый символ = цвет из PALETTE ('.' = прозрачный).
// Кадры собираются из базового тела + «накладок» (глаза, рот, руки, ноги),
// поэтому новые эмоции добавляются заменой 1–3 строк.
// Файл работает и в Node (main-процесс, тесты), и в браузере (renderer).
(function (root) {
  'use strict';

  const WIDTH = 16;
  const HEIGHT = 19;

  const PALETTE = {
    o: '#1a1c2c', // контур
    h: '#3b2a26', // волосы
    s: '#f4c7a1', // кожа
    S: '#d9a07a', // тень кожи
    e: '#1a1c2c', // глаза
    r: '#f08f8f', // румянец
    m: '#8c3a3a', // рот
    c: '#2ec4b6', // худи
    C: '#1d8a80', // тень худи
    y: '#ffd166', // логотип на худи
    p: '#3b4a7a', // штаны
    b: '#22223b', // кеды
    d: '#6ec6ff', // капля пота
  };

  // R('2.', 'o', '10c') -> '..occcccccccccc': число перед символом = сколько раз повторить.
  function R(...parts) {
    return parts
      .map((p) => {
        const m = /^(\d+)(.)$/.exec(p);
        return m ? m[2].repeat(Number(m[1])) : p;
      })
      .join('');
  }

  const BASE = [
    R('4.', '8o', '4.'), // 0  макушка
    R('3.', 'o', '8h', 'o', '3.'), // 1
    R('2.', 'o', '10h', 'o', '2.'), // 2
    R('2.', 'o', '10h', 'o', '2.'), // 3
    R('2.', 'o', 'h', '8s', 'h', 'o', '2.'), // 4  лоб
    R('2.', 'o', '2s', 'e', '4s', 'e', '2s', 'o', '2.'), // 5  глаза
    R('2.', 'o', '2s', 'e', '4s', 'e', '2s', 'o', '2.'), // 6  глаза
    R('2.', 'o', 's', 'r', '6s', 'r', 's', 'o', '2.'), // 7  щёки
    R('2.', 'o', '4s', '2m', '4s', 'o', '2.'), // 8  рот
    R('3.', 'o', '8S', 'o', '3.'), // 9  подбородок
    R('2.', 'o', '10c', 'o', '2.'), // 10 воротник
    R('.', 'o', '12c', 'o', '.'), // 11 плечи
    R('.', 'o', 'c', 'C', '8c', 'C', 'c', 'o', '.'), // 12
    R('.', 'o', 'c', 'C', '2c', '4y', '2c', 'C', 'c', 'o', '.'), // 13 логотип
    R('.', 'o', 's', 'C', '8c', 'C', 's', 'o', '.'), // 14 кисти
    R('2.', 'o', 'C', '8c', 'C', 'o', '2.'), // 15
    R('3.', 'o', '8p', 'o', '3.'), // 16 штаны
    R('3.', 'o', '3p', '2o', '3p', 'o', '3.'), // 17 ноги
    R('2.', 'o', '3b', 'o', '2.', 'o', '3b', 'o', '2.'), // 18 кеды
  ];

  const PARTS = {
    eyes: {
      open: {},
      blink: {
        5: R('2.', 'o', '10s', 'o', '2.'),
        6: R('2.', 'o', '2s', '2e', '2s', '2e', '2s', 'o', '2.'),
      },
    },
    mouth: {
      neutral: {},
      talk: {
        8: R('2.', 'o', '4s', '2m', '4s', 'o', '2.'),
        9: R('3.', 'o', '3S', '2m', '3S', 'o', '3.'),
      },
      smile: {
        7: R('2.', 'o', 's', 'r', 'm', '4s', 'm', 'r', 's', 'o', '2.'),
        8: R('2.', 'o', '3s', '4m', '3s', 'o', '2.'),
      },
      worried: {
        8: R('2.', 'o', '3s', 'm', '2s', 'm', '3s', 'o', '2.'),
      },
    },
    sweat: {
      no: {},
      yes: { 3: R('2.', 'o', '10h', 'o', 'd', '.') },
    },
    arms: {
      down: {},
      up: {
        9: R('s', '2.', 'o', '8S', 'o', '2.', 's'),
        10: R('.', 'c', 'o', '10c', 'o', 'c', '.'),
        14: R('.', 'o', 'c', 'C', '8c', 'C', 'c', 'o', '.'),
      },
    },
    legs: {
      stand: {},
      walkA: {
        17: R('2.', 'o', '2p', 'o', '4.', 'o', '2p', 'o', '2.'),
        18: R('.', 'o', '3b', 'o', '4.', 'o', '3b', 'o', '.'),
      },
      walkB: {
        17: R('4.', 'o', '6p', 'o', '4.'),
        18: R('4.', 'o', '6b', 'o', '4.'),
      },
    },
  };

  // Собрать кадр: frame({ eyes: 'blink', mouth: 'smile', arms: 'up', legs: 'walkA', sweat: 'yes' })
  function frame(opts = {}) {
    const rows = BASE.slice();
    const order = ['eyes', 'mouth', 'sweat', 'arms', 'legs'];
    const defaults = { eyes: 'open', mouth: 'neutral', sweat: 'no', arms: 'down', legs: 'stand' };
    for (const key of order) {
      const variant = opts[key] || defaults[key];
      const patch = PARTS[key][variant];
      if (!patch) throw new Error(`Нет варианта ${key}=${variant}`);
      for (const idx of Object.keys(patch)) rows[Number(idx)] = patch[idx];
    }
    return rows;
  }

  const api = { WIDTH, HEIGHT, PALETTE, BASE, PARTS, frame, R };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.NazarSprites = api;
})(typeof self !== 'undefined' ? self : this);
