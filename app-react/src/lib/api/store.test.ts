import assert from "node:assert/strict";
import { test } from "node:test";
import { pgTextArrayLiteral } from "./store.server.ts";

test("pgTextArrayLiteral serializes values as a Postgres text[] literal", () => {
  assert.equal(
    pgTextArrayLiteral([
      "https://chatgpt.com/aip/*/oauth/callback",
      "https://chatgpt.com/connector_platform/oauth_redirect",
      'quote"and\\slash',
    ]),
    '{"https://chatgpt.com/aip/*/oauth/callback","https://chatgpt.com/connector_platform/oauth_redirect","quote\\"and\\\\slash"}',
  );
});
