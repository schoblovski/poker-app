// DTKS Poker – Edge Function: analyze-poker-photo
// Analysiert ein Foto eines Pokertisches (von oben, Karten aufgedeckt) via Claude Vision
// und liefert die erkannten Community Cards + Hole-Card-Gruppen für den Equity-Rechner.
//
// POST Body:
//   { image: string (data-URL oder reine Base64) }  ODER
//   { imageUrl: string (z.B. Beweisfoto aus Supabase Storage) }
//
// Antwort:
//   { community: string[], hands: string[][], note: string }
//   Kartennotation: Rang 2-9,T,J,Q,K,A + Farbe s/h/d/c (z.B. "Ah" = Ass Herz)

import { CORS, corsOk, json, err } from '../poker-utils/index.ts';
import { encodeBase64 } from 'https://deno.land/std@0.224.0/encoding/base64.ts';

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY') ?? '';

const SYSTEM_PROMPT = `Du analysierst ein Foto eines Pokertisches von oben, auf dem aufgedeckte Spielkarten liegen
(typisches Foto für eine "besondere Hand" am Ende eines Showdowns).

Aufgabe:
1. Identifiziere zuerst die COMMUNITY CARDS (Board): Das ist EINE einzelne Reihe/Linie von 0, 3, 4 oder 5
   Karten, meist in der Mitte/Längsachse des Tisches angeordnet (z.B. eine senkrechte oder horizontale
   Kartenreihe). Bei einem fertig ausgespielten Showdown sind es üblicherweise genau 5 Karten.
2. ALLES, was NICHT zu dieser einen Board-Reihe gehört, sind Hole-Cards der Spieler – meist 1-2 Gruppen
   zu je 2 Karten (Hold'em) oder 4 Karten (Omaha), oft seitlich/am Rand oder oben/unten im Bild, oft leicht
   gefächert oder als kleiner Stapel ausgelegt.
3. Verdeckte Karten (man sieht nur die Kartenrückseite/das Rückseiten-Muster, kein Rang/Farbsymbol) gehören
   NICHT zur Auswertung – ignoriere sie komplett, egal wo sie liegen.

WICHTIG – überlappende/gestapelte Karten:
Sehr oft liegen mehrere Karten leicht überlappend übereinander (gefächert oder gestapelt), sodass nur ein
Teil jeder Karte sichtbar ist. Bei JEDER face-up Karte ist aber immer mindestens eine Ecke (meist oben links
oder unten rechts) vollständig sichtbar – dort stehen Rang UND Farbsymbol klein ("Index") abgebildet.
Schau dir bei Stapeln/überlappenden Karten gezielt JEDE sichtbare Ecke einzeln an und lies Rang+Farbe aus
diesem Mini-Index ab, auch wenn der Rest der Karte verdeckt ist. Zähle dabei genau, wie viele Karten in
einem Stapel/Fächer liegen (z.B. anhand der Anzahl sichtbarer versetzter Ecken oder Kartenränder).

ACHTUNG – überlappende Karten INNERHALB der Board-Reihe:
Wenn an einer Position INNERHALB der Board-Linie zwei Karten leicht überlappend übereinander liegen
(z.B. weil sie beim Fotografieren leicht verrutscht sind), sind das trotzdem ZWEI EINZELNE BOARD-KARTEN
an dieser Stelle der Reihe – KEINE separate Hole-Card-Gruppe! Lies beide Eck-Indizes ab und füge beide
der "community"-Liste hinzu. Bilde nur dann eine eigene Hole-Card-Gruppe, wenn ein Kartenpaar/-stapel klar
ABSEITS der Board-Reihe liegt (z.B. am Rand, in einem eigenen Bereich des Tisches).

Kartennotation: Rang als 2-9, T (Zehn), J, Q, K, A; Farbe als s (Pik/♠), h (Herz/♥), d (Karo/♦), c (Kreuz/♣).
Beispiele: "Ah" = Ass Herz, "Td" = Zehn Karo, "2c" = Zwei Kreuz.

Antworte AUSSCHLIESSLICH mit einem JSON-Objekt in genau diesem Format, ohne Markdown-Codeblock, ohne Erklärung:
{"community":["Ah","Td","2c"],"hands":[["Kh","Ks"],["2c","2d","2h","2s"]],"note":""}

Regeln:
- Erkenne NUR Karten, die du eindeutig lesen kannst (z.B. über den Eck-Index). Wirklich verdeckte/unleserliche Karten lässt du weg (NICHT raten!).
- Verdeckte Karten (Rückseite) NIE in "community" oder "hands" aufnehmen.
- Jede Hand-Gruppe sollte 2 oder 4 Karten enthalten (Hold'em bzw. Omaha). Ist eine Gruppe unklar oder unvollständig erkennbar, lass nur die eindeutigen Karten davon stehen oder lass die Gruppe ganz weg.
- Maximal 6 Hand-Gruppen, maximal 5 Community Cards.
- Keine Karte (exakte Kombination aus Rang+Farbe) darf doppelt vorkommen (auch nicht über Community/Hand-Gruppen
  hinweg) – jede Karte existiert nur einmal im Deck. Bei einem Vierling liegen z.B. 2 Jacks im Board UND die
  ANDEREN 2 Jacks (andere Farben!) in einer Hand-Gruppe – niemals dieselbe Karte zweimal.
- "note": kurzer Hinweis (max. 1 Satz, Deutsch) falls Karten unklar/nicht erkennbar waren oder das Foto schwer auszuwerten ist. Sonst leerer String.`;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return corsOk();
  try {
    if (!ANTHROPIC_API_KEY) return err('ANTHROPIC_API_KEY nicht konfiguriert', 500);

    let body: { image?: string; imageUrl?: string };
    try { body = await req.json(); }
    catch { return err('Invalid JSON'); }

    let base64: string;
    let mediaType = 'image/jpeg';

    if (body.image) {
      const m = body.image.match(/^data:(image\/[a-zA-Z]+);base64,(.+)$/);
      if (m) { mediaType = m[1]; base64 = m[2]; }
      else base64 = body.image;
    } else if (body.imageUrl) {
      const photoRes = await fetch(body.imageUrl);
      if (!photoRes.ok) return err('Foto konnte nicht geladen werden', 502);
      const ct = photoRes.headers.get('content-type');
      if (ct) mediaType = ct.split(';')[0];
      const buf = new Uint8Array(await photoRes.arrayBuffer());
      base64 = encodeBase64(buf);
    } else {
      return err('Kein Bild übergeben');
    }

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
            { type: 'text', text: 'Analysiere die Karten auf diesem Pokertisch-Foto und antworte im vorgegebenen JSON-Format.' },
          ],
        }],
      }),
    });

    if (!res.ok) {
      console.error('[analyze-poker-photo] Anthropic error:', res.status, await res.text().catch(() => ''));
      return err('Anthropic-Fehler', 502);
    }

    const data = await res.json();
    const text: string | undefined = data?.content?.[0]?.text?.trim();
    if (!text) return err('Keine Antwort von Claude');

    let parsed: { community?: unknown; hands?: unknown; note?: unknown };
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[0] : text);
    } catch {
      console.error('[analyze-poker-photo] JSON parse failed:', text);
      return err('Antwort konnte nicht ausgewertet werden');
    }

    const community = Array.isArray(parsed.community)
      ? parsed.community.filter((c) => typeof c === 'string')
      : [];
    const hands = Array.isArray(parsed.hands)
      ? parsed.hands
          .filter((g) => Array.isArray(g))
          .map((g) => (g as unknown[]).filter((c) => typeof c === 'string'))
      : [];
    const note = typeof parsed.note === 'string' ? parsed.note : '';

    return json({ community, hands, note });
  } catch (e) {
    console.error('[analyze-poker-photo] Unhandled error:', e);
    return json({ error: 'Internal error: ' + (e as Error).message }, 500);
  }
});
