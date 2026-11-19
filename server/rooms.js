// Room + game state machine. All state lives in memory.
const { parseCommand } = require('./commandParser');
const { pickWord } = require('./words');

const AVATARS = ['🐸', '🦄', '🍕', '🐙', '🦖', '🌮', '🐝', '🍩', '🦊', '🐧', '🍉', '👾', '🦀', '🌈', '🐼', '🍄'];
// If a game drops below 2 connected players (e.g. a phone locks), it pauses this long
// waiting for them to come back. Mid-game, disconnected players are kept for the same time.
const PAUSE_MS = Number(process.env.PIXELARY_PAUSE_MS) || 120_000;
const DISCONNECT_GRACE_MS = PAUSE_MS + 5_000; // a bit longer, so the pause's own give-up runs first
const LOBBY_GRACE_MS = 5_000;
const MAX_PLAYERS = 12;
const MAX_FEED = 60;
const MAX_LOG = 40;

// turnTime 0 = no timer: the turn ends when everyone guesses or the drawer/host ends it.
const DEFAULT_SETTINGS = { rounds: 2, turnTime: 120, revealTime: 5, difficulty: 'easy', gridSize: 8 };
const ALLOWED = {
  rounds: [1, 2, 3, 4, 5],
  turnTime: [0, 75, 90, 120, 150, 180], // 75s minimum (0 = no timer)
  revealTime: [5, 10, 15, 20, 30],
  difficulty: ['easy', 'medium', 'hard', 'mix'],
  gridSize: [8, 9, 16, 17],
};

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
      this.maybeResume(p);
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
    this.maybeResume(p);
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
    p.dropTimer.unref?.(); // housekeeping timers shouldn't keep the process alive on their own
    // Too few left to play (e.g. 2-player game, a phone locked): pause, don't end or skip.
    if (!this.checkEnoughPlayers()) return this.broadcast();
    if (this.game && this.game.drawerId === playerId && this.phase === 'drawing') {
      this.system(`${p.name} (the drawer) vanished! Skipping…`);
      this.endTurn();
      return;
    }
    this.checkAllGuessed();
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
    if (this.game?.paused) {
      // Paused and now too few people left to ever resume: wrap up on the results screen.
      if (this.players.size < 2) {
        this.game.paused = null;
        return this.finish();
      }
      return this.broadcast();
    }
    if (this.game && this.game.drawerId === playerId && this.phase === 'drawing') return this.endTurn();
    if (this.checkEnoughPlayers()) this.checkAllGuessed();
    this.broadcast();
  }

  connectedPlayers() {
    return this.order.map((id) => this.players.get(id)).filter((p) => p && p.connected);
  }

  /**
   * Returns false if a running game can't continue right now. Fewer than 2 *connected*
   * players but someone may still come back → pause. Fewer than 2 in the room → lobby.
   */
  checkEnoughPlayers() {
    if (this.phase === 'lobby' || this.phase === 'results') return true;
    if (this.game?.paused) return false;
    if (this.connectedPlayers().length >= 2) return true;
    if (this.players.size >= 2) {
      this.pause();
      return false;
    }
    this.system('Not enough players left — back to the lobby!');
    this.toLobby();
    return false;
  }

  // ---------- pause / resume ----------
  pause() {
    const g = this.game;
    if (!g || g.paused) return;
    clearTimeout(this.timer);
    const now = Date.now();
    let remainingMs = null;
    if (this.phase === 'drawing' && g.turnEndsAt) remainingMs = Math.max(0, g.turnEndsAt - now);
    if (this.phase === 'reveal') remainingMs = Math.max(0, g.revealEndsAt - now);
    g.paused = { endsAt: now + PAUSE_MS, remainingMs };
    const names = this.awayPlayers().map((p) => p.name).join(' & ');
    this.system(`⏸️ Paused — waiting for ${names} to come back…`);
    clearTimeout(this.pauseTimer);
    this.pauseTimer = setTimeout(() => this.giveUp(), PAUSE_MS);
    this.pauseTimer.unref?.();
  }

  /** Someone (re)joined: if the game was paused and we have 2 connected again, pick up where we left off. */
  maybeResume(p) {
    const g = this.game;
    if (!g?.paused || this.connectedPlayers().length < 2) return;
    clearTimeout(this.pauseTimer);
    const { remainingMs } = g.paused;
    g.paused = null;
    const now = Date.now();
    if (this.phase === 'drawing' && remainingMs !== null) {
      g.turnEndsAt = now + remainingMs;
      this.timer = setTimeout(() => this.endTurn(), remainingMs);
    } else if (this.phase === 'reveal') {
      g.revealEndsAt = now + remainingMs;
      this.timer = setTimeout(() => { if (this.checkEnoughPlayers()) this.nextTurn(); }, remainingMs);
    }
    this.system(`▶️ ${p.name} is back! Game on.`);
    this.broadcast();
  }

  /** Nobody came back in time: end the game on the results screen (scores + gallery survive). */
  giveUp() {
    const g = this.game;
    if (!g?.paused) return;
    const away = this.awayPlayers();
    this.system(`${away.map((p) => p.name).join(' & ')} didn't make it back`);
    g.paused = null;
    for (const p of away) {
      clearTimeout(p.dropTimer);
      this.players.delete(p.id);
      this.order = this.order.filter((id) => id !== p.id);
      if (this.hostId === p.id) this.hostId = this.order[0] || null;
    }
    if (!this.players.size) return this.destroy();
    this.finish();
  }

  awayPlayers() {
    return this.order.map((id) => this.players.get(id)).filter((p) => p && !p.connected);
  }

  pausedError() {
    return this.game?.paused ? { ok: false, error: `Game paused — waiting for ${this.awayPlayers().map((p) => p.name).join(' & ')}` } : null;
  }

  destroy() {
    clearTimeout(this.timer);
    clearTimeout(this.pauseTimer);
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
    this.begin();
    return { ok: true };
  }

  /** Fresh game with the current players and settings (scores reset, words keep avoiding repeats). */
  begin() {
    for (const p of this.players.values()) p.score = 0;
    this.feed = [];
    this.game = { gridSize: this.settings.gridSize, round: 0, turnQueue: [], drawerId: null, word: null, grid: [], log: [], guessed: new Map(), turnEndsAt: 0, turnNumber: 0, gallery: [] };
    this.system('🎬 Game on!');
    this.nextTurn();
  }

  toLobby({ keepReady = false } = {}) {
    clearTimeout(this.timer);
    clearTimeout(this.pauseTimer);
    this.phase = 'lobby';
    this.game = null;
    for (const p of this.players.values()) p.ready = keepReady && p.connected;
    // drop anyone who disconnected
    for (const p of [...this.players.values()]) if (!p.connected) this.removePlayer(p.id);
    if (rooms.has(this.code)) this.broadcast();
  }

  /** Results screen, host: back to the lobby to tweak settings. Everyone stays ready. */
  playAgain(playerId) {
    if (playerId !== this.hostId || this.phase !== 'results') return;
    this.toLobby({ keepReady: true });
  }

  /** Results screen, host: start a new game right away with the same players and settings. */
  rematch(playerId) {
    if (playerId !== this.hostId) return { ok: false, error: 'Only the host can start a rematch.' };
    if (this.phase !== 'results') return { ok: false, error: 'The game isn’t over yet.' };
    for (const p of [...this.players.values()]) if (!p.connected) this.removePlayer(p.id);
    if (this.connectedPlayers().length < 2) return { ok: false, error: 'Need at least 2 players for a rematch.' };
    for (const p of this.players.values()) p.ready = true;
    this.begin();
    return { ok: true };
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
    const timed = this.settings.turnTime > 0;
    g.turnEndsAt = timed ? Date.now() + this.settings.turnTime * 1000 : 0;
    this.phase = 'drawing';
    const drawer = this.players.get(g.drawerId);
    this.system(`🎨 ${drawer.avatar} ${drawer.name} is drawing!`);
    if (timed) this.timer = setTimeout(() => this.endTurn(), this.settings.turnTime * 1000);
    this.broadcast();
  }

  endTurn() {
    clearTimeout(this.timer);
    const g = this.game;
    if (!g || this.phase !== 'drawing') return;
    this.phase = 'reveal';
    const revealMs = this.settings.revealTime * 1000;
    g.revealEndsAt = Date.now() + revealMs;
    this.system(`The word was “${g.word}”`);
    // Keep finished drawings (skipped words don't count) for the saveable gallery.
    const artist = this.players.get(g.drawerId);
    if (g.grid.some(Boolean)) {
      g.gallery.push({
        round: g.round, word: g.word, gridSize: g.gridSize, grid: [...g.grid],
        artist: artist?.name || 'Someone', avatar: artist?.avatar || '🎨', guessedBy: g.guessed.size,
      });
    }
    this.timer = setTimeout(() => {
      if (this.checkEnoughPlayers()) this.nextTurn();
    }, revealMs);
    this.broadcast();
  }

  finish() {
    clearTimeout(this.timer);
    clearTimeout(this.pauseTimer);
    this.phase = 'results';
    this.system('🏁 Game over!');
    this.broadcast();
  }

  draw(playerId, text) {
    const paused = this.pausedError();
    if (paused) return paused;
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

  /** No-timer games: the drawer (or host) ends the turn when they're done. */
  endTurnEarly(playerId) {
    const paused = this.pausedError();
    if (paused) return paused;
    const g = this.game;
    if (this.phase !== 'drawing' || !g) return { ok: false, error: 'Nothing to end right now.' };
    if (playerId !== g.drawerId && playerId !== this.hostId) return { ok: false, error: 'Only the drawer or host can end the turn.' };
    const p = this.players.get(playerId);
    this.system(`🏁 ${p.name} ended the turn`);
    this.endTurn();
    return { ok: true };
  }

  /** Drawer swaps their word. Allowed until someone guesses; the timer keeps running. */
  skip(playerId) {
    const paused = this.pausedError();
    if (paused) return paused;
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
    if (g.paused) return this.pausedError();
    if (playerId === g.drawerId) return { error: 'Drawers draw, they don’t guess! 🤐' };
    if (g.guessed.has(playerId)) return { error: 'You already got it — shh! 🤫' };

    if (normalizeGuess(raw) === normalizeGuess(g.word)) {
      // Timed: faster = more (50-100). No timer: earlier guessers get more (100, 80, 60, then 50).
      const pts = this.settings.turnTime > 0
        ? 50 + Math.round((50 * Math.max(0, g.turnEndsAt - Date.now())) / (this.settings.turnTime * 1000))
        : Math.max(50, 100 - 20 * g.guessed.size);
      p.score += pts;
      const drawer = this.players.get(g.drawerId);
      if (drawer) drawer.score += 25;
      g.guessed.set(playerId, pts);
      this.pushFeed({ type: 'correct', name: p.name, avatar: p.avatar, text: `guessed it! +${pts}` });
      this.io.to(this.code).emit('celebrate', { playerId, name: p.name, avatar: p.avatar, points: pts });
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
        // The drawer's commands name colors and shapes, which gives too much away:
        // only the drawer sees them while drawing; everyone sees them once the word is revealed.
        log: isDrawer || this.phase !== 'drawing' ? g.log : [],
        youGuessed: g.guessed.has(playerId),
        paused: g.paused
          ? { waitingFor: this.awayPlayers().map((p) => ({ name: p.name, avatar: p.avatar })), remainingMs: Math.max(0, g.paused.endsAt - now) }
          : null,
        canSkip: g.guessed.size === 0,
        turn: g.turnNumber,
        noTimer: this.settings.turnTime === 0,
        remainingMs: this.phase === 'drawing' ? (g.turnEndsAt ? Math.max(0, g.turnEndsAt - now) : null) : this.phase === 'reveal' ? Math.max(0, g.revealEndsAt - now) : 0,
        // Finished drawings: sent when they can be saved (reveal + results).
        gallery: this.phase === 'drawing' ? [] : g.gallery,
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
