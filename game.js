'use strict';

const COLS = 10;
const ROWS = 20;
const BLOCK = 30;

const COLORS = [
  null,
  '#4dd0e1', // I - cyan
  '#ffd54f', // O - yellow
  '#ba68c8', // T - purple
  '#81c784', // S - green
  '#e57373', // Z - red
  '#82b1ff', // J - pale blue
  '#ffb74d', // L - orange
  '#b0bec5', // N - tuerca (gris acero)
];

// Agujero bloqueado de la tuerca: cuenta como celda ocupada, nada puede rellenarlo
const HOLE = 9;

const PIECES = [
  null,
  [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]], // I
  [[2,2],[2,2]],                               // O
  [[0,3,0],[3,3,3],[0,0,0]],                  // T
  [[0,4,4],[4,4,0],[0,0,0]],                  // S
  [[5,5,0],[0,5,5],[0,0,0]],                  // Z
  [[6,0,0],[6,6,6],[0,0,0]],                  // J
  [[0,0,7],[7,7,7],[0,0,0]],                  // L
  [[8,8,8],[8,HOLE,8],[8,8,8]],               // N (tuerca)
];

const LINE_SCORES = [0, 100, 300, 500, 800];

const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
const nextCanvas = document.getElementById('next-canvas');
const nextCtx = nextCanvas.getContext('2d');
const scoreEl = document.getElementById('score');
const linesEl = document.getElementById('lines');
const levelEl = document.getElementById('level');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const restartBtn = document.getElementById('restart-btn');
const themeToggle = document.getElementById('theme-toggle');
const pauseMenu = document.getElementById('pause-menu');
const resumeBtn = document.getElementById('resume-btn');
const restartPauseBtn = document.getElementById('restart-pause-btn');
const controlsToggleBtn = document.getElementById('controls-toggle-btn');
const pauseControls = document.getElementById('pause-controls');
const startLevelSelect = document.getElementById('start-level-select');
const skinSelect = document.getElementById('skin-select');

// ---- Tabla de récords ----
const startScreen = document.getElementById('start-screen');
const playBtn = document.getElementById('play-btn');
const clearRecordsBtn = document.getElementById('clear-records-btn');
const startRecordsList = document.getElementById('start-records-list');
const startBestCombo = document.getElementById('start-best-combo');
const startMaxLines = document.getElementById('start-max-lines');
const overlayRecordsList = document.getElementById('overlay-records-list');
const overlayRecordsPanel = document.getElementById('overlay-records-panel');
const saveRecordForm = document.getElementById('save-record-form');
const playerNameInput = document.getElementById('player-name-input');
const saveRecordBtn = document.getElementById('save-record-btn');

let board, current, next, score, lines, level, startLevel, gameOver, lastTime, dropAccum, dropInterval, animId;
let combo, bestCombo, maxLines;
let pauseMenuOpen = false;
let suppressNextRepeat = false;

const START_LEVEL_KEY = 'tetris-start-level';

function getStartLevel() {
  let v = 1;
  try {
    const stored = localStorage.getItem(START_LEVEL_KEY);
    if (stored) v = parseInt(stored, 10);
  } catch (e) {}
  if (!Number.isInteger(v) || v < 1) v = 1;
  if (v > 10) v = 10;
  return v;
}

const THEME_KEY = 'tetris-theme';
let gridLineColor = '#22222e';
let blockHighlightColor = 'rgba(255,255,255,0.12)';
let boardBgColor = '#0f0f17';

function applyThemeColors() {
  const style = getComputedStyle(document.body);
  gridLineColor = style.getPropertyValue('--grid-line').trim();
  blockHighlightColor = style.getPropertyValue('--block-highlight').trim();
  // La skin Neón fuerza el fondo del canvas a negro puro (con glow) sin
  // importar el tema claro/oscuro activo; el resto de las skins usan el
  // fondo del tema actual.
  boardBgColor = activeSkin === SKINS.neon ? '#000000' : style.getPropertyValue('--bg').trim();
}

function applyTheme(theme) {
  document.body.classList.toggle('light', theme === 'light');
  themeToggle.checked = theme === 'light';
  applyThemeColors();
}

function setTheme(theme) {
  localStorage.setItem(THEME_KEY, theme);
  applyTheme(theme);
  // antes de arrancar la partida (pantalla de inicio) board/current/next todavía no existen
  if (board && current) draw();
  if (next) drawNext();
}

themeToggle.addEventListener('change', () => {
  setTheme(themeToggle.checked ? 'light' : 'dark');
  themeToggle.blur();
});

// ---- Persistencia de récords (localStorage) ----
const RECORDS_KEY = 'tetris-records';
const BEST_STATS_KEY = 'tetris-best-stats';

// helpers genéricos para no repetir el try/catch en cada get/set
function safeGet(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function safeSet(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // localStorage no disponible; ignoramos silenciosamente
  }
}

function loadRecords() {
  const parsed = safeGet(RECORDS_KEY, []);
  return Array.isArray(parsed) ? parsed : [];
}

function saveRecords(records) {
  safeSet(RECORDS_KEY, records);
}

function loadBestStats() {
  const parsed = safeGet(BEST_STATS_KEY, null);
  return {
    bestCombo: parsed && typeof parsed.bestCombo === 'number' ? parsed.bestCombo : 0,
    maxLines: parsed && typeof parsed.maxLines === 'number' ? parsed.maxLines : 0,
  };
}

function saveBestStats() {
  safeSet(BEST_STATS_KEY, { bestCombo, maxLines });
}

function qualifiesForTop(currentScore) {
  const records = loadRecords();
  if (records.length < 5) return true;
  return currentScore > records[records.length - 1].score;
}

function addRecord(name, currentScore) {
  const records = loadRecords();
  const newRecord = {
    name: name || 'ANÓNIMO',
    score: currentScore,
    lines,
    level,
    date: new Date().toISOString().slice(0, 10),
  };
  records.push(newRecord);
  records.sort((a, b) => b.score - a.score);
  const top5 = records.slice(0, 5);
  saveRecords(top5);
  // usamos identidad de referencia (no name+score) para ubicar el registro
  // recién insertado incluso si hay empates con registros previos
  const newIndex = top5.indexOf(newRecord);
  return { top5, newIndex };
}

function renderRecordsList(listEl, records, highlightIndex) {
  listEl.innerHTML = '';
  if (!records.length) {
    const li = document.createElement('li');
    li.className = 'records-empty';
    li.textContent = 'Sin récords todavía';
    listEl.appendChild(li);
    return;
  }
  records.forEach((rec, i) => {
    const li = document.createElement('li');
    if (i === highlightIndex) li.classList.add('record-new');
    const left = document.createElement('span');
    left.textContent = `${i + 1}. ${rec.name}`;
    const right = document.createElement('span');
    right.textContent = rec.score.toLocaleString();
    li.appendChild(left);
    li.appendChild(right);
    listEl.appendChild(li);
  });
}

function renderStartScreen() {
  const records = loadRecords();
  renderRecordsList(startRecordsList, records, -1);
  const stats = loadBestStats();
  startBestCombo.textContent = stats.bestCombo;
  startMaxLines.textContent = stats.maxLines;
}

const initialBestStats = loadBestStats();
bestCombo = initialBestStats.bestCombo;
maxLines = initialBestStats.maxLines;

function createBoard() {
  return Array.from({ length: ROWS }, () => new Array(COLS).fill(0));
}

function randomPiece() {
  const type = Math.floor(Math.random() * (PIECES.length - 1)) + 1;
  const shape = PIECES[type].map(row => [...row]);
  return { type, shape, x: Math.floor(COLS / 2) - Math.floor(shape[0].length / 2), y: 0 };
}

function collide(shape, ox, oy) {
  for (let r = 0; r < shape.length; r++) {
    for (let c = 0; c < shape[r].length; c++) {
      if (!shape[r][c]) continue;
      const nx = ox + c;
      const ny = oy + r;
      if (nx < 0 || nx >= COLS || ny >= ROWS) return true;
      if (ny >= 0 && board[ny][nx]) return true;
    }
  }
  return false;
}

function rotateCW(shape) {
  const rows = shape.length, cols = shape[0].length;
  const result = Array.from({ length: cols }, () => new Array(rows).fill(0));
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      result[c][rows - 1 - r] = shape[r][c];
  return result;
}

