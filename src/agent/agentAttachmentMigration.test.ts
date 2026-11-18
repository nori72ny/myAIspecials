// @vitest-environment node
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { AGENT_ATTACHMENT_MIGRATION_SQL } from './agentAttachmentSchema.js';

describe('agent attachments migration contract', () => {
  it('keeps the in-code constant byte-identical to the migration file', async () => {
    const sql = await readFile(new URL('../../supabase/migrations/20261118090000_origin_agent_attachments.sql', import.meta.url), 'utf8');
    expect(sql.trim()).toBe(AGENT_ATTACHMENT_MIGRATION_SQL.trim());
  });

  it('keeps both tables service-role-only with lifecycle constraints mirroring the store', async () => {
    const sql = await readFile(new URL('../../supabase/migrations/20261118090000_origin_agent_attachments.sql', import.meta.url), 'utf8');
    for (const table of ['origin_agent_attachment_sets', 'origin_agent_attachments']) {
      expect(sql).toContain(`create table if not exists public.${table}`);
      expect(sql).toContain(`alter table public.${table} enable row level security`);
      expect(sql).toContain(`revoke all on table public.${table} from anon`);
      expect(sql).toContain(`revoke all on table public.${table} from authenticated`);
      expect(sql).toContain(`grant select, insert, update, delete on table public.${table} to service_role`);
    }
    // Owner binding and token digest are hashes, never raw identifiers.
    expect(sql).toContain("owner_binding ~ '^[0-9a-f]{64}$'");
    expect(sql).toContain("upload_token_digest ~ '^[0-9a-f]{64}$'");
    // The claim lifecycle: a claimed run id exists exactly while claimed.
    expect(sql).toContain('origin_agent_attachment_set_claim_lifecycle');
    expect(sql).toContain("(status = 'claimed' and claimed_run_id is not null) or (status <> 'claimed' and claimed_run_id is null)");
    // The per-file char cap is enforced in the schema as well as the store.
    expect(sql).toContain('char_count between 0 and 200000');
    // Deleting a set removes its files (and their bodies) with it.
    expect(sql).toContain('references public.origin_agent_attachment_sets (set_id) on delete cascade');
    // The full status and kind vocabularies.
    for (const status of ['open', 'claimed', 'deleted']) {
      expect(sql).toContain(`'${status}'`);
    }
    for (const kind of ['text', 'xlsx', 'pdf']) {
      expect(sql).toContain(`'${kind}'`);
    }
  });
});
