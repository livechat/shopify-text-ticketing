import type { Context } from "hono";
import { ZodError } from "zod";
import { type Store, findStoreByDomain } from "../config.js";
import type { Dedupe } from "../dedupe.js";
import { routeEvent } from "../routing/rules.js";
import { type ShopifyAdminClient, getOrderContext } from "../shopify/admin.js";
import {
  type ShopifyEvent,
  isShopifyTopic,
  orderIdOf,
  parseShopifyEvent,
} from "../shopify/schemas.js";
import { verifyShopifyHmac } from "../shopify/verify.js";
import { buildTicketPayload } from "../ticketing/build-ticket.js";
import type { TicketingClient } from "../ticketing/client.js";
import type { Directory } from "../ticketing/directory.js";

export type ShopifyWebhookDeps = {
  stores: Store[];
  ticketing: Pick<TicketingClient, "createTicket">;
  directory: Directory;
  dedupe: Dedupe;
  adminClientFor: (store: Store) => ShopifyAdminClient;
  log?: (message: string, fields?: Record<string, unknown>) => void;
};

export function createShopifyWebhookHandler(deps: ShopifyWebhookDeps) {
  const log = deps.log ?? (() => {});

  return async (c: Context) => {
    const shopDomain = c.req.header("x-shopify-shop-domain");
    const topic = c.req.header("x-shopify-topic");
    const webhookId = c.req.header("x-shopify-webhook-id") ?? "";

    const store = findStoreByDomain(deps.stores, shopDomain);
    if (!store) {
      log("unknown store", { shopDomain });
      return c.json({ error: "unknown store" }, 401);
    }

    // Read the raw body first: the signature covers the bytes Shopify sent, not our re-encoding.
    const rawBody = await c.req.text();
    if (!verifyShopifyHmac(rawBody, c.req.header("x-shopify-hmac-sha256"), store.clientSecret)) {
      log("invalid signature", { store: store.key, webhookId });
      return c.json({ error: "invalid signature" }, 401);
    }

    if (!isShopifyTopic(topic)) {
      log("ignored topic", { store: store.key, topic });
      return c.json({ ignored: "topic not handled" }, 200);
    }

    if (webhookId && deps.dedupe.has(webhookId)) {
      log("duplicate delivery", { store: store.key, webhookId });
      return c.json({ ignored: "duplicate" }, 200);
    }

    let event: ShopifyEvent;
    try {
      event = parseShopifyEvent(topic, JSON.parse(rawBody));
    } catch (error) {
      const details = error instanceof ZodError ? error.issues : String(error);
      log("unparseable payload", { store: store.key, topic, details });
      return c.json({ error: "payload did not match the expected shape", details }, 400);
    }

    const order = await getOrderContext(deps.adminClientFor(store), orderIdOf(event));
    const decision = routeEvent({ store, event, order });
    if (!decision) {
      log("no ticket needed", { store: store.key, topic, order: order.name });
      return c.json({ ignored: "no routing rule matched" }, 200);
    }

    const ticket = await deps.ticketing.createTicket(
      buildTicketPayload(store, decision, order, deps.directory),
    );
    if (webhookId) deps.dedupe.add(webhookId);

    log("ticket created", {
      store: store.key,
      topic,
      order: order.name,
      rule: decision.rule,
      team: decision.team,
      ticket: ticket.shortID ?? ticket.ID,
    });
    return c.json({ ticketID: ticket.ID, rule: decision.rule, team: decision.team }, 200);
  };
}
