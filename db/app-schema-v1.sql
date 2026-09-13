create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  display_name text,
  created_at timestamptz not null default now()
);

create table if not exists workspaces (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references users(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists properties (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  address text,
  city text,
  state text,
  zip text,
  property_type text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists scenarios (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  property_id uuid references properties(id) on delete set null,
  name text not null default 'Untitled Scenario',
  persona text not null check (persona in ('listing','lender','investor','commercial')),
  intake_json jsonb not null,
  lender_json jsonb,
  investor_json jsonb,
  commercial_json jsonb,
  engine_output_json jsonb not null,
  calc_version text not null,
  input_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists scenario_exports (
  id uuid primary key default gen_random_uuid(),
  scenario_id uuid not null references scenarios(id) on delete cascade,
  export_type text not null check (export_type in ('json','pdf','deck','crm_payload')),
  payload_json jsonb,
  file_url text,
  created_at timestamptz not null default now()
);

create table if not exists ai_providers (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  provider text not null check (provider in ('openai','anthropic','grok','mistral')),
  label text not null,
  encrypted_api_key text,
  base_url text,
  model_default text,
  is_enabled boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists ai_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  scenario_id uuid references scenarios(id) on delete set null,
  provider text not null,
  model text not null,
  purpose text not null check (purpose in ('explain','client_summary','risk_review','crm_note','chat')),
  prompt_json jsonb not null,
  response_json jsonb,
  status text not null default 'queued' check (status in ('queued','running','succeeded','failed')),
  error text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists crm_connections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  provider text not null default 'figgy',
  base_url text not null,
  encrypted_api_key text,
  webhook_secret text,
  is_enabled boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists crm_sync_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  scenario_id uuid references scenarios(id) on delete set null,
  connection_id uuid references crm_connections(id) on delete set null,
  direction text not null check (direction in ('outbound','inbound')),
  event_type text not null,
  request_json jsonb,
  response_json jsonb,
  status text not null check (status in ('queued','succeeded','failed')),
  error text,
  created_at timestamptz not null default now()
);

create index if not exists idx_scenarios_workspace on scenarios(workspace_id);
create index if not exists idx_scenarios_property on scenarios(property_id);
create index if not exists idx_ai_runs_workspace on ai_runs(workspace_id);
create index if not exists idx_crm_sync_workspace on crm_sync_events(workspace_id);
