import { describe, expect, it } from "vitest";
import type { Store } from "../config.js";
import type { RoutingDecision } from "../routing/rules.js";
import type { OrderContext } from "../shopify/admin.js";
import { buildTicketPayload } from "./build-ticket.js";
import type { Directory } from "./directory.js";

const store: Store = {
  key: "main",
  label: "Acme Main",
  shopDomain: "acme-main.myshopify.com",
  credentialsKey: "MAIN",
  shippingTeam: "Orders & Shipping",
  vipThreshold: 1000,
  clientId: "client-id",
  clientSecret: "client-secret",
};

const decision: RoutingDecision = {
  rule: "refund",
  team: "Returns & Refunds",
  priority: 0,
  tags: ["main", "refund"],
  subject: "[Acme Main] Refund issued on order #1001",
  message: "A refund was created for order #1001.",
};

const order: OrderContext = {
  legacyId: 1001,
  name: "#1001",
  email: "jane@example.com",
  financialStatus: "PAID",
  totalPrice: { amount: "120.00", currencyCode: "USD" },
  customer: {
    firstName: "Jane",
    lastName: "Doe",
    email: "jane@example.com",
    numberOfOrders: 2,
    amountSpent: { amount: "240.00", currencyCode: "USD" },
  },
  riskLevel: "LOW",
  adminUrl: "https://acme-main.myshopify.com/admin/orders/1001",
};

const directory: Directory = {
  teamId: (name) => `team:${name}`,
  tagIds: (teamId, names) => names.map((name) => `${teamId}/${name}`),
};

describe("buildTicketPayload", () => {
  it("maps the decision and order into the create-ticket body", () => {
    expect(buildTicketPayload(store, decision, order, directory)).toEqual({
      subject: decision.subject,
      status: "open",
      priority: 0,
      requester: { email: "jane@example.com", name: "Jane Doe" },
      message: {
        text: [
          "A refund was created for order #1001.",
          "",
          "Order: #1001",
          "Store: Acme Main",
          "Admin: https://acme-main.myshopify.com/admin/orders/1001",
        ].join("\n"),
      },
      teamIDs: ["team:Returns & Refunds"],
      assignment: { team: { ID: "team:Returns & Refunds" }, agent: null },
      tagIDs: ["team:Returns & Refunds/main", "team:Returns & Refunds/refund"],
      customFields: {
        shopify_order_id: "1001",
        shopify_order_url: "https://acme-main.myshopify.com/admin/orders/1001",
      },
      author: { type: "client" },
    });
  });

  it("falls back to the customer email when the order has none", () => {
    const payload = buildTicketPayload(store, decision, { ...order, email: null }, directory);
    expect(payload.requester).toEqual({ email: "jane@example.com", name: "Jane Doe" });
  });

  it("uses the store mailbox for a guest checkout without any email", () => {
    const guest: OrderContext = { ...order, email: null, customer: null };
    const payload = buildTicketPayload(store, decision, guest, directory);
    expect(payload.requester).toEqual({
      email: "orders@acme-main.myshopify.com",
      name: "Guest checkout",
    });
  });
});
