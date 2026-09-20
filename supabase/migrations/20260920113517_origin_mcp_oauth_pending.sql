-- Server-only temporary authorization state. Application login and providers remain disabled.
create table if not exists public.origin_mcp_oauth_pending (
  owner_id text not null check (owner_id ~ '^[A-Za-z0-9:_-]{1,192}$'),
  server_id text not null check (server_id ~ '^[A-Za-z0-9-]{1,64}$'),
  state_hash text not null unique check (state_hash ~ '^[a-f0-9]{64}$'),
  session_hash text not null check (session_hash ~ '^[a-f0-9]{64}$'),
  config_hash text not null check (config_hash ~ '^[a-f0-9]{64}$'),
  verifier_ciphertext text not null check (
    verifier_ciphertext ~ '^v1\.[A-Za-z0-9+/]{16}\.[A-Za-z0-9+/]{22}==\.[A-Za-z0-9+/]+={0,2}$'
    and octet_length(verifier_ciphertext) <= 512
  ),
  expires_at timestamptz not null,
  primary key (owner_id, server_id)
);
create index if not exists origin_mcp_oauth_pending_expiry_idx on public.origin_mcp_oauth_pending (expires_at);
alter table public.origin_mcp_oauth_pending enable row level security;
revoke all on table public.origin_mcp_oauth_pending from public, anon, authenticated;
grant select, insert, update, delete on table public.origin_mcp_oauth_pending to service_role;
comment on table public.origin_mcp_oauth_pending is
  'Single-use, five-minute MCP PKCE attempts; hashed state/session bindings and encrypted verifier only. No browser policies.';
