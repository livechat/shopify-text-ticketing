import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import type { Store } from "../config.js";
import { createDedupe } from "../dedupe.js";
import type { OrderContext, ShopifyAdminClient } from "../shopify/admin.js";
import { signShopifyBody } from "../shopify/verify.js";
import type { Directory } from "../ticketing/directory.js";
import type { CreateTicketPayload } from "../ticketing/types.js";
import { createShopifyWebhookHandler } from "./shopify-webhook.js";

const store: Store = {
  key: "main",
  label: "Acme Main",
  shopDomain: "acme-main.myshopify.com",
  credentialsKey: "MAIN",
  shippingTeam: "Orders & Shipping",
  vipThreshold: 1000,
  clientId: "client-id",
  clientSecret: "client-secret-main",
};

const TEAM_IDS: Record<string, string> = {
  Payments: "team-payments",
  "Returns & Refunds": "team-returns",
  VIP: "team-vip",
  "Orders & Shipping": "team-shipping",
};

const directory: Directory = {
  teamId: (name) => TEAM_IDS[name] ?? "team-unknown",
  tagIds: (teamId, names) => names.map((name) => `${teamId}/${name}`),
};

const orderData = {
  order: {
    legacyResourceId: "1001",
    name: "#1001",
    email: "jane@example.com",
    displayFinancialStatus: "PENDING",
    totalPriceSet: { shopMoney: { amount: "120.00", currencyCode: "USD" } },
    customer: {
      firstName: "Jane",
      lastName: "Doe",
      email: "jane@example.com",
      numberOfOrders: "2",
      amountSpent: { amount: "240.00", currencyCode: "USD" },
    },
    risk: { assessments: [{ riskLevel: "LOW" }] },
  },
};

function setup(overrides: { orderData?: unknown } = {}) {
  const createTicket = vi.fn(async (payload: CreateTicketPayload) => ({
    ID: "ticket-uuid",
    shortID: "ABC-1",
    subject: payload.subject ?? "",
    status: "open" as const,
    priority: payload.priority ?? 0,
    teamIDs: payload.teamIDs ?? [],
    tagIDs: payload.tagIDs ?? [],
  }));
  const graphqlCalls: { query: string; variables: Record<string, unknown> }[] = [];
  const adminClient: ShopifyAdminClient = {
    store,
    graphql: async <T>(query: string, variables: Record<string, unknown>) => {
      graphqlCalls.push({ query, variables });
      return (overrides.orderData ?? orderData) as T;
    },
  };

  const app = new Hono();
  app.post(
    "/webhooks/shopify",
    createShopifyWebhookHandler({
      stores: [store],
      ticketing: { createTicket },
      directory,
      dedupe: createDedupe(),
      adminClientFor: () => adminClient,
    }),
  );
  app.onError((error, c) => c.json({ error: error.message }, 502));

  return { app, createTicket, graphqlCalls };
}

const orderCreateBody = JSON.stringify({
  id: 1001,
  admin_graphql_api_id: "gid://shopify/Order/1001",
  name: "#1001",
  email: "jane@example.com",
  financial_status: "pending",
  total_price: "120.00",
  currency: "USD",
});

function deliver(
  app: Hono,
  body: string,
  options: {
    topic?: string;
    secret?: string;
    webhookId?: string;
    domain?: string;
  } = {},
) {
  return app.request("/webhooks/shopify", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Shop-Domain": options.domain ?? store.shopDomain,
      "X-Shopify-Topic": options.topic ?? "orders/create",
      "X-Shopify-Webhook-Id": options.webhookId ?? "wh-1",
      "X-Shopify-Hmac-Sha256": signShopifyBody(body, options.secret ?? store.clientSecret),
    },
    body,
  });
}

describe("POST /webhooks/shopify", () => {
  it("creates a Payments ticket for a pending-payment order", async () => {
    const { app, createTicket, graphqlCalls } = setup();

    const response = await deliver(app, orderCreateBody);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ticketID: "ticket-uuid",
      team: "Payments",
    });
    expect(graphqlCalls).toEqual([
      {
        query: expect.stringContaining("OrderContext"),
        variables: { id: "gid://shopify/Order/1001" },
      },
    ]);
    expect(createTicket).toHaveBeenCalledTimes(1);
    expect(createTicket.mock.calls[0]?.[0]).toMatchObject({
      requester: { email: "jane@example.com", name: "Jane Doe" },
      teamIDs: ["team-payments"],
      assignment: { team: { ID: "team-payments" }, agent: null },
      tagIDs: ["team-payments/main", "team-payments/payment-review"],
      priority: 10,
      customFields: {
        shopify_order_id: "1001",
        shopify_order_url: "https://acme-main.myshopify.com/admin/orders/1001",
      },
      author: { type: "client" },
    });
  });

  it("rejects a delivery whose signature does not match the store secret", async () => {
    const { app, createTicket, graphqlCalls } = setup();

    const response = await deliver(app, orderCreateBody, {
      secret: "someone-else",
    });

    expect(response.status).toBe(401);
    expect(graphqlCalls).toEqual([]);
    expect(createTicket).not.toHaveBeenCalled();
  });

  it("rejects deliveries from a store that is not configured", async () => {
    const { app } = setup();
    const response = await deliver(app, orderCreateBody, {
      domain: "stranger.myshopify.com",
    });
    expect(response.status).toBe(401);
  });

  it("acknowledges a redelivery without creating a second ticket", async () => {
    const { app, createTicket } = setup();

    await deliver(app, orderCreateBody, { webhookId: "wh-42" });
    const second = await deliver(app, orderCreateBody, { webhookId: "wh-42" });

    expect(second.status).toBe(200);
    await expect(second.json()).resolves.toEqual({ ignored: "duplicate" });
    expect(createTicket).toHaveBeenCalledTimes(1);
  });

  it("acknowledges an order that needs no ticket", async () => {
    const { app, createTicket } = setup({
      orderData: {
        order: { ...orderData.order, displayFinancialStatus: "PAID" },
      },
    });
    const paidBody = orderCreateBody.replace(
      '"financial_status":"pending"',
      '"financial_status":"paid"',
    );

    const response = await deliver(app, paidBody);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ignored: "no routing rule matched",
    });
    expect(createTicket).not.toHaveBeenCalled();
  });

  it("returns 400 for a payload that does not match the topic schema", async () => {
    const { app } = setup();
    const response = await deliver(app, JSON.stringify({ hello: "world" }));
    expect(response.status).toBe(400);
  });

  it("returns 502 when the Ticketing API fails so Shopify retries", async () => {
    const { app, createTicket } = setup();
    createTicket.mockRejectedValueOnce(new Error("boom"));

    const response = await deliver(app, orderCreateBody, { webhookId: "wh-7" });
    expect(response.status).toBe(502);

    const retry = await deliver(app, orderCreateBody, { webhookId: "wh-7" });
    expect(retry.status).toBe(200);
    expect(createTicket).toHaveBeenCalledTimes(2);
  });
});
