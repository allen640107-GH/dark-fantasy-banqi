// Championship-Grade Taiwanese Banqi (Dark Chess) Engine
// Features: Flat Int8Array(32) board, 64-bit Zobrist Hashing, 131K-entry Typed-Array Transposition Table,
// Iterative Deepening PVS (Alpha-Beta), Quiescence Search, MVV-LVA + Killer + History Ordering,
// True Probability-Weighted Expectimax Flip Search, Cannon Battery & Endgame Cornering Heuristics.

const ROWS = 4;
const COLS = 8;
const N = 32;

// Cell encoding:
//  0       = empty
//  1       = hidden (face-down)
//  2 .. 8  = Red revealed   (rank = val - 2: 0=兵,1=炮,2=傌,3=俥,4=相,5=仕,6=帥)
// -2 .. -8 = Black revealed (rank = -val - 2: 0=卒,1=包,2=馬,3=車,4=象,5=士,6=將)

const BASE_VAL = new Int32Array([22, 62, 28, 42, 64, 92, 135]);
const WIN_SCORE = 50000;

// Precomputed rank capture matrix (non-cannon adjacent captures)
const CAN_BEAT = new Uint8Array(49);
for (let a = 0; a < 7; a++) {
  for (let b = 0; b < 7; b++) {
    let ok = 0;
    if (a !== 1) {
      if (a === 0 && b === 6) ok = 1;
      else if (a === 6 && b === 0) ok = 0;
      else if (a >= b) ok = 1;
    }
    CAN_BEAT[a * 7 + b] = ok;
  }
}

// Precomputed orthogonal neighbors and directional rays
const ADJ = Array.from({ length: N }, () => []);
const RAYS = Array.from({ length: N }, () => [[], [], [], []]);
const DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];

for (let r = 0; r < ROWS; r++) {
  for (let c = 0; c < COLS; c++) {
    const idx = r * COLS + c;
    for (let d = 0; d < 4; d++) {
      const [dr, dc] = DIRS[d];
      let nr = r + dr, nc = c + dc;
      if (nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS) {
        ADJ[idx].push(nr * COLS + nc);
      }
      while (nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS) {
        RAYS[idx][d].push(nr * COLS + nc);
        nr += dr;
        nc += dc;
      }
    }
  }
}

// Center control bonus table (4x8)
const CENTER_BONUS = new Int16Array(N);
const EDGE_PENALTY = new Int16Array(N);
for (let r = 0; r < ROWS; r++) {
  for (let c = 0; c < COLS; c++) {
    const idx = r * COLS + c;
    const dist = Math.abs(r - 1.5) + Math.abs(c - 3.5);
    CENTER_BONUS[idx] = Math.round(Math.max(0, 4.5 - dist) * 2.5);
    const isCorner = (r === 0 || r === 3) && (c === 0 || c === 7);
    const isEdge = r === 0 || r === 3 || c === 0 || c === 7;
    EDGE_PENALTY[idx] = isCorner ? 14 : (isEdge ? 6 : 0);
  }
}

// Deterministic xorshift32 for Zobrist keys (17 possible cell states: -8..+8 -> index val + 8)
let seed = 0x9e3779b9;
function nextRand32() {
  seed ^= seed << 13;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  return seed >>> 0;
}

const ZOBRIST_HI = new Uint32Array(N * 17);
const ZOBRIST_LO = new Uint32Array(N * 17);
for (let i = 0; i < N * 17; i++) {
  ZOBRIST_HI[i] = nextRand32();
  ZOBRIST_LO[i] = nextRand32();
}
const ZOBRIST_TURN_HI = nextRand32();
const ZOBRIST_TURN_LO = nextRand32();

// Flat Typed-Array Transposition Table (131,072 entries, zero GC)
const TT_BITS = 17;
const TT_SIZE = 1 << TT_BITS;
const TT_MASK = TT_SIZE - 1;
const ttKeyHi = new Uint32Array(TT_SIZE);
const ttKeyLo = new Uint32Array(TT_SIZE);
const ttDepth = new Int8Array(TT_SIZE);
const ttFlag = new Uint8Array(TT_SIZE); // 0=empty, 1=EXACT, 2=LOWER, 3=UPPER
const ttScore = new Int32Array(TT_SIZE);
const ttMove = new Uint16Array(TT_SIZE);

