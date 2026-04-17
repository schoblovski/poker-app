// DTKS Poker – Edge Function: poker-showdown
// Evaluiert alle verbleibenden Hände, bestimmt Gewinner, verteilt Pot.
// Unterstützt Hold'em, Omaha, Texahma inkl. Sidepots.
//
// POST Body: { online_spiel_id: string }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  evalHoldem, evalOmaha, evalTexahma, handName,
  CORS, corsOk, json, err,
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

  const [{ data: session }, { data: seats }] = await Promise.all([
    db.from('online_spiele').select('*').eq('id', online_spiel_id).single(),
    db.from('online_seats').select('*').eq('online_spiel_id', online_spiel_id).order('seat'),
  ]);

  if (!session) return err('Session nicht gefunden', 404);

  const board: Card[] = session.community_cards ?? [];
  const nonFolded = (seats ?? []).filter((s: { status: string }) => s.status !== 'folded' && s.status !== 'sitting_out');

  // Hole Cards aller aktiven Spieler laden
  const cardRows = await db
    .from('online_seat_cards')
    .select('seat_id, hole_cards')
    .in('seat_id', nonFolded.map((s: { id: string }) => s.id));

  const holeMap: Record<string, Card[]> = {};
  for (const row of cardRows.data ?? []) {
    holeMap[row.seat_id] = row.hole_cards;
  }

  // Hände evaluieren
  type HandResult = {
    seatId: string;
    spielerId: string;
    score: number;
    handDesc: string;
    usedHole: Card[];
    best: Card[];
  };

  const results: HandResult[] = nonFolded.map((seat: { id: string; spieler_id: string }) => {
    const hole = holeMap[seat.id] ?? [];
    let score: number;
    let usedHole: Card[] = [];
    let best: Card[] = [];

    switch (session.variante) {
      case 'omaha': {
        const r = evalOmaha(hole, board);
        score = r.score; usedHole = r.usedHole; best = r.best;
        break;
      }
      case 'texahma': {
        const r = evalTexahma(hole, board);
        score = r.score; usedHole = r.usedHole; best = r.best;
        break;
      }
      default: { // holdem
        const r = evalHoldem(hole, board);
        score = r.score; usedHole = []; best = r.best;
        break;
      }
    }

    return { seatId: seat.id, spielerId: seat.spieler_id, score, handDesc: handName(score), usedHole, best };
  });

  // Sidepots berechnen
  const pots = calcSidepots(seats ?? [], session.pot);

  // Gewinner pro Sidepot bestimmen
  const stackUpdates: Record<string, number> = {};
  const winLog: { spieler_id: string; amount: number; hand: string }[] = [];

  for (const pot of pots) {
    const eligible = results.filter(r => pot.eligibleSeatIds.includes(r.seatId));
    if (eligible.length === 0) continue;

    const maxScore = Math.max(...eligible.map(r => r.score));
    const winners = eligible.filter(r => r.score === maxScore);
    const share = Math.floor(pot.amount / winners.length);

    for (const w of winners) {
      stackUpdates[w.seatId] = (stackUpdates[w.seatId] ?? 0) + share;
      winLog.push({ spieler_id: w.spielerId, amount: share, hand: w.handDesc });
    }
  }

  // Stacks aktualisieren
  await Promise.all([
    ...Object.entries(stackUpdates).map(([seatId, amount]) => {
      const seat = seats!.find((s: { id: string }) => s.id === seatId)!;
      return db.from('online_seats').update({ stack: seat.stack + amount }).eq('id', seatId);
    }),
    db.from('online_spiele').update({ pot: 0, current_player_id: null }).eq('id', online_spiel_id),
  ]);

  // Action-Log: Showdown-Ergebnisse
  await db.from('online_actions').insert(
    winLog.map(w => ({
      online_spiel_id,
      spieler_id: w.spieler_id,
      action: 'win',
      amount: w.amount,
      street: 'showdown',
      hand_nr: session.hand_nr,
    }))
  );

  return json({
    ok: true,
    showdown: true,
    results: results.map(r => ({
      spieler_id: r.spielerId,
      hand: r.handDesc,
      score: r.score,
      used_hole: r.usedHole,
    })),
    winners: winLog,
  });
});

type SidePot = { amount: number; eligibleSeatIds: string[] };

function calcSidepots(seats: { id: string; status: string; bet_current_round: number; stack: number }[], totalPot: number): SidePot[] {
  // Vereinfachung: bei keinem All-In → ein Pot für alle
  const allins = seats.filter(s => s.status === 'allin');
  if (allins.length === 0) {
    const eligible = seats.filter(s => s.status !== 'folded' && s.status !== 'sitting_out');
    return [{ amount: totalPot, eligibleSeatIds: eligible.map(s => s.id) }];
  }

  // Sidepot-Berechnung über Einsatzstufen
  const nonFolded = seats.filter(s => s.status !== 'folded' && s.status !== 'sitting_out');
  const contributions = seats
    .filter(s => s.bet_current_round > 0)
    .map(s => ({ id: s.id, contrib: s.bet_current_round }))
    .sort((a, b) => a.contrib - b.contrib);

  const levels = [...new Set(contributions.map(c => c.contrib))].sort((a, b) => a - b);
  const pots: SidePot[] = [];
  let prevLevel = 0;

  for (const level of levels) {
    const diff = level - prevLevel;
    const eligible = nonFolded.filter(s =>
      contributions.find(c => c.id === s.id && c.contrib >= level)
    );
    const potAmount = diff * contributions.filter(c => c.contrib >= level).length;
    if (potAmount > 0 && eligible.length > 0) {
      pots.push({ amount: potAmount, eligibleSeatIds: eligible.map(s => s.id) });
    }
    prevLevel = level;
  }

  // Sicherstellen dass Gesamtpot korrekt ist
  const sumPots = pots.reduce((s, p) => s + p.amount, 0);
  if (sumPots < totalPot && pots.length > 0) {
    pots[pots.length - 1].amount += totalPot - sumPots;
  }

  return pots.length > 0 ? pots : [{ amount: totalPot, eligibleSeatIds: nonFolded.map(s => s.id) }];
}
