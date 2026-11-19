// End-to-end: real server + socket.io clients play through a turn.
const test = require('node:test');
const assert = require('node:assert/strict');
const { io: connect } = require('socket.io-client');
const { server, io } = require('../server/index');

const emit = (sock, ev, data) => new Promise((res) => sock.emit(ev, data, res));
const nextState = (sock, pred) =>
  new Promise((res) => {
    const h = (s) => { if (pred(s)) { sock.off('state', h); res(s); } };
    sock.on('state', h);
  });

let url;
test.before(async () => {
  await new Promise((r) => server.listen(0, r));
  url = `http://localhost:${server.address().port}`;
});
test.after(() => { io.close(); server.close(); });

test('create, join, ready, draw, guess, score', async (t) => {
  const host = connect(url, { transports: ['websocket'] });
  const guest = connect(url, { transports: ['websocket'] });
  t.after(() => { host.close(); guest.close(); });

  const created = await emit(host, 'create_room', { name: 'Hosty', playerId: 'host-12345678' });
  assert.equal(created.ok, true);
  assert.match(created.code, /^[A-Z]{4}$/);

  const joinedState = nextState(host, (s) => s.players.length === 2);
  const joined = await emit(guest, 'join_room', { code: created.code.toLowerCase(), name: 'Guesty', playerId: 'guest-12345678' });
  assert.equal(joined.ok, true);
  await joinedState;

  // Only the host can change settings; odd grid sizes are allowed.
  const nine = nextState(host, (st) => st.settings.gridSize === 9);
  guest.emit('update_settings', { gridSize: 17 });
  host.emit('update_settings', { gridSize: 9 });
  assert.equal((await nine).settings.gridSize, 9);
  const back = nextState(host, (st) => st.settings.gridSize === 8);
  host.emit('update_settings', { gridSize: 8 });
  await back;

  // Guest can't start; host can't start until all ready.
  assert.ok((await emit(guest, 'start_game', null)).error);
  assert.ok((await emit(host, 'start_game', null)).error);

  const allReady = nextState(host, (s) => s.canStart);
  host.emit('set_ready', { ready: true });
  guest.emit('set_ready', { ready: true });
  await allReady;

  const hostDrawing = nextState(host, (s) => s.phase === 'drawing');
  const guestDrawing = nextState(guest, (s) => s.phase === 'drawing');
  assert.equal((await emit(host, 'start_game', null)).ok, true);
  const hs = await hostDrawing;
  const gs = await guestDrawing;

  const hostIsDrawer = hs.game.drawerId === 'host-12345678';
  const [drawer, guesser, drawerState] = hostIsDrawer ? [host, guest, hs] : [guest, host, gs];
  const guesserState = hostIsDrawer ? gs : hs;
  assert.ok(drawerState.game.word, 'drawer sees the word');
  assert.equal(guesserState.game.word, null, 'guesser does not see the word');

  // Guesser can't draw; drawer can.
  assert.equal((await emit(guesser, 'draw', { text: 'red 1' })).ok, false);
  const painted = nextState(guesser, (s) => s.game?.grid[12] === '#00ff00');
  assert.equal((await emit(drawer, 'draw', { text: 'lime square big 13' })).ok, true);
  await painted;

  // Guesser can't skip; drawer can, which gives a new word and a blank grid.
  assert.equal((await emit(guesser, 'skip_word', null)).ok, false);
  const skipped = nextState(drawer, (s) => s.game.grid.every((c) => c === null));
  assert.equal((await emit(drawer, 'skip_word', null)).ok, true);
  const afterSkip = await skipped;
  assert.notEqual(afterSkip.game.word, drawerState.game.word);
  drawerState.game.word = afterSkip.game.word;

  // Wrong guess is visible to everyone; right guess ends turn (only 1 guesser).
  const wrongSeen = nextState(drawer, (s) => s.feed.some((f) => f.type === 'guess' && f.text === 'definitely wrong'));
  assert.equal((await emit(guesser, 'guess', { text: 'definitely wrong' })).correct, false);
  await wrongSeen;

  const reveal = nextState(drawer, (s) => s.phase === 'reveal');
  const right = await emit(guesser, 'guess', { text: ` ${drawerState.game.word.toUpperCase()}! ` });
  assert.equal(right.correct, true);
  assert.ok(right.points > 90 && right.points <= 100);
  const rs = await reveal;
  const scores = Object.fromEntries(rs.players.map((p) => [p.id === drawerState.you ? 'drawer' : 'guesser', p.score]));
  assert.equal(scores.drawer, 25);
  assert.equal(scores.guesser, right.points);
  assert.equal((await emit(drawer, 'skip_word', null)).ok, false, 'no skipping after the turn ends');
  assert.ok(!rs.feed.some((f) => f.text.toLowerCase().includes(drawerState.game.word.toLowerCase()) && f.type !== 'system'), 'correct guess text never shown');
});

test('with 3 players the turn ends only after BOTH guessers get it; clear erases', async (t) => {
  const socks = ['a', 'b', 'c'].map(() => connect(url, { transports: ['websocket'] }));
  socks.forEach((s) => s.on('state', (st) => { s.last = st; }));
  t.after(() => socks.forEach((s) => s.close()));
  const ids = ['player-aaaaaaaa', 'player-bbbbbbbb', 'player-cccccccc'];

  const { code } = await emit(socks[0], 'create_room', { name: 'A', playerId: ids[0] });
  await emit(socks[1], 'join_room', { code, name: 'B', playerId: ids[1] });
  const all = nextState(socks[0], (s) => s.players.length === 3 && s.canStart);
  socks.forEach((s) => s.emit('set_ready', { ready: true }));
  await emit(socks[2], 'join_room', { code, name: 'C', playerId: ids[2] });
  socks[2].emit('set_ready', { ready: true });
  await all;

  const drawing = nextState(socks[0], (s) => s.phase === 'drawing');
  await emit(socks[0], 'start_game', null);
  const st = await drawing;
  assert.equal(st.gridSize, 8);
  assert.equal(st.game.grid.length, 64);

  const d = ids.indexOf(st.game.drawerId);
  const drawer = socks[d];
  const guessers = socks.filter((_, i) => i !== d);
  // Drawer paints then erases one cell.
  const painted = nextState(guessers[0], (s) => s.game.grid[0] === '#ff0000' && s.game.grid[1] === '#ff0000');
  await emit(drawer, 'draw', { text: 'red 1 to 2' });
  await painted;
  const erased = nextState(guessers[0], (s) => s.game.grid[0] === null && s.game.grid[1] === '#ff0000');
  assert.equal((await emit(drawer, 'draw', { text: 'clear 1' })).ok, true);
  await erased;

  const secret = drawer.last.game.word;
  assert.ok(secret);

  // Drawer can't guess their own word.
  assert.ok((await emit(drawer, 'guess', { text: secret })).error);

  // First guesser: turn keeps going.
  const first = await emit(guessers[0], 'guess', { text: secret });
  assert.equal(first.correct, true);
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(guessers[1].last.phase, 'drawing', 'still drawing after 1 of 2 guessed');

  // Second guesser: everyone (n-1) has it, turn ends.
  const reveal = nextState(drawer, (s) => s.phase === 'reveal');
  assert.equal((await emit(guessers[1], 'guess', { text: secret })).correct, true);
  const rs = await reveal;
  assert.ok(rs.feed.some((f) => f.text === 'Everyone got it! ⚡'));
  assert.equal(rs.players.find((p) => p.id === ids[d]).score, 50);
});