// Pre-allocated move buffers per ply (max 40 plies, max 128 moves per ply)
const MAX_PLY = 40;
const MOVE_BUF = new Int32Array(MAX_PLY * 128);
const SCORE_BUF = new Int32Array(MAX_PLY * 128);
const KILLER1 = new Int32Array(MAX_PLY);
const KILLER2 = new Int32Array(MAX_PLY);
const HISTORY = new Int32Array(N * N);

// Move bit-packing: from (0..31) | (to << 5) | (isCap << 10) | (isCannon << 11)
function packMove(fr, to, isCap, isCannon) {
  return fr | (to << 5) | (isCap ? 1024 : 0) | (isCannon ? 2048 : 0);
}

export function encodeBoard(boardObj) {
  const b = new Int8Array(N);
  const unrevRed = new Int8Array(7);
  const unrevBlack = new Int8Array(7);
  let hiddenCount = 0;

  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const p = boardObj[r][c];
      const idx = r * COLS + c;
      if (!p) {
        b[idx] = 0;
      } else if (!p.revealed) {
        b[idx] = 1;
        hiddenCount++;
        if (p.color === 'red') unrevRed[p.rank]++;
        else unrevBlack[p.rank]++;
      } else {
        b[idx] = p.color === 'red' ? (p.rank + 2) : -(p.rank + 2);
      }
    }
  }
  return { b, unrevRed, unrevBlack, hiddenCount };
}

function computeHash(b, side) {
  let hi = side === 1 ? ZOBRIST_TURN_HI : 0;
  let lo = side === 1 ? ZOBRIST_TURN_LO : 0;
  for (let i = 0; i < N; i++) {
    const v = b[i];
    if (v !== 0) {
      const off = i * 17 + (v + 8);
      hi = (hi ^ ZOBRIST_HI[off]) >>> 0;
      lo = (lo ^ ZOBRIST_LO[off]) >>> 0;
    }
  }
  return [hi, lo];
}

// Generate all legal moves for `side` (1 = red, -1 = black) into MOVE_BUF[ply*128..]
function genMoves(b, side, ply, capturesOnly) {
  const base = ply * 128;
  let count = 0;

  for (let i = 0; i < N; i++) {
    const v = b[i];
    if (v === 0 || v === 1) continue;
    if ((side === 1 && v < 0) || (side === -1 && v > 0)) continue;

    const rank = (v > 0 ? v : -v) - 2;
    const adj = ADJ[i];

    for (let k = 0; k < adj.length; k++) {
      const t = adj[k];
      const tv = b[t];
      if (tv === 0) {
        if (!capturesOnly) {
          MOVE_BUF[base + count++] = packMove(i, t, 0, 0);
        }
      } else if (tv !== 1 && ((side === 1 && tv < 0) || (side === -1 && tv > 0))) {
        if (rank !== 1) {
          const trank = (tv > 0 ? tv : -tv) - 2;
          if (CAN_BEAT[rank * 7 + trank]) {
            MOVE_BUF[base + count++] = packMove(i, t, 1, 0);
          }
        }
      }
    }

    // Cannon jump-capture along 4 rays
    if (rank === 1) {
      const rays = RAYS[i];
      for (let d = 0; d < 4; d++) {
        const ray = rays[d];
        let jumped = false;
        for (let k = 0; k < ray.length; k++) {
          const t = ray[k];
          const tv = b[t];
          if (tv !== 0) {
            if (!jumped) {
              jumped = true;
            } else {
              if (tv !== 1 && ((side === 1 && tv < 0) || (side === -1 && tv > 0))) {
                MOVE_BUF[base + count++] = packMove(i, t, 1, 1);
              }
              break;
            }
          }
        }
      }
    }
  }
  return count;
}

// Check if `sq` is attacked by `attackerSide` (fast tactical check for defense/hanging evaluation)
function isAttackedBy(b, sq, attackerSide) {
  const targetV = b[sq];
  if (targetV === 0 || targetV === 1) return false;
  const targetRank = (targetV > 0 ? targetV : -targetV) - 2;

  // Adjacent attackers
  const adj = ADJ[sq];
  for (let k = 0; k < adj.length; k++) {
    const av = b[adj[k]];
    if (av !== 0 && av !== 1 && ((attackerSide === 1 && av > 0) || (attackerSide === -1 && av < 0))) {
      const arank = (av > 0 ? av : -av) - 2;
      if (CAN_BEAT[arank * 7 + targetRank]) return true;
    }
  }

  // Cannon attackers along 4 rays
  const rays = RAYS[sq];
  for (let d = 0; d < 4; d++) {
    const ray = rays[d];
    let jumped = false;
    for (let k = 0; k < ray.length; k++) {
      const av = b[ray[k]];
      if (av !== 0) {
        if (!jumped) {
          jumped = true;
        } else {
          if (av !== 1 && ((attackerSide === 1 && av > 0) || (attackerSide === -1 && av < 0))) {
            const arank = (av > 0 ? av : -av) - 2;
            if (arank === 1) return true;
          }
          break;
        }
      }
    }
  }
  return false;
}

