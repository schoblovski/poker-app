# DTKS Poker App – Claude Kontext

## Tech Stack
- **Frontend**: Vanilla HTML/CSS/JavaScript (single file: `index.html`)
- **Hosting**: Vercel (auto-deploy via GitHub push auf `main`)
- **Datenbank**: Supabase (PostgreSQL)
- **Live URL**: https://poker-app-dusky.vercel.app
- **GitHub Repo**: schoblovski/poker-app

## Supabase
- **URL**: `https://bcvyhlzjpfezokvcjksn.supabase.co`
- **Anon Key**: `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJjdnlobHpqcGZlem9rdmNqa3NuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU3NDAzNDksImV4cCI6MjA5MTMxNjM0OX0.DNvFp6N7HYjMwrimiKAd_D3VAQDYDns-2vvHOBdW4Yk`

## Datenbank-Tabellen
| Tabelle | Beschreibung |
|---|---|
| `spieler` | id, name, email, aktiv, ist_admin, ist_bank, profilbild, eintrittsdatum |
| `spiele` | id, datum, abgeschlossen, buyin_pot, buyin_kassa, created_at |
| `spiel_teilnehmer` | id, spiel_id, spieler_id, buyins, payout, leihgabe, created_at |
| `transaktionen` | id, datum, von_spieler_id, nach_spieler_id, betrag, kommentar, created_at |
| `hand_statistik` | id, spiel_id, gewinner_id, hand (z.B. '7-2'), kommentar, foto_url, created_at |
| `einstellungen` | key, wert, beschreibung |

## Kontostand-Formel (wichtig!)
- **Alte Spiele** (`buyin_pot < 5`): `payout - buyins * buyin_pot`
- **Neue Spiele** (`buyin_pot >= 5`): `payout - buyins * (buyin_pot + buyin_kassa)`
- **Leihgabe** wird NICHT vom Kontostand abgezogen (läuft über Transaktionen)
- **Transaktionen**: eingehend (`nach_spieler_id`) addiert, ausgehend (`von_spieler_id`) subtrahiert
- **Pokerkasse** = Bankkonto − Summe(alle Spieler-Kontostände)
- **Bankkonto**: LEER→SPIELER = +betrag; SPIELER→LEER = −betrag; LEER→BANK = +betrag; BANK→LEER = −betrag

## Einstellungen (DB)
- `buyin_pot`: Euro pro BuyIn für Chips (Standard: 5)
- `buyin_kassa`: Euro pro BuyIn in die Pokerkasse (Standard: 2)

## Auth / Login
- Google OAuth ✅
- Facebook OAuth (Button vorhanden, Supabase-Konfig nötig)
- Apple OAuth (Button vorhanden, Supabase-Konfig nötig)
- Microsoft/Azure OAuth (Button vorhanden, Supabase-Konfig nötig)
- Nach Login: Spieler wird anhand `email` in `spieler`-Tabelle gesucht
- Profilbild wird von OAuth-Provider übernommen (`user_metadata.avatar_url`)

## App-Seiten (Bottom Nav)
| Page ID | Titel | Beschreibung |
|---|---|---|
| `home` | Übersicht | Mein Konto, Kasse (Bank/Pokerkasse), alle Spieler |
| `spiel` | Aktuelles Spiel | Buy-Ins zählen, PayOut eingeben, Spiel abschließen |
| `verlauf` | Spiel Verlauf | Liste aller abgeschlossenen Spiele (→ Todo: Detail-Ansicht) |
| `statistik` | Statistik | Rangliste, Kontostand-Ranking, Besondere Hände |
| `transaktionen` | Konto | Transaktionsliste, Neue Transaktion |
| `verwaltung` | Spielerverwaltung | Admin-only: Spieler anlegen/bearbeiten/deaktivieren |
| `einstellungen` | Einstellungen | Admin-only: Buy-In Faktoren |
| `spieler-stats` | Statistik | Spieler-Detail-Statistik (aus Home/Statistik anklickbar) |
| `spieler-detail` | Spieler | Admin-Detail eines Spielers (aus Verwaltung anklickbar) |

## Design-Regeln
- **KEINE Gradienten** (kein `linear-gradient`, kein `radial-gradient`)
- **Font**: DM Sans (`--font-sans`), DM Mono (`--font-mono`)
- **CSS Design Tokens**: `--accent`, `--bg`, `--surface`, `--border`, `--text-primary`, etc.
- **Safe Area**: `env(safe-area-inset-*)` für iOS/Android notch support
- **Dark/Light/Auto Theme** gespeichert in `localStorage` als `dtks-theme`
- **Admin-only**: Alle Lösch-Aktionen und Admin-Seiten nur für `ist_admin=true` Spieler
- **Bestätigungsdialog** vor JEDER Löschaktion (`confirmDelete()`)

## Versionierung
- Aktuelle Version: **1.6**
- Version in `<meta name="version" content="X.X">` und `const VERSION='X.X'` hochzählen
- Bei jeder Änderung um 0.1 erhöhen

## Kommentar-Vorlagen (Transaktionen)
```js
['Verpflegung (Bier | Snacks)', 'Pfand', 'Pokernacht', 'Einzahlung', 'Habenzinsen', 'Kapitalertragssteuer', 'Spende']
```

## 7-2 Regel (Hausregel)
Wer mit 7-2 gewinnt, bekommt von jedem anderen Mitspieler am Tisch 1€.
→ Beim Erfassen in `hand_statistik` werden automatisch Transaktionen erstellt:
  - Von jedem anderen `spiel_teilnehmer` des laufenden Spiels → 1€ → Gewinner
  - Kommentar: `"7-2 Gewinn"`

---

## TODO-Liste

### Offen

| # | Feature | Priorität | Status |
|---|---|---|---|
| 1 | **Hand Statistik Seite** – Erfassen mit Hand-Typ, Gewinner, Kommentar, Beweisfoto-URL | Hoch | ⬜ Offen |
| 2 | **7-2 Automatismus** – Beim Erfassen einer 7-2 Hand → auto Transaktionen (1€ von jedem Mitspieler zum Gewinner) | Hoch | ⬜ Offen |
| 3 | **Facebook / Apple / Microsoft Login** in Supabase konfigurieren | Mittel | ⬜ Offen (Supabase-Dashboard nötig) |
| 4 | **Spiel Verlauf Detail-Ansicht** – Pro Abend anklickbar, detail view | Mittel | ⬜ Offen |
| 5 | **Admin: Jahres-Spende Automatismus** – Alle Spieler auf 100€ zurücksetzen (Differenz als Spende/Einzahlung buchen) | Mittel | ⬜ Offen |

### Ideen / Backlog

| Idee | Beschreibung |
|---|---|
| Push Notifications | Benachrichtigung wenn Spiel startet |
| PWA Service Worker | Offline-Support verbessern |
| Export | CSV/PDF Export der Transaktionen |
| Leihgabe UI | Leihgaben im Spiel besser sichtbar machen |
| Spieler-Kommentare | Freitext-Notizen zu Spielabenden |

---

## Git-Workflow
- **Dev-Branch**: `claude/poker-app-pending-tasks-MQfdn`
- **Push**: `git push -u origin claude/poker-app-pending-tasks-MQfdn`
- Kein direkter Push auf `main` ohne explizite Erlaubnis
- Vercel deployed automatisch von `main`
