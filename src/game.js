import { GAME } from './config.js';

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
// 0 — підлога, 1 — стіна. Заміниш на свої масиви / генерацію кімнат.
const LEVEL = [];
{
  const cols = Math.ceil(GAME.width / GAME.tile);
  const rows = Math.ceil(GAME.height / GAME.tile);
  for (let y = 0; y < rows; y++) {
    const row = [];
    for (let x = 0; x < cols; x++) {
      const edge = x === 0 || y === 0 || x === cols - 1 || y === rows - 1;
      const blob = (x % 7 === 3 && y % 5 === 2);
      row.push(edge || blob ? 1 : 0);
    }
    LEVEL.push(row);
  }
}

const solidAt = (px, py) => {
  const c = Math.floor(px / GAME.tile);
  const r = Math.floor(py / GAME.tile);
  return LEVEL[r]?.[c] === 1;
};

// Рух по осях окремо — так гравець ковзає вздовж стіни, а не залипає.
function moveAxis(entity, dx, dy) {
  const nx = entity.x + dx;
  const ny = entity.y + dy;
  const corners = [
    [nx, ny],
    [nx + entity.w - 1, ny],
    [nx, ny + entity.h - 1],
    [nx + entity.w - 1, ny + entity.h - 1],
  ];
  if (corners.some(([cx, cy]) => solidAt(cx, cy))) return false;
  entity.x = nx;
  entity.y = ny;
  return true;
}

// ── Спрайтова анімація ────────────────────────────────────────────────
// Під твій пайплайн: PNG-сітка кадрів. Поки картинки немає — малює прямокутник.
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
  x: GAME.tile * 2, y: GAME.tile * 2, w: 24, h: 24,
  speed: 190, dir: 0, frame: 0, frameTimer: 0, moving: false,
};

const pickups = [];
function spawnPickup() {
  for (let tries = 0; tries < 200; tries++) {
    const x = Math.random() * (GAME.width - 40) + 20;
    const y = Math.random() * (GAME.height - 40) + 20;
    if (!solidAt(x, y) && !solidAt(x + 12, y + 12)) {
      pickups.push({ x, y, w: 12, h: 12, t: 0 });
      return;
    }
  }
}
for (let i = 0; i < 6; i++) spawnPickup();

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

  // анімація: 8 кадрів/сек поки рухається
  if (player.moving) {
    player.frameTimer += dt;
    if (player.frameTimer > 0.125) { player.frameTimer = 0; player.frame = (player.frame + 1) % 4; }
  } else {
    player.frame = 0;
  }

  for (let i = pickups.length - 1; i >= 0; i--) {
    const p = pickups[i];
    p.t += dt;
    const hit =
      player.x < p.x + p.w && player.x + player.w > p.x &&
      player.y < p.y + p.h && player.y + player.h > p.y;
    if (hit) {
      pickups.splice(i, 1);
      state.score += 10;
      spawnPickup();
      onScoreChange?.(state.score);
    }
  }
}

// ── Малювання ─────────────────────────────────────────────────────────
function render(ctx) {
  ctx.fillStyle = '#12111a';
  ctx.fillRect(0, 0, GAME.width, GAME.height);

  for (let r = 0; r < LEVEL.length; r++) {
    for (let c = 0; c < LEVEL[r].length; c++) {
      if (LEVEL[r][c] !== 1) continue;
      ctx.fillStyle = '#2b2840';
      ctx.fillRect(c * GAME.tile, r * GAME.tile, GAME.tile, GAME.tile);
      ctx.fillStyle = '#39355a';
      ctx.fillRect(c * GAME.tile, r * GAME.tile, GAME.tile, 3);
    }
  }

  for (const p of pickups) {
    const bob = Math.sin(p.t * 5) * 2;
    ctx.fillStyle = '#ffd166';
    ctx.fillRect(p.x, p.y + bob, p.w, p.h);
  }

  const drew = heroSheet.draw(ctx, player.frame, player.dir, player.x, player.y, player.w, player.h);
  if (!drew) {
    ctx.fillStyle = '#7bdff2';
    ctx.fillRect(Math.round(player.x), Math.round(player.y), player.w, player.h);
    ctx.fillStyle = '#12111a';
    ctx.fillRect(Math.round(player.x) + 5, Math.round(player.y) + 7, 4, 4);
    ctx.fillRect(Math.round(player.x) + 15, Math.round(player.y) + 7, 4, 4);
  }
}

// ── Цикл з фіксованим кроком ──────────────────────────────────────────
let onScoreChange = null;
export function setScoreListener(fn) { onScoreChange = fn; }
export function getState() { return state; }
export function resetGame() {
  state.score = 0; state.time = 0; state.running = true;
  player.x = GAME.tile * 2; player.y = GAME.tile * 2;
  pickups.length = 0;
  for (let i = 0; i < 6; i++) spawnPickup();
  onScoreChange?.(0);
}

export function start(canvas) {
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  const STEP = 1 / 60;
  let acc = 0;
  let last = performance.now();

  function frame(now) {
    // 250 мс стеля: після згорнутої вкладки не проганяємо сотні кроків
    acc += Math.min((now - last) / 1000, 0.25);
    last = now;
    while (acc >= STEP) { update(STEP); acc -= STEP; }
    render(ctx);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
