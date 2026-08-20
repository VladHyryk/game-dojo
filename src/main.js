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
let pollInterval = null;
let botTimeout = null;

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

// 3. Метчмейкінг на чистих DB запитах (без збоїв WebSockets)
async function findMatch() {
  const statusEl = document.getElementById('status');
  if (statusEl) statusEl.textContent = 'Шукаємо суперника (30 сек)...';

  if (pollInterval) clearInterval(pollInterval);
  if (botTimeout) clearTimeout(botTimeout);
  if (roomChannel) supabase.removeChannel(roomChannel);

  currentRoom = null;
  isPlayingWithBot = false;

  console.log("🚀 Початок пошуку суперника для:", playerId);

  try {
    // 1. Шукаємо гравця, який вже чекає в черзі
    const { data: waitingPlayers } = await supabase
      .from('matchmaking_queue')
      .select('*')
      .eq('status', 'waiting')
      .neq('player_id', playerId)
      .order('created_at', { ascending: true })
      .limit(1);

    if (waitingPlayers && waitingPlayers.length > 0) {
      const waitingPlayer = waitingPlayers[0];
      const roomId = `room_${waitingPlayer.id}`;

      console.log("✅ Знайдено гравця! Створюємо кімнату:", roomId);

      await supabase
        .from('matchmaking_queue')
        .update({ status: 'matched', room_id: roomId })
        .eq('id', waitingPlayer.id);

      startPVPGame(roomId, 'player2');
      return;
    }

    // 2. Якщо нікого немає — додаємо СЕБЕ в чергу
    const { data: myEntry, error } = await supabase
      .from('matchmaking_queue')
      .insert([{ player_id: playerId, status: 'waiting' }])
      .select()
      .single();

    if (error || !myEntry) {
      console.error("Помилка запису в чергу:", error);
      startPVEBotGame();
      return;
    }

    console.log("⏳ Записано в чергу, чекаємо 30 секунд. My ID:", myEntry.id);

    // 3. Опитання бази даних кожні 1.5 секунди
    pollInterval = setInterval(async () => {
      const { data: check } = await supabase
        .from('matchmaking_queue')
        .select('status, room_id')
        .eq('id', myEntry.id)
        .single();

      if (check && check.status === 'matched') {
        console.log("⚔️ Суперник підключився до нашої кімнати!");
        clearInterval(pollInterval);
        clearTimeout(botTimeout);
        startPVPGame(check.room_id, 'player1');
      }
    }, 1500);

    // 4. ТАЙМАУТ 30 СЕКУНД
    botTimeout = setTimeout(async () => {
      console.log("⏰ 30 секунд минуло -> Запуск бота.");
      clearInterval(pollInterval);

      await supabase
        .from('matchmaking_queue')
        .update({ status: 'expired' })
        .eq('id', myEntry.id);

      if (!currentRoom) {
        startPVEBotGame();
      }
    }, 30000); // 30 секунд

  } catch (err) {
    console.error("💥 Критична помилка:", err);
    startPVEBotGame();
  }
}

function startPVEBotGame() {
  if (pollInterval) clearInterval(pollInterval);
  const statusEl = document.getElementById('status');
  if (statusEl) statusEl.textContent = '🤖 Гра проти БОТА';
  
  isPlayingWithBot = true;
  botInstance = new Bot(200, 200);
}

function startPVPGame(roomId, role) {
  if (pollInterval) clearInterval(pollInterval);
  if (botTimeout) clearTimeout(botTimeout);

  const statusEl = document.getElementById('status');
  if (statusEl) statusEl.textContent = `⚔️ Гра проти гравця (${role})`;

  isPlayingWithBot = false;
  currentRoom = roomId;

  if (roomChannel) supabase.removeChannel(roomChannel);

  // Канал для обміну координатами
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

// 4. Інтерфейс
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