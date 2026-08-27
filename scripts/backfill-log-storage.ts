import { gzipArchive, LOG_GENERATION_BUCKET, ROLL20_SOURCE_BUCKET } from "../lib/logs/archive";
import { createSupabaseAdminClient } from "../lib/supabase/admin";

const apply = process.argv.includes("--apply");
const admin = createSupabaseAdminClient();

async function upload(bucket: string, path: string, payload: Buffer) {
  if (!apply) return;
  const { error } = await admin.storage.from(bucket).upload(path, payload, { contentType: "application/gzip", upsert: true });
  if (error) throw error;
}

async function backfillSourceArchives() {
  let migrated = 0;
  while (true) {
    const { data, error } = await admin.from("log_imports")
      .select("id, log_id, source_html, replaced_entries_snapshot")
      .or("source_html.not.is.null,replaced_entries_snapshot.not.is.null")
      .limit(25);
    if (error) throw error;
    if (!data?.length) break;
    for (const item of data) {
      const updates: Record<string, unknown> = {};
      if (typeof item.source_html === "string") {
        const archive = gzipArchive(item.source_html);
        const path = `${item.log_id}/${item.id}.html.gz`;
        await upload(ROLL20_SOURCE_BUCKET, path, archive.compressed);
        Object.assign(updates, {
          source_storage_path: path,
          source_sha256: archive.sha256,
          source_size_bytes: archive.sourceSizeBytes,
          compressed_size_bytes: archive.compressedSizeBytes,
          compression: "gzip",
          source_html: null,
          parsed_snapshot: null
        });
        const { data: log } = await admin.from("logs").select("original_html").eq("id", item.log_id).maybeSingle();
        if (apply && log?.original_html === item.source_html) await admin.from("logs").update({ original_html: null }).eq("id", item.log_id);
      }
      if (item.replaced_entries_snapshot != null) {
        const archive = gzipArchive(JSON.stringify({ schemaVersion: 1, entries: item.replaced_entries_snapshot }));
        const path = `${item.log_id}/${item.id}-previous.json.gz`;
        await upload(LOG_GENERATION_BUCKET, path, archive.compressed);
        Object.assign(updates, { previous_generation_storage_path: path, replaced_entries_snapshot: null });
      }
      if (apply && Object.keys(updates).length) {
        const { error: updateError } = await admin.from("log_imports").update(updates).eq("id", item.id);
        if (updateError) throw updateError;
      }
      migrated += 1;
    }
    if (!apply) break;
  }
  return migrated;
}

async function compactUntouchedDocuments() {
  const compactableIds: string[] = [];
  for (let offset = 0; ; offset += 200) {
    const { data, error } = await admin.from("log_entries")
      .select("id, document, original_document")
      .eq("document_version", 2).not("original_document", "is", null)
      .range(offset, offset + 199);
    if (error) throw error;
    if (!data?.length) break;
    for (const entry of data) {
      if (JSON.stringify(entry.document) !== JSON.stringify(entry.original_document)) continue;
      compactableIds.push(entry.id);
    }
    if (data.length < 200) break;
  }
  if (apply) for (const id of compactableIds) {
    const { error } = await admin.from("log_entries").update({ original_document: null, original_content: null }).eq("id", id);
    if (error) throw error;
  }
  return compactableIds.length;
}

const sources = await backfillSourceArchives();
const documents = await compactUntouchedDocuments();
console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", sourceOrGenerationArchives: sources, untouchedDocuments: documents }, null, 2));
