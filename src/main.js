import { GAME } from './config.js';
import { TUNING } from './tuning.js';
import { start, setScoreListener, getState, resetGame } from './game.js';
import { topScores, submitScore, dbReady } from './db.js';

// 1. Конфігурація Supabase
const SUPABASE_URL = "https://syhhamuvbkisaedmqzdfa.supabase.co";
const SUPABASE_KEY = "sb_publishable_MgiS3rEYZVXqD0MSPhIYtg_Vf4WdaNm"; 

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const playerId = 'player_' + Math.random().toString(36).substr(2, 9);

let currentRoom = null;
let roomChannel = null;
let isPlayingWithBot = false;
let botInstance = null;
let matchTimeout = null;
let pingInterval = null;

export const enemy = {
  x: 200,
  y: 200,
  size: TUNING.player.size
};

// 2. Клас Бота
class Bot {
  constructor(x = 200, y = 200) {
    this.x = x;
    this.y = y;
    this.speed = 150;
  }

  update(targetX, targetY, dt = 0.016) {
    const step = this.speed * dt;
    if (this.x < targetX) this.x += step;
    if (this.x > targetX) this.x -= step;
    if (this.y < targetY) this.y += step;
    if (this.y > targetY) this.y -= step;

    enemy.x = this.x;
    enemy.y = this.y;
  }
}

// 3. Глобальний канал для миттєвого виявлення суперника
const globalLobby = supabase.channel('global_lobby');

globalLobby
  .on('broadcast', { event: 'ping_search' }, (payload) => {
    // Якщо хтось шукає і ми самі шукаємо (не в грі)
    if (payload.sender !== playerId && !currentRoom && !isPlayingWithBot) {
      console.log("⚡ Знайдено суперника через Broadcast!", payload.sender);
      const roomId = `room_${payload.sender}_${playerId}`;

      // Повідомляємо його, що ми приймаємо бій
      globalLobby.send({
        type: 'broadcast',
        event: 'match_accept',
        payload: { target: payload.sender, peer: playerId, roomId }
      });

      startPVPGame(roomId, 'player2');
    }
  })
  .on('broadcast', { event: 'match_accept' }, (payload) => {
    if (payload.target === playerId && !currentRoom) {
      console.log("⚡ Суперник підтвердив матч!");
      startPVPGame(payload.roomId, 'player1');
    }
  })
  .subscribe();

// 4. Функція Пошуку (30 секунд)
async function findMatch() {
  const statusEl = document.getElementById('status');
  if (statusEl) statusEl.textContent = 'Шукаємо суперника (до 30 сек)...';

  // Очищення попередніх станiв
  if (matchTimeout) clearTimeout(matchTimeout);
  if (pingInterval) clearInterval(pingInterval);
  if (roomChannel) supabase.removeChannel(roomChannel);

  currentRoom = null;
  isPlayingWithBot = false;

  console.log("🚀 [MATCHMAKING] Запуск шукача. ID:", playerId);

  // 1. Щосекунди шлемо сигнал у мережу
  pingInterval = setInterval(() => {
    if (!currentRoom && !isPlayingWithBot) {
      globalLobby.send({
        type: 'broadcast',
        event: 'ping_search',
        payload: { sender: playerId }
      });
    }
  }, 1200);

  // 2. Встановити таймер 30 секунд для бота
  matchTimeout = setTimeout(() => {
    if (pingInterval) clearInterval(pingInterval);
    if (!currentRoom) {
      console.log("⏰ 30 секунд минуло. Перехід до бота.");
      startPVEBotGame();
    }
  }, 30000);
}

function startPVEBotGame() {
  if (pingInterval) clearInterval(pingInterval);
  const statusEl = document.getElementById('status');
  if (statusEl) statusEl.textContent = '🤖 Гра проти БОТА';
  
  isPlayingWithBot = true;
  botInstance = new Bot(200, 200);
}

function startPVPGame(roomId, role) {
  if (pingInterval) clearInterval(pingInterval);
  if (matchTimeout) clearTimeout(matchTimeout);

  const statusEl = document.getElementById('status');
  if (statusEl) statusEl.textContent = `⚔️ Гра проти гравця (${role})`;

  isPlayingWithBot = false;
  currentRoom = roomId;

  if (roomChannel) supabase.removeChannel(roomChannel);

  // Канал кімнати
  roomChannel = supabase.channel(roomId);
  roomChannel
    .on('broadcast', { event: 'move' }, (payload) => {
      if (payload.sender !== playerId) {
        enemy.x = payload.x;
        enemy.y = payload.y;
      }
    })
    .subscribe();
}

export function sendMyMovement(x, y) {
  if (roomChannel && !isPlayingWithBot) {
    roomChannel.send({
      type: 'broadcast',
      event: 'move',
      payload: { sender: playerId, x, y }
    });
  }
}

export function tickBot(heroX, heroY, dt) {
  if (isPlayingWithBot && botInstance) {
    botInstance.update(heroX, heroY, dt);
  }
}

// 5. Ініціалізація UI
const t = TUNING.texts;
document.title = t.title;
document.getElementById('title').textContent = t.title;
document.getElementById('controls-hint').textContent = t.controlsHint;
document.getElementById('score-label').textContent = t.scoreLabel;
document.getElementById('board-title').textContent = t.boardTitle;
document.getElementById('name').placeholder = t.namePlaceholder;
document.getElementById('save').textContent = t.saveButton;
document.getElementById('reset').textContent = t.resetButton;

const canvas = document.getElementById('game');
canvas.width = GAME.width;
canvas.height = GAME.height;

const scoreEl = document.getElementById('score');
const boardEl = document.getElementById('board');
const statusEl = document.getElementById('status');
const nameEl = document.getElementById('name');
const saveBtn = document.getElementById('save');
const resetBtn = document.getElementById('reset');

setScoreListener((s) => { scoreEl.textContent = s; });

nameEl.value = localStorage.getItem('player') || '';
nameEl.addEventListener('input', () => localStorage.setItem('player', nameEl.value));

async function refreshBoard() {
  if (!dbReady) {
    boardEl.innerHTML = '<li class="empty">Supabase не підключений</li>';
    return;
  }
  const rows = await topScores();
  if (!rows.length) {
    boardEl.innerHTML = `<li class="empty">${escapeHtml(t.emptyBoard)}</li>`;
    return;
  }
  boardEl.innerHTML = rows
    .map((r, i) => `<li><span class="rank">${i + 1}</span><span class="who">${escapeHtml(r.player)}</span><span class="pts">${r.score}</span></li>`)
    .join('');
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

saveBtn.addEventListener('click', async () => {
  const name = nameEl.value.trim();
  if (!name) { statusEl.textContent = 'Впиши імʼя, щоб зберегти результат.'; nameEl.focus(); return; }

  saveBtn.disabled = true;
  statusEl.textContent = 'Зберігаю…';
  const res = await submitScore(name, getState().score);
  saveBtn.disabled = false;

  if (res.ok) {
    statusEl.textContent = 'Результат збережено.';
    refreshBoard();
  } else {
    statusEl.textContent = `Не збереглось: ${res.reason}`;
  }
});

resetBtn.addEventListener('click', () => {
  resetGame();
  findMatch();
  canvas.focus();
});

start(canvas);
findMatch();
refreshBoard();