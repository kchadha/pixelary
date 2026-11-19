const test = require('node:test');
const assert = require('node:assert/strict');
const { parseCommand } = require('../server/commandParser');

// Most tests use a small 5x5 grid so expected cells are easy to read.
const p = (text) => parseCommand(text, { gridSize: 5 });

test('single color + cell paints one pixel', () => {
  const r = p('red 1');
  assert.equal(r.ok, true);
  assert.equal(r.hex, '#ff0000');
  assert.deepEqual(r.cells, [0]);
});

test('big square centered in the middle fills the whole 5x5 grid', () => {
  const r = p('lime square big 13');
  assert.equal(r.ok, true);
  assert.equal(r.hex, '#00ff00');
  assert.equal(r.cells.length, 25);
});

test('small square is 3x3', () => {
  assert.deepEqual(p('blue square 7').cells, [0, 1, 2, 5, 6, 7, 10, 11, 12]);
});

test('shapes clip at the edge', () => {
  // small ring around cell 25 (bottom-right): only up + left neighbors remain
  assert.deepEqual(p('blue ring small 25').cells, [19, 23]);
  // small filled circle there also keeps its center
  assert.deepEqual(p('blue circle small 25').cells, [19, 23, 24]);
});

test('circle is filled and round', () => {
  assert.deepEqual(p('pink circle 13').cells, [7, 11, 12, 13, 17]); // small = plus-shaped blob
  const big = p('pink circle big 13').cells;
  assert.equal(big.length, 21); // 5x5 minus the 4 corners
  assert.ok(big.includes(12) && !big.includes(0));
});

test('ring is the outline of a circle', () => {
  const r = p('pink ring big 13');
  assert.equal(r.cells.length, 12);
  assert.ok(!r.cells.includes(12)); // center empty
  assert.ok(!r.cells.includes(0)); // corner empty
  assert.deepEqual(p('pink donut 13').cells, [7, 11, 13, 17]);
});

test('default grid is 8x8', () => {
  const r = parseCommand('red 64');
  assert.equal(r.ok, true);
  assert.deepEqual(r.cells, [63]);
  assert.equal(parseCommand('red 65').ok, false);
  assert.deepEqual(parseCommand('red row 9').cells, [8, 9, 10, 11, 12, 13, 14, 15]);
  assert.deepEqual(parseCommand('red 1 to 57').cells, [0, 8, 16, 24, 32, 40, 48, 56]);
});

test('16x16 grid accepts cells up to 256 and huge shapes', () => {
  const big = { gridSize: 16 };
  assert.deepEqual(parseCommand('red 256', big).cells, [255]);
  assert.equal(parseCommand('red 257', big).ok, false);
  assert.equal(parseCommand('blue square huge 120', big).cells.length, 81); // 9x9
  assert.equal(parseCommand('green col 1', big).cells.length, 16);
});

test('filler words and "in cell" are ignored', () => {
  const r = p('lime square in cell 13');
  assert.equal(r.ok, true);
  assert.equal(r.cells.length, 9);
});

test('words in any order', () => {
  assert.deepEqual(p('13 big green line').cells, [10, 11, 12, 13, 14]);
});

test('spoken numbers work', () => {
  assert.equal(p('red dot thirteen').cell, 13);
  assert.equal(p('red dot twenty five').cell, 25);
  assert.equal(p('red square for').cell, 4);
});

test('two-word colors', () => {
  const r = p('sky blue 3');
  assert.equal(r.hex, '#87ceeb');
  assert.equal(r.colorWord, 'sky blue');
});

test('a list of cells paints exactly those cells', () => {
  const r = p('black line cells 1, 6, 11, 16, 21');
  assert.equal(r.ok, true);
  assert.equal(r.hex, '#000000');
  assert.deepEqual(r.cells, [0, 5, 10, 15, 20]);
  assert.deepEqual(p('red 1 3 5').cells, [0, 2, 4]);
  assert.deepEqual(p('red 1 and 25').cells, [0, 24]);
});

test('a range draws a straight line between two cells', () => {
  assert.deepEqual(p('black line col 1 to 21').cells, [0, 5, 10, 15, 20]);
  assert.deepEqual(p('black 1-5').cells, [0, 1, 2, 3, 4]);
  assert.deepEqual(p('blue 1 through 25').cells, [0, 6, 12, 18, 24]); // diagonal
  assert.deepEqual(p('red one to five').cells, [0, 1, 2, 3, 4]);
});

test('row / column / col on one cell fill the whole row or column', () => {
  assert.deepEqual(p('green row 13').cells, [10, 11, 12, 13, 14]);
  assert.deepEqual(p('green col 3').cells, [2, 7, 12, 17, 22]);
  assert.deepEqual(p('green column 23').cells, [2, 7, 12, 17, 22]);
  // with a size it's a centered segment instead
  assert.deepEqual(p('green column small 13').cells, [7, 12, 17]);
});

test('stamp shapes are stamped at each cell of a list', () => {
  assert.deepEqual(p('pink plus 7, 19').cells, [1, 5, 6, 7, 11, 13, 17, 18, 19, 23]);
});

test('ranges and lists can mix', () => {
  assert.deepEqual(p('black 1 to 5, 25').cells, [0, 1, 2, 3, 4, 24]);
});

test('any off-grid cell in a list is an error', () => {
  assert.equal(p('red 1, 30').ok, false);
  assert.equal(p('red 1 to 26').ok, false);
});

