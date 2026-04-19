// DTKS Poker – Edge Function: poker-new-hand
// Startet die nächste Hand. Wird NUR auf expliziten Knopfdruck ausgelöst –
// kein Auto-Start! Jeder aktive Mitspieler am Tisch darf den Button drücken.
//
// POST Body:
//   { online_spiel_id: string, spieler_id: string }

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

  const [{ data: session }, { data: seats }] = await Promise.all([
    db.from('online_spiele').select('*').eq('id', online_spiel_id).single(),
    db.from('online_seats').select('*').eq('online_spiel_id', online_spiel_id).order('seat'),
  ]);

  if (!session) return err('Session nicht gefunden', 404);

  // Jeder Spieler am Tisch darf die nächste Hand starten
  const callerSeat = seats?.find((s: { spieler_id: string }) => s.spieler_id === spieler_id);
  if (!callerSeat) return err('Du bist nicht an diesem Tisch', 403);

  // Bots: auto-buyin if stack=0, promote sitting_out bots with chips
  for (const s of (seats ?? []) as any[]) {
    if (!s.bot_config) continue;
    if (s.stack === 0) {
      await db.from('online_seats').update({
        stack: session.start_stack ?? 100,
        buyins: (s.buyins ?? 1) + 1,
        status: 'active',
      }).eq('id', s.id);
      s.stack = session.start_stack ?? 100; s.status = 'active';
    } else if (s.status === 'sitting_out') {
      await db.from('online_seats').update({ status: 'active' }).eq('id', s.id);
      s.status = 'active';
    }
  }

  // Spieler ohne Stack eliminieren (busted), paused → sitting_out
  const bustsAndPaused = (seats ?? []).filter(
    (s: { stack: number; status: string; bot_config?: unknown }) => !s.bot_config && (s.stack === 0 || s.status === 'paused')
  );
  const bustIds = new Set(bustsAndPaused.map((s: { id: string }) => s.id));
  for (const s of bustsAndPaused) {
    await db.from('online_seats').update({ status: 'sitting_out' }).eq('id', s.id);
  }

  // Genug Spieler? Zähle nur Spieler die tatsächlich mitspielen:
  // - nicht gerade auf sitting_out gesetzt (busted/paused)
  // - nicht bereits sitting_out
  // - haben Chips
  const activeSeatCount = (seats ?? []).filter(
    (s: { id: string; stack: number; status: string }) =>
      !bustIds.has(s.id) && s.status !== 'sitting_out' && s.stack > 0
  ).length;
  if (activeSeatCount < 2) {
    const totalAtTable = (seats ?? []).filter((s: { status: string }) => s.status !== 'sitting_out').length;
    if (totalAtTable >= 2) {
      return err('Nicht genug Spieler mit Chips – bitte zuerst einen neuen Buy-In kaufen');
    }
    return err('Nicht genug aktive Spieler für eine neue Hand');
  }

  const newHandNr = (session.hand_nr ?? 0) + 1;

  // Action-Log zuerst einfügen damit Runden-Trennlinie im Feed vor den Blinds erscheint
  await db.from('online_actions').insert({
    online_spiel_id,
    spieler_id,
    action: 'new_hand',
    street: 'preflop',
    hand_nr: newHandNr,
  });

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

  return json({ ok: true, new_hand: true, hand_nr: newHandNr, ...startData });
});
