// Taiwanese Dark Chess (Banqi) Rules Engine + 3-Tier AI

export const PIECE_META = {
  red: {
    6: { key: 'r_general',  char: '帥', name: '烈焰大元帥', desc: '除冥淵死士外，可斬殺一切敵軍', quote: '「三軍聽令，以烈焰焚盡宵小！」', value: 100 },
    5: { key: 'r_advisor',  char: '仕', name: '紅蓮御前劍衛', desc: '貼身近衛，僅次於元帥', quote: '「紅蓮劍光，誓死護駕！」', value: 65 },
    4: { key: 'r_elephant', char: '相', name: '赤炎大軍師', desc: '掌控炎紋法術的智將', quote: '「炎紋既成，一切盡在掌握。」', value: 45 },
    3: { key: 'r_chariot',  char: '俥', name: '熔岩重裝戰將', desc: '衝鋒陷陣的鋼鐵壁壘', quote: '「重甲突擊，碾碎他們！」', value: 32 },
    2: { key: 'r_horse',    char: '傌', name: '赤焰龍鱗騎', desc: '迅捷如火的先鋒騎將', quote: '「赤焰奔騰，疾如烈風！」', value: 22 },
    1: { key: 'r_cannon',   char: '炮', name: '炎核砲擊師', desc: '可隔一棋遠距轟殺任意階級敵軍', quote: '「看我炎砲轟擊，隔山打牛！」', value: 55 },
    0: { key: 'r_soldier',  char: '兵', name: '烈焰先鋒兵', desc: '可逆襲斬殺敵方冥淵霸主（將）', quote: '「烈焰先鋒，絕不退縮！」', value: 18 }
  },
  black: {
    6: { key: 'b_general',  char: '將', name: '冥淵黑曜霸主', desc: '除烈焰先鋒外，統御全場', quote: '「跪伏於冥淵之下，感受絕望吧！」', value: 100 },
    5: { key: 'b_advisor',  char: '士', name: '幽影暗刃衛', desc: '無聲殺手，貼身護衛霸主', quote: '「暗影無聲，無人能越雷池一步。」', value: 65 },
    4: { key: 'b_elephant', char: '象', name: '虛空死靈策士', desc: '操控魂晶的暗影謀士', quote: '「愚蠢的掙扎，你已落入陷阱。」', value: 45 },
    3: { key: 'b_chariot',  char: '車', name: '黑鐵巨像騎士', desc: '無堅不摧的冥界巨像', quote: '「黑鐵巨像，踏平一切阻礙！」', value: 32 },
    2: { key: 'b_horse',    char: '馬', name: '幽冥角盔騎將', desc: '踏霧而行的追魂黑騎', quote: '「幽冥鐵騎，你逃不掉的！」', value: 22 },
    1: { key: 'b_cannon',   char: '包', name: '虛空煉金爆破手', desc: '可隔一棋遠距轟殺任意階級敵軍', quote: '「虛空爆裂，化作灰燼吧！」', value: 55 },
    0: { key: 'b_soldier',  char: '卒', name: '暗影鐵血死士', desc: '可逆襲斬殺敵方烈焰大元帥（帥）', quote: '「死士無畏，奉主之命！」', value: 18 }
  }
};

const RANK_COUNTS = [
  { rank: 6, count: 1 },
  { rank: 5, count: 2 },
  { rank: 4, count: 2 },
  { rank: 3, count: 2 },
  { rank: 2, count: 2 },
  { rank: 1, count: 2 },
  { rank: 0, count: 5 }
];

export const ROWS = 4;
export const COLS = 8;

export function canCaptureRank(attackerRank, defenderRank) {
  // Cannon captures via jump rule (handled separately), never by adjacent standard rank rule
  if (attackerRank === 1) return false;
  if (attackerRank === 0 && defenderRank === 6) return true;
  if (attackerRank === 6 && defenderRank === 0) return false;
  return attackerRank >= defenderRank;
}

export class BanqiGame {
  constructor(options = {}) {
    this.mode = options.mode || 'pve';           // 'pve' | 'pvp'
    this.difficulty = options.difficulty || 'medium'; // 'easy' | 'medium' | 'hard'
    this.chainCapture = !!options.chainCapture;
    this.reset();
  }

  reset() {
    const deck = [];
    let id = 1;
    for (const color of ['red', 'black']) {
      for (const { rank, count } of RANK_COUNTS) {
        for (let i = 0; i < count; i++) {
          deck.push({
            id: id++,
            color,
            rank,
            revealed: false,
            meta: PIECE_META[color][rank]
          });
        }
      }
    }
    // Fisher-Yates shuffle
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }

