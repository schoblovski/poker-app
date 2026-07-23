# DTKS Poker App – Projektdokumentation für Claude Code

## Überblick

Progressive Web App (PWA) für eine private Pokerrunde (ca. 9-13 Spieler).
Entwickelt von Chris (Admin) mit Claude als Entwicklungspartner.

## Tech Stack

- **Frontend:** Vanilla HTML + CSS + JavaScript – alles in einer einzigen Datei: `index.html`
- **Hosting:** Vercel → auto-deploy bei GitHub Push
- **Datenbank:** Supabase (PostgreSQL) in Zürich
- **Live URL:** https://dtks-poker.vercel.app

## Supabase

```
URL:      https://bcvyhlzjpfezokvcjksn.supabase.co
Anon Key: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJjdnlobHpqcGZlem9rdmNqa3NuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU3NDAzNDksImV4cCI6MjA5MTMxNjM0OX0.DNvFp6N7HYjMwrimiKAd_D3VAQDYDns-2vvHOBdW4Yk
```

## Datenbank-Schema

### `spieler`

| Spalte         | Typ     | Beschreibung                                       |
|----------------|---------|----------------------------------------------------|
| id                | uuid      | Primary Key                                        |
| name              | text      | Anzeigename                                        |
| email             | text      | Für Login (unique)                                 |
| profilbild        | text      | URL (Google-Profilbild oder Google Drive)          |
| eintrittsdatum    | date      | Tag an dem der Spieler in der App erfasst wurde    |
| aktiv             | boolean   | Inaktive Spieler werden nicht angezeigt            |
| ist_bank          | boolean   | Genau 1 Spieler ist die "Bank"                     |
| ist_admin         | boolean   | Darf Spieler verwalten + löschen                   |
| ist_bot           | boolean   | KI-Bot-Spieler (nur Online-Modus, default false)   |
| auth_user_id      | uuid      | Verknüpfung mit Supabase Auth                      |
| letzter_login     | timestamp | Zeitpunkt des letzten Logins                       |
| online_entdeckt_am| timestamp | Wann der Online-Modus per Easter-Egg entdeckt wurde|
| created_at        | timestamp | Anlage-Zeitpunkt (default now())                   |

### `spiele`

| Spalte          | Typ     | Beschreibung                              |
|-----------------|---------|-------------------------------------------|
| id              | uuid    | Primary Key                               |
| datum           | date    |                                           |
| abgeschlossen   | boolean | false = läuft noch                        |
| buyin_pot       | numeric | €5 default (historisch auch 2.5)          |
| buyin_kassa     | numeric | €2 default                                |
| modus           | text    | default 'cash'; CHECK: 'cash'/'turnier'/'online' |
| online_variante | text    | 'holdem'/'omaha'/'texahma' (bei online)   |

### `spiel_teilnehmer`

| Spalte       | Typ     | Beschreibung                               |
|--------------|---------|--------------------------------------------|
| id           | uuid    | Primary Key                                |
| spiel_id     | uuid    | FK → spiele                                |
| spieler_id   | uuid    | FK → spieler                               |
| buyins       | integer | Anzahl Buy-Ins                             |
| payout       | numeric | Was der Spieler am Ende erhält             |
| leihgabe     | numeric | Geliehenes Geld (läuft über Transaktionen) |
| in_statistik | boolean | Für Statistik-Auswertung                   |

### `transaktionen`

| Spalte          | Typ     | Beschreibung                         |
|-----------------|---------|--------------------------------------|
| id              | uuid    | Primary Key                          |
| datum           | date    |                                      |
| von_spieler_id  | uuid    | NULL = "leer" (Einzahlung von außen) |
| nach_spieler_id | uuid    | NULL = "leer" (Auszahlung)           |
| betrag          | numeric |                                      |
| kommentar       | text    |                                      |

**Transaktionstypen:**

- `leer → Spieler`    = Einzahlung (erhöht Bankkonto + Spieler-KS)
- `Spieler → leer`    = Auszahlung
- `Spieler → Spieler` = Transfer (z.B. 7-2 Gewinn)
- `Bank → Spieler`    = Erstattung aus Pokerkasse (z.B. Snacks)
- `Spieler → Bank`    = Spende in Pokerkasse
- `leer → Bank`       = Zinsen, Eingang

### `hand_statistik`

| Spalte      | Typ  | Beschreibung                          |
|-------------|------|---------------------------------------|
| id          | uuid | Primary Key                           |
| datum       | date |                                       |
| gewinner_id | uuid | FK → spieler                          |
| hand        | text | z.B. "Poker", "Straight Flush", "7-2" |
| kommentar   | text |                                       |
| beweisfoto  | text | Base64-JPEG (komprimiert, max 1024px) |
| spiel_id    | uuid | FK → spiele (optional)                |
| online_spiel_id | uuid | FK → online_spiele (optional). Gesetzt wenn die Hand am Online-Tisch («Hand festhalten») erfasst wurde; bei Payout-Bestätigung wird spiel_id nachgetragen. ON DELETE SET NULL |

### `einstellungen`

| key         | wert | Beschreibung           |
|-------------|------|------------------------|
| buyin_pot   | 5.00 | €/BuyIn für Chips      |
| buyin_kassa | 2.00 | €/BuyIn für Pokerkasse |

### `push_subscriptions`

| Spalte          | Typ       | Beschreibung                                                              |
|-----------------|-----------|---------------------------------------------------------------------------|
| id              | uuid      | Primary Key                                                               |
| spieler_id      | uuid      | FK → spieler                                                              |
| endpoint        | text      | Browser Push-Endpoint URL (unique)                                        |
| p256dh          | text      | ECDH Public Key (Base64)                                                  |
| auth            | text      | Auth Secret (Base64)                                                      |
| einstellungen   | jsonb     | Kategorie-Toggles: spielergebnisse, buyins, neue_hand, transaktionen, app_updates, online_spiel |
| erstellt_am     | timestamp | Anlage-Zeitpunkt der Subscription                                        |
| aktualisiert_am | timestamp | Letztes Update der Subscription                                           |

### `blind_struktur`

Default-Blind-Levels für den Blind-Timer (admin-konfigurierbar in den Einstellungen).

| Spalte      | Typ       | Beschreibung                          |
|-------------|-----------|---------------------------------------|
| id          | uuid      | Primary Key                           |
| level_nr    | integer   | Level-Nummer (unique, > 0)            |
| small_blind | integer   | Small Blind (> 0)                     |
| big_blind   | integer   | Big Blind (> 0)                       |
| ante        | integer   | Ante (default 0)                      |
| dauer_min   | integer   | Dauer des Levels in Minuten (> 0)     |
| erstellt_am | timestamp | Anlage-Zeitpunkt                      |

### `benachrichtigungen`

In-App-Benachrichtigungen (Glocke im Header). triggerPush schreibt pro Empfänger einen Eintrag.

| Spalte     | Typ       | Beschreibung                                              |
|------------|-----------|----------------------------------------------------------|
| id         | uuid      | Primary Key                                              |
| spieler_id | uuid      | FK → spieler                                             |
| datum      | timestamp | Zeitpunkt (default now())                                |
| kategorie  | text      | Push-Kategorie (spielergebnisse, buyins, …)             |
| title      | text      | Titel                                                    |
| body       | text      | Text                                                     |
| url        | text      | Deep-Link-Ziel                                           |
| tag        | text      | Gruppierungs-Tag                                         |
| gelesen    | boolean   | Gelesen-Status (default false)                          |

## Finanz-Logik (KRITISCH – exakt so umsetzen!)

### Spieler-Kontostand

```
Kontostand = Σ(payout - buyins × buyin_kasse aus jeweiligem Spiel) + Transaktionen_ein - Transaktionen_aus

kostenProBuyin:
  - EINE zentrale Funktion kostenProBuyin(spiel) in index.html (Finanzlogik-Sektion):
    buyin_pot + buyin_kassa wie am Spiel gespeichert (Fallback: globale Einstellungen).
    KEINE Sonderfall-Heuristik im Code – nie wieder kopieren/inline nachbauen!
  - Jedes Spiel speichert die Faktoren beim Eröffnen als Snapshot der globalen
    Einstellungen (spiele.buyin_pot / buyin_kassa). Sonder-Spielabende (z.B.
    Pokernacht: niedrigerer Pot, keine Kassa) = vor Spielstart die Einstellungen
    anpassen, danach zurückstellen.
  - Sonderfälle stehen explizit in den Daten: Alt-Spiele (Pot 2.5) und Online-Spiele
    haben buyin_kassa=0 gespeichert (Migration 20260713_altspiele_buyin_kassa_0.sql).
  - Leihgabe ist nur informativ und wird niemals in Kontostände (Bankkonto, Pokerkasse, Spieler-Kontostand) berücksichtig
```

### Bankkonto

```
Bankkonto = Einzahlungen (leer→Spieler) - Auszahlungen (Spieler→leer) + Eingänge (leer→Bank) - Ausgaben (Bank→leer)
```

### Pokerkasse

```
Pokerkasse = Bankkonto - Summe(alle Spieler-Kontostände ohne Bank) (Status des Spielers spielt keine Rolle, auch ein Inaktiver Spieler kann einen Kontostand haben)
```

## Rollen & Berechtigungen

- **Admin** (ist_admin=true): Darf alles – Spieler verwalten, löschen, Einstellungen ändern
- **Spieler**: Darf lesen, Transaktionen hinzufügen/editieren, Spiele verwalten, Hände erfassen
- **Niemand außer Admins** darf löschen (Spieler, Transaktionen, Hände)
- **Nicht registrierte User** (Email nicht in spieler-Tabelle): Zugang wird nach Login verweigert

## App-Struktur

### Navigation (Bottom Nav)

1. **Home**      – Übersicht: Mein Konto, Kasse (Bankkonto + Pokerkasse), Alle aktiven Spieler
2. **Spiel**     – Aktuelles Spiel: Neues Spiel, Buy-Ins zählen, PayOut, Teilnehmer verwalten
3. **Verlauf**   – Abgeschlossene Spiele chronologisch mit Ergebnissen
4. **Statistik** – Rangliste, Statistiken, Besondere Hände
5. **Konto**     – Transaktionen: Liste + neue Transaktion
6. **Hände**     – Besondere Hände erfassen

### Dropdown (Avatar-Button oben rechts)

- Theme-Wechsel (Hell/Dunkel/Auto)
- Spielerverwaltung (nur Admin)
- Einstellungen (nur Admin)
- Profil
- Poker Infos
- App-Info & Changelog
- Debug: Console (nur Admin)  – Browser-Logs in der App
- Debug: Rohdaten (nur Admin) – Lesezugriff auf alle DB-Tabellen
- Abmelden

### Sub-Seiten (ohne eigenen Nav-Tab)

- `spieler-stats`  – Spieler-Statistik (von Home oder Statistik erreichbar)
- `spieler-detail` – Spieler bearbeiten (von Verwaltung)
- `spiel-detail`   – Spieldetail (von Verlauf)
- `einstellungen`  – BuyIn-Faktoren + Jahresspende (nur Admin)
- `console`        – Debug: Browser-Console (nur Admin)
- `rohdaten`       – Debug: Datenbank-Rohdaten (nur Admin)
- poker infos (über Avatar Menü)
- profil (über Avatar Menü)

