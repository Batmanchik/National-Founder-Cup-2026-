const test = require('node:test');
const assert = require('node:assert');
const { classify } = require('../src/main/classifier');

const goal = 'Дописать курсовую по физике';

test('рилсы — отвлечение', () => {
  assert.strictEqual(classify({ app: 'chrome', title: 'Reels • Instagram' }, goal).category, 'distraction');
});
test('VS Code — фокус', () => {
  assert.strictEqual(classify({ app: 'Code', title: 'index.js — Visual Studio Code' }, goal).category, 'focus');
});
test('заголовок со словом из цели — фокус, даже если это YouTube', () => {
  const v = classify({ app: 'chrome', title: 'Лекция по физике: механика - YouTube' }, goal);
  assert.strictEqual(v.category, 'focus');
});
test('обычный YouTube — неуверенно, решает ИИ', () => {
  const v = classify({ app: 'chrome', title: 'Смешные коты - YouTube' }, goal);
  assert.strictEqual(v.category, 'neutral');
  assert.strictEqual(v.soft, true);
});
test('слово password не считается Word', () => {
  assert.notStrictEqual(classify({ app: 'keepass', title: 'password manager' }, '').label, 'Документы');
});

test('dropbox.com и «Java threads» — не соцсети', () => {
  assert.notStrictEqual(classify({ app: 'chrome', title: 'Files - dropbox.com' }, '').label, 'Соцсети');
  assert.notStrictEqual(classify({ app: 'chrome', title: 'Java threads tutorial' }, '').label, 'Соцсети');
  assert.strictEqual(classify({ app: 'chrome', title: 'Home / X', url: 'https://x.com/home' }, '').label, 'Соцсети');
});
test('цель про Instagram не делает ленту фокусом — решает ИИ', () => {
  const v = classify({ app: 'chrome', title: 'Reels • Instagram' }, 'Пост для instagram магазина');
  assert.strictEqual(v.category, 'neutral');
  assert.strictEqual(v.soft, true);
});
test('общие слова цели не дают ложный фокус', () => {
  const v = classify({ app: 'chrome', title: 'Как сделать пиццу - Яндекс' }, 'Сделать презентацию');
  assert.notStrictEqual(v.category, 'focus');
});
test('свой список отвлечений важнее слова из цели', () => {
  const v = classify({ app: 'chrome', title: 'Физика приколы - pikabu' }, goal, { distract: ['приколы'] });
  assert.strictEqual(v.category, 'distraction');
});