    this.board = Array.from({ length: ROWS }, (_, r) =>
      Array.from({ length: COLS }, (_, c) => deck[r * COLS + c])
    );

    this.turnColor = null;        // null until first flip
    this.playerColor = null;      // in PvE, human's faction
    this.aiColor = null;          // in PvE, AI's faction
    this.currentPlayer = 'human'; // 'human' | 'ai' (in PvE)
    this.captured = { red: [], black: [] };
    this.noProgressCount = 0;     // 50-move draw counter
    this.turnCount = 0;
    this.gameOver = false;
    this.winner = null;           // 'red' | 'black' | 'draw'
    this.winReason = '';
    this.chainPos = null;         // { r, c } if currently in chain capture state
    this.history = [];
  }

  cloneBoard(board = this.board) {
    return board.map(row => row.map(cell => (cell ? { ...cell } : null)));
  }

  saveSnapshot() {
    this.history.push({
      board: this.cloneBoard(),
      turnColor: this.turnColor,
      playerColor: this.playerColor,
      aiColor: this.aiColor,
      currentPlayer: this.currentPlayer,
      captured: {
        red: this.captured.red.map(p => ({ ...p })),
        black: this.captured.black.map(p => ({ ...p }))
      },
      noProgressCount: this.noProgressCount,
      turnCount: this.turnCount,
      gameOver: this.gameOver,
      winner: this.winner,
      winReason: this.winReason,
      chainPos: this.chainPos ? { ...this.chainPos } : null
    });
    if (this.history.length > 60) this.history.shift();
  }

  undo(steps = 1) {
    if (this.history.length === 0) return false;
    let snap = null;
    for (let i = 0; i < steps && this.history.length > 0; i++) {
      snap = this.history.pop();
    }
    if (!snap) return false;
    this.board = snap.board;
    this.turnColor = snap.turnColor;
    this.playerColor = snap.playerColor;
    this.aiColor = snap.aiColor;
    this.currentPlayer = snap.currentPlayer;
    this.captured = snap.captured;
    this.noProgressCount = snap.noProgressCount;
    this.turnCount = snap.turnCount;
    this.gameOver = snap.gameOver;
    this.winner = snap.winner;
    this.winReason = snap.winReason;
    this.chainPos = snap.chainPos;
    return true;
  }

  inBounds(r, c) {
    return r >= 0 && r < ROWS && c >= 0 && c < COLS;
  }

  getValidMovesForPiece(r, c, board = this.board, capturesOnly = false) {
    const piece = board[r][c];
    if (!piece || !piece.revealed) return [];
    const moves = [];
    const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];

    for (const [dr, dc] of dirs) {
      const nr = r + dr;
      const nc = c + dc;
      if (!this.inBounds(nr, nc)) continue;
      const target = board[nr][nc];

      if (!target) {
        if (!capturesOnly) {
          moves.push({ type: 'move', fr: r, fc: c, tr: nr, tc: nc, isCannon: false });
        }
      } else if (target.revealed && target.color !== piece.color && piece.rank !== 1) {
        if (canCaptureRank(piece.rank, target.rank)) {
          moves.push({ type: 'capture', fr: r, fc: c, tr: nr, tc: nc, isCannon: false });
        }
      }
    }

    // Cannon jump capture rule: jump over exactly 1 piece (revealed or face-down)
    if (piece.rank === 1) {
      for (const [dr, dc] of dirs) {
        let nr = r + dr;
        let nc = c + dc;
        let jumped = false;
        while (this.inBounds(nr, nc)) {
          const cell = board[nr][nc];
          if (cell) {
            if (!jumped) {
              jumped = true;
            } else {
              if (cell.revealed && cell.color !== piece.color) {
                moves.push({ type: 'capture', fr: r, fc: c, tr: nr, tc: nc, isCannon: true });
              }
              break;
            }
          }
          nr += dr;
          nc += dc;
        }
      }
    }
    return moves;
  }

  getAllLegalActions(color, board = this.board) {
    const actions = [];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const p = board[r][c];
        if (!p) continue;
        if (!p.revealed) {
          actions.push({ type: 'flip', r, c });
        } else if (p.color === color) {
          actions.push(...this.getValidMovesForPiece(r, c, board, false));
        }
      }
    }
    return actions;
  }

  endChainTurn() {
    if (!this.chainPos) return false;
    this.chainPos = null;
    this.advanceTurn();
    this.checkGameOver();
    return true;
  }

  advanceTurn() {
    this.turnCount++;
    this.turnColor = this.turnColor === 'red' ? 'black' : 'red';
    if (this.mode === 'pve') {
      this.currentPlayer = this.turnColor === this.aiColor ? 'ai' : 'human';
    }
  }

  applyAction(action, saveHistory = true) {
    if (this.gameOver) return null;
    if (saveHistory) this.saveSnapshot();

    if (action.type === 'flip') {
      const piece = this.board[action.r][action.c];
      if (!piece || piece.revealed) return null;
      piece.revealed = true;
      this.noProgressCount = 0;
      this.chainPos = null;

      let firstFlip = false;
      if (!this.turnColor) {
        firstFlip = true;
        this.turnColor = piece.color;
        if (this.mode === 'pve') {
          this.playerColor = piece.color;
          this.aiColor = piece.color === 'red' ? 'black' : 'red';
        }
      }
      this.advanceTurn();
      this.checkGameOver();
      return { type: 'flip', r: action.r, c: action.c, piece, firstFlip };
    }

    if (action.type === 'move' || action.type === 'capture') {
      const attacker = this.board[action.fr][action.fc];
      const defender = this.board[action.tr][action.tc];
      if (!attacker || !attacker.revealed) return null;

      this.board[action.tr][action.tc] = attacker;
      this.board[action.fr][action.fc] = null;

      let soldierSlaysGeneral = false;
      if (defender) {
        this.captured[defender.color].push(defender);
        this.noProgressCount = 0;
        if (attacker.rank === 0 && defender.rank === 6) {
          soldierSlaysGeneral = true;
        }
      } else {
        this.noProgressCount++;
      }

      // Check chain capture option
      let canChain = false;
      if (defender && this.chainCapture) {
        const nextCaps = this.getValidMovesForPiece(action.tr, action.tc, this.board, true);
        if (nextCaps.length > 0) {
          canChain = true;
          this.chainPos = { r: action.tr, c: action.tc };
        }
      }

      if (!canChain) {
        this.chainPos = null;
        this.advanceTurn();
      }
      this.checkGameOver();
      return {
        type: defender ? 'capture' : 'move',
        fr: action.fr,
        fc: action.fc,
        tr: action.tr,
        tc: action.tc,
        attacker,
        defender,
        isCannon: !!action.isCannon,
        soldierSlaysGeneral,
        canChain
      };
    }
    return null;
  }

  getAliveCounts(board = this.board) {
    let red = 0, black = 0;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const p = board[r][c];
        if (!p) continue;
        if (p.color === 'red') red++;
        else black++;
      }
    }
    return { red, black };
  }

  checkGameOver() {
    const { red, black } = this.getAliveCounts();
    if (red === 0) {
      this.gameOver = true;
      this.winner = 'black';
      this.winReason = '冥淵暗影徹底殲滅了烈焰聖殿所有軍力！';
      return;
    }
    if (black === 0) {
      this.gameOver = true;
      this.winner = 'red';
      this.winReason = '烈焰聖殿徹底殲滅了冥淵暗影所有軍力！';
      return;
    }
    if (this.noProgressCount >= 50) {
      this.gameOver = true;
      this.winner = 'draw';
      this.winReason = '連續 50 步未翻棋亦未吃子，雙方勢均力敵判和。';
      return;
    }
    if (this.turnColor && !this.chainPos) {
      const legal = this.getAllLegalActions(this.turnColor);
      if (legal.length === 0) {
        this.gameOver = true;
        this.winner = this.turnColor === 'red' ? 'black' : 'red';
        this.winReason = `${this.turnColor === 'red' ? '紅方' : '黑方'}無子可走，勝負已分！`;
      }
    }
  }

  // ===================== 6-Tier AI (入門 / 普通 / 困難 / 宗師 / 地獄 / 神域) =====================
  chooseAiAction() {
    const color = this.aiColor;
    if (!color || this.gameOver) return null;

    // If AI is mid-chain capture, continue capturing if beneficial
    if (this.chainPos) {
      const caps = this.getValidMovesForPiece(this.chainPos.r, this.chainPos.c, this.board, true);
      if (caps.length > 0) {
        caps.sort((a, b) => this.board[b.tr][b.tc].meta.value - this.board[a.tr][a.tc].meta.value);
        return caps[0];
      }
      return { type: 'endChain' };
    }

    const actions = this.getAllLegalActions(color);
    if (actions.length === 0) return null;

    if (this.difficulty === 'easy') return this._aiEasy(actions);
    if (this.difficulty === 'medium') return this._aiMedium(color, actions);
    if (this.difficulty === 'hard') return this._aiSearchPro(color, actions, { maxDepth: 3, qDepth: 2, budgetMs: 220, advanced: false, deepFlip: false });
    if (this.difficulty === 'master') return this._aiSearchPro(color, actions, { maxDepth: 5, qDepth: 3, budgetMs: 420, advanced: true, deepFlip: false });
    if (this.difficulty === 'abyss') return this._aiSearchPro(color, actions, { maxDepth: 7, qDepth: 4, budgetMs: 720, advanced: true, deepFlip: true });
    // 'god' (神域級：最高深度8層迭代加深 + 置換表 + 靜態吃子搜尋 + 炮架/暗子全期望值精算)
    return this._aiSearchPro(color, actions, { maxDepth: 8, qDepth: 5, budgetMs: 1100, advanced: true, deepFlip: true, godMode: true });
  }

  _aiEasy(actions) {
    const captures = actions.filter(a => a.type === 'capture');
    if (captures.length > 0 && Math.random() < 0.7) {
      return captures[Math.floor(Math.random() * captures.length)];
    }
    const flips = actions.filter(a => a.type === 'flip');
    if (flips.length > 0 && Math.random() < 0.55) {
      return flips[Math.floor(Math.random() * flips.length)];
    }
    return actions[Math.floor(Math.random() * actions.length)];
  }

  _getUnrevealedPool(board) {
    const pool = [];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const p = board[r][c];
        if (p && !p.revealed) pool.push(p);
      }
    }
    return pool;
  }

  _boardHashKey(board, turnColor) {
    // Fast compact position key for transposition table & repetition avoidance
    let key = turnColor === 'red' ? 'R:' : 'B:';
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const p = board[r][c];
        if (!p) key += '.';
        else if (!p.revealed) key += '?';
        else key += (p.color === 'red' ? String.fromCharCode(65 + p.rank) : String.fromCharCode(97 + p.rank));
      }
    }
    return key;
  }

  _isAttackedByEnemyCannon(board, tr, tc, enemyColor) {
    const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    for (const [dr, dc] of dirs) {
      let nr = tr + dr, nc = tc + dc;
      let screenFound = false;
      while (this.inBounds(nr, nc)) {
        const cell = board[nr][nc];
        if (cell) {
          if (!screenFound) {
            screenFound = true;
          } else {
            if (cell.revealed && cell.color === enemyColor && cell.rank === 1) return true;
            break;
          }
        }
        nr += dr;
        nc += dc;
      }
    }
    return false;
  }

  _evaluateBoard(board, aiColor, advanced = false, godMode = false) {
    const enemy = aiColor === 'red' ? 'black' : 'red';
    let score = 0;
    const myPieces = [];
    const enemyPieces = [];
    let enemyHasGeneral = false;
    let myHasGeneral = false;
    let enemyHasSoldiers = 0;
    let myHasSoldiers = 0;
    let enemyHasCannons = 0;
    let myHasCannons = 0;
    let hiddenCount = 0;

    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const p = board[r][c];
        if (!p) continue;
        if (!p.revealed) {
          hiddenCount++;
          continue;
        }
        if (p.color === aiColor) {
          myPieces.push({ r, c, p });
          if (p.rank === 6) myHasGeneral = true;
          if (p.rank === 0) myHasSoldiers++;
          if (p.rank === 1) myHasCannons++;
        } else {
          enemyPieces.push({ r, c, p });
          if (p.rank === 6) enemyHasGeneral = true;
          if (p.rank === 0) enemyHasSoldiers++;
          if (p.rank === 1) enemyHasCannons++;
        }
      }
    }

    // Terminal win/loss detection when no hidden pieces remain
    if (hiddenCount === 0) {
      if (enemyPieces.length === 0) return 100000;
      if (myPieces.length === 0) return -100000;
    }

    const totalPieces = myPieces.length + enemyPieces.length + hiddenCount;

    // Dynamic Banqi piece valuation
    const dynVal = (p, isMine) => {
      let v = p.meta.value;
      if (advanced) {
        if (p.rank === 0) {
          const oppGen = isMine ? enemyHasGeneral : myHasGeneral;
          v = oppGen ? 42 : 16;
        } else if (p.rank === 1) {
          // Cannons are lethal when screens exist, weaker in sparse endgames
          v = totalPieces >= 12 ? 72 : (totalPieces >= 6 ? 56 : 36);
        } else if (p.rank === 6) {
          const oppSoldiers = isMine ? enemyHasSoldiers : myHasSoldiers;
          const oppCannons = isMine ? enemyHasCannons : myHasCannons;
          if (oppSoldiers === 0 && oppCannons === 0 && hiddenCount === 0) v = 185; // Unkillable god General!
          else if (oppSoldiers === 0) v = 140;
          else v = 108;
        } else if (p.rank === 5) {
          const oppGen = isMine ? enemyHasGeneral : myHasGeneral;
          v = (!oppGen && hiddenCount === 0) ? 88 : 68;
        }
      }
      return v;
    };

    for (const m of myPieces) {
      score += dynVal(m.p, true) * 1.25;
      if (advanced) {
        const centerDist = Math.abs(m.r - 1.5) + Math.abs(m.c - 3.5);
        score += Math.max(0, 4.2 - centerDist) * 1.1;
      }
    }
    for (const e of enemyPieces) {
      score -= dynVal(e.p, false) * 1.25;
      if (advanced) {
        const centerDist = Math.abs(e.r - 1.5) + Math.abs(e.c - 3.5);
        score -= Math.max(0, 4.2 - centerDist) * 0.9;
      }
    }

    // Mobility, Forking, Cannon Alignment & Endgame Corner Trapping
    let enemyTotalMoves = 0;
    for (const m of myPieces) {
      const allM = this.getValidMovesForPiece(m.r, m.c, board, false);
      const caps = allM.filter(x => x.type === 'capture');
      if (advanced) {
        score += allM.length * 1.2;
        if (caps.length >= 2) score += 18; // Double threat (fork)!
      }
      for (const mv of caps) {
        const target = board[mv.tr][mv.tc];
        if (target) score += dynVal(target, false) * (godMode ? 0.30 : 0.22);
      }

      // Predator-prey chasing & corner trapping
      for (const e of enemyPieces) {
        const dist = Math.abs(m.r - e.r) + Math.abs(m.c - e.c);
        if (canCaptureRank(m.p.rank, e.p.rank)) {
          const chaseWeight = hiddenCount === 0 ? (godMode ? 4.8 : 3.5) : (advanced ? 2.2 : 1.4);
          score += Math.max(0, 10 - dist) * chaseWeight;
          if (advanced && (e.r === 0 || e.r === ROWS - 1 || e.c === 0 || e.c === COLS - 1)) {
            score += (hiddenCount === 0 ? 6.0 : 2.5);
          }
        } else if (advanced && canCaptureRank(e.p.rank, m.p.rank) && dist <= 2) {
          score -= dynVal(m.p, true) * (dist === 1 ? 0.42 : 0.12);
        }
      }
    }

    // Enemy attacks & Cannon sniper threats on our high-value pieces
    for (const e of enemyPieces) {
      const eAll = this.getValidMovesForPiece(e.r, e.c, board, false);
      enemyTotalMoves += eAll.length;
      for (const mv of eAll) {
        if (mv.type === 'capture') {
          const target = board[mv.tr][mv.tc];
          if (target && target.color === aiColor) {
            score -= dynVal(target, true) * (godMode ? 0.68 : (advanced ? 0.56 : 0.42));
          }
        }
      }
    }

    // Endgame Zugzwang: heavily reward restricting opponent's legal moves when winning!
    if (advanced && hiddenCount <= 4 && score > 0) {
      score += Math.max(0, 14 - enemyTotalMoves) * (godMode ? 3.5 : 2.0);
    }

    return score;
  }

  _simulateMove(board, action) {
    const next = this.cloneBoard(board);
    if (action.type === 'move' || action.type === 'capture') {
      next[action.tr][action.tc] = next[action.fr][action.fc];
      next[action.fr][action.fc] = null;
    }
    return next;
  }

  _aiMedium(color, actions) {
    const baseScore = this._evaluateBoard(this.board, color, false);
    let bestScore = -Infinity;
    let bestActions = [];

    for (const act of actions) {
      let val;
      if (act.type === 'flip') {
        val = baseScore + 6 + (Math.random() * 4 - 2);
        const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
        for (const [dr, dc] of dirs) {
          const nr = act.r + dr, nc = act.c + dc;
          if (this.inBounds(nr, nc)) {
            const adj = this.board[nr][nc];
            if (adj && adj.revealed && adj.color !== color) {
              val -= adj.meta.value * 0.12;
            }
          }
        }
      } else {
        const nextB = this._simulateMove(this.board, act);
        val = this._evaluateBoard(nextB, color, false) + (Math.random() * 2 - 1);
      }

      if (val > bestScore) {
        bestScore = val;
        bestActions = [act];
      } else if (Math.abs(val - bestScore) < 1.5) {
        bestActions.push(act);
      }
    }
    return bestActions[Math.floor(Math.random() * bestActions.length)];
  }

  _scoreFlipExpectimax(board, r, c, color, advanced, godMode = false) {
    const enemy = color === 'red' ? 'black' : 'red';
    const pool = this._getUnrevealedPool(board);
    if (pool.length === 0) return -999;

    const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    const adjEnemy = [];
    const adjFriendly = [];
    for (const [dr, dc] of dirs) {
      const nr = r + dr, nc = c + dc;
      if (!this.inBounds(nr, nc)) continue;
      const p = board[nr][nc];
      if (p && p.revealed) {
        if (p.color === color) adjFriendly.push(p);
        else adjEnemy.push(p);
      }
    }

    // Check if this tile sits in an enemy Cannon's immediate jump-shot crosshair!
    const inEnemyCannonLine = this._isAttackedByEnemyCannon(board, r, c, enemy);
    const inMyCannonLine = this._isAttackedByEnemyCannon(board, r, c, color);

    let expectedDelta = 0;
    for (const cand of pool) {
      if (cand.color === color) {
        let eatenRisk = inEnemyCannonLine;
        for (const e of adjEnemy) {
          if (canCaptureRank(e.rank, cand.rank)) eatenRisk = true;
        }
        // Symmetric zero-sum expectation: revealing our piece safely is +0.12*v, getting it killed is -0.95*v
        expectedDelta += eatenRisk ? -cand.meta.value * 0.95 : cand.meta.value * 0.12;
      } else {
        // Enemy revealed: symmetric baseline -0.12*v, plus major penalty if it kills our adjacent piece!
        let threatCost = 0;
        for (const f of adjFriendly) {
          if (canCaptureRank(cand.rank, f.rank)) {
            threatCost = Math.max(threatCost, f.meta.value * 0.95);
          }
        }
        let trapBonus = 0;
        if (inMyCannonLine) {
          trapBonus += cand.meta.value * 0.45;
        }
        for (const f of adjFriendly) {
          if (canCaptureRank(f.rank, cand.rank) && !canCaptureRank(cand.rank, f.rank)) {
            trapBonus = Math.max(trapBonus, cand.meta.value * 0.28);
          }
        }
        expectedDelta += (-cand.meta.value * 0.12) - threatCost + trapBonus;
      }
    }

    // Check if any friendly piece is currently under direct enemy attack (if so, penalize blind flipping!)
    let underThreat = false;
    for (let rr = 0; rr < ROWS && !underThreat; rr++) {
      for (let cc = 0; cc < COLS && !underThreat; cc++) {
        const ep = board[rr][cc];
        if (ep && ep.revealed && ep.color === enemy) {
          const caps = this.getValidMovesForPiece(rr, cc, board, true);
          if (caps.length > 0) underThreat = true;
        }
      }
    }

    const avgDelta = expectedDelta / pool.length;
    const exploreBias = underThreat
      ? -10
      : (godMode ? (pool.length > 10 ? 4.5 : 1.5) : (advanced ? (pool.length > 12 ? 5.5 : 2.5) : 6.5));
    const jitter = godMode ? 0.08 : (advanced ? 0.3 : 1.2);
    return exploreBias + avgDelta + Math.random() * jitter;
  }

  _aiSearchPro(color, actions, cfg) {
    const { maxDepth, qDepth, budgetMs, advanced, deepFlip, godMode = false } = cfg;
    const enemy = color === 'red' ? 'black' : 'red';
    const startTime = performance.now();
    let timedOut = false;
    let nodeCount = 0;

    // Transposition Table: hash -> { depth, score, flag }
    // flag: 0 = EXACT, 1 = LOWERBOUND, 2 = UPPERBOUND
    const tt = new Map();

    // Recent position hashes from history to prevent pointless endgame shuffle loops
    const recentHashes = new Set();
    const recentSlice = this.history.slice(-10);
    for (const snap of recentSlice) {
      if (snap && snap.board) {
        recentHashes.add(this._boardHashKey(snap.board, snap.turnColor));
      }
    }

    // Work on one cloned board using ultra-fast in-place make/unmake (zero GC pressure!)
    const workBoard = this.cloneBoard(this.board);

    const checkTime = () => {
      nodeCount++;
      if ((nodeCount & 127) === 0 && performance.now() - startTime > budgetMs) {
        timedOut = true;
      }
      return timedOut;
    };

    const getMovesOrdered = (board, turn, capturesOnly) => {
      const moves = [];
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          const p = board[r][c];
          if (p && p.revealed && p.color === turn) {
            moves.push(...this.getValidMovesForPiece(r, c, board, capturesOnly));
          }
        }
      }
      if (moves.length > 1) {
        // MVV-LVA (Most Valuable Victim - Least Valuable Attacker) move ordering!
        moves.sort((a, b) => {
          const va = a.type === 'capture'
            ? 500 + (board[a.tr][a.tc]?.meta.value || 10) * 4 - (board[a.fr][a.fc]?.meta.value || 0) * 0.3
            : 0;
          const vb = b.type === 'capture'
            ? 500 + (board[b.tr][b.tc]?.meta.value || 10) * 4 - (board[b.fr][b.fc]?.meta.value || 0) * 0.3
            : 0;
          return vb - va;
        });
      }
      return moves;
    };

    const quiescence = (board, alpha, beta, maximizing, qLeft) => {
      const standPat = this._evaluateBoard(board, color, advanced, godMode);
      if (qLeft <= 0 || checkTime()) return standPat;

      if (maximizing) {
        if (standPat >= beta) return beta;
        if (standPat > alpha) alpha = standPat;
      } else {
        if (standPat <= alpha) return alpha;
        if (standPat < beta) beta = standPat;
      }

      const turn = maximizing ? color : enemy;
      const caps = getMovesOrdered(board, turn, true);
      if (caps.length === 0) return standPat;

      if (maximizing) {
        let best = standPat;
        for (const mv of caps) {
          const mover = board[mv.fr][mv.fc];
          const captured = board[mv.tr][mv.tc];
          board[mv.tr][mv.tc] = mover;
          board[mv.fr][mv.fc] = null;

          const v = quiescence(board, alpha, beta, false, qLeft - 1);

          board[mv.fr][mv.fc] = mover;
          board[mv.tr][mv.tc] = captured;

          if (timedOut) return best;
          if (v > best) best = v;
          if (best > alpha) alpha = best;
          if (beta <= alpha) break;
        }
        return best;
      } else {
        let best = standPat;
        for (const mv of caps) {
          const mover = board[mv.fr][mv.fc];
          const captured = board[mv.tr][mv.tc];
          board[mv.tr][mv.tc] = mover;
          board[mv.fr][mv.fc] = null;

          const v = quiescence(board, alpha, beta, true, qLeft - 1);

          board[mv.fr][mv.fc] = mover;
          board[mv.tr][mv.tc] = captured;

          if (timedOut) return best;
          if (v < best) best = v;
          if (best < beta) beta = best;
          if (beta <= alpha) break;
        }
        return best;
      }
    };

    const alphaBeta = (board, depth, alpha, beta, maximizing) => {
      if (checkTime()) return this._evaluateBoard(board, color, advanced, godMode);

      const turn = maximizing ? color : enemy;
      const hash = this._boardHashKey(board, turn);
      const origAlpha = alpha;
      const origBeta = beta;

      const cached = tt.get(hash);
      if (cached && cached.depth >= depth) {
        if (cached.flag === 0) return cached.score;
        if (cached.flag === 1 && cached.score > alpha) alpha = cached.score;
        else if (cached.flag === 2 && cached.score < beta) beta = cached.score;
        if (alpha >= beta) return cached.score;
      }

      if (depth <= 0) {
        return advanced ? quiescence(board, alpha, beta, maximizing, qDepth) : this._evaluateBoard(board, color, false, false);
      }

      const moves = getMovesOrdered(board, turn, false);
      if (moves.length === 0) {
        return this._evaluateBoard(board, color, advanced, godMode);
      }

      let bestVal;
      if (maximizing) {
        bestVal = -Infinity;
        for (const mv of moves) {
          const mover = board[mv.fr][mv.fc];
          const captured = board[mv.tr][mv.tc];
          board[mv.tr][mv.tc] = mover;
          board[mv.fr][mv.fc] = null;

          const v = alphaBeta(board, depth - 1, alpha, beta, false);

          board[mv.fr][mv.fc] = mover;
          board[mv.tr][mv.tc] = captured;

          if (timedOut) return bestVal === -Infinity ? this._evaluateBoard(board, color, advanced, godMode) : bestVal;
          if (v > bestVal) bestVal = v;
          if (bestVal > alpha) alpha = bestVal;
          if (beta <= alpha) break;
        }
      } else {
        bestVal = Infinity;
        for (const mv of moves) {
          const mover = board[mv.fr][mv.fc];
          const captured = board[mv.tr][mv.tc];
          board[mv.tr][mv.tc] = mover;
          board[mv.fr][mv.fc] = null;

          const v = alphaBeta(board, depth - 1, alpha, beta, true);

          board[mv.fr][mv.fc] = mover;
          board[mv.tr][mv.tc] = captured;

          if (timedOut) return bestVal === Infinity ? this._evaluateBoard(board, color, advanced, godMode) : bestVal;
          if (v < bestVal) bestVal = v;
          if (bestVal < beta) beta = bestVal;
          if (beta <= alpha) break;
        }
      }

      if (tt.size < 45000) {
        let flag = 0;
        if (bestVal <= origAlpha) flag = 2;
        else if (bestVal >= origBeta) flag = 1;
        tt.set(hash, { depth, score: bestVal, flag });
      }
      return bestVal;
    };

    // Order root actions: captures > moves > best flips
    const ordered = [...actions].sort((a, b) => {
      const va = a.type === 'capture'
        ? 400 + (workBoard[a.tr][a.tc]?.meta.value || 0) * 3 - (workBoard[a.fr][a.fc]?.meta.value || 0) * 0.2
        : a.type === 'move' ? 80 : 10;
      const vb = b.type === 'capture'
        ? 400 + (workBoard[b.tr][b.tc]?.meta.value || 0) * 3 - (workBoard[b.fr][b.fc]?.meta.value || 0) * 0.2
        : b.type === 'move' ? 80 : 10;
      return vb - va;
    });

    // Pre-compute flip tactical deltas once (huge speedup)
    const flipDeltas = new Map();
    for (const act of ordered) {
      if (act.type === 'flip') {
        flipDeltas.set(`${act.r},${act.c}`, this._scoreFlipExpectimax(workBoard, act.r, act.c, color, advanced, godMode));
      }
    }

    let bestAction = ordered[0];

    // Iterative Deepening from depth 1 up to maxDepth!
    for (let d = 1; d <= maxDepth; d++) {
      let iterBestScore = -Infinity;
      let iterBestAction = ordered[0];
      timedOut = false;

      // CRITICAL FIX: Evaluate opponent's best immediate 1-ply punishment if AI wastes its turn flipping
      // (without giving AI a free follow-up capture in quiescence!).
      let flipBaseline = this._evaluateBoard(workBoard, color, advanced, godMode);
      if (deepFlip) {
        const oppMoves = getMovesOrdered(workBoard, enemy, false);
        if (oppMoves.length > 0) {
          let worst = Infinity;
          for (const omv of oppMoves) {
            const om = workBoard[omv.fr][omv.fc];
            const oc = workBoard[omv.tr][omv.tc];
            workBoard[omv.tr][omv.tc] = om;
            workBoard[omv.fr][omv.fc] = null;
            const sc = this._evaluateBoard(workBoard, color, advanced, godMode);
            workBoard[omv.fr][omv.fc] = om;
            workBoard[omv.tr][omv.tc] = oc;
            if (sc < worst) worst = sc;
          }
          flipBaseline = worst;
        }
      }
      if (timedOut) break;

      for (const act of ordered) {
        let score;
        if (act.type === 'flip') {
          score = flipBaseline + (flipDeltas.get(`${act.r},${act.c}`) || 0);
        } else {
          const mover = workBoard[act.fr][act.fc];
          const captured = workBoard[act.tr][act.tc];
          workBoard[act.tr][act.tc] = mover;
          workBoard[act.fr][act.fc] = null;

          score = alphaBeta(workBoard, d - 1, -Infinity, Infinity, false);

          // Anti-repetition logic: avoid shuffling in circles when winning, allow draw defense when losing!
          if (!captured) {
            const nextHash = this._boardHashKey(workBoard, enemy);
            if (recentHashes.has(nextHash)) {
              score += score > 20 ? -38 : (score < -40 ? 18 : -12);
            }
          }

          workBoard[act.fr][act.fc] = mover;
          workBoard[act.tr][act.tc] = captured;
        }

        if (timedOut) break;
        if (score > iterBestScore) {
          iterBestScore = score;
          iterBestAction = act;
        }
      }

      if (!timedOut) {
        bestAction = iterBestAction;
        // Put best action first for next deeper iteration -> massive Alpha-Beta speedup!
        const idx = ordered.indexOf(bestAction);
        if (idx > 0) {
          ordered.splice(idx, 1);
          ordered.unshift(bestAction);
        }
      } else {
        break;
      }
    }

    return bestAction;
  }
}
