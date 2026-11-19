const test = require('node:test');
const assert = require('node:assert/strict');
const { Room } = require('../server/rooms');

// Minimal stand-in for socket.io: we only read state via stateFor().
const fakeIo = { to: () => ({ emit() {} }) };

function finishedGame() {
  const room = new Room(fakeIo, 'TEST');
  room.addPlayer('host-1234567', 's1', 'Host');
  room.addPlayer('guest-123456', 's2', 'Guest');
  room.updateSettings('host-1234567', { rounds: 3, gridSize: 9, turnTime: 0 });
  room.setReady('host-1234567', true);
  room.setReady('guest-123456', true);
  assert.equal(room.start('host-1234567').ok, true);
  room.players.get('guest-123456').score = 180;
  room.finish();
  return room;
}

test('rematch: host starts a new game with the same players and settings', (t) => {
  const room = finishedGame();
  t.after(() => room.destroy());
  assert.equal(room.rematch('guest-123456').ok, false, 'only the host');
  assert.equal(room.rematch('host-1234567').ok, true);
  const st = room.stateFor('guest-123456');
  assert.equal(st.phase, 'drawing');
  assert.equal(st.players.length, 2);
  assert.ok(st.players.every((p) => p.score === 0), 'scores reset');
  assert.equal(st.settings.rounds, 3);
  assert.equal(st.gridSize, 9);
  assert.equal(st.game.noTimer, true);
  assert.equal(room.rematch('host-1234567').ok, false, 'not mid-game');
});

test('rematch drops players who left, and needs 2 connected', (t) => {
  const room = finishedGame();
  t.after(() => room.destroy());
  room.players.get('guest-123456').connected = false;
  assert.equal(room.rematch('host-1234567').ok, false);
  assert.equal(room.players.size, 1);
});

test('change settings: back to the lobby with everyone still ready', (t) => {
  const room = finishedGame();
  t.after(() => room.destroy());
  room.playAgain('guest-123456'); // ignored: not the host
  assert.equal(room.phase, 'results');
  room.playAgain('host-1234567');
  const st = room.stateFor('host-1234567');
  assert.equal(st.phase, 'lobby');
  assert.ok(st.players.every((p) => p.ready));
  assert.equal(st.canStart, true, 'host can start right after tweaking settings');
  room.updateSettings('host-1234567', { gridSize: 16 });
  assert.equal(room.start('host-1234567').ok, true);
  assert.equal(room.stateFor('host-1234567').gridSize, 16);
});

test('defaults: 120s turns (75s minimum), 5s answer reveal', (t) => {
  const room = new Room(fakeIo, 'DEFS');
  t.after(() => room.destroy());
  room.addPlayer('host-1234567', 's1', 'Host');
  const st = room.stateFor('host-1234567');
  assert.equal(st.settings.turnTime, 120);
  assert.equal(st.settings.revealTime, 5);
  assert.deepEqual(st.allowed.turnTime.filter(Boolean).sort((a, b) => a - b)[0], 75);
  room.updateSettings('host-1234567', { turnTime: 45 });
  assert.equal(room.settings.turnTime, 120, '45s is no longer allowed');
});

test("guessers can't see the drawer's commands until the word is revealed", (t) => {
  const room = new Room(fakeIo, 'LOGS');
  t.after(() => room.destroy());
  room.addPlayer('host-1234567', 's1', 'Host');
  room.addPlayer('guest-123456', 's2', 'Guest');
  room.setReady('host-1234567', true);
  room.setReady('guest-123456', true);
  room.start('host-1234567');
  const drawer = room.game.drawerId;
  const guesser = drawer === 'host-1234567' ? 'guest-123456' : 'host-1234567';
  assert.equal(room.draw(drawer, 'banana circle big 28').ok, true);
  assert.equal(room.stateFor(drawer).game.log.length, 1);
  assert.deepEqual(room.stateFor(guesser).game.log, []);
  assert.equal(room.stateFor(guesser).game.grid.filter(Boolean).length, 21, 'but the drawing itself is visible');
  room.endTurn();
  assert.equal(room.stateFor(guesser).game.log[0].text, 'banana circle big 28');
});