function tryRotate() {
  const rotated = rotateCW(current.shape);
  const kicks = [0, -1, 1, -2, 2];
  for (const kick of kicks) {
    if (!collide(rotated, current.x + kick, current.y)) {
      current.shape = rotated;
      current.x += kick;
      return;
    }
  }
}

function merge() {
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c])
        board[current.y + r][current.x + c] = current.shape[r][c];
}

function clearLines() {
  let cleared = 0;
  let rusty = 0; // líneas oxidadas: contenían un agujero de tuerca
  for (let r = ROWS - 1; r >= 0; r--) {
    if (board[r].every(v => v !== 0)) {
      if (board[r].includes(HOLE)) rusty++;
      board.splice(r, 1);
      board.unshift(new Array(COLS).fill(0));
      cleared++;
      r++;
    }
  }
  if (cleared) {
    lines += cleared;
    // cada línea oxidada aporta sólo la mitad de su parte del puntaje
    score += Math.round((LINE_SCORES[cleared] || 0) * level * (1 - 0.5 * rusty / cleared));
    // el nivel nunca baja del nivel inicial elegido en el menú de pausa
    level = Math.max(startLevel, Math.floor(lines / 10) + 1);
    dropInterval = Math.max(100, 1000 - (level - 1) * 90);
    updateHUD();
  }
  return cleared;
}

function ghostY() {
  let gy = current.y;
  while (!collide(current.shape, current.x, gy + 1)) gy++;
  return gy;
}

function hardDrop() {
  const gy = ghostY();
  score += (gy - current.y) * 2;
  current.y = gy;
  lockPiece();
}

function softDrop() {
  if (!collide(current.shape, current.x, current.y + 1)) {
    current.y++;
    score += 1;
    updateHUD();
  } else {
    lockPiece();
  }
}

function lockPiece() {
  merge();
  const cleared = clearLines();
  let statsChanged = false;
  if (cleared > 0) {
    combo++;
    if (combo > bestCombo) {
      bestCombo = combo;
      statsChanged = true;
    }
  } else {
    combo = 0;
  }
  if (lines > maxLines) {
    maxLines = lines;
    statsChanged = true;
  }
  // persistimos en el momento para no perder el progreso si se cierra la pestaña
  if (statsChanged) saveBestStats();
  spawn();
}

function spawn() {
  current = next;
  next = randomPiece();
  if (collide(current.shape, current.x, current.y)) {
    endGame();
  }
  drawNext();
}

function updateHUD() {
  scoreEl.textContent = score.toLocaleString();
  linesEl.textContent = lines;
  levelEl.textContent = level;
}

// Dibuja el aro vacío del centro de la pieza "tuerca" (colorIndex === HOLE),
// compartido por las 4 skins para no duplicar la lógica del "agujero".
function drawHoleRing(context, cx, cy, radius, strokeColor, lineWidth) {
  context.beginPath();
  context.arc(cx, cy, radius, 0, Math.PI * 2);
  context.fillStyle = boardBgColor;
  context.fill();
  context.strokeStyle = strokeColor;
  context.lineWidth = lineWidth;
  context.stroke();
}

