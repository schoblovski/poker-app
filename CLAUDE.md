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
| id             | uuid    | Primary Key                                        |
| name           | text    | Anzeigename                                        |
| email          | text    | Für Login (unique)                                 |
| profilbild     | text    | URL (Google-Profilbild oder Google Drive)          |
| eintrittsdatum | date    | Tag an dem der Spieler in der App erfasst wurde    |
| aktiv          | boolean | Inaktive Spieler werden nicht angezeigt            |
| ist_bank       | boolean | Genau 1 Spieler ist die "Bank"                     |
| ist_admin      | boolean | Darf Spieler verwalten + löschen                   |
| auth_user_id   | uuid    | Verknüpfung mit Supabase Auth                      |

### `spiele`

| Spalte          | Typ     | Beschreibung                              |
|-----------------|---------|-------------------------------------------|
| id              | uuid    | Primary Key                               |
| datum           | date    |                                           |
| abgeschlossen   | boolean | false = läuft noch                        |
| buyin_pot       | numeric | €5 default (historisch auch 2.5)          |
| buyin_kassa     | numeric | €2 default                                |
| modus           | text    | null = cash, 'online' = Pandemie-Modus   |
| online_variante | text    | 'holdem'/'omaha'/'texama' (bei online)   |

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
| aktualisiert_am | timestamp | Letztes Update der Subscription                                           |

## Finanz-Logik (KRITISCH – exakt so umsetzen!)

### Spieler-Kontostand

```
Kontostand = Σ(payout - buyins × buyin_kasse aus jeweiligem Spiel) + Transaktionen_ein - Transaktionen_aus

kostenProBuyin:
  - Alte Spiele : buyin_pot kann variieren, da in der Vergangenheit bei besonderen Anlässen (z.B. Pokernacht) die Faktoren für die buyin_pot und buyin_kassa niedriger gestellt werden
  - Neue Spiele : buyin_pot + buyin_kassa (bei eröffnen eines Spiels muss die zu dem Zeitpunkt gesetzten globalen Einstellungen (buyin_pot / puyin_kassa) berücksichtigt werden.
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
- **Aktuelle Version: 3.12**

## Login-Provider

- ✅ Google (funktioniert)
- ⏳ Facebook (vorgesehen, noch nicht implementiert)
- ~~Apple~~ (entfernt)
- ~~Microsoft/Azure~~ (entfernt)
- Callback URL: `https://bcvyhlzjpfezokvcjksn.supabase.co/auth/v1/callback`

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

## Aktueller Feature-Branch (noch nicht in main / kein Version-Bump)

Branch: `claude/app-ideas-0j3gF` – Pandemie-Modus Bugfixes & Payout-Flow

**Was implementiert wurde (noch auf dem Branch, wartet auf Freigabe):**
- Terminologie: „Hand/nächste Hand" → „Spielrunde/nächste Spielrunde" überall in der UI
- Community-Card-Animationen: SMIL → JS-driven CSS transition (opacity)
- Showdown-Fixes:
  - Sidepot-Berechnung nutzt `online_actions` als Source of Truth (bet_current_round wird nach jeder Strasse auf 0 zurückgesetzt → unbrauchbar)
  - `Math.floor(pot/winners)` → `Math.floor(pot/winners*100)/100` (Cent-Rundung statt Integer-Rundung)
  - Doppelte Win-Einträge im Feed behoben (Aggregation per Spieler statt pro Sidepot)
  - Uncontested Sidepots (eigenes Geld zurück) werden nicht mehr als „Gewinn" geloggt
