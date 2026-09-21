create table if not exists public.origin_mcp_tool_grants (
  connection_id uuid not null references public.origin_mcp_connections(connection_id) on delete cascade,
  owner_id text not null,
  server_id text not null,
  tool_name text not null,
  fingerprint text not null,
  approved_at timestamptz not null default now(),
  primary key (connection_id, tool_name),
  constraint origin_mcp_tool_grants_owner_format check (owner_id ~ '^[A-Za-z0-9:_-]{1,192}$'),
  constraint origin_mcp_tool_grants_server_format check (server_id ~ '^[A-Za-z0-9-]{1,64}$'),
  constraint origin_mcp_tool_grants_tool_name_size check (octet_length(tool_name) between 1 and 512),
  constraint origin_mcp_tool_grants_fingerprint check (fingerprint ~ '^[a-f0-9]{64}$')
);

create index if not exists origin_mcp_tool_grants_owner_connection_idx
  on public.origin_mcp_tool_grants (owner_id, connection_id, tool_name);

alter table public.origin_mcp_tool_grants enable row level security;
revoke all on table public.origin_mcp_tool_grants from public;
revoke all on table public.origin_mcp_tool_grants from anon;
revoke all on table public.origin_mcp_tool_grants from authenticated;
grant select, insert, update, delete on table public.origin_mcp_tool_grants to service_role;

comment on table public.origin_mcp_tool_grants is
  'Server-only exact MCP tool grants. A grant is invalidated automatically when a live tool fingerprint no longer matches.';