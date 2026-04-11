# DTKS Poker App – Projektdokumentation für Claude Code

## Überblick

Progressive Web App (PWA) für eine private Pokerrunde (ca. 9-13 Spieler).
Entwickelt von Chris (Admin) mit Claude als Entwicklungspartner.

## Tech Stack

- **Frontend:** Vanilla HTML + CSS + JavaScript – alles in einer einzigen Datei: `index.html`
- **Hosting:** Vercel → auto-deploy bei GitHub Push
- **Datenbank:** Supabase (PostgreSQL) in Zürich
- **Live URL:** https://poker-app-dusky.vercel.app

## Supabase

```
URL:      https://bcvyhlzjpfezokvcjksn.supabase.co
Anon Key: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJjdnlobHpqcGZlem9rdmNqa3NuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU3NDAzNDksImV4cCI6MjA5MTMxNjM0OX0.DNvFp6N7HYjMwrimiKAd_D3VAQDYDns-2vvHOBdW4Yk
```

## Datenbank-Schema

### `spieler`

| Spalte         | Typ     | Beschreibung                              |
|----------------|---------|-------------------------------------------|
| id             | uuid    | Primary Key                               |
| name           | text    | Anzeigename                               |
| email          | text    | Für Login (unique)                        |
| profilbild     | text    | URL (Google-Profilbild oder Google Drive) |
| eintrittsdatum | date    |                                           |
| aktiv          | boolean | Inaktive Spieler werden nicht angezeigt   |
| ist_bank       | boolean | Genau 1 Spieler ist die "Bank"            |
| ist_admin      | boolean | Darf Spieler verwalten + löschen          |
| auth_user_id   | uuid    | Verknüpfung mit Supabase Auth             |

### `spiele`

| Spalte        | Typ     | Beschreibung                     |
|---------------|---------|----------------------------------|
| id            | uuid    | Primary Key                      |
| datum         | date    |                                  |
| abgeschlossen | boolean | false = läuft noch               |
| buyin_pot     | numeric | €5 default (historisch auch 2.5) |
| buyin_kassa   | numeric | €2 default                       |

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

- `leer → Spieler` = Einzahlung (erhöht Bankkonto + Spieler-KS)
- `Spieler → leer` = Auszahlung
- `Spieler → Spieler` = Transfer (z.B. 7-2 Gewinn)
- `Bank → Spieler` = Erstattung aus Pokerkasse (z.B. Snacks)
- `Spieler → Bank` = Spende in Pokerkasse
- `leer → Bank` = Zinsen, Eingang

### `hand_statistik`

| Spalte      | Typ  | Beschreibung                          |
|-------------|------|---------------------------------------|
| id          | uuid | Primary Key                           |
| datum       | date |                                       |
| gewinner_id | uuid | FK → spieler                          |
| hand        | text | z.B. "Poker", "Straight Flush", "7-2" |
| kommentar   | text |                                       |
| beweisfoto  | text | URL (Google Drive Pfad)               |
| spiel_id    | uuid | FK → spiele (optional)                |

### `einstellungen`

| key         | wert | Beschreibung           |
|-------------|------|------------------------|
| buyin_pot   | 5.00 | €/BuyIn für Chips      |
| buyin_kassa | 2.00 | €/BuyIn für Pokerkasse |

## Finanz-Logik (KRITISCH – exakt so umsetzen!)

### Spieler-Kontostand

```
Kontostand = Σ(payout - buyins × kostenProBuyin) + Transaktionen_ein - Transaktionen_aus

kostenProBuyin:
  - Alte Spiele (buyin_pot = 2.5): nur buyin_pot = 2.5
  - Neue Spiele (buyin_pot = 5):   buyin_pot + buyin_kassa = 7.0
  - Leihgabe wird NICHT abgezogen (wird über Transaktionen abgewickelt)
```

### Bankkonto

```
Bankkonto = Einzahlungen (leer→Spieler)
          - Auszahlungen (Spieler→leer)
          + Eingänge (leer→Bank)
          - Ausgaben (Bank→leer)
```

### Pokerkasse

```
Pokerkasse = Bankkonto - Summe(alle Spieler-Kontostände ohne Bank)
```

### Validierte Werte (aus Excel-Import, April 2026)

- Chris: €140.40, Andreas: -€13.00, Bolla: €95.57, Cello: €100.00
- Gutsch: €103.20, Macs: €118.70
- Bankkonto: €1.532,19, Pokerkasse: €657,66

## Rollen & Berechtigungen

- **Admin** (ist_admin=true): Darf alles – Spieler verwalten, löschen, Einstellungen ändern
- **Spieler**: Darf lesen, Transaktionen hinzufügen/editieren, Spiele verwalten, Hände erfassen
- **Niemand außer Admins** darf löschen (Spieler, Transaktionen, Hände)
- **Nicht registrierte User** (Email nicht in spieler-Tabelle): Zugang wird nach Login verweigert

## App-Struktur

### Navigation (Bottom Nav)

1. **Home** – Übersicht: Mein Konto, Kasse (Bankkonto + Pokerkasse), Alle Spieler
2. **Spiel** – Aktuelles Spiel: Neues Spiel, Buy-Ins zählen, PayOut, Teilnehmer verwalten
3. **Verlauf** – Abgeschlossene Spiele chronologisch mit Ergebnissen
4. **Statistik** – Rangliste, Statistiken, Besondere Hände
5. **Konto** – Transaktionen: Liste + neue Transaktion
6. **Hände** – Besondere Hände erfassen (neu in v1.7)

### Dropdown (Avatar-Button oben rechts)

- Theme-Wechsel (Hell/Dunkel/Auto)
- Spielerverwaltung (nur Admin)
- Einstellungen (nur Admin)
- Info & Changelog
- Debug: Console (nur Admin) – Browser-Logs in der App
- Debug: Rohdaten (nur Admin) – Lesezugriff auf alle DB-Tabellen
- Abmelden

### Sub-Seiten (ohne eigenen Nav-Tab)

- `spieler-stats` – Spieler-Statistik (von Home oder Statistik erreichbar)
- `spieler-detail` – Spieler bearbeiten (von Verwaltung)
- `spiel-detail` – Spieldetail (von Verlauf, neu in v1.7)
- `einstellungen` – BuyIn-Faktoren + Jahresspende (nur Admin)
- `console` – Debug: Browser-Console (nur Admin)
- `rohdaten` – Debug: Datenbank-Rohdaten (nur Admin)

## Design-Regeln (STRIKT einhalten)

### Was VERBOTEN ist:

- ❌ Kein `linear-gradient`, kein `radial-gradient` (nirgends!)
- ❌ Kein Emoji als UI-Icon (nur als dekoratives Element z.B. Login-Suits)
- ❌ Keine generischen Fonts (kein Arial, kein Inter)

### Was verwendet wird:

- ✅ **Font:** DM Sans + DM Mono (Google Fonts)
- ✅ **Icons:** SVG Inline (Lucide-Style, stroke-based)
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
- **Aktuelle Version: 2.2**

## Login-Provider

- ✅ Google (funktioniert)
- ⏳ Facebook (konfiguriert, nicht getestet)
- ⏳ Apple (konfiguriert, nicht getestet)
- ⏳ Microsoft/Azure (konfiguriert, nicht getestet)
- Callback URL: `https://bcvyhlzjpfezokvcjksn.supabase.co/auth/v1/callback`

## Feature-Roadmap / Offene TODOs

| # | Feature | Status |
|---|---------|--------|
| 1 | Hand Statistik Seite (Erfassen mit Hand-Typ, Gewinner, Kommentar, Beweisfoto-URL) | ✅ v1.7 |
| 2 | 7-2 Automatismus: auto Transaktionen beim Erfassen | ✅ v1.7 |
| 3 | Spiel Verlauf: Detail-Ansicht pro Abend (anklickbar) | ✅ v1.7 |
| 4 | Admin: Jahres-Spende Automatismus | ✅ v1.7 |
| 5 | Info & Changelog Seite | ✅ v1.8 |
| 6 | Pokerkasse-Berechnung korrigiert (Bank-KS ausgeschlossen) | ✅ v1.9 |
| 7 | iOS Input-Zoom behoben (font-size 16px) | ✅ v1.9 |
| 8 | Spieldetail: Admin-Bearbeitung nachträglich | ✅ v1.9 |
| 9 | Admin-guard für Transaktion löschen | ✅ v2.0 |
| 10 | Spieler-Stats Backnavigation fix | ✅ v2.0 |
| 11 | Admin: Debug-Console (Browser-Logs in der App) | ✅ v2.1 |
| 12 | Admin: Rohdaten-Viewer (DB-Tabellen lesend) | ✅ v2.1 |
| 13 | Admin: Admin-Rolle anderen Spielern zuweisen | ✅ v2.1 |
| 14 | Numpad auf Mobil für Betragsfelder | ✅ v2.1 |
| 15 | Horizontale Scrollbalken behoben | ✅ v2.1 |
| 16 | Statistik: Charts + bessere Datenvisualisierung (Verlauf, Gewinn-Charts) | ✅ v2.2 |
| 17 | Google Account-Wechsel (Profil wechseln beim Login) | ⏳ offen |
| 18 | Facebook / Apple / Microsoft Login in Supabase konfigurieren | ⏳ offen |
| 19 | Altdaten: Profilbilder (Google Drive Pfade) | ⏳ offen |

## Nächste geplante Features (Priorität)

1. **Charts in Statistik** – Liniendiagramm Kontostand-Entwicklung pro Spieler, Balkendiagramm Gewinne/Verluste, Heatmap Spielhäufigkeit
2. **Google Account-Wechsel** – `signInWithOAuth` mit `queryParams: { prompt: 'select_account' }` damit der Account-Picker erscheint
3. **Facebook/Apple/Microsoft Login** – Supabase Dashboard Konfiguration erforderlich (nicht via Code)

## Bekannte Bugs / Limitierungen

- Pokerkasse war falsch berechnet → wurde in v1.6 gefixt
- Kontostand-Formel für alte Spiele (buyin_pot=2.5) → gefixt in v1.6
- Facebook/Apple/Microsoft Login: Supabase-Konfiguration noch ausstehend
- Google Drive Profilbilder werden nicht angezeigt → Spieler können Bild selbst updaten via Google-Login

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
- **Jahresspende:** Am Jahresende spenden Spieler ihren Überschuss damit alle bei ~€100 starten

## Git-Workflow

- **Direkt auf `main` entwickeln und pushen** – Vercel deployed automatisch
- Kein Feature-Branch nötig (Chris ist alleiniger Entwickler)
- Push: `git push origin main`

## Kommentar-Vorlagen (Transaktionen)

```js
['Verpflegung (Bier | Snacks)', 'Pfand', 'Pokernacht', 'Einzahlung', 'Habenzinsen', 'Kapitalertragssteuer', 'Spende']
```
