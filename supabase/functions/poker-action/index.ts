// DTKS Poker – Edge Function: poker-action
// Verarbeitet eine Spieler-Aktion (fold/check/call/raise/allin/pause/resume).
//
// POST Body:
//   {
//     online_spiel_id: string,
//     spieler_id:      string,
//     action:          'fold' | 'check' | 'call' | 'raise' | 'allin' | 'pause' | 'resume',
//     amount?:         number,   // bei raise: Gesamteinsatz (nicht nur die Erhöhung)
//     pause_auto_action?: 'fold' | 'check' | 'call_limit' | 'call_any',
//     pause_call_limit?:  number,
//   }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { CORS, corsOk, json, err } from '../poker-utils/index.ts';

const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return corsOk();
  try {

  const db = createClient(SUPABASE_URL, SERVICE_KEY);

  let body: {
    online_spiel_id: string;
    spieler_id: string;
    action: string;
    amount?: number;
    pause_auto_action?: string;
    pause_call_limit?: number;
  };
  try { body = await req.json(); }
  catch { return err('Invalid JSON'); }

  const { online_spiel_id, spieler_id, action, amount } = body;
  if (!online_spiel_id || !spieler_id || !action) return err('Fehlende Parameter');

  // Session + Sitze laden
  const [{ data: session }, { data: seats }] = await Promise.all([
    db.from('online_spiele').select('*').eq('id', online_spiel_id).single(),
    db.from('online_seats').select('*').eq('online_spiel_id', online_spiel_id).order('seat'),
  ]);

  if (!session) return err('Session nicht gefunden', 404);

  // leave_permanent works in any session state (waiting/running/finished)
  if (action === 'leave_permanent') {
    const seat = (seats || []).find((s: { spieler_id: string }) => s.spieler_id === spieler_id);
    if (seat) {
      await db.from('online_seat_cards').delete().eq('seat_id', seat.id);
      await db.from('online_seats').delete().eq('id', seat.id);
      if ((session.hand_nr ?? 0) > 0) {
        await db.from('online_actions').insert({
          online_spiel_id, spieler_id, action: 'leave_permanent',
          street: session.street ?? null, hand_nr: session.hand_nr ?? 0,
        });
      }
    }
    return json({ ok: true });
  }

  if (session.status !== 'running') return err('Session läuft nicht');

  const mySeat = seats?.find((s: { spieler_id: string }) => s.spieler_id === spieler_id);
  if (!mySeat) return err('Spieler nicht am Tisch', 403);

  // ── Pause / Resume ───────────────────────────────────────
  if (action === 'pause') {
    await db.from('online_seats').update({
      status: 'paused',
      paused_at: new Date().toISOString(),
      pause_auto_action: body.pause_auto_action ?? 'fold',
      pause_call_limit: body.pause_call_limit ?? null,
    }).eq('id', mySeat.id);

    await db.from('online_actions').insert({
      online_spiel_id, spieler_id, action: 'pause',
      street: session.street, hand_nr: session.hand_nr,
    });

    // Falls dieser Spieler gerade dran ist: Auto-Aktion ausführen
    if (session.current_player_id === spieler_id) {
      return handleAutoAction(db, session, seats, mySeat, body.pause_auto_action ?? 'fold', body.pause_call_limit);
    }
    return json({ ok: true, paused: true });
  }

  if (action === 'resume') {
    await db.from('online_seats').update({
      status: 'active',
      paused_at: null,
      pause_auto_action: 'fold',
      pause_call_limit: null,
    }).eq('id', mySeat.id);

    await db.from('online_actions').insert({
      online_spiel_id, spieler_id, action: 'resume',
      street: session.street, hand_nr: session.hand_nr,
    });
    return json({ ok: true, resumed: true });
  }

  // ── Prüfen ob Spieler dran ist ───────────────────────────
  if (session.current_player_id !== spieler_id) {
    // Pre-Action speichern
    if (['fold', 'check_fold', 'check', 'call', 'call_any'].includes(action)) {
      await db.from('online_seats').update({
        pre_action: action,
        pre_action_limit: amount ?? null,
      }).eq('id', mySeat.id);
      return json({ ok: true, pre_action_saved: true });
    }
    return err('Nicht dein Zug', 403);
  }

  if (mySeat.status === 'folded' || mySeat.status === 'allin') return err('Du bist nicht mehr aktiv');

  // Höchster aktueller Einsatz in der Runde (nur nicht-gefoldete Spieler)
  const maxBet = Math.max(0, ...(seats ?? [])
    .filter((s: { status: string }) => s.status !== 'folded' && s.status !== 'sitting_out')
    .map((s: { bet_current_round: number }) => s.bet_current_round));
  const callAmount = Math.round((maxBet - mySeat.bet_current_round) * 100) / 100;

  // ── Aktion verarbeiten ───────────────────────────────────
  let newStack = mySeat.stack;
  let newBet = mySeat.bet_current_round;
  let newStatus = mySeat.status;
  let newPot = session.pot;
  let logAmount: number | null = null;

  switch (action) {
    case 'fold':
      newStatus = 'folded';
      break;

    case 'check':
      if (callAmount > 0) return err('Check nicht möglich – es gibt einen Einsatz');
      break;

    case 'call': {
      const toCall = Math.round(Math.min(callAmount, mySeat.stack) * 100) / 100;
      newStack = Math.round((mySeat.stack - toCall) * 100) / 100;
      newBet = Math.round((mySeat.bet_current_round + toCall) * 100) / 100;
      newPot = Math.round((session.pot + toCall) * 100) / 100;
      logAmount = toCall;
      if (newStack <= 0) { newStack = 0; newStatus = 'allin'; }
      break;
    }

    case 'raise': {
      // amount = zusätzliche Chips (raise UM, nicht AUF)
      if (!amount || amount <= 0) return err('Raise-Betrag muss positiv sein');
      // Enforce 0.05 step (smallest unit)
      const raiseAmt = Math.round(amount * 20) / 20;
      if (raiseAmt > mySeat.stack) return err('Nicht genug Chips');
      const newTotalBet = mySeat.bet_current_round + raiseAmt;
      if (newTotalBet <= maxBet) return err('Raise muss höher als aktueller Einsatz sein');
      newStack = Math.round((mySeat.stack - raiseAmt) * 100) / 100;
      newBet = Math.round(newTotalBet * 100) / 100;
      newPot = Math.round((session.pot + raiseAmt) * 100) / 100;
      logAmount = raiseAmt;
      if (newStack <= 0) { newStack = 0; newStatus = 'allin'; }
      break;
    }

    case 'allin': {
      // Effektiven All-in-Betrag berechnen: maximal was Gegner zusammen decken können.
      // Überschuss hat niemand der matchen kann → sofort zurück in den Stack.
      const opponents = (seats ?? []).filter(
        (s: { id: string; status: string }) =>
          s.id !== mySeat.id && s.status !== 'folded' && s.status !== 'sitting_out'
      );
      const maxOpponentTotal = opponents.length > 0
        ? Math.max(...opponents.map((s: { bet_current_round: number; stack: number }) => s.bet_current_round + s.stack))
        : mySeat.bet_current_round + mySeat.stack;
      const effectiveTotalBet = Math.min(mySeat.bet_current_round + mySeat.stack, maxOpponentTotal);
      const effectiveAdditional = Math.max(0, effectiveTotalBet - mySeat.bet_current_round);
      newBet = Math.round(effectiveTotalBet * 100) / 100;
      newPot = Math.round((session.pot + effectiveAdditional) * 100) / 100;
      newStack = Math.round((mySeat.stack - effectiveAdditional) * 100) / 100;
      if (newStack < 0) newStack = 0;
      newStatus = 'allin';
      logAmount = Math.round(effectiveAdditional * 100) / 100;
      break;
    }

    default:
      return err(`Unbekannte Aktion: ${action}`);
  }

  // Seat aktualisieren
  await db.from('online_seats').update({
    stack: newStack,
    bet_current_round: newBet,
    status: newStatus,
    pre_action: null,
    pre_action_limit: null,
  }).eq('id', mySeat.id);

  // Action loggen (call/raise/bet der den Stack aufbraucht → als allin loggen)
  const logAction = (newStatus === 'allin' && (action === 'call' || action === 'raise' || action === 'bet')) ? 'allin' : action;
  await db.from('online_actions').insert({
    online_spiel_id, spieler_id,
    action: logAction, amount: logAmount,
    street: session.street, hand_nr: session.hand_nr,
  });

  // Aktualisierte Sitze berechnen
  const updatedSeats = (seats ?? []).map((s: { id: string; status: string; bet_current_round: number }) =>
    s.id === mySeat.id ? { ...s, status: newStatus, bet_current_round: newBet } : s
  );

  // Nicht gefoldete, nicht sitting_out Spieler
  const nonFolded = updatedSeats.filter((s: { status: string }) =>
    s.status !== 'folded' && s.status !== 'sitting_out'
  );

  // Nur noch einer übrig → Hand vorbei (alle anderen gefoldet)
  if (nonFolded.length === 1) {
    const winner = nonFolded[0];
    await Promise.all([
      db.from('online_seats').update({ stack: winner.stack + newPot }).eq('id', winner.id),
      db.from('online_spiele').update({ pot: 0, current_player_id: null }).eq('id', online_spiel_id),
    ]);

    await db.from('online_actions').insert({
      online_spiel_id,
      spieler_id: winner.spieler_id,
      action: 'win',
      amount: newPot,
      street: session.street,
      hand_nr: session.hand_nr,
    });

    return json({ ok: true, hand_over: true, winner_id: winner.spieler_id });
  }

  // Ist dies ein Raise (erhöht den Maximaleinsatz)?
  const isRaise = action === 'raise' || (action === 'allin' && newBet > maxBet);

  // street_last_actor_id aktualisieren bei Raise
  const myIdx = updatedSeats.findIndex((s: { spieler_id: string }) => s.spieler_id === spieler_id);
  let newStreetLastActorId: string | null = session.street_last_actor_id ?? null;

  if (isRaise) {
    // Nach einem Raise: letzter Akteur = Spieler direkt vor dem Raiser (im Uhrzeigersinn)
    const newLastActor = findPrevActivePlayer(updatedSeats, myIdx);
    if (newLastActor) newStreetLastActorId = newLastActor.spieler_id;
  }

  // Pot aktualisieren + ggf. street_last_actor_id
  const sessionUpdate: Record<string, unknown> = { pot: newPot };
  if (newStreetLastActorId !== session.street_last_actor_id) {
    sessionUpdate.street_last_actor_id = newStreetLastActorId;
  }
  await db.from('online_spiele').update(sessionUpdate).eq('id', online_spiel_id);

  // Aktive Spieler (können noch bieten: status = active oder paused)
  const bettingActive = updatedSeats.filter((s: { status: string }) =>
    s.status === 'active' || s.status === 'paused'
  );

  // Sind alle Einsätze gleich hoch? (exkl. All-in-Spieler die weniger gezahlt haben)
  const maxBetAll = Math.max(0, ...nonFolded.map((s: { bet_current_round: number }) => s.bet_current_round));
  const allEqual = bettingActive.length === 0 ||
    bettingActive.every((s: { bet_current_round: number }) => s.bet_current_round === maxBetAll);

  // Ist der aktuelle Spieler der letzte Akteur dieser Runde?
  const isLastActor = spieler_id === newStreetLastActorId;

  // Fallback: designierter letzter Akteur ist nicht mehr im Spiel (gefoldet/allin)
  const lastActorStillBetting = bettingActive.some(
    (s: { spieler_id: string }) => s.spieler_id === newStreetLastActorId
  );

  // Runde vorbei wenn: kein Raise UND alle gleich UND (letzter Akteur war dran ODER er ist nicht mehr aktiv)
  const roundOver = !isRaise && allEqual && (isLastActor || !lastActorStillBetting);

  // Alle all-in (kein weiteres Bieten möglich) bei mehr als 1 Spieler
  const allAllin = bettingActive.length === 0 && nonFolded.length > 1;

  if (roundOver || allAllin) {
    // Nächste Straße aufdecken
    const nextStreetRes = await fetch(`${SUPABASE_URL}/functions/v1/poker-next-street`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SERVICE_KEY}` },
      body: JSON.stringify({ online_spiel_id }),
    });
    const nextStreetData = await nextStreetRes.json().catch(() => ({}));
    return json({ ok: true, street_over: true, ...nextStreetData });
  }

  // Nächsten Spieler bestimmen
  const nextPlayer = findNextActivePlayer(updatedSeats, myIdx);

  if (!nextPlayer) {
    // Kein weiterer aktiver Spieler → Nächste Straße
    const nextStreetRes = await fetch(`${SUPABASE_URL}/functions/v1/poker-next-street`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SERVICE_KEY}` },
      body: JSON.stringify({ online_spiel_id }),
    });
    const nextStreetData = await nextStreetRes.json().catch(() => ({}));
    return json({ ok: true, street_over: true, ...nextStreetData });
  }

  await db.from('online_spiele').update({ current_player_id: nextPlayer.spieler_id }).eq('id', online_spiel_id);
  await executePreActionIfSet(db, session, updatedSeats, nextPlayer);
  await notifyPlayer(db, nextPlayer.spieler_id, online_spiel_id);

  return json({ ok: true, next_player: nextPlayer.spieler_id });

  } catch (e) {
    console.error('[poker-action] Unhandled error:', e);
    return json({ error: 'Internal error: ' + (e as Error).message }, 500);
  }
});

