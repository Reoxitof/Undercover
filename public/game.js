// ═══════════════════════════════════════════════════
// UNDERCOVER — ELITE CORP. EDITION
// Client-side Game Logic
// ═══════════════════════════════════════════════════

let ws = null;
let playerId = null;
let roomCode = null;
let isHost = false;
let currentVoteTarget = null;
let myWord = '';
let myRole = '';
let hasDescribed = false;
let latestPlayers = [];

// ─── DOM ELEMENTS ───
const screens = {
  home: document.getElementById('screen-home'),
  rules: document.getElementById('screen-rules'),
  lobby: document.getElementById('screen-lobby'),
  game: document.getElementById('screen-game'),
  vote: document.getElementById('screen-vote'),
  voteResult: document.getElementById('screen-vote-result'),
  mrwhite: document.getElementById('screen-mrwhite'),
  gameover: document.getElementById('screen-gameover')
};

// ─── UTILITY ───
function showScreen(name) {
  Object.values(screens).forEach(s => s.classList.remove('active'));
  screens[name].classList.add('active');
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  const icons = { info: 'fa-info-circle', success: 'fa-check-circle', error: 'fa-exclamation-circle', warning: 'fa-exclamation-triangle' };
  toast.innerHTML = `<i class="fas ${icons[type] || icons.info}"></i> ${message}`;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ─── WEBSOCKET CONNECTION ───
function connect() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}`;
  ws = new WebSocket(wsUrl);

  ws.onopen = () => console.log('🔌 Connecté au serveur');

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    handleMessage(msg);
  };

  ws.onclose = () => {
    showToast('Connexion perdue. Rechargez la page.', 'error');
  };

  ws.onerror = () => {
    showToast('Erreur de connexion', 'error');
  };
}

function send(data) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

// ─── MESSAGE HANDLER ───
function handleMessage(msg) {
  switch (msg.type) {
    case 'room_created':
      playerId = msg.playerId;
      roomCode = msg.code;
      isHost = true;
      showScreen('lobby');
      document.getElementById('lobby-code').textContent = msg.code;
      document.getElementById('host-settings').classList.remove('hidden');
      document.getElementById('btn-start').classList.remove('hidden');
      document.getElementById('lobby-waiting').classList.add('hidden');
      showToast('Salon créé !', 'success');
      break;

    case 'room_joined':
      playerId = msg.playerId;
      roomCode = msg.code;
      isHost = false;
      showScreen('lobby');
      document.getElementById('lobby-code').textContent = msg.code;
      document.getElementById('host-settings').classList.add('hidden');
      document.getElementById('btn-start').classList.add('hidden');
      document.getElementById('lobby-waiting').classList.remove('hidden');
      showToast('Vous avez rejoint le salon', 'success');
      break;

    case 'room_update':
      latestPlayers = msg.players || [];
      updateLobby(msg);
      if (msg.state === 'playing') {
        document.getElementById('round-number').textContent = msg.round || 1;
      }
      break;

    case 'game_started':
      hasDescribed = false;
      showToast('La partie commence !', 'warning');
      break;

    case 'role_assigned':
      myWord = msg.word;
      myRole = msg.role;
      hasDescribed = false;
      showScreen('game');
      displayWord();
      resetGameUI();
      break;

    case 'player_described':
      addDescription(msg.playerName, msg.description);
      break;

    case 'voting_phase':
      showScreen('vote');
      buildVoteList(latestPlayers);
      document.getElementById('vote-confirm').classList.add('hidden');
      currentVoteTarget = null;
      showToast('Phase de vote !', 'warning');
      break;

    case 'vote_result':
      showVoteResult(msg);
      break;

    case 'mrwhite_guess_prompt':
      showScreen('mrwhite');
      break;

    case 'mrwhite_guess_result':
      if (!msg.correct) {
        showToast(`Mr. White a deviné "${msg.guess}" — FAUX !`, 'error');
      }
      break;

    case 'game_over':
      showGameOver(msg);
      break;

    case 'game_restarted':
      showScreen('lobby');
      hasDescribed = false;
      showToast('Nouvelle partie !', 'info');
      break;

    case 'error':
      showToast(msg.message, 'error');
      break;
  }
}

// ─── LOBBY UI ───
function updateLobby(data) {
  const list = document.getElementById('players-list');
  list.innerHTML = '';

  data.players.forEach(p => {
    const item = document.createElement('div');
    item.className = 'player-item';
    item.innerHTML = `
      <div class="player-avatar">${p.name.charAt(0).toUpperCase()}</div>
      <span class="player-name">${escapeHtml(p.name)}</span>
      ${p.isHost ? '<span class="player-badge badge-host">HOST</span>' : ''}
    `;
    list.appendChild(item);
  });

  if (isHost) {
    const btn = document.getElementById('btn-start');
    const minPlayers = data.settings?.minPlayers || 3;
    btn.disabled = data.players.length < minPlayers;
    btn.style.opacity = data.players.length < minPlayers ? '0.5' : '1';
  }
}

// ─── GAME UI ───
function displayWord() {
  document.getElementById('my-word').textContent = myWord;
  const roleBadge = document.getElementById('my-role-badge');

  if (myRole === 'mrwhite') {
    roleBadge.textContent = '🤫 Vous êtes Mr. White — Pas de mot !';
    roleBadge.style.color = 'var(--white)';
  } else {
    roleBadge.textContent = '';
  }
}

function resetGameUI() {
  document.getElementById('descriptions-list').innerHTML = '';
  document.getElementById('describe-section').classList.remove('hidden');
  document.getElementById('already-described').classList.add('hidden');
  document.getElementById('description-input').value = '';
}

function addDescription(name, text) {
  const list = document.getElementById('descriptions-list');
  const item = document.createElement('div');
  item.className = 'desc-item';
  item.innerHTML = `
    <span class="desc-name">${escapeHtml(name)}</span>
    <span class="desc-text">"${escapeHtml(text)}"</span>
  `;
  list.appendChild(item);
  list.scrollTop = list.scrollHeight;
}

// ─── VOTE UI ───
function buildVoteList(players) {
  const list = document.getElementById('vote-list');
  list.innerHTML = '';

  players.forEach(p => {
    if (p.id === playerId || p.eliminated) return;

    const item = document.createElement('div');
    item.className = 'vote-player';
    item.dataset.id = p.id;
    item.dataset.name = p.name;
    item.innerHTML = `
      <div class="player-avatar">${p.name.charAt(0).toUpperCase()}</div>
      <span class="vote-player-name">${escapeHtml(p.name)}</span>
      <i class="fas fa-crosshairs vote-player-icon"></i>
    `;
    item.addEventListener('click', () => selectVoteTarget(p.id, p.name));
    list.appendChild(item);
  });
}

function selectVoteTarget(id, name) {
  currentVoteTarget = id;
  document.querySelectorAll('.vote-player').forEach(el => {
    el.classList.toggle('selected', el.dataset.id === id);
  });
  document.getElementById('vote-confirm').classList.remove('hidden');
  document.getElementById('vote-target-name').textContent = name;
}

// ─── VOTE RESULT ───
function showVoteResult(msg) {
  showScreen('voteResult');
  const icon = document.getElementById('result-icon');
  const title = document.getElementById('result-title');
  const desc = document.getElementById('result-desc');

  if (msg.result === 'tie') {
    icon.className = 'result-icon tie';
    icon.innerHTML = '<i class="fas fa-balance-scale"></i>';
    title.textContent = 'ÉGALITÉ';
    desc.textContent = 'Personne n\'est éliminé ce tour.';
  } else {
    icon.className = 'result-icon eliminated';
    icon.innerHTML = '<i class="fas fa-skull"></i>';
    title.textContent = `${msg.eliminatedName.toUpperCase()} ÉLIMINÉ`;
    const roleLabels = { civil: 'Civil', undercover: 'Undercover', mrwhite: 'Mr. White' };
    desc.textContent = `Rôle : ${roleLabels[msg.eliminatedRole] || 'Inconnu'}`;
  }
}

// ─── GAME OVER ───
function showGameOver(msg) {
  showScreen('gameover');

  const icon = document.getElementById('gameover-icon');
  const title = document.getElementById('gameover-title');
  const reason = document.getElementById('gameover-reason');

  if (msg.winner === 'civil') {
    icon.className = 'gameover-icon civil-win';
    icon.innerHTML = '<i class="fas fa-shield-alt"></i>';
    title.textContent = 'VICTOIRE DES CIVILS';
  } else if (msg.winner === 'undercover') {
    icon.className = 'gameover-icon undercover-win';
    icon.innerHTML = '<i class="fas fa-user-secret"></i>';
    title.textContent = 'VICTOIRE UNDERCOVER';
  } else {
    icon.className = 'gameover-icon mrwhite-win';
    icon.innerHTML = '<i class="fas fa-ghost"></i>';
    title.textContent = 'VICTOIRE MR. WHITE';
  }

  reason.textContent = msg.reason;
  document.getElementById('reveal-civil').textContent = msg.civilWord;
  document.getElementById('reveal-undercover').textContent = msg.undercoverWord;

  const reveal = document.getElementById('players-reveal');
  reveal.innerHTML = '';
  msg.players.forEach(p => {
    const roleClass = `role-${p.role}`;
    const roleLabels = { civil: 'Civil', undercover: 'Undercover', mrwhite: 'Mr. White' };
    const el = document.createElement('div');
    el.className = `reveal-player ${p.eliminated ? 'reveal-eliminated' : ''}`;
    el.innerHTML = `
      <div class="player-avatar">${p.name.charAt(0).toUpperCase()}</div>
      <span class="reveal-name">${escapeHtml(p.name)}</span>
      <span class="reveal-role ${roleClass}">${roleLabels[p.role] || p.role}</span>
    `;
    reveal.appendChild(el);
  });
}

// ─── EVENT LISTENERS ───
document.addEventListener('DOMContentLoaded', () => {
  connect();

  // Home — Create Room
  document.getElementById('btn-create').addEventListener('click', () => {
    const name = document.getElementById('player-name').value.trim();
    if (!name) { showToast('Entrez un nom de code', 'error'); return; }
    send({ type: 'create_room', name });
  });

  // Home — Rules
  document.getElementById('btn-rules').addEventListener('click', () => {
    showScreen('rules');
  });

  // Rules — Back
  document.getElementById('btn-rules-back').addEventListener('click', () => {
    showScreen('home');
  });

  // Home — Toggle Join
  document.getElementById('btn-join-toggle').addEventListener('click', () => {
    document.getElementById('join-section').classList.toggle('hidden');
  });

  // Home — Join Room
  document.getElementById('btn-join').addEventListener('click', () => {
    const name = document.getElementById('player-name').value.trim();
    const code = document.getElementById('room-code').value.trim().toUpperCase();
    if (!name) { showToast('Entrez un nom de code', 'error'); return; }
    if (!code || code.length < 4) { showToast('Code invalide', 'error'); return; }
    send({ type: 'join_room', name, code });
  });

  // Lobby — Copy Code
  document.getElementById('btn-copy-code').addEventListener('click', () => {
    const code = document.getElementById('lobby-code').textContent;
    navigator.clipboard.writeText(code).then(() => {
      showToast('Code copié !', 'success');
    }).catch(() => {
      showToast(code, 'info');
    });
  });

  // Lobby — Settings
  document.getElementById('uc-minus').addEventListener('click', () => {
    const el = document.getElementById('uc-count');
    let val = parseInt(el.textContent);
    if (val > 1) { val--; el.textContent = val; updateSettings(); }
  });

  document.getElementById('uc-plus').addEventListener('click', () => {
    const el = document.getElementById('uc-count');
    let val = parseInt(el.textContent);
    if (val < 3) { val++; el.textContent = val; updateSettings(); }
  });

  document.getElementById('toggle-mrwhite').addEventListener('change', updateSettings);

  // Lobby — Start Game
  document.getElementById('btn-start').addEventListener('click', () => {
    send({ type: 'start_game' });
  });

  // Game — Submit Description
  document.getElementById('btn-describe').addEventListener('click', () => {
    const input = document.getElementById('description-input');
    const desc = input.value.trim();
    if (!desc) { showToast('Entrez une description', 'error'); return; }
    send({ type: 'submit_description', description: desc });
    hasDescribed = true;
    document.getElementById('describe-section').classList.add('hidden');
    document.getElementById('already-described').classList.remove('hidden');
  });

  // Vote — Confirm
  document.getElementById('btn-confirm-vote').addEventListener('click', () => {
    if (currentVoteTarget) {
      send({ type: 'submit_vote', targetId: currentVoteTarget });
      document.getElementById('vote-confirm').classList.add('hidden');
      showToast('Vote enregistré', 'success');
      document.querySelectorAll('.vote-player').forEach(el => {
        el.style.pointerEvents = 'none';
        el.style.opacity = '0.5';
      });
    }
  });

  document.getElementById('btn-cancel-vote').addEventListener('click', () => {
    currentVoteTarget = null;
    document.getElementById('vote-confirm').classList.add('hidden');
    document.querySelectorAll('.vote-player').forEach(el => el.classList.remove('selected'));
  });

  // Vote Result — Continue
  document.getElementById('btn-continue').addEventListener('click', () => {
    showScreen('game');
    resetGameUI();
    displayWord();
  });

  // Mr. White — Guess
  document.getElementById('btn-mrwhite-guess').addEventListener('click', () => {
    const guess = document.getElementById('mrwhite-guess-input').value.trim();
    if (!guess) { showToast('Entrez votre supposition', 'error'); return; }
    send({ type: 'mrwhite_guess', guess });
  });

  // Game Over — Replay
  document.getElementById('btn-replay').addEventListener('click', () => {
    if (isHost) {
      send({ type: 'restart_game' });
    } else {
      showToast('Seul l\'hôte peut relancer', 'info');
    }
  });

  // Enter key support
  ['player-name'].forEach(id => {
    document.getElementById(id).addEventListener('keypress', (e) => {
      if (e.key === 'Enter') document.getElementById('btn-create').click();
    });
  });

  document.getElementById('room-code').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') document.getElementById('btn-join').click();
  });

  document.getElementById('description-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') document.getElementById('btn-describe').click();
  });

  document.getElementById('mrwhite-guess-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') document.getElementById('btn-mrwhite-guess').click();
  });
});

function updateSettings() {
  const undercoverCount = parseInt(document.getElementById('uc-count').textContent);
  const mrWhite = document.getElementById('toggle-mrwhite').checked;
  send({
    type: 'update_settings',
    settings: { undercoverCount, mrWhite }
  });
}
