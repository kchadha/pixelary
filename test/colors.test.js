const test = require('node:test');
const assert = require('node:assert/strict');
const { interpretColor } = require('../server/colors');
const { normalizeGuess, hintFor } = require('../server/rooms');
const { WORDS } = require('../server/words');

test('known words are deterministic', () => {
  assert.deepEqual(interpretColor('banana'), { hex: '#ffe135', known: true });
  assert.deepEqual(interpretColor('Banana'), interpretColor('banana'));
  assert.equal(interpretColor('tomato').hex, '#ff6347');
});

test('plurals and -ish endings resolve', () => {
  assert.equal(interpretColor('bananas').hex, '#ffe135');
  assert.equal(interpretColor('cherries').hex, interpretColor('cherry').hex);
  assert.equal(interpretColor('reddish').hex, '#ff0000');
});

test('unknown words get a random color', () => {
  const seq = [0.1, 0.5, 0.5, 0.9, 0.5, 0.5];
  let i = 0;
  const rand = () => seq[i++];
  const a = interpretColor('grumpy', rand);
  const b = interpretColor('grumpy', rand);
  assert.equal(a.known, false);
  assert.match(a.hex, /^#[0-9a-f]{6}$/);
  assert.notEqual(a.hex, b.hex);
});

test('guess matching ignores case, spaces, punctuation and plural s', () => {
  assert.equal(normalizeGuess('Hot-Dog!'), normalizeGuess('hot dog'));
  assert.equal(normalizeGuess('pencil'), normalizeGuess('Pencils'));
  assert.notEqual(normalizeGuess('cat'), normalizeGuess('hat'));
});

test('hint hides letters but keeps spaces and dashes', () => {
  assert.equal(hintFor('T-shirt'), '_-_____');
  assert.equal(hintFor('Hot dog'), '___ ___');
});

test('words.json loads and trims', () => {
  assert.ok(WORDS.easy.length > 50 && WORDS.medium.length > 20 && WORDS.hard.length > 20);
  assert.ok(WORDS.easy.every((w) => w === w.trim()));
});
