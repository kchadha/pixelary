/* Pixelary client — renders server state, sends player actions. */
(() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const CHAOS = ['#ff5f6d', '#ffc371', '#47e5bc', '#845ef7', '#ff3ea5', '#22b8ff', '#ffe14d', '#7cf35f'];

  // ---------- identity ----------
  // Per tab (sessionStorage): survives a refresh, but two tabs are two different players.
  let playerId = sessionStorage.getItem('pixelary-id');
  if (!playerId) {
    playerId = (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36)).replace(/[^a-zA-Z0-9-]/g, '');
    sessionStorage.setItem('pixelary-id', playerId);
  }
  const params = new URLSearchParams(location.search);
  let roomCode = (params.get('room') || '').toUpperCase().slice(0, 4) || null;
  let state = null;
  let deadline = 0;
  let lastTurn = null;
  let pauseDeadline = 0;
  let lastFeedT = null; // newest feed entry already shown as a bubble

  // ---------- phone layout ----------
  // On narrow screens the guess / command boxes live in a dock pinned to the bottom,
  // so they're always in view (and sit right above the on-screen keyboard).
  const phone = matchMedia('(max-width: 700px)');
  const isTouch = matchMedia('(pointer: coarse)');
  function placeInputs() {
    const dock = $('dock');
    if (phone.matches) {
      dock.append($('drawControls'), $('guessControls'));
      $('cheatSheet').open = false;
    } else {
      $('drawSlot').append($('drawControls'));
      $('guessSlot').append($('guessControls'));
      $('cheatSheet').open = true;
    }
  }
  phone.addEventListener('change', placeInputs);
  placeInputs();
  // iOS Safari doesn't resize the page for the keyboard; lift the dock by hand.
  if (window.visualViewport) {
    const lift = () => {
      const vv = window.visualViewport;
      const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      document.documentElement.style.setProperty('--kb', `${kb}px`);
    };
    visualViewport.addEventListener('resize', lift);
    visualViewport.addEventListener('scroll', lift);
  }

  // ---------- rainbow logo ----------
  $('logo').innerHTML = [...'Pixelary'].map((ch, i) => `<span style="color:${CHAOS[i % CHAOS.length]};animation-delay:${i * 0.08}s">${ch}</span>`).join('');

  // ---------- socket ----------
  // closeOnBeforeunload: leaving/reloading the page tells the server right away.
  const socket = io({ closeOnBeforeunload: true });
  socket.on('connect', () => {
    // Re-join automatically after a refresh / reconnect.
    const name = localStorage.getItem('pixelary-name');
    if (roomCode && name && sessionStorage.getItem('pixelary-room') === roomCode) join(roomCode, name);
  });
  socket.on('state', (s) => { state = s; render(); window.KeepAwake?.set(true); });
  socket.on('celebrate', ({ playerId: who, name, avatar, points }) => {
    burst(who === playerId ? 160 : 60);
    comic(who === playerId ? 'YOU GOT IT!' : `${name} GOT IT!`, `${avatar} +${points}`);
  });
  socket.on('disconnect', () => toast('Lost connection… reconnecting 🔌'));

  // ---------- phone lock resilience ----------
  // Screen stays awake while in a room (see wake.js); reconnect right away on unlock.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    // Phone unlocked / tab back: reconnect now instead of waiting for the retry backoff.
    if (!socket.connected) socket.connect();
  });

  function join(code, name) {
    socket.emit('join_room', { code, name, playerId }, (res) => {
      if (!res.ok) {
        sessionStorage.removeItem('pixelary-room');
        showView('homeView');
        if (code === roomCode) return showNotFound(res.error); // came from an invite link
        setupHome();
        $('homeError').textContent = res.error;
        return;
      }
      afterJoin(res.code);
    });
  }

  function afterJoin(code) {
    roomCode = code;
    sessionStorage.setItem('pixelary-room', code);
    history.replaceState(null, '', `?room=${code}`);
  }

  // ---------- home ----------
  /** The invite link's game is gone (ended, or the server restarted): offer a way back. */
  function showNotFound(reason) {
    $('homeTitle').textContent = 'That game has vanished 👻';
    $('homeSub').textContent = `${reason || `No game found with code ${roomCode}.`} It may have ended, or the server restarted. Start a fresh one from the main page!`;
    $('homeForm').hidden = true;
    $('joinCodeBox').hidden = true;
    $('soloBtn').hidden = true;
    $('homeError').textContent = '';
    $('homeBtn').href = location.pathname; // same page, without ?room=
    $('homeBtn').hidden = false;
  }

  function setupHome() {
    $('nameInput').value = localStorage.getItem('pixelary-name') || '';
    if (roomCode) {
      $('homeTitle').textContent = `You're invited! 🎉`;
      $('homeSub').textContent = `Join room ${roomCode} and get ready to paint with words.`;
      $('homeSubmit').textContent = '🚪 Join game';
      $('joinCodeBox').hidden = true;
    $('soloBtn').hidden = true;
    }
  }

  $('homeForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = $('nameInput').value.trim();
    if (!name) return;
    localStorage.setItem('pixelary-name', name);
    $('homeError').textContent = '';
    if (roomCode) return join(roomCode, name);
    socket.emit('create_room', { name, playerId }, (res) => {
      if (!res.ok) return ($('homeError').textContent = res.error);
      afterJoin(res.code);
    });
  });

  $('codeForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const code = $('codeInput').value.trim().toUpperCase();
    const name = $('nameInput').value.trim();
    if (!name) { $('homeError').textContent = 'Pick a name first!'; $('nameInput').focus(); return; }
    if (code.length !== 4) { $('homeError').textContent = 'Codes are 4 letters.'; return; }
    localStorage.setItem('pixelary-name', name);
    join(code, name);
  });

  // ---------- lobby ----------
  $('copyBtn').addEventListener('click', async () => {
    const link = $('inviteLink').value;
    try { await navigator.clipboard.writeText(link); toast('Link copied! Go spread the chaos 📨'); }
    catch { $('inviteLink').select(); document.execCommand('copy'); toast('Link copied!'); }
  });
  $('readyBtn').addEventListener('click', () => {
    const me = state?.players.find((p) => p.id === playerId);
    socket.emit('set_ready', { ready: !me?.ready });
  });
  const sendSettings = () =>
    socket.emit('update_settings', { rounds: Number($('roundsSelect').value), turnTime: Number($('timeSelect').value), difficulty: $('difficultySelect').value, gridSize: Number($('gridSelect').value), revealTime: Number($('revealSelect').value) });
  for (const id of ['roundsSelect', 'timeSelect', 'revealSelect', 'difficultySelect', 'gridSelect']) $(id).addEventListener('change', sendSettings);
  $('startBtn').addEventListener('click', () => socket.emit('start_game', null, (res) => res?.error && toast(res.error)));
  $('againBtn').addEventListener('click', () => socket.emit('play_again'));
  $('rematchBtn').addEventListener('click', () => socket.emit('rematch', null, (res) => { if (!res?.ok) toast(res?.error || 'Could not start a rematch'); }));

  // ---------- drawing ----------
  const SHAPES = ['dot', 'square', 'box', 'circle', 'ring', 'plus', 'x', 'line', 'row', 'col', 'diamond', 'triangle'];
  const SIZES = ['small', 'big', 'huge'];
  const chip = (w) => `<button type="button" class="chip" data-w="${w}">${w}</button>`;
  const chipsHtml =
    `<div><b>colors</b> any word: try <i>lava</i>, or make one up for a surprise 🎲</div>` +
    `<div><b>shapes</b> ${SHAPES.map(chip).join('')}</div>` +
    `<div><b>point</b> ${['up', 'down', 'left', 'right'].map(chip).join('')} <span class="sub small">for triangles</span></div>` +
    `<div><b>sizes</b> ${SIZES.map(chip).join('')} <span class="sub small">or <code>s</code>+number: <code>square s3 50</code></span></div>` +
    `<div><b>cells</b> <code>13</code> · <code>1, 6, 11</code> · <code>1 to 21</code> · <code>all</code></div>`;
  // Same cheat sheet in the game and in solo free draw; each types into its own box.
  for (const box of [$('chips'), $('soloChips')]) {
    box.innerHTML = chipsHtml;
    box.addEventListener('click', (e) => {
      const w = e.target.closest('.chip')?.dataset.w;
      if (!w) return;
      const input = $(box.dataset.input);
      input.value = (input.value.trim() + ' ' + w).trim() + ' ';
      input.focus();
    });
  }

  function sendDraw(text) {
    if (!text.trim()) return;
    socket.emit('draw', { text }, (res) => {
      if (!res.ok) {
        $('drawError').textContent = res.error;
        $('drawError').classList.remove('info');
        shake($('drawForm'));
        return;
      }
      $('drawError').textContent = res.known ? '' : `🎲 “${res.colorWord}” isn't a color I know, so here's a surprise!`;
      $('drawError').classList.toggle('info', !res.known);
      $('drawInput').value = '';
    });
  }
  $('endTurnBtn').addEventListener('click', () => {
    socket.emit('end_turn', null, (res) => { if (!res?.ok) toast(res?.error || 'Could not end the turn'); });
  });
  $('saveDrawingBtn').addEventListener('click', () => {
    const art = currentArt();
    if (art) PixelArt.save([art], `Round ${art.round}`, `pixelary-${PixelArt.slug(art.word)}.png`);
  });
  $('saveAllBtn').addEventListener('click', () => {
    const all = state?.game?.gallery || [];
    if (all.length) PixelArt.save(all, `${all.length} masterpiece${all.length === 1 ? '' : 's'}`, 'pixelary-gallery.png');
  });
  $('gallery').addEventListener('click', (e) => {
    const round = Number(e.target.closest('[data-round]')?.dataset.round);
    if (!round) return;
    const arts = state.game.gallery.filter((a) => a.round === round);
    PixelArt.save(arts, `Round ${round}`, `pixelary-round-${round}.png`);
  });

  /** The drawing from the turn being revealed right now (if anything was drawn). */
  function currentArt() {
    const g = state?.game;
    if (!g || state.phase !== 'reveal') return null;
    const last = g.gallery[g.gallery.length - 1];
    return last && last.word === g.word ? last : null;
  }

  $('skipBtn').addEventListener('click', () => {
    socket.emit('skip_word', null, (res) => {
      if (!res?.ok) return toast(res?.error || 'Could not skip');
      $('drawError').textContent = '';
      $('drawInput').focus();
    });
  });
  $('drawForm').addEventListener('submit', (e) => { e.preventDefault(); sendDraw($('drawInput').value); });
  // Any typing clears the previous message.
  $('drawInput').addEventListener('input', () => { $('drawError').textContent = ''; });
  $('guessInput').addEventListener('input', () => { $('guessError').textContent = ''; });

  // Voice input (experimental) via the Web Speech API.
  const Speech = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (Speech) {
    const rec = new Speech();
    rec.lang = 'en-US';
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    let listening = false;
    $('micBtn').hidden = false;
    $('micBtn').addEventListener('click', () => {
      if (listening) return rec.stop();
      try { rec.start(); } catch { /* already started */ }
    });
    rec.onstart = () => { listening = true; $('micBtn').classList.add('listening'); };
    rec.onend = () => { listening = false; $('micBtn').classList.remove('listening'); };
    rec.onerror = (e) => { $('drawError').textContent = `🎤 ${e.error === 'not-allowed' ? 'Microphone blocked.' : "Didn't catch that."}`; };
    rec.onresult = (e) => {
      const text = e.results[0][0].transcript;
      $('drawInput').value = text;
      sendDraw(text);
    };
  }

  // ---------- guessing ----------
  $('guessForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const text = $('guessInput').value.trim();
    if (!text) return;
    socket.emit('guess', { text }, (res) => {
      $('guessError').textContent = res?.error || '';
      if (res?.correct) toast(`🎉 Nailed it! +${res.points}`);
      else if (res?.correct === false) shake($('guessForm'));
    });
    $('guessInput').value = '';
  });

  // ---------- rules ----------
  $('rulesBtn').addEventListener('click', () => $('rulesDialog').showModal());

  // ---------- rendering ----------
  function showView(id) {
    for (const v of document.querySelectorAll('.view')) v.hidden = v.id !== id;
  }

  function playerItem(p, extra = '') {
    const host = p.id === state.hostId ? ' 👑' : '';
    const you = p.id === playerId ? ' <span class="you">(you)</span>' : '';
    return `<li class="${p.connected ? '' : 'offline'} ${extra}"><span class="avatar">${p.avatar}</span><span class="pname">${esc(p.name)}${host}${you}</span>`;
  }

  function render() {
    if (!state) return;
    const isHost = state.hostId === playerId;
    const me = state.players.find((p) => p.id === playerId);
    document.body.dataset.phase = state.phase;

    if (state.phase === 'lobby') {
      showView('lobbyView');
      $('roomCode').textContent = state.code;
      $('inviteLink').value = `${location.origin}${location.pathname}?room=${state.code}`;
      $('lobbyPlayers').innerHTML = state.players
        .map((p) => playerItem(p) + `<span class="badge ${p.ready ? 'ready' : ''}">${p.ready ? 'READY ✅' : 'not ready'}</span></li>`)
        .join('');
      $('readyBtn').textContent = me?.ready ? '😴 Not ready' : "🙌 I'm ready!";
      $('readyBtn').classList.toggle('btn-go', !me?.ready);
      // Host gets dropdowns; everyone else just sees the chosen settings.
      $('settingsControls').hidden = !isHost;
      $('settingsSummary').hidden = isHost;
      if (isHost) {
        fillSelect($('roundsSelect'), state.allowed.rounds, state.settings.rounds);
        fillSelect($('timeSelect'), state.allowed.turnTime, state.settings.turnTime);
        fillSelect($('revealSelect'), state.allowed.revealTime, state.settings.revealTime);
        fillSelect($('difficultySelect'), state.allowed.difficulty, state.settings.difficulty);
        fillSelect($('gridSelect'), state.allowed.gridSize, state.settings.gridSize);
      } else {
        const st = state.settings;
        $('settingsSummary').innerHTML =
          `<li><span>Rounds</span><b>${st.rounds}</b></li>` +
          `<li><span>Seconds per turn</span><b>${st.turnTime ? st.turnTime : 'no timer'}</b></li>` +
          `<li><span>Show the answer for</span><b>${st.revealTime} seconds</b></li>` +
          `<li><span>Grid size</span><b>${gridLabel(st.gridSize)}</b></li>` +
          `<li><span>Word difficulty</span><b>${st.difficulty === 'mix' ? 'mix it up' : st.difficulty}</b></li>`;
      }
      $('settingsNote').textContent = isHost ? 'You’re the host. Tweak away!' : 'The host picks the settings.';
      $('startBtn').hidden = !(isHost && state.canStart);
      const connected = state.players.filter((p) => p.connected);
      $('startNote').textContent = isHost
        ? connected.length < 2 ? 'Waiting for at least one more player…' : !state.canStart ? 'Waiting for everyone to be ready…' : 'Everyone’s ready. Let’s go!'
        : 'Waiting for the host to start…';
      return;
    }

    if (state.phase === 'results') {
      showView('resultsView');
      const sorted = [...state.players].sort((a, b) => b.score - a.score);
      const medals = ['🥇', '🥈', '🥉'];
      $('podium').innerHTML = sorted
        .map((p, i) => `<li style="--c:${CHAOS[i % CHAOS.length]}"><span class="medal">${medals[i] || '🎈'}</span><span class="avatar">${p.avatar}</span><span class="pname">${esc(p.name)}</span><span class="score">${p.score}</span></li>`)
        .join('');
      renderGallery(state.game?.gallery || []);
      // Host: rematch (same players + settings, starts now) or back to the lobby to change settings.
      const enough = state.players.filter((p) => p.connected).length >= 2;
      $('rematchBtn').hidden = !(isHost && enough);
      $('againBtn').hidden = !isHost;
      $('againNote').textContent = !isHost
        ? 'Waiting for the host to start a rematch or change the settings…'
        : enough ? 'Rematch keeps the same players and settings.' : 'Everyone else left. Change settings to wait for new players in the lobby.';
      if (!render.celebrated) { burst(250); render.celebrated = true; }
      return;
    }
    render.celebrated = false;

    // drawing / reveal
    showView('gameView');
    const g = state.game;
    const isDrawer = g.drawerId === playerId;
    const drawer = state.players.find((p) => p.id === g.drawerId);
    deadline = Date.now() + g.remainingMs;

    // New turn: wipe leftover messages and half-typed text from the last one.
    if (g.turn !== lastTurn) {
      lastTurn = g.turn;
      $('drawError').textContent = '';
      $('guessError').textContent = '';
      $('drawInput').value = '';
      $('guessInput').value = '';
    }

    $('roundPill').textContent = `Round ${g.round}/${g.rounds}`;
    if (state.phase === 'reveal') {
      $('wordBox').innerHTML = `The word was <b>${esc(g.word)}</b>`;
    } else if (isDrawer) {
      $('wordBox').innerHTML = `Draw: <b>${esc(g.word)}</b>`;
    } else {
      const hint = esc(g.hint).replace(/_/g, '<i>_</i>');
      $('wordBox').innerHTML = g.youGuessed
        ? `✅ You got it: <b>${esc(g.word || '')}</b>`
        : `${drawer ? drawer.avatar + ' ' + esc(drawer.name) : 'Someone'} is drawing: <span class="hint">${hint}</span> <span class="sub small">(${g.hint.replace(/[^_]/g, '').length} letters)</span>`;
    }

    paintGrid($('pixelGrid'), g.grid, state.gridSize);

    $('drawLog').innerHTML = g.log
      .map((l) => `<li><span class="swatch ${l.hex ? '' : 'erased'}" style="${l.hex ? `background:${esc(l.hex)}` : ''}"></span>${esc(l.text)}${l.known ? '' : ' 🎲'}</li>`)
      .join('');

    // Paused (someone's connection dropped): banner + countdown, and nothing to type into.
    const paused = g.paused;
    $('pauseBanner').hidden = !paused;
    if (paused) {
      pauseDeadline = Date.now() + paused.remainingMs;
      const who = paused.waitingFor.map((p) => `${p.avatar} ${esc(p.name)}`).join(' & ') || 'a player';
      $('pauseBanner').innerHTML = `⏸️ Paused — waiting for <b>${who}</b> to come back… <span class="pause-count" id="pauseCount"></span>`;
    }
    const drawing = isDrawer && state.phase === 'drawing' && !paused;
    $('drawPanel').hidden = !drawing;
    $('drawControls').hidden = !drawing;
    $('skipBtn').hidden = !(drawing && g.canSkip); // gone once someone has guessed
    $('endTurnBtn').hidden = !(g.noTimer && state.phase === 'drawing' && !paused && (isDrawer || isHost));
    $('saveDrawingBtn').hidden = !currentArt();
    const canGuess = state.phase === 'drawing' && !isDrawer && !g.youGuessed && !paused;
    $('guessForm').hidden = !canGuess;
    $('guessStatus').hidden = canGuess;
    $('guessStatus').textContent =
      paused ? `⏸️ Paused — waiting for ${paused.waitingFor.map((p) => p.name).join(' & ') || 'a player'}…`
        : state.phase === 'reveal' ? 'Next turn coming up…' : isDrawer ? 'You’re drawing! Watch the guesses roll in 👀' : '✅ You got it! Shhh 🤫';
    if (!canGuess) $('guessError').textContent = '';
    // Auto-focus on desktop only: on phones it would pop the keyboard over the grid every update.
    else if (!isTouch.matches && document.activeElement?.tagName !== 'INPUT') $('guessInput').focus();
    if (drawing && !isTouch.matches && document.activeElement !== $('drawInput')) $('drawInput').focus();

    // scoreboard
    const sorted = [...state.players].sort((a, b) => b.score - a.score);
    $('gamePlayers').innerHTML = sorted
      .map((p) => playerItem(p, p.guessed ? 'guessed' : '') + `${p.id === g.drawerId ? '<span class="badge drawing">✏️</span>' : p.guessed ? '<span class="badge ready">✅</span>' : ''}<span class="score">${p.score}</span></li>`)
      .join('');

    renderFeed();
  }

  function renderGallery(gallery) {
    $('galleryBox').hidden = !gallery.length;
    const key = gallery.map((a) => a.word).join('|');
    if (renderGallery.key === key) return; // don't rebuild canvases on every update
    renderGallery.key = key;
    const rounds = [...new Set(gallery.map((a) => a.round))];
    $('gallery').innerHTML = rounds
      .map((r) => `<section class="gallery-round"><div class="gallery-round-head"><h3>Round ${r}</h3>` +
        `<button class="btn btn-small btn-save" type="button" data-round="${r}">💾 Save round ${r}</button></div>` +
        `<div class="gallery-row" data-row="${r}"></div></section>`)
      .join('');
    gallery.forEach((art) => {
      const fig = document.createElement('figure');
      fig.className = 'art';
      fig.appendChild(PixelArt.thumbnail(art));
      const cap = document.createElement('figcaption');
      cap.innerHTML = `<b>${esc(art.word)}</b>by ${art.avatar} ${esc(art.artist)}`;
      fig.appendChild(cap);
      $('gallery').querySelector(`[data-row="${art.round}"]`).appendChild(fig);
    });
  }

  function renderFeed() {
    const feed = $('feed');
    const atBottom = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 40;
    feed.innerHTML = state.feed
      .map((f) => {
        if (f.type === 'system') return `<li class="sys">${esc(f.text)}</li>`;
        if (f.type === 'correct') return `<li class="correct">${f.avatar} <b>${esc(f.name)}</b> ${esc(f.text)} 🎉</li>`;
        return `<li>${f.avatar} <b>${esc(f.name)}:</b> ${esc(f.text)}</li>`;
      })
      .join('');
    if (atBottom) feed.scrollTop = feed.scrollHeight;

    // Phones have no feed panel: show new wrong guesses as little chat bubbles instead.
    const fresh = lastFeedT === null ? [] : state.feed.filter((f) => f.t > lastFeedT);
    lastFeedT = state.feed.length ? state.feed[state.feed.length - 1].t : 0;
    if (phone.matches) fresh.filter((f) => f.type === 'guess').forEach((f) => guessBubble(f));
  }

  function guessBubble(f) {
    const box = $('guessBubbles');
    const el = document.createElement('div');
    el.className = 'bubble';
    el.innerHTML = `<span>${f.avatar}</span> ${esc(f.text)}`;
    el.style.setProperty('--x', `${Math.round(Math.random() * 30)}%`);
    box.append(el);
    while (box.children.length > 3) box.firstChild.remove();
    setTimeout(() => el.remove(), 2800);
  }

  // Comic-book "event" burst for correct guesses.
  let comicTimer;
  function comic(title, sub) {
    const el = $('comic');
    const words = ['POW!', 'BAM!', 'ZAP!', 'KAPOW!', 'WHAM!', 'BOOM!'];
    el.innerHTML = `<div class="comic-burst"><span class="comic-pow">${words[Math.floor(Math.random() * words.length)]}</span>` +
      `<span class="comic-title">${esc(title)}</span><span class="comic-sub">${esc(sub)}</span></div>`;
    el.style.setProperty('--tilt', `${(Math.random() * 12 - 6).toFixed(1)}deg`);
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
    clearTimeout(comicTimer);
    comicTimer = setTimeout(() => el.classList.remove('show'), 1900);
  }

  /** Draw a grid of hex colors (null = empty) into a .pixel-grid element, animating changed cells. */
  function paintGrid(gridEl, grid, size) {
    gridEl.style.setProperty('--n', size);
    gridEl.classList.toggle('dense', size > 10);
    if (gridEl.children.length !== size * size) {
      gridEl.innerHTML = Array.from({ length: size * size }, (_, i) => `<div class="px" data-i="${i}"><span>${i + 1}</span></div>`).join('');
    }
    grid.forEach((hex, i) => {
      const cell = gridEl.children[i];
      const prev = cell.dataset.hex || '';
      const next = hex || '';
      if (prev !== next) {
        cell.dataset.hex = next;
        cell.style.background = next || '';
        cell.style.color = next ? labelColor(next) : '';
        cell.classList.toggle('filled', !!next);
        cell.classList.remove('pop');
        void cell.offsetWidth; // restart animation
        if (next) cell.classList.add('pop');
      }
    });
  }

  // Pick dark or white cell-number text, whichever contrasts more with the pixel color (WCAG luminance).
  function labelColor(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex);
    if (!m) return '';
    const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    const n = parseInt(m[1], 16);
    const L = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
    const inkL = 0.0075; // luminance of --ink (#1d1135)
    const vsInk = (L + 0.05) / (inkL + 0.05);
    const vsWhite = 1.05 / (L + 0.05);
    return vsInk >= vsWhite ? '#1d1135' : '#ffffff';
  }

  // Odd grids have a true center cell, which makes centered shapes easier.
  function gridLabel(n) {
    return `${n} × ${n}` + (n % 2 ? ' (easier: has a center)' : '');
  }

  function fillSelect(sel, options, value) {
    const label = (o) =>
      o === 'mix' ? 'mix it up'
        : sel.id === 'gridSelect' ? gridLabel(o)
          : sel.id === 'soloGridSelect' ? `${o} × ${o}`
          : sel.id === 'timeSelect' && o === 0 ? 'no timer ♾️'
            : sel.id === 'revealSelect' ? `${o} seconds`
              : o;
    if (sel.options.length !== options.length) sel.innerHTML = options.map((o) => `<option value="${o}">${label(o)}</option>`).join('');
    if (document.activeElement !== sel) sel.value = String(value);
  }

  // timer tick
  setInterval(() => {
    if (!state?.game || (state.phase !== 'drawing' && state.phase !== 'reveal')) return;
    if (state.game.paused) {
      const left = Math.max(0, Math.ceil((pauseDeadline - Date.now()) / 1000));
      const count = $('pauseCount');
      if (count) count.textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
      $('timer').textContent = '⏸';
      $('timer').classList.remove('urgent');
      return;
    }
    const t = $('timer');
    if (state.phase === 'drawing' && state.game.noTimer) {
      t.textContent = '∞';
      t.classList.remove('urgent');
      return;
    }
    const s = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
    t.textContent = state.phase === 'reveal' ? `next in ${s}` : s;
    t.classList.toggle('urgent', state.phase === 'drawing' && s <= 10);
  }, 250);

  // ---------- fx ----------
  function burst(count) {
    if (!window.confetti || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    window.confetti({ particleCount: count, spread: 90, origin: { y: 0.6 }, colors: CHAOS });
  }
  function shake(el) {
    el.classList.remove('shake');
    void el.offsetWidth;
    el.classList.add('shake');
  }
  let toastTimer;
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
  }

  // ---------- solo free draw ----------
  // No room or timer: a prompt, the same text commands as the game, plus click/drag painting.
  // Colors match what the command parser gives for the same words.
  const PALETTE = [
    ['red', '#ff0000'], ['orange', '#ffa500'], ['yellow', '#ffff00'], ['lime', '#00ff00'],
    ['grass', '#4caf50'], ['sky', '#87ceeb'], ['blue', '#0000ff'], ['grape', '#6f2da8'],
    ['pink', '#ffc0cb'], ['brown', '#a52a2a'], ['gray', '#808080'], ['black', '#000000'],
  ];
  const solo = { size: 8, grid: [], history: [], log: [], color: PALETTE[0][1], word: '', difficulty: 'easy' };

  $('palette').innerHTML =
    PALETTE.map(([name, hex], i) =>
      `<button type="button" class="swatch-btn" role="radio" aria-checked="${i === 0}" aria-label="${name}" title="${name}" data-hex="${hex}" style="background:${hex}"></button>`).join('') +
    `<button type="button" class="swatch-btn eraser" role="radio" aria-checked="false" aria-label="eraser" title="eraser" data-hex="">🧽</button>`;
  $('palette').addEventListener('click', (e) => {
    const btn = e.target.closest('.swatch-btn');
    if (!btn) return;
    solo.color = btn.dataset.hex || null;
    for (const b of $('palette').children) b.setAttribute('aria-checked', String(b === btn));
  });

  function soloRender() {
    paintGrid($('soloGrid'), solo.grid, solo.size);
    $('soloPrompt').innerHTML = `Draw: <b>${esc(solo.word || '…')}</b>`;
    $('undoBtn').disabled = !solo.history.length;
    $('soloLog').innerHTML = solo.log
      .map((l) => `<li><span class="swatch ${l.hex ? '' : 'erased'}" style="${l.hex ? `background:${esc(l.hex)}` : ''}"></span>${esc(l.text)}${l.known ? '' : ' 🎲'}</li>`)
      .join('');
  }
  function soloSnapshot() {
    solo.history.push([...solo.grid]);
    if (solo.history.length > 60) solo.history.shift();
  }
  function soloReset(size = solo.size) {
    solo.size = size;
    solo.grid = Array(size * size).fill(null);
    solo.history = [];
    solo.log = [];
  }
  function soloNewWord() {
    socket.emit('solo_word', { difficulty: solo.difficulty }, (res) => { solo.word = res?.word || 'Anything!'; soloRender(); });
  }
  function startSolo() {
    showView('soloView');
    document.body.dataset.phase = 'solo';
    history.replaceState(null, '', `${location.pathname}#solo`);
    fillSelect($('soloGridSelect'), [8, 9, 16, 17], solo.size);
    fillSelect($('soloDiffSelect'), ['easy', 'medium', 'hard', 'mix'], solo.difficulty);
    if (!solo.grid.length) soloReset();
    if (!solo.word) soloNewWord();
    soloRender();
    window.KeepAwake?.set(true);
  }
  $('soloBtn').addEventListener('click', startSolo);
  $('soloNewBtn').addEventListener('click', soloNewWord);
  $('soloDiffSelect').addEventListener('change', (e) => { solo.difficulty = e.target.value; soloNewWord(); });
  $('soloGridSelect').addEventListener('change', (e) => {
    const size = Number(e.target.value);
    if (solo.grid.some(Boolean) && !confirm('Changing the grid size clears your drawing. Go ahead?')) {
      e.target.value = String(solo.size);
      return;
    }
    soloReset(size);
    soloRender();
  });
  $('undoBtn').addEventListener('click', () => {
    if (!solo.history.length) return;
    solo.grid = solo.history.pop();
    soloRender();
  });
  $('soloClearBtn').addEventListener('click', () => {
    if (!solo.grid.some(Boolean)) return;
    soloSnapshot();
    solo.grid = Array(solo.size * solo.size).fill(null);
    soloRender();
  });
  $('soloSaveBtn').addEventListener('click', () => {
    const name = localStorage.getItem('pixelary-name') || $('nameInput').value.trim() || 'You';
    PixelArt.save([{ word: solo.word || 'Free draw', gridSize: solo.size, grid: solo.grid, artist: name, avatar: '🎨', round: 1 }],
      'Free draw', `pixelary-${PixelArt.slug(solo.word || 'free-draw')}.png`);
  });

  // Typed commands go through the same parser as the game (on the server).
  $('soloForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const text = $('soloInput').value.trim();
    if (!text) return;
    socket.emit('solo_parse', { text, gridSize: solo.size }, (res) => {
      if (!res?.ok) {
        $('soloError').textContent = res?.error || 'Hmm, try again';
        $('soloError').classList.remove('info');
        shake($('soloForm'));
        return;
      }
      soloSnapshot();
      for (const c of res.cells) solo.grid[c] = res.hex;
      solo.log.unshift({ text, hex: res.hex, known: res.known });
      solo.log.length = Math.min(solo.log.length, 40);
      $('soloError').textContent = res.known ? '' : `🎲 “${res.colorWord}” isn't a color I know, so here's a surprise!`;
      $('soloError').classList.toggle('info', !res.known);
      $('soloInput').value = '';
      soloRender();
    });
  });
  $('soloInput').addEventListener('input', () => { $('soloError').textContent = ''; });

  // Click / tap / drag to paint with the chosen palette color (or the eraser).
  let stroke = null; // cells painted in the current drag
  function paintAt(x, y) {
    const cell = document.elementFromPoint(x, y)?.closest('#soloGrid .px');
    if (!cell) return;
    const i = Number(cell.dataset.i);
    if (stroke.has(i)) return;
    stroke.add(i);
    solo.grid[i] = solo.color;
    soloRender();
  }
  $('soloGrid').addEventListener('pointerdown', (e) => {
    e.preventDefault();
    soloSnapshot();
    stroke = new Set();
    paintAt(e.clientX, e.clientY);
  });
  window.addEventListener('pointermove', (e) => { if (stroke) paintAt(e.clientX, e.clientY); });
  for (const ev of ['pointerup', 'pointercancel']) {
    window.addEventListener(ev, () => {
      // A drag that changed nothing shouldn't leave an empty undo step.
      if (stroke && !stroke.size) solo.history.pop();
      stroke = null;
    });
  }

  // ---------- boot ----------
  const autoRejoin = roomCode && localStorage.getItem('pixelary-name') && sessionStorage.getItem('pixelary-room') === roomCode;
  if (!autoRejoin && !roomCode && location.hash === '#solo') {
    startSolo(); // free-draw link / refresh while drawing solo
  } else if (!autoRejoin) {
    showView('homeView');
    setupHome();
    // Invite link: check right away that the game still exists.
    if (roomCode) socket.emit('check_room', { code: roomCode }, (res) => { if (!res?.exists) showNotFound(); });
  }
})();
