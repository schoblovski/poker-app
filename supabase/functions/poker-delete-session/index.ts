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

  const { data: caller } = await db
    .from('spieler')
    .select('ist_admin')
    .eq('auth_user_id', user.id)
    .maybeSingle();
  if (!caller?.ist_admin) return err('Nur Admins dürfen Sessions löschen', 403);

  let body: { online_spiel_id: string };
  try { body = await req.json(); }
  catch { return err('Ungültiges JSON'); }

  const { online_spiel_id } = body;
  if (!online_spiel_id) return err('online_spiel_id fehlt');

  // Session laden (muss existieren)
  const { data: session } = await db
    .from('online_spiele')
    .select('id, status')
    .eq('id', online_spiel_id)
    .maybeSingle();
  if (!session) return err('Session nicht gefunden', 404);

  // Bot-Spieler-IDs ermitteln (werden nach der Session-Löschung bereinigt)
  const { data: botSeats } = await db
    .from('online_seats')
    .select('spieler_id, spieler:spieler_id(ist_bot)')
    .eq('online_spiel_id', online_spiel_id);
  const botIds: string[] = (botSeats ?? [])
    .filter((s: any) => s.spieler?.ist_bot)
    .map((s: any) => s.spieler_id);

  // FK-Abhängigkeiten auflösen, dann Session löschen
  await db.from('online_spiele').update({ current_player_id: null }).eq('id', online_spiel_id);
  await db.from('online_actions').delete().eq('online_spiel_id', online_spiel_id);
  await db.from('online_chat').delete().eq('online_spiel_id', online_spiel_id);
  await db.from('online_seats').delete().eq('online_spiel_id', online_spiel_id);
  await db.from('online_decks').delete().eq('id', online_spiel_id);
  await db.from('online_spiele').delete().eq('id', online_spiel_id);

  // Bot-Spieler bereinigen
  if (botIds.length) {
    await db.from('benachrichtigungen').delete().in('spieler_id', botIds);
    // Alle anderen FK-Referenzen sind jetzt weg → direkte Löschung möglich
    await db.from('spieler').delete().in('id', botIds).eq('ist_bot', true);
  }

  // hand_statistik Einträge bleiben erhalten (verknüpft mit spiele, nicht online_spiele)

  return json({ ok: true, deleted: online_spiel_id, bots_removed: botIds.length });
});
