// DTKS Poker – Edge Function: poker-start-game
// Startet eine neue Online-Session oder eine neue Hand innerhalb einer Session.
//
// POST Body:
//   { online_spiel_id: string }  – startet erste Hand einer bestehenden Session
//
// Ablauf:
//   1. Session + Sitze laden
//   2. Deck mischen, Karten austeilen (2 oder 4 je nach Variante)
//   3. Dealer/SB/BB setzen
//   4. Spielzustand auf 'running' / street='preflop' setzen
//   5. Push Notification an ersten Spieler (UTG)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  buildDeck, shuffle, CORS, corsOk, json, err,
  type Card,
} from '../poker-utils/index.ts';

const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return corsOk();

  const db = createClient(SUPABASE_URL, SERVICE_KEY);

  let body: { online_spiel_id: string };
  try { body = await req.json(); }
  catch { return err('Invalid JSON'); }

  const { online_spiel_id } = body;
  if (!online_spiel_id) return err('online_spiel_id required');

  // Session laden
  const { data: session, error: sErr } = await db
    .from('online_spiele')
    .select('*')
    .eq('id', online_spiel_id)
    .single();
  if (sErr || !session) return err('Session nicht gefunden', 404);
  if (session.status === 'finished') return err('Session bereits beendet');

  // Aktive Sitze laden (nicht sitting_out)
  const { data: seats, error: seErr } = await db
    .from('online_seats')
    .select('*')
    .eq('online_spiel_id', online_spiel_id)
    .neq('status', 'sitting_out')
    .order('seat');
  if (seErr || !seats || seats.length < 2) return err('Mindestens 2 Spieler erforderlich');

  // Deck mischen
  const deck = shuffle(buildDeck());

  // Karten austeilen (2 für holdem, 4 für omaha/texahma)
  const holeCount = session.variante === 'holdem' ? 2 : 4;
  const holeCards: Record<string, Card[]> = {};
  let deckIdx = 0;

  for (const seat of seats) {
    holeCards[seat.id] = [];
    for (let i = 0; i < holeCount; i++) {
      holeCards[seat.id].push(deck[deckIdx++]);
    }
  }

  // Dealer-Button bestimmen (erste Hand: Sitz 1, sonst nächster aktiver Sitz)
  const currentDealer = session.dealer_seat ?? 0;
  const seatNums = seats.map((s: { seat: number }) => s.seat);
  const nextDealerIdx = seatNums.findIndex((s: number) => s > currentDealer) === -1
    ? 0
    : seatNums.findIndex((s: number) => s > currentDealer);
  const dealerSeat = seatNums[nextDealerIdx];

  // SB = nächster nach Dealer, BB = übernächster
  const sbIdx = (nextDealerIdx + 1) % seats.length;
  const bbIdx = (nextDealerIdx + 2) % seats.length;
  const utgIdx = (nextDealerIdx + 3) % seats.length;

  const sbSeat = seats[sbIdx];
  const bbSeat = seats[bbIdx];
  const utgSeat = seats[utgIdx] ?? seats[sbIdx]; // heads-up fallback

  // Blinds aus spiel_teilnehmer / einstellungen laden
  // Für Online-Modus: SB = 1 Unit, BB = 2 Units (Stack-basiert, kein €-Bezug nötig)
  // Die tatsächliche Blind-Höhe wird beim Session-Start festgelegt (small_blind Feld)
  // Hier nehmen wir Standardwerte aus der Session (werden beim Erstellen gesetzt)
  const smallBlind: number = session.small_blind ?? 1;
  const bigBlind: number = session.big_blind ?? (smallBlind * 2);

  // Stacks für Blinds abziehen
  const sbStack = Math.max(0, sbSeat.stack - smallBlind);
  const bbStack = Math.max(0, bbSeat.stack - bigBlind);

  // Transaktionen: Deck speichern (service role only)
  const ops = await Promise.all([
    // Deck speichern
    db.from('online_decks').upsert({ id: online_spiel_id, deck: deck.slice(deckIdx) }),

    // Hole Cards speichern
    ...Object.entries(holeCards).map(([seatId, cards]) =>
      db.from('online_seat_cards').upsert({ seat_id: seatId, hole_cards: cards })
    ),

    // Alle Sitze auf active/folded resetten + Stacks für Blinds
    ...seats.map((seat: { id: string; stack: number }) => {
      let stack = seat.stack;
      let bet = 0;
      if (seat.id === sbSeat.id) { stack = sbStack; bet = smallBlind; }
      if (seat.id === bbSeat.id) { stack = bbStack; bet = bigBlind; }
      return db.from('online_seats').update({
        status: 'active',
        bet_current_round: bet,
        auto_folded: false,
        pre_action: null,
        pre_action_limit: null,
        stack,
      }).eq('id', seat.id);
    }),

    // Spielzustand aktualisieren
    db.from('online_spiele').update({
      status: 'running',
      street: 'preflop',
      community_cards: [],
      runout_cards: null,
      pot: smallBlind + bigBlind,
      dealer_seat: dealerSeat,
      current_player_id: utgSeat.spieler_id,
      hand_nr: (session.hand_nr ?? 0) + 1,
    }).eq('id', online_spiel_id),
  ]);

  const failed = ops.find(r => r.error);
  if (failed?.error) return err(`DB-Fehler: ${failed.error.message}`, 500);

  // Action-Log: Blinds eintragen
  await db.from('online_actions').insert([
    {
      online_spiel_id,
      spieler_id: sbSeat.spieler_id,
      action: 'blind',
      amount: smallBlind,
      street: 'preflop',
      hand_nr: (session.hand_nr ?? 0) + 1,
    },
    {
      online_spiel_id,
      spieler_id: bbSeat.spieler_id,
      action: 'blind',
      amount: bigBlind,
      street: 'preflop',
      hand_nr: (session.hand_nr ?? 0) + 1,
    },
  ]);

  // Push Notification an UTG (erster Spieler nach BB)
  await notifyPlayer(db, utgSeat.spieler_id, online_spiel_id);

  return json({ ok: true, dealer_seat: dealerSeat, utg_spieler_id: utgSeat.spieler_id });
});

async function notifyPlayer(db: ReturnType<typeof createClient>, spieler_id: string, online_spiel_id: string) {
  try {
    await fetch(`${SUPABASE_URL}/functions/v1/send-push`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SERVICE_KEY}`,
      },
      body: JSON.stringify({
        spieler_ids: [spieler_id],
        title: 'Du bist dran!',
        body: 'Fold, Call oder Raise – dein Zug.',
        kategorie: 'online_spiel',
        data: { url: `/online/${online_spiel_id}`, tag: 'online_turn' },
      }),
    });
  } catch { /* Push-Fehler sind nicht kritisch */ }
}
