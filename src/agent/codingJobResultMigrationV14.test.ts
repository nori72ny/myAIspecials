// @vitest-environment node
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('V1.4 coding result migration contract', () => {
  it('keeps result rows encrypted, service-role-only, cascading, and cancellation-cleaned', async () => {
    const sql = await readFile(new URL('../../supabase/migrations/20260912_origin_coding_job_results_v14.sql', import.meta.url), 'utf8');
    expect(sql).toContain('references public.origin_coding_jobs_v14(job_id) on delete cascade');
    expect(sql).toContain('enable row level security');
    expect(sql).toContain('revoke all on table public.origin_coding_job_results_v14 from anon');
    expect(sql).toContain('grant select, insert, update, delete on table public.origin_coding_job_results_v14 to service_role');
    expect(sql).toContain("when (new.status = 'cancelled' and old.status is distinct from new.status)");
    expect(sql).toContain('delete from public.origin_coding_job_results_v14 where job_id = new.job_id');
    expect(sql).toContain('security definer');
    expect(sql).toContain('set search_path = pg_catalog, public');
  });
});
