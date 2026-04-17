// DTKS Poker – Edge Function: poker-new-hand
// Startet die nächste Hand. Wird NUR auf expliziten Knopfdruck ausgelöst –
// kein Auto-Start! Der Dealer-Button-Spieler (oder Admin) drückt den Button.
//
// POST Body:
//   { online_spiel_id: string, spieler_id: string }
//
// Validierung: nur Dealer-Button-Spieler oder Admin darf starten.

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

  const [{ data: session }, { data: seats }, { data: spieler }] = await Promise.all([
    db.from('online_spiele').select('*').eq('id', online_spiel_id).single(),
    db.from('online_seats').select('*').eq('online_spiel_id', online_spiel_id).order('seat'),
    db.from('spieler').select('ist_admin').eq('id', spieler_id).single(),
  ]);

  if (!session) return err('Session nicht gefunden', 404);

  // Wer darf starten: Dealer-Button-Spieler oder Admin
  const dealerSeat = seats?.find((s: { seat: number }) => s.seat === session.dealer_seat);
  const isDealer = dealerSeat?.spieler_id === spieler_id;
  const isAdmin = spieler?.ist_admin === true;

  if (!isDealer && !isAdmin) {
    return err('Nur der Dealer-Button-Spieler oder ein Admin kann die nächste Hand starten', 403);
  }

  // Spieler ohne Stack eliminieren (busted), paused → sitting_out
  const bustsAndPaused = (seats ?? []).filter(
    (s: { stack: number; status: string }) => s.stack === 0 || s.status === 'paused'
  );
  for (const s of bustsAndPaused) {
    await db.from('online_seats').update({ status: 'sitting_out' }).eq('id', s.id);
  }

  // Noch genug Spieler?
  const activeSeatCount = (seats ?? []).filter(
    (s: { stack: number; status: string }) => s.stack > 0 && s.status !== 'paused'
  ).length;
  if (activeSeatCount < 2) return err('Nicht genug aktive Spieler für eine neue Hand');

  // poker-start-game delegieren (übernimmt Dealer-Button-Weitersetzen, Karten austeilen, etc.)
  const startRes = await fetch(`${SUPABASE_URL}/functions/v1/poker-start-game`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SERVICE_KEY}`,
    },
    body: JSON.stringify({ online_spiel_id }),
  });

  const startData = await startRes.json();
  if (!startRes.ok) return json(startData, startRes.status);

  return json({ ok: true, new_hand: true, hand_nr: session.hand_nr + 1, ...startData });
});