// Grandmaster Static Evaluation (returns score from `sideToMove` perspective for Negamax!)
function evaluate(b, sideToMove, unrevRed, unrevBlack, hiddenCount) {
  let redCount = 0, blackCount = 0;
  let redGen = unrevRed[6], blackGen = unrevBlack[6];
  let redSol = unrevRed[0], blackSol = unrevBlack[0];
  let redCan = unrevRed[1], blackCan = unrevBlack[1];
  let redMaxRank = -1, blackMaxRank = -1;

  // Store revealed piece indices & ranks in tiny local arrays
  let rLen = 0, bLen = 0;
  const rIdx = evalRIdx, rRank = evalRRank;
  const bIdx = evalBIdx, bRank = evalBRank;

  for (let i = 0; i < N; i++) {
    const v = b[i];
    if (v === 0 || v === 1) continue;
    if (v > 0) {
      const rk = v - 2;
      rIdx[rLen] = i;
      rRank[rLen++] = rk;
      redCount++;
      if (rk === 6) redGen++;
      else if (rk === 0) redSol++;
      else if (rk === 1) redCan++;
      if (rk > redMaxRank && rk !== 1) redMaxRank = rk;
    } else {
      const rk = -v - 2;
      bIdx[bLen] = i;
      bRank[bLen++] = rk;
      blackCount++;
      if (rk === 6) blackGen++;
      else if (rk === 0) blackSol++;
      else if (rk === 1) blackCan++;
      if (rk > blackMaxRank && rk !== 1) blackMaxRank = rk;
    }
  }

  if (hiddenCount === 0) {
    if (blackCount === 0) return sideToMove === 1 ? WIN_SCORE : -WIN_SCORE;
    if (redCount === 0) return sideToMove === -1 ? WIN_SCORE : -WIN_SCORE;
  }

  const totalBoardPieces = rLen + bLen + hiddenCount;

  // Dynamic Banqi piece valuation
  const getVal = (rk, isRed) => {
    const oppGen = isRed ? blackGen : redGen;
    const oppSol = isRed ? blackSol : redSol;
    const oppCan = isRed ? blackCan : redCan;
    if (rk === 0) return oppGen > 0 ? 48 : 18;
    if (rk === 1) return totalBoardPieces >= 12 ? 78 : (totalBoardPieces >= 6 ? 60 : 38);
    if (rk === 6) {
      if (oppSol === 0 && oppCan === 0) return 260; // Unkillable sovereign!
      if (oppSol === 0) return 175;
      return 135;
    }
    if (rk === 5) return oppGen === 0 ? 125 : 92;
    if (rk === 4) return (oppGen === 0 && (isRed ? blackMaxRank : redMaxRank) <= 4) ? 88 : 64;
    return BASE_VAL[rk];
  };

  let redScore = 0;
  let blackScore = 0;

  // Supremacy bonus for owning the highest non-cannon piece on the board
  if (hiddenCount <= 6) {
    if (redMaxRank > blackMaxRank) redScore += 42;
    else if (blackMaxRank > redMaxRank) blackScore += 42;
  }

  // Material + Center + Threat/Defense + Cannon Battery Setup
  for (let m = 0; m < rLen; m++) {
    const i = rIdx[m], rk = rRank[m];
    const val = getVal(rk, true);
    redScore += val * 3 + CENTER_BONUS[i];

    // Cannon Battery & Alignment Heuristic (架炮戰術)
    if (rk === 1) {
      const rays = RAYS[i];
      for (let d = 0; d < 4; d++) {
        const ray = rays[d];
        let blockers = 0;
        for (let k = 0; k < ray.length; k++) {
          const tv = b[ray[k]];
          if (tv !== 0) {
            if (blockers === 0) {
              blockers = 1;
            } else if (blockers === 1) {
              if (tv < 0) {
                const trk = -tv - 2;
                redScore += Math.round(getVal(trk, false) * 0.48); // Direct cannon lock-on!
              }
              break;
            }
          }
        }
      }
    }

    // Mobility & Hanging check
    const adj = ADJ[i];
    let mob = 0;
    for (let k = 0; k < adj.length; k++) {
      if (b[adj[k]] === 0) mob++;
    }
    redScore += mob * 2;
    if (isAttackedBy(b, i, -1)) {
      // Penalize threatened pieces gently (Quiescence handles tactical captures, this guides quiet moves!)
      redScore -= Math.round(val * 0.45);
    }
  }

  for (let m = 0; m < bLen; m++) {
    const i = bIdx[m], rk = bRank[m];
    const val = getVal(rk, false);
    blackScore += val * 3 + CENTER_BONUS[i];

    if (rk === 1) {
      const rays = RAYS[i];
      for (let d = 0; d < 4; d++) {
        const ray = rays[d];
        let blockers = 0;
        for (let k = 0; k < ray.length; k++) {
          const tv = b[ray[k]];
          if (tv !== 0) {
            if (blockers === 0) {
              blockers = 1;
            } else if (blockers === 1) {
              if (tv > 1) {
                const trk = tv - 2;
                blackScore += Math.round(getVal(trk, true) * 0.48);
              }
              break;
            }
          }
        }
      }
    }

    const adj = ADJ[i];
    let mob = 0;
    for (let k = 0; k < adj.length; k++) {
      if (b[adj[k]] === 0) mob++;
    }
    blackScore += mob * 2;
    if (isAttackedBy(b, i, 1)) {
      blackScore -= Math.round(val * 0.45);
    }
  }

  // Predator-Prey Chasing, Cornering & Pincer Coordination!
  const endgameFactor = hiddenCount === 0 ? 3 : (hiddenCount <= 6 ? 2 : 1);
  for (let m = 0; m < rLen; m++) {
    const ri = rIdx[m], rrk = rRank[m];
    const rr = ri >> 3, rc = ri & 7;
    for (let n = 0; n < bLen; n++) {
      const bi = bIdx[n], brk = bRank[n];
      const dist = Math.abs(rr - (bi >> 3)) + Math.abs(rc - (bi & 7));
      if (CAN_BEAT[rrk * 7 + brk]) {
        redScore += (10 - dist) * 3 * endgameFactor;
        if (dist <= 3) redScore += EDGE_PENALTY[bi] * endgameFactor;
      }
      if (CAN_BEAT[brk * 7 + rrk]) {
        blackScore += (10 - dist) * 3 * endgameFactor;
        if (dist <= 3) blackScore += EDGE_PENALTY[ri] * endgameFactor;
      }
    }
  }

  const net = redScore - blackScore;
  return sideToMove === 1 ? net : -net;
}