- All-in Capping: Excess-Chips bleiben im Stack des Spielers (kein Aufblähen des Pots)
- Floating-Point-Fix beim Call-as-Allin: `Math.round(*100)/100` + `<= 0` statt `=== 0`
- Payout-Modal (Nicht-Test-Sessions): erscheint sofort beim Beenden; zeigt Name/Buy-Ins/Einsatz/Auszahlung/Netto pro Spieler; „Bestätigen" schreibt `spiel_teilnehmer` + `spiele` (erst HIER erstellt, nicht beim Session-Start!); „Ohne Übernahme" = nur Session beenden
- `spiele`-Eintrag erst bei Payout-Bestätigung erstellt → kein Phantom-Eintrag im Spiel-Tab während laufender Online-Session
- `loadSpiel()` filtert `modus='online'` aus (bestehende Alteinträge bleiben unsichtbar)
- Home-Kontostände: `loadHome()` wird nach Payout-Bestätigung im Hintergrund aufgerufen
- Buy-In-Button auf beendeter Session ausgeblendet (`&&!isFinished`)
- „Zur Übersicht"-Button zentriert (wrapper `max-width:320px;margin:0 auto`)
- Avatar-Dropdown Landscape: `max-height` von `100dvh-80px` auf `100dvh-150px` (nav-Überlappung behoben)
- Andere Spieler-Stacks ohne Rundung angezeigt

**Edge Functions geändert:**
- `poker-showdown/index.ts`: investedBySeat aus action-log, Cent-Rundung, Sidepot-Remainder nach pots[0]
- `poker-action/index.ts`: All-in capping, Float-Point-Rundung beim Call

**Nächste Schritte für diese Branch:**
1. Chris testet auf Preview-URL
2. Changelog-Text entwerfen
3. Nach Freigabe: Version bumpen (3.13 oder 4.0?), in main mergen

---

## Letzte Anpassungen

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
1. **Pandemie-Modus Stabilisierung** – Bugs + Improvements auf Branch `claude/review-pending-tasks-C6KUk` (wartet auf Freigabe + Version-Bump auf 4.0). Easter Egg + Besondere Hände aus Online-Spiel bereits implementiert.
2. **Turnier-Modus** *(spätere Erweiterung)* – Alternatives Spielformat neben Cash Game: fixer Startstack, Eliminierungen statt Buy-Ins, Platzierungen, Preis-Pool-Verteilung (z.B. 50/30/20), Blinds eskalieren via bestehendem Blind-Timer; Statistik-Erweiterung: Turniersiege, ITM-Quote, Ø-Platzierung; vermutlich neues Feld `spiele.modus = 'cash'|'turnier'` + `spiel_teilnehmer.platz`
5. **Push Notifications** ✅ vollständig implementiert:
   - ✅ VAPID Keys generiert (Public Key in App, Private Key als Supabase Secret)
   - ✅ Service Worker `sw.js` mit Push-Handler + Deep Link Navigation
   - ✅ Supabase Tabelle `push_subscriptions` angelegt
   - ✅ Profil-Seite: Subscribe/Unsubscribe + Kategorie-Toggles (5 Kategorien)
   - ✅ Supabase Edge Function `send-push` deployed (npm:web-push)
   - ✅ App-Trigger: Spielabschluss, neue Transaktion, Buy-In, Besondere Hand
   - ✅ Admin: manueller App-Update-Push aus Einstellungen-Screen
   - ✅ Deep Links: Klick auf Notification öffnet direkt den relevanten Screen