## Design-Regeln (STRIKT einhalten)

### Was VERBOTEN ist:

- ❌ Kein `linear-gradient`, kein `radial-gradient` (nirgends!)
- ❌ Kein Emoji als UI-Icon (nur als dekoratives Element z.B. Login-Suits)
- ❌ Keine generischen Fonts (kein Arial, kein Inter)

### Was verwendet wird:

- ✅ **Font:**   DM Sans + DM Mono (Google Fonts)
- ✅ **Icons:**  SVG Inline (Lucide-Style, stroke-based)
- ✅ **Farben:** CSS Custom Properties (Design Tokens)
- ✅ **Kein Gradient** – nur `var(--surface)`, `var(--bg-secondary)` etc.

### CSS Design Tokens (Light/Dark)

```css
/* Light */
--bg: #f2f2f7
--surface: #ffffff
--bg-secondary: #e8e8ed
--text-primary: #1c1c1e
--text-secondary: #6c6c70
--text-tertiary: #aeaeb2
--accent: #16a34a
--accent-soft: #dcfce7
--accent-text: #15803d
--danger: #dc2626
--danger-soft: #fee2e2
--border: rgba(0,0,0,.08)

/* Dark */
--bg: #0d0d0f
--surface: #1c1c1e
--accent: #22c55e
--accent-text: #4ade80
```

### Mobile-First (iOS + Android)

- Safe Area: `env(safe-area-inset-top/bottom/left/right, 0px)`
- Header: `position: sticky; backdrop-filter: blur(20px)`
- Bottom Nav: `padding-bottom: var(--safe-bottom)`
- theme-color meta tag wird bei Theme-Wechsel aktualisiert

## UX-Regeln

- Bestätigungsdialog vor JEDER Löschaktion: `confirm("⚠️ Löschen bestätigen\n\n{was}\n\nDiese Aktion kann nicht rückgängig gemacht werden.")`
- Sync-Status Icon im Header (grün=OK, gelb=läuft, rot=Fehler)
- Console-Logging für alle wichtigen Aktionen
- Auto-Save bei Feldänderungen (kein manueller Speichern-Button wo vermeidbar)

## Versionierung

- Meta-Tag: `<meta name="version" content="X.X">`
- JS Konstante: `const VERSION = 'X.X'`
- Bei jeder Änderung beide hochzählen (1.7 → 1.8 etc.)
- Bei grösseren Änderungen (DB Struktur ändert, neuer Service wie Push Notification, etc.) eine Hauptversion zählen
- Bei kleineren Änderungen die Nebenversion hochzählen
- Immer das Changelog aktuell halten NACH meiner Freigabe. 
  - Ablauf:
    1. auf einem Feature-Branch committen und pushen (NICHT direkt auf main)
    2. Zusammenfassung der Anpassungen und was zu testen ist ausgeben (inkl. Vercel Preview-URL falls bekannt)
    3. auf Test Ergebnisse warten
    4. wenn alles ok ist, changelog Inhalt entwerfen und ausgeben
    5. erst nach ausdrücklichem Einverständnis: Version & Changelog im Code aktualisieren, auf dem Feature-Branch committen, dann in `main` mergen und `main` pushen
- **Aktuelle Version: 4.21**

## Login-Provider

- ✅ Google (funktioniert)
- ✅ Facebook (aktiv, seit v3.0)
- ✅ LinkedIn (aktiv, Provider `linkedin_oidc`, seit v3.0)
- ~~Apple~~ (entfernt)
- ~~Microsoft/Azure~~ (entfernt)
- Callback URL: `https://bcvyhlzjpfezokvcjksn.supabase.co/auth/v1/callback`
- Login-Buttons in `index.html` (`btn-login-google`, `btn-login-facebook`, `btn-login-linkedin`) → `loginWith('google'|'facebook'|'linkedin_oidc')`

## Feature-Roadmap / Offene TODOs

| # | Feature                                                                             |  Status  |
|---|-------------------------------------------------------------------------------------|----------|
| 1 | Hand Statistik Seite (Erfassen mit Hand-Typ, Gewinner, Kommentar, Beweisfoto-URL)   | ✅ v1.7  |
| 2 | 7-2 Automatismus: auto Transaktionen beim Erfassen                                  | ✅ v1.7  |
| 3 | Spiel Verlauf: Detail-Ansicht pro Abend (anklickbar)                                | ✅ v1.7  |
| 4 | Admin: Jahres-Spende Automatismus                                                   | ✅ v1.7  |
| 5 | Info & Changelog Seite                                                              | ✅ v1.8  |
| 6 | Pokerkasse-Berechnung korrigiert (Bank-KS ausgeschlossen)                           | ✅ v1.9  |
| 7 | iOS Input-Zoom behoben (font-size 16px)                                             | ✅ v1.9  |
| 8 | Spieldetail: Admin-Bearbeitung nachträglich                                         | ✅ v1.9  |
| 9 | Admin-guard für Transaktion löschen                                                 | ✅ v2.0  |
| 10 | Spieler-Stats Backnavigation fix                                                   | ✅ v2.0  |
| 11 | Admin: Debug-Console (Browser-Logs in der App)                                     | ✅ v2.1  |
| 12 | Admin: Rohdaten-Viewer (DB-Tabellen lesend)                                        | ✅ v2.1  |
| 13 | Admin: Admin-Rolle anderen Spielern zuweisen                                       | ✅ v2.1  |
| 14 | Numpad auf Mobil für Betragsfelder                                                 | ✅ v2.1  |
| 15 | Horizontale Scrollbalken behoben                                                   | ✅ v2.1  |
| 16 | Statistik: Charts + bessere Datenvisualisierung (Verlauf, Gewinn-Charts)           | ✅ v2.2  |
| 17 | Google Account-Wechsel (Profil wechseln beim Login)                                | ✅ v2.2  |
| 18 | Facebook / Apple / Microsoft Login in Supabase konfigurieren                       | ✅ fertig |
| 19 | Altdaten-Migration (inkl. Profilbilder)                                            | ✅ fertig |
| 20 | Profil-Seite: Name ändern, Profilbild (Base64), Profil wechseln, Abmelden          | ✅ v2.11 |
| 21 | Buy-In Minimum = 1 (kein Minus auf 0 möglich)                                      | ✅ v2.11 |
| 22 | Doppelte Spieler im aktiven Spiel verhindern                                        | ✅ v2.11 |

## Terminologie: «Online-Modus» (früher anders benannt)

Der Online-Poker-Modus heisst seit v4.7 überall einheitlich **«Online-Modus»**.
Der frühere interne Name (P-Wort) darf NIRGENDS mehr auftauchen – nicht in UI-Texten,
Changelog-Einträgen, Code-Kommentaren oder Dokumentation. Umbenannt wurden dabei auch:
- localStorage-Key: `dtks_online_entdeckt` (Migration vom alten Key beim App-Start in index.html)
- DB-Spalte: `spieler.online_entdeckt_am` (per Supabase-Migration vom alten Spaltennamen umbenannt, Juni 2026)
- Funktion `_unlockOnlineModus()`, CSS/JS-Sektions-Kommentare, SYSTEM_PROMPT der Edge Function `dealer-comment`

> **Stand v4.9:** Der Live-DB-Tabellen-Kommentar auf `online_spiele` wurde bereinigt (jetzt „Online-Modus: …",
> Migration `20260710_call_teilnehmer_bot_rebuy.sql`). Verbleibend, aber unkritisch:
> die historischen `supabase/migrations/*pandemie*.sql` (Dateinamen/Kommentare der Migrations-Historie – bleiben
> als Aufzeichnung unverändert). Die localStorage-Migration `dtks_pandemie_entdeckt → dtks_online_entdeckt`
> in index.html referenziert den alten Key **bewusst** (nötig für die Migration) und ist kein Verstoss.

---

## Letzte Anpassungen

