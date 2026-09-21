-- Existing pending PKCE attempts must be restarted after this binding upgrade.
alter table public.origin_mcp_oauth_pending add column if not exists grant_id uuid not null default gen_random_uuid();

create table if not exists public.origin_mcp_oauth_grants (
  owner_id text not null check (owner_id ~ '^[A-Za-z0-9:_-]{1,192}$'),
  server_id text not null check (server_id ~ '^[A-Za-z0-9-]{1,64}$'),
  grant_id uuid not null unique,
  config_hash text not null check (config_hash ~ '^[a-f0-9]{64}$'),
  version integer not null check (version >= 1),
  status text not null check (status in ('authorizing','exchanging','active','refreshing','revoked','reauthorization_required')),
  token_ciphertext text,
  primary key (owner_id, server_id),
  constraint origin_mcp_oauth_grant_payload check (
    (status in ('active','refreshing') and token_ciphertext is not null
      and octet_length(token_ciphertext) <= 32768
      and token_ciphertext ~ '^v1\.[A-Za-z0-9_-]{1,32}\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]+$')
    or (status in ('authorizing','exchanging','revoked','reauthorization_required') and token_ciphertext is null)
  )
);
alter table public.origin_mcp_oauth_grants enable row level security;
revoke all on table public.origin_mcp_oauth_grants from public, anon, authenticated;
grant select, insert, update, delete on table public.origin_mcp_oauth_grants to service_role;
comment on table public.origin_mcp_oauth_grants is
  'Server-only encrypted OAuth grants with generation/version fencing. Unknown exchange/refresh completion requires explicit recovery; never replay tokens.';