### Pandemie-Modus – Offene Bugs & Verbesserungen (aus Tests)
- **Doppel-Übernahme verhindern** – Nach Payout-Bestätigung prüfen ob für diese `online_spiel_id` bereits ein verknüpfter `spiel_id` existiert; Button „Payout & Abrechnung" deaktivieren/verstecken wenn `session.spiel_id` bereits gesetzt ist. Ohne vorherige Löschung aus dem Verlauf darf kein zweiter Eintrag entstehen.
- **Home-Kontostände nach Payout** – `loadHome()` wird zwar aufgerufen, aber Seite zeigt alten Stand bis zur manuellen App-Neu-Laden. Problem: `showPage('home')` nutzt gecachtes DOM. Fix: nach Payout `loadHome()` awaiten oder Cache-Invalidierungslogik prüfen.
- **Online-Spiel-Liste unabhängig vom Verlauf** – Abgeschlossene Online-Sessions (`online_spiele` Tabelle) sollen NICHT verschwinden wenn das verknüpfte `spiele`-Objekt im regulären Verlauf gelöscht wird. `online_spiele` ist eine eigene Tabelle – Lösch-Kaskade via FK prüfen/entfernen. Admin soll selbst entscheiden wann eine Online-Session aus der Lobby-Liste verschwindet.
- **Session beenden ohne Spieler am Tisch – Crash** – Wenn keine Spieler am Tisch sitzen und Admin Session beendet, kommt `TypeError: Cannot read properties of null (reading 'id')` (Index ~7321). Guard einbauen: prüfen ob `_pm.session` noch existiert bevor auf `.id` zugegriffen wird.
- **Verlauf-Container Höhe** – Im Portrait-Modus auf Handy: Verlauf-Container sollte ca. 50% höher sein damit mehr Feed-Einträge sichtbar sind.
- **„Zurück am Tisch"-Meldung im Feed** – Wenn Spieler nach Pause/Abwesenheit wieder aktiv wird, soll im Verlauf eine Meldung erscheinen (analog zu „X verlässt den Tisch"). Action-Typ `resume` oder `rejoin` im Feed anzeigen.
- **iPadOS Statusleiste überlappt Kebab-Menü** – Auf iPad im Landscape-Modus überlagert die iPadOS-Statusleiste den oberen Bereich; Kebab-Menü-Button schwer erreichbar. Header braucht `padding-top: env(safe-area-inset-top)` oder equivalente Anpassung für iPadOS Landscape.
- **Fehlermeldung „zu wenig Spieler"** – Wenn man nächste Spielrunde startet ohne genug Buy-Ins, erscheint rohe JSON-Fehlermeldung. Fix: Server-Fehlertext parsen und sprechende Meldung ausgeben, inkl. Liste welche Spieler noch kein Buy-In haben.
- **Vorauswahl „Fold"** – Soll nur folden wenn tatsächlich ein Einsatz zu callen ist. Wenn man noch checken könnte (kein offener Einsatz), soll automatisch gecheckt werden statt gefoldet. Analog zum „Check/Fold"-Verhalten.
- **Vorauswahl „Chk/Fold"** – Ist redundant zu geplantem neuem Fold-Verhalten oben; kann entfernt werden.
- **Wake-Lock auf Handy** – Screen-Sleep-Verhinderung funktioniert nicht mehr zuverlässig auf Handy (weder Portrait noch Landscape). Wake-Lock-Logik prüfen und ggf. `navigator.wakeLock.request('screen')` erneut bei `visibilitychange` und `focus`-Events anfordern.
- **„Was wäre gekommen"-Karten im Verlauf** – Nach Runout-Reveal soll jeder Spieler der seine Karten offengelegt hat im Feed sehen was für ein Blatt er gehabt hätte (z.B. „Du hättest einen Flush gehabt"). Evaluator auf kombinierte Hole Cards + vollständiges Board anwenden.
- **Landscape-Header-Position auf Handy** – Oberste Zeile (Spielmodus/Spielrunde/Kebab) soll im Landscape-Modus tiefer sein (bündig mit Oberkante der eigenen Karten), damit Aktions-Buttons besser sichtbar sind. Vorsicht: Layout nicht zerschiessen.
- **Flackern bei UI-Updates** – Wenn der Screen bei neuen Feed-Einträgen vollständig neu gerendert wird, flackert er kurz. Lösung: nur den Feed-Container inkrementell updaten statt `el.innerHTML` komplett neu zu setzen; oder CSS `opacity`-Transition beim Re-Render verwenden.
   - ✅ VAPID Keys generiert (Public Key in App, Private Key als Supabase Secret)
   - ✅ Service Worker `sw.js` mit Push-Handler + Deep Link Navigation
   - ✅ Supabase Tabelle `push_subscriptions` angelegt
   - ✅ Profil-Seite: Subscribe/Unsubscribe + Kategorie-Toggles (5 Kategorien)
   - ✅ Supabase Edge Function `send-push` deployed (npm:web-push)
   - ✅ App-Trigger: Spielabschluss, neue Transaktion, Buy-In, Besondere Hand
   - ✅ Admin: manueller App-Update-Push aus Einstellungen-Screen
   - ✅ Deep Links: Klick auf Notification öffnet direkt den relevanten Screen


## Pandemie-Modus – Wichtige Implementierungsdetails

