// DTKS Poker – Edge Function: poker-bot-action v1.2
// Executes an AI decision for a bot player (ist_bot=true in spieler table).
// Called by any human client when current_player_id belongs to a bot.
//
// POST Body:
//   {
//     online_spiel_id: string,
//     bot_spieler_id:  string,
//     action?:         'play' | 'reveal' | 'runout'   (default: 'play')
//   }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsOk, json, err } from '../poker-utils/index.ts';

const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';

interface Card { rank: number; suit: string; }
interface BotConfig {
  aggressivitaet?: number; // 0–100: how often raises vs calls
  risiko?: number;         // 0–100: willingness to put chips at risk
  bluff?: number;          // 0–100: bluffing frequency
  karten_zeigen?: 'immer' | 'nie' | 'showdown'; // card reveal behavior
  style?: string;          // cosmetic preset name only
  avatar?: string;         // SVG data URI for bot profile picture
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return corsOk();

  let body: { online_spiel_id: string; bot_spieler_id?: string; action?: string; name?: string; config?: BotConfig };
  try { body = await req.json(); }
  catch { return err('Invalid JSON'); }

  const { online_spiel_id, bot_spieler_id } = body;
  const actionType = body.action ?? 'play';
  if (!online_spiel_id) return err('Fehlende Parameter');

  const db = createClient(SUPABASE_URL, SERVICE_KEY);

  // ── CREATE action (bot add – requires service role to bypass RLS) ────────
  if (actionType === 'create') {
    const { name, config } = body;
    if (!name) return err('Kein Name angegeben');

    // Find free seat
    const { data: session } = await db.from('online_spiele').select('*').eq('id', online_spiel_id).single();
    if (!session) return err('Session nicht gefunden', 404);
    const { data: takenSeats } = await db.from('online_seats').select('seat').eq('online_spiel_id', online_spiel_id);
    const taken = new Set((takenSeats ?? []).map((s: any) => s.seat));
    let freeSeat = -1;
    for (let i = 1; i <= 9; i++) { if (!taken.has(i)) { freeSeat = i; break; } }
    if (freeSeat < 0) return err('Kein freier Platz');

    // Create bot spieler row (service role bypasses RLS)
    const { data: botSpieler, error: e1 } = await db
      .from('spieler')
      .insert({ name, profilbild: config?.avatar ?? null, aktiv: false, ist_bot: true, ist_bank: false, ist_admin: false })
      .select().single();
    if (e1 || !botSpieler) return err('Bot-Spieler: ' + (e1?.message ?? 'unbekannt'));

    // Create seat
    const startStack = session.start_stack ?? 100;
    const { error: e2 } = await db.from('online_seats').insert({
      online_spiel_id,
      spieler_id: botSpieler.id,
      seat: freeSeat,
      stack: startStack,
      status: session.status === 'running' ? 'sitting_out' : 'active',
      buyins: 1,
      bet_current_round: 0,
      bot_config: config ?? {},
    });
    if (e2) {
      await db.from('spieler').delete().eq('id', botSpieler.id);
      return err('Seat-Insert: ' + e2.message);
    }

    // Mark session as having bots (disables statistics export)
    await db.from('online_spiele').update({ hat_bots: true }).eq('id', online_spiel_id);
    return json({ ok: true, bot_spieler_id: botSpieler.id, seat: freeSeat });
  }

