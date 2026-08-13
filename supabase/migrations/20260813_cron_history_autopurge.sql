-- Automatische Bereinigung der pg_cron-Lauf-Historie (`cron.job_run_details`).
--
-- Hintergrund: Die App fährt zwei Minuten-Cron-Jobs (poker-bot-cron-a/-b), die
-- rund um die Uhr laufen. Jeder Lauf schreibt eine Zeile in cron.job_run_details.
-- Diese Tabelle wird von pg_cron NIE automatisch aufgeräumt und wuchs so auf
-- >329.000 Zeilen / 217 MB an (Stand 13.08.2026) – reine Infrastruktur-Logs,
-- KEIN App-/Statistik-Bezug.
--
-- Fix: täglich alles älter als 2 Tage löschen. Dadurch bleibt die Tabelle klein
-- (~5-6k Zeilen) und autovacuum hält die physische Grösse stabil, ohne dass ein
-- manuelles VACUUM FULL nötig ist. Rows mit end_time IS NULL (noch laufende Jobs)
-- werden vom Filter ausgenommen und nie gelöscht.
SELECT cron.schedule(
  'purge-cron-history',
  '17 4 * * *',
  $$DELETE FROM cron.job_run_details WHERE end_time < now() - interval '2 days'$$
);

-- Hinweis (nicht Teil dieser Migration, bewusst manuell/einmalig durchgeführt):
--   net._http_response (pg_net-Response-Log) war auf 396 MB aufgebläht (Dead-Tuple-
--   Bloat trotz nur ~720 Live-Zeilen). Wurde einmalig per TRUNCATE zurückgesetzt.
--   pg_net räumt den Inhalt selbst per TTL (6h) auf; nach dem Reset hält autovacuum
--   die Grösse gering. Sollte die Tabelle langfristig wieder wachsen, ist die
--   durabelste Lösung, die Frequenz der bot-cron-Jobs zu reduzieren.
