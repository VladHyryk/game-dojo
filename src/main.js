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

export const enemy = {
  x: 200,
  y: 200,
  size: TUNING.player.size
};

// 2. Клас Бота для PVE режиму
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

// 3. Метчмейкінг з 30-секундним очікуванням через БД
async function findMatch() {
  const statusEl = document.getElementById('status');
  if (statusEl) statusEl.textContent = 'Шукаємо суперника (до 30 сек)...';

  clearTimeout(window.botTimer);
  if (window.checkInterval) clearInterval(window.checkInterval);
  if (roomChannel) supabase.removeChannel(roomChannel);

  currentRoom = null;
  isPlayingWithBot = false;

  try {
    // 1. Очищаємо всі записи в черзі, які старші за 30 секунд
    const thirtySecAgo = new Date(Date.now() - 30000).toISOString();
    await supabase
      .from('matchmaking_queue')
      .update({ status: 'expired' })
      .eq('status', 'waiting')
      .lt('created_at', thirtySecAgo);

    // 2. Перевіряємо, чи є вже ХТОСЬ активний у черзі
    const { data: waitingPlayer } = await supabase
      .from('matchmaking_queue')
      .select('*')
      .eq('status', 'waiting')
      .neq('player_id', playerId)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (waitingPlayer) {
      console.log("Знайдено суперника, який чекає у черзі!", waitingPlayer);
      const roomId = `room_${waitingPlayer.id}`;
      
      await supabase
        .from('matchmaking_queue')
        .update({ status: 'matched', room_id: roomId })
        .eq('id', waitingPlayer.id);

      startPVPGame(roomId, 'player2');
      return;
    }

    // 3. Якщо нікого немає — додаємо СЕБЕ в чергу
    const { data: myEntry, error } = await supabase
      .from('matchmaking_queue')
      .insert([{ player_id: playerId, status: 'waiting' }])
      .select()
      .single();

    if (error) {
      console.error("Помилка бази даних:", error);
      startPVEBotGame();
      return;
    }

    // 4. Підписуємося на Realtime оновлення нашого запису
    const queueChannel = supabase
      .channel(`queue_${myEntry.id}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'matchmaking_queue',
        filter: `id=eq.${myEntry.id}`
      }, (payload) => {
        if (payload.new.status === 'matched') {
          supabase.removeChannel(queueChannel);
          clearTimeout(window.botTimer);
          if (window.checkInterval) clearInterval(window.checkInterval);
          startPVPGame(payload.new.room_id, 'player1');
        }
      })
      .subscribe();

    // Додатковий резервний перевіряльник (Polling) кожні 2.5 секунди
    window.checkInterval = setInterval(async () => {
      const { data: check } = await supabase
        .from('matchmaking_queue')
        .select('status, room_id')
        .eq('id', myEntry.id)
        .single();

      if (check && check.status === 'matched') {
        clearInterval(window.checkInterval);
        supabase.removeChannel(queueChannel);
        clearTimeout(window.botTimer);
        startPVPGame(check.room_id, 'player1');
      }
    }, 2500);

    // 5. ТАЙМАУТ 30 СЕКУНД: якщо за 30 сек пари немає — запускаємо БОТА
    window.botTimer = setTimeout(async () => {
      if (window.checkInterval) clearInterval(window.checkInterval);
      supabase.removeChannel(queueChannel);
      
      await supabase
        .from('matchmaking_queue')
        .update({ status: 'expired' })
        .eq('id', myEntry.id);

      if (!currentRoom) {
        startPVEBotGame();
      }
    }, 30000);

  } catch (err) {
    console.error("Помилка метчмейкінгу:", err);
    startPVEBotGame();
  }
}

function startPVEBotGame() {
  const statusEl = document.getElementById('status');
  if (statusEl) statusEl.textContent = '🤖 Гра проти БОТА';
  
  isPlayingWithBot = true;
  botInstance = new Bot(200, 200);
}

function startPVPGame(roomId, role) {
  if (window.checkInterval) clearInterval(window.checkInterval);
  clearTimeout(window.botTimer);

  const statusEl = document.getElementById('status');
  if (statusEl) statusEl.textContent = `⚔️ Гра проти гравця (${role})`;

  isPlayingWithBot = false;
  currentRoom = roomId;

  if (roomChannel) supabase.removeChannel(roomChannel);

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

// 4. Ініціалізація UI
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