import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { ZodError } from "zod";
import { loadConfig } from "./config.js";
import { createDedupe } from "./dedupe.js";
import { createShopifyWebhookHandler } from "./handlers/shopify-webhook.js";
import { requiredTagsByTeam } from "./routing/rules.js";
import { createShopifyAdminClient } from "./shopify/admin.js";
import { createTicketingClient } from "./ticketing/client.js";
import { buildDirectory } from "./ticketing/directory.js";

const config = loadConfigOrExit();
const ticketing = createTicketingClient(config.text);

// Fail at boot, not on the first webhook, if the account is missing teams, tags or custom fields.
const directory = await buildDirectory(ticketing, requiredTagsByTeam(config.stores));

const adminClients = new Map(
  config.stores.map((store) => [store.key, createShopifyAdminClient(store)]),
);

const app = new Hono();

app.get("/health", (c) => c.json({ ok: true, stores: config.stores.map((store) => store.key) }));

app.post(
  "/webhooks/shopify",
  createShopifyWebhookHandler({
    stores: config.stores,
    ticketing,
    directory,
    dedupe: createDedupe(),
    adminClientFor: (store) => {
      const client = adminClients.get(store.key);
      if (!client) throw new Error(`No Admin API client for store ${store.key}`);
      return client;
    },
    log: (message, fields) => console.log(JSON.stringify({ message, ...fields })),
  }),
);

app.onError((error, c) => {
  console.error(error);
  // 5xx makes Shopify retry the delivery; nothing was marked as seen, so the retry is safe.
  return c.json({ error: error.message }, 502);
});

function loadConfigOrExit() {
  try {
    return loadConfig();
  } catch (error) {
    if (error instanceof ZodError) {
      const lines = error.issues.map((issue) => `  ${issue.path.join(".")}: ${issue.message}`);
      console.error(
        `Configuration is incomplete. Check .env and config/stores.json:\n${lines.join("\n")}`,
      );
    } else {
      console.error(error instanceof Error ? error.message : error);
    }
    process.exit(1);
  }
}

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`Listening on http://localhost:${info.port} for ${config.stores.length} store(s)`);
  // Prefixes only, so a stale shell export or a wrong .env is visible without leaking secrets.
  const apps = [...new Set(config.stores.map((store) => store.clientId.slice(0, 6)))];
  console.log(
    `Text account ${config.text.accountId.slice(0, 8)}…, Shopify app(s) ${apps.join(", ")}…`,
  );
  if (config.publicUrl) console.log(`Shopify webhook URL: ${config.publicUrl}/webhooks/shopify`);
});
