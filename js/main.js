import { BanqiGame } from './gameLogic.js';
import { DarkChessScene3D } from './scene3d.js';
import { AudioManager } from './audio.js';

const audio = new AudioManager();
let game = new BanqiGame();
let scene3d = null;
let selectedPos = null;
let validMoves = [];
let isBusy = false;
let cutinTimer = null;

// Menu configuration state
const config = {
  mode: 'pve',
  difficulty: 'medium',
  chainCapture: false
};

// DOM References
const introOverlay = document.getElementById('intro-overlay');
const introGate = document.getElementById('intro-gate');
const videoStage = document.getElementById('video-stage');
const introVideo = document.getElementById('intro-video');
const menuOverlay = document.getElementById('menu-overlay');
const hud = document.getElementById('hud');
const gameoverOverlay = document.getElementById('gameover-overlay');

const turnBanner = document.getElementById('turn-banner');
const turnText = document.getElementById('turn-text');
const turnSub = document.getElementById('turn-sub');
const hudModeBadge = document.getElementById('hud-mode-badge');
const btnEndChain = document.getElementById('btn-end-chain');

const redDeadList = document.getElementById('red-dead-list');
const blackDeadList = document.getElementById('black-dead-list');
const redAliveCount = document.getElementById('red-alive-count');
const blackAliveCount = document.getElementById('black-alive-count');

const inspectorCard = document.getElementById('inspector-card');
const inspectorImg = document.getElementById('inspector-img');
const inspectorChar = document.getElementById('inspector-char');
const inspectorTitle = document.getElementById('inspector-title');
const inspectorDesc = document.getElementById('inspector-desc');

const cutinOverlay = document.getElementById('cutin-overlay');
const cutinBanner = document.getElementById('cutin-banner');
const cutinImg = document.getElementById('cutin-img');
const cutinTag = document.getElementById('cutin-tag');
const cutinQuote = document.getElementById('cutin-quote');

async function init() {
  scene3d = new DarkChessScene3D(
    document.getElementById('canvas-container'),
    handleTileClick,
    handleTileHover
  );
  await scene3d.preloadPortraits();
  scene3d.syncBoard(game.board);
  bindUI();
}

function bindUI() {
  // Intro Gate & Video
  document.getElementById('btn-play-intro').addEventListener('click', () => {
    introGate.classList.add('hidden');
    videoStage.classList.remove('hidden');
    introVideo.currentTime = 0;
    introVideo.play().catch(() => finishIntro());
  });

  document.getElementById('btn-skip-gate').addEventListener('click', finishIntro);
  document.getElementById('btn-skip-video').addEventListener('click', finishIntro);
  introVideo.addEventListener('ended', finishIntro);

  // Menu Controls
  document.querySelectorAll('#mode-group .seg-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#mode-group .seg-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      config.mode = btn.dataset.mode;
      document.getElementById('difficulty-section').style.display = config.mode === 'pve' ? 'block' : 'none';
    });
  });

  document.querySelectorAll('#diff-group .seg-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#diff-group .seg-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      config.difficulty = btn.dataset.diff;
    });
  });

  document.getElementById('chk-chain-capture').addEventListener('change', (e) => {
    config.chainCapture = e.target.checked;
  });

  document.getElementById('btn-start-game').addEventListener('click', startNewGame);
  document.getElementById('btn-replay-intro').addEventListener('click', () => {
    audio.stopBgm();
    menuOverlay.classList.add('hidden');
    introOverlay.classList.remove('hidden', 'fade-out');
    introGate.classList.add('hidden');
    videoStage.classList.remove('hidden');
    introVideo.currentTime = 0;
    introVideo.play().catch(() => finishIntro());
  });

  // HUD Controls
  document.getElementById('btn-camera').addEventListener('click', (e) => {
    const name = scene3d.cycleCameraPreset();
    e.currentTarget.textContent = `🎥 視角：${name}`;
  });

  document.getElementById('btn-bgm').addEventListener('click', (e) => {
    const on = audio.toggleBgm();
    e.currentTarget.classList.toggle('active', on);
  });

  document.getElementById('btn-sfx').addEventListener('click', (e) => {
    const on = audio.toggleSfx();
    e.currentTarget.classList.toggle('active', on);
  });

  document.getElementById('btn-undo').addEventListener('click', () => {
    if (isBusy || game.gameOver) return;
    const steps = (game.mode === 'pve' && game.currentPlayer === 'human' && game.history.length >= 2) ? 2 : 1;
    if (game.undo(steps)) {
      clearSelection();
      scene3d.syncBoard(game.board);
      updateHUD();
      audio.playSfx('select', 0.6);
    }
  });

  document.getElementById('btn-restart').addEventListener('click', startNewGame);
  document.getElementById('btn-menu').addEventListener('click', () => {
    hud.classList.add('hidden');
    gameoverOverlay.classList.add('hidden');
    menuOverlay.classList.remove('hidden');
    scene3d.setMenuOrbit(true);
  });

  btnEndChain.addEventListener('click', () => {
    if (isBusy || !game.chainPos) return;
    game.endChainTurn();
    clearSelection();
    updateHUD();
    maybeTriggerAi();
  });

  document.getElementById('btn-play-again').addEventListener('click', startNewGame);
  document.getElementById('btn-back-menu').addEventListener('click', () => {
    gameoverOverlay.classList.add('hidden');
    hud.classList.add('hidden');
    menuOverlay.classList.remove('hidden');
    scene3d.setMenuOrbit(true);
  });
}

