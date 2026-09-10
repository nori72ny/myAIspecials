create table if not exists public.origin_builder_publications (
  publication_id text primary key,
  project_sha256 text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  manifest jsonb not null,
  files jsonb not null,
  constraint origin_builder_publication_id_format
    check (publication_id ~ '^site-[A-Za-z0-9_-]{22}$'),
  constraint origin_builder_publication_sha_format
    check (project_sha256 ~ '^[0-9a-f]{64}$'),
  constraint origin_builder_publication_expiry
    check (expires_at > created_at and expires_at <= created_at + interval '30 days 1 minute'),
  constraint origin_builder_publication_manifest_object
    check (jsonb_typeof(manifest) = 'object' and octet_length(manifest::text) <= 65536),
  constraint origin_builder_publication_files_object
    check (jsonb_typeof(files) = 'object' and octet_length(files::text) <= 524288)
);

create index if not exists origin_builder_publications_expires_at_idx
  on public.origin_builder_publications (expires_at);

alter table public.origin_builder_publications enable row level security;
revoke all on table public.origin_builder_publications from public;
revoke all on table public.origin_builder_publications from anon;
revoke all on table public.origin_builder_publications from authenticated;
grant select, insert, delete on table public.origin_builder_publications to service_role;