// Cada skin define su propia paleta (índices 1-8, igual longitud que COLORS)
// y su propia función de dibujo de bloque. El caso especial HOLE (agujero
// de la tuerca) se preserva en las 4, adaptando el estilo del aro.
const SKINS = {
  retro: {
    colors: COLORS,
    drawBlock(context, x, y, colorIndex, size, alpha) {
      if (!colorIndex) return;
      if (colorIndex === HOLE) {
        // agujero de la tuerca: metal de fondo con un aro vacío en el centro
        context.globalAlpha = alpha ?? 1;
        context.fillStyle = this.colors[8];
        context.fillRect(x * size + 1, y * size + 1, size - 2, size - 2);
        drawHoleRing(context, x * size + size / 2, y * size + size / 2, size * 0.32, 'rgba(0,0,0,0.45)', 1.5);
        context.globalAlpha = 1;
        return;
      }
      const color = this.colors[colorIndex];
      context.globalAlpha = alpha ?? 1;
      context.fillStyle = color;
      context.fillRect(x * size + 1, y * size + 1, size - 2, size - 2);
      // highlight
      context.fillStyle = blockHighlightColor;
      context.fillRect(x * size + 1, y * size + 1, size - 2, 4);
      context.globalAlpha = 1;
    },
  },

  neon: {
    colors: [
      null,
      '#00e5ff', // I
      '#faff00', // O
      '#e040fb', // T
      '#39ff14', // S
      '#ff1744', // Z
      '#448aff', // J
      '#ff9100', // L
      '#e0e0ff', // N - tuerca
    ],
    drawBlock(context, x, y, colorIndex, size, alpha) {
      if (!colorIndex) return;
      const px = x * size, py = y * size;
      context.globalAlpha = alpha ?? 1;
      if (colorIndex === HOLE) {
        const glow = this.colors[8];
        context.shadowBlur = 10;
        context.shadowColor = glow;
        context.fillStyle = glow;
        context.fillRect(px + 2, py + 2, size - 4, size - 4);
        context.shadowBlur = 0;
        drawHoleRing(context, px + size / 2, py + size / 2, size * 0.3, glow, 1.5);
        context.globalAlpha = 1;
        return;
      }
      const color = this.colors[colorIndex];
      context.shadowBlur = 14;
      context.shadowColor = color;
      context.fillStyle = color;
      context.fillRect(px + 2, py + 2, size - 4, size - 4);
      context.shadowBlur = 0;
      context.strokeStyle = color;
      context.lineWidth = 1;
      context.strokeRect(px + 2, py + 2, size - 4, size - 4);
      context.globalAlpha = 1;
    },
  },

  pastel: {
    colors: [
      null,
      '#aee1f2', // I
      '#fff2b2', // O
      '#dcbdec', // T
      '#bdeccb', // S
      '#f5b6b6', // Z
      '#bcd0f7', // J
      '#f8d3a8', // L
      '#dcdce6', // N - tuerca
    ],
    drawRoundedRect(context, px, py, s, r) {
      context.beginPath();
      if (context.roundRect) {
        context.roundRect(px, py, s, s, r);
      } else {
        // fallback manual para navegadores sin roundRect
        context.moveTo(px + r, py);
        context.arcTo(px + s, py, px + s, py + s, r);
        context.arcTo(px + s, py + s, px, py + s, r);
        context.arcTo(px, py + s, px, py, r);
        context.arcTo(px, py, px + s, py, r);
        context.closePath();
      }
    },
    drawBlock(context, x, y, colorIndex, size, alpha) {
      if (!colorIndex) return;
      const px = x * size + 1, py = y * size + 1, s = size - 2, r = size * 0.22;
      context.globalAlpha = alpha ?? 1;
      if (colorIndex === HOLE) {
        this.drawRoundedRect(context, px, py, s, r);
        context.fillStyle = this.colors[8];
        context.fill();
        drawHoleRing(context, px + s / 2, py + s / 2, size * 0.3, 'rgba(0,0,0,0.25)', 1.5);
        context.globalAlpha = 1;
        return;
      }
      this.drawRoundedRect(context, px, py, s, r);
      context.fillStyle = this.colors[colorIndex];
      context.fill();
      // highlight suave en la parte superior
      context.fillStyle = 'rgba(255,255,255,0.4)';
      this.drawRoundedRect(context, px + 2, py + 2, s - 4, r * 0.6);
      context.fill();
      context.globalAlpha = 1;
    },
  },

  pixelart: {
    colors: COLORS,
    drawBlock(context, x, y, colorIndex, size, alpha) {
      if (!colorIndex) return;
      const px = x * size + 1, py = y * size + 1, s = size - 2;
      const color = colorIndex === HOLE ? this.colors[8] : this.colors[colorIndex];
      context.globalAlpha = alpha ?? 1;
      context.fillStyle = color;
      context.fillRect(px, py, s, s);
      // bisel claro/oscuro estilo sprite pixel art
      context.fillStyle = 'rgba(255,255,255,0.3)';
      context.fillRect(px, py, s, 2);
      context.fillRect(px, py, 2, s);
      context.fillStyle = 'rgba(0,0,0,0.3)';
      context.fillRect(px, py + s - 2, s, 2);
      context.fillRect(px + s - 2, py, 2, s);
      // cuadrícula interna 2x2
      context.strokeStyle = 'rgba(0,0,0,0.2)';
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(px + s / 2, py);
      context.lineTo(px + s / 2, py + s);
      context.moveTo(px, py + s / 2);
      context.lineTo(px + s, py + s / 2);
      context.stroke();
      if (colorIndex === HOLE) {
        drawHoleRing(context, px + s / 2, py + s / 2, size * 0.28, 'rgba(0,0,0,0.45)', 1.5);
      }
      context.globalAlpha = 1;
    },
  },
};

