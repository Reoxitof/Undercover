const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static(path.join(__dirname, 'public')));

// ─── WORD PAIRS (mot civil / mot undercover) ───
const wordPairs = [
  ["Pistolet", "Revolver"],
  ["Voiture", "Camion"],
  ["Café", "Thé"],
  ["Chien", "Loup"],
  ["Soleil", "Lune"],
  ["Pizza", "Burger"],
  ["Avion", "Hélicoptère"],
  ["Guitare", "Violon"],
  ["Football", "Rugby"],
  ["Plage", "Piscine"],
  ["Cinéma", "Théâtre"],
  ["Bière", "Vin"],
  ["Montagne", "Colline"],
  ["Train", "Métro"],
  ["Chapeau", "Casquette"],
  ["Couteau", "Épée"],
  ["Diamant", "Or"],
  ["Roi", "Empereur"],
  ["Fantôme", "Zombie"],
  ["Banque", "Coffre-fort"],
  ["Sniper", "Fusil"],
  ["Menottes", "Corde"],
  ["Prison", "Cellule"],
  ["Détective", "Espion"],
  ["Masque", "Cagoule"],
  ["Drogue", "Médicament"],
  ["Flic", "Agent"],
  ["Braquage", "Vol"],
  ["Patron", "Chef"],
  ["Territoire", "Quartier"],
  ["Muscle", "Garde du corps"],
  ["Limousine", "Berline"],
  ["Cigare", "Cigarette"],
  ["Costume", "Smoking"],
  ["Négociation", "Chantage"],
  ["Informateur", "Balance"],
  ["Planque", "Cachette"],
  ["Cartel", "Mafia"],
  ["Rançon", "Butin"],
  ["Silencieux", "Suppresseur"]
];

// ─── GAME STATE ───
const rooms = new Map();

function createRoom(hostName) {
  const code = generateRoomCode();
  const room = {
    code,
    host: null,
    players: [],
    state: 'lobby', // lobby, playing, voting, results
    round: 0,
    maxRounds: 3,
    currentPair: null,
    undercoverIndices: [],
    mrWhiteIndex: -1,
    votes: {},
    descriptions: {},
    currentPlayerIndex: 0,
    eliminatedPlayers: [],
    settings: {
      undercoverCount: 1,
      mrWhite: false,
      maxPlayers: 10,
      minPlayers: 3
    }
  };
  rooms.set(code, room);
  return room;
}

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 5; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  if (rooms.has(code)) return generateRoomCode();
  return code;
}

function assignRoles(room) {
  const pair = wordPairs[Math.floor(Math.random() * wordPairs.length)];
  room.currentPair = pair;
  room.undercoverIndices = [];
  room.mrWhiteIndex = -1;

  const activePlayers = room.players.filter(p => !room.eliminatedPlayers.includes(p.id));
  const indices = activePlayers.map((_, i) => i);

  // Assign undercover(s)
  for (let i = 0; i < room.settings.undercoverCount; i++) {
    const randIdx = Math.floor(Math.random() * indices.length);
    room.undercoverIndices.push(indices[randIdx]);
    indices.splice(randIdx, 1);
  }

  // Assign Mr. White if enabled
  if (room.settings.mrWhite && indices.length > 0) {
    const randIdx = Math.floor(Math.random() * indices.length);
    room.mrWhiteIndex = indices[randIdx];
    indices.splice(randIdx, 1);
  }

  // Send words to players
  activePlayers.forEach((player, idx) => {
    let word = '';
    let role = 'civil';

    if (room.undercoverIndices.includes(idx)) {
      word = pair[1]; // undercover word
      role = 'undercover';
    } else if (idx === room.mrWhiteIndex) {
      word = '???';
      role = 'mrwhite';
    } else {
      word = pair[0]; // civil word
      role = 'civil';
    }

    player.word = word;
    player.role = role;

    sendToPlayer(player, {
      type: 'role_assigned',
      word,
      role
    });
  });
}

function sendToPlayer(player, data) {
  if (player.ws && player.ws.readyState === WebSocket.OPEN) {
    player.ws.send(JSON.stringify(data));
  }
}

function broadcastToRoom(room, data, excludeId = null) {
  room.players.forEach(player => {
    if (player.id !== excludeId) {
      sendToPlayer(player, data);
    }
  });
}

function broadcastRoomState(room) {
  const publicPlayers = room.players.map(p => ({
    id: p.id,
    name: p.name,
    isHost: p.id === room.host,
    eliminated: room.eliminatedPlayers.includes(p.id),
    hasDescribed: !!room.descriptions[p.id]
  }));

  broadcastToRoom(room, {
    type: 'room_update',
    state: room.state,
    players: publicPlayers,
    round: room.round,
    code: room.code,
    settings: room.settings,
    currentPlayerIndex: room.currentPlayerIndex,
    votes: room.state === 'results' ? room.votes : undefined
  });
}

