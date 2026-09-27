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

let board, current, next, score, lines, level, paused, gameOver, lastTime, dropAccum, dropInterval, animId;
let combo, bestCombo, maxLines;

const THEME_KEY = 'tetris-theme';
let gridLineColor = '#22222e';
let blockHighlightColor = 'rgba(255,255,255,0.12)';
let boardBgColor = '#0f0f17';

function applyThemeColors() {
  const style = getComputedStyle(document.body);
  gridLineColor = style.getPropertyValue('--grid-line').trim();
  blockHighlightColor = style.getPropertyValue('--block-highlight').trim();
  boardBgColor = style.getPropertyValue('--bg').trim();
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

applyTheme(localStorage.getItem(THEME_KEY) || 'dark');

// ---- Persistencia de récords (localStorage) ----
const RECORDS_KEY = 'tetris-records';
const BEST_STATS_KEY = 'tetris-best-stats';

function loadRecords() {
  try {
    const raw = localStorage.getItem(RECORDS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveRecords(records) {
  try {
    localStorage.setItem(RECORDS_KEY, JSON.stringify(records));
  } catch {
    // localStorage no disponible; ignoramos silenciosamente
  }
}

function loadBestStats() {
  try {
    const raw = localStorage.getItem(BEST_STATS_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return {
      bestCombo: parsed && typeof parsed.bestCombo === 'number' ? parsed.bestCombo : 0,
      maxLines: parsed && typeof parsed.maxLines === 'number' ? parsed.maxLines : 0,
    };
  } catch {
    return { bestCombo: 0, maxLines: 0 };
  }
}

function saveBestStats() {
  try {
    localStorage.setItem(BEST_STATS_KEY, JSON.stringify({ bestCombo, maxLines }));
  } catch {
    // localStorage no disponible; ignoramos silenciosamente
  }
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
    level = Math.floor(lines / 10) + 1;
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

function drawBlock(context, x, y, colorIndex, size, alpha) {
  if (!colorIndex) return;
  if (colorIndex === HOLE) {
    // agujero de la tuerca: metal de fondo con un aro vacío en el centro
    context.globalAlpha = alpha ?? 1;
    context.fillStyle = COLORS[8];
    context.fillRect(x * size + 1, y * size + 1, size - 2, size - 2);
    context.beginPath();
    context.arc(x * size + size / 2, y * size + size / 2, size * 0.32, 0, Math.PI * 2);
    context.fillStyle = boardBgColor;
    context.fill();
    context.strokeStyle = 'rgba(0,0,0,0.45)';
    context.lineWidth = 1.5;
    context.stroke();
    context.globalAlpha = 1;
    return;
  }
  const color = COLORS[colorIndex];
  context.globalAlpha = alpha ?? 1;
  context.fillStyle = color;
  context.fillRect(x * size + 1, y * size + 1, size - 2, size - 2);
  // highlight
  context.fillStyle = blockHighlightColor;
  context.fillRect(x * size + 1, y * size + 1, size - 2, 4);
  context.globalAlpha = 1;
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
  if (lines > maxLines) maxLines = lines;
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

function togglePause() {
  if (gameOver) return;
  paused = !paused;
  if (!paused) {
    lastTime = performance.now();
    loop(lastTime);
  } else {
    cancelAnimationFrame(animId);
    overlayTitle.textContent = 'PAUSA';
    overlayScore.textContent = '';
    saveRecordForm.classList.add('hidden');
    overlayRecordsPanel.classList.add('hidden');
    overlayRecordsList.innerHTML = '';
    overlay.classList.remove('hidden');
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
  level = 1;
  paused = false;
  gameOver = false;
  combo = 0;
  dropInterval = 1000;
  dropAccum = 0;
  lastTime = performance.now();
  next = randomPiece();
  spawn();
  updateHUD();
  overlay.classList.add('hidden');
  cancelAnimationFrame(animId);
  animId = requestAnimationFrame(loop);
}

document.addEventListener('keydown', e => {
  if (document.activeElement === playerNameInput) return;
  if (!startScreen.classList.contains('hidden')) return;
  if (e.code === 'KeyP') { togglePause(); return; }
  if (paused || gameOver) return;
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
