// DTKS Poker – Supabase Edge Function: migrate-fotos
// Einmalige Migration: Base64-Fotos aus DB-Tabellen in Storage-Buckets.
//
// Aufruf (POST):
//   URL:  https://<project>.supabase.co/functions/v1/migrate-fotos
//   Auth: Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>
//   Body: {
//     dry_run?: boolean       // true = nur zählen, nichts schreiben (default: false)
//     table?:   'spieler' | 'hand_statistik' | 'both'  // default: 'both'
//     limit?:   number        // max. Zeilen pro Tabelle (default: alle)
//   }
//
// Verhalten:
//   - Iteriert über Zeilen mit Base64-Inhalt (profilbild/beweisfoto beginnt mit 'data:')
//   - Parsed data URL → binary
//   - Upload nach profilbilder/<spieler_id>.jpg bzw. beweisfotos/<hand_id>.jpg
//   - UPDATE der Spalte auf Public-URL (mit ?t=<timestamp> gegen Browser-Cache)
//   - Idempotent: bereits migrierte Zeilen (http-URLs) werden übersprungen
//
// Wichtig:
//   - Buckets müssen vorher existieren (via 20260417_fotos_storage_buckets.sql)
//   - Verwendet SUPABASE_SERVICE_ROLE_KEY (auto-injected)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const BUCKET_PROFIL = 'profilbilder';
const BUCKET_BEWEIS = 'beweisfotos';
const PAGE_SIZE = 100;

interface MigrationConfig {
  table: 'spieler' | 'hand_statistik';
  column: 'profilbild' | 'beweisfoto';
  bucket: string;
}

interface MigrationResult {
  total_candidates: number;
  migrated: number;
  skipped_non_base64: number;
  errors: { id: string; message: string }[];
  total_bytes_uploaded: number;
}

function parseDataUrl(dataUrl: string): { mime: string; ext: string; bytes: Uint8Array } | null {
  const match = dataUrl.match(/^data:(image\/(jpeg|jpg|png|webp));base64,(.+)$/i);
  if (!match) return null;
  const mime = match[1].toLowerCase();
  const ext = mime === 'image/jpeg' ? 'jpg' : match[2].toLowerCase().replace('jpeg', 'jpg');
  const b64 = match[3];
  // atob gibt binary string zurück → zu Uint8Array
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { mime, ext, bytes };
}

async function migrateTable(
  supabase: ReturnType<typeof createClient>,
  cfg: MigrationConfig,
  projectUrl: string,
  dryRun: boolean,
  limit: number | null,
): Promise<MigrationResult> {
  const result: MigrationResult = {
    total_candidates: 0,
    migrated: 0,
    skipped_non_base64: 0,
    errors: [],
    total_bytes_uploaded: 0,
  };

  let processed = 0;
  let from = 0;

  while (true) {
    if (limit && processed >= limit) break;
    const pageLimit = limit ? Math.min(PAGE_SIZE, limit - processed) : PAGE_SIZE;

    // Nur Zeilen holen, die potentiell zu migrieren sind (data:-Prefix)
    const { data: rows, error } = await supabase
      .from(cfg.table)
      .select(`id, ${cfg.column}`)
      .like(cfg.column, 'data:%')
      .range(from, from + pageLimit - 1);

    if (error) throw new Error(`Fetch ${cfg.table}: ${error.message}`);
    if (!rows || rows.length === 0) break;

    result.total_candidates += rows.length;

    for (const row of rows as Record<string, unknown>[]) {
      const id = String(row.id);
      const current = row[cfg.column] as string | null;
      if (!current) {
        result.skipped_non_base64++;
        continue;
      }

      const parsed = parseDataUrl(current);
      if (!parsed) {
        result.skipped_non_base64++;
        continue;
      }

      const filename = `${id}.${parsed.ext}`;

      if (dryRun) {
        result.migrated++;
        result.total_bytes_uploaded += parsed.bytes.length;
        continue;
      }

      try {
        // Upload (upsert: true überschreibt falls vorhanden)
        const { error: upErr } = await supabase.storage.from(cfg.bucket).upload(
          filename,
          parsed.bytes,
          { upsert: true, contentType: parsed.mime },
        );
        if (upErr) throw new Error(`Upload: ${upErr.message}`);

        // Public URL (mit Cache-Buster, damit Browser das neue Bild lädt)
        const publicUrl = `${projectUrl}/storage/v1/object/public/${cfg.bucket}/${filename}?t=${Date.now()}`;

        // DB aktualisieren
        const { error: updErr } = await supabase
          .from(cfg.table)
          .update({ [cfg.column]: publicUrl })
          .eq('id', id);
        if (updErr) throw new Error(`Update: ${updErr.message}`);

        result.migrated++;
        result.total_bytes_uploaded += parsed.bytes.length;
      } catch (e: any) {
        result.errors.push({ id, message: e.message ?? String(e) });
      }
    }

    processed += rows.length;
    if (rows.length < pageLimit) break;
    // Wenn NICHT dry_run, wurden die Zeilen bereits aktualisiert (nicht mehr 'data:%'),
    // daher bleibt from = 0. Bei dry_run müssen wir paginieren.
    if (dryRun) from += pageLimit;
  }

  return result;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers: CORS });
  }

  let body: { dry_run?: boolean; table?: string; limit?: number } = {};
  try {
    const raw = await req.text();
    if (raw) body = JSON.parse(raw);
  } catch {
    // leer ist ok
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabase = createClient(
    supabaseUrl,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  );

  const dryRun = !!body.dry_run;
  const limit = body.limit ?? null;
  const which = body.table ?? 'both';

  const configs: MigrationConfig[] = [];
  if (which === 'spieler' || which === 'both') {
    configs.push({ table: 'spieler', column: 'profilbild', bucket: BUCKET_PROFIL });
  }
  if (which === 'hand_statistik' || which === 'both') {
    configs.push({ table: 'hand_statistik', column: 'beweisfoto', bucket: BUCKET_BEWEIS });
  }

  const report: Record<string, MigrationResult> = {};
  for (const cfg of configs) {
    try {
      report[cfg.table] = await migrateTable(supabase, cfg, supabaseUrl, dryRun, limit);
      const r = report[cfg.table];
      console.log(
        `${cfg.table}: ${r.migrated}/${r.total_candidates} migriert, ${r.total_bytes_uploaded} bytes, ${r.errors.length} Fehler`,
      );
    } catch (e: any) {
      report[cfg.table] = {
        total_candidates: 0,
        migrated: 0,
        skipped_non_base64: 0,
        errors: [{ id: '-', message: e.message ?? String(e) }],
        total_bytes_uploaded: 0,
      };
      console.error(`${cfg.table}: ${e.message}`);
    }
  }

  return new Response(
    JSON.stringify({ dry_run: dryRun, limit, report }, null, 2),
    { headers: { 'Content-Type': 'application/json', ...CORS } },
  );
});
