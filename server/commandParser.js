// Command parser: "lime square big 13" -> { hex, cells: [...] }
// Grammar (any order, filler words ignored):
//   <color word(s)> [shape] [size] <cells>
// where <cells> is one of:
//   13                      one cell (shape is centered on it)
//   1, 6, 11, 16, 21        a list (each cell painted; stamp shapes are stamped at each)
//   1 to 21  /  1-21        a straight line from one cell to the other
const { interpretColor, isKnownColor } = require('./colors');

const GRID_SIZE = 8; // default; rooms pass their own size (8 or 16)

const FILLER = new Set([
  'in', 'at', 'on', 'cell', 'cells', 'the', 'a', 'an', 'of', 'number', 'numbers', 'no', 'num', 'please',
  'and', 'with', 'centered', 'center', 'around', 'position', 'shape', 'size', 'from', 'between', 'then',
]);

const SHAPES = {
  dot: 'dot', dots: 'dot', pixel: 'dot', pixels: 'dot', point: 'dot', spot: 'dot',
  square: 'square', block: 'square',
  box: 'box', frame: 'box', outline: 'box', border: 'box',
  circle: 'circle', ball: 'circle', disc: 'circle', disk: 'circle', blob: 'circle',
  ring: 'ring', donut: 'ring', hoop: 'ring', o: 'ring',
  plus: 'plus', cross: 'plus',
  x: 'x', ex: 'x',
  line: 'line', lines: 'line', horizontal: 'line', dash: 'line',
  row: 'row', rows: 'row',
  column: 'column', columns: 'column', col: 'column', cols: 'column', vertical: 'column', pole: 'column', stick: 'column',
  diamond: 'diamond',
  triangle: 'triangle',
};
// Shapes that just mean "paint these cells" when given a list of cells.
const PLAIN_SHAPES = new Set(['dot', 'line', 'row', 'column']);

const SIZES = {
  // value = width/height in cells. A number also works: "square 3 50" or "square 3x3 50".
  small: 3, tiny: 3, little: 3, mini: 3,
  medium: 5, big: 5, large: 5,
  huge: 9, giant: 9, massive: 9, // handy on 16x16
};

// Color words that remove paint instead of adding it.
const ERASE_WORDS = new Set(['clear', 'erase', 'eraser', 'empty', 'blank', 'none', 'nothing', 'remove', 'delete', 'transparent']);
const WHOLE_GRID = new Set(['all', 'everything', 'grid', 'board', 'canvas', 'whole', 'background', 'entire']);

const RANGE_WORDS =new Set(['to', 'through', 'thru', 'till', 'until', 'til']);

const UNITS = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9,
  tenth: 10, eleventh: 11, twelfth: 12, thirteenth: 13, fourteenth: 14, fifteenth: 15,
  sixteenth: 16, seventeenth: 17, eighteenth: 18, nineteenth: 19, twentieth: 20,
};
// Speech-to-text homophones, only used as a last resort when there are no real numbers.
const HOMOPHONES = { to: 2, too: 2, for: 4, won: 1, ate: 8 };

