// DTKS Poker – Edge Function: equity-explain
// Generiert eine kurze Erklärung in natürlicher Sprache zu einem Equity-Rechner-Ergebnis
// via Claude (Haiku).
//
// POST Body:
//   {
//     mode: 'holdem'|'omaha'|'texama',
//     hands: string[][],   // Kartennotation, z.B. [["Ah","Kh"],["2c","2d","2h","2s"]]
//     board: string[],     // 0-5 Karten
//     results: number[],   // Gesamt-Equity in % pro Hand (Win+Split), gleiche Reihenfolge wie hands
//   }
//
// Antwort: { text: string }

import { CORS, corsOk, json, err } from '../poker-utils/index.ts';

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY') ?? '';

const SYSTEM_PROMPT = `Du bist ein Poker-Experte und erklärst Equity-Berechnungen einer privaten Pokerrunde
in einfacher, natürlicher Sprache.

Regeln:
- Antworte NUR mit der Erklärung selbst, ohne Anführungszeichen, ohne Markdown, ohne Einleitung.
- Maximal 2-3 kurze Sätze, insgesamt nicht mehr als ca. 50 Wörter.
- Sprache: Deutsch, locker und verständlich, keine Fachbegriff-Wüste.
- Erkläre kurz warum die führende Hand vorne liegt (z.B. starkes Paar, Draw, dominante Karten) und
  was die schwächere(n) Hand(en) noch brauchen würde(n), um aufzuholen (z.B. "braucht noch ein Ass für die Straight").
- Bei sehr knappen Ergebnissen (Unterschied < 5%) darfst du erwähnen, dass es ein Coinflip ist.
- Ton: locker, freundlich, leicht humorvoll – wie unter Pokerkumpels.`;

const RANK_NAMES: Record<string, string> = {
  '2': '2', '3': '3', '4': '4', '5': '5', '6': '6', '7': '7', '8': '8', '9': '9',
  T: '10', J: 'Bube', Q: 'Dame', K: 'König', A: 'Ass',
};
const SUIT_NAMES: Record<string, string> = { s: 'Pik', h: 'Herz', d: 'Karo', c: 'Kreuz' };

function describeCard(c: string): string {
  const rank = c[0]?.toUpperCase();
  const suit = c[1]?.toLowerCase();
  return `${RANK_NAMES[rank] ?? rank} ${SUIT_NAMES[suit] ?? suit}`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return corsOk();
  try {
    if (!ANTHROPIC_API_KEY) return err('ANTHROPIC_API_KEY nicht konfiguriert', 500);

    let body: { mode?: string; hands?: string[][]; board?: string[]; results?: number[] };
    try { body = await req.json(); }
    catch { return err('Invalid JSON'); }

    const { mode, hands, board, results } = body;
    if (!Array.isArray(hands) || !hands.length || !Array.isArray(results) || results.length !== hands.length) {
      return err('Fehlende Parameter');
    }

    const varianteName = mode === 'holdem' ? "Texas Hold'em" : mode === 'texama' ? 'Texahma' : 'Omaha';
    const handsDesc = hands
      .map((h, i) => `Hand ${i + 1}: ${h.map(describeCard).join(', ')} → ${results[i].toFixed(1)}% Equity`)
      .join('\n');
    const boardDesc = board && board.length ? board.map(describeCard).join(', ') : 'noch kein Board';

    const userPrompt = `Variante: ${varianteName}\nBoard: ${boardDesc}\n${handsDesc}\n\nErkläre kurz, warum die Equity so verteilt ist.`;

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 200,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });

    if (!res.ok) {
      console.error('[equity-explain] Anthropic error:', res.status, await res.text().catch(() => ''));
      return err('Anthropic-Fehler', 502);
    }

    const data = await res.json();
    const text: string | undefined = data?.content?.[0]?.text?.trim();
    if (!text) return err('Keine Antwort von Claude');

    return json({ text });
  } catch (e) {
    console.error('[equity-explain] Unhandled error:', e);
    return json({ error: 'Internal error: ' + (e as Error).message }, 500);
  }
});