const SKIN_KEY = 'tetris-skin';
let activeSkin = SKINS.retro;

function applySkin(skinName) {
  activeSkin = SKINS[skinName] || SKINS.retro;
  skinSelect.value = SKINS[skinName] ? skinName : 'retro';
  // el fondo del canvas depende del tema, salvo en Neón (siempre negro)
  applyThemeColors();
}

function setSkin(skinName) {
  try { localStorage.setItem(SKIN_KEY, skinName); } catch (e) {}
  applySkin(skinName);
  draw();
  drawNext();
}

skinSelect.addEventListener('change', () => {
  setSkin(skinSelect.value);
});

let savedSkin = null;
try { savedSkin = localStorage.getItem(SKIN_KEY); } catch (e) {}
applySkin(savedSkin || 'retro');

// Se aplica el tema recién ahora, ya que depende de la skin activa (Neón
// fuerza fondo negro sin importar el tema claro/oscuro).
applyTheme(localStorage.getItem(THEME_KEY) || 'dark');

function drawBlock(context, x, y, colorIndex, size, alpha) {
  activeSkin.drawBlock(context, x, y, colorIndex, size, alpha);
  context.shadowBlur = 0;
}

function drawGrid() {
  ctx.strokeStyle = gridLineColor;
  ctx.lineWidth = 0.5;
  for (let c = 1; c < COLS; c++) {
    ctx.beginPath();
    ctx.moveTo(c * BLOCK, 0);
    ctx.lineTo(c * BLOCK, ROWS * BLOCK);
    ctx.stroke();
  }
  for (let r = 1; r < ROWS; r++) {
    ctx.beginPath();
    ctx.moveTo(0, r * BLOCK);
    ctx.lineTo(COLS * BLOCK, r * BLOCK);
    ctx.stroke();
  }
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  // fondo del canvas: en Neón siempre negro puro, en el resto sigue el tema
  ctx.fillStyle = boardBgColor;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  drawGrid();

  // board
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      drawBlock(ctx, c, r, board[r][c], BLOCK);

  // ghost
  const gy = ghostY();
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c])
        drawBlock(ctx, current.x + c, gy + r, current.shape[r][c], BLOCK, 0.2);

  // current piece
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      drawBlock(ctx, current.x + c, current.y + r, current.shape[r][c], BLOCK);
}

function drawNext() {
  const NB = 30;
  nextCtx.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
  nextCtx.fillStyle = boardBgColor;
  nextCtx.fillRect(0, 0, nextCanvas.width, nextCanvas.height);
  const shape = next.shape;
  const offX = Math.floor((4 - shape[0].length) / 2);
  const offY = Math.floor((4 - shape.length) / 2);
  for (let r = 0; r < shape.length; r++)
    for (let c = 0; c < shape[r].length; c++)
      drawBlock(nextCtx, offX + c, offY + r, shape[r][c], NB);
}

function endGame() {
  gameOver = true;
  cancelAnimationFrame(animId);
  overlayTitle.textContent = 'GAME OVER';
  overlayScore.textContent = `Puntuación: ${score.toLocaleString()}`;
  overlayRecordsPanel.classList.remove('hidden');
  // maxLines/bestCombo ya se sincronizan en cada lockPiece(); acá sólo garantizamos
  // que quede persistido antes de mostrar el overlay de game over
  saveBestStats();

  const records = loadRecords();
  if (qualifiesForTop(score)) {
    saveRecordForm.classList.remove('hidden');
    playerNameInput.value = '';
    renderRecordsList(overlayRecordsList, records, -1);
    saveRecordBtn.onclick = () => {
      const name = playerNameInput.value.trim().slice(0, 12) || 'ANÓNIMO';
      const { top5, newIndex } = addRecord(name, score);
      renderRecordsList(overlayRecordsList, top5, newIndex);
      saveRecordForm.classList.add('hidden');
      renderStartScreen();
    };
  } else {
    saveRecordForm.classList.add('hidden');
    renderRecordsList(overlayRecordsList, records, -1);
  }

  overlay.classList.remove('hidden');
}