function finishIntro() {
  introVideo.pause();
  introOverlay.classList.add('fade-out');
  setTimeout(() => {
    introOverlay.classList.add('hidden');
    menuOverlay.classList.remove('hidden');
  }, 500);
}

function startNewGame() {
  isBusy = false;
  game = new BanqiGame(config);
  clearSelection();
  menuOverlay.classList.add('hidden');
  gameoverOverlay.classList.add('hidden');
  hud.classList.remove('hidden');

  const diffLabels = {
    easy: '入門',
    medium: '普通',
    hard: '困難',
    master: '宗師',
    abyss: '地獄'
  };
  hudModeBadge.textContent = config.mode === 'pve'
    ? `單人・${diffLabels[config.difficulty]}`
    : '雙人同機';

  scene3d.setMenuOrbit(false);
  scene3d.syncBoard(game.board);
  updateHUD();

  audio.startBgm();
  audio.playSfx('gong', 0.45, 0);
  setTimeout(() => audio.playVoice('game_start'), 350);
}

function clearSelection() {
  selectedPos = null;
  validMoves = [];
  if (scene3d) scene3d.setSelection(null, null, []);
}

function handleTileHover(r, c) {
  if (r < 0 || c < 0) {
    inspectorCard.classList.add('hidden');
    return;
  }
  const piece = game.board[r][c];
  if (!piece || !piece.revealed) {
    inspectorCard.classList.add('hidden');
    return;
  }
  inspectorImg.src = `assets/portraits/${piece.meta.key}.png`;
  inspectorChar.textContent = piece.meta.char;
  inspectorChar.classList.toggle('black', piece.color === 'black');
  inspectorTitle.textContent = `${piece.color === 'red' ? '烈焰聖殿' : '冥淵暗影'}・${piece.meta.name}`;
  inspectorDesc.textContent = piece.meta.desc;
  inspectorCard.classList.remove('hidden');
}

async function handleTileClick(r, c) {
  if (isBusy || game.gameOver) return;
  if (game.mode === 'pve' && game.turnColor && game.currentPlayer === 'ai') return;

  const clicked = game.board[r][c];

  // If currently in chain capture state, only allow continuing capture from chainPos
  if (game.chainPos) {
    const chainMoves = game.getValidMovesForPiece(game.chainPos.r, game.chainPos.c, game.board, true);
    const chosen = chainMoves.find(m => m.tr === r && m.tc === c);
    if (chosen) {
      await executeAction(chosen);
    }
    return;
  }

  // Case 1: Clicked a valid move/capture destination for currently selected piece
  if (selectedPos) {
    const move = validMoves.find(m => m.tr === r && m.tc === c);
    if (move) {
      await executeAction(move);
      return;
    }
  }

  // Case 2: Clicked a face-down piece -> Flip!
  if (clicked && !clicked.revealed) {
    clearSelection();
    await executeAction({ type: 'flip', r, c });
    return;
  }

  // Case 3: Clicked own revealed piece -> Select it
  if (clicked && clicked.revealed && (!game.turnColor || clicked.color === game.turnColor)) {
    selectedPos = { r, c };
    validMoves = game.getValidMovesForPiece(r, c, game.board, false);
    scene3d.setSelection(r, c, validMoves);
    audio.playSfx('select', 0.65);
    return;
  }

  // Otherwise deselect
  clearSelection();
}

async function executeAction(action) {
  isBusy = true;
  clearSelection();

  const res = game.applyAction(action);
  if (!res) {
    isBusy = false;
    return;
  }

  if (res.type === 'flip') {
    audio.playSfx('flip', 0.9);
    await scene3d.animateFlip(res.piece.id, res.piece.color);

    if (res.firstFlip) {
      audio.playVoice(res.piece.color === 'red' ? 'red_first' : 'black_first');
      showCutin(res.piece, res.piece.color === 'red' ? '「烈焰覺醒，紅方執先！」' : '「冥淵降臨，黑方執先！」');
    } else if (res.piece.rank >= 4) {
      // High-rank hero reveal cut-in!
      audio.playVoice(res.piece.meta.key);
      showCutin(res.piece, res.piece.meta.quote);
    }
  } else if (res.type === 'move') {
    audio.playSfx('move', 0.85);
    await scene3d.animateMoveOrCapture(res.attacker.id, null, res.tr, res.tc, false, res.attacker.color);
  } else if (res.type === 'capture') {
    audio.playSfx(res.isCannon ? 'cannon' : 'capture', 0.95);
    await scene3d.animateMoveOrCapture(
      res.attacker.id,
      res.defender.id,
      res.tr,
      res.tc,
      res.isCannon,
      res.attacker.color,
      res.attacker.rank,
      res.soldierSlaysGeneral
    );

    if (res.soldierSlaysGeneral) {
      audio.playVoice('soldier_slays_general');
      showCutin(res.attacker, '「不可思議！小兵竟斬落大將！」');
    } else {
      audio.playVoice(res.attacker.meta.key);
      showCutin(res.attacker, res.attacker.meta.quote);
    }

    // Highlight next chain-capture targets if human can chain
    if (res.canChain && !(game.mode === 'pve' && game.currentPlayer === 'ai')) {
      selectedPos = { r: res.tr, c: res.tc };
      validMoves = game.getValidMovesForPiece(res.tr, res.tc, game.board, true);
      scene3d.setSelection(res.tr, res.tc, validMoves);
    }
  }

  updateHUD();
  isBusy = false;

  if (game.gameOver) {
    handleGameOver();
    return;
  }

  maybeTriggerAi();
}