test('missing cell is an error with a hint', () => {
  const r = p('lime square big');
  assert.equal(r.ok, false);
  assert.match(r.error, /1-25/);
});

test('cell out of range is an error', () => {
  assert.equal(p('red 26').ok, false);
});

test('missing color is an error', () => {
  assert.equal(p('square 13').ok, false);
});

test('unknown color word still paints with a random color', () => {
  const r = p('grumpy 5');
  assert.equal(r.ok, true);
  assert.equal(r.known, false);
  assert.match(r.hex, /^#[0-9a-f]{6}$/);
});

test('"clear" erases cells instead of painting', () => {
  const r = p('clear 13');
  assert.equal(r.ok, true);
  assert.equal(r.hex, null);
  assert.equal(r.erase, true);
  assert.deepEqual(r.cells, [12]);
  assert.deepEqual(p('erase row 13').cells, [10, 11, 12, 13, 14]);
  assert.deepEqual(p('clear 1 to 3').cells, [0, 1, 2]);
});

test('"clear all" wipes the whole grid', () => {
  assert.equal(p('clear all').cells.length, 25);
  assert.equal(parseCommand('clear everything').cells.length, 64);
  assert.equal(p('clear').ok, false); // still needs cells or "all"
});

test('a number after the shape is its size: "beige square 3 50"', () => {
  const r = parseCommand('beige square 3 50'); // 8x8: cell 50 = row 6, col 1
  assert.equal(r.ok, true);
  assert.equal(r.hex, '#f5f5dc');
  assert.deepEqual(r.cells, [40, 41, 42, 48, 49, 50, 56, 57, 58]);
  assert.deepEqual(parseCommand('beige square 3x3 50').cells, r.cells);
  assert.deepEqual(parseCommand('beige square size 3 50').cells, r.cells);
  assert.equal(parseCommand('red square 4 28').cells.length, 16);
  assert.equal(parseCommand('red square 1 28').cells.length, 1);
  assert.equal(parseCommand('red square 9 28').ok, false); // bigger than 8x8
  assert.equal(parseCommand('red square 16 120', { gridSize: 16 }).cells.length, 256); // fills the grid
  assert.equal(parseCommand('red square 16 1', { gridSize: 16 }).cells.length, 81); // corner: clipped to 9x9
});

test('commas still make a list of cells', () => {
  assert.deepEqual(p('pink plus 7, 19').cells, [1, 5, 6, 7, 11, 13, 17, 18, 19, 23]);
  assert.deepEqual(p('red 1, 3, 5').cells, [0, 2, 4]);
  assert.deepEqual(p('black line 1 to 5').cells, [0, 1, 2, 3, 4]); // range, not size 1
});

test('shapes are clipped at the edge and never wrap to the other side', () => {
  // big square on the top-right corner of 8x8 stays in the corner
  assert.deepEqual(parseCommand('red square big 8').cells, [5, 6, 7, 13, 14, 15, 21, 22, 23]);
  // left edge: nothing spills into the previous row's right side
  assert.deepEqual(parseCommand('red square 3 9').cells, [0, 1, 8, 9, 16, 17]);

  // Exhaustive: every shape, size and cell stays near its center on both grids.
  const shapes = ['dot', 'square', 'box', 'circle', 'ring', 'plus', 'x', 'line', 'row', 'col', 'diamond', 'triangle'];
  for (const gridSize of [8, 9, 16, 17]) {
    for (const shape of shapes) {
      for (const size of [2, 3, 4, 5, 9]) {
        if (size > gridSize) continue;
        for (let cell = 1; cell <= gridSize * gridSize; cell++) {
          const r = parseCommand(`red ${shape} ${size}x${size} ${cell}`, { gridSize });
          const cr = Math.floor((cell - 1) / gridSize), cc = (cell - 1) % gridSize;
          for (const i of r.cells) {
            const dr = Math.abs(Math.floor(i / gridSize) - cr), dc = Math.abs((i % gridSize) - cc);
            assert.ok(dr <= size && dc <= size, `${shape} ${size} @${cell} on ${gridSize} wrapped to ${i + 1}`);
          }
        }
      }
    }
  }
});

test('"<color> all" fills the whole grid', () => {
  const r = parseCommand('blue all');
  assert.equal(r.ok, true);
  assert.equal(r.hex, '#0000ff');
  assert.equal(r.cells.length, 64);
  assert.deepEqual(parseCommand('all blue').cells, r.cells);
  assert.equal(parseCommand('sky blue background').hex, '#87ceeb');
  assert.equal(parseCommand('blue everything', { gridSize: 17 }).cells.length, 289);
  assert.equal(parseCommand('clear all').hex, null);
  assert.equal(parseCommand('all').ok, false); // still needs a color
  assert.deepEqual(parseCommand('blue all 5').cells, [4]); // a cell number wins
});

test('odd grids (9x9, 17x17) have a true center', () => {
  const nine = { gridSize: 9 };
  assert.deepEqual(parseCommand('red 81', nine).cells, [80]);
  assert.equal(parseCommand('red 82', nine).ok, false);
  // big square on center cell 41 sits exactly in the middle: 2 empty columns each side
  const cols = parseCommand('red square big 41', nine).cells.map((i) => i % 9);
  assert.equal(Math.min(...cols), 2);
  assert.equal(Math.max(...cols), 6);
  assert.equal(parseCommand('red square 17 145', { gridSize: 17 }).cells.length, 289); // center of 17x17
});
