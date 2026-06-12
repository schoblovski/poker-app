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

import { CORS, corsOk, json, err, type Card, evalHoldem, evalOmaha, evalTexahma, handName } from '../poker-utils/index.ts';

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
- Ton: locker, freundlich, leicht humorvoll – wie unter Pokerkumpels.
- WICHTIG: Für jede Hand ist entweder die "aktuell beste Hand" (mit Board) oder die "Paare in der Hand"
  (ohne ausreichendes Board, z.B. Preflop) angegeben. Übernimm diese Angaben unverändert (z.B. "Drilling"
  oder "ein Paar Sechser") und erfinde keine andere Einstufung, keine zusätzlichen Paare oder Karten,
  die nicht im Board oder in der Hand stehen. Zähle Kartenwerte nicht selbst neu – verlasse dich
  ausschliesslich auf die gegebenen Angaben.`;

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

const RANK_VALUES: Record<string, number> = {
  '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9,
  T: 10, J: 11, Q: 12, K: 13, A: 14,
};

function parseCard(c: string): Card | null {
  const rank = RANK_VALUES[c[0]?.toUpperCase()];
  const suit = c[1]?.toLowerCase();
  if (!rank || !suit) return null;
  return { rank, suit };
}

const RANK_PLURAL: Record<number, string> = {
  14: 'Asse', 13: 'Könige', 12: 'Damen', 11: 'Buben', 10: 'Zehnen',
  9: 'Neuner', 8: 'Achter', 7: 'Siebener', 6: 'Sechser', 5: 'Fünfer',
  4: 'Vierer', 3: 'Dreier', 2: 'Zweier',
};

// Paare innerhalb der eigenen Hole Cards beschreiben (unabhängig vom Board) –
// gibt Claude eine verlässliche Grundlage, bevor genug Board für eine echte
// Hand-Bewertung da ist (z.B. Preflop).
function describeHolePairs(holeStr: string[]): string {
  const cards = holeStr.map(parseCard).filter((c): c is Card => c !== null);
  const counts: Record<number, number> = {};
  for (const c of cards) counts[c.rank] = (counts[c.rank] ?? 0) + 1;
  const pairs = Object.entries(counts)
    .filter(([, n]) => n >= 2)
    .map(([r]) => +r)
    .sort((a, b) => b - a);
  if (!pairs.length) return 'keine Paare in der Hand';
  if (pairs.length === 1) return `ein Paar ${RANK_PLURAL[pairs[0]] ?? pairs[0]} in der Hand`;
  return `Paare in der Hand: ${pairs.map(r => RANK_PLURAL[r] ?? r).join(' und ')}`;
}

// Aktuell beste erreichbare Hand (mit dem bisherigen Board) berechnen,
// damit Claude keine eigene (fehleranfällige) Einschätzung erfinden muss.
function bestHandDesc(mode: string | undefined, holeStr: string[], boardStr: string[]): string | null {
  const hole = holeStr.map(parseCard).filter((c): c is Card => c !== null);
  const board = boardStr.map(parseCard).filter((c): c is Card => c !== null);
  if (hole.length !== holeStr.length || board.length !== boardStr.length) return null;
  try {
    if (mode === 'holdem') {
      if (hole.length + board.length < 5) return null;
      return handName(evalHoldem(hole, board).score);
    }
    if (mode === 'texama') {
      if (board.length < 1) return null;
      return handName(evalTexahma(hole, board).score);
    }
    // omaha
    if (board.length < 3) return null;
    return handName(evalOmaha(hole, board).score);
  } catch {
    return null;
  }
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
    const boardArr = board ?? [];
    const handsDesc = hands
      .map((h, i) => {
        const best = bestHandDesc(mode, h, boardArr);
        const bestPart = best ? `, aktuell beste Hand: ${best}` : `, ${describeHolePairs(h)}`;
        return `Hand ${i + 1}: ${h.map(describeCard).join(', ')} → ${results[i].toFixed(1)}% Equity${bestPart}`;
      })
      .join('\n');
    const boardDesc = boardArr.length ? boardArr.map(describeCard).join(', ') : 'noch kein Board';

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