function maybeTriggerAi() {
  if (game.gameOver || game.mode !== 'pve' || !game.turnColor) return;
  if (game.currentPlayer !== 'ai') return;

  isBusy = true;
  setTimeout(async () => {
    const act = game.chooseAiAction();
    isBusy = false;
    if (!act) return;
    if (act.type === 'endChain') {
      game.endChainTurn();
      updateHUD();
    } else {
      await executeAction(act);
    }
  }, 620);
}

function showCutin(piece, quote) {
  cutinImg.src = `assets/portraits/${piece.meta.key}.png`;
  cutinTag.textContent = `${piece.color === 'red' ? '烈焰聖殿' : '冥淵暗影'}・${piece.meta.char}（${piece.meta.name}）`;
  cutinQuote.textContent = quote;
  cutinBanner.classList.toggle('black', piece.color === 'black');
  cutinOverlay.classList.remove('hidden');

  if (cutinTimer) clearTimeout(cutinTimer);
  cutinTimer = setTimeout(() => {
    cutinOverlay.classList.add('hidden');
  }, 2400);
}

function updateHUD() {
  turnBanner.classList.remove('red-turn', 'black-turn');
  if (!game.turnColor) {
    turnText.textContent = '請翻開第一枚命運之棋';
  } else {
    const isRed = game.turnColor === 'red';
    turnBanner.classList.add(isRed ? 'red-turn' : 'black-turn');
    const factionName = isRed ? '烈焰聖殿（紅方）' : '冥淵暗影（黑方）';
    const who = game.mode === 'pve'
      ? (game.currentPlayer === 'ai' ? 'AI 思考中...' : '輪到你行動')
      : '回合行動';
    turnText.textContent = `${factionName}・${who}`;
  }
  turnSub.textContent = `和局計數 ${game.noProgressCount}/50`;
  btnEndChain.classList.toggle('hidden', !game.chainPos || (game.mode === 'pve' && game.currentPlayer === 'ai'));

  // Update Graveyards
  const alive = game.getAliveCounts();
  redAliveCount.textContent = `存活 ${alive.red}`;
  blackAliveCount.textContent = `存活 ${alive.black}`;

  renderGraveyard(redDeadList, game.captured.red, 'red');
  renderGraveyard(blackDeadList, game.captured.black, 'black');
}

function renderGraveyard(el, list, color) {
  el.innerHTML = '';
  const sorted = [...list].sort((a, b) => b.rank - a.rank);
  for (const p of sorted) {
    const chip = document.createElement('div');
    chip.className = `dead-chip ${color}`;
    chip.title = `${p.meta.name}（${p.meta.char}）`;
    chip.innerHTML = `<img src="assets/portraits/${p.meta.key}.png" alt="${p.meta.char}" /><span>${p.meta.char}</span>`;
    el.appendChild(chip);
  }
}

function handleGameOver() {
  audio.playSfx('gong', 0.85, 0);
  const crest = document.getElementById('gameover-crest');
  const title = document.getElementById('gameover-title');
  const desc = document.getElementById('gameover-desc');
  const stats = document.getElementById('gameover-stats');

  if (game.winner === 'red') {
    crest.src = 'assets/portraits/r_emblem.png';
    title.textContent = '烈焰聖殿 獲勝！';
    setTimeout(() => audio.playVoice('red_win'), 450);
  } else if (game.winner === 'black') {
    crest.src = 'assets/portraits/b_emblem.png';
    title.textContent = '冥淵暗影 獲勝！';
    setTimeout(() => audio.playVoice('black_win'), 450);
  } else {
    crest.src = 'assets/portraits/r_emblem.png';
    title.textContent = '勢均力敵・和局';
    setTimeout(() => audio.playVoice('draw_game'), 450);
  }
  desc.textContent = game.winReason;
  stats.textContent = `總回合數：${game.turnCount} 回合`;
  setTimeout(() => gameoverOverlay.classList.remove('hidden'), 850);
}

init();
