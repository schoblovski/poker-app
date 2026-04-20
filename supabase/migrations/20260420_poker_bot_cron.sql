-- DTKS Poker – Bot-Cron Fallback (Hybrid Bot Driver)
-- Datum: 2026-04-20
--
-- Richtet zwei pg_cron Jobs ein, die zusammen alle ~30 Sekunden die Edge
-- Function "poker-bot-cron" aufrufen (da pg_cron minimal 1 Minute auflöst,
-- wird Job B via pg_sleep(30) um 30s verzögert).
--
-- Voraussetzungen (einmalig im Supabase Dashboard):
--   1. Extensions aktiviert: pg_cron, pg_net
--   2. Vault-Secrets vorhanden: project_url, service_role_key
--      (bereits für weekly-backup gesetzt)
--
-- Manueller Testlauf:
--   SELECT net.http_post(
--     url := 'https://bcvyhlzjpfezokvcjksn.supabase.co/functions/v1/poker-bot-cron',
--     headers := jsonb_build_object(
--       'Content-Type',  'application/json',
--       'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
--     ),
--     body := '{}'::jsonb
--   );

-- Alte Jobs entfernen (idempotent)
SELECT cron.unschedule('poker-bot-cron-a')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'poker-bot-cron-a');
SELECT cron.unschedule('poker-bot-cron-b')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'poker-bot-cron-b');

-- Job A: feuert jede Minute zur vollen Sekunde (:00)
SELECT cron.schedule(
  'poker-bot-cron-a',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url')
           || '/functions/v1/poker-bot-cron',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
    ),
    body := '{}'::jsonb
  );
  $$
);

-- Job B: feuert jede Minute, schläft 30s → effektiv bei :30
SELECT cron.schedule(
  'poker-bot-cron-b',
  '* * * * *',
  $$
  SELECT pg_sleep(30);
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url')
           || '/functions/v1/poker-bot-cron',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
    ),
    body := '{}'::jsonb
  );
  $$
);

-- Kontrolle
-- SELECT jobname, schedule, active FROM cron.job WHERE jobname LIKE 'poker-bot-cron%';
