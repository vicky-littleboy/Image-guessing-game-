const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = createServer(app);
const io = new Server(server);
const PORT = 5000;

// Rooms: roomId => { players: [...], host, refereeId, currentAnswers, refereeHistory }
const rooms = new Map();

app.use(express.static('public'));

io.on('connection', (socket) => {
  let currentRoom = null;
  let playerName = null;
  
  socket.on('createRoom', (data) => {
    const roomId = uuidv4();
    playerName = data.name;
    const avatar = data.avatar;
    currentRoom = roomId;
    rooms.set(roomId, {
      players: [{ id: socket.id, name: playerName, avatar: avatar, isHost: true, ready: false, score: 0, winCount: 0 }],
      host: socket.id,
      refereeId: null,
      currentAnswers: {},
      refereeHistory: [] // track referees so far
    });
    socket.join(roomId);
    socket.emit('roomCreated', roomId);
    io.to(roomId).emit('playerJoined', rooms.get(roomId).players);
  });
  
  socket.on('joinRoom', ({ name, roomId, avatar }) => {
    if (!rooms.has(roomId)) {
      socket.emit('error', 'Room does not exist');
      return;
    }
    const room = rooms.get(roomId);
    if (room.players.length >= 4) {
      socket.emit('error', 'Room is full');
      return;
    }
    playerName = name;
    currentRoom = roomId;
    room.players.push({ id: socket.id, name: playerName, avatar: avatar, isHost: false, ready: false, score: 0, winCount: 0 });
    socket.join(roomId);
    io.to(roomId).emit('playerJoined', room.players);
  });
  
  socket.on('sendMessage', (msg) => {
    io.to(currentRoom).emit('newMessage', { name: playerName, message: msg });
  });
  
  socket.on('startGame', () => {
    const room = rooms.get(currentRoom);
    if (room && room.host === socket.id) {
      io.to(currentRoom).emit('gameStarting');
    }
  });
  
  // Updated chooseReferee logic: choose from players who haven’t yet been referee in this game.
  socket.on("chooseReferee", () => {
    if (!currentRoom || !rooms.has(currentRoom)) return;
    const room = rooms.get(currentRoom);
    if (!room.players || room.players.length < 1) return;
    
    // Filter eligible players (those not in refereeHistory)
    let eligiblePlayers = room.players.filter(p => !room.refereeHistory.includes(p.id));
    // If everyone has been referee, reset the history so repeats are allowed.
    if (eligiblePlayers.length === 0) {
      eligiblePlayers = room.players;
      room.refereeHistory = [];
    }
    
    let randomIndex = Math.floor(Math.random() * eligiblePlayers.length);
    let newReferee = eligiblePlayers[randomIndex];
    
    // Mark new referee as having been referee (if not already)
    if (!room.refereeHistory.includes(newReferee.id)) {
      room.refereeHistory.push(newReferee.id);
    }
    
    room.refereeId = newReferee.id;
    io.to(currentRoom).emit("setReferee", { refereeId: newReferee.id });
  });
  
  socket.on('prevImageControl', () => {
    if (currentRoom) io.to(currentRoom).emit('prevImageControl');
  });
  
  socket.on('nextImageControl', () => {
    if (currentRoom) io.to(currentRoom).emit('nextImageControl');
  });
  
  socket.on('startImage', () => {
    if (currentRoom) io.to(currentRoom).emit('startImage');
  });
  
  socket.on('submitAnswer', (data) => {
    if (!currentRoom || !rooms.has(currentRoom)) return;
    const room = rooms.get(currentRoom);
    const time = Date.now();
    const p = room.players.find(p => p.id === socket.id);
    room.currentAnswers[socket.id] = { name: p ? p.name : "Unknown", answer: data.answer, time: time };
  });
  
  socket.on('revealAnswerControl', () => {
    if (currentRoom) {
      const room = rooms.get(currentRoom);
      io.to(currentRoom).emit('revealAnswers', room.currentAnswers);
      io.to(currentRoom).emit('revealAnswerControl');
      room.currentAnswers = {};
    }
  });
  
  // Award points based on answer order.
  socket.on('markAnswersCorrect', (ids) => {
    if (!currentRoom || !rooms.has(currentRoom)) return;
    const room = rooms.get(currentRoom);
    const points = [100, 50, 20, 10];
    ids.forEach((id, idx) => {
      const p = room.players.find(p => p.id === id);
      if (p) { p.score = (p.score || 0) + (points[idx] || 0); }
    });
    io.to(currentRoom).emit('scoreUpdated', room.players);
  });
  
  // When a section ends, emit nextSection.
  socket.on("nextSection", () => {
    if (!currentRoom || !rooms.has(currentRoom)) return;
    const room = rooms.get(currentRoom);
    io.to(currentRoom).emit("nextSection");
    // The current referee is now expected (via client UI) to spin the wheel
    // to choose a new referee for the upcoming section.
  });
  
  socket.on("endGame", () => {
    if (!currentRoom || !rooms.has(currentRoom)) return;
    const room = rooms.get(currentRoom);
    io.to(currentRoom).emit("endGame", room.players);
  });
  
  socket.on('disconnect', () => {
    if (currentRoom && rooms.has(currentRoom)) {
      const room = rooms.get(currentRoom);
      room.players = room.players.filter(p => p.id !== socket.id);
      if (room.players.length === 0) {
        rooms.delete(currentRoom);
      } else {
        if (room.refereeId === socket.id) {
          const newRef = room.players[Math.floor(Math.random() * room.players.length)];
          room.refereeId = newRef.id;
          io.to(currentRoom).emit("setReferee", { refereeId: newRef.id });
        }
        io.to(currentRoom).emit('playerJoined', room.players);
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
