const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const { createRoom, getRoom } = require('./rooms');

const app = express();
const server = http.createServer(app);
// Check connections every 10s (timeout 8s) so a phone that silently drops (screen lock) is
// noticed within ~20s and the game pauses, instead of the default 25-45s.
const io = new Server(server, { pingInterval: 10_000, pingTimeout: 8_000 });

app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('/healthz', (_req, res) => res.send('ok'));

const safeAck = (ack) => (typeof ack === 'function' ? ack : () => {});
const validId = (id) => typeof id === 'string' && /^[a-zA-Z0-9_-]{8,64}$/.test(id);

io.on('connection', (socket) => {
  let room = null;
  let playerId = null;

  function enter(target, id, name, ack) {
    const result = target.addPlayer(id, socket.id, name);
    if (result.error) return ack({ ok: false, error: result.error });
    if (room && room !== target) {
      socket.leave(room.code);
      room.disconnect(playerId);
    }
    room = target;
    playerId = id;
    socket.join(target.code);
    ack({ ok: true, code: target.code });
    target.broadcast();
  }

  socket.on('create_room', ({ name, playerId: id } = {}, ack) => {
    ack = safeAck(ack);
    if (!validId(id)) return ack({ ok: false, error: 'Bad player id.' });
    enter(createRoom(io), id, name, ack);
  });

  socket.on('join_room', ({ code, name, playerId: id } = {}, ack) => {
    ack = safeAck(ack);
    if (!validId(id)) return ack({ ok: false, error: 'Bad player id.' });
    const target = getRoom(code);
    if (!target) return ack({ ok: false, error: `No game found with code ${String(code || '').toUpperCase()}.` });
    enter(target, id, name, ack);
  });

  // Lets an invite link check up front whether its game still exists.
  socket.on('check_room', ({ code } = {}, ack) => safeAck(ack)({ exists: !!getRoom(code) }));

  socket.on('set_ready', ({ ready } = {}) => room?.setReady(playerId, ready));
  socket.on('update_settings', (settings) => room?.updateSettings(playerId, settings));
  socket.on('start_game', (_data, ack) => safeAck(ack)(room ? room.start(playerId) : { error: 'Not in a room.' }));
  socket.on('play_again', () => room?.playAgain(playerId));
  socket.on('draw', ({ text } = {}, ack) => safeAck(ack)(room ? room.draw(playerId, text) : { ok: false, error: 'Not in a room.' }));
  socket.on('end_turn', (_data, ack) => safeAck(ack)(room ? room.endTurnEarly(playerId) : { ok: false, error: 'Not in a room.' }));
  socket.on('skip_word', (_data, ack) => safeAck(ack)(room ? room.skip(playerId) : { ok: false, error: 'Not in a room.' }));
  socket.on('guess', ({ text } = {}, ack) => safeAck(ack)((room && room.guess(playerId, text)) || {}));

  socket.on('disconnect', () => {
    // Only mark disconnected if this socket is still the player's current one (not replaced by a reconnect).
    const p = room?.players.get(playerId);
    if (p && p.socketId === socket.id) room.disconnect(playerId);
  });
});

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  server.listen(PORT, () => console.log(`🎨 Pixelary running at http://localhost:${PORT}`));
}

module.exports = { server, io };
