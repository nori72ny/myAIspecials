create table if not exists public.origin_mcp_connections (
  connection_id uuid primary key,
  owner_id text not null,
  server_id text not null,
  endpoint text not null,
  credential_ciphertext text not null,
  version integer not null default 1,
  status text not null default 'registered',
  checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint origin_mcp_connections_owner_format
    check (owner_id ~ '^[A-Za-z0-9:_-]{1,192}$'),
  constraint origin_mcp_connections_server_format
    check (server_id ~ '^[A-Za-z0-9-]{1,64}$'),
  constraint origin_mcp_connections_endpoint_size
    check (octet_length(endpoint) between 10 and 2048),
  constraint origin_mcp_connections_credential_format
    check (
      credential_ciphertext ~ '^v1\.[A-Za-z0-9+/]{16}\.[A-Za-z0-9+/]{22}==\.[A-Za-z0-9+/]+={0,2}$'
      and octet_length(credential_ciphertext) between 12 and 12000
    ),
  constraint origin_mcp_connections_version_valid
    check (version >= 1),
  constraint origin_mcp_connections_status_valid
    check (status in ('registered', 'verified', 'failed')),
  constraint origin_mcp_connections_owner_server_unique
    unique (owner_id, server_id)
);

create index if not exists origin_mcp_connections_owner_idx
  on public.origin_mcp_connections (owner_id, created_at asc, connection_id asc);

alter table public.origin_mcp_connections enable row level security;
revoke all on table public.origin_mcp_connections from public;
revoke all on table public.origin_mcp_connections from anon;
revoke all on table public.origin_mcp_connections from authenticated;
grant select, insert, update, delete on table public.origin_mcp_connections to service_role;

comment on table public.origin_mcp_connections is
  'Server-only, owner-scoped MCP connection metadata and encrypted credential envelopes.';
