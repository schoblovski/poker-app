-- DTKS Poker – Storage Buckets für Profilbilder & Beweisfotos (Sprint 1.5)
-- Datum: 2026-04-17
--
-- Ziel: Fotos aus den DB-Tabellen (spieler.profilbild, hand_statistik.beweisfoto)
-- auslagern in Supabase Storage. Vorteile:
--   - DB-Zeilen deutlich kleiner → schnellere Queries
--   - CDN-Caching via Supabase Storage
--   - Browser-Caching funktioniert
--
-- Setup-Reihenfolge:
--   1) Dieses Script ausführen (Buckets + Policies)
--   2) Edge Function migrate-fotos deployen
--   3) Migration Dry-Run testen
--   4) Migration real ausführen
--   5) Frontend (v3.6) ausrollen – neue Uploads landen dann direkt in Storage

-- ─────────────────────────────────────────────────────────────
-- Buckets anlegen (public, da unerratbare UUID-Dateinamen)
-- ─────────────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('profilbilder', 'profilbilder', true, 2097152, ARRAY['image/jpeg','image/png','image/webp']),
  ('beweisfotos',  'beweisfotos',  true, 5242880, ARRAY['image/jpeg','image/png','image/webp'])
ON CONFLICT (id) DO UPDATE
  SET public = EXCLUDED.public,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ─────────────────────────────────────────────────────────────
-- RLS-Policies für storage.objects
-- Public-Read über bucket.public = true geregelt (keine Policy nötig).
-- Für INSERT/UPDATE/DELETE brauchen wir explizite Policies.
-- Alle registrierten Spieler (authenticated) dürfen schreiben,
-- da z.B. Admin Profilbilder anderer Spieler hochlädt und jeder
-- Spieler Beweisfotos von Händen erfassen darf.
-- ─────────────────────────────────────────────────────────────

-- Alte Policies (aus früheren Migrations-Versuchen) entfernen – idempotent
DROP POLICY IF EXISTS "poker_profilbilder_insert" ON storage.objects;
DROP POLICY IF EXISTS "poker_profilbilder_update" ON storage.objects;
DROP POLICY IF EXISTS "poker_profilbilder_delete" ON storage.objects;
DROP POLICY IF EXISTS "poker_beweisfotos_insert"  ON storage.objects;
DROP POLICY IF EXISTS "poker_beweisfotos_update"  ON storage.objects;
DROP POLICY IF EXISTS "poker_beweisfotos_delete"  ON storage.objects;

-- profilbilder: authenticated darf alles
-- (auth.role() im CHECK ist zuverlässiger als TO authenticated-Klausel)
CREATE POLICY "poker_profilbilder_insert" ON storage.objects
  FOR INSERT
  WITH CHECK (bucket_id = 'profilbilder' AND auth.role() = 'authenticated');

CREATE POLICY "poker_profilbilder_update" ON storage.objects
  FOR UPDATE
  USING (bucket_id = 'profilbilder' AND auth.role() = 'authenticated')
  WITH CHECK (bucket_id = 'profilbilder' AND auth.role() = 'authenticated');

CREATE POLICY "poker_profilbilder_delete" ON storage.objects
  FOR DELETE
  USING (bucket_id = 'profilbilder' AND auth.role() = 'authenticated');

-- beweisfotos: authenticated darf alles
CREATE POLICY "poker_beweisfotos_insert" ON storage.objects
  FOR INSERT
  WITH CHECK (bucket_id = 'beweisfotos' AND auth.role() = 'authenticated');

CREATE POLICY "poker_beweisfotos_update" ON storage.objects
  FOR UPDATE
  USING (bucket_id = 'beweisfotos' AND auth.role() = 'authenticated')
  WITH CHECK (bucket_id = 'beweisfotos' AND auth.role() = 'authenticated');

CREATE POLICY "poker_beweisfotos_delete" ON storage.objects
  FOR DELETE
  USING (bucket_id = 'beweisfotos' AND auth.role() = 'authenticated');

-- Kontrolle (optional):
-- SELECT id, name, public FROM storage.buckets WHERE id IN ('profilbilder','beweisfotos');
-- SELECT policyname FROM pg_policies WHERE tablename = 'objects' AND schemaname = 'storage';
