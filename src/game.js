import { GAME } from './config.js';
import { TUNING } from './tuning.js';
import { enemy, sendMyMovement, tickBot } from './main.js';

const T = TUNING;
const TILE = T.field.tile;

// ── Інпут ─────────────────────────────────────────────────────────────
const keys = new Set();
addEventListener('keydown', (e) => {
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) e.preventDefault();
  keys.add(e.key.toLowerCase());
});
addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
addEventListener('blur', () => keys.clear());

const held = (...names) => names.some((n) => keys.has(n));

// ── Рівень ────────────────────────────────────────────────────────────
const LEVEL = [];
{
  const cols = Math.ceil(GAME.width / TILE);
  const rows = Math.ceil(GAME.height / TILE);
  for (let y = 0; y < rows; y++) {
    const row = [];
    for (let x = 0; x < cols; x++) {
      const edge = x === 0 || y === 0 || x === cols - 1 || y === rows - 1;
      const blob = (x % T.field.wallPatternX === 3 && y % T.field.wallPatternY === 2);
      row.push(edge || blob ? 1 : 0);
    }
    LEVEL.push(row);
  }
}

function boxHitsWall(x, y, w, h) {
  const c0 = Math.floor(x / TILE);
  const c1 = Math.floor((x + w - 1) / TILE);
  const r0 = Math.floor(y / TILE);
  const r1 = Math.floor((y + h - 1) / TILE);
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      if (LEVEL[r]?.[c] === 1) return true;
    }
  }
  return false;
}

function moveAxis(entity, dx, dy) {
  const nx = entity.x + dx;
  const ny = entity.y + dy;
  if (boxHitsWall(nx, ny, entity.w, entity.h)) return false;
  entity.x = nx;
  entity.y = ny;
  return true;
}

// ── Спрайтова анімація ────────────────────────────────────────────────
class SpriteSheet {
  constructor(src, frameW, frameH) {
    this.img = new Image();
    this.img.src = src;
    this.frameW = frameW;
    this.frameH = frameH;
    this.loaded = false;
    this.img.onload = () => { this.loaded = true; };
    this.img.onerror = () => { this.loaded = false; };
  }
  draw(ctx, frame, row, x, y, w, h) {
    if (!this.loaded) return false;
    ctx.drawImage(
      this.img,
      frame * this.frameW, row * this.frameH, this.frameW, this.frameH,
      Math.round(x), Math.round(y), w, h
    );
    return true;
  }
}

const heroSheet = new SpriteSheet('assets/hero.png', 32, 32);

// ── Стан ──────────────────────────────────────────────────────────────
const player = {
  x: TILE * 2, y: TILE * 2,
  w: T.player.size, h: T.player.size,
  speed: T.player.speed,
  dir: 0, frame: 0, frameTimer: 0, moving: false,
};

const pickups = [];
function spawnPickup() {
  const s = T.pickups.size;
  for (let tries = 0; tries < 200; tries++) {
    const x = Math.random() * (GAME.width - 40) + 20;
    const y = Math.random() * (GAME.height - 40) + 20;
    if (!boxHitsWall(x, y, s, s)) {
      pickups.push({ x, y, w: s, h: s, t: 0 });
      return;
    }
  }
}
for (let i = 0; i < T.pickups.count; i++) spawnPickup();

const state = { score: 0, time: 0, running: true };

