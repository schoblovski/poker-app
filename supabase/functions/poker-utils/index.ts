// DTKS Poker – Shared Utilities v1.4
// Deck management + Hand evaluators for Hold'em, Omaha, Texahma
//
// Card format: { rank: number, suit: string }
//   rank: 2-14 (11=J, 12=Q, 13=K, 14=A)
//   suit: 's' | 'h' | 'd' | 'c'

export type Card = { rank: number; suit: string };

// ─── Deck ────────────────────────────────────────────────────

export function buildDeck(): Card[] {
  const suits = ['s', 'h', 'd', 'c'];
  const deck: Card[] = [];
  for (const suit of suits) {
    for (let rank = 2; rank <= 14; rank++) {
      deck.push({ rank, suit });
    }
  }
  return deck;
}

export function shuffle(deck: Card[]): Card[] {
  const d = [...deck];
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

// ─── Hand Evaluator ──────────────────────────────────────────
// Returns a comparable integer: higher = better hand.
// Encoding: category (4 bits) + tiebreaker ranks (5×4 bits) = 24 bits

const STRAIGHT_FLUSH  = 8;
const FOUR_OF_A_KIND  = 7;
const FULL_HOUSE      = 6;
const FLUSH           = 5;
const STRAIGHT        = 4;
const THREE_OF_A_KIND = 3;
const TWO_PAIR        = 2;
const ONE_PAIR        = 1;
const HIGH_CARD       = 0;

function encode(cat: number, ...ranks: number[]): number {
  // Always use exactly 5 rank slots so cat is always at bit 20.
  // Without padding, HIGH_CARD (0<<20|ranks) would produce larger numbers than
  // ONE_PAIR (1<<16|ranks) for high cards, making comparison across categories wrong.
  const slots = [...ranks, 0, 0, 0, 0, 0].slice(0, 5);
  let v = cat;
  for (const r of slots) { v = (v << 4) | r; }
  return v;
}

export function eval5(cards: Card[]): number {
  const ranks = cards.map(c => c.rank).sort((a, b) => b - a);
  const suits = cards.map(c => c.suit);

  const isFlush = suits.every(s => s === suits[0]);
  const rankSet = [...new Set(ranks)];

  // Straight detection (including A-2-3-4-5)
  let isStraight = false;
  let straightHigh = 0;
  if (rankSet.length === 5) {
    if (ranks[0] - ranks[4] === 4) {
      isStraight = true;
      straightHigh = ranks[0];
    } else if (ranks[0] === 14 && ranks[1] === 5) {
      isStraight = true;
      straightHigh = 5; // wheel
    }
  }

  if (isStraight && isFlush) return encode(STRAIGHT_FLUSH, straightHigh);

  const counts: Record<number, number> = {};
  for (const r of ranks) counts[r] = (counts[r] ?? 0) + 1;
  const groups = Object.entries(counts)
    .map(([r, n]) => ({ r: +r, n }))
    .sort((a, b) => b.n - a.n || b.r - a.r);

  if (groups[0].n === 4) return encode(FOUR_OF_A_KIND, groups[0].r, groups[1].r);
  if (groups[0].n === 3 && groups[1].n === 2)
    return encode(FULL_HOUSE, groups[0].r, groups[1].r);
  if (isFlush) return encode(FLUSH, ...ranks);
  if (isStraight) return encode(STRAIGHT, straightHigh);
  if (groups[0].n === 3)
    return encode(THREE_OF_A_KIND, groups[0].r, groups[1].r, groups[2].r);
  if (groups[0].n === 2 && groups[1].n === 2)
    return encode(TWO_PAIR, groups[0].r, groups[1].r, groups[2].r);
  if (groups[0].n === 2)
    return encode(ONE_PAIR, groups[0].r, groups[1].r, groups[2].r, groups[3].r);
  return encode(HIGH_CARD, ...ranks);
}

// Choose k items from array (combinations)
function choose<T>(arr: T[], k: number): T[][] {
  if (k === 0) return [[]];
  if (k > arr.length) return [];
  const [first, ...rest] = arr;
  return [
    ...choose(rest, k - 1).map(c => [first, ...c]),
    ...choose(rest, k),
  ];
}

// ─── Hold'em: best 5 of 7 ────────────────────────────────────

export function evalHoldem(hole: Card[], board: Card[]): { score: number; best: Card[] } {
  const all = [...hole, ...board];
  let best = { score: -1, best: [] as Card[] };
  for (const combo of choose(all, 5)) {
    const score = eval5(combo);
    if (score > best.score) best = { score, best: combo };
  }
  return best;
}

// ─── Omaha: exactly 2 hole + exactly 3 board ─────────────────

export function evalOmaha(hole: Card[], board: Card[]): { score: number; best: Card[]; usedHole: Card[]; usedBoard: Card[] } {
  let best = { score: -1, best: [] as Card[], usedHole: [] as Card[], usedBoard: [] as Card[] };
  for (const h2 of choose(hole, 2)) {
    for (const b3 of choose(board, 3)) {
      const combo = [...h2, ...b3];
      const score = eval5(combo);
      if (score > best.score) best = { score, best: combo, usedHole: h2, usedBoard: b3 };
    }
  }
  return best;
}

// ─── Texahma: 0-4 hole cards + matching board cards ──────────
// 126 combinations total

export function evalTexahma(hole: Card[], board: Card[]): { score: number; best: Card[]; usedHole: Card[]; usedBoard: Card[] } {
  let best = { score: -1, best: [] as Card[], usedHole: [] as Card[], usedBoard: [] as Card[] };
  for (let k = 0; k <= 4; k++) {
    const need = 5 - k;
    if (need > board.length) continue;
    for (const hk of choose(hole, k)) {
      for (const bk of choose(board, need)) {
        const combo = [...hk, ...bk];
        const score = eval5(combo);
        if (score > best.score) best = { score, best: combo, usedHole: hk, usedBoard: bk };
      }
    }
  }
  return best;
}

// ─── Hand name ───────────────────────────────────────────────

export function handName(score: number): string {
  const cat = score >> 20;
  const r1  = (score >> 16) & 0xf;
  const r2  = (score >> 12) & 0xf;
  const rn = (r: number) =>
    ({ 14:'Ass', 13:'König', 12:'Dame', 11:'Bube', 10:'Zehn' } as Record<number,string>)[r] ?? String(r);
  const rp = (r: number) =>
    ({ 14:'Asse', 13:'Könige', 12:'Damen', 11:'Buben', 10:'Zehnen',
       9:'Neuner', 8:'Achter', 7:'Siebener', 6:'Sechser', 5:'Fünfer',
       4:'Vierer', 3:'Dreier', 2:'Zweier' } as Record<number,string>)[r] ?? `${r}er`;
  switch (cat) {
    case STRAIGHT_FLUSH:  return r1 === 14 ? 'Royal Flush' : r1 === 5 ? 'Straight Flush, Rad' : `Straight Flush, ${rn(r1)} hoch`;
    case FOUR_OF_A_KIND:  return `Vierling, ${rp(r1)}`;
    case FULL_HOUSE:      return `Full House, ${rp(r1)} über ${rp(r2)}`;
    case FLUSH:           return `Flush, ${rn(r1)} hoch`;
    case STRAIGHT:        return r1 === 5 ? 'Straight, Rad' : `Straight, ${rn(r1)} hoch`;
    case THREE_OF_A_KIND: return `Drilling, ${rp(r1)}`;
    case TWO_PAIR:        return `Zwei Paare, ${rp(r1)} und ${rp(r2)}`;
    case ONE_PAIR:        return `Ein Paar ${rp(r1)}`;
    default:              return `${rn(r1)} hoch`;
  }
}

// ─── Card display helpers ─────────────────────────────────────

export function cardStr(c: Card): string {
  const r = c.rank === 14 ? 'A' : c.rank === 13 ? 'K' : c.rank === 12 ? 'Q' :
            c.rank === 11 ? 'J' : c.rank === 10 ? 'T' : String(c.rank);
  return r + c.suit.toUpperCase();
}

// ─── CORS helper ─────────────────────────────────────────────

export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export function corsOk() {
  return new Response(null, { status: 204, headers: CORS });
}

export function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

export function err(msg: string, status = 400) {
  return json({ error: msg }, status);
}
