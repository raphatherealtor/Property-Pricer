-- Property Pricer MCP OAuth 2.1 authorization server schema.
--
-- The MCP endpoint is a protected resource; this schema backs the OAuth 2.1
-- authorization server that issues access tokens for it. Clients are the
-- registered OAuth clients (ChatGPT, Claude, …); authorization codes are
-- short-lived one-time grants minted at the consent step; tokens are the opaque
-- access/refresh strings, stored only as SHA-256 hashes.
--
--   mcp_oauth_clients   registered OAuth clients (public PKCE or confidential)
--   mcp_oauth_codes     one-time authorization codes + their PKCE challenge
--   mcp_oauth_tokens    issued access/refresh tokens (hashed, revocable)

create table if not exists mcp_oauth_clients (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references workspaces(id) on delete cascade,
  client_id text not null unique,
  client_secret_hash text,
  display_name text not null,
  auth_method text not null check (auth_method in ('public_pkce','confidential_client')),
  redirect_uris text[] not null default '{}',
  scopes text[] not null default '{}',
  is_enabled boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists mcp_oauth_codes (
  code_hash text primary key,
  client_id text not null references mcp_oauth_clients(client_id) on delete cascade,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid references users(id) on delete cascade,
  redirect_uri text not null,
  code_challenge text not null,
  code_challenge_method text not null default 'S256' check (code_challenge_method in ('S256')),
  scopes text[] not null default '{}',
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists mcp_oauth_tokens (
  token_hash text primary key,
  kind text not null check (kind in ('access','refresh')),
  client_id text not null references mcp_oauth_clients(client_id) on delete cascade,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid references users(id) on delete cascade,
  scopes text[] not null default '{}',
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_mcp_oauth_clients_workspace on mcp_oauth_clients(workspace_id);
create index if not exists idx_mcp_oauth_codes_expiry on mcp_oauth_codes(expires_at);
create index if not exists idx_mcp_oauth_tokens_expiry on mcp_oauth_tokens(expires_at);
