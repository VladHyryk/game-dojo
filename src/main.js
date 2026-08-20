import { GAME } from './config.js';
import { TUNING } from './tuning.js';
import { start, setScoreListener, getState, resetGame, placeBomb } from './game.js';
import { topScores, submitScore, dbReady, supabase } from './db.js'; // Імпортуємо єдиний supabase з db.js

const playerId = 'player_' + Math.random().toString(36).substr(2, 9);

let currentRoom = null;
let roomChannel = null;
export let isPlayingWithBot = false;
let botInstance = null;
let pollInterval = null;
let botTimeout = null;

export const enemy = {
  x: 200,
  y: 200,
  w: TUNING.player.size,
  h: TUNING.player.size,
  dir: 0,
  frame: 0,
  frameTimer: 0,
  moving: false,
  score: 0
};

// 2. Клас Бота
class Bot {
  constructor(x = 200, y = 200) {
    this.x = x;
    this.y = y;
    this.w = TUNING.player.size;
    this.h = TUNING.player.size;
    this.speed = 135;
    this.avoidDir = 1;
    this.dir = 0;
    this.frame = 0;
    this.frameTimer = 0;
    this.usedBombs = 0;
    this.bombCooldown = 0;
    enemy.score = 0;
  }

  hasLineOfSight(target, boxHitsWallFn) {
    const steps = 10;
    for (let i = 1; i <= steps; i++) {
      const checkX = this.x + (target.x - this.x) * (i / steps);
      const checkY = this.y + (target.y - this.y) * (i / steps);
      if (boxHitsWallFn(checkX, checkY, this.w, this.h)) return false;
    }
    return true;
  }

  update(pickupsList, boxHitsWallFn, playerObj, dt = 0.016) {
    if (!pickupsList || pickupsList.length === 0) return;

    if (this.bombCooldown > 0) this.bombCooldown -= dt;

    let target = null;
    let minDist = Infinity;

    for (const p of pickupsList) {
      const d = Math.hypot(p.x - this.x, p.y - this.y);
      if (d < minDist && this.hasLineOfSight(p, boxHitsWallFn)) {
        minDist = d;
        target = p;
      }
    }

    if (!target) {
      minDist = Infinity;
      for (const p of pickupsList) {
        const d = Math.hypot(p.x - this.x, p.y - this.y);
        if (d < minDist) {
          minDist = d;
          target = p;
        }
      }
    }

    if (!target) return;

    if (minDist < 40 && this.bombCooldown <= 0) {
      if (placeBomb(this.x, this.y, enemy.score, this.usedBombs)) {
        this.usedBombs++;
        this.bombCooldown = 5.0;
      }
    }

    const oldX = this.x;
    const oldY = this.y;

    let dx = target.x - this.x;
    let dy = target.y - this.y;
    const dist = Math.hypot(dx, dy);

    if (dist > 2) {
      const stepX = (dx / dist) * this.speed * dt;
      const stepY = (dy / dist) * this.speed * dt;

      const canX = !boxHitsWallFn(this.x + stepX, this.y, this.w, this.h);
      const canY = !boxHitsWallFn(this.x, this.y + stepY, this.w, this.h);

      if (canX) {
        this.x += stepX;
      } else {
        const detourY = this.speed * dt * this.avoidDir;
        if (!boxHitsWallFn(this.x, this.y + detourY, this.w, this.h)) {
          this.y += detourY;
        } else {
          this.avoidDir *= -1;
        }
      }

      if (canY) {
        this.y += stepY;
      } else {
        const detourX = this.speed * dt * this.avoidDir;
        if (!boxHitsWallFn(this.x + detourX, this.y, this.w, this.h)) {
          this.x += detourX;
        } else {
          this.avoidDir *= -1;
        }
      }
    }

    const movedX = this.x - oldX;
    const movedY = this.y - oldY;
    const isMoving = Math.abs(movedX) > 0.05 || Math.abs(movedY) > 0.05;

    if (Math.abs(movedX) > Math.abs(movedY)) {
      if (movedX < 0) this.dir = 1;
      else if (movedX > 0) this.dir = 2;
    } else if (Math.abs(movedY) > 0.05) {
      if (movedY < 0) this.dir = 3;
      else if (movedY > 0) this.dir = 0;
    }

    if (isMoving) {
      this.frameTimer += dt;
      if (this.frameTimer > 1 / TUNING.player.animationSpeed) {
        this.frameTimer = 0;
        this.frame = (this.frame + 1) % 4;
      }
    } else {
      this.frame = 0;
    }

    enemy.x = this.x;
    enemy.y = this.y;
    enemy.dir = this.dir;
    enemy.frame = this.frame;
    enemy.moving = isMoving;
  }
}

