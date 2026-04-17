-- DTKS Poker – Backup-Scheduling (Sprint 1: DB Foundation)
-- Datum: 2026-04-17
--
-- Richtet einen pg_cron Job ein, der jeden Sonntag 03:00 UTC die Edge
-- Function "weekly-backup" aufruft.
--
-- WICHTIG – einmalig VOR dem ersten Run durchzuführen:
--
-- 1) Storage-Bucket "backups" anlegen (privat!):
--    Supabase Dashboard → Storage → New bucket
--      Name:      backups
--      Public:    OFF
--      File size: z.B. 50 MB
--
-- 2) Extensions aktivieren (Dashboard → Database → Extensions):
--      - pg_cron   (Job-Scheduling)
--      - pg_net    (HTTP-Requests aus SQL)
--    ODER per SQL:
--      CREATE EXTENSION IF NOT EXISTS pg_cron;
--      CREATE EXTENSION IF NOT EXISTS pg_net;
--
-- 3) Zwei Vault-Secrets setzen, die der Cron-Job verwendet:
--      Supabase Dashboard → Project Settings → Vault → New secret
--      a) project_url         = https://bcvyhlzjpfezokvcjksn.supabase.co
--      b) service_role_key    = <SUPABASE_SERVICE_ROLE_KEY>
--
-- 4) Dieses Script in Supabase → SQL Editor ausführen.
--
-- 5) Manueller Testlauf (optional, einmalig):
--      SELECT net.http_post(
--        url := 'https://bcvyhlzjpfezokvcjksn.supabase.co/functions/v1/weekly-backup',
--        headers := jsonb_build_object(
--          'Content-Type',  'application/json',
--          'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
--        ),
--        body := '{}'::jsonb
--      );

-- Alten Job entfernen, falls vorhanden (idempotent)
SELECT cron.unschedule('weekly-backup')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'weekly-backup');

-- Neuen Cron-Job anlegen: jeden Sonntag um 03:00 UTC
SELECT cron.schedule(
  'weekly-backup',
  '0 3 * * 0',
  $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url')
           || '/functions/v1/weekly-backup',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
    ),
    body := '{}'::jsonb
  );
  $$
);

-- Kontrolle: Job sollte nun in cron.job stehen
-- SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'weekly-backup';
