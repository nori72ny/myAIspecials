create table if not exists public.origin_mcp_github_manifest_pending (
  owner_id text primary key,
  state_hash text not null,
  session_hash text not null,
  manifest_hash text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),

  constraint origin_mcp_github_manifest_pending_owner_format
    check (owner_id ~ '^[A-Za-z0-9:_-]{1,192}$'),
  constraint origin_mcp_github_manifest_pending_state_hash
    check (state_hash ~ '^[a-f0-9]{64}$'),
  constraint origin_mcp_github_manifest_pending_session_hash
    check (session_hash ~ '^[a-f0-9]{64}$'),
  constraint origin_mcp_github_manifest_pending_manifest_hash
    check (manifest_hash ~ '^[a-f0-9]{64}$')
);

create index if not exists origin_mcp_github_manifest_pending_expiry_idx
  on public.origin_mcp_github_manifest_pending (expires_at);

alter table public.origin_mcp_github_manifest_pending enable row level security;
revoke all on table public.origin_mcp_github_manifest_pending from public;
revoke all on table public.origin_mcp_github_manifest_pending from anon;
revoke all on table public.origin_mcp_github_manifest_pending from authenticated;
grant select, insert, update, delete on table public.origin_mcp_github_manifest_pending to service_role;

create table if not exists public.origin_mcp_github_app_registrations (
  owner_id text primary key,
  app_id bigint not null,
  app_slug text not null,
  client_id text not null,
  client_secret_ciphertext text not null,
  registration_fingerprint text not null,
  version integer not null default 1,
  status text not null default 'registered',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint origin_mcp_github_app_registrations_owner_format
    check (owner_id ~ '^[A-Za-z0-9:_-]{1,192}$'),
  constraint origin_mcp_github_app_registrations_app_id_valid
    check (app_id > 0),
  constraint origin_mcp_github_app_registrations_slug_format
    check (app_slug ~ '^[A-Za-z0-9-]{1,100}$'),
  constraint origin_mcp_github_app_registrations_client_id_size
    check (octet_length(client_id) between 1 and 256),
  constraint origin_mcp_github_app_registrations_ciphertext_size
    check (octet_length(client_secret_ciphertext) between 32 and 8192),
  constraint origin_mcp_github_app_registrations_fingerprint
    check (registration_fingerprint ~ '^[a-f0-9]{64}$'),
  constraint origin_mcp_github_app_registrations_version_valid
    check (version >= 1),
  constraint origin_mcp_github_app_registrations_status_valid
    check (status in ('registered', 'revoked'))
);

alter table public.origin_mcp_github_app_registrations enable row level security;
revoke all on table public.origin_mcp_github_app_registrations from public;
revoke all on table public.origin_mcp_github_app_registrations from anon;
revoke all on table public.origin_mcp_github_app_registrations from authenticated;
grant select, insert, update, delete on table public.origin_mcp_github_app_registrations to service_role;

comment on table public.origin_mcp_github_manifest_pending is
  'Server-only, owner/session-bound, single-use GitHub App Manifest registration state. Raw state is never stored.';

comment on table public.origin_mcp_github_app_registrations is
  'Server-only encrypted GitHub App registration identity. Private key and webhook secret are intentionally not retained.';
