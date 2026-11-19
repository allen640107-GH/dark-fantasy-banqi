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

  // ===================== 3-Tier AI =====================
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

    if (this.difficulty === 'easy') {
      return this._aiEasy(actions);
    } else if (this.difficulty === 'medium') {
      return this._aiMedium(color, actions);
    } else {
      return this._aiHard(color, actions);
    }
  }

  _aiEasy(actions) {
    const captures = actions.filter(a => a.type === 'capture');
    if (captures.length > 0 && Math.random() < 0.72) {
      return captures[Math.floor(Math.random() * captures.length)];
    }
    const flips = actions.filter(a => a.type === 'flip');
    if (flips.length > 0 && Math.random() < 0.55) {
      return flips[Math.floor(Math.random() * flips.length)];
    }
    return actions[Math.floor(Math.random() * actions.length)];
  }

  _evaluateBoard(board, aiColor) {
    const enemy = aiColor === 'red' ? 'black' : 'red';
    let score = 0;
    const myPieces = [];
    const enemyPieces = [];

    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const p = board[r][c];
        if (!p || !p.revealed) continue;
        if (p.color === aiColor) {
          score += p.meta.value * 1.1;
          myPieces.push({ r, c, p });
        } else {
          score -= p.meta.value * 1.1;
          enemyPieces.push({ r, c, p });
        }
      }
    }

    // Threat & Mobility bonuses + Endgame chase pressure
    for (const m of myPieces) {
      const moves = this.getValidMovesForPiece(m.r, m.c, board, true);
      for (const mv of moves) {
        const target = board[mv.tr][mv.tc];
        if (target) score += target.meta.value * 0.16;
      }
      // Chase weaker enemy pieces so AI doesn't wander aimlessly
      for (const e of enemyPieces) {
        if (canCaptureRank(m.p.rank, e.p.rank)) {
          const dist = Math.abs(m.r - e.r) + Math.abs(m.c - e.c);
          score += Math.max(0, 10 - dist) * 1.4;
        }
      }
    }

    // Penalize being threatened by enemy
    for (const e of enemyPieces) {
      const eMoves = this.getValidMovesForPiece(e.r, e.c, board, true);
      for (const mv of eMoves) {
        const target = board[mv.tr][mv.tc];
        if (target && target.color === aiColor) {
          score -= target.meta.value * 0.42;
        }
      }
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
    const baseScore = this._evaluateBoard(this.board, color);
    let bestScore = -Infinity;
    let bestActions = [];

    for (const act of actions) {
      let val;
      if (act.type === 'flip') {
        // Prefer flipping away from strong enemy pieces
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
        val = this._evaluateBoard(nextB, color) + (Math.random() * 2 - 1);
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

  _aiHard(color, actions) {
    const enemy = color === 'red' ? 'black' : 'red';

    const alphaBeta = (board, depth, alpha, beta, maximizing) => {
      if (depth === 0) return this._evaluateBoard(board, color);
      const turn = maximizing ? color : enemy;
      const moves = [];
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          const p = board[r][c];
          if (p && p.revealed && p.color === turn) {
            moves.push(...this.getValidMovesForPiece(r, c, board, false));
          }
        }
      }
      if (moves.length === 0) return this._evaluateBoard(board, color);

      // Order captures first for sharper pruning
      moves.sort((a, b) => (b.type === 'capture' ? 1 : 0) - (a.type === 'capture' ? 1 : 0));

      if (maximizing) {
        let best = -Infinity;
        for (const mv of moves) {
          const v = alphaBeta(this._simulateMove(board, mv), depth - 1, alpha, beta, false);
          if (v > best) best = v;
          if (best > alpha) alpha = best;
          if (beta <= alpha) break;
        }
        return best;
      } else {
        let best = Infinity;
        for (const mv of moves) {
          const v = alphaBeta(this._simulateMove(board, mv), depth - 1, alpha, beta, true);
          if (v < best) best = v;
          if (best < beta) beta = best;
          if (beta <= alpha) break;
        }
        return best;
      }
    };

    const currentVal = this._evaluateBoard(this.board, color);
    let bestScore = -Infinity;
    let bestAction = actions[0];

    // Order captures first at root
    const ordered = [...actions].sort((a, b) => (b.type === 'capture' ? 2 : b.type === 'move' ? 1 : 0) - (a.type === 'capture' ? 2 : a.type === 'move' ? 1 : 0));

    for (const act of ordered) {
      let score;
      if (act.type === 'flip') {
        // Flip heuristic: valuable early or when no profitable capture exists, avoid flipping next to enemy General/Advisor
        score = currentVal + 10 + Math.random() * 1.5;
        const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
        for (const [dr, dc] of dirs) {
          const nr = act.r + dr, nc = act.c + dc;
          if (this.inBounds(nr, nc)) {
            const adj = this.board[nr][nc];
            if (adj && adj.revealed) {
              if (adj.color !== color) score -= adj.meta.value * 0.16;
              else score += 3.5; // Flipping near friendly protection
            }
          }
        }
      } else {
        const nextB = this._simulateMove(this.board, act);
        score = alphaBeta(nextB, 2, -Infinity, Infinity, false);
      }

      if (score > bestScore) {
        bestScore = score;
        bestAction = act;
      }
    }
    return bestAction;
  }
}
