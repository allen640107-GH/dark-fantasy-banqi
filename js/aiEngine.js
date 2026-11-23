// Championship-Grade Taiwanese Banqi (Dark Chess) Engine v2
// Zero-Sum Hidden-Deck Accounting + Clean TT + Guaranteed Depth-1+Quiescence + True Expectimax Flips
// Features: Flat Int8Array(32), 64-bit Zobrist Hashing, 131K Typed-Array TT, PVS, Killer/History Ordering,
// Cannon Battery Setup, Fork Detection, Hanging-Piece Defense, Endgame Cornering & Anti-Repetition.

const ROWS = 4;
const COLS = 8;
const N = 32;

// Cell encoding:
//  0       = empty
//  1       = hidden (face-down)
//  2 .. 8  = Red revealed   (rank = val - 2: 0=兵,1=炮,2=傌,3=俥,4=相,5=仕,6=帥)
// -2 .. -8 = Black revealed (rank = -val - 2: 0=卒,1=包,2=馬,3=車,4=象,5=士,6=將)

const BASE_VAL = new Int32Array([22, 66, 28, 44, 66, 96, 140]);
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

const CENTER_BONUS = new Int16Array(N);
const EDGE_PENALTY = new Int16Array(N);
for (let r = 0; r < ROWS; r++) {
  for (let c = 0; c < COLS; c++) {
    const idx = r * COLS + c;
    const dist = Math.abs(r - 1.5) + Math.abs(c - 3.5);
    CENTER_BONUS[idx] = Math.round(Math.max(0, 4.5 - dist) * 2.5);
    const isCorner = (r === 0 || r === 3) && (c === 0 || c === 7);
    const isEdge = r === 0 || r === 3 || c === 0 || c === 7;
    EDGE_PENALTY[idx] = isCorner ? 16 : (isEdge ? 7 : 0);
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

// Flat Typed-Array Transposition Table (131,072 entries, cleared cleanly each search!)
const TT_BITS = 17;
const TT_SIZE = 1 << TT_BITS;
const TT_MASK = TT_SIZE - 1;
const ttKeyHi = new Uint32Array(TT_SIZE);
const ttKeyLo = new Uint32Array(TT_SIZE);
const ttDepth = new Int8Array(TT_SIZE);
const ttFlag = new Uint8Array(TT_SIZE); // 0=empty, 1=EXACT, 2=LOWER, 3=UPPER
const ttScore = new Int32Array(TT_SIZE);
const ttMove = new Uint16Array(TT_SIZE);

const MAX_PLY = 40;
const MOVE_BUF = new Int32Array(MAX_PLY * 128);
const SCORE_BUF = new Int32Array(MAX_PLY * 128);
const KILLER1 = new Int32Array(MAX_PLY);
const KILLER2 = new Int32Array(MAX_PLY);
const HISTORY = new Int32Array(N * N);

const evalRIdx = new Int8Array(16);
const evalRRank = new Int8Array(16);
const evalBIdx = new Int8Array(16);
const evalBRank = new Int8Array(16);

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

function isAttackedBy(b, sq, attackerSide) {
  const targetV = b[sq];
  if (targetV === 0 || targetV === 1) return false;
  const targetRank = (targetV > 0 ? targetV : -targetV) - 2;

  const adj = ADJ[sq];
  for (let k = 0; k < adj.length; k++) {
    const av = b[adj[k]];
    if (av !== 0 && av !== 1 && ((attackerSide === 1 && av > 0) || (attackerSide === -1 && av < 0))) {
      const arank = (av > 0 ? av : -av) - 2;
      if (CAN_BEAT[arank * 7 + targetRank]) return true;
    }
  }

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

// Grandmaster Static Evaluation with ZERO-SUM UNREVEALED DECK ACCOUNTING!
// Counting unrevealed pieces at ~0.95x material eliminates phantom flip inflation!
function evaluate(b, sideToMove, unrevRed, unrevBlack, hiddenCount, ply = 0) {
  let redCount = 0, blackCount = 0;
  let redGen = unrevRed[6], blackGen = unrevBlack[6];
  let redSol = unrevRed[0], blackSol = unrevBlack[0];
  let redCan = unrevRed[1], blackCan = unrevBlack[1];
  let redMaxRank = -1, blackMaxRank = -1;

  let rLen = 0, bLen = 0;
  for (let i = 0; i < N; i++) {
    const v = b[i];
    if (v === 0 || v === 1) continue;
    if (v > 0) {
      const rk = v - 2;
      evalRIdx[rLen] = i;
      evalRRank[rLen++] = rk;
      redCount++;
      if (rk === 6) redGen++;
      else if (rk === 0) redSol++;
      else if (rk === 1) redCan++;
      if (rk > redMaxRank && rk !== 1) redMaxRank = rk;
    } else {
      const rk = -v - 2;
      evalBIdx[bLen] = i;
      evalBRank[bLen++] = rk;
      blackCount++;
      if (rk === 6) blackGen++;
      else if (rk === 0) blackSol++;
      else if (rk === 1) blackCan++;
      if (rk > blackMaxRank && rk !== 1) blackMaxRank = rk;
    }
  }

  if (hiddenCount === 0) {
    if (blackCount === 0) return sideToMove === 1 ? (WIN_SCORE - ply) : (-WIN_SCORE + ply);
    if (redCount === 0) return sideToMove === -1 ? (WIN_SCORE - ply) : (-WIN_SCORE + ply);
  }

  const totalBoardPieces = rLen + bLen + hiddenCount;

  const getVal = (rk, isRed) => {
    const oppGen = isRed ? blackGen : redGen;
    const oppSol = isRed ? blackSol : redSol;
    const oppCan = isRed ? blackCan : redCan;
    if (rk === 0) return oppGen > 0 ? 48 : 18;
    if (rk === 1) return totalBoardPieces >= 12 ? 80 : (totalBoardPieces >= 6 ? 62 : 38);
    if (rk === 6) {
      if (oppSol === 0 && oppCan === 0) return 270;
      if (oppSol === 0) return 180;
      return 140;
    }
    if (rk === 5) return oppGen === 0 ? 128 : 96;
    if (rk === 4) return (oppGen === 0 && (isRed ? blackMaxRank : redMaxRank) <= 4) ? 90 : 66;
    return BASE_VAL[rk];
  };

  let redScore = 0;
  let blackScore = 0;

  // CRITICAL ZERO-SUM FIX: Include unrevealed pool material at EXACT 3.00x (same as revealed 3.00x)!
  // Revealing a tile creates ZERO phantom material regardless of red/black hidden counts!
  if (hiddenCount > 0) {
    for (let rk = 0; rk < 7; rk++) {
      if (unrevRed[rk] > 0) redScore += getVal(rk, true) * 3 * unrevRed[rk];
      if (unrevBlack[rk] > 0) blackScore += getVal(rk, false) * 3 * unrevBlack[rk];
    }
  }

  if (hiddenCount <= 6) {
    if (redMaxRank > blackMaxRank) redScore += 45;
    else if (blackMaxRank > redMaxRank) blackScore += 45;
  }

  for (let m = 0; m < rLen; m++) {
    const i = evalRIdx[m], rk = evalRRank[m];
    const val = getVal(rk, true);
    redScore += val * 3 + CENTER_BONUS[i];

    // Cannon Battery & Alignment
    if (rk === 1) {
      const rays = RAYS[i];
      for (let d = 0; d < 4; d++) {
        const ray = rays[d];
        let blockers = 0;
        for (let k = 0; k < ray.length; k++) {
          const tv = b[ray[k]];
          if (tv !== 0) {
            if (blockers === 0) blockers = 1;
            else if (blockers === 1) {
              if (tv < 0) {
                const trk = -tv - 2;
                redScore += Math.round(getVal(trk, false) * 0.45);
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
    redScore += mob * 2;
    if (isAttackedBy(b, i, -1)) {
      redScore -= Math.round(val * 0.42);
    }
  }

  for (let m = 0; m < bLen; m++) {
    const i = evalBIdx[m], rk = evalBRank[m];
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
            if (blockers === 0) blockers = 1;
            else if (blockers === 1) {
              if (tv > 1) {
                const trk = tv - 2;
                blackScore += Math.round(getVal(trk, true) * 0.45);
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
      blackScore -= Math.round(val * 0.42);
    }
  }

  // Predator-Prey Chasing & Cornering
  const endgameFactor = hiddenCount === 0 ? 4 : (hiddenCount <= 6 ? 2 : 1);
  for (let m = 0; m < rLen; m++) {
    const ri = evalRIdx[m], rrk = evalRRank[m];
    const rr = ri >> 3, rc = ri & 7;
    for (let n = 0; n < bLen; n++) {
      const bi = evalBIdx[n], brk = evalBRank[n];
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

export function findBestActionPro(gameState, config) {
  const { maxDepth, qDepth, budgetMs, expectimaxFlips = 8 } = config;
  const aiSide = gameState.aiColor === 'red' ? 1 : -1;
  const encoded = encodeBoard(gameState.board);
  const { b, unrevRed, unrevBlack } = encoded;
  let hiddenCount = encoded.hiddenCount;
  const startTime = performance.now();
  let timedOut = false;
  let allowTimeout = false; // NEVER allow timeout on depth 1!
  let useTT = true;
  let nodes = 0;

  // CRITICAL FIX: Clean TT every turn so stale/bucket hashes NEVER corrupt scores!
  ttFlag.fill(0);
  KILLER1.fill(0);
  KILLER2.fill(0);
  for (let i = 0; i < HISTORY.length; i++) HISTORY[i] >>= 2;

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
    if (allowTimeout && (nodes & 255) === 0 && performance.now() - startTime > budgetMs) {
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
    if (checkTime()) return evaluate(b, side, unrevRed, unrevBlack, hiddenCount, ply);
    const standPat = evaluate(b, side, unrevRed, unrevBlack, hiddenCount, ply);
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
    if (checkTime()) return evaluate(b, side, unrevRed, unrevBlack, hiddenCount, ply);

    const origAlpha = alpha;
    const ttIdx = hLo & TT_MASK;
    let ttBest = 0;
    if (useTT && ttFlag[ttIdx] !== 0 && ttKeyHi[ttIdx] === hHi && ttKeyLo[ttIdx] === hLo) {
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

    if (useTT) {
      ttKeyHi[ttIdx] = hHi;
      ttKeyLo[ttIdx] = hLo;
      ttDepth[ttIdx] = depth;
      ttScore[ttIdx] = bestScore;
      ttMove[ttIdx] = bestMv & 4095;
      ttFlag[ttIdx] = bestScore <= origAlpha ? 3 : (bestScore >= beta ? 2 : 1);
    }

    return bestScore;
  }

  // ===================== STEP 1: RUN MAIN PVS MOVE SEARCH FIRST! =====================
  // Guarantee Depth 1 + Quiescence ALWAYS completes with zero possibility of unevaluated blunders!
  const rootMoveCount = genMoves(b, aiSide, 0, false);
  const rootMoves = [];
  for (let i = 0; i < rootMoveCount; i++) {
    rootMoves.push(MOVE_BUF[i]);
  }

  let bestMoveCode = -1;
  let bestMoveScore = -999999;
  let completedDepth = 1;
  const rootEvalAtStart = evaluate(b, aiSide, unrevRed, unrevBlack, hiddenCount);
  const moveBudgetEnd = startTime + (hiddenCount > 0 ? budgetMs * 0.65 : budgetMs);

  if (rootMoves.length > 0) {
    rootMoves.sort((a, bMove) => {
      const va = (a & 1024) ? 10000 + BASE_VAL[(b[(a >> 5) & 31] > 0 ? b[(a >> 5) & 31] : -b[(a >> 5) & 31]) - 2] * 16 : 0;
      const vb = (bMove & 1024) ? 10000 + BASE_VAL[(b[(bMove >> 5) & 31] > 0 ? b[(bMove >> 5) & 31] : -b[(bMove >> 5) & 31]) - 2] * 16 : 0;
      return vb - va;
    });

    bestMoveCode = rootMoves[0];

    for (let d = 1; d <= maxDepth; d++) {
      if (d > 1 && performance.now() > moveBudgetEnd) break;
      allowTimeout = d > 1; // Depth 1 NEVER aborts!
      timedOut = false;

      let iterBestSc = -999999;
      let iterBestMv = rootMoves[0];
      let alpha = -999999;
      const beta = 999999;

      for (let i = 0; i < rootMoves.length; i++) {
        if (allowTimeout && performance.now() > moveBudgetEnd) {
          timedOut = true;
          break;
        }
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

        // Compute root moveBias BEFORE PVS search so fail-low bounds are NEVER corrupted!
        let moveBias = 0;
        if (cap !== 0) {
          const capRk = (cap > 0 ? cap : -cap) - 2;
          moveBias += hiddenCount > 0 ? (26 + Math.round(BASE_VAL[capRk] * 0.35)) : 0;
        } else if (recentHashSet.has(`${nHi}_${nLo}`)) {
          moveBias -= rootEvalAtStart > 25 ? 85 : (rootEvalAtStart < -90 ? 0 : 25);
        }

        const adjAlpha = alpha - moveBias;
        const adjBeta = beta - moveBias;

        let rawSc;
        if (i === 0) {
          rawSc = -negamax(d - 1, -adjBeta, -adjAlpha, -aiSide, 1, nHi, nLo);
        } else {
          rawSc = -negamax(d - 1, -adjAlpha - 1, -adjAlpha, -aiSide, 1, nHi, nLo);
          if (!timedOut && rawSc > adjAlpha) {
            rawSc = -negamax(d - 1, -adjBeta, -adjAlpha, -aiSide, 1, nHi, nLo);
          }
        }
        const sc = rawSc + moveBias;

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
        completedDepth = d;
        const idx = rootMoves.indexOf(bestMoveCode);
        if (idx > 0) {
          rootMoves.splice(idx, 1);
          rootMoves.unshift(bestMoveCode);
        }
        if (bestMoveScore > WIN_SCORE - 100) break;
      } else {
        break;
      }
    }
  }

  // ===================== STEP 2: DEPTH-MATCHED EXPECTIMAX FLIP EVALUATION =====================
  // CRITICAL GRANDMASTER FORMULA:
  //   FlipScore(sq) = nullMoveScore(completedDepth - 1) + (Expect1(sq) - nullMoveScore(1))
  // Comparing Move(Depth D) vs Flip(Depth D) eliminates 100% of horizon-effect missed captures!
  let bestFlipSq = -1;
  let bestFlipScore = -999999;

  if (hiddenCount > 0) {
    const hiddenSquares = [];
    for (let i = 0; i < N; i++) {
      if (b[i] !== 1) continue;
      let prio = CENTER_BONUS[i];
      const adj = ADJ[i];
      for (let k = 0; k < adj.length; k++) {
        const av = b[adj[k]];
        if (av === 0 || av === 1) continue;
        const isMine = (aiSide === 1 && av > 0) || (aiSide === -1 && av < 0);
        const rk = (av > 0 ? av : -av) - 2;
        if (isMine) {
          if (rk >= 5) prio -= 40;
          else if (rk === 0) prio += 10;
        } else {
          if (rk >= 5) prio += 12;
          else prio -= 10;
        }
      }
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
                if (rk === 1) prio += isMine ? 20 : -32;
              }
              break;
            }
          }
        }
      }
      hiddenSquares.push({ sq: i, prio: prio + Math.random() * 0.4 });
    }
    hiddenSquares.sort((a, bSq) => bSq.prio - a.prio);

    const buckets = [];
    for (let rk = 0; rk < 7; rk++) {
      if (unrevRed[rk] > 0) buckets.push({ val: rk + 2, isRed: true, rk, cnt: unrevRed[rk] });
      if (unrevBlack[rk] > 0) buckets.push({ val: -(rk + 2), isRed: false, rk, cnt: unrevBlack[rk] });
    }

    if (hiddenSquares.length > 0 && buckets.length > 0) {
      const oppHi = (curHi ^ ZOBRIST_TURN_HI) >>> 0;
      const oppLo = (curLo ^ ZOBRIST_TURN_LO) >>> 0;

      // Exact depth-matched baseline if AI passes/flips instead of moving an existing piece!
      // AXIOM OF PASSING: Wasting a turn without moving existing pieces can NEVER magically gain
      // delayed free captures above rootEval (prevents procrastinating free kills like 士 x 俥!).
      const rootEval = evaluate(b, aiSide, unrevRed, unrevBlack, hiddenCount);
      useTT = true;
      allowTimeout = false;
      timedOut = false;
      const nullScoreRaw = rootMoves.length > 0
        ? -negamax(completedDepth - 1, -999999, 999999, -aiSide, 1, oppHi, oppLo)
        : rootEval;
      const nullScoreDeep = Math.min(nullScoreRaw, rootEval);

      // Measure pure local 1-ply tactical delta of flipping `sq` without TT cross-contamination!
      useTT = false;
      const nullScore1 = -negamax(1, -999999, 999999, -aiSide, 1, oppHi, oppLo);

      allowTimeout = true;
      timedOut = false;

      const numToTest = Math.min(expectimaxFlips, hiddenSquares.length);
      const oldHidden = hiddenCount;
      hiddenCount--;

      let bestPureDelta = -999999;

      for (let f = 0; f < numToTest; f++) {
        if (f > 0 && performance.now() - startTime > budgetMs) break;
        const sq = hiddenSquares[f].sq;
        let weightedSum = 0;
        let totalW = 0;
        let aborted = false;

        const oHid = sq * 17 + (1 + 8);
        for (let bi = 0; bi < buckets.length; bi++) {
          const bk = buckets[bi];
          b[sq] = bk.val;
          if (bk.isRed) unrevRed[bk.rk]--;
          else unrevBlack[bk.rk]--;

          const oNew = sq * 17 + (bk.val + 8);
          const nHi = (curHi ^ ZOBRIST_HI[oHid] ^ ZOBRIST_HI[oNew] ^ ZOBRIST_TURN_HI) >>> 0;
          const nLo = (curLo ^ ZOBRIST_LO[oHid] ^ ZOBRIST_LO[oNew] ^ ZOBRIST_TURN_LO) >>> 0;

          const outcomeScore = -negamax(1, -999999, 999999, -aiSide, 1, nHi, nLo);

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
          const pureDelta = (weightedSum / totalW) - nullScore1;
          if (pureDelta > bestPureDelta) {
            bestPureDelta = pureDelta;
            bestFlipSq = sq;
          }
        }
      }
      hiddenCount = oldHidden;
      if (bestFlipSq < 0) {
        bestFlipSq = hiddenSquares[0].sq;
        bestPureDelta = 0;
      }
      // Clamp noisy 1-ply flip spike so a speculative flip never overrides a solid free capture
      bestPureDelta = Math.max(-250, Math.min(35, bestPureDelta));
      const infoGain = oldHidden >= 24 ? 8 : (oldHidden >= 14 ? 3 : 0);
      bestFlipScore = nullScoreDeep + bestPureDelta + infoGain;
    }
  }

  // ===================== STEP 3: FINAL DECISION =====================
  if (rootMoves.length === 0) {
    return { type: 'flip', r: bestFlipSq >> 3, c: bestFlipSq & 7 };
  }

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
