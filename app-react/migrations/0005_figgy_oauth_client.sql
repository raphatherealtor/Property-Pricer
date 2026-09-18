-- Register Figgy's OAuth client identity for the hosted Property Pricer MCP.
-- Figgy supplies this public PKCE client ID and exact callback URI when a user
-- authenticates its existing `property-pricer` connector.

insert into mcp_oauth_clients (
  workspace_id,
  client_id,
  client_secret_hash,
  display_name,
  auth_method,
  redirect_uris,
  scopes,
  is_enabled
) values (
  null,
  '346915229178-fd04fcv1rmftif76e540ut17qn81094i.apps.googleusercontent.com',
  null,
  'Figgy Property Pricer',
  'public_pkce',
  array['https://api.getfiggy.ai/auth/mcp/callback'],
  array['mcp:tools', 'mcp:ai', 'mcp:crm', 'mcp:resources', 'mcp:prompts'],
  true
)
on conflict (client_id) do update
set
  client_secret_hash = excluded.client_secret_hash,
  display_name = excluded.display_name,
  auth_method = excluded.auth_method,
  redirect_uris = excluded.redirect_uris,
  scopes = excluded.scopes,
  is_enabled = excluded.is_enabled;
