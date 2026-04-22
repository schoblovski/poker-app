// DTKS Poker – Edge Function: poker-bot-cron
// Fallback bot driver called by pg_cron every ~30s.
// Finds all running sessions where current_player_id is a bot and triggers their action.
// Deployed via GitHub Actions (deploy-edge-functions.yml). v2
// The client-side global bot watcher handles immediate triggers when someone has the app open.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const db = createClient(SUPABASE_URL, SERVICE_KEY);

    // Find all running sessions with a non-null current_player_id
    const { data: sessions, error: e1 } = await db
      .from('online_spiele')
      .select('id, current_player_id')
      .eq('status', 'running')
      .not('current_player_id', 'is', null);

    if (e1) throw e1;
    if (!sessions?.length) {
      return new Response(JSON.stringify({ triggered: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Batch-check which current_player_ids are bots
    const playerIds = [...new Set(sessions.map((s: any) => s.current_player_id))];
    const { data: players } = await db
      .from('spieler')
      .select('id, ist_bot')
      .in('id', playerIds);

    const botIds = new Set((players ?? []).filter((p: any) => p.ist_bot).map((p: any) => p.id));
    const botSessions = sessions.filter((s: any) => botIds.has(s.current_player_id));

    if (!botSessions.length) {
      return new Response(JSON.stringify({ triggered: 0, checked: sessions.length }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Trigger bot actions in parallel (server-side idempotency guard prevents duplicates)
    const results = await Promise.allSettled(
      botSessions.map((s: any) =>
        fetch(`${SUPABASE_URL}/functions/v1/poker-bot-action`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${SERVICE_KEY}`,
          },
          body: JSON.stringify({
            online_spiel_id: s.id,
            bot_spieler_id: s.current_player_id,
            action: 'play',
          }),
        }).then(r => r.json()).catch(e => ({ error: String(e) }))
      )
    );

    const triggered = results.filter(r => r.status === 'fulfilled').length;

    // Also start the next hand for bot-only sessions that are between hands
    // (current_player_id=null, hand settled, all active seats are bots)
    const { data: betweenHandSessions } = await db
      .from('online_spiele')
      .select('id, hand_nr')
      .eq('status', 'running')
      .is('current_player_id', null)
      .gt('hand_nr', 0);

    let nextHandTriggered = 0;
    if (betweenHandSessions?.length) {
      for (const sess of betweenHandSessions as any[]) {
        // Check if hand is settled (win action exists for current hand_nr)
        const { data: winAction } = await db
          .from('online_actions')
          .select('id')
          .eq('online_spiel_id', sess.id)
          .eq('action', 'win')
          .eq('hand_nr', sess.hand_nr)
          .limit(1);
        if (!winAction?.length) continue;

        // Check that all active seats are bots (no human players active at table)
        const { data: activeSeats } = await db
          .from('online_seats')
          .select('spieler_id, spieler(ist_bot)')
          .eq('online_spiel_id', sess.id)
          .in('status', ['active', 'allin', 'paused']);
        if (!activeSeats?.length) continue;
        const allBots = (activeSeats as any[]).every(s => s.spieler?.ist_bot);
        if (!allBots) continue;

        // Find a bot to call poker-new-hand as the caller
        const botCaller = (activeSeats as any[])[0];
        try {
          await fetch(`${SUPABASE_URL}/functions/v1/poker-new-hand`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${SERVICE_KEY}`,
            },
            body: JSON.stringify({
              online_spiel_id: sess.id,
              spieler_id: botCaller.spieler_id,
            }),
          });
          nextHandTriggered++;
        } catch (_) { /* ignore */ }
      }
    }

    console.log(`[poker-bot-cron] actions=${triggered}/${botSessions.length} next_hand=${nextHandTriggered}`);

    return new Response(
      JSON.stringify({ triggered, next_hand: nextHandTriggered, sessions: botSessions.map((s: any) => s.id) }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error('[poker-bot-cron] error:', err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
