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

SCHRITT 1 – ÜBERBLICK: Schau dir zuerst das GESAMTE Foto an und liste gedanklich ALLE räumlich getrennten
Kartengruppen/-stapel auf (Position + ungefähre Kartenanzahl), bevor du einzelne Karten liest. Vermische dabei
keine Karten aus unterschiedlichen Gruppen.

SCHRITT 2 – BOARD vs. HOLE-CARDS:
- COMMUNITY CARDS (Board) = EINE einzelne Reihe/Linie von 0, 3, 4 oder 5 Karten, meist in der Mitte/Längsachse
  des Tisches. Bei fertigem Showdown üblicherweise genau 5 Karten.
- ALLES andere sind Hole-Card-Gruppen der Spieler. Gruppen können UNTERSCHIEDLICH GROSS sein (1-4 Karten je
  Gruppe) – zähle für jede Gruppe einzeln die tatsächlich sichtbaren Karten, verzerre die Anzahl nicht künstlich
  auf 2 oder 4. Auch eine kleine, isolierte Gruppe mit nur 1-2 Karten am Rand ist eine eigenständige Gruppe –
  nicht weglassen oder mit einer Nachbargruppe vermischen.
- Liegen INNERHALB der Board-Reihe zwei Karten leicht überlappend übereinander, sind das ZWEI BOARD-KARTEN
  an dieser Position (keine eigene Hole-Card-Gruppe).
- Verdeckte Karten (nur Rückseite sichtbar) komplett ignorieren.

SCHRITT 3 – EINZELNE KARTEN LESEN:
- Bei überlappenden/gestapelten Karten ist immer mindestens eine Ecke (Index mit Rang+Farbe) sichtbar – lies
  jede sichtbare Ecke einzeln aus.
- Bei vollständig sichtbaren Karten: zähle zur Kontrolle die Pips/Symbole in der Kartenmitte (A=1, 2-9=Anzahl,
  T=10, J/Q/K=Bildkarte) und vergleiche mit dem Eck-Index. Bei Widerspruch gilt die Pip-Anzahl. Achte besonders
  auf 8 vs. T, A vs. 3, und 6 vs. 9 (6 und 9 sehen im Eck-Index oft wie umgedreht aus – Pips zählen entscheidet).
- Farbsymbole: ♠ (s) = schwarz, Spitze oben + Stiel unten. ♣ (c) = schwarz, Kleeblatt (3 Lappen) ohne Spitze
  oben. ♥ (h) = rot, klassische Herzform. ♦ (d) = rot, spitze Raute ohne Wölbungen. Erst Farbe (schwarz/rot)
  bestimmen, dann Form prüfen.
- Bei echten Zweifeln: Karte weglassen statt raten.

Kartennotation: Rang als 2-9, T (Zehn), J, Q, K, A; Farbe als s/h/d/c. Beispiele: "Ah" = Ass Herz, "Td" = Zehn
Karo, "2c" = Zwei Kreuz.

Vorgehen – ZUERST ANALYSE, DANN JSON:
Schreibe zuerst eine kurze Analyse in Stichworten (max. 10 Zeilen): pro Gruppe Position, Kartenanzahl und die
gelesenen Karten. Prüfe zum Schluss auf Duplikate (gleiche Karte doppelt) und korrigiere die unsicherere Lesung.

Schreibe DANACH auf einer neuen Zeile exakt "ERGEBNIS:" und anschliessend AUSSCHLIESSLICH ein JSON-Objekt in
genau diesem Format, ohne Markdown-Codeblock, ohne weitere Erklärung danach:
{"community":["Ah","Td","2c"],"hands":[["Kh","Ks"],["2c","2d","2h","2s"]],"note":""}

Regeln:
- Erkenne NUR Karten, die du eindeutig lesen kannst. Unleserliche/verdeckte Karten weglassen, nicht raten.
- Jede Hand-Gruppe enthält genau so viele Karten, wie für diese Gruppe eindeutig erkennbar sind (1-4, Gruppen
  müssen nicht gleich gross sein).
- Maximal 6 Hand-Gruppen, maximal 5 Community Cards.
- Keine Karte (Rang+Farbe) darf doppelt vorkommen – über community und hands hinweg, jede Karte existiert nur
  einmal im Deck.
- "note": kurzer Hinweis (max. 1 Satz, Deutsch) falls Karten unklar waren. Sonst leerer String.`;

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
        max_tokens: 8000,
        thinking: { type: 'enabled', budget_tokens: 4000 },
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
    const textBlock = Array.isArray(data?.content)
      ? data.content.find((b: { type?: string }) => b?.type === 'text')
      : undefined;
    const text: string | undefined = textBlock?.text?.trim();
    if (!text) return err('Keine Antwort von Claude');

    let parsed: { community?: unknown; hands?: unknown; note?: unknown };
    try {
      const afterMarker = text.split(/ERGEBNIS:/i).pop() ?? text;
      const start = afterMarker.indexOf('{');
      const end = afterMarker.lastIndexOf('}');
      const candidate = start !== -1 && end !== -1 && end > start
        ? afterMarker.slice(start, end + 1)
        : afterMarker;
      parsed = JSON.parse(candidate);
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