function startGame(room) {
  if (room.players.length < room.settings.minPlayers) return false;

  room.state = 'playing';
  room.round = 1;
  room.eliminatedPlayers = [];
  room.descriptions = {};
  room.votes = {};
  room.currentPlayerIndex = 0;

  assignRoles(room);
  broadcastToRoom(room, { type: 'game_started' });
  broadcastRoomState(room);
  return true;
}

function handleVote(room, voterId, targetId) {
  room.votes[voterId] = targetId;

  const activePlayers = room.players.filter(p => !room.eliminatedPlayers.includes(p.id));
  const activeVoters = activePlayers.filter(p => !room.eliminatedPlayers.includes(p.id));

  if (Object.keys(room.votes).length >= activeVoters.length) {
    // Count votes
    const voteCounts = {};
    Object.values(room.votes).forEach(target => {
      voteCounts[target] = (voteCounts[target] || 0) + 1;
    });

    // Find most voted
    let maxVotes = 0;
    let eliminated = null;
    Object.entries(voteCounts).forEach(([playerId, count]) => {
      if (count > maxVotes) {
        maxVotes = count;
        eliminated = playerId;
      }
    });

    // Check for tie
    const tiedPlayers = Object.entries(voteCounts).filter(([_, count]) => count === maxVotes);
    if (tiedPlayers.length > 1) {
      // Tie - no elimination
      broadcastToRoom(room, {
        type: 'vote_result',
        result: 'tie',
        voteCounts
      });
    } else {
      // Eliminate player
      room.eliminatedPlayers.push(eliminated);
      const eliminatedPlayer = room.players.find(p => p.id === eliminated);

      broadcastToRoom(room, {
        type: 'vote_result',
        result: 'eliminated',
        eliminatedId: eliminated,
        eliminatedName: eliminatedPlayer ? eliminatedPlayer.name : 'Inconnu',
        eliminatedRole: eliminatedPlayer ? eliminatedPlayer.role : 'unknown',
        voteCounts
      });

      // Check Mr. White guess
      if (eliminatedPlayer && eliminatedPlayer.role === 'mrwhite') {
        room.state = 'mrwhite_guess';
        sendToPlayer(eliminatedPlayer, { type: 'mrwhite_guess_prompt' });
        broadcastRoomState(room);
        return;
      }
    }

    // Check win conditions
    const result = checkWinCondition(room);
    if (result) {
      endGame(room, result);
    } else {
      // Next round
      room.round++;
      room.votes = {};
      room.descriptions = {};
      room.currentPlayerIndex = 0;
      room.state = 'playing';
      broadcastRoomState(room);
    }
  } else {
    broadcastRoomState(room);
  }
}

function checkWinCondition(room) {
  const activePlayers = room.players.filter(p => !room.eliminatedPlayers.includes(p.id));
  const activeUndercovers = activePlayers.filter(p => p.role === 'undercover');
  const activeMrWhite = activePlayers.filter(p => p.role === 'mrwhite');
  const activeCivils = activePlayers.filter(p => p.role === 'civil');

  // Undercover wins if equal or more than civils
  if (activeUndercovers.length >= activeCivils.length && activeMrWhite.length === 0) {
    return { winner: 'undercover', reason: 'Les Undercover ont infiltré le groupe !' };
  }

  // All undercovers eliminated = civils win
  if (activeUndercovers.length === 0 && activeMrWhite.length === 0) {
    return { winner: 'civil', reason: 'Tous les infiltrés ont été démasqués !' };
  }

  return null;
}

function endGame(room, result) {
  room.state = 'results';

  const revealedPlayers = room.players.map(p => ({
    id: p.id,
    name: p.name,
    role: p.role,
    word: p.word,
    eliminated: room.eliminatedPlayers.includes(p.id)
  }));

  broadcastToRoom(room, {
    type: 'game_over',
    winner: result.winner,
    reason: result.reason,
    players: revealedPlayers,
    civilWord: room.currentPair[0],
    undercoverWord: room.currentPair[1]
  });
}

