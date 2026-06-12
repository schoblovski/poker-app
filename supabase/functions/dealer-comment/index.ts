// DTKS Poker – Edge Function: dealer-comment
// Generiert einen kurzen, witzigen Dealer-Kommentar via Claude (Haiku) und
// schreibt ihn als `online_actions`-Eintrag (action: 'dealer_comment').
// Wird fire-and-forget von poker-action/poker-showdown/poker-new-hand aufgerufen –
// Fehler/Timeouts hier dürfen den Spielfluss nie beeinflussen.
//
// POST Body:
//   {
//     online_spiel_id: string,
//     trigger: 'fold'|'allin'|'raise'|'call'|'check'|'win'|'win_72'|'small_pot'|'new_hand'|'showdown',
//     spielerName?: string,
//     hand_nr: number,
//     street?: string,
//     kontext?: { pot?: number, hand?: string, variante?: string },
//   }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { CORS, corsOk, json, err } from '../poker-utils/index.ts';

const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY') ?? '';

const SYSTEM_PROMPT = `Du bist der Dealer bei einer privaten Pokerrunde (Online-Modus, Online-Poker).
Du gibst nach Spielzügen kurze, augenzwinkernde Kommentare im Stil eines trockenen Pokerkommentators ab.

Regeln:
- Antworte NUR mit dem Kommentar selbst, ohne Anführungszeichen, ohne Markdown, ohne Erklärung.
- Maximal 1-2 kurze Sätze, insgesamt nicht mehr als ca. 20 Wörter.
- Ton: trocken, lakonisch, leicht ironisch, freundlich – nie beleidigend oder gemein.
- Sprache: Hochdeutsch mit gelegentlichem vorarlbergerischem Einschlag, keine Übertreibung.
- Wenn ein Spielername gegeben ist, darfst du ihn gelegentlich in einem Chuck-Norris-Stil-Witz
  einbauen (z.B. "{name} hat Poker nicht gelernt. Poker hat {name} gelernt."), aber nicht jedes Mal –
  variiere zwischen neutralen Kommentaren und namentlichen.
- Keine Wiederholung bekannter Standardphrasen – sei kreativ, aber kurz.`;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return corsOk();
  try {
    let body: {
      online_spiel_id: string;
      trigger: string;
      spielerName?: string | null;
      hand_nr: number;
      street?: string | null;
      kontext?: Record<string, unknown>;
    };
    try { body = await req.json(); }
    catch { return err('Invalid JSON'); }

    const { online_spiel_id, trigger, spielerName, hand_nr, street, kontext } = body;
    if (!online_spiel_id || !trigger) return err('Fehlende Parameter');
    if (!ANTHROPIC_API_KEY) return err('ANTHROPIC_API_KEY nicht konfiguriert', 500);

    const userPrompt = buildPrompt(trigger, spielerName ?? null, kontext ?? {});

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 100,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });

    if (!res.ok) {
      console.error('[dealer-comment] Anthropic error:', res.status, await res.text().catch(() => ''));
      return err('Anthropic-Fehler', 502);
    }

    const data = await res.json();
    const text: string | undefined = data?.content?.[0]?.text?.trim();
    if (!text) return err('Keine Antwort von Claude');

    const db = createClient(SUPABASE_URL, SERVICE_KEY);
    await db.from('online_actions').insert({
      online_spiel_id,
      spieler_id: null,
      action: 'dealer_comment',
      hand_nr: hand_nr ?? 0,
      street: street ?? null,
      meta: { text },
    });

    return json({ ok: true, text });
  } catch (e) {
    console.error('[dealer-comment] Unhandled error:', e);
    return json({ error: 'Internal error: ' + (e as Error).message }, 500);
  }
});

function buildPrompt(trigger: string, spielerName: string | null, kontext: Record<string, unknown>): string {
  const name = spielerName ?? 'jemand';
  const pot = typeof kontext.pot === 'number' ? `€${kontext.pot.toFixed(2)}` : null;
  const hand = typeof kontext.hand === 'string' ? kontext.hand : null;
  const variante = typeof kontext.variante === 'string' ? kontext.variante : null;

  switch (trigger) {
    case 'fold':
      return `${name} foldet (gibt früh auf, ohne grossen Einsatz). Kommentiere kurz und trocken.`;
    case 'allin':
      return `${name} geht All-in${pot ? ` (Pot danach ca. ${pot})` : ''}. Kommentiere den dramatischen Moment kurz.`;
    case 'raise':
      return `${name} erhöht den Einsatz${pot ? ` (Pot jetzt ca. ${pot})` : ''}. Kommentiere kurz, ob das stark oder bluff wirkt.`;
    case 'call':
      return `${name} callt den aktuellen Einsatz. Kommentiere kurz und neutral.`;
    case 'check':
      return `${name} checkt (kein Einsatz). Kommentiere die ruhige Spielweise kurz.`;
    case 'win_72':
      return `${name} gewinnt die Hand mit der legendär schlechten Starthand 7-2 (Sieben-Zwei)! Kommentiere diesen Running-Gag der Runde begeistert-ironisch.`;
    case 'small_pot':
      return `${name} gewinnt einen winzigen Pot${pot ? ` von nur ${pot}` : ''}. Kommentiere wie wenig sich der Aufwand gelohnt hat.`;
    case 'showdown':
      return `${name} gewinnt den Showdown mit der Hand "${hand ?? 'einer starken Hand'}"${pot ? ` und kassiert ca. ${pot}` : ''}. Kommentiere im Stil eines Pokerkommentators.`;
    case 'win':
      return `${name} gewinnt den Pot${pot ? ` (ca. ${pot})` : ''}${hand ? ` mit "${hand}"` : ' (alle anderen sind gefoldet)'}. Kommentiere kurz.`;
    case 'new_hand':
      return `Eine neue Spielrunde${variante ? ` (${variante})` : ''} beginnt, ${name} hat den Dealer-Button gedrückt. Kommentiere den Neustart kurz.`;
    default:
      return `Kommentiere kurz das Spielgeschehen am Pokertisch (Ereignis: ${trigger}, Spieler: ${name}).`;
  }
}
