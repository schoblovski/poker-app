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
0. SCHRITT 1 – ÜBERBLICK VERSCHAFFEN: Bevor du auch nur eine einzelne Karte liest, schau dir das GESAMTE Foto an
   und liste gedanklich ALLE separaten Kartengruppen/-stapel auf dem Tisch auf, jeweils mit ungefährer Position
   (z.B. "oben links", "Mitte horizontale Reihe", "rechts neben dem Board", "unten rechts") und geschätzter
   Kartenanzahl. Erst NACHDEM du diese räumliche Übersicht hast, gehst du Gruppe für Gruppe durch und liest die
   einzelnen Karten – so vermischst du keine Karten aus unterschiedlichen Gruppen/Stapeln.
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

WICHTIG – Anzahl Hole-Cards pro Gruppe (Hold'em vs. Omaha):
Hole-Card-Gruppen haben OFT (aber nicht immer!) EINHEITLICH 2 Karten (Hold'em) oder EINHEITLICH 4 Karten
(Omaha). Es kann aber durchaus vorkommen, dass Gruppen UNTERSCHIEDLICH VIELE Karten zeigen (z.B. weil ein
Spieler vorzeitig gefoldet hat und nur einen Teil seiner Karten aufdeckt, oder eine Karte einer Gruppe verdeckt
liegt). ZÄHLE für JEDE Gruppe EINZELN und UNABHÄNGIG die tatsächlich sichtbaren Karten (inkl. überlappter
Karten mit eigener sichtbarer Ecke) – verzerre die Anzahl NICHT künstlich auf 2 oder 4, wenn das Foto klar eine
andere Anzahl zeigt. Prüfe zwar bei einer auf den ersten Blick kleineren Gruppe, ob im Stapel noch eine
weitere Karte (mit eigener sichtbarer Ecke) darunter verborgen liegt – aber NUR wenn du diese zusätzliche Ecke
tatsächlich siehst. Wenn nicht, übernimm die Gruppe genau mit der Anzahl Karten, die du siehst, auch wenn
andere Gruppen im selben Foto eine andere Anzahl haben.

ACHTUNG – KLEINE/ISOLIERTE GRUPPEN NICHT ÜBERSEHEN ODER MIT ANDEREN VERMISCHEN:
Auch eine kleine Gruppe von nur 1-2 Karten, die seitlich/abseits liegt (z.B. neben dem Board, am Rand des
Tisches), ist eine VOLLWERTIGE, EIGENSTÄNDIGE Hole-Card-Gruppe – auch wenn andere Gruppen im Foto 4 Karten
haben. Lass eine solche kleine Gruppe NICHT weg und vermische ihre Karten NICHT mit einer benachbarten
grösseren Gruppe oder dem Board, nur um "einheitlichere" Gruppengrössen zu erreichen. Zähle gemäss Schritt 0
ALLE räumlich getrennten Kartenansammlungen, auch kleine, als eigene Gruppen.

ACHTUNG – überlappende Karten INNERHALB der Board-Reihe:
Wenn an einer Position INNERHALB der Board-Linie zwei Karten leicht überlappend übereinander liegen
(z.B. weil sie beim Fotografieren leicht verrutscht sind), sind das trotzdem ZWEI EINZELNE BOARD-KARTEN
an dieser Stelle der Reihe – KEINE separate Hole-Card-Gruppe! Lies beide Eck-Indizes ab und füge beide
der "community"-Liste hinzu. Bilde nur dann eine eigene Hole-Card-Gruppe, wenn ein Kartenpaar/-stapel klar
ABSEITS der Board-Reihe liegt (z.B. am Rand, in einem eigenen Bereich des Tisches).

PLAUSIBILITÄTS-CHECK bei vollständig sichtbaren Karten:
Wenn eine Karte komplett sichtbar ist (NICHT von einer anderen Karte überlappt), zeigt sie nicht nur den
Eck-Index, sondern auch die Symbole/Pips in der Kartenmitte (bzw. ein Bild bei J/Q/K, ein einzelnes großes
Symbol bei A). ZÄHLE bei solchen vollständig sichtbaren Karten die Pips in der Mitte genau durch und prüfe,
ob die Anzahl zum erkannten Rang passt:
- "A" → genau 1 grosses zentrales Pip
- "2".."9" → genau so viele Pips wie der Rang angibt (z.B. "9" → 9 Pips)
- "T" (Zehn) → 10 Pips (meist in zwei Fünfer-Spalten, oft ZUSÄTZLICH mit der Zahl "10" beschriftet)
- "J"/"Q"/"K" → Bild einer Figur (Bube/Dame/König)

Besonders verwechslungsanfällig: "8" vs. "T" (Zehn) – zähle die Pips bewusst durch (8 vs. 10 Pips) und achte
auf eine eventuell aufgedruckte "10"-Beschriftung im Eck-Index, statt die Form nur grob zu schätzen.

Besonders verwechslungsanfällig: "A" (Ass) vs. "3" – beide Eck-Indizes können bei kleiner Auflösung ähnlich
rund/kompakt wirken. Das Ass hat IMMER genau 1 grosses zentrales Pip/Symbol in der Kartenmitte, die "3" hat
genau 3 Pips übereinander. Prüfe bei vollständig sichtbaren Karten zwingend die Anzahl der zentralen Pips,
bevor du dich zwischen "A" und "3" entscheidest.

Besonders verwechslungsanfällig: "6" vs. "9" – der Eck-Index von 6 und 9 sieht (insbesondere bei kleiner
Auflösung oder leicht gedrehter Karte) fast identisch aus, da eine 9 oft wie eine um 180° gedrehte 6 wirkt.
Verlasse dich hier NICHT nur auf den Eck-Index, sondern zähle bei vollständig sichtbaren Karten die Pips:
"6" hat genau 6 Pips (zwei Spalten zu je 3), "9" hat genau 9 Pips (zwei Spalten zu je 4 plus 1 mittig oben/unten).
Achte zusätzlich auf die Ausrichtung des Eck-Index relativ zu benachbarten Karten in derselben Reihe/Gruppe:
liegen mehrere Karten gleich orientiert nebeneinander, hat eine "6" den kleinen Bogen/Schwung des Ziffernkopfes
UNTEN, eine "9" hat ihn OBEN – vergleiche das bei Unsicherheit mit eindeutig erkennbaren Nachbarkarten.

Widersprechen sich Eck-Index und Pip-Anzahl in der Mitte, vertraue der ausgezählten Pip-Anzahl der
Kartenmitte und korrigiere den Rang entsprechend (z.B. ein einzelnes grosses zentrales Symbol ist immer ein
Ass, 10 durchgezählte Pips bedeuten Rang "T", auch wenn der Eck-Index wie "8" aussah). Bei überlappten
Karten, bei denen die Kartenmitte nicht sichtbar ist, kannst du diesen Check nicht durchführen – verlasse
dich dort auf den Eck-Index. Bei echten Zweifeln lass die Karte weg statt zu raten.

Kartennotation: Rang als 2-9, T (Zehn), J, Q, K, A; Farbe als s (Pik/♠), h (Herz/♥), d (Karo/♦), c (Kreuz/♣).
Beispiele: "Ah" = Ass Herz, "Td" = Zehn Karo, "2c" = Zwei Kreuz.

FARBSYMBOLE GENAU UNTERSCHEIDEN – häufige Fehlerquelle:
Es gibt nur 4 Symbole, je 2 schwarze und 2 rote. Verwechsle sie nicht nur nach Farbe (schwarz/rot), sondern
prüfe gezielt die FORM:
- ♠ Pik (s) – SCHWARZ. Herzförmige Spitze oben, mit einem kleinen "Stiel"/Dreieck unten (wie ein Anker/Tropfen
  mit Stamm). Wird leicht mit ♣ verwechselt.
- ♣ Kreuz/Klee (c) – SCHWARZ. Dreiblättriges Kleeblatt (3 runde Kreise/Lappen) MIT Stiel unten, KEINE Spitze
  oben. Wird leicht mit ♠ verwechselt – Unterscheidung: ♠ hat eine spitze Herzform oben, ♣ hat drei runde
  Lappen ohne Spitze.
- ♥ Herz (h) – ROT. Klassische Herzform (zwei runde Wölbungen oben, Spitze unten). Wird leicht mit ♦ verwechselt.
- ♦ Karo/Diamant (d) – ROT. Einfache Raute/Diamantform (4 gerade Kanten, spitz oben und unten, KEINE
  Wölbungen). Wird leicht mit ♥ verwechselt – Unterscheidung: ♥ hat zwei runde Wölbungen oben, ♦ hat eine
  gerade Raute ohne Wölbungen.
Bestimme IMMER zuerst die Farbe (schwarz/rot) und DANN unabhängig davon die genaue Form anhand der obigen
Merkmale, bevor du dich für s/c bzw. h/d entscheidest. Bei Unsicherheit über die Form lieber die Karte
weglassen als zu raten.

Vorgehen – ZUERST ANALYSE, DANN JSON:
Bevor du antwortest, schreibe eine kurze Analyse in Stichworten (max. ca. 15 Zeilen):
1. Liste alle erkannten Kartengruppen/-stapel mit Position und Kartenanzahl auf (siehe Schritt 0 oben).
2. Liste für jede Gruppe die einzeln gelesenen Karten auf (Rang+Farbe), inkl. kurzer Begründung bei
   Unsicherheiten (Pip-Anzahl, Eck-Index, etc.).
3. Prüfe am Schluss: Gibt es Duplikate (gleiche Karte doppelt)? Falls ja, korrigiere die unsicherere Lesung.

Schreibe DANACH auf einer neuen Zeile exakt "ERGEBNIS:" und anschliessend AUSSCHLIESSLICH ein JSON-Objekt in
genau diesem Format, ohne Markdown-Codeblock, ohne weitere Erklärung danach:
{"community":["Ah","Td","2c"],"hands":[["Kh","Ks"],["2c","2d","2h","2s"]],"note":""}

Regeln:
- Erkenne NUR Karten, die du eindeutig lesen kannst (z.B. über den Eck-Index). Wirklich verdeckte/unleserliche Karten lässt du weg (NICHT raten!).
- Verdeckte Karten (Rückseite) NIE in "community" oder "hands" aufnehmen.
- Jede Hand-Gruppe enthält genau so viele Karten, wie auf dem Foto für diese Gruppe tatsächlich eindeutig erkennbar sind (das können 2, 3, 4 oder auch nur 1 sein – Gruppen müssen NICHT alle gleich gross sein). Ist eine Gruppe unklar oder teilweise unleserlich, lass nur die eindeutigen Karten davon stehen.
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
        max_tokens: 4096,
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