// ── Оновлення ─────────────────────────────────────────────────────────
function update(dt) {
  if (!state.running) return;
  state.time += dt;

  let dx = 0, dy = 0;
  if (held('arrowleft', 'a', 'ф')) dx -= 1;
  if (held('arrowright', 'd', 'в')) dx += 1;
  if (held('arrowup', 'w', 'ц')) dy -= 1;
  if (held('arrowdown', 's', 'і')) dy += 1;

  if (dx && dy) { const k = Math.SQRT1_2; dx *= k; dy *= k; }

  player.moving = dx !== 0 || dy !== 0;
  if (dx < 0) player.dir = 1;
  else if (dx > 0) player.dir = 2;
  else if (dy < 0) player.dir = 3;
  else if (dy > 0) player.dir = 0;

  moveAxis(player, dx * player.speed * dt, 0);
  moveAxis(player, 0, dy * player.speed * dt);

  // Відправляємо свої координати (для PVP)
  if (player.moving) {
    sendMyMovement(player.x, player.y);
  }

  // Передаємо в tickBot інформацію та локальну функцію перевірки колізій boxHitsWall
  tickBot(pickups, boxHitsWall, dt);

  if (player.moving) {
    player.frameTimer += dt;
    if (player.frameTimer > 1 / T.player.animationSpeed) {
      player.frameTimer = 0;
      player.frame = (player.frame + 1) % 4;
    }
  } else {
    player.frame = 0;
  }

  // Обробка колізій з монетками (Гравець і Бот)
  for (let i = pickups.length - 1; i >= 0; i--) {
    const p = pickups[i];
    p.t += dt;

    // 1. Гравець збирає монетку
    const hitPlayer =
      player.x < p.x + p.w && player.x + player.w > p.x &&
      player.y < p.y + p.h && player.y + player.h > p.y;

    if (hitPlayer) {
      pickups.splice(i, 1);
      state.score += T.pickups.scoreValue;
      spawnPickup();
      onScoreChange?.(state.score);
      continue;
    }

    // 2. Бот / Суперник збирає монетку
    if (enemy) {
      const eSize = enemy.size || T.player.size;
      const hitEnemy =
        enemy.x < p.x + p.w && enemy.x + eSize > p.x &&
        enemy.y < p.y + p.h && enemy.y + eSize > p.y;

      if (hitEnemy) {
        pickups.splice(i, 1);
        spawnPickup();
      }
    }
  }
}

// ── Малювання ─────────────────────────────────────────────────────────
function render(ctx) {
  ctx.fillStyle = T.colors.background;
  ctx.fillRect(0, 0, GAME.width, GAME.height);

  for (let r = 0; r < LEVEL.length; r++) {
    for (let c = 0; c < LEVEL[r].length; c++) {
      if (LEVEL[r][c] !== 1) continue;
      ctx.fillStyle = T.colors.wall;
      ctx.fillRect(c * TILE, r * TILE, TILE, TILE);
      ctx.fillStyle = T.colors.wallTop;
      ctx.fillRect(c * TILE, r * TILE, TILE, 3);
    }
  }

  for (const p of pickups) {
    const bob = Math.sin(p.t * T.pickups.bobSpeed) * T.pickups.bobHeight;
    ctx.fillStyle = T.colors.pickup;
    ctx.fillRect(p.x, p.y + bob, p.w, p.h);
  }

  // 1. Малювання Нашого Гравця
  const drew = heroSheet.draw(ctx, player.frame, player.dir, player.x, player.y, player.w, player.h);
  if (!drew) {
    ctx.fillStyle = T.colors.player;
    ctx.fillRect(Math.round(player.x), Math.round(player.y), player.w, player.h);
    ctx.fillStyle = T.colors.playerEyes;
    ctx.fillRect(Math.round(player.x) + 3, Math.round(player.y) + 3, 3, 3);
    ctx.fillRect(Math.round(player.x) + 9, Math.round(player.y) + 3, 3, 3);
  }

  // 2. Малювання Супротивника / Бота через SpriteSheet
  if (enemy) {
    const drewEnemy = heroSheet.draw(
      ctx,
      enemy.frame || 0,
      enemy.dir || 0,
      enemy.x,
      enemy.y,
      enemy.w || T.player.size,
      enemy.h || T.player.size
    );

    // Фолбек (якщо спрайт ще не завантажився)
    if (!drewEnemy) {
      ctx.fillStyle = T.colors.enemy || '#ff595e';
      ctx.fillRect(Math.round(enemy.x), Math.round(enemy.y), enemy.size || T.player.size, enemy.size || T.player.size);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(Math.round(enemy.x) + 3, Math.round(enemy.y) + 3, 3, 3);
      ctx.fillRect(Math.round(enemy.x) + 9, Math.round(enemy.y) + 3, 3, 3);
    }
  }
}

// ── Цикл з фіксованим кроком ──────────────────────────────────────────
let onScoreChange = null;
export function setScoreListener(fn) { onScoreChange = fn; }
export function getState() { return state; }
export function resetGame() {
  state.score = 0; state.time = 0; state.running = true;
  player.x = TILE * 2; player.y = TILE * 2;
  pickups.length = 0;
  for (let i = 0; i < T.pickups.count; i++) spawnPickup();
  onScoreChange?.(0);
}

export function start(canvas) {
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  const STEP = 1 / 60;
  let acc = 0;
  let last = performance.now();

  function frame(now) {
    acc += Math.min((now - last) / 1000, 0.25);
    last = now;
    while (acc >= STEP) { update(STEP); acc -= STEP; }
    render(ctx);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}