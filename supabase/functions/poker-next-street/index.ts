// DTKS Poker – Edge Function: poker-next-street
// Deckt Flop / Turn / River auf. Wird von poker-action aufgerufen
// wenn eine Betting-Round abgeschlossen ist.
//
// POST Body: { online_spiel_id: string }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { CORS, corsOk, json, err } from '../poker-utils/index.ts';

const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';

const STREET_ORDER = ['preflop', 'flop', 'turn', 'river'];
const STREET_CARDS: Record<string, number> = { preflop: 3, flop: 1, turn: 1 };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return corsOk();

  const db = createClient(SUPABASE_URL, SERVICE_KEY);

  let body: { online_spiel_id: string };
  try { body = await req.json(); }
  catch { return err('Invalid JSON'); }

  const { online_spiel_id } = body;
  if (!online_spiel_id) return err('online_spiel_id required');

  const [{ data: session }, { data: deckRow }, { data: seats }] = await Promise.all([
    db.from('online_spiele').select('*').eq('id', online_spiel_id).single(),
    db.from('online_decks').select('deck').eq('id', online_spiel_id).single(),
    db.from('online_seats').select('*').eq('online_spiel_id', online_spiel_id).order('seat'),
  ]);

  if (!session) return err('Session nicht gefunden', 404);
  if (!deckRow) return err('Deck nicht gefunden', 500);

  const currentStreetIdx = STREET_ORDER.indexOf(session.street);
  const nextStreet = STREET_ORDER[currentStreetIdx + 1];

  // Nach River → Showdown
  if (!nextStreet || session.street === 'river') {
    const showdownRes = await fetch(`${SUPABASE_URL}/functions/v1/poker-showdown`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SERVICE_KEY}` },
      body: JSON.stringify({ online_spiel_id }),
    });
    return showdownRes;
  }

  const newCards = (deckRow.deck as { rank: number; suit: string }[]).slice(0, STREET_CARDS[session.street]);
  const remainingDeck = (deckRow.deck as { rank: number; suit: string }[]).slice(STREET_CARDS[session.street]);
  const newCommunity = [...(session.community_cards ?? []), ...newCards];

  // Alle Spieler-Einsätze zurücksetzen (auch gefoldete), Dealer-Button-Sitz finden
  const activeSeatIds = (seats ?? [])
    .filter((s: { status: string }) => s.status !== 'sitting_out')
    .map((s: { id: string }) => s.id);

  // Erster Spieler nach Dealer der noch aktiv ist
  const dealerIdx = (seats ?? []).findIndex((s: { seat: number }) => s.seat === session.dealer_seat);
  const firstToAct = findFirstActiveAfter(seats ?? [], dealerIdx);
  const firstToActIdx = firstToAct ? (seats ?? []).findIndex((s: { id: string }) => s.id === firstToAct.id) : -1;
  // Letzter Akteur der neuen Straße = aktiver Spieler direkt vor dem ersten Akteur
  const lastToAct = firstToActIdx >= 0 ? findPrevActivePlayer(seats ?? [], firstToActIdx) : null;
  const newStreetLastActorId = lastToAct?.spieler_id ?? null;

  // Kein weiteres Bieten mehr möglich: alle all-in, oder nur noch 1 aktiver Spieler
  // (der könnte nur noch checken – direkt alle restlichen Karten aufdecken und Showdown)
  const stillActive = (seats ?? []).filter((s: { status: string }) => s.status === 'active' || s.status === 'paused');
  const runItOut = stillActive.length <= 1;

  if (runItOut) {
    // Alle restlichen Community Cards sofort aufdecken
    const allNewCards = remainingDeck.slice(0, 5 - newCommunity.length);
    const fullBoard = [...newCommunity, ...allNewCards];

    await Promise.all([
      db.from('online_spiele').update({
        street: 'river',
        community_cards: fullBoard,
        current_player_id: null,
      }).eq('id', online_spiel_id),
      db.from('online_decks').update({ deck: remainingDeck.slice(allNewCards.length) }).eq('id', online_spiel_id),
      // Einsätze zurücksetzen (für sauberen Showdown-State)
      ...activeSeatIds.map((id: string) =>
        db.from('online_seats').update({ bet_current_round: 0 }).eq('id', id)
      ),
    ]);

    // Showdown auslösen
    const showdownRes = await fetch(`${SUPABASE_URL}/functions/v1/poker-showdown`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SERVICE_KEY}` },
      body: JSON.stringify({ online_spiel_id }),
    });
    return showdownRes;
  }

  await Promise.all([
    // Community Cards aktualisieren
    db.from('online_spiele').update({
      street: nextStreet,
      community_cards: newCommunity,
      current_player_id: firstToAct?.spieler_id ?? null,
      street_last_actor_id: newStreetLastActorId,
    }).eq('id', online_spiel_id),

    // Deck aktualisieren
    db.from('online_decks').update({ deck: remainingDeck }).eq('id', online_spiel_id),

    // Einsätze zurücksetzen für aktive Spieler
    ...activeSeatIds.map((id: string) =>
      db.from('online_seats').update({ bet_current_round: 0 }).eq('id', id)
    ),
  ]);

  if (firstToAct) {
    await notifyPlayer(db, firstToAct.spieler_id, online_spiel_id);

    // If first to act is paused, trigger their pause auto-action.
    // On a new street all bets are reset to 0, so callAmount is always 0 here.
    if (firstToAct.status === 'paused') {
      const paa = (firstToAct as { pause_auto_action?: string }).pause_auto_action;
      let autoAct: string | null = null;
      if (paa === 'fold') autoAct = 'fold';
      else if (paa === 'check' || paa === 'call_limit' || paa === 'call_any') autoAct = 'check';
      if (autoAct) {
        await fetch(`${SUPABASE_URL}/functions/v1/poker-action`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SERVICE_KEY}` },
          body: JSON.stringify({ online_spiel_id, spieler_id: firstToAct.spieler_id, action: autoAct }),
        });
      }
    }
  }

  return json({ ok: true, street: nextStreet, new_cards: newCards });
});

function findFirstActiveAfter(seats: { spieler_id: string; status: string }[], fromIdx: number) {
  const n = seats.length;
  for (let i = 1; i <= n; i++) {
    const s = seats[(fromIdx + i) % n];
    if (s.status === 'active' || s.status === 'paused') return s;
  }
  return null;
}

function findPrevActivePlayer(seats: { spieler_id: string; status: string }[], fromIdx: number) {
  const n = seats.length;
  for (let i = 1; i <= n; i++) {
    const s = seats[(fromIdx - i + n) % n];
    if (s.status === 'active' || s.status === 'paused') return s;
  }
  return null;
}

async function notifyPlayer(db: ReturnType<typeof createClient>, spieler_id: string, online_spiel_id: string) {
  try {
    await fetch(`${SUPABASE_URL}/functions/v1/send-push`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SERVICE_KEY}` },
      body: JSON.stringify({
        spieler_ids: [spieler_id],
        title: 'Du bist dran!',
        body: 'Neue Karten aufgedeckt – dein Zug.',
        kategorie: 'online_spiel',
        data: { url: `/#online-tisch?session=${online_spiel_id}`, tag: 'online_turn' },
      }),
    });
  } catch { /* nicht kritisch */ }
}
