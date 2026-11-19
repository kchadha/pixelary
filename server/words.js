// Random word generator backed by words.json.
const path = require('path');
const fs = require('fs');

function loadWords(file = path.join(__dirname, '..', 'words.json')) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const lists = {};
  for (const [difficulty, words] of Object.entries(raw)) {
    if (!Array.isArray(words)) continue;
    const seen = new Set();
    const clean = [];
    for (const w of words) {
      const t = String(w).trim().replace(/\s+/g, ' ');
      const key = t.toLowerCase();
      if (t && !seen.has(key)) { seen.add(key); clean.push(t); }
    }
    if (clean.length) lists[difficulty] = clean;
  }
  return lists;
}

const WORDS = loadWords();

/**
 * Pick a word not in `used` (a Set of lowercase words). Resets if exhausted.
 * difficulty: 'easy' | 'medium' | 'hard' | 'mix' (all lists combined).
 */
function pickWord(used, difficulty = 'easy', rand = Math.random) {
  const pool = (difficulty !== 'mix' && WORDS[difficulty]) || Object.values(WORDS).flat();
  if (!pool.length) return 'Mystery';
  let options = pool.filter((w) => !used.has(w.toLowerCase()));
  if (!options.length) { used.clear(); options = pool; }
  const word = options[Math.floor(rand() * options.length)];
  used.add(word.toLowerCase());
  return word;
}

module.exports = { pickWord, loadWords, WORDS };