function parseNumberToken(tok) {
  if (tok === undefined) return null;
  const digits = tok.match(/^#?(\d+)(st|nd|rd|th)?$/);
  if (digits) return parseInt(digits[1], 10);
  if (tok in UNITS) return UNITS[tok];
  const m = tok.match(/^twenty-?(one|two|three|four|five|first|second|third|fourth|fifth)$/);
  if (m) return 20 + UNITS[m[1]];
  return null;
}

function tokenize(text) {
  const tokens = String(text || '')
    .toLowerCase()
    .replace(/(\d)\s*[-–]\s*(\d)/g, '$1 to $2') // "1-21" -> "1 to 21"
    .replace(/,/g, ' , ') // keep commas: "plus 7, 19" is a list, "square 3 50" is size 3 at 50
    .replace(/[^a-z0-9#,\s-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  // Merge "twenty five" -> "twenty-five" for speech input.
  for (let i = 0; i < tokens.length - 1; i++) {
    if (tokens[i] === 'twenty' && /^(one|two|three|four|five|first|second|third|fourth|fifth)$/.test(tokens[i + 1])) {
      tokens.splice(i, 2, `twenty-${tokens[i + 1]}`);
    }
  }
  return tokens;
}

// Pixel-art disc: a slightly generous radius so small circles look round, not square.
const inDisc = (dr, dc, R) => dr * dr + dc * dc <= R * R + 0.5 * R;

/**
 * Cells (row-major indices) for a shape `span` cells wide centered at (row, col).
 * Odd spans are centered exactly; even spans lean right/down by half a cell.
 * Anything past the grid edge is dropped — shapes never wrap to the other side.
 */
function shapeCells(shape, span, row, col, size = GRID_SIZE) {
  const N = shape === 'dot' ? 1 : span;
  const lo = -Math.floor((N - 1) / 2), hi = lo + N - 1;
  const c = (lo + hi) / 2; // 0 for odd spans, 0.5 for even
  const R = (N - 1) / 2;
  const cells = [];
  for (let dr = lo; dr <= hi; dr++) {
    for (let dc = lo; dc <= hi; dc++) {
      const u = dr - c, v = dc - c; // offset from the true center
      const au = Math.abs(u), av = Math.abs(v);
      let on = false;
      switch (shape) {
        case 'dot': on = true; break;
        case 'square': on = true; break;
        case 'box': on = Math.max(au, av) === R; break;
        case 'circle': on = inDisc(u, v, R); break;
        // ring = edge of the disc: inside it, but touching a cell that's outside
        case 'ring': on = inDisc(u, v, R) && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, b]) => !inDisc(u + a, v + b, R)); break;
        case 'plus': on = au < 0.75 || av < 0.75; break;
        case 'x': on = Math.abs(au - av) < 0.25; break;
        case 'line': case 'row': on = dr === 0; break;
        case 'column': on = dc === 0; break;
        case 'diamond': on = au + av === (N % 2 ? R : R + 0.5); break;
        case 'triangle': on = av <= Math.floor((u + R) / 2) + c; break;
        default: on = dr === 0 && dc === 0;
      }
      if (!on) continue;
      const rr = row + dr, cc = col + dc;
      if (rr < 0 || cc < 0 || rr >= size || cc >= size) continue; // clip at the edge
      cells.push(rr * size + cc);
    }
  }
  return cells;
}

/** Straight line of cells between two cell indices (Bresenham). */
function lineBetween(a, b, size = GRID_SIZE) {
  let [r0, c0] = [Math.floor(a / size), a % size];
  const [r1, c1] = [Math.floor(b / size), b % size];
  const dr = Math.abs(r1 - r0), dc = Math.abs(c1 - c0);
  const sr = r0 < r1 ? 1 : -1, sc = c0 < c1 ? 1 : -1;
  let err = dc - dr;
  const cells = [];
  for (;;) {
    cells.push(r0 * size + c0);
    if (r0 === r1 && c0 === c1) break;
    const e2 = 2 * err;
    if (e2 > -dr) { err -= dr; c0 += sc; }
    if (e2 < dc) { err += dc; r0 += sr; }
  }
  return cells;
}

/**
 * Parse a drawing command.
 * @returns {{ok:true, hex, colorWord, known, shape, sizeWord, cell, cells}|{ok:false, error}}
 */