- ~~**QC-Paket (App-Quality-Review)**~~ ✅ v4.21 – Prüfpaket aus einer vollumfänglichen QC (UX, Bugs, Inkonsistenzen, iOS/Android). Alles in `index.html` (+ CLAUDE.md-Doku), **keine** DB-/Edge-Function-/Finanzlogik-Änderung. **B1:** `showApp()` lief beim Start doppelt – `onAuthStateChange` feuert zusätzlich `INITIAL_SESSION`, der Bottom-Init (`getSession()`) war ungeguardet → Bottom-Init setzt/prüft jetzt `_appInitialized` (eine Ausführung statt zwei, keine doppelten Home-Queries/letzter_login-Updates). **B2:** `buyinChange` rollt die optimistische Anzeige (`count`/`pot`/`t.buyins`) bei Speicherfehler zurück – vorher drifteten lokaler Stand und DB dauerhaft auseinander. **B3:** `save()` gibt jetzt einen Erfolg-Boolean zurück; das Transaktions-Modal (Speichern **und** Löschen) bleibt bei Fehler offen und behält die Eingaben, der Push feuert nur bei echtem Erfolg (Toast wie bisher). **M1:** Blind-Editoren (`.blind-levels-editor td input` + Inline-Editor am Online-Tisch) und `.pm-chat-input` von 13/14px auf `font-size:16px` → kein iOS-Fokus-Zoom mehr. **M2:** Touch-Targets vergrössert – Buy-In-Zähler `.counter-btn` 34→44px, `.eq-edit-btn` 28→36px, `.eq-remove` 36→44px. **M3:** `checkForUpdate()` fordert die Versions-Info per `Range: bytes=0-2047` an (Version-Meta steht im `<head>`) → nur ~2 KB statt der ~900-KB-`index.html`; Server ohne Range-Support liefern 200 mit vollem Inhalt (Fallback, `r.ok` deckt 200+206). **I1:** tote CSS-Regel `.app-container` entfernt (Element existierte nie im DOM; die App nutzt `#app-screen`). **I2:** hartcodierte Badge-Farben (amber `#fef3c7`/`#92400e`, all-in-orange `#fff7ed`/`#c2410c`, violett `#ede9fe`/`#f5f3ff`/`#7c3aed`, blau `#eff6ff`/`#2563eb`) durch neue theme-aware Tokens `--badge-amber/violet/blue-bg|-text` ersetzt (Licht-Werte = Original → Hellmodus optisch unverändert, saubere Dark-Varianten). Bewusst fix belassen: Spielkarten-Rot (`.play-card.red` etc., colorblind-Override greift separat), Tisch-SVG-Filz-Farben (Seat-Ringe/Dealer-Button/Seat-Status), die kategorische Chart-Farbpalette und der solide Alert-BG `#c2410c` (mit weissem Text in beiden Themes robust; `--warning`/`#fbbf24` hätte den Dark-Kontrast verschlechtert); `.pm-feed-narrator` war bereits theme-gesplittet. **I3:** Login-Provider-Sektion in CLAUDE.md auf Ist-Stand (Google + Facebook + LinkedIn aktiv). **I4:** Online-Modus-Beträge einheitlich mit Komma-Dezimal via neuem Helfer `nEur(v)` (`toLocaleString('de-DE',…)`, ohne €-Präfix – die Templates setzen `€` selbst davor, bewusst kompakt ohne nbsp wegen enger Tisch-Labels/SVG-Texte). 44 Anzeige-Stellen umgestellt; geparste `data-val`/`data-amount` und Input-Values (Raise-Sheet) bewusst punkt-formatiert belassen (Regex bewusst auf `€${…}`-Anzeigen begrenzt, per Dry-Run + ESM-Syntaxcheck verifiziert – nicht-gieriges `[^}]*?` verhindert Sprung über Template-Grenzen bei benachbarten `€${…}` ohne `toFixed`). **U1 (Punkt 1):** `loadHome` lädt nur noch die für die Saldenberechnung genutzten Spalten (`transaktionen`: von/nach/betrag; `spiel_teilnehmer`: spieler_id/spiel_id/payout/buyins, `spiele`-Embed auf `abgeschlossen` reduziert = nur Inner-Join-Filter) statt `select('*')` – reine Bandbreiten-Optimierung, keine Verhaltensänderung; identische Queries in anderen Screens bewusst unangetastet. Offen/verworfen: B4 (`_shakeEnable()` leer) auf Wunsch ignoriert; U1-Punkt 2 (Server-RPC für Salden) als späteres Paket offen; U2 (Payout-Banner ohne isAdmin-Guard) unverändert.
- ~~**Scroll-Regression aus v4.19 behoben**~~ ✅ v4.20 – Ein-Zeilen-CSS-Fix in `index.html`, keine DB-/Edge-Function-/Finanzlogik-Änderung. **Ursache:** v4.19 (2) legte `overscroll-behavior-y:contain` auf **`.content`** – das ist aber **nicht** der Scroll-Container. In Blink (Chrome, auch Android) scrollt `body`/window (`.content` wächst auf volle Höhe; vgl. Code-Kommentar „body scrollt, nicht .content" beim Window-Scroll-Listener). In der Chrome-Geräte-Emulation (DevTools, Handy-Modus) fing das nicht-scrollende `overflow-y:auto`-`.content` die Touch-Geste ab und `contain` unterband das Scroll-Chaining zum window-Scroller → **nach unten scrollen blockiert**; Pull-to-Refresh funktionierte weiter, weil die Custom-PTR das Touch-Delta direkt liest (kein echtes Scrollen). Echtes iPhone (WebKit) war nicht betroffen (Containment auf nicht-scrollendem Element greift dort nicht; Standalone-PWA hat kein natives PTR). **Fix:** `overscroll-behavior-y:contain` von `.content` auf **`body`** (den tatsächlichen Scroller) verschoben. Bonus: dort unterdrückt es Chrome-Androids natives Pull-to-Refresh **korrekt** – was v4.19 (2) eigentlich bezweckte, auf `.content` aber nie erreichte. Custom-PTR (passiv, delta-basiert) unberührt, iOS unverändert. Die `body.pm-tisch`-Overrides (`overscroll-behavior-y:none` am Online-Tisch, wo `.content` via `overflow:hidden`-Eltern echt intern scrollt) bleiben bestehen.
- ~~**Android-Optimierungen (technisch + visuell)**~~ ✅ v4.19 – Prüfpaket für Android (iOS war Primärplattform, bisher ungetestet auf Android). Alles in `index.html`, `manifest.json`, `sw.js` + neue Icon-Assets; **keine** Änderung an Finanzlogik, DB oder iOS-Verhalten (Fixes sind Android-only oder rein additiv). **(1) Landscape:** `manifest.json` `"orientation":"portrait"` entfernt – installierte Android-PWA sperrte sonst das Querformat (Blind-Timer-Vollbild + Online-Tisch Side-by-Side funktionierten dort nicht; iOS ignoriert das Feld ohnehin). **(2) Pull-to-Refresh:** `.content` bekam `overscroll-behavior-y:contain` → Chrome-Androids nativer Seiten-Reload feuerte bisher zusätzlich zur Custom-PTR (die JS-PTR nutzt `passive:true` und kann nicht `preventDefault`). iOS-Standalone hat kein natives PTR → dort war es unsichtbar. **(3) Push-/PWA-Icons:** `sw.js`-Defaults `/icons/icon-192.png` + `/icons/badge-72.png` liefen ins 404; echte PNGs angelegt. Zusätzlich das Emoji-in-SVG-Manifest-Icon (auf Android-Launchern oft leeres Tofu-Icon, da Emoji nicht rasterisiert) durch gerasterte Vektor-Spade-PNGs ersetzt: `icons/icon-192.png`, `icon-512.png` (`purpose:any`) + `icon-maskable-512.png` (`purpose:maskable`, adaptive Icon ohne Chrome-Badge bei WebAPK). Generiert via Playwright/Chromium aus dem Bootstrap-Icons-Spade-Pfad (kein Emoji). **(4) `manifest.theme_color`** `#ffffff` → `#0d0d0f` (passte nicht zur dunklen App). **(5) Keyboard:** Viewport-Meta um `interactive-widget=resizes-content` ergänzt + Modal `max-height:92vh`→`92dvh` → Android-Softkeyboard verdeckt Bottom-Sheet-Eingabefelder nicht mehr (iOS ignoriert `interactive-widget`). **(6) Foto-Inputs:** `capture="environment"` bei Beweisfoto (`hand-foto-input`) + Equity (`eq-photo-input`) entfernt → Android bietet wieder Kamera **oder** Galerie statt Kamera zu erzwingen. **(7) `@supports`-Fallback für `backdrop-filter`** → Header/Nav voll deckend auf Browsern ohne Blur (ältere Android-WebViews), sonst durchscheinender Text. **(8) PWA-Installierbarkeit:** `sw.js` um einen `fetch`-Handler ergänzt (Navigations-Requests pass-through, kein Caching) – ein registrierter SW **mit** fetch-Handler ist Chrome-Voraussetzung, damit `beforeinstallprompt` feuert (sonst kein Auto-Install-Dialog und der Menü-Eintrag zeigte nur „Nicht jetzt", da der Installieren-Button an `hasPrompt` hängt). `showPwaSheet` zeigt im Android/Desktop-Zweig jetzt eine manuelle Anleitung (Chrome-Menü → „App installieren"), wenn das Event (noch) nicht bereitsteht. **Hinweis/Grenze:** Emulatoren (z.B. appetize.io) ohne Google Play Services können grundsätzlich kein WebAPK erzeugen → dort immer nur eine gebadgte Verknüpfung mit Platzhalter-Icon; der Chrome-Badge und das echte Spade-Icon sind nur auf echten Geräten (WebAPK-Installation) korrekt und **nicht per Code abschaltbar**.
- ~~**QC-Nacharbeiten (Paket 8)**~~ ✅ v4.18 – Kurze Restliste nach den 7 Refactoring-Paketen. **N2 (DB-Änderung):** Neue Spalte `online_spiele.buyin_pot` (Migration `20260716_online_spiele_buyin_pot.sql`, nullable, live appliziert) – Buy-In-Faktor/Chip-Euro-Kurs wird jetzt beim Session-Erstellen als Snapshot aus `einstellungen.buyin_pot` mitgeschrieben (gleiche Fehlerklasse wie K3 bei Cash-Spielen). Alle Kurs-Nutzer lesen `session.buyin_pot ?? einstellungen.buyin_pot` (Fallback für Alt-Sessions = NULL): `_pmBuyInSheet`, `_pmShowBrokeModal` (Buy-In-Button zeigt jetzt die echten Kosten statt fälschlich `start_stack`), `_pmPayoutModal`/`doFinish` (spiele.insert) **sowie** die Session-/Ø-Runde-KPI-Karten in `renderOnlineTisch` und der Beobachter-„Mitspielen · Buy-In"-Button (`_pmActionArea`). Session-Erstellen-Formular (`pm-new-stack`-Feld, Vorbelegung) und die Cash-Logik (`kostenProBuyin`) bleiben bewusst auf `einstellungen`. **N4:** Push-Titel „Neue Transaktion" nutzt `fmt(betrag)` statt `€${betrag.toFixed(2)}`. **N5:** `has-keyboard`-Erkennung Android-sicher – der reaktive Keydown-Pfad greift nur noch mit `matchMedia('(pointer:fine)')`; bereits falsch in `localStorage.dtks_has_keyboard` persistierte Werte werden beim Start ohne fine-Pointer verworfen (Soft-Keyboard-Keydowns markieren das Handy nicht mehr dauerhaft als Tastatur-Gerät → Betrags-Numpad bleibt). **N9:** `checkForUpdate()` läuft zusätzlich bei `visibilitychange` (Tab wieder sichtbar), gedrosselt auf max. 1×/Stunde via `_lastUpdateCheck`-Timestamp. **N10:** `_transRenderBatch` – Tages-Header zeigt die Summe IMMER: beteiligt → mein Netto mit Vorzeichen+Farbe (`ksClass`/`fmtSigned`), nicht beteiligt → neutral grau die Brutto-Tagessumme (`fmt`, kein sinnloses „€ 0,00"); `myNet`/`brutto`/`involved` wachsen batch-übergreifend in `_transCurGroup`. **N11:** `save()`-catch ruft zusätzlich `showToast('Speichern fehlgeschlagen …')`. **N12 (reines Refactoring):** Verlauf- und Transaktions-Lazy-Loading auf einen gemeinsamen Helper `createLazyList({pageSize,containerId,loaderId,fetchPage,renderBatch,loadingHtml,emptyHtml,beforeFetch,onReset})` umgestellt (range-Batches, Loader am Ende, Window-Scroll-Listener, Cleanup, Pull-to-Refresh-Reset). Verhalten identisch inkl. Tages-Gruppen-Fortsetzung; tote State-Vars (`_verlaufSpiele`, `_verlaufScrollEl`) entfernt. Einzige Angleichung: ein Nachlade-Fehler im Verlauf zeigt jetzt – wie bei den Transaktionen – einen Toast (vorher endete der Verlauf still). `node --check` auf den Modul-Block grün. Bewusst NICHT angefasst: Payout-Banner-Berechtigung, clientseitige Buy-In-Regeln, Bank-Erkennung, 7-2-Empfängerkreis.
- ~~**„Dabei seit" ohne Datum in der Spieler-Statistik**~~ ✅ v4.17 – Reiner Anzeige-Fix in index.html, keine DB-/Edge-Function-Änderung, Finanzlogik unangetastet. `showSpielerStats` liest `spieler.eintrittsdatum` aus dem übergebenen Objekt (`const seit=...eintrittsdatum?fmtDate(...):'–'`). Die beiden Feeder-Queries (`loadHome` Zeile ~2954 und `loadStatistik` Zeile ~5301) selektierten die Spalte aber nicht (schlanke Selects aus den Performance-Optimierungen) → `eintrittsdatum` war stets `undefined`, Fallback `–` bei allen Spielern. **Fix:** `eintrittsdatum` in beide Selects aufgenommen. Zusätzlich in `showSpielerStats` ein Fallback: fehlt das Feld doch (z.B. Online-Tisch-Pfad via `seat.spieler`), wird es **parallel** in der bestehenden `Promise.all`-Sammlung nachgeladen (`needSince`-Guard → nur bei fehlendem Feld eine Extra-Abfrage; Home/Statistik liefern es bereits mit). Der v4.16-Umbau (`toLocaleString`→`fmtDate`) berührte nur die Zeile, nicht die Ursache.
- ~~**Pokerkasse-Filter, AT-Zeitzone durchgängig, Selbst-Transfer-Schutz**~~ ✅ v4.16 – Alles in index.html, keine DB-/Edge-Function-Änderung, Finanzlogik-Werte unangetastet. **(1) Pokerkasse-Detail (`loadPokerkasseDetail`):** Bots werden nie mehr gelistet (`!s.ist_bank && !s.ist_bot`) – sie zählen nie zur Pokerkasse (nur „just for fun" in Online-Sessions, Payout erstellt für sie keine `spiel_teilnehmer`, Balance stets 0). Neuer `relevant`-Filter `s.aktiv || Math.round((ks||0)*100)!==0` → alle aktiven + nur inaktive mit Kontostand ≠ 0,–. `spielerSumme`/Zähler/„Gesamt" laufen jetzt über die Anzeige-Liste (`anzeige`); da Ausgeschlossene (Bots + inaktiv-mit-0) exakt 0 beitragen, bleibt der Pokerkasse-Wert identisch zur Home-Kachel. **(2) Zeitzone → immer Österreich (`Europe/Vienna`), geräteunabhängig:** neue Konstante `APP_TZ`. `localDateStr()` liefert den AT-Kalendertag via `Intl.DateTimeFormat('en-CA',{timeZone:APP_TZ}).formatToParts` (statt `getFullYear/getMonth/getDate` = Gerätezeitzone) → Erfassung nach Mitternacht im Ausland landet am korrekten AT-Tag. Neue Anzeige-Helfer `fmtDate(value,opts)` (date-only-Strings als UTC-Mitternacht → in Wien derselbe Tag; volle Timestamps in AT), `fmtTimeAT(dt)` (HH:MM in AT) und `fmtDateTimeAT(ts)` ersetzen ALLE zuvor geräte-lokalen `new Date(x).toLocaleDateString(LOCALE,…)`/`getHours`-Anzeigen: Benachrichtigungen, Spieler-Stats („Dabei seit"), Timeline (Spiel/Transaktion), Spielerverwaltung (`fmtLogin`→`fmtDateTimeAT`), Push-Geräte-Übersicht, Transaktionsliste, aktives Spiel, `schliesseSpielAb`, Verlauf, Spiel-Detail (inkl. Lösch-Confirm), Head-to-Head-Drilldown und Online-Lobby („Beendet": Datum + Start/Ende-Uhrzeit via `fmtTimeAT`). Der Live-Debug-Console-Zeitstempel (Capture-Zeit auf dem Gerät) bleibt bewusst gerätelokal. **(3) Neue Transaktion (`openTransaktionModal`):** `_transSync()` deaktiviert dynamisch im jeweils anderen Dropdown die gewählte Person (kein Selbst-Transfer, „– leer –" bleibt beidseitig wählbar), gesetzt via `onchange=` (kein Listener-Stacking); zusätzlicher Guard im Speichern-Handler (`von&&nach&&von===nach`).
- ~~**UX-Polish (Paket 7)**~~ ✅ v4.15 – Letztes Paket der Refactoring-Roadmap, alles in index.html, keine DB-/Edge-Function-Änderung, Finanzlogik unangetastet. **U1:** `loadTransaktionen` von hartem `.limit(100)` auf Lazy-Loading nach Verlauf-Vorbild umgestellt (`_TRANS_PAGE=20`, `.range()`-Batches, `#trans-loader` am Ende, Window-Scroll-Listener, `_transCleanup()` in `showPage`; Pull-to-Refresh via `PAGE_LOADERS` resettet State). Neu: `_transRenderBatch`/`_transLoadMore` + `_transCurGroup` hält den offenen Tages-Block über Batch-Grenzen (Datums-Gruppe wird fortgesetzt statt doppelt gerendert; Tagessumme = eigenes Netto, wächst beim Nachladen mit). **U2:** Jahresspende-Zielwert als `einstellungen`-Key `jahresspende_ziel` persistiert (Vorbefüllung via `numVal('jahresspende_ziel',100)`, Upsert beim Klick auf „durchführen"). **U3:** Aktives Spiel: `btn-abschliessen` → `btn-primary` (primäre Erfolgs-Aktion), `btn-spiel-loeschen` → `btn-danger` (destruktiv); Disabled-Gate (Rest=0) unverändert. **U4:** PM-Numpad-Interceptoren (`_interceptStart`/`_interceptEnd`/`_interceptMouse`) brechen bei `document.body.classList.contains('has-keyboard')` ab → natives Tippen; zentraler capture-`change`-Normalizer wandelt Komma→Punkt für `pm-num`-Felder (Numpad liefert bereits Punkt-Werte, daher No-Op). **U5:** Wiederverwendbarer `showToast()` (danger, unten über der Nav, auto-hide ~4s, Design-Tokens/`--danger-soft`/`--danger`, kein Gradient) in loadHome/loadSpiel/loadVerlauf/loadStatistik/loadTransaktionen/loadHaende bei Query-`error`. **U7:** `renderOnlineTisch` rendert bei `status==='finished' && !session.spiel_id && !session.is_test` ein Banner „Abrechnung ausstehend" (eigene Sektion `pm-s-banner`, in Full-Rebuild via `_pmBindEvents` und im Incremental-Update-Loop; Button `btn-pm-payout-banner` → `_pmPayoutModal()`); `spiel_id` in `_pmFingerprint` ergänzt, damit das Banner nach Payout-Übernahme verschwindet; In-App-Hilfe (`#pm-info-modal`, Abschnitt „Abrechnung") um einen Satz ergänzt. Offen (bewusst NICHT mitgefixt, Chris zur Entscheidung): Banner-Button ist – wie in der Spec – nicht auf `isAdmin` gegated (regulärer Payout-Einstieg ist admin-only, `_pmPayoutModal` hat keinen internen Guard); `has-keyboard` kann auf Android durch Soft-Keyboard-Keydown gesetzt werden, wodurch der Numpad dort entfiele (iOS = Primärplattform, unkritisch).
- ~~**Konsistenz & Aufräumen (Paket 6)**~~ ✅ v4.14 – Reines Konsistenz-Paket, keine Änderung an der Finanzlogik (Kontostände/Bankkonto/Pokerkasse identisch). **I1:** Alle Nicht-Online-Anzeige-Stellen von direktem `€${x.toFixed(2)}` auf `fmt()`/`fmtSigned()` umgestellt; `fmtSigned()` nutzt jetzt Tausendertrennung (gleiche de-DE-Zahlformatierung wie `fmt()`) und ist bei 0 (nach Cent-Rundung) neutral (**U8**). Neuer Helper `fmtInput(v)=v.toFixed(2).replace('.',',')` für Betragsfelder (Payout im aktiven Spiel + `trans-betrag`): eingetippte Werte zeigen jetzt Komma (5,00), bewusst OHNE Tausendertrennung, damit via `.replace(',','.')` parsebar. Input-VALUES sonst, Berechnungen, DB-Werte, Edge Functions, Online-Tisch-Chips und der Sidepot-Rechner bewusst unangetastet; `data-neu` bleibt punkt-formatiert (direktes parseFloat); Spiel-Detail-Edit-Payout bleibt `type=number`. **I2:** Eine Datums-Locale `const LOCALE='de-AT'`, alle `toLocaleDateString`-Aufrufe (vorher de-AT/de-CH/de-DE gemischt) + die Spieler-Stats-„Dabei seit"-`toLocaleString` darauf umgestellt – de-AT/CH/DE liefern identische Datumsausgaben, also keine sichtbare Änderung. **I3:** `loadTransaktionen` zeigt Beträge aus Sicht von `currentSpieler` (Empfänger grün +, Sender rot −, unbeteiligt neutral `amount-zero`); Tagessumme = eigenes Netto (`nach===meId?+betrag:0 - von===meId?betrag:0`). **I4:** Letztes natives `confirm()` (Equity-Seite verlassen bei laufender Foto-Analyse) durch async `confirmAction()` ersetzt (`showPage(page,_skipEqCheck)` ruft sich bei Bestätigung selbst erneut auf). **I5:** Globales `window._pmGlobalPoll` von 10s auf 20s, irreführender „30s"-Kommentar korrigiert. **B6:** Listener-Akkumulation im Transaktions-Modal behoben (`oninput=` statt wiederholtem `addEventListener` auf `#trans-kommentar-text`; `modal-spieler-form`/`modal-hand` gegengeprüft – dort modul-global, kein Leck). **B7:** Toter Code entfernt (`loadProfil` `avatarHtmlLg` inkl. doppelter `id="profil-avatar-img"`-Quelle, auskommentierter `avatarLg`-Block in `showSpielerStats`, doppeltes `btn-console`/`btn-rohdaten`-Display in `showApp`).
- ~~**Push-Kategorien & Bot-Filter (Paket 5)**~~ ✅ v4.13 – **B1:** `session_start` fehlte im initialen `push_subscriptions`-Upsert (UI hakte die Checkbox ab, `loadPushState` las danach `false`) → Upsert setzt jetzt alle Kategorien via zentralem `PUSH_CAT_DEFAULTS`; `session_start` auch in der Admin-Push-Übersicht (`showSpielerDetail` → `catLabels`, Label „Session gestartet") ergänzt. **B2:** Eine zentrale Default-Definition `const PUSH_CAT_DEFAULTS` (alle 7 Kategorien default AN) + Helper `pushCatEnabled(einstellungen, kat)` (fehlender/null Key → Default aus PUSH_CAT_DEFAULTS, explizit `false` → aus), verwendet in `loadPushState` UND der Admin-Ansicht (ersetzt die zuvor 3 unterschiedlichen Interpretationen). Edge Function `send-push` angeglichen: Kategorie-Filter jetzt in JS mit identischer Semantik (eigene `PUSH_CAT_DEFAULTS`/`pushCatEnabled`-Kopie im Deno-Code) statt DB-seitigem `eq('einstellungen->>kat','true')`, das alte Subscriptions ohne den Key fälschlich ausschloss. API-Vertrag unverändert; Edge-Deploy ging beim Push sofort live (kein Branch-Filter). **B3:** `ist_bot`-Filter in `loadStatistik` (Rangliste/Filterchips) und im Jahresspende-Handler (keine Ausgleichs-Transaktionen für Bots) ergänzt. `ist_bot` ist nullable (default false) → NULL-sicherer Filter `.or('ist_bot.is.null,ist_bot.eq.false')` (Bank mit `ist_bot=false` bleibt erhalten).
- ~~**Online-Spielregeln: Buy-In verschärft + falsche Turn-Pushes**~~ ✅ v4.12 – **B5-neu:** Rebuy im Online-Modus nur noch erlaubt wenn der Spieler pleite ist (`stack===0`), und immer nur GENAU 1 Buy-In auf einmal. `_pmBuyIn()`: Parameter `count` entfernt (hart 1), neuer Guard blockt Buy-In solange Chips vorhanden; `_pmBuyInSheet()`: +/−-Zähler entfernt, zeigt fix 1 Buy-In mit Chips-Wert + Kosten. Button-Einstiege (btn-pm-buyin via `_canBuyin`, btn-pm-spectate-buyin, Stack-leer-Overlay) waren bereits auf `stack===0` gated. Erstmaliges Hinsetzen (Auto-Start-Stack) unverändert. In-App-Hilfe (Abrechnung) ergänzt. **B4:** `poker-action` feuert keinen „Du bist dran"-Push mehr, wenn `executePreActionIfSet` den Zug sofort per Auto-Aktion weitergegeben hat (gibt jetzt `boolean` zurück) oder der nächste Spieler ein Bot ist (`bot_config` gesetzt). Strikt abwärtskompatibel (kein API-/Schema-Change).
- ~~**PWA Mobile Polish + In-App Benachrichtigungen**~~ ✅ v3.12 – Neue Tabelle `benachrichtigungen` (id, spieler_id, datum, kategorie, title, body, url, tag, gelesen) – triggerPush schreibt zusätzlich pro Empfänger einen Eintrag (broadcast → alle aktiven Nicht-Bank-Spieler); Glocke im Header mit Unread-Badge, nur sichtbar wenn Push-Subscription existiert; eigene Benachrichtigungen-Seite, Auto-Mark-as-Read beim Öffnen, visueller Neu-Zustand bleibt für den Besuch; Deep-Link bei Klick. Blind-Timer: Vollbild im Landscape (Header/Nav weg, Countdown gross, volle Bildschirmbreite via max-width-Override), Wake-Lock aktiv solange Vollbild aktiv (wie Netflix). App-Badge-API: Service Worker zählt ungelesene Pushes aufs App-Icon, Clear bei Öffnen/Fokus. Manueller "App installieren"-Eintrag im Avatar-Menü (nur wenn noch nicht als PWA installiert).
- ~~**Equity-Rechner (Omaha + Texas Hold'em)**~~ ✅ v3.11 – Neues Poker Tool unter Avatar-Menü: bis zu 6 Hände vergleichen, optionales Board (Flop/Turn/River); Modus-Schalter Omaha (Default, 4 Holecards, exakt 2+3 Regel über 60 Kombinationen) vs Texas Hold'em (2 Holecards, 7-Karten-Evaluator); Monte-Carlo 20.000 Iterationen in Batches á 1000 mit Cancellation-Token – laufende Simulationen werden bei Karten-Änderung verworfen; Auto-Calc sobald alle Holecards gesetzt sind, Split-Anzeige bei Gleichstand; Karten-Picker (Farbe + Rang) mit Disable für bereits verwendete Karten; fester 44×62 Slot-Wrapper verhindert Layout-Sprünge; Theme-Umschalter im Avatar-Menü schliesst das Menü nicht mehr (stopPropagation)
- ~~**Spieler×Gegner-Matrix in der Statistik**~~ ✅ v3.10 – Neue Sektion in der Statistik-Seite: Matrix aller aktiven Spieler mit Netto-Saldo pro Paar, Farbcodierung (grün/rot) mit Intensität proportional zum Betrag, Avatare als Spalten-Header mit sticky erster Spalte; Klick auf eine Zelle öffnet Head-to-Head mit dem Paar vorbelegt; respektiert Jahres- und Spieler-Filter; loadH2H akzeptiert jetzt optionale preAId/preBId
- ~~**Head-to-Head in den Poker Tools**~~ ✅ v3.9 – Zwei-Spieler-Vergleich mit großen Profilbildern (140px, Klick → Lightbox), Dropdown mit aktiv/inaktiv-Trennung, Zeitraum-Filter als Jahres-Chips (wie Statistik), KPI-Kacheln, Linien-Chart zum kumulierten Saldo, Besondere-Hände-Sektion für alle Hand-Typen gruppiert (Hände auch via Datum gematcht für Altdaten ohne spiel_id), scrollbare Liste aller gemeinsamen Spiele mit Drilldown in Hand-Modal bzw. Spiel-Detail; Fix im Sidepot-Rechner: × bleibt bei 2 Spielern stabil sichtbar (disabled statt hidden)
- ~~**Sidepot-Rechner + Blind-Timer**~~ ✅ v3.8 – Sidepot-Rechner mit Spieler-Dropdown aus aktivem Spiel, Einsatz-Feld mit Live-Pot-Berechnung, Fold/Im-Spiel-Toggle pro Spieler; Blind-Timer mit Countdown, Level-Wechsel, Wake-Lock und wallclock-basierter Zeitmessung (läuft korrekt weiter bei minimierter App/Standby/Background-Tab); Timer-Badge mittig in der Kopfzeile mit Restzeit + Mini-Progress-Balken solange der Timer läuft (Klick öffnet Timer-Seite); Admin-konfigurierbare Standard-Blind-Struktur via neuer Tabelle `blind_struktur`
- ~~**Poker Tools Menü + Asse-Randomizer**~~ ✅ v3.7 – Neue Sektion "Poker Tools" im Avatar-Menü (alle Nutzer); Asse-legen-Randomizer mit Slot-Maschinen-Animation und Spieler-Vorauswahl aus aktivem Spiel; Stubs für Sidepot-Rechner, Blind-Timer, Head-to-Head
- ~~**Fotos nach Supabase Storage**~~ ✅ v3.6 – Profilbilder (Bucket: profilbilder) und Beweisfotos (Bucket: beweisfotos) werden nicht mehr als Base64 in DB gespeichert; Upload-Flows + Delete-Handler angepasst; Edge Function migrate-fotos für Einmal-Migration bestehender Daten; RLS-Policy FOR ALL auf Bucket-ID
- ~~**DB-Indizes + wöchentliches Backup**~~ ✅ v3.5 – 13 Performance-Indizes auf spiel_teilnehmer, transaktionen, hand_statistik, spiele, spieler und push_subscriptions; neue Supabase Edge Function `weekly-backup` sichert jeden Sonntag 03:00 UTC alle Tabellen als CSV in Storage-Bucket `backups` (Retention 12 Wochen); pg_cron Job im Scheduler
- ~~**Performance-Optimierung Statistik / Hände / Verlauf**~~ ✅ v3.4 – Spieler-Cache eliminiert redundante Profilbild-Transfers (ca. 9 MB) bei Verlauf, Hände und Spiel; Statistik-Screen lädt ohne Base64-Beweisfotos (ca. 17 MB gespart); Hände-Screen lädt Fotos erst beim Öffnen einer Hand; Home-Screen mit einer statt zwei Spieler-Abfragen
- ~~**Admin Push-Übersicht + Home-Kontostand Fix + Statistik/Verlauf Polish**~~ ✅ v3.3 – Admin sieht in der Spielerverwaltung die registrierten Geräte und Kategorie-Einstellungen pro Spieler (schreibgeschützt); Home-Kontostand aktualisiert sich zuverlässig nach Spielabschluss/Transaktion (Inner-Join auf abgeschlossene Spiele); Verlauf-Kopfzeile SPIELER|BUY-INS|POT + grösserer Block-Abstand; Statistik-Rangliste nach Ø Reingewinn/Spiel, Jahres-Chips absteigend sortiert
- ~~**push_subscriptions in Rohdaten + CLAUDE.md aktualisiert**~~ ✅ v3.2 – Debug: Rohdaten zeigt jetzt auch die push_subscriptions-Tabelle; CLAUDE.md mit Tabellen-Schema ergänzt
- ~~**Admin-Dropdown Sektionen**~~ ✅ v3.1 – Avatar-Menü: Einheitliche Reihenfolge und Sektionen für Admin-Funktionen und Debug-Tools
- ~~**Bankkonto & Pokerkasse Detail-Seiten**~~ ✅ v3.0 – Kacheln auf Home anklickbar; Bankkonto-Detail zeigt alle Buchungsgruppen mit Subtotals; Pokerkasse-Detail zeigt Formel-Aufschlüsselung mit Spielerliste; LinkedIn Login hinzugefügt; Facebook Login aktiviert; Apple & Microsoft Login entfernt
- ~~**Qualitätskontrolle + Login-Fix**~~ ✅ v2.42 – Login-Freeze behoben (Ladeanimation + parallele DB-Calls + fire-and-forget Profilbild); buyin_kassa in allen Queries konsistent
- ~~**Statistik KPIs + App Features**~~ ✅ v2.41 – Neue KPIs Einzahlungen + BuyIn-Kosten in Spieler-Stats und Gesamtstatistik; Info-Seite: collapsible «App Features» Sektion
- ~~**Deep Links + Login Fix**~~ ✅ v2.40 – Klick auf Push-Notification navigiert direkt zum relevanten Screen; Spielergebnis-Payout-Bug gefixt; Login-Freeze durch async Font-Loading behoben
- ~~**Push Notifications Trigger + Admin**~~ ✅ v2.38/2.39 – Spielabschluss + Transaktion + Buy-In + Hand → Push; Admin: manueller App-Update-Push
- ~~**Push Notifications Profil-UI**~~ ✅ v2.37 – Subscribe/Unsubscribe Toggle, Kategorie-Toggles; iOS-Hinweis wenn nicht als PWA installiert
- ~~**Hand-Modal Ansichts-/Editier-Modus**~~ ✅ v2.36 – Bestehende Hände öffnen im Ansichts-Modus; Bearbeiten/Löschen nur Admin
- ~~**New App Version Meldung**~~ ✅ v2.35 – Modal nach App-Start wenn gecachte Version veraltet; Button löst Reload aus
- ~~**Statistik-Seite Filter sticky Fix**~~ ✅ v2.34 – Filter nicht mehr sticky (hat andere Elemente überlagert)
- ~~**Hand-Erfassung Beweisfoto**~~ ✅ v2.34 – Base64-Upload statt URL-Feld; Vorschau mit Lightbox und ×-Button; Thumbnail im Spiel-Detail
- ~~**Profilbild Crop/Zoom**~~ ✅ v2.30 – Crop/Move/Zoom beim Hochladen mit runder Vorschau-Maske; Profilbild antippen → Grossansicht
- ~~**Verlauf Performance**~~ ✅ v2.26–2.29 – Lazy-Loading beim Scrollen (10er-Batches, Window-Scroll-Listener)
- ~~**Was ist neu seit letztem Besuch**~~ ✅ v2.28 – Modal zeigt alle Änderungen seit letztem Login


## Aktueller Backlog / TODOs
1. **Online-Modus Finalisierung** ✅ v4.0 – UI-Polish + Stabilisierung (in main gemerged). Easter Egg, Beobachter-Modus, Karten-Animationen, Vibration, Device-Motion-Easter-Eggs implementiert.
2. **Dealer-Kommentare im Online-Modus** ✅ v4.6 – KI-generiert statt hardcoded: Edge Function `dealer-comment` ruft Claude (Haiku, `claude-haiku-4-5-20251001`, Secret `ANTHROPIC_API_KEY`) auf und schreibt das Ergebnis als `online_actions`-Eintrag (`action:'dealer_comment'`, `meta.text`) → via Realtime sehen alle Spieler denselben Kommentar. Trigger serverseitig in `poker-action`/`poker-showdown`/`poker-new-hand` über `rollDealerTrigger()` + `fireDealerComment()` (fire-and-forget mit `EdgeRuntime.waitUntil`, blockiert nie den Spielfluss; Wahrscheinlichkeiten pro Event in `poker-utils` `DEALER_COMMENT_PROB`, z.B. fold 18%, allin 52%, win_72 95%). WICHTIG: `dealer-comment` ist im Deploy-Workflow `.github/workflows/deploy-edge-functions.yml` als eigener Step eingetragen.
3. **Keyboard-Shortcuts** ✅ implementiert – Physische Tastatur wird erkannt (`body.has-keyboard`,
   proaktiv via `pointer:fine + hover:hover`, reaktiv beim ersten Tastendruck, persistiert in
   `localStorage: dtks_has_keyboard`); Key-Hints (`.pm-key-hint`) nur bei Tastatur sichtbar. Am Online-Tisch
   greift der Handler `_pmOnKeydown`: F=Fold, C=Check/Call, R=Raise, N=Nächste Runde, A=Karten zeigen,
   P=Pause, V=Vorauswahl, 1–4=Pre-Action-Optionen, Esc schliesst Modals/Sheets.
4. **Turnier-Modus** *(spätere Erweiterung)* – Alternatives Spielformat neben Cash Game: fixer Startstack, Eliminierungen statt Buy-Ins, Platzierungen, Preis-Pool-Verteilung (z.B. 50/30/20), Blinds eskalieren via bestehendem Blind-Timer; Statistik-Erweiterung: Turniersiege, ITM-Quote, Ø-Platzierung; vermutlich neues Feld `spiele.modus = 'cash'|'turnier'` + `spiel_teilnehmer.platz`
5. **Push Notifications** ✅ vollständig implementiert:
   - ✅ VAPID Keys generiert (Public Key in App, Private Key als Supabase Secret)
   - ✅ Service Worker `sw.js` mit Push-Handler + Deep Link Navigation
   - ✅ Supabase Tabelle `push_subscriptions` angelegt
   - ✅ Profil-Seite: Subscribe/Unsubscribe + Kategorie-Toggles (5 Kategorien)
   - ✅ Supabase Edge Function `send-push` deployed (npm:web-push)
   - ✅ App-Trigger: Spielabschluss, neue Transaktion, Buy-In, Besondere Hand
   - ✅ Admin: manueller App-Update-Push aus Einstellungen-Screen
   - ✅ Deep Links: Klick auf Notification öffnet direkt den relevanten Screen

### Online-Modus – Offene Bugs & Verbesserungen

*(Neue Issues hier eintragen.)*

- ~~**Video-Call „im Call"-Tracking kaputt**~~ ✅ gefixt (Migration `20260710_call_teilnehmer_bot_rebuy.sql`) –
  Spalte `online_spiele.call_teilnehmer jsonb` ergänzt; die UI (btn-pm-call, Join/Leave + „X im Call")
  funktioniert jetzt. `call_aktiv` wurde bewusst **nicht** angelegt (kein Code nutzt sie).
- ~~**Bot-Auto-Rebuy-Verhalten**~~ ✅ v4.9.2 – Der Session-Toggle „Bot Auto-Rebuy" bleibt (nutzt die in
  v4.9.1 ergänzte Spalte `online_spiele.bot_auto_rebuy`), aber das „Aus"-Verhalten wurde korrigiert:
  ausgeschiedene Bots **verlassen den Tisch nicht mehr**, sondern bleiben sitzen und beobachten
  (`sitting_out`). „An" = nachkaufen wie bisher.
- ~~**texama/texahma Inkonsistenz**~~ ✅ Mode-Wert vereinheitlicht auf `texahma` (index.html Equity-Rechner
  + `equity-explain`). **Rest:** die interne Helper-Funktion heisst noch `_eqEvalTexama` (nur Funktionsname,
  kein Wert – unkritisch).
- ~~**P-Wort im DB-Tabellen-Kommentar**~~ ✅ gefixt – `COMMENT ON TABLE online_spiele` lautet jetzt
  „Online-Modus: …". **Rest:** die historischen `supabase/migrations/*pandemie*.sql` bleiben als
  Migrations-Historie unverändert (bewusst, kein Verstoss).
- **Vorauswahl „Chk/Fold"** – Server-seitig noch in `poker-action/index.ts` vorhanden, aber in der UI nicht exponiert. Kann bei Gelegenheit aus dem Server entfernt werden (jetzt durch das neue Fold-Verhalten, das bei `callAmount=0` automatisch checkt, ersetzt).


## Online-Modus – Wichtige Implementierungsdetails

### Edge Functions (Supabase Deno)
| Function | Status | Key-Logik |
|---|---|---|
| `poker-start-game` | ✅ | Deck mischen, Karten austeilen, Dealer/Blinds setzen |
| `poker-action` | ✅ | Fold/Call/Raise/Check/Allin; All-in wird auf max. was Gegner matchen können gekappt |
| `poker-next-street` | ✅ | Flop/Turn/River; setzt bet_current_round auf 0 (daher für Sidepots unbrauchbar!) |
| `poker-showdown` | ✅ | Sidepots via action-log (investedBySeat), Cent-Rundung, Hold'em/Omaha/Texama |
| `poker-new-hand` | ✅ | Nächste Hand auf Knopfdruck, Dealer-Button weiter |
| `poker-reveal-runout` | ✅ | Rest-Board aufdecken (deterministisch aus gespeichertem Deck) |
| `poker-bot-action` | ✅ | KI-Entscheidung für Bot-Spieler (ist_bot=true); wird vom Client getriggert wenn current_player_id ein Bot ist. Nutzt evalHoldem/evalOmaha/evalTexahma + bot_config (aggressivitaet/risiko/bluff/gespr) |
| `poker-bot-cron` | ✅ | Fallback-Treiber via pg_cron (~30s): findet running Sessions deren current_player_id ein Bot ist und triggert dessen Aktion (falls niemand die App offen hat) |
| `poker-delete-session` | ✅ | Löscht eine Online-Session vollständig (Service Role); besondere Hände in hand_statistik bleiben erhalten |
| `dealer-comment` | ✅ | KI-Dealer-Kommentare (Claude Haiku) → online_actions (action:'dealer_comment') |
| `poker-utils` | 📦 | Shared-Lib (kein Endpoint): CORS-Helper + Hand-Evaluatoren evalHoldem/evalOmaha/evalTexahma, DEALER_COMMENT_PROB |

**Weitere Edge Functions (nicht Online-Modus):**
| Function | Status | Key-Logik |
|---|---|---|
| `send-push` | ✅ | Web-Push-Versand (npm:web-push, VAPID) |
| `weekly-backup` | ✅ | Wöchentliches CSV-Backup aller Tabellen (So 03:00 UTC) |
| `migrate-fotos` | ✅ | Einmal-Migration Base64-Fotos → Supabase Storage |
| `analyze-poker-photo` | ✅ | Tischfoto → Claude Vision → erkannte Community Cards + Hole-Card-Gruppen für Equity-Rechner |
| `equity-explain` | ✅ | Kurze KI-Erklärung (Claude Haiku) zu einem Equity-Rechner-Ergebnis |

> Hinweis: Das ursprünglich im Konzept vorgesehene `poker-notify-turn` wurde **nie gebaut** – Push für „du bist dran" läuft nicht über eine eigene Function.

### In-App Hilfe / FAQ (PFLICHT: immer aktuell halten!)

Die statische Info-Seite `#pm-info-modal` (in `index.html` direkt vor `<script type="module">`) enthält die komplette Spielanleitung für Endanwender. Sie ist über das Kebab-Menü (⋮) → „Spielregeln & Hilfe" erreichbar.

**WICHTIG:** Wann immer eine Funktion des Online-Modus geändert oder ergänzt wird, MUSS der entsprechende Abschnitt in diesem Modal ebenfalls aktualisiert werden. Abschnitte:
- `Spielvarianten` — bei neuer Variante Karte hinzufügen
- `Spielablauf` — bei Änderung am Hand-Flow
- `Aktionen am Tisch` — bei neuer/geänderter Aktion
- `Vorauswahl` — bei Änderung der Pre-Action-Optionen
- `Verdeckte Karten` — bei Änderung des Facedown-Modus
- `Pause` — bei Änderung der Pause-Auto-Aktionen
- `Was wäre noch gekommen?` — bei Änderung des Runout-Flows
- `Reaktionen` — bei Änderung des Emoji-Systems
- `Abrechnung` — bei Änderung des Payout-Flows
- `Tipps` — bei neuen Features die Spieler kennen sollten

### Wichtige Implementierungs-Gotchas
- **`bet_current_round` wird nach jeder Strasse auf 0 gesetzt** – kann NICHT für Sidepot-Berechnung beim Showdown verwendet werden. Stattdessen: `online_actions` als Source of Truth (Summe aller `call/raise/allin/post_sb/post_bb/blind/bet` Beträge pro Spieler pro Hand)
- **Sidepot-Remainder** gehört in `pots[0]` (Hauptpot), nicht `pots[pots.length-1]` (da frühere Strassen-Beiträge zum Hauptpot gehören)
- **Math.floor für Pot-Aufteilung** muss Cent-Level verwenden: `Math.floor(amount/count*100)/100`, sonst gehen Cents verloren

### Payout-Flow (Nicht-Test-Sessions)
1. Admin beendet Session → `status='finished'`
2. Payout-Modal erscheint sofort (nicht nach Navigation)
3. Zeigt: Name, Buy-Ins, Einsatz (buyins × start_stack), Auszahlung (final stack), Netto
4. „Bestätigen": erstellt JETZT `spiele` (mit `abgeschlossen:true, modus:'online'`) + `spiel_teilnehmer` Einträge, dann `loadHome()` im Hintergrund
5. „Ohne Übernahme": beendet Session ohne DB-Eintrag
- WICHTIG: `spiele` wird NICHT beim Session-Start erstellt (würde Phantom-Eintrag im Spiel-Tab erzeugen)
- `loadSpiel()` filtert `modus='online'` aus: `.or('modus.is.null,modus.neq.online')`

### Varianten
| Variante | Hole Cards | Kombinationen | Evaluator |
|---|---|---|---|
| Texas Hold'em | 2 | Best-of-7 | evalHoldem |
| Omaha | 4 | exakt 2+3, 60 Kombi | evalOmaha |
| Texahma | 4 | 0-4 eigene, 126 Kombi | evalTexahma |

> **Namens-Hinweis:** Anzeigename überall **«Texahma»**, interner Mode-Wert einheitlich `texahma`
> (DB-Spalte `online_spiele.variante` CHECK, Equity-Rechner in index.html, `equity-explain`).
> Einzig die interne Helper-Funktion heisst noch `_eqEvalTexama` (nur Funktionsname, kein Wert).

### DB: online_spiele relevante Felder
`id, spiel_id (null bis Payout-Bestätigung), status (waiting/running/finished), variante (holdem/omaha/texahma), small_blind, big_blind (NULL = small_blind*2), start_stack, buyin_pot (numeric, Chip-Euro-Kurs-Snapshot beim Session-Start; NULL bei Alt-Sessions → Client-Fallback auf einstellungen.buyin_pot), is_test, dealer_seat, current_player_id, pot, community_cards, hand_nr, street, runout_cards, street_last_actor_id, video_link, call_teilnehmer (jsonb, im-Call-Tracking), hat_bots, bot_auto_rebuy (Session-Toggle: an=nachkaufen, aus=beobachten), blind_struktur (jsonb), blind_level, blind_timer_running, blind_level_started_at, blind_level_secs_left`

> ⚠️ `deck` liegt **nicht** in `online_spiele`, sondern in eigener Tabelle **`online_decks`** (id FK→online_spiele, deck jsonb; kein Client-Zugriff, nur Service Role).
> ℹ️ `call_aktiv` existiert bewusst **nicht** (kein Code nutzt sie); das Video-Call-Tracking läuft allein über `call_teilnehmer`.

### DB: online_seats relevante Felder
`id, online_spiel_id, spieler_id, seat (1-9), stack, status (active/folded/allin/paused/sitting_out), bet_current_round, buyins (Anzahl, startet bei 1), auto_folded, pause_auto_action, pause_call_limit, pre_action, pre_action_limit, paused_at, bot_config (jsonb, nur bei Bots)`

> ⚠️ `hole_cards` liegen **nicht** in `online_seats`, sondern in eigener Tabelle **`online_seat_cards`** (seat_id FK→online_seats, hole_cards jsonb; RLS: nur lesbar durch den Kartenbesitzer via auth.uid = spieler.auth_user_id).

### Bot-Spieler (KI-Mitspieler im Online-Modus)

Computer-Mitspieler, die automatisch spielen. Ermöglicht Online-Runden auch mit wenigen
menschlichen Teilnehmern.

**Datenmodell:**
- `spieler.ist_bot = true` markiert einen Bot (wird aus Dropdowns/Statistik/Spiel-UI gefiltert:
  `aktiv && !ist_bot`)
- `online_seats.bot_config` (jsonb) hält die Persönlichkeit pro Sitz:
  - `aggressivitaet` (0–100): wie oft raise statt call
  - `risiko` (0–100): Bereitschaft Chips zu riskieren (niedrig = foldet bei grossen Einsätzen)
  - `bluff` (0–100): Bluff-Häufigkeit mit schwachen Karten
  - `gespr` (0–100): Häufigkeit von Chat-Kommentaren
  - `karten_zeigen`: `'immer'` | `'nie'` | `'showdown'`
  - `style`: Preset-Name, `avatar`: SVG-Data-URI
- `online_spiele.hat_bots = true` sobald mind. ein Bot am Tisch sitzt

**Spielfluss:**
1. Über den runden **+**-Button am Tisch → **Bot hinzufügen** (Parameter einstellbar)
2. Ist ein Bot am Zug (`current_player_id`), triggert **jeder Client mit offener App** die
   Edge Function `poker-bot-action` (Bedenkzeit 0.5–5 s, dann Fold/Call/Raise + evtl. Kommentar)
3. Hat niemand die App offen, übernimmt der pg_cron-Job → `poker-bot-cron` (~alle 30 s) den Trigger
4. Ist ein Bot Dealer-Button und alle Gegner folden, deckt er den Runout automatisch auf
5. **Bot Auto-Rebuy** (Session-Toggle, default an): Session-Einstellung `online_spiele.bot_auto_rebuy`.
   Ist ein Bot ausgeschieden (stack=0), prüft `poker-new-hand`:
   - **an** (`!== false`): Bot kauft automatisch nach (stack=start_stack, buyins+1, status=active)
   - **aus** (`false`): Bot bleibt am Tisch sitzen und **beobachtet nur** (status=`sitting_out`) – er verlässt
     den Tisch NICHT. Wird der Toggle später wieder auf „an" gestellt, kauft er bei der nächsten Hand nach.

## Migrations-Script (historisch, abgeschlossen)

`migrate_poker.py` – hat einmalig die Altdaten aus `poker tracker v3.xlsx` in Supabase importiert
(löschte erst alle Spieldaten, dann Reimport; benötigte Service Role Key). Die Migration ist
**abgeschlossen** – das Script wird nicht mehr benötigt und liegt nicht (mehr) im Repo.

## Spieler (aktuell aktiv)

Andreas, Bolla, Cello, Chris (Admin), Gutsch, Macs, Markus, Peter
Inaktiv: Dani, Marco, Michael, Walter
Sonder-Eintrag: Bank (ist_bank=true)

## Sonderregeln der Pokerrunde

- **7-2 Regel:** Wer mit 7-2 (schlechtestes Blatt) gewinnt, bekommt von jedem Mitspieler €1
- **Buy-In:** €5 für Chips + €2 in Pokerkasse = €7 Gesamtkosten pro Buy-In
- **Pokerkasse** wird für Snacks, Getränke, Pokernächte, Karten etc. verwendet
- **Jahresspende:** Am Jahresende spenden Spieler ihren Überschuss damit alle bei ~€100 starten (freiwillig)

## Git-Workflow

- **Entwicklung IMMER auf einem Feature-Branch**, nicht direkt auf `main`
- Branch-Naming: `claude/<kurze-beschreibung>` (z.B. `claude/admin-push-notification-view`)
- Ablauf:
  1. Branch anlegen/auschecken, Änderungen committen, auf Remote pushen (`git push -u origin <branch>`)
  2. Vercel erzeugt automatisch einen Preview-Deploy. Grundformat: `https://poker-app-git-<branch-lowercase-slash-als-bindestrich>-schoblovskis-projects.vercel.app` (Vercel macht alles lowercase, `/` → `-`).
     Beispiel kurzer Branch `claude/app-ideas-0j3gF` → `https://poker-app-git-claude-app-ideas-0j3gf-schoblovskis-projects.vercel.app`
     ⚠️ **ACHTUNG bei langen Branch-Namen:** Ist das DNS-Label zu lang (~63 Zeichen), **kürzt Vercel den Branch-Slug und hängt einen Hash an** – die Formel stimmt dann NICHT mehr.
     Beispiel `claude/cleanup-branches-deployments-7aa1m5` → `https://poker-app-git-claude-cleanup-branc-f638dc-schoblovskis-projects.vercel.app`.
     **Nicht raten** – die echte URL ist der `branchAlias` aus dem Vercel-Deployment (Vercel MCP `list_deployments`, Feld `meta.branchAlias`) oder im Vercel-Dashboard.
  3. Chris testet auf der Preview-URL (Google-Login über Supabase Redirect-URL-Whitelist freigegeben)
  4. Erst nach Freigabe: Version & Changelog bumpen, auf Feature-Branch committen, in `main` mergen und `main` pushen
- Supabase Redirect-URLs müssen Vercel Preview-Domains whitelisten:
  - `https://poker-app-*-schoblovskis-projects.vercel.app/**`
  - `https://poker-app-git-*-schoblovskis-projects.vercel.app/**`

## Edge Functions – Deployment

- **Auto-Deploy via GitHub Actions** bei jedem Push auf `supabase/functions/**`
- Einzeln deployen (falls nötig): `supabase functions deploy <function-name>`
- Alle Functions auf einmal: `supabase functions deploy`
- Service Role Key und andere Secrets sind in Supabase Dashboard → Settings → Edge Functions hinterlegt
- **Alle deployten Functions** (jeweils als eigener Step in `deploy-edge-functions.yml`):
  `poker-start-game`, `poker-action`, `poker-next-street`, `poker-showdown`, `poker-new-hand`,
  `poker-reveal-runout`, `poker-bot-action`, `poker-bot-cron`, `poker-delete-session`,
  `dealer-comment`, `analyze-poker-photo`, `equity-explain`, `send-push`, `weekly-backup`
- `poker-utils` ist eine Shared-Lib (kein eigener Deploy-Step) und wird von den Poker-Functions importiert
- `migrate-fotos` liegt im Repo, ist aber kein Deploy-Step (Einmal-Migration, manuell deployt)

## Online-Modus – Easter Egg Rollout (✅ implementiert in v4.0)

Umgesetzt: `_unlockOnlineModus()` in index.html, Rätsel-Seite («🔐 Sicherheitsüberprüfung»,
Frage „Wer ist der IT-Experte, den ihr angeblich gar nicht habt?"), State via
`localStorage: 'dtks_online_entdeckt'` + Spalte `spieler.online_entdeckt_am`.
Die ursprüngliche Spezifikation bleibt unten als Referenz erhalten.

**Versteckter Einstieg:**
- Trigger: 7× auf das App-Logo/Titel tippen (Referenz zur 7-2-Regel) – oder Langdruck auf Versionsnummer in der Info-Seite
- Erst NACH Entdecken ist der Modus dauerhaft im Avatar-Menü sichtbar
- State: `localStorage: 'dtks_online_entdeckt'` (true/false)

**Das Rätsel (vor Freischaltung):**
Der Running Gag der Runde ist „ach hätte man doch einen gescheiten IT-ler…". Das Rätsel nimmt sich humorvoll daran:

- Dramatische Titel-Seite: «🔐 Sicherheitsüberprüfung – Schritt 1 von 1»
- Intro-Text (ernst formuliert, aber augenzwinkernd):
  *„Bevor dieser Modus freigeschaltet werden kann, muss die Runde beweisen, dass sie zumindest wissen, wer ihre App gebaut hat."*
- Frage (gross, fett):
  *„Wer ist der IT-Experte, den ihr angeblich gar nicht habt?"*
- Freitext-Eingabefeld (case-insensitive)
- Bei falscher Antwort: *„Falsch. Typisch. Und trotzdem läuft eure App."*
- Bei richtiger Antwort (chris / Chris / CHRIS):
  Celebration-Animation + Meldung: *«Richtig! Er existiert. Und er hat Grossartiges geleistet.»*
  → Direkt danach: **«Version 4.0 freigeschaltet!»** Modal mit:
    - Konfetti / Celebration-Effekt
    - Changelog für v4.0 (Online-Modus)
    - FAQ: was ist der Modus, Varianten (Hold'em/Omaha/Texahma), Pause, Pre-Action, Runout, Video-Call etc.
    - Diese Infos jederzeit wieder abrufbar via Avatar-Menü → «Online-Modus»

**Version-Bump beim Freischalten:**
- Version springt auf 4.0 (nicht vorher)
- Changelog-Eintrag für v4.0 beschreibt den Online-Modus komplett

**UI-Design-Anforderungen für den Online-Modus:**
- Funktioniert auf iPhone und iPad in Portrait UND Landscape
- Professionelles, durchdachtes Layout für alle Orientierungen
- Landscape auf iPad: Tisch links, Feed/Chat rechts (Side-by-Side)
- Portrait auf iPhone: Tisch oben, eigene Karten + Aktionen unten, Feed scrollbar
- Kein abgeschnittener Content bei jeder Bildschirmgrösse

**Implementierungs-Hinweis:** Separat angehen nach Fertigstellung und Test des Kernmodus. Rätsel erst einbauen wenn Modus vollständig funktioniert.

---

## Online-Modus – Vollständiges Konzept

Online-Poker via Supabase Realtime. Ermöglicht das Spielen ohne physisches Treffen (Urlaub, Reisen etc.). Ergebnisse fliessen direkt in die bestehende Statistik.

### Kernprinzip
Server (Supabase) ist einzige Wahrheit. Karten werden serverseitig gemischt und ausgeteilt – kein Client sieht fremde Karten, kein Client kann schummeln.

### Spielvarianten
| Variante | Hole Cards | Pflicht eigene Karten | Kombinationen |
|---|---|---|---|
| Texas Hold'em | 2 | 0, 1 oder 2 | Standard 7-Karten best-of-5 |
| Omaha | 4 | exakt 2 + exakt 3 Board | 60 Kombinationen |
| Texama | 4 | 0, 1, 2, 3 oder 4 (beliebig!) | 126 Kombinationen |

**Texama-Detail:** Eigene Erfindung der Runde. 4 Hole Cards wie Omaha, aber man kann 0–4 eigene Karten verwenden (wie Hold'em, nur freier). Vierling in der Hand + 1 Community Card → gültig. Evaluator prüft alle 126 Kombinationen (k=0..4 eigene × passende Board-Karten).

### DB-Tabellen (neu)

```sql
online_spiele
  id, spiel_id (FK→spiele), status (waiting|running|finished),
  variante ('holdem'|'omaha'|'texama'),
  dealer_seat, current_player_id, pot,
  community_cards (jsonb), deck (jsonb, verschlüsselt),
  runout_cards (jsonb),  -- "was wäre noch gekommen"
  created_at

online_seats
  id, online_spiel_id, spieler_id, seat (1-9), stack,
  hole_cards (jsonb),          -- RLS: nur lesbar durch owner!
  status (active|folded|allin|paused|sitting_out),
  bet_current_round,
  auto_folded (boolean),
  pause_auto_action ('fold'|'check'|'call_limit'|'call_any'),
  pause_call_limit (numeric),  -- €-Betrag bei call_limit
  pre_action ('fold'|'check_fold'|'check'|'call'|'call_any'|null),
  pre_action_limit (numeric),  -- optionales €-Limit für call
  paused_at (timestamp)        -- für "was habe ich verpasst"

online_actions
  id, online_spiel_id, spieler_id,
  action (fold|call|raise|check|allin|pause|resume|reveal_runout),
  amount, street (preflop|flop|turn|river), hand_nr (integer),
  created_at

online_chat
  id, online_spiel_id, spieler_id, message, created_at
```

**RLS:** `hole_cards` nur lesbar wenn `spieler_id = auth.uid()`

### Supabase Edge Functions

| Function | Aufgabe |
|---|---|
| `poker-start-game` | Deck mischen, Karten austeilen (2 oder 4 je nach Variante), Dealer/Blinds setzen |
| `poker-action` | Fold/Call/Raise validieren, Pot berechnen, nächsten Spieler setzen; prüft pre_action + pause_auto_action |
| `poker-next-street` | Flop/Turn/River aufdecken, Betting-Round resetten |
| `poker-showdown` | Varianten-spezifische Hand-Evaluierung, Gewinner bestimmen, Pot auszahlen |
| `poker-new-hand` | Nächste Hand starten (NUR auf Knopfdruck – kein Auto-Start!), Dealer-Button weitersetzen |
| `poker-reveal-runout` | Rest-Board aufdecken nach Hand-Ende (deterministisch aus gespeichertem Deck) |
| `poker-notify-turn` | Push Notification senden wenn Spieler dran ist (neue Push-Kategorie: online_spiel) |

### Spielfluss

1. Admin erstellt Online-Session → wählt Variante + Startstack + Buy-In-Betrag
2. Lobby: Spieler nehmen Plätze ein (ovaler Tisch, 9 Sitze, SVG)
3. Admin startet erste Hand
4. Jede folgende Hand: Dealer-Button-Spieler drückt «Nächste Hand» (kein Auto-Advance!)
5. Spielabschluss: normaler Payout-Flow → spiel_teilnehmer, Kontostände, Statistik

### Realtime-Architektur

```
Channel: "online_spiel:{id}"

DB Changes (Zustandsänderungen):
  → online_spiele UPDATE  → alle sehen neuen Spielstand
  → online_seats  UPDATE  → Stacks, Status
  → online_actions INSERT → Action-Feed
  → online_chat   INSERT  → Chat

Broadcasts (kein DB-Overhead):
  → "thinking": "Macs überlegt..."
```

### «Was wäre noch gekommen»

Nach Hand-Ende durch Fold (nicht Showdown):
- Button «Was wäre noch gekommen?» erscheint
- Berechtigt: Dealer-Button-Spieler (falls pausiert → jeder aktive Spieler)
- Edge Function `poker-reveal-runout` deckt Rest-Board auf (bereits determiniert)
- Alle sehen aufgedeckte Karten + optional eigene Hole Cards
- Kein Einfluss auf Ergebnis – rein informell
- Danach: warten auf «Nächste Hand»-Knopfdruck

### Pause / AFK

**Beim Pausieren (während aktiver Hand):**
Sheet erscheint mit Auto-Aktion-Auswahl:
- Sofort folden (Standard)
- Nur checken (Auto-Check solange kein Einsatz, sonst Fold)
- Bis Betrag X callen (Schnellauswahl 1BB / 3BB befüllt das €-Feld, manuell überschreibbar)
- Alles callen

Gilt nur für aktuelle Hand → danach Sit-Out bis Rückkehr.
Im Action-Feed: «Macs pausiert – callt bis €12»

**Rückkehr → «Was habe ich verpasst?»:**
Sheet zeigt alle Events seit `paused_at`:
- Anzahl gespielte Hände
- Pro Hand: Gewinner, Pot, Hand-Typ
- Eigene Auto-Aktionen («Du wurdest in Hand 3 automatisch gefoldet»)
- Stack-Veränderung aller Spieler
- Verpasste Chat-Nachrichten

Datenquelle: `online_actions` + `online_chat` seit `paused_at` – kein Extra-Query nötig.

### Pre-Action

Während ein anderer Spieler am Zug ist, kann man vorab wählen:
| Pre-Action | Verhalten |
|---|---|
| Fold | Sofort folden |
| Check / Fold | Checken falls möglich, sonst Fold |
| Check | Nur wenn kein Einsatz – wird annulliert bei Bet |
| Call | Aktuellen Einsatz callen (opt. mit €-Limit) |
| Call Any | Jeden Einsatz callen inkl. Re-Raises |

Falls Situation sich ändert (z.B. Re-Raise) → Pre-Action wird annulliert.
Für andere Spieler unsichtbar.

### Kein Timer – Push-Reminder

Kein Auto-Fold, keine Sanduhr. Stattdessen:
- Push Notification wenn man dran ist: «Du bist dran! Fold / Call / Raise»
- Deep Link öffnet direkt den Spieltisch
- Visuelles «Dein Zug» Banner in der App
- Neue Push-Kategorie: `online_spiel`

### Tisch-UI

- Ovaler Tisch (SVG), 9 Plätze
- Community Cards in der Mitte, Pot-Anzeige
- Eigene Hole Cards unten (gross)
- Fremde Spieler: Avatar + Stack + Einsatz (Karten verdeckt)
- Dealer-Button, Small/Big Blind Marker
- Action-Buttons: Fold / Check / Call / Raise (nur aktiv wenn man dran ist)
- Raise: Slider + Schnellbeträge (½ Pot, Pot, All-In)
- Action-Feed: «Gutsch foldet», «Chris raises €12»
- Chat
- Video-Call: externer Link (WhatsApp/Meet/FaceTime) einbettbar (siehe Video-Call-Konzept unten)

### Showdown-Anzeige

- Alle Hole Cards aufdecken
- Winning Hand highlighten + Beschriftung («Straight, Dame hoch»)
- Texama: zeigen welche eigene Karten verwendet wurden (0–4)
- Omaha: zeigen welche exakt 2+3 Kombination gewann

### Integration bestehend

- Online-Spiel erstellt Eintrag in `spiele` (modus = 'online' neu)
- Buy-Ins als `spiel_teilnehmer` Einträge (Stack-Reloads = neue Buy-Ins)
- Spielende → normaler Payout-Flow → Kontostände, Statistik, Verlauf

### Video-Call Integration (noch nicht implementiert)

**Einschränkung:** WhatsApp hat keine öffentliche API für Gruppen-Video-Calls. `wa.me`-Links können nur Einzelchats öffnen – Group Video Calls programmatisch starten ist nicht möglich.

**Realistisches Konzept:**

**DB-Änderungen:**
- `spieler.telefon` – Handynummer (optional, für spätere Nutzung)
- `online_spiele.video_link` – bereits vorhanden (admin speichert WhatsApp-Gruppen-Link einmalig)
- `online_spiele.call_aktiv` (boolean) – ob gerade jemand im Call ist
- `online_spiele.call_teilnehmer` (jsonb array von spieler_ids) – wer ist gerade im Call

**Ablauf:**
1. Admin erstellt Session → trägt WhatsApp-Gruppen-Einladungslink ein (wird für die Runde einmalig erstellt und bleibt gleich)
2. Erster Spieler drückt «Call starten» → setzt `call_aktiv=true`, fügt sich zu `call_teilnehmer` hinzu, App öffnet Link extern
3. Alle anderen sehen «Call joinen» statt «Call starten»
4. Jeder Spieler der beitritt: drückt «Im Call» → fügt sich zu `call_teilnehmer` hinzu
5. Tisch-UI zeigt: «Im Call: 4/6 Spieler» mit Avataren
6. Spieler verlässt App wieder → «Verlassen»-Button entfernt ihn aus `call_teilnehmer`

**Push Notification – neuer Trigger:**
- Wenn erster Spieler `call_aktiv` setzt → Push an alle Mitspieler der Session
- Kategorie: `video_call` (neues Toggle in Profil → Push-Einstellungen)
- Titel: «Pokernacht läuft! 🎴»
- Body: «Andreas hat den Video-Call gestartet – jetzt joinen!»
- Deep Link: direkt der video_link URL (öffnet WhatsApp)

**Call-Status im Tisch-UI:**
- Wenn kein Call aktiv: Button «Call starten» (öffnet Link + setzt call_aktiv)
- Wenn Call aktiv, ich nicht drin: Button «Call joinen» (öffnet Link + fügt mich hinzu)
- Wenn ich im Call: Button «Call verlassen» + grüner Indikator
- Anzeige: Avatare der Call-Teilnehmer mit Anzahl «3 im Call»

**Telefonnummer im Spieler-Profil:**
- Optionales Feld, wird für direkten wa.me-Link verwendet (Einzelkontakt)
- Format: +41791234567 (mit Ländervorwahl)
- Sichtbar nur für Admins in der Spielerverwaltung

### Implementierungs-Phasen

| Phase | Was | Aufwand |
|---|---|---|
| 1 | DB-Schema + RLS | Klein |
| 2 | Hand-Evaluatoren (Hold'em / Omaha / Texama) | Gross |
| 3 | Edge Functions (Game-Flow) | Gross |
| 4 | Realtime-Subscriptions + Push | Mittel |
| 5 | Tisch-UI | Mittel |
| 6 | Integration bestehend | Klein |

---

## Kommentar-Vorlagen (Transaktionen)

```js
['Verpflegung (Bier | Snacks)', 'Pfand', 'Pokernacht', 'Einzahlung', 'Habenzinsen', 'Kapitalertragssteuer', 'Spende']
```