// Nächster aktiver Spieler nach fromIdx (im Uhrzeigersinn)
function findNextActivePlayer(seats: { spieler_id: string; status: string }[], fromIdx: number) {
  const n = seats.length;
  for (let i = 1; i < n; i++) {
    const s = seats[(fromIdx + i) % n];
    if (s.status === 'active' || s.status === 'paused') return s;
  }
  return null;
}

// Vorheriger aktiver Spieler vor fromIdx (gegen Uhrzeigersinn)
function findPrevActivePlayer(seats: { spieler_id: string; status: string }[], fromIdx: number) {
  const n = seats.length;
  for (let i = 1; i <= n; i++) {
    const s = seats[(fromIdx - i + n) % n];
    if (s.status === 'active' || s.status === 'paused') return s;
  }
  return null;
}

async function executePreActionIfSet(
  db: ReturnType<typeof createClient>,
  session: { id: string; street: string; hand_nr: number },
  seats: { id: string; spieler_id: string; status: string; bet_current_round: number; pre_action: string | null; pre_action_limit: number | null; pause_auto_action?: string | null; pause_call_limit?: number | null; stack: number }[],
  seat: { id: string; spieler_id: string; status: string; pre_action: string | null; pre_action_limit: number | null; pause_auto_action?: string | null; pause_call_limit?: number | null }
) {
  // Paused players use pause_auto_action; active players use pre_action
  const effectiveAction = seat.status === 'paused'
    ? (seat.pause_auto_action ?? null)
    : seat.pre_action;
  const effectiveLimit = seat.status === 'paused'
    ? (seat.pause_call_limit ?? null)
    : seat.pre_action_limit;

  if (!effectiveAction) return;

  const maxBet = Math.max(0, ...seats
    .filter(s => s.status !== 'folded' && s.status !== 'sitting_out')
    .map(s => s.bet_current_round));
  const fullSeat = seats.find(s => s.id === seat.id)!;
  const callAmount = Math.round((maxBet - fullSeat.bet_current_round) * 100) / 100;

  let autoAction: string | null = null;

  switch (effectiveAction) {
    case 'fold': autoAction = callAmount > 0 ? 'fold' : 'check'; break;
    case 'check_fold': autoAction = callAmount > 0 ? 'fold' : 'check'; break;
    case 'check': autoAction = callAmount > 0 ? null : 'check'; break;
    case 'call':
    case 'call_limit': {
      if (effectiveLimit !== null && callAmount > effectiveLimit) {
        // Paused players can't manually act → fold. Active players keep control.
        autoAction = seat.status === 'paused' ? 'fold' : null;
      } else {
        autoAction = 'call';
      }
      break;
    }
    case 'call_any': autoAction = 'call'; break;
  }

  if (!autoAction) return;

  await fetch(`${SUPABASE_URL}/functions/v1/poker-action`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SERVICE_KEY}`,
    },
    body: JSON.stringify({
      online_spiel_id: session.id,
      spieler_id: seat.spieler_id,
      action: autoAction,
    }),
  });
}

async function handleAutoAction(
  db: ReturnType<typeof createClient>,
  session: { id: string; street: string; hand_nr: number; pot: number },
  seats: { id: string; spieler_id: string; status: string; bet_current_round: number; stack: number }[],
  mySeat: { id: string; spieler_id: string; bet_current_round: number; stack: number },
  autoAction: string,
  callLimit?: number
) {
  const maxBet = Math.max(0, ...seats
    .filter((s: { status: string }) => s.status !== 'folded' && s.status !== 'sitting_out')
    .map((s: { bet_current_round: number }) => s.bet_current_round));
  const callAmount = maxBet - mySeat.bet_current_round;
  let action = autoAction;

  if (autoAction === 'call_limit' && callLimit !== undefined && callAmount > callLimit) {
    action = 'fold';
  } else if (autoAction === 'call_limit') {
    action = 'call';
  } else if (autoAction === 'check' && callAmount > 0) {
    action = 'fold';
  }

  return fetch(`${SUPABASE_URL}/functions/v1/poker-action`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SERVICE_KEY}`,
    },
    body: JSON.stringify({
      online_spiel_id: session.id,
      spieler_id: mySeat.spieler_id,
      action: action === 'call_any' ? 'call' : action,
    }),
  }).then(r => r.json()).then(data => json({ ok: true, auto_action: action, ...data }));
}

async function notifyPlayer(db: ReturnType<typeof createClient>, spieler_id: string, online_spiel_id: string) {
  try {
    await fetch(`${SUPABASE_URL}/functions/v1/send-push`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SERVICE_KEY}` },
      body: JSON.stringify({
        spieler_ids: [spieler_id],
        title: 'Du bist dran!',
        body: 'Fold, Call oder Raise – dein Zug.',
        kategorie: 'online_spiel',
        data: { url: `/#online-tisch?session=${online_spiel_id}`, tag: 'online_turn' },
      }),
    });
  } catch { /* nicht kritisch */ }
}