function parseCommand(text, { gridSize = GRID_SIZE, rand = Math.random } = {}) {
  const tokens = tokenize(text);
  if (!tokens.length) return fail('Type something like "red 13" or "lime square big 7".');

  let shape = null, sizeWord = null, span = null;
  const groups = []; // { a, b? } cell numbers (1-based); b set for ranges
  const leftovers = []; // { tok, index }
  let pendingRange = false;
  const isNum = (t) => parseNumberToken(t) !== null;

  for (const [index, tok] of tokens.entries()) {
    if (tok === ',') continue;

    // Explicit size: "3x3"
    const dims = tok.match(/^(\d+)x(\d+)$/);
    if (dims && span === null) { span = parseInt(dims[1], 10); sizeWord = tok; continue; }

    const n = parseNumberToken(tok);
    // A number right after a shape word (or "size") with exactly one more number after it,
    // and no comma/range in between, is a size: "beige square 3 50".
    const prev = tokens[index - 1], next = tokens[index + 1];
    if (n !== null && span === null && !sizeWord && (SHAPES[prev] || prev === 'size') &&
        next !== ',' && !RANGE_WORDS.has(next) && tokens.slice(index + 1).filter(isNum).length === 1) {
      span = n;
      sizeWord = String(n);
      continue;
    }
    if (n !== null) {
      if (pendingRange && groups.length) groups[groups.length - 1].b = n;
      else groups.push({ a: n });
      pendingRange = false;
      continue;
    }
    // "to"/"through" between two numbers makes a range.
    if (RANGE_WORDS.has(tok) && parseNumberToken(tokens[index - 1]) !== null && parseNumberToken(tokens[index + 1]) !== null) {
      pendingRange = true;
      continue;
    }
    if (SIZES[tok] && !sizeWord) { sizeWord = tok; span = SIZES[tok]; continue; }
    // Shape words win unless the word is also a color and we have no color yet.
    if (SHAPES[tok] && (leftovers.length > 0 || !isKnownColor(tok))) {
      // Only the first shape counts ("black line col 1 to 21" is still a line).
      if (!shape) shape = SHAPES[tok];
      continue;
    }
    if (FILLER.has(tok)) continue;
    leftovers.push({ tok, index });
  }

  // Speech homophones ("red square for") as a last resort.
  if (!groups.length && leftovers.length > 1) {
    const last = leftovers[leftovers.length - 1];
    if (last.tok in HOMOPHONES) { groups.push({ a: HOMOPHONES[last.tok] }); leftovers.pop(); }
  }
  const words = leftovers.filter((l) => !(l.tok in HOMOPHONES) || leftovers.length === 1);

  const max = gridSize * gridSize;
  // "all"/"everything"/"background"… means the whole grid: "blue all", "clear all".
  const fillAll = words.some((w) => WHOLE_GRID.has(w.tok));
  const colorWords = words.filter((w) => !WHOLE_GRID.has(w.tok));
  if (!colorWords.length) return fail('Start with a color word, e.g. "banana 13" or "blue all".');

  // Color: try two adjacent words as one ("sky blue", "hot pink"), else first word.
  // "clear" (or erase/empty/…) removes color instead of painting.
  const erase = ERASE_WORDS.has(colorWords[0].tok);
  let colorWord = colorWords[0].tok;
  if (!erase && colorWords.length > 1 && colorWords[1].index === colorWords[0].index + 1 && isKnownColor(colorWords[0].tok + colorWords[1].tok)) {
    colorWord = colorWords[0].tok + ' ' + colorWords[1].tok;
  }
  const { hex, known } = erase ? { hex: null, known: true } : interpretColor(colorWord.replace(' ', ''), rand);

  if (fillAll && !groups.length) {
    return { ok: true, hex, erase, colorWord, known, shape: 'all', sizeWord: null, cell: null, cells: Array.from({ length: max }, (_, i) => i) };
  }

  if (!groups.length) return fail(`Which cell? Add a number 1-${max}, e.g. "${colorWord} 13", or "${colorWord} all" to fill the grid.`);
  const bad = groups.flatMap((g) => [g.a, g.b]).find((n) => n !== undefined && (n < 1 || n > max));
  if (bad !== undefined) return fail(`Cell ${bad} is off the grid — use 1-${max}.`);

  const finalShape = shape || 'dot';
  const finalSpan = span || 3; // default: small (3x3)
  if (finalSpan < 1 || finalSpan > gridSize) {
    return fail(`Size ${finalSpan} won't fit — pick 1 to ${gridSize} (or small, big, huge).`);
  }
  const at = (i) => [Math.floor(i / gridSize), i % gridSize];
  const cells = new Set();
  const add = (list) => list.forEach((c) => cells.add(c));

  for (const g of groups) {
    const a = g.a - 1;
    if (g.b !== undefined) {
      add(lineBetween(a, g.b - 1, gridSize));
    } else if (groups.length > 1) {
      // A list of cells: paint each one, or stamp a real shape at each.
      add(PLAIN_SHAPES.has(finalShape) ? [a] : shapeCells(finalShape, finalSpan, ...at(a), gridSize));
    } else if (finalShape === 'row' && !sizeWord) {
      const row = at(a)[0];
      add(Array.from({ length: gridSize }, (_, c) => row * gridSize + c));
    } else if (finalShape === 'column' && !sizeWord) {
      const col = at(a)[1];
      add(Array.from({ length: gridSize }, (_, rr) => rr * gridSize + col));
    } else {
      add(shapeCells(finalShape, finalSpan, ...at(a), gridSize));
    }
  }

  return {
    ok: true, hex, erase, colorWord, known, shape: finalShape, sizeWord, cell: groups[0].a,
    cells: [...cells].sort((x, y) => x - y),
  };
}

function fail(error) {
  return { ok: false, error };
}

module.exports = { parseCommand, shapeCells, lineBetween, GRID_SIZE, SHAPES, SIZES };
