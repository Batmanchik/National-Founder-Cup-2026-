const test = require('node:test');
const assert = require('node:assert');
const S = require('../src/shared/sprites');

test('все строки спрайта одной ширины и цвета есть в палитре', () => {
  const combos = [];
  for (const eyes of Object.keys(S.PARTS.eyes))
    for (const mouth of Object.keys(S.PARTS.mouth))
      for (const arms of Object.keys(S.PARTS.arms))
        for (const legs of Object.keys(S.PARTS.legs))
          for (const sweat of Object.keys(S.PARTS.sweat)) combos.push({ eyes, mouth, arms, legs, sweat });
  for (const c of combos) {
    const rows = S.frame(c);
    assert.strictEqual(rows.length, S.HEIGHT);
    rows.forEach((r, i) => {
      assert.strictEqual(r.length, S.WIDTH, `строка ${i} в ${JSON.stringify(c)}: "${r}"`);
      for (const ch of r) assert.ok(ch === '.' || S.PALETTE[ch], `нет цвета для "${ch}"`);
    });
  }
});
