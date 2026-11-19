// Room + game state machine. All state lives in memory.
const { parseCommand } = require('./commandParser');
const { pickWord } = require('./words');

const AVATARS = ['🐸', '🦄', '🍕', '🐙', '🦖', '🌮', '🐝', '🍩', '🦊', '🐧', '🍉', '👾', '🦀', '🌈', '🐼', '🍄'];
const REVEAL_MS = 10_000;
const DISCONNECT_GRACE_MS = 45_000;
const LOBBY_GRACE_MS = 5_000;
const MAX_PLAYERS = 12;
const MAX_FEED = 60;
const MAX_LOG = 40;

const DEFAULT_SETTINGS = { rounds: 2, turnTime: 75, difficulty: 'easy', gridSize: 8 };
const ALLOWED = { rounds: [1, 2, 3, 4, 5], turnTime: [45, 60, 75, 90, 120], difficulty: ['easy', 'medium', 'hard', 'mix'], gridSize: [8, 9, 16, 17] };

const rooms = new Map();

function makeCode() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let code;
  do {
    code = Array.from({ length: 4 }, () => letters[Math.floor(Math.random() * letters.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function cleanName(name) {
  const n = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 16);
  return n || 'Mystery Guest';
}

/** Normalize guesses + answers: "Hot-Dog!" -> "hotdog", trailing plural s ignored. */
function normalizeGuess(text) {
  return String(text || '').toLowerCase().replace(/[^a-z0-9]/g, '').replace(/s$/, '');
}

function hintFor(word) {
  return word.replace(/[A-Za-z0-9]/g, '_');
}

class Room {
  constructor(io, code) {
    this.io = io;
    this.code = code;
    this.players = new Map(); // playerId -> player
    this.order = []; // playerIds in join order
    this.hostId = null;
    this.settings = { ...DEFAULT_SETTINGS };
    this.phase = 'lobby'; // lobby | drawing | reveal | results
    this.feed = [];
    this.usedWords = new Set();
    this.game = null;
    this.timer = null;
  }

  // ---------- players ----------
  addPlayer(playerId, socketId, name) {
    let p = this.players.get(playerId);
    if (p) {
      p.socketId = socketId;
      p.connected = true;
      p.name = cleanName(name) || p.name;
      clearTimeout(p.dropTimer);
      return p;
    }
    if (this.players.size >= MAX_PLAYERS) return { error: 'This room is full.' };
    const used = new Set([...this.players.values()].map((x) => x.avatar));
    const avatar = AVATARS.find((a) => !used.has(a)) || AVATARS[this.players.size % AVATARS.length];
    p = { id: playerId, socketId, name: cleanName(name), avatar, ready: false, score: 0, connected: true, dropTimer: null };
    this.players.set(playerId, p);
    this.order.push(playerId);
    if (!this.hostId) this.hostId = playerId;
    if (this.phase !== 'lobby') p.ready = true;
    this.system(`${p.avatar} ${p.name} joined the chaos`);
    return p;
  }

  disconnect(playerId) {
    const p = this.players.get(playerId);
    if (!p) return;
    p.connected = false;
    clearTimeout(p.dropTimer);
    // Short grace in the lobby (survives a page refresh), longer mid-game.
    const grace = this.phase === 'lobby' ? LOBBY_GRACE_MS : DISCONNECT_GRACE_MS;
    p.dropTimer = setTimeout(() => this.removePlayer(playerId), grace);
    if (this.game && this.game.drawerId === playerId && this.phase === 'drawing') {
      this.system(`${p.name} (the drawer) vanished! Skipping…`);
      this.endTurn();
      return;
    }
    this.checkEnoughPlayers() && this.checkAllGuessed();
    this.broadcast();
  }

  removePlayer(playerId) {
    const p = this.players.get(playerId);
    if (!p) return;
    clearTimeout(p.dropTimer);
    this.players.delete(playerId);
    this.order = this.order.filter((id) => id !== playerId);
    this.system(`${p.name} left`);
    if (this.hostId === playerId) {
      const next = this.order.find((id) => this.players.get(id).connected) || this.order[0];
      this.hostId = next || null;
      if (next) this.system(`👑 ${this.players.get(next).name} is the new host`);
    }
    if (this.players.size === 0) return this.destroy();
    if (this.game && this.game.drawerId === playerId && this.phase === 'drawing') return this.endTurn();
    if (this.checkEnoughPlayers()) this.checkAllGuessed();
    this.broadcast();
  }

  connectedPlayers() {
    return this.order.map((id) => this.players.get(id)).filter((p) => p && p.connected);
  }

  /** Returns false (and returns to lobby) if a running game drops below 2 players. */
  checkEnoughPlayers() {
    if (this.phase === 'lobby' || this.phase === 'results') return true;
    if (this.connectedPlayers().length >= 2) return true;
    this.system('Not enough players left — back to the lobby!');
    this.toLobby();
    return false;
  }

  destroy() {
    clearTimeout(this.timer);
    for (const p of this.players.values()) clearTimeout(p.dropTimer);
    rooms.delete(this.code);
  }

  // ---------- lobby ----------
  setReady(playerId, ready) {
    const p = this.players.get(playerId);
    if (!p || this.phase !== 'lobby') return;
    p.ready = !!ready;
    this.broadcast();
  }

  updateSettings(playerId, settings) {
    if (playerId !== this.hostId || this.phase !== 'lobby') return;
    for (const key of Object.keys(ALLOWED)) {
      const raw = settings?.[key];
      const v = typeof ALLOWED[key][0] === 'number' ? Number(raw) : String(raw);
      if (ALLOWED[key].includes(v)) this.settings[key] = v;
    }
    this.broadcast();
  }

  canStart() {
    const ps = this.connectedPlayers();
    return this.phase === 'lobby' && ps.length >= 2 && ps.every((p) => p.ready);
  }

  start(playerId) {
    if (playerId !== this.hostId) return { error: 'Only the host can start.' };
    if (!this.canStart()) return { error: 'Need at least 2 players and everyone ready.' };
    for (const p of this.players.values()) p.score = 0;
    this.feed = [];
    this.game = { gridSize: this.settings.gridSize, round: 0, turnQueue: [], drawerId: null, word: null, grid: [], log: [], guessed: new Map(), turnEndsAt: 0, turnNumber: 0 };
    this.system('🎬 Game on!');
    this.nextTurn();
    return { ok: true };
  }

  toLobby() {
    clearTimeout(this.timer);
    this.phase = 'lobby';
    this.game = null;
    for (const p of this.players.values()) p.ready = false;
    // drop anyone who disconnected
    for (const p of [...this.players.values()]) if (!p.connected) this.removePlayer(p.id);
    if (rooms.has(this.code)) this.broadcast();
  }

  playAgain(playerId) {
    if (playerId !== this.hostId || this.phase !== 'results') return;
    this.toLobby();
  }

  // ---------- turns ----------
  nextTurn() {
    clearTimeout(this.timer);
    const g = this.game;
    // Skip queued drawers who left or disconnected.
    while (g.turnQueue.length && !this.players.get(g.turnQueue[0])?.connected) g.turnQueue.shift();
    if (!g.turnQueue.length) {
      if (g.round >= this.settings.rounds) return this.finish();
      g.round += 1;
      g.turnQueue = this.connectedPlayers().map((p) => p.id);
      this.system(`🔁 Round ${g.round} of ${this.settings.rounds}`);
    }
    g.drawerId = g.turnQueue.shift();
    g.turnNumber += 1;
    g.word = pickWord(this.usedWords, this.settings.difficulty);
    g.grid = Array(g.gridSize * g.gridSize).fill(null);
    g.log = [];
    g.guessed = new Map();
    g.turnEndsAt = Date.now() + this.settings.turnTime * 1000;
    this.phase = 'drawing';
    const drawer = this.players.get(g.drawerId);
    this.system(`🎨 ${drawer.avatar} ${drawer.name} is drawing!`);
    this.timer = setTimeout(() => this.endTurn(), this.settings.turnTime * 1000);
    this.broadcast();
  }

  endTurn() {
    clearTimeout(this.timer);
    const g = this.game;
    if (!g || this.phase !== 'drawing') return;
    this.phase = 'reveal';
    g.revealEndsAt = Date.now() + REVEAL_MS;
    this.system(`The word was “${g.word}”`);
    this.timer = setTimeout(() => {
      if (this.checkEnoughPlayers()) this.nextTurn();
    }, REVEAL_MS);
    this.broadcast();
  }

  finish() {
    clearTimeout(this.timer);
    this.phase = 'results';
    this.system('🏁 Game over!');
    this.broadcast();
  }

  draw(playerId, text) {
    const g = this.game;
    if (this.phase !== 'drawing' || !g || g.drawerId !== playerId) return { ok: false, error: "It's not your turn to draw." };
    const result = parseCommand(String(text).slice(0, 120), { gridSize: g.gridSize });
    if (!result.ok) return result;
    for (const c of result.cells) g.grid[c] = result.hex;
    g.log.unshift({ text: String(text).trim().slice(0, 120), hex: result.hex, colorWord: result.colorWord, known: result.known });
    g.log.length = Math.min(g.log.length, MAX_LOG);
    this.broadcast();
    return result;
  }

  /** Drawer swaps their word. Allowed until someone guesses; the timer keeps running. */
  skip(playerId) {
    const g = this.game;
    if (this.phase !== 'drawing' || !g || g.drawerId !== playerId) return { ok: false, error: "It's not your turn to draw." };
    if (g.guessed.size) return { ok: false, error: 'Too late — someone already guessed it!' };
    g.word = pickWord(this.usedWords, this.settings.difficulty);
    g.grid = Array(g.gridSize * g.gridSize).fill(null);
    g.log = [];
    const p = this.players.get(playerId);
    this.system(`⏭️ ${p.name} skipped their word. Fresh canvas!`);
    this.broadcast();
    return { ok: true };
  }

  guess(playerId, text) {
    const g = this.game;
    const p = this.players.get(playerId);
    const raw = String(text || '').trim().slice(0, 60);
    if (!p || !raw) return;
    if (this.phase !== 'drawing' || !g) {
      this.pushFeed({ type: 'chat', name: p.name, avatar: p.avatar, text: raw });
      return this.broadcast();
    }
    if (playerId === g.drawerId) return { error: 'Drawers draw, they don’t guess! 🤐' };
    if (g.guessed.has(playerId)) return { error: 'You already got it — shh! 🤫' };

    if (normalizeGuess(raw) === normalizeGuess(g.word)) {
      const timeLeft = Math.max(0, g.turnEndsAt - Date.now());
      const pts = 50 + Math.round((50 * timeLeft) / (this.settings.turnTime * 1000));
      p.score += pts;
      const drawer = this.players.get(g.drawerId);
      if (drawer) drawer.score += 25;
      g.guessed.set(playerId, pts);
      this.pushFeed({ type: 'correct', name: p.name, avatar: p.avatar, text: `guessed it! +${pts}` });
      this.io.to(this.code).emit('celebrate', { playerId, name: p.name });
      if (!this.checkAllGuessed()) this.broadcast();
      return { correct: true, points: pts };
    }
    this.pushFeed({ type: 'guess', name: p.name, avatar: p.avatar, text: raw });
    this.broadcast();
    return { correct: false };
  }

  /** Ends the turn early if every connected non-drawer has guessed. */
  checkAllGuessed() {
    const g = this.game;
    if (this.phase !== 'drawing' || !g) return false;
    const guessers = this.connectedPlayers().filter((p) => p.id !== g.drawerId);
    if (guessers.length && guessers.every((p) => g.guessed.has(p.id))) {
      this.system('Everyone got it! ⚡');
      this.endTurn();
      return true;
    }
    return false;
  }

  // ---------- feed + state ----------
  pushFeed(entry) {
    this.feed.push({ ...entry, t: Date.now() });
    if (this.feed.length > MAX_FEED) this.feed.splice(0, this.feed.length - MAX_FEED);
  }

  system(text) {
    this.pushFeed({ type: 'system', text });
  }

  stateFor(playerId) {
    const g = this.game;
    const now = Date.now();
    const isDrawer = g && g.drawerId === playerId;
    const showWord = g && (isDrawer || g.guessed.has(playerId) || this.phase !== 'drawing');
    return {
      code: this.code,
      you: playerId,
      hostId: this.hostId,
      phase: this.phase,
      settings: this.settings,
      allowed: ALLOWED,
      canStart: this.canStart(),
      gridSize: g?.gridSize || this.settings.gridSize,
      players: this.order.map((id) => {
        const p = this.players.get(id);
        return { id: p.id, name: p.name, avatar: p.avatar, ready: p.ready, score: p.score, connected: p.connected, guessed: !!g?.guessed.has(p.id) };
      }),
      feed: this.feed,
      game: g && {
        round: g.round,
        rounds: this.settings.rounds,
        drawerId: g.drawerId,
        word: showWord ? g.word : null,
        hint: hintFor(g.word),
        grid: g.grid,
        log: g.log,
        youGuessed: g.guessed.has(playerId),
        canSkip: g.guessed.size === 0,
        turn: g.turnNumber,
        remainingMs: this.phase === 'drawing' ? Math.max(0, g.turnEndsAt - now) : this.phase === 'reveal' ? Math.max(0, g.revealEndsAt - now) : 0,
        turnTime: this.settings.turnTime,
      },
    };
  }

  broadcast() {
    for (const p of this.players.values()) {
      if (p.connected) this.io.to(p.socketId).emit('state', this.stateFor(p.id));
    }
  }
}

function createRoom(io) {
  const code = makeCode();
  const room = new Room(io, code);
  rooms.set(code, room);
  return room;
}

function getRoom(code) {
  return rooms.get(String(code || '').toUpperCase().trim());
}

module.exports = { createRoom, getRoom, rooms, normalizeGuess, hintFor, Room };