### Edge Functions (Supabase Deno)
| Function | Status | Key-Logik |
|---|---|---|
| `poker-start-game` | ✅ | Deck mischen, Karten austeilen, Dealer/Blinds setzen |
| `poker-action` | ✅ | Fold/Call/Raise/Check/Allin; All-in wird auf max. was Gegner matchen können gekappt |
| `poker-next-street` | ✅ | Flop/Turn/River; setzt bet_current_round auf 0 (daher für Sidepots unbrauchbar!) |
| `poker-showdown` | ✅ | Sidepots via action-log (investedBySeat), Cent-Rundung, Hold'em/Omaha/Texama |
| `poker-new-hand` | ✅ | Nächste Hand auf Knopfdruck, Dealer-Button weiter |
| `poker-reveal-runout` | ✅ | Rest-Board aufdecken (deterministisch aus gespeichertem Deck) |

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
| Texama | 4 | 0-4 eigene, 126 Kombi | evalTexama |

### DB: online_spiele relevante Felder
`id, spiel_id (null bis Payout-Bestätigung), status (waiting/running/finished), variante, small_blind, big_blind, start_stack, is_test, dealer_seat, current_player_id, pot, community_cards, deck, hand_nr, street, runout_cards, call_aktiv, call_teilnehmer, video_link`

### DB: online_seats relevante Felder
`id, online_spiel_id, spieler_id, seat (1-9), stack, status (active/folded/allin/paused/sitting_out), bet_current_round, buyins (Anzahl, startet bei 1), hole_cards (RLS: nur owner), auto_folded, pause_auto_action, pre_action`

## Migrations-Script

`migrate_poker.py` – importiert Altdaten aus `poker tracker v3.xlsx` in Supabase.
Löscht erst alle bestehenden Spieldaten, dann reimportiert alles.
Benötigt Service Role Key (nicht Anon Key).

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
  2. Vercel erzeugt automatisch einen Preview-Deploy – URL-Format: `https://poker-app-git-<branch-lowercase-slash-als-bindestrich>-schoblovskis-projects.vercel.app` (Vercel macht alles lowercase, `/` → `-`)  
     Beispiel Branch `claude/app-ideas-0j3gF` → `https://poker-app-git-claude-app-ideas-0j3gf-schoblovskis-projects.vercel.app`
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
- Geänderte Functions in dieser Session: `poker-action`, `poker-showdown`
- Weitere Functions (unverändert): `poker-start-game`, `poker-next-street`, `poker-new-hand`, `poker-reveal-runout`, `send-push`, `weekly-backup`

## Pandemie-Modus – Easter Egg Rollout (noch nicht implementiert)

Wenn der Modus fertig ist und für alle freigeschaltet werden soll:

**Versteckter Einstieg:**
- Trigger: 7× auf das App-Logo/Titel tippen (Referenz zur 7-2-Regel) – oder Langdruck auf Versionsnummer in der Info-Seite
- Erst NACH Entdecken ist der Modus dauerhaft im Avatar-Menü sichtbar
- State: `localStorage: 'dtks_pandemie_entdeckt'` (true/false)

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
    - Changelog für v4.0 (Pandemie-Modus)
    - FAQ: was ist der Modus, Varianten (Hold'em/Omaha/Texama), Pause, Pre-Action, Runout, Video-Call etc.
    - Diese Infos jederzeit wieder abrufbar via Avatar-Menü → «Pandemie-Modus»

**Version-Bump beim Freischalten:**
- Version springt auf 4.0 (nicht vorher)
- Changelog-Eintrag für v4.0 beschreibt den Pandemie-Modus komplett

**UI-Design-Anforderungen für den Pandemie-Modus:**
- Funktioniert auf iPhone und iPad in Portrait UND Landscape
- Professionelles, durchdachtes Layout für alle Orientierungen
- Landscape auf iPad: Tisch links, Feed/Chat rechts (Side-by-Side)
- Portrait auf iPhone: Tisch oben, eigene Karten + Aktionen unten, Feed scrollbar
- Kein abgeschnittener Content bei jeder Bildschirmgrösse

**Implementierungs-Hinweis:** Separat angehen nach Fertigstellung und Test des Kernmodus. Rätsel erst einbauen wenn Modus vollständig funktioniert.

---

## Pandemie-Modus – Vollständiges Konzept

Online-Poker via Supabase Realtime. Ermöglicht das Spielen ohne physisches Treffen (Urlaub, Pandemie etc.). Ergebnisse fliessen direkt in die bestehende Statistik.

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
