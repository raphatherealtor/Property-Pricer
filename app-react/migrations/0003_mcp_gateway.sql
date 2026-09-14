-- Property Pricer MCP gateway schema.
--
-- Reconciliation note: the MCP spec was specified in two places with two
-- different `mcp_calls` shapes (an audit table with `user_id`/`client_version`,
-- and a client-attributed table with `client_id`). This file is the superset of
-- both, so every column either section names exists exactly once:
--
--   mcp_clients   per-client API tokens (hashed) + which workspace they scope to
--   mcp_calls     the audit log, keyed to a client when the token was per-client,
--                 to a user when a session resolved one, otherwise global

create table if not exists mcp_clients (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references workspaces(id) on delete cascade,
  name text not null,
  client_type text not null check (client_type in ('chatgpt','claude','grok','mistral','kimi','deepseek','local','other')),
  token_hash text,
  is_enabled boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists mcp_calls (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references workspaces(id) on delete cascade,
  client_id uuid references mcp_clients(id) on delete set null,
  user_id uuid references users(id) on delete set null,
  client_name text,
  client_version text,
  tool_name text,
  resource_uri text,
  prompt_name text,
  request_json jsonb,
  response_json jsonb,
  status text not null check (status in ('succeeded','failed','rejected')),
  error text,
  created_at timestamptz not null default now()
);

create index if not exists idx_mcp_clients_workspace on mcp_clients(workspace_id);
create index if not exists idx_mcp_calls_workspace on mcp_calls(workspace_id);
create index if not exists idx_mcp_calls_tool on mcp_calls(tool_name);
