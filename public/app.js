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

  // ---------- rainbow logo ----------
  $('logo').innerHTML = [...'Pixelary'].map((ch, i) => `<span style="color:${CHAOS[i % CHAOS.length]};animation-delay:${i * 0.08}s">${ch}</span>`).join('');

  // ---------- socket ----------
  const socket = io();
  socket.on('connect', () => {
    // Re-join automatically after a refresh / reconnect.
    const name = localStorage.getItem('pixelary-name');
    if (roomCode && name && sessionStorage.getItem('pixelary-room') === roomCode) join(roomCode, name);
  });
  socket.on('state', (s) => { state = s; render(); });
  socket.on('celebrate', ({ playerId: who }) => burst(who === playerId ? 160 : 60));
  socket.on('disconnect', () => toast('Lost connection… reconnecting 🔌'));

  function join(code, name) {
    socket.emit('join_room', { code, name, playerId }, (res) => {
      if (!res.ok) {
        sessionStorage.removeItem('pixelary-room');
        showView('homeView');
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
  function setupHome() {
    $('nameInput').value = localStorage.getItem('pixelary-name') || '';
    if (roomCode) {
      $('homeTitle').textContent = `You're invited! 🎉`;
      $('homeSub').textContent = `Join room ${roomCode} and get ready to paint with words.`;
      $('homeSubmit').textContent = '🚪 Join game';
      $('joinCodeBox').hidden = true;
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
    socket.emit('update_settings', { rounds: Number($('roundsSelect').value), turnTime: Number($('timeSelect').value), difficulty: $('difficultySelect').value, gridSize: Number($('gridSelect').value) });
  for (const id of ['roundsSelect', 'timeSelect', 'difficultySelect', 'gridSelect']) $(id).addEventListener('change', sendSettings);
  $('startBtn').addEventListener('click', () => socket.emit('start_game', null, (res) => res?.error && toast(res.error)));
  $('againBtn').addEventListener('click', () => socket.emit('play_again'));

  // ---------- drawing ----------
  const SHAPES = ['dot', 'square', 'box', 'circle', 'ring', 'plus', 'x', 'line', 'row', 'col', 'diamond', 'triangle'];
  const SIZES = ['small', 'big', 'huge'];
  const chip = (w) => `<button type="button" class="chip" data-w="${w}">${w}</button>`;
  $('chips').innerHTML =
    `<div><b>colors</b> any word: try <i>lava</i>, or make one up for a surprise 🎲</div>` +
    `<div><b>shapes</b> ${SHAPES.map(chip).join('')}</div>` +
    `<div><b>sizes</b> ${SIZES.map(chip).join('')} <span class="sub small">or a number: <code>square 3 50</code></span></div>` +
    `<div><b>cells</b> <code>13</code> · <code>1, 6, 11</code> · <code>1 to 21</code></div>`;
  $('chips').addEventListener('click', (e) => {
    const w = e.target.closest('.chip')?.dataset.w;
    if (!w) return;
    const input = $('drawInput');
    input.value = (input.value.trim() + ' ' + w).trim() + ' ';
    input.focus();
  });

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
        fillSelect($('difficultySelect'), state.allowed.difficulty, state.settings.difficulty);
        fillSelect($('gridSelect'), state.allowed.gridSize, state.settings.gridSize);
      } else {
        const st = state.settings;
        $('settingsSummary').innerHTML =
          `<li><span>Rounds</span><b>${st.rounds}</b></li>` +
          `<li><span>Seconds per turn</span><b>${st.turnTime}</b></li>` +
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
      $('againBtn').hidden = !isHost;
      $('againNote').textContent = isHost ? '' : 'Waiting for the host…';
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

    // grid
    const size = state.gridSize;
    const gridEl = $('pixelGrid');
    gridEl.style.setProperty('--n', size);
    gridEl.classList.toggle('dense', size > 10);
    if (gridEl.children.length !== size * size) {
      gridEl.innerHTML = Array.from({ length: size * size }, (_, i) => `<div class="px"><span>${i + 1}</span></div>`).join('');
    }
    g.grid.forEach((hex, i) => {
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

    $('drawLog').innerHTML = g.log
      .map((l) => `<li><span class="swatch ${l.hex ? '' : 'erased'}" style="${l.hex ? `background:${esc(l.hex)}` : ''}"></span>${esc(l.text)}${l.known ? '' : ' 🎲'}</li>`)
      .join('');

    $('drawPanel').hidden = !(isDrawer && state.phase === 'drawing');
    $('skipBtn').hidden = !g.canSkip; // gone once someone has guessed
    const canGuess = state.phase === 'drawing' && !isDrawer && !g.youGuessed;
    $('guessForm').hidden = !canGuess;
    $('guessStatus').hidden = canGuess;
    $('guessStatus').textContent =
      state.phase === 'reveal' ? 'Next turn coming up…' : isDrawer ? 'You’re drawing! Watch the guesses roll in 👀' : '✅ You got it! Shhh 🤫';
    if (!canGuess) $('guessError').textContent = '';
    else if (document.activeElement !== $('guessInput') && document.activeElement?.tagName !== 'INPUT') $('guessInput').focus();
    if (!$('drawPanel').hidden && document.activeElement !== $('drawInput')) $('drawInput').focus();

    // scoreboard
    const sorted = [...state.players].sort((a, b) => b.score - a.score);
    $('gamePlayers').innerHTML = sorted
      .map((p) => playerItem(p, p.guessed ? 'guessed' : '') + `${p.id === g.drawerId ? '<span class="badge drawing">✏️</span>' : p.guessed ? '<span class="badge ready">✅</span>' : ''}<span class="score">${p.score}</span></li>`)
      .join('');

    renderFeed();
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
    const label = (o) => (o === 'mix' ? 'mix it up' : sel.id === 'gridSelect' ? gridLabel(o) : o);
    if (sel.options.length !== options.length) sel.innerHTML = options.map((o) => `<option value="${o}">${label(o)}</option>`).join('');
    if (document.activeElement !== sel) sel.value = String(value);
  }

  // timer tick
  setInterval(() => {
    if (!state?.game || (state.phase !== 'drawing' && state.phase !== 'reveal')) return;
    const s = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
    const t = $('timer');
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

  // ---------- boot ----------
  const autoRejoin = roomCode && localStorage.getItem('pixelary-name') && sessionStorage.getItem('pixelary-room') === roomCode;
  if (!autoRejoin) { showView('homeView'); setupHome(); }
})();
