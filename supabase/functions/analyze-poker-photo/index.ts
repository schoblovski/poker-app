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

const SYSTEM_PROMPT = `Du analysierst ein Foto eines Pokertisches von oben, auf dem aufgedeckte Spielkarten liegen.

Aufgabe:
1. Erkenne alle Karten, die du mit hoher Sicherheit lesen kannst (Rang + Farbe).
2. Gruppiere die Hole-Cards: Karten, die offensichtlich als Hand zusammen ausgelegt wurden (üblicherweise 2 Karten = Hold'em-Hand, 4 Karten = Omaha-Hand), bilden je eine Gruppe.
3. Übrige Karten (meist eine Reihe in der Mitte des Tisches) sind die Community Cards (Board), 0 bis 5 Karten.

WICHTIG – überlappende/gestapelte Karten:
Sehr oft liegen mehrere Karten einer Hand leicht überlappend übereinander (gefächert oder gestapelt),
sodass nur ein Teil jeder Karte sichtbar ist. Bei JEDER Karte ist aber immer mindestens eine Ecke
(meist oben links oder unten rechts) vollständig sichtbar – dort stehen Rang UND Farbsymbol klein
("Index") abgebildet. Schau dir bei Stapeln/überlappenden Karten gezielt JEDE sichtbare Ecke einzeln an
und lies Rang+Farbe aus diesem Mini-Index ab, auch wenn der Rest der Karte verdeckt ist. Zähle dabei
genau, wie viele Karten in einem Stapel/Fächer liegen (z.B. anhand der Anzahl sichtbarer versetzter Ecken
oder Kartenränder) – gib NUR Karten zurück, deren Eck-Index du tatsächlich lesen kannst, aber verpasse
keine Karte nur weil sie grösstenteils verdeckt ist.

Kartennotation: Rang als 2-9, T (Zehn), J, Q, K, A; Farbe als s (Pik/♠), h (Herz/♥), d (Karo/♦), c (Kreuz/♣).
Beispiele: "Ah" = Ass Herz, "Td" = Zehn Karo, "2c" = Zwei Kreuz.

Antworte AUSSCHLIESSLICH mit einem JSON-Objekt in genau diesem Format, ohne Markdown-Codeblock, ohne Erklärung:
{"community":["Ah","Td","2c"],"hands":[["Kh","Ks"],["2c","2d","2h","2s"]],"note":""}

Regeln:
- Erkenne NUR Karten, die du eindeutig lesen kannst (z.B. über den Eck-Index). Wirklich verdeckte/unleserliche Karten lässt du weg (NICHT raten!).
- Jede Hand-Gruppe sollte 2 oder 4 Karten enthalten (Hold'em bzw. Omaha). Ist eine Gruppe unklar oder unvollständig erkennbar, lass nur die eindeutigen Karten davon stehen oder lass die Gruppe ganz weg.
- Maximal 6 Hand-Gruppen, maximal 5 Community Cards.
- Keine Karte darf doppelt vorkommen (auch nicht über Gruppen/Board hinweg).
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