// ─── WEBSOCKET HANDLING ───
wss.on('connection', (ws) => {
  const playerId = uuidv4();

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch (e) {
      return;
    }

    switch (msg.type) {
      case 'create_room': {
        const room = createRoom(msg.name);
        const player = { id: playerId, name: msg.name, ws, word: '', role: '' };
        room.players.push(player);
        room.host = playerId;
        sendToPlayer(player, { type: 'room_created', code: room.code, playerId });
        broadcastRoomState(room);
        break;
      }

      case 'join_room': {
        const room = rooms.get(msg.code.toUpperCase());
        if (!room) {
          ws.send(JSON.stringify({ type: 'error', message: 'Salon introuvable' }));
          return;
        }
        if (room.state !== 'lobby') {
          ws.send(JSON.stringify({ type: 'error', message: 'Partie déjà en cours' }));
          return;
        }
        if (room.players.length >= room.settings.maxPlayers) {
          ws.send(JSON.stringify({ type: 'error', message: 'Salon complet' }));
          return;
        }
        const player = { id: playerId, name: msg.name, ws, word: '', role: '' };
        room.players.push(player);
        sendToPlayer(player, { type: 'room_joined', code: room.code, playerId });
        broadcastRoomState(room);
        break;
      }

      case 'start_game': {
        const room = findPlayerRoom(playerId);
        if (!room || room.host !== playerId) return;
        if (!startGame(room)) {
          ws.send(JSON.stringify({ type: 'error', message: 'Pas assez de joueurs (min 3)' }));
        }
        break;
      }

      case 'submit_description': {
        const room = findPlayerRoom(playerId);
        if (!room || room.state !== 'playing') return;
        if (room.eliminatedPlayers.includes(playerId)) return;

        room.descriptions[playerId] = msg.description;
        broadcastToRoom(room, {
          type: 'player_described',
          playerId,
          playerName: room.players.find(p => p.id === playerId)?.name,
          description: msg.description
        });

        // Check if all active players have described
        const activePlayers = room.players.filter(p => !room.eliminatedPlayers.includes(p.id));
        if (Object.keys(room.descriptions).length >= activePlayers.length) {
          room.state = 'voting';
          broadcastToRoom(room, { type: 'voting_phase' });
          broadcastRoomState(room);
        }
        break;
      }

      case 'submit_vote': {
        const room = findPlayerRoom(playerId);
        if (!room || room.state !== 'voting') return;
        if (room.eliminatedPlayers.includes(playerId)) return;
        if (msg.targetId === playerId) return; // Can't vote for yourself

        handleVote(room, playerId, msg.targetId);
        break;
      }

      case 'mrwhite_guess': {
        const room = findPlayerRoom(playerId);
        if (!room || room.state !== 'mrwhite_guess') return;
        const player = room.players.find(p => p.id === playerId);
        if (!player || player.role !== 'mrwhite') return;

        const correct = msg.guess.toLowerCase().trim() === room.currentPair[0].toLowerCase().trim();
        if (correct) {
          endGame(room, { winner: 'mrwhite', reason: 'Mr. White a deviné le mot des civils !' });
        } else {
          broadcastToRoom(room, {
            type: 'mrwhite_guess_result',
            correct: false,
            guess: msg.guess
          });
          const result = checkWinCondition(room);
          if (result) {
            endGame(room, result);
          } else {
            room.round++;
            room.votes = {};
            room.descriptions = {};
            room.currentPlayerIndex = 0;
            room.state = 'playing';
            broadcastRoomState(room);
          }
        }
        break;
      }

      case 'update_settings': {
        const room = findPlayerRoom(playerId);
        if (!room || room.host !== playerId || room.state !== 'lobby') return;
        if (msg.settings) {
          room.settings = { ...room.settings, ...msg.settings };
          broadcastRoomState(room);
        }
        break;
      }

      case 'restart_game': {
        const room = findPlayerRoom(playerId);
        if (!room || room.host !== playerId) return;
        room.state = 'lobby';
        room.round = 0;
        room.eliminatedPlayers = [];
        room.descriptions = {};
        room.votes = {};
        room.currentPlayerIndex = 0;
        room.players.forEach(p => { p.word = ''; p.role = ''; });
        broadcastToRoom(room, { type: 'game_restarted' });
        broadcastRoomState(room);
        break;
      }
    }
  });

  ws.on('close', () => {
    const room = findPlayerRoom(playerId);
    if (!room) return;

    room.players = room.players.filter(p => p.id !== playerId);

    if (room.players.length === 0) {
      rooms.delete(room.code);
      return;
    }

    // Transfer host if needed
    if (room.host === playerId) {
      room.host = room.players[0].id;
    }

    broadcastRoomState(room);
  });
});

function findPlayerRoom(playerId) {
  for (const [_, room] of rooms) {
    if (room.players.find(p => p.id === playerId)) {
      return room;
    }
  }
  return null;
}

// ─── START SERVER ───
const PORT = process.env.PORT || 3333;
server.listen(PORT, () => {
  console.log(`🎭 UnderCover Elite Corp — Serveur lancé sur le port ${PORT}`);
  console.log(`   → http://localhost:${PORT}`);
});