function hidePauseMenu() {
  pauseMenu.classList.add('hidden');
  pauseControls.classList.add('hidden');
  pauseMenuOpen = false;
}

function openPauseMenu() {
  pauseMenuOpen = true;
  cancelAnimationFrame(animId);
  startLevelSelect.value = String(getStartLevel());
  pauseControls.classList.add('hidden');
  pauseMenu.classList.remove('hidden');
}

function closePauseMenu() {
  hidePauseMenu();
  suppressNextRepeat = true;
  lastTime = performance.now();
  dropAccum = 0;
  animId = requestAnimationFrame(loop);
}

function togglePause() {
  if (gameOver) return;
  if (pauseMenuOpen) {
    closePauseMenu();
  } else {
    openPauseMenu();
  }
}

function loop(ts) {
  const dt = ts - lastTime;
  lastTime = ts;
  dropAccum += dt;
  if (dropAccum >= dropInterval) {
    dropAccum = 0;
    if (!collide(current.shape, current.x, current.y + 1)) {
      current.y++;
    } else {
      lockPiece();
    }
  }
  draw();
  animId = requestAnimationFrame(loop);
}

function init() {
  board = createBoard();
  score = 0;
  lines = 0;
  startLevel = getStartLevel();
  level = startLevel;
  gameOver = false;
  combo = 0;
  dropInterval = Math.max(100, 1000 - (level - 1) * 90);
  dropAccum = 0;
  lastTime = performance.now();
  next = randomPiece();
  spawn();
  updateHUD();
  overlay.classList.add('hidden');
  hidePauseMenu();
  cancelAnimationFrame(animId);
  animId = requestAnimationFrame(loop);
}

document.addEventListener('keydown', e => {
  if (e.code === 'Escape' && document.activeElement === startLevelSelect) {
    // dejar que el navegador cierre el desplegable nativo del select
    // en vez de cerrar todo el menú de pausa de un golpe
    return;
  }
  if (document.activeElement === playerNameInput) return;
  if (!startScreen.classList.contains('hidden')) return;
  if (e.code === 'KeyP' || e.code === 'Escape') {
    if (e.repeat) return;
    togglePause();
    return;
  }
  if (pauseMenuOpen) return;
  if (gameOver) return;
  if (suppressNextRepeat) {
    suppressNextRepeat = false;
    if (e.repeat) return;
  }
  switch (e.code) {
    case 'ArrowLeft':
      if (!collide(current.shape, current.x - 1, current.y)) current.x--;
      break;
    case 'ArrowRight':
      if (!collide(current.shape, current.x + 1, current.y)) current.x++;
      break;
    case 'ArrowDown':
      softDrop();
      break;
    case 'ArrowUp':
    case 'KeyX':
      tryRotate();
      break;
    case 'Space':
      e.preventDefault();
      hardDrop();
      break;
  }
  updateHUD();
});

restartBtn.addEventListener('click', init);

resumeBtn.addEventListener('click', () => {
  if (pauseMenuOpen) closePauseMenu();
});

restartPauseBtn.addEventListener('click', () => {
  hidePauseMenu();
  suppressNextRepeat = true;
  init();
});

controlsToggleBtn.addEventListener('click', () => {
  pauseControls.classList.toggle('hidden');
});

startLevelSelect.addEventListener('change', () => {
  try {
    localStorage.setItem(START_LEVEL_KEY, startLevelSelect.value);
  } catch (e) {}
});

playBtn.addEventListener('click', () => {
  startScreen.classList.add('hidden');
  init();
});

clearRecordsBtn.addEventListener('click', () => {
  if (!confirm('¿Seguro que querés borrar todos los récords y estadísticas?')) return;
  saveRecords([]);
  bestCombo = 0;
  maxLines = 0;
  saveBestStats();
  renderStartScreen();
});

renderStartScreen();
