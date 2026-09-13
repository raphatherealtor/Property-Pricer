/**
 * Workspace + property API (the browser-facing half).
 *
 * Every export here is a `createServerFn`, which is what keeps the boundary
 * honest: the handler body is compiled out of the client bundle, and the
 * server-only modules it needs are pulled in with a dynamic `import()` inside
 * the handler. A React component imports this file and gets callable functions
 * plus types — never `pg`, never a credential.
 */
import { createServerFn } from "@tanstack/react-start";
import { cloudMiddleware } from "./context.ts";
import type { CloudStatusDto, PropertyDto } from "./schemas.ts";

/**
 * Everything the Install/workspace tab needs: the workspace identity, whether the
 * credential vault key is durable, the redacted provider list, and the CRM
 * connection summary.
 *
 * `vaultDurable` is the important field — with no `APP_ENCRYPTION_KEY` configured
 * the vault falls back to a process-local key, so any stored provider key stops
 * decrypting after a restart. The tab surfaces that instead of letting an operator
 * save a credential that silently stops working.
 */
export const getCloudStatus = createServerFn({ method: "POST" })
  .middleware([cloudMiddleware])
  .handler(async ({ context }): Promise<CloudStatusDto> => {
    const { workspaceFor, listAiProviderRows, aiProviderDto, listCrmConnectionRows, crmConnectionDto } =
      await import("./store.server.ts");
    const { hasEnvKeyFor } = await import("../ai/providers.server.ts");
    const { figgyEnvApiKey } = await import("../crm/figgy.server.ts");
    const { isVaultDurable } = await import("../crypto/secrets.server.ts");

    const workspace = await workspaceFor(context);
    const providerRows = await listAiProviderRows(workspace);
    const crmRows = await listCrmConnectionRows(workspace);
    const hasCrmEnvKey = Boolean(figgyEnvApiKey());

    return {
      workspace,
      vaultDurable: isVaultDurable(),
      providers: providerRows.map((row) => aiProviderDto(row, hasEnvKeyFor(row.provider))),
      crm: crmRows[0] ? crmConnectionDto(crmRows[0], hasCrmEnvKey) : null,
    };
  });

/** Properties saved in this workspace (created on scenario save, or explicitly). */
export const listProperties = createServerFn({ method: "POST" })
  .middleware([cloudMiddleware])
  .handler(async ({ context }): Promise<PropertyDto[]> => {
    const { workspaceFor, listProperties: list } = await import("./store.server.ts");
    return list(await workspaceFor(context));
  });

/*
 * Deliberately absent: `saveProperty` / `deleteProperty` client wrappers.
 *
 * Properties are created and updated by `saveScenario`, which calls
 * `upsertProperty` server-side when the save form carries an address — so the
 * write path exists and is exercised, it simply has no separate UI verb yet.
 * Shipping uncalled, untested wrappers for it would be dead surface that rots;
 * add the endpoint back alongside the properties UI that needs it.
 */