export function tickBot(pickupsList, boxHitsWallFn, playerObj, dt) {
  if (isPlayingWithBot && botInstance) {
    botInstance.update(pickupsList, boxHitsWallFn, playerObj, dt);
  }
}

export function respawnBot() {
  if (botInstance) {
    botInstance.x = GAME.width - 80;
    botInstance.y = GAME.height - 80;
    enemy.x = botInstance.x;
    enemy.y = botInstance.y;
  } else {
    enemy.x = GAME.width - 80;
    enemy.y = GAME.height - 80;
  }
}

// 3. Метчмейкінг без хибного фолбеку на бота
async function findMatch() {
  const statusEl = document.getElementById('status');
  if (statusEl) statusEl.textContent = 'Шукаємо суперника (до 30 сек)...';

  if (pollInterval) clearInterval(pollInterval);
  if (botTimeout) clearTimeout(botTimeout);
  if (roomChannel) supabase.removeChannel(roomChannel);

  currentRoom = null;
  isPlayingWithBot = false;

  console.log("🚀 [MATCH] Початок пошуку. Мій ID:", playerId);

  // 1. Спроба видалити старі записи (без вильоту в бот-режим у разі помилки)
  try {
    const thirtySecAgo = new Date(Date.now() - 30000).toISOString();
    await supabase.from('matchmaking_queue').delete().lt('created_at', thirtySecAgo);
  } catch (e) {
    console.warn("Попередження при очищенні черги:", e);
  }

  // 2. Шукаємо суперника, який чекає
  const { data: waitingList, error: selectErr } = await supabase
    .from('matchmaking_queue')
    .select('*')
    .eq('status', 'waiting')
    .neq('player_id', playerId)
    .order('created_at', { ascending: true });

  if (selectErr) {
    console.error("❌ Помилка читання черги (перевірте SQL таблицю в Supabase):", selectErr);
  }

  // Якщо знайшли — підключаємось як player2
  if (waitingList && waitingList.length > 0) {
    const opponent = waitingList[0];
    const roomId = `room_${opponent.id}`;

    console.log("✅ Знайдено суперника у черзі!", opponent);

    await supabase
      .from('matchmaking_queue')
      .update({ status: 'matched', room_id: roomId })
      .eq('id', opponent.id);

    startPVPGame(roomId, 'player2');
    return;
  }

  // 3. Якщо нікого немає — додаємо себе в чергу
  const { data: myEntryArray, error: insertErr } = await supabase
    .from('matchmaking_queue')
    .insert([{ player_id: playerId, status: 'waiting' }])
    .select();

  if (insertErr || !myEntryArray || myEntryArray.length === 0) {
    console.error("❌ Помилка створення запису в черзі:", insertErr);
    // Якщо дійсно не вдалося записатися в БД, лише тоді включаємо бота
    startPVEBotGame();
    return;
  }

  const myEntry = myEntryArray[0];
  console.log("⏳ Записано в чергу з ID:", myEntry.id, "Чекаємо 30 секунд...");

  // 4. Опитання (Polling) щосекунди
  pollInterval = setInterval(async () => {
    const { data: checkArray } = await supabase
      .from('matchmaking_queue')
      .select('*')
      .eq('id', myEntry.id);

    if (checkArray && checkArray.length > 0) {
      const check = checkArray[0];
      if (check.status === 'matched') {
        console.log("⚔️ Суперник підключився! Вхід у кімнату:", check.room_id);
        clearInterval(pollInterval);
        clearTimeout(botTimeout);
        startPVPGame(check.room_id, 'player1');
      }
    }
  }, 1000);

  // 5. ТАЙМАУТ СТРОВО 30 СЕКУНД
  botTimeout = setTimeout(async () => {
    console.log("⏰ 30 секунд минуло. Запуск бота.");
    clearInterval(pollInterval);

    await supabase
      .from('matchmaking_queue')
      .delete()
      .eq('id', myEntry.id);

    if (!currentRoom) {
      startPVEBotGame();
    }
  }, 30000);
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

  roomChannel = supabase.channel(roomId);
  roomChannel
    .on('broadcast', { event: 'move' }, (payload) => {
      if (payload.sender !== playerId) {
        enemy.x = payload.x;
        enemy.y = payload.y;
        enemy.dir = payload.dir || 0;
        enemy.frame = payload.frame || 0;
      }
    })
    .subscribe();
}

export function sendMyMovement(x, y, dir, frame) {
  if (roomChannel && !isPlayingWithBot) {
    roomChannel.send({
      type: 'broadcast',
      event: 'move',
      payload: { sender: playerId, x, y, dir, frame }
    });
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