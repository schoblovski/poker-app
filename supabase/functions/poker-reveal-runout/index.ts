// DTKS Poker – Edge Function: poker-reveal-runout
// Deckt die restlichen Community Cards nach einem Hand-Ende durch Fold auf.
// "Was wäre noch gekommen?" – rein informell, kein Einfluss auf Ergebnis.
//
// POST Body:
//   { online_spiel_id: string, spieler_id: string }
//
// Berechtigung:
//   - Normalfall: Dealer-Button-Spieler
//   - Falls Dealer pausiert: jeder aktive Spieler

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { CORS, corsOk, json, err } from '../poker-utils/index.ts';

const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return corsOk();

  const db = createClient(SUPABASE_URL, SERVICE_KEY);

  let body: { online_spiel_id: string; spieler_id: string };
  try { body = await req.json(); }
  catch { return err('Invalid JSON'); }

  const { online_spiel_id, spieler_id } = body;
  if (!online_spiel_id || !spieler_id) return err('Fehlende Parameter');

  const [{ data: session }, { data: seats }, { data: deckRow }] = await Promise.all([
    db.from('online_spiele').select('*').eq('id', online_spiel_id).single(),
    db.from('online_seats').select('*').eq('online_spiel_id', online_spiel_id).order('seat'),
    db.from('online_decks').select('deck').eq('id', online_spiel_id).single(),
  ]);

  if (!session) return err('Session nicht gefunden', 404);
  if (!deckRow) return err('Kein Deck gespeichert – Runout nicht möglich', 404);

  // Runout bereits aufgedeckt?
  if (session.runout_cards !== null) return err('Runout wurde bereits aufgedeckt');

  // Berechtigung prüfen
  const dealerSeat = seats?.find((s: { seat: number }) => s.seat === session.dealer_seat);
  const dealerIsActive = dealerSeat && dealerSeat.status !== 'paused' && dealerSeat.status !== 'sitting_out';

  if (dealerIsActive) {
    // Nur Dealer-Button-Spieler darf
    if (dealerSeat.spieler_id !== spieler_id) {
      return err('Nur der Dealer-Button-Spieler darf die Karten aufdecken', 403);
    }
  } else {
    // Dealer pausiert → jeder aktive Spieler darf
    const requestingPlayer = seats?.find((s: { spieler_id: string }) => s.spieler_id === spieler_id);
    if (!requestingPlayer || requestingPlayer.status === 'paused' || requestingPlayer.status === 'sitting_out') {
      return err('Nur aktive Spieler dürfen die Karten aufdecken', 403);
    }
  }

  // Fehlende Board-Karten aus dem Deck holen
  const currentBoardCount = (session.community_cards ?? []).length;
  const missingCount = 5 - currentBoardCount;

  if (missingCount <= 0) {
    return err('Board ist bereits vollständig aufgedeckt');
  }

  const deck = deckRow.deck as { rank: number; suit: string }[];
  const runoutCards = deck.slice(0, missingCount);

  await Promise.all([
    db.from('online_spiele').update({ runout_cards: runoutCards }).eq('id', online_spiel_id),
    db.from('online_actions').insert({
      online_spiel_id,
      spieler_id,
      action: 'reveal_runout',
      street: session.street,
      hand_nr: session.hand_nr,
    }),
  ]);

  return json({
    ok: true,
    runout_cards: runoutCards,
    full_board: [...(session.community_cards ?? []), ...runoutCards],
  });
});