const evalRIdx = new Int8Array(16);
const evalRRank = new Int8Array(16);
const evalBIdx = new Int8Array(16);
const evalBRank = new Int8Array(16);

export function findBestActionPro(gameState, config) {
  const { maxDepth, qDepth, budgetMs, expectimaxFlips = 6, flipSearchDepth = 2 } = config;
  const aiSide = gameState.aiColor === 'red' ? 1 : -1;
  const encoded = encodeBoard(gameState.board);
  const { b, unrevRed, unrevBlack } = encoded;
  let hiddenCount = encoded.hiddenCount;
  const startTime = performance.now();
  let timedOut = false;
  let nodes = 0;

  // Clear per-search killer & decay history
  KILLER1.fill(0);
  KILLER2.fill(0);
  for (let i = 0; i < HISTORY.length; i++) HISTORY[i] >>= 2;

  // Collect recent position hashes for anti-repetition & draw-defense
  const recentHashSet = new Set();
  if (gameState.recentBoards) {
    for (const rb of gameState.recentBoards) {
      const enc = encodeBoard(rb.board);
      const [hHi, hLo] = computeHash(enc.b, rb.turnColor === 'red' ? 1 : -1);
      recentHashSet.add(`${hHi}_${hLo}`);
    }
  }

  let [curHi, curLo] = computeHash(b, aiSide);

  const checkTime = () => {
    nodes++;
    if ((nodes & 255) === 0 && performance.now() - startTime > budgetMs) {
      timedOut = true;
    }
    return timedOut;
  };

  function scoreMoves(base, count, ply, ttBest) {
    const k1 = KILLER1[ply], k2 = KILLER2[ply];
    for (let i = 0; i < count; i++) {
      const mv = MOVE_BUF[base + i];
      if (mv === ttBest) {
        SCORE_BUF[base + i] = 1000000;
      } else if (mv & 1024) {
        const fr = mv & 31, to = (mv >> 5) & 31;
        const vrk = (b[to] > 0 ? b[to] : -b[to]) - 2;
        const ark = (b[fr] > 0 ? b[fr] : -b[fr]) - 2;
        SCORE_BUF[base + i] = 100000 + BASE_VAL[vrk] * 16 - BASE_VAL[ark];
      } else if (mv === k1) {
        SCORE_BUF[base + i] = 50000;
      } else if (mv === k2) {
        SCORE_BUF[base + i] = 45000;
      } else {
        const fr = mv & 31, to = (mv >> 5) & 31;
        SCORE_BUF[base + i] = HISTORY[(fr << 5) | to];
      }
    }
  }

  function pickNextMove(base, count, startIdx) {
    let bestIdx = startIdx;
    let bestSc = SCORE_BUF[base + startIdx];
    for (let i = startIdx + 1; i < count; i++) {
      if (SCORE_BUF[base + i] > bestSc) {
        bestSc = SCORE_BUF[base + i];
        bestIdx = i;
      }
    }
    if (bestIdx !== startIdx) {
      const tm = MOVE_BUF[base + startIdx];
      MOVE_BUF[base + startIdx] = MOVE_BUF[base + bestIdx];
      MOVE_BUF[base + bestIdx] = tm;
      const ts = SCORE_BUF[base + startIdx];
      SCORE_BUF[base + startIdx] = SCORE_BUF[base + bestIdx];
      SCORE_BUF[base + bestIdx] = ts;
    }
    return MOVE_BUF[base + startIdx];
  }

  function quiescence(alpha, beta, side, ply, qLeft, hHi, hLo) {
    if (checkTime()) return evaluate(b, side, unrevRed, unrevBlack, hiddenCount);
    const standPat = evaluate(b, side, unrevRed, unrevBlack, hiddenCount);
    if (qLeft <= 0 || ply >= MAX_PLY - 1) return standPat;
    if (standPat >= beta) return beta;
    if (standPat > alpha) alpha = standPat;

    const base = ply * 128;
    const count = genMoves(b, side, ply, true);
    if (count === 0) return standPat;
    scoreMoves(base, count, ply, 0);

    for (let i = 0; i < count; i++) {
      const mv = pickNextMove(base, count, i);
      const fr = mv & 31, to = (mv >> 5) & 31;
      const mover = b[fr], cap = b[to];

      // Make move & update hash incrementally
      const oFr = fr * 17 + (mover + 8);
      const oToOld = to * 17 + (cap + 8);
      const oToNew = to * 17 + (mover + 8);
      const nHi = (hHi ^ ZOBRIST_HI[oFr] ^ ZOBRIST_HI[oToOld] ^ ZOBRIST_HI[oToNew] ^ ZOBRIST_TURN_HI) >>> 0;
      const nLo = (hLo ^ ZOBRIST_LO[oFr] ^ ZOBRIST_LO[oToOld] ^ ZOBRIST_LO[oToNew] ^ ZOBRIST_TURN_LO) >>> 0;
      b[to] = mover;
      b[fr] = 0;

      const sc = -quiescence(-beta, -alpha, -side, ply + 1, qLeft - 1, nHi, nLo);

      b[fr] = mover;
      b[to] = cap;

      if (timedOut) return alpha;
      if (sc >= beta) return beta;
      if (sc > alpha) alpha = sc;
    }
    return alpha;
  }

  function negamax(depth, alpha, beta, side, ply, hHi, hLo) {
    if (checkTime()) return evaluate(b, side, unrevRed, unrevBlack, hiddenCount);

    const origAlpha = alpha;
    const ttIdx = hLo & TT_MASK;
    let ttBest = 0;
    if (ttFlag[ttIdx] !== 0 && ttKeyHi[ttIdx] === hHi && ttKeyLo[ttIdx] === hLo) {
      ttBest = ttMove[ttIdx];
      if (ttDepth[ttIdx] >= depth) {
        const sc = ttScore[ttIdx];
        const fl = ttFlag[ttIdx];
        if (fl === 1) return sc;
        if (fl === 2 && sc > alpha) alpha = sc;
        else if (fl === 3 && sc < beta) beta = sc;
        if (alpha >= beta) return sc;
      }
    }

    if (depth <= 0 || ply >= MAX_PLY - 1) {
      return quiescence(alpha, beta, side, ply, qDepth, hHi, hLo);
    }

    const base = ply * 128;
    const count = genMoves(b, side, ply, false);
    if (count === 0) {
      // If no hidden pieces remain, having zero moves is an immediate DEFEAT!
      if (hiddenCount === 0) return -WIN_SCORE + ply;
      return evaluate(b, side, unrevRed, unrevBlack, hiddenCount);
    }

    scoreMoves(base, count, ply, ttBest);

    let bestScore = -999999;
    let bestMv = MOVE_BUF[base];

    for (let i = 0; i < count; i++) {
      const mv = pickNextMove(base, count, i);
      const fr = mv & 31, to = (mv >> 5) & 31;
      const mover = b[fr], cap = b[to];

      const oFr = fr * 17 + (mover + 8);
      const oToNew = to * 17 + (mover + 8);
      let nHi = (hHi ^ ZOBRIST_HI[oFr] ^ ZOBRIST_HI[oToNew] ^ ZOBRIST_TURN_HI) >>> 0;
      let nLo = (hLo ^ ZOBRIST_LO[oFr] ^ ZOBRIST_LO[oToNew] ^ ZOBRIST_TURN_LO) >>> 0;
      if (cap !== 0) {
        const oToOld = to * 17 + (cap + 8);
        nHi = (nHi ^ ZOBRIST_HI[oToOld]) >>> 0;
        nLo = (nLo ^ ZOBRIST_LO[oToOld]) >>> 0;
      }

      b[to] = mover;
      b[fr] = 0;

      let sc;
      // Principal Variation Search (PVS / NegaScout)
      if (i === 0) {
        sc = -negamax(depth - 1, -beta, -alpha, -side, ply + 1, nHi, nLo);
      } else {
        sc = -negamax(depth - 1, -alpha - 1, -alpha, -side, ply + 1, nHi, nLo);
        if (!timedOut && sc > alpha && sc < beta) {
          sc = -negamax(depth - 1, -beta, -alpha, -side, ply + 1, nHi, nLo);
        }
      }

      b[fr] = mover;
      b[to] = cap;

      if (timedOut) return bestScore === -999999 ? evaluate(b, side, unrevRed, unrevBlack, hiddenCount) : bestScore;

      if (sc > bestScore) {
        bestScore = sc;
        bestMv = mv;
      }
      if (sc > alpha) alpha = sc;
      if (alpha >= beta) {
        if ((mv & 1024) === 0) {
          if (KILLER1[ply] !== mv) {
            KILLER2[ply] = KILLER1[ply];
            KILLER1[ply] = mv;
          }
          HISTORY[(fr << 5) | to] += depth * depth;
        }
        break;
      }
    }

    // Store in Transposition Table
    ttKeyHi[ttIdx] = hHi;
    ttKeyLo[ttIdx] = hLo;
    ttDepth[ttIdx] = depth;
    ttScore[ttIdx] = bestScore;
    ttMove[ttIdx] = bestMv & 4095;
    ttFlag[ttIdx] = bestScore <= origAlpha ? 3 : (bestScore >= beta ? 2 : 1);

    return bestScore;
  }

  // 1. Collect all root moves/captures
  const rootMoveCount = genMoves(b, aiSide, 0, false);
  const rootMoves = [];
  for (let i = 0; i < rootMoveCount; i++) {
    rootMoves.push(MOVE_BUF[i]);
  }

  // 2. Collect and pre-rank all hidden squares for True Expectimax Flip Evaluation!
  const hiddenSquares = [];
  if (hiddenCount > 0) {
    for (let i = 0; i < N; i++) {
      if (b[i] !== 1) continue;
      // Fast strategic heuristic to select the most interesting candidate flip squares
      let prio = CENTER_BONUS[i];
      const adj = ADJ[i];
      for (let k = 0; k < adj.length; k++) {
        const av = b[adj[k]];
        if (av === 0 || av === 1) continue;
        const isMine = (aiSide === 1 && av > 0) || (aiSide === -1 && av < 0);
        const rk = (av > 0 ? av : -av) - 2;
        if (isMine) {
          // Dangerous to flip right next to our own General/Advisor!
          if (rk >= 5) prio -= 35;
          else if (rk === 0) prio += 8; // Safe next to our Soldier
        } else {
          // Interesting to flip next to enemy high-value piece (potential sniper pop), risky next to enemy mid-piece
          if (rk >= 5) prio += 14;
          else prio -= 8;
        }
      }
      // Check if an enemy cannon can jump-shoot square `i` right away
      const rays = RAYS[i];
      for (let d = 0; d < 4; d++) {
        const ray = rays[d];
        let jumped = false;
        for (let k = 0; k < ray.length; k++) {
          const av = b[ray[k]];
          if (av !== 0) {
            if (!jumped) jumped = true;
            else {
              if (av !== 1) {
                const isMine = (aiSide === 1 && av > 0) || (aiSide === -1 && av < 0);
                const rk = (av > 0 ? av : -av) - 2;
                if (rk === 1) prio += isMine ? 18 : -28; // Our cannon aims here (+18) vs Enemy cannon aims here (-28)!
              }
              break;
            }
          }
        }
      }
      hiddenSquares.push({ sq: i, prio: prio + Math.random() * 0.5 });
    }
    hiddenSquares.sort((a, b) => b.prio - a.prio);
  }

  // Build exact probability buckets of remaining unrevealed pieces
  const buckets = [];
  if (hiddenCount > 0) {
    for (let rk = 0; rk < 7; rk++) {
      if (unrevRed[rk] > 0) buckets.push({ val: rk + 2, isRed: true, rk, cnt: unrevRed[rk] });
      if (unrevBlack[rk] > 0) buckets.push({ val: -(rk + 2), isRed: false, rk, cnt: unrevBlack[rk] });
    }
  }

  // Evaluate top candidate flips using TRUE Multi-Outcome Expectimax!
  // For each candidate flip square, actually place EVERY possible hidden piece on it,
  // let the opponent respond with Negamax(flipSearchDepth) + Quiescence, and take exact probability-weighted average!
  let bestFlipSq = -1;
  let bestFlipScore = -999999;

  if (hiddenSquares.length > 0 && buckets.length > 0) {
    const numToTest = Math.min(expectimaxFlips, hiddenSquares.length);
    const flipBudgetEnd = startTime + budgetMs * 0.35; // Cap flip Expectimax to 35% of total budget
    const oldHidden = hiddenCount;
    hiddenCount--;

    for (let f = 0; f < numToTest; f++) {
      if (f > 0 && performance.now() > flipBudgetEnd) break;
      const sq = hiddenSquares[f].sq;
      let weightedSum = 0;
      let totalW = 0;
      let aborted = false;

      const oHid = sq * 17 + (1 + 8);
      for (let bi = 0; bi < buckets.length; bi++) {
        const bk = buckets[bi];
        // Temporarily reveal this bucket outcome on `sq`
        b[sq] = bk.val;
        if (bk.isRed) unrevRed[bk.rk]--;
        else unrevBlack[bk.rk]--;

        const oNew = sq * 17 + (bk.val + 8);
        const nHi = (curHi ^ ZOBRIST_HI[oHid] ^ ZOBRIST_HI[oNew] ^ ZOBRIST_TURN_HI) >>> 0;
        const nLo = (curLo ^ ZOBRIST_LO[oHid] ^ ZOBRIST_LO[oNew] ^ ZOBRIST_TURN_LO) >>> 0;

        // Opponent replies with search!
        const outcomeScore = -negamax(flipSearchDepth, -999999, 999999, -aiSide, 1, nHi, nLo);

        // Restore hidden tile & unrevealed count
        b[sq] = 1;
        if (bk.isRed) unrevRed[bk.rk]++;
        else unrevBlack[bk.rk]++;

        if (timedOut) {
          aborted = true;
          break;
        }
        weightedSum += outcomeScore * bk.cnt;
        totalW += bk.cnt;
      }

      if (!aborted && totalW > 0) {
        // Tiny info-gain tiebreaker early when board is mostly unrevealed (so AI opens the board smoothly!)
        const infoGain = oldHidden >= 24 ? 10 : (oldHidden >= 14 ? 4 : 0);
        const expScore = (weightedSum / totalW) + infoGain;
        if (expScore > bestFlipScore) {
          bestFlipScore = expScore;
          bestFlipSq = sq;
        }
      }
    }
    hiddenCount = oldHidden;
    timedOut = false; // Reset timeout flag for main move search (which still respects overall budgetMs!)
  }

  // If no revealed moves exist, return best Expectimax flip immediately
  if (rootMoves.length === 0) {
    const sq = bestFlipSq >= 0 ? bestFlipSq : hiddenSquares[0].sq;
    return { type: 'flip', r: sq >> 3, c: sq & 7 };
  }

  // 3. Iterative Deepening PVS over all revealed moves & captures!
  // Order root moves by MVV-LVA initially
  rootMoves.sort((a, bMove) => {
    const va = (a & 1024) ? 10000 + BASE_VAL[(b[(a >> 5) & 31] > 0 ? b[(a >> 5) & 31] : -b[(a >> 5) & 31]) - 2] * 16 : 0;
    const vb = (bMove & 1024) ? 10000 + BASE_VAL[(b[(bMove >> 5) & 31] > 0 ? b[(bMove >> 5) & 31] : -b[(bMove >> 5) & 31]) - 2] * 16 : 0;
    return vb - va;
  });

  let bestMoveCode = rootMoves[0];
  let bestMoveScore = -999999;

  for (let d = 1; d <= maxDepth; d++) {
    let iterBestSc = -999999;
    let iterBestMv = rootMoves[0];
    let alpha = -999999;
    const beta = 999999;
    timedOut = false;

    for (let i = 0; i < rootMoves.length; i++) {
      const mv = rootMoves[i];
      const fr = mv & 31, to = (mv >> 5) & 31;
      const mover = b[fr], cap = b[to];

      const oFr = fr * 17 + (mover + 8);
      const oToNew = to * 17 + (mover + 8);
      let nHi = (curHi ^ ZOBRIST_HI[oFr] ^ ZOBRIST_HI[oToNew] ^ ZOBRIST_TURN_HI) >>> 0;
      let nLo = (curLo ^ ZOBRIST_LO[oFr] ^ ZOBRIST_LO[oToNew] ^ ZOBRIST_TURN_LO) >>> 0;
      if (cap !== 0) {
        const oToOld = to * 17 + (cap + 8);
        nHi = (nHi ^ ZOBRIST_HI[oToOld]) >>> 0;
        nLo = (nLo ^ ZOBRIST_LO[oToOld]) >>> 0;
      }

      b[to] = mover;
      b[fr] = 0;

      let sc;
      if (i === 0) {
        sc = -negamax(d - 1, -beta, -alpha, -aiSide, 1, nHi, nLo);
      } else {
        sc = -negamax(d - 1, -alpha - 1, -alpha, -aiSide, 1, nHi, nLo);
        if (!timedOut && sc > alpha) {
          sc = -negamax(d - 1, -beta, -alpha, -aiSide, 1, nHi, nLo);
        }
      }

      // Immediate capture certainty bonus: when hidden tiles exist, cashing in a guaranteed kill NOW
      // beats delaying it (since the opponent could flip a hidden blocker/killer on the next turn!).
      if (cap !== 0) {
        const capRk = (cap > 0 ? cap : -cap) - 2;
        sc += hiddenCount > 0 ? (10 + Math.round(BASE_VAL[capRk] * 0.22)) : 6;
      }

      // Repetition avoidance when ahead, draw-seeking when badly behind!
      if (cap === 0 && recentHashSet.has(`${nHi}_${nLo}`)) {
        sc += sc > 30 ? -75 : (sc < -90 ? 45 : -20);
      }

      b[fr] = mover;
      b[to] = cap;

      if (timedOut) break;
      if (sc > iterBestSc) {
        iterBestSc = sc;
        iterBestMv = mv;
      }
      if (sc > alpha) alpha = sc;
    }

    if (!timedOut) {
      bestMoveCode = iterBestMv;
      bestMoveScore = iterBestSc;
      // Move PV move to index 0 for massive pruning on next depth
      const idx = rootMoves.indexOf(bestMoveCode);
      if (idx > 0) {
        rootMoves.splice(idx, 1);
        rootMoves.unshift(bestMoveCode);
      }
      // Early exit if forced win found
      if (bestMoveScore > WIN_SCORE - 100) break;
    } else {
      break;
    }
  }

  // 4. Compare Best Tactical Move vs Best Expectimax Flip on the EXACT same evaluation scale!
  if (bestFlipSq >= 0 && bestFlipScore > bestMoveScore) {
    return { type: 'flip', r: bestFlipSq >> 3, c: bestFlipSq & 7 };
  }

  const fr = bestMoveCode & 31;
  const to = (bestMoveCode >> 5) & 31;
  const isCap = (bestMoveCode & 1024) !== 0;
  const isCannon = (bestMoveCode & 2048) !== 0;
  return {
    type: isCap ? 'capture' : 'move',
    fr: fr >> 3,
    fc: fr & 7,
    tr: to >> 3,
    tc: to & 7,
    isCannon
  };
}
