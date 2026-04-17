// DTKS Poker – Supabase Edge Function: weekly-backup
// Exportiert alle Tabellen als CSV in Supabase Storage.
//
// Aufruf (POST):
//   URL:  https://<project>.supabase.co/functions/v1/weekly-backup
//   Auth: Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>
//   Body: {} (optional: { dry_run: true } – nichts schreiben)
//
// Speicherort:
//   Storage Bucket: "backups" (privat)
//   Pfad:           YYYY-MM-DD/<tabelle>.csv
//
// Retention:
//   Backups älter als 12 Wochen (84 Tage) werden nach erfolgreichem
//   Schreiben automatisch gelöscht.
//
// Scheduling:
//   Siehe supabase/migrations/20260417_backup_cron.sql – pg_cron Job
//   ruft diese Function jeden Sonntag um 03:00 UTC auf.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const BUCKET = 'backups';
const RETENTION_DAYS = 84; // 12 Wochen
const PAGE_SIZE = 1000;

// Tabellen in Backup-Reihenfolge (FK-agnostisch, da reine Snapshots)
const TABLES = [
  'spieler',
  'spiele',
  'spiel_teilnehmer',
  'transaktionen',
  'hand_statistik',
  'einstellungen',
  'push_subscriptions',
] as const;

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return '';
  let s: string;
  if (typeof value === 'object') {
    s = JSON.stringify(value);
  } else {
    s = String(value);
  }
  // RFC 4180: Felder mit Komma, Zeilenumbruch oder Anführungszeichen
  // werden in doppelte Anführungszeichen gesetzt; enthaltene " werden verdoppelt.
  if (/[",\n\r]/.test(s)) {
    s = `"${s.replaceAll('"', '""')}"`;
  }
  return s;
}

function rowsToCSV(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return '';
  const headers = Object.keys(rows[0]);
  const lines: string[] = [headers.map(csvEscape).join(',')];
  for (const row of rows) {
    lines.push(headers.map((h) => csvEscape(row[h])).join(','));
  }
  return lines.join('\n') + '\n';
}

async function fetchAll(
  supabase: ReturnType<typeof createClient>,
  table: string,
): Promise<Record<string, unknown>[]> {
  const all: Record<string, unknown>[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from(table)
      .select('*')
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`Fetch ${table}: ${error.message}`);
    if (!data || data.length === 0) break;
    all.push(...(data as Record<string, unknown>[]));
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return all;
}

async function deleteOldBackups(
  supabase: ReturnType<typeof createClient>,
  today: string,
): Promise<number> {
  const { data: folders, error } = await supabase.storage.from(BUCKET).list('', { limit: 1000 });
  if (error) {
    console.error('List folders error:', error.message);
    return 0;
  }
  if (!folders) return 0;

  const cutoffMs = new Date(today).getTime() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const toDelete: string[] = [];

  for (const folder of folders) {
    // Nur YYYY-MM-DD Ordner berücksichtigen
    if (!/^\d{4}-\d{2}-\d{2}$/.test(folder.name)) continue;
    const folderMs = new Date(folder.name).getTime();
    if (isNaN(folderMs) || folderMs >= cutoffMs) continue;

    const { data: files } = await supabase.storage.from(BUCKET).list(folder.name);
    if (files) {
      for (const f of files) toDelete.push(`${folder.name}/${f.name}`);
    }
  }

  if (toDelete.length === 0) return 0;
  const { error: delErr } = await supabase.storage.from(BUCKET).remove(toDelete);
  if (delErr) {
    console.error('Delete error:', delErr.message);
    return 0;
  }
  return toDelete.length;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers: CORS });
  }

  let body: { dry_run?: boolean } = {};
  try {
    const raw = await req.text();
    if (raw) body = JSON.parse(raw);
  } catch {
    // leerer Body ist ok
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  );

  const today = new Date().toISOString().split('T')[0];
  const result: Record<string, { rows: number; bytes: number; error?: string }> = {};
  let totalBytes = 0;

  for (const table of TABLES) {
    try {
      const rows = await fetchAll(supabase, table);
      const csv = rowsToCSV(rows);
      const bytes = new TextEncoder().encode(csv).length;
      totalBytes += bytes;

      if (!body.dry_run) {
        const path = `${today}/${table}.csv`;
        const { error: upErr } = await supabase.storage.from(BUCKET).upload(
          path,
          new Blob([csv], { type: 'text/csv' }),
          { upsert: true, contentType: 'text/csv' },
        );
        if (upErr) throw new Error(`Upload ${table}: ${upErr.message}`);
      }

      result[table] = { rows: rows.length, bytes };
      console.log(`✓ ${table}: ${rows.length} rows, ${bytes} bytes`);
    } catch (e: any) {
      result[table] = { rows: 0, bytes: 0, error: e.message ?? String(e) };
      console.error(`✗ ${table}: ${e.message}`);
    }
  }

  let deleted = 0;
  if (!body.dry_run) {
    deleted = await deleteOldBackups(supabase, today);
    console.log(`Retention: ${deleted} alte Dateien gelöscht`);
  }

  return new Response(
    JSON.stringify({
      date: today,
      dry_run: !!body.dry_run,
      total_bytes: totalBytes,
      deleted_old_files: deleted,
      tables: result,
    }, null, 2),
    { headers: { 'Content-Type': 'application/json', ...CORS } },
  );
});
