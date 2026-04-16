// DTKS Poker – Supabase Edge Function: send-push
// Versendet Web Push Notifications an einen oder mehrere Spieler.
//
// Aufruf (POST):
//   URL:  https://<project>.supabase.co/functions/v1/send-push
//   Auth: Authorization: Bearer <SUPABASE_ANON_OR_SERVICE_KEY>
//   Body: {
//     spieler_ids: string[]   // UUIDs der Empfänger (leer = alle)
//     title:       string
//     body:        string
//     data?:       object     // z.B. { url: '/', tag: 'transaktion' }
//     kategorie?:  'spielergebnisse' | 'transaktionen' | 'app_updates'
//   }
//
// Supabase Secrets (einmalig setzen):
//   PRIVATE_VAPID_KEY  – base64url privater VAPID-Schlüssel
//   VAPID_SUBJECT      – mailto: oder https: URL

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import webpush from 'npm:web-push';

const VAPID_PUBLIC_KEY  = 'BGumKAOH09NkYA-3yZFQZu6lzIYXlvhGvxOlyHmFiVSfCgfDmF787TUNKl5lvV5L1efvA5qujAorCxhQcluY2hE';
const PRIVATE_VAPID_KEY = Deno.env.get('PRIVATE_VAPID_KEY') ?? '';
const VAPID_SUBJECT     = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@dtks-poker.app';

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, PRIVATE_VAPID_KEY);

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: CORS });
  }
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers: CORS });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  let body: { spieler_ids?: string[]; title: string; body: string; data?: object; kategorie?: string };
  try {
    body = await req.json();
  } catch {
    return new Response('Invalid JSON', { status: 400, headers: CORS });
  }

  const { spieler_ids, title, body: msg, data = {}, kategorie } = body;
  if (!title || !msg) {
    return new Response('Missing title or body', { status: 400, headers: CORS });
  }

  // Subscriptions laden
  let query = supabase.from('push_subscriptions').select('*');
  if (spieler_ids && spieler_ids.length > 0) {
    query = query.in('spieler_id', spieler_ids);
  }
  if (kategorie) {
    query = query.eq(`einstellungen->>${kategorie}`, 'true');
  }

  const { data: subs, error } = await query;
  if (error) {
    console.error('DB Fehler:', error);
    return new Response('DB Error', { status: 500, headers: CORS });
  }
  if (!subs || subs.length === 0) {
    console.log('Keine Subscriptions gefunden');
    return new Response(JSON.stringify({ sent: 0, errors: 0 }), {
      headers: { 'Content-Type': 'application/json', ...CORS }
    });
  }

  const payload = JSON.stringify({ title, body: msg, data });
  let sent = 0, errors = 0;
  const toDelete: string[] = [];

  await Promise.all(subs.map(async (sub) => {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload,
        { TTL: 86400 }
      );
      sent++;
    } catch (e: any) {
      console.error(`Push Fehler ${e.statusCode} für ${sub.spieler_id}:`, e.body ?? e.message);
      if (e.statusCode === 410 || e.statusCode === 404) {
        toDelete.push(sub.endpoint);
      }
      errors++;
    }
  }));

  if (toDelete.length > 0) {
    await supabase.from('push_subscriptions').delete().in('endpoint', toDelete);
    console.log(`${toDelete.length} abgelaufene Subscriptions gelöscht`);
  }

  console.log(`Push: ${sent} OK, ${errors} Fehler`);
  return new Response(JSON.stringify({ sent, errors }), {
    headers: { 'Content-Type': 'application/json', ...CORS }
  });
});
