// DTKS Poker – Edge Function: poker-delete-session
// Löscht eine Online-Session vollständig (Service Role → kein RLS).
// Besondere Hände in hand_statistik bleiben erhalten.
//
// POST Body:
//   { online_spiel_id: string }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { CORS, corsOk, json, err } from '../poker-utils/index.ts';

const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return corsOk();

  // Service-Role-Client (bypasses RLS)
  const db = createClient(SUPABASE_URL, SERVICE_KEY);

  // Caller via Anon-Key authentifizieren
  const authHeader = req.headers.get('Authorization') ?? '';
  const userDb = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user } } = await userDb.auth.getUser();
  if (!user) return err('Nicht eingeloggt', 401);


  let body: { online_spiel_id: string };
  try { body = await req.json(); }
  catch { return err('Ungültiges JSON'); }

  const { online_spiel_id } = body;
  if (!online_spiel_id) return err('online_spiel_id fehlt');

  // Session laden (muss existieren – auch wenn status=finished/hand_nr=0)
  const { data: session } = await db
    .from('online_spiele')
    .select('id, status')
    .eq('id', online_spiel_id)
    .maybeSingle();
  if (!session) return err('Session nicht gefunden', 404);

  // Bot-Spieler-IDs: erst alle Sitz-Spieler-IDs holen, dann separat nach ist_bot filtern
  // (kein join, da FK on online_seats.spieler_id nicht immer vorhanden)
  const { data: seatRows } = await db
    .from('online_seats')
    .select('spieler_id')
    .eq('online_spiel_id', online_spiel_id);
  const sitzIds = (seatRows ?? []).map((s: any) => s.spieler_id).filter(Boolean);

  let botIds: string[] = [];
  if (sitzIds.length) {
    const { data: botSpieler } = await db
      .from('spieler')
      .select('id')
      .in('id', sitzIds)
      .eq('ist_bot', true);
    botIds = (botSpieler ?? []).map((s: any) => s.id);
  }

  // FK-Abhängigkeiten auflösen, dann Session löschen
  // (ON DELETE CASCADE auf online_seats/actions/chat/decks würde auch reichen,
  //  aber explizite Reihenfolge ist sicherer)
  await db.from('online_spiele').update({ current_player_id: null }).eq('id', online_spiel_id);
  await db.from('online_actions').delete().eq('online_spiel_id', online_spiel_id);
  await db.from('online_chat').delete().eq('online_spiel_id', online_spiel_id);
  await db.from('online_seats').delete().eq('online_spiel_id', online_spiel_id);
  await db.from('online_decks').delete().eq('id', online_spiel_id);
  await db.from('online_spiele').delete().eq('id', online_spiel_id);

  // Bot-Spieler löschen (alle FK-Refs sind jetzt weg)
  if (botIds.length) {
    await db.from('benachrichtigungen').delete().in('spieler_id', botIds);
    await db.from('spieler').delete().in('id', botIds).eq('ist_bot', true);
  }

  // hand_statistik Einträge bleiben erhalten (verknüpft mit spiele, nicht online_spiele)

  return json({ ok: true, deleted: online_spiel_id, bots_removed: botIds.length });
});