  // ── REMOVE action ────────────────────────────────────────────────────────
  if (actionType === 'remove') {
    if (!bot_spieler_id) return err('bot_spieler_id fehlt');
    // Verify bot
    const { data: bot } = await db.from('spieler').select('ist_bot').eq('id', bot_spieler_id).single();
    if (!bot?.ist_bot) return err('Kein Bot', 403);
    const { data: seats } = await db.from('online_seats').select('*').eq('online_spiel_id', online_spiel_id).eq('spieler_id', bot_spieler_id);
    const seat = seats?.[0];
    if (seat) {
      if (seat.status === 'active') {
        const { data: sess } = await db.from('online_spiele').select('current_player_id,status').eq('id', online_spiel_id).single();
        if (sess?.status === 'running' && sess?.current_player_id === bot_spieler_id) {
          // Bot's turn – fold first
          await fetch(`${SUPABASE_URL}/functions/v1/poker-action`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SERVICE_KEY}` },
            body: JSON.stringify({ online_spiel_id, spieler_id: bot_spieler_id, action: 'fold' }),
          });
        }
      }
      await db.from('online_seats').delete().eq('id', seat.id);
    }
    await db.from('spieler').delete().eq('id', bot_spieler_id);
    return json({ ok: true, removed: true });
  }

  if (!bot_spieler_id) return err('bot_spieler_id fehlt');

  // Verify this is actually a bot
  const { data: bot } = await db.from('spieler').select('ist_bot,name').eq('id', bot_spieler_id).single();
  if (!bot?.ist_bot) return err('Kein Bot', 403);

  // Load session + all seats (service role bypasses hole_cards RLS)
  const [{ data: session }, { data: seats }] = await Promise.all([
    db.from('online_spiele').select('*').eq('id', online_spiel_id).single(),
    db.from('online_seats').select('*').eq('online_spiel_id', online_spiel_id).order('seat'),
  ]);

  if (!session) return err('Session nicht gefunden', 404);
  const mySeat = (seats ?? []).find((s: any) => s.spieler_id === bot_spieler_id);
  if (!mySeat) return err('Bot nicht am Tisch', 404);

  const config: BotConfig = mySeat.bot_config ?? {};

  // ── REVEAL action ───────────────────────────────────────────────────────
  if (actionType === 'reveal') {
    if (config.karten_zeigen === 'nie') return json({ ok: true, skipped: true });
    const holeCards: Card[] = mySeat.hole_cards ?? [];
    if (!holeCards.length) return json({ ok: true, skipped: true });
    await db.from('online_actions').insert({
      online_spiel_id,
      spieler_id: bot_spieler_id,
      action: 'reveal_cards',
      street: session.street,
      hand_nr: session.hand_nr,
      meta: { hole_cards: holeCards, facedown: false },
    });
    return json({ ok: true, revealed: holeCards.length });
  }

  // ── RUNOUT action ───────────────────────────────────────────────────────
  if (actionType === 'runout') {
    if (session.status === 'running') return json({ ok: true, skipped: 'still_running' });
    const resp = await fetch(`${SUPABASE_URL}/functions/v1/poker-reveal-runout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SERVICE_KEY}` },
      body: JSON.stringify({ online_spiel_id }),
    });
    const data = await resp.json().catch(() => ({}));
    return json({ ok: true, ...data });
  }

  // ── PLAY action ─────────────────────────────────────────────────────────
  if (session.status !== 'running') return err('Session laeuft nicht');
  if (session.current_player_id !== bot_spieler_id) return err('Nicht dran', 409);
  if (mySeat.status === 'folded' || mySeat.status === 'allin') return json({ ok: true, skipped: true });

  const holeCards: Card[] = mySeat.hole_cards ?? [];
  const board: Card[] = session.community_cards ?? [];

  const maxBet = Math.max(0, ...(seats ?? [])
    .filter((s: any) => s.status !== 'folded' && s.status !== 'sitting_out')
    .map((s: any) => s.bet_current_round ?? 0));
  const callAmount = Math.round((maxBet - (mySeat.bet_current_round ?? 0)) * 100) / 100;
  const pot = session.pot ?? 0;
  const myStack = mySeat.stack ?? 0;

  const decision = botDecide(config, holeCards, board, callAmount, pot, myStack);

  // Execute via poker-action
  const resp = await fetch(`${SUPABASE_URL}/functions/v1/poker-action`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SERVICE_KEY}` },
    body: JSON.stringify({
      online_spiel_id,
      spieler_id: bot_spieler_id,
      action: decision.action,
      amount: decision.amount,
    }),
  });
  const data = await resp.json().catch(() => ({}));

  // Occasionally add a chat comment (~25% chance)
  const comment = maybeBotComment(decision.action, config.style);
  if (comment) {
    await db.from('online_chat').insert({
      online_spiel_id,
      spieler_id: bot_spieler_id,
      message: comment,
    }).catch(() => {});
  }

  return json({ ok: true, decision, ...data });
});

// ── BOT DECISION ENGINE ─────────────────────────────────────────────────────

function botDecide(
  config: BotConfig,
  holeCards: Card[],
  board: Card[],
  callAmount: number,
  pot: number,
  myStack: number,
): { action: string; amount?: number } {
  const agg  = config.aggressivitaet ?? 50;
  const risk = config.risiko         ?? 50;
  const bluffRate = config.bluff     ?? 20;

  const isPre = board.length === 0;
  const strength = isPre ? preflopStrength(holeCards) : postflopStrength(holeCards, board);

  const bluffing = Math.random() * 100 < bluffRate;
  const effStr = bluffing ? Math.min(100, strength + 28) : strength;

  const potOdds = callAmount > 0 ? (callAmount / (pot + callAmount)) * 100 : 0;
  const rand = Math.random() * 100;

  if (callAmount <= 0) {
    if (effStr > 60 && rand < agg) {
      const betFrac = 0.35 + agg / 250;
      const betAmt = Math.round(Math.min(pot * betFrac, myStack) * 100) / 100;
      if (betAmt > 0) return { action: 'raise', amount: betAmt };
    }
    return { action: 'check' };
  }

  if (effStr > potOdds + 5) {
    if (effStr > 82 && rand < agg * 0.55) {
      const raiseAmt = Math.round(Math.min(callAmount * (2 + agg / 100), myStack) * 100) / 100;
      if (raiseAmt >= myStack * 0.92) return { action: 'allin' };
      if (raiseAmt > callAmount * 1.5) return { action: 'raise', amount: raiseAmt };
    }
    if (callAmount > myStack * (risk / 100) * 0.9) {
      if (effStr > 72) return { action: 'allin' };
      return { action: 'fold' };
    }
    return { action: 'call' };
  }

  return { action: 'fold' };
}

// ── HAND STRENGTH EVALUATORS ────────────────────────────────────────────────

function preflopStrength(cards: Card[]): number {
  if (cards.length < 2) return 50;
  const sorted = [...cards].sort((a, b) => b.rank - a.rank);
  const h = sorted[0], l = sorted[1];

  if (h.rank === l.rank) {
    if (h.rank >= 12) return 95;
    if (h.rank >= 9)  return 80;
    if (h.rank >= 6)  return 65;
    return 50;
  }

  const suited = h.suit === l.suit;
  const gap    = h.rank - l.rank;

  if (h.rank === 14) {
    if (l.rank === 13) return suited ? 90 : 85;
    if (l.rank === 12) return suited ? 78 : 68;
    if (l.rank >= 10)  return suited ? 72 : 62;
    return suited ? 52 : 40;
  }
  if (h.rank === 13 && l.rank === 12) return suited ? 72 : 62;
  if (gap <= 1 && l.rank >= 9)        return suited ? 62 : 52;
  if (gap <= 2 && suited)             return 47;
  return Math.max(15, 38 - gap * 5 + (suited ? 5 : 0));
}

function postflopStrength(hole: Card[], board: Card[]): number {
  const all   = [...hole, ...board];
  const ranks = all.map(c => c.rank);
  const suits = all.map(c => c.suit);

  const sc: Record<string, number> = {};
  suits.forEach(s => sc[s] = (sc[s] ?? 0) + 1);
  const hasFlush = Object.values(sc).some(v => v >= 5);

  const uniq = [...new Set(ranks)].sort((a, b) => b - a);
  let hasStraight = false;
  for (let i = 0; i <= uniq.length - 5; i++) {
    if (uniq[i] - uniq[i + 4] === 4) { hasStraight = true; break; }
  }
  if ([14, 2, 3, 4, 5].every(r => uniq.includes(r))) hasStraight = true;

  const rc: Record<number, number> = {};
  ranks.forEach(r => rc[r] = (rc[r] ?? 0) + 1);
  const cnts = Object.values(rc).sort((a, b) => b - a);

  if (hasFlush && hasStraight)                          return 98;
  if (cnts[0] === 4)                                    return 95;
  if (cnts[0] === 3 && (cnts[1] ?? 0) >= 2)            return 88;
  if (hasFlush)                                         return 80;
  if (hasStraight)                                      return 75;
  if (cnts[0] === 3)                                    return 65;
  if (cnts[0] === 2 && (cnts[1] ?? 0) === 2) {
    const pairRanks = Object.entries(rc).filter(e => e[1] >= 2).map(e => +e[0]);
    return (pairRanks.length > 0 && Math.max(...pairRanks) >= 10) ? 55 : 48;
  }
  if (cnts[0] === 2) {
    const prEntry = Object.entries(rc).find(e => e[1] === 2);
    const pr = prEntry ? +prEntry[0] : 2;
    return pr >= 10 ? 42 : 35;
  }
  return Math.min(25, Math.max(...ranks) - 2);
}

// ── BOT CHAT COMMENTS ────────────────────────────────────────────────────────

const BOT_COMMENTS: Record<string, string[]> = {
  fold: [
    'Passt.','Nicht heute.','Bin raus.','Naechstes Mal.','Zu heiss.',
    'Kein Interesse.','Nicht meine Hand.','Ich sehe mich raus.','Nicht wert.','Ciao.',
    'Weiter.','Zu teuer.','Nope.','Weg damit.','Nicht gut genug.',
    'Sparmasnahmen.','Nein danke.','Nicht diesmal.','Karten weg.','Ich passe.',
    'Nicht mit diesen.','Raus hier.','Zu riskant.','Spaeter vielleicht.','Kluge Entscheidung.',
  ],
  check: [
    'Check.','Sehen wir mal.','Kein Einsatz von mir.','Abgewartet.','Ich schaue zu.',
    'Frei zu mir.','Mal durchatmen.','Nichts von mir.','Check, bitte.','Kostenlos sehen.',
    'Weiter so.','Ich warte.','Guenstig weitermachen.','Check von mir.','Abwarten.',
    'Ok, check.','Mal schauen was kommt.','Nichts kostet nichts.','Gratis.','Ich pass erst mal.',
  ],
  call: [
    'Call.','Ich bin dabei.','Passt schon.','Mal schauen.','OK.',
    'Ich zahle.','Dabei.','Mitmachen.','Geht klar.','Ich komme mit.',
    'Bin drin.','Ich bleibe dabei.','Geht.','Na gut.','Ja, call.',
    'Ok, mitmachen.','Weiter.','Bezahl ich.','Call, danke.','Bin dabei.',
  ],
  raise: [
    'Erhoehe!','Jetzt wird es ernst.','Ich gehe hoeher.','Los.','Druckmittel.',
    'Mehr!','Nicht so guenstig.','Ich erhoehe.','Teurer fuer alle.','Raise von mir.',
    'Ich mache Druck.','Hoeher.','Hier ist mein Einsatz.','Ich sage: mehr.','Aufgewertet.',
    'Interessant? Jetzt schon.','Ich komme rein.','Mein Einsatz liegt.','Weiter – aber teurer.','Die Antwort: Raise.',
    'Ich sage nein zu guenstig.','Raise!','Macht es spannender.','Hoeherer Einsatz.','Ohne mich kein guenstiges Spiel.',
  ],
  allin: [
    'All-in!','Alles rein!','YOLO!','Jetzt oder nie.','Do or die.',
    'Alles auf eine Karte.','Ganz oder gar nicht.','Stack in die Mitte.','Ich bin all-in.','Alle meine Chips.',
    'Komplett rein.','All or nothing.','Mein ganzer Stack.','Rein damit.','Alle Chips.',
    'All-in, ihr.','So ist das jetzt.','Chips alle rein.','Ich bin komplett drin.','Alles riskiert.',
  ],
};

// Style-specific overrides (mixed in for personality flavour)
const BOT_COMMENTS_STYLE: Record<string, Partial<Record<string, string[]>>> = {
  nit: {
    fold:  ['Zu riskant.','Nicht diese Hand.','Vernunft siegt.','Ich passe.','Nicht mein Spiel.'],
    check: ['Vorsichtig.','Erstmal schauen.','Check, natuerlich.','Kein Risiko.'],
    raise: ['Nur wenn ich sicher bin.','Vorsichtiger Raise.','Mit Bedacht.'],
  },
  maniac: {
    fold:  ['Ausnahmsweise.','Nicht mal ich...','Das ist echt schlecht.'],
    raise: ['MEHR!','Immer raise!','Wer nicht wagt...','Ich bin nicht hier um zu warten.'],
    allin: ['Natuerlich!','Immer!','Jede Hand!','So spielt man das!','Ohne Zweifel.'],
    check: ['Nur diesmal.','Widerwillig.','Ich beobachte.'],
  },
  lag: {
    raise: ['Druck.','Ich bestimme das Tempo.','Mein Tisch.','Raise, immer raise.'],
    bluff_fold: ['Naechstes Mal.','War ein Versuch wert.'],
  },
  station: {
    call:  ['Call, wie immer.','Natuerlich dabei.','Ich zahle das.','Bin doch dabei.','Call, danke.'],
    fold:  ['Das ist selten.','Ausnahmsfall.'],
  },
};

function maybeBotComment(action: string, style?: string): string | null {
  if (Math.random() > 0.25) return null;
  // 30% chance to use style-specific comment if available
  if (style && Math.random() < 0.30) {
    const stylePool = BOT_COMMENTS_STYLE[style]?.[action];
    if (stylePool?.length) return stylePool[Math.floor(Math.random() * stylePool.length)];
  }
  const opts = BOT_COMMENTS[action] ?? BOT_COMMENTS.check;
  return opts[Math.floor(Math.random() * opts.length)];
}
