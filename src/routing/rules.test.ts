import { describe, expect, it } from "vitest";
import type { Store } from "../config.js";
import type { OrderContext } from "../shopify/admin.js";
import type { ShopifyEvent } from "../shopify/schemas.js";
import { TicketPriority } from "../ticketing/types.js";
import { TAGS, TEAMS, requiredTagsByTeam, routeEvent } from "./rules.js";

const store: Store = {
  key: "outlet",
  label: "Acme Outlet",
  shopDomain: "acme-outlet.myshopify.com",
  credentialsKey: "OUTLET",
  shippingTeam: "Orders & Shipping",
  vipThreshold: 500,
  clientId: "client-id",
  clientSecret: "client-secret",
};

const customer = {
  firstName: "Jane",
  lastName: "Doe",
  email: "jane@example.com",
  numberOfOrders: 2,
  amountSpent: { amount: "240.00", currencyCode: "USD" },
};

const order: OrderContext = {
  legacyId: 1001,
  name: "#1001",
  email: "jane@example.com",
  financialStatus: "PAID",
  totalPrice: { amount: "120.00", currencyCode: "USD" },
  customer,
  riskLevel: "LOW",
  adminUrl: "https://acme-outlet.myshopify.com/admin/orders/1001",
};

const orderCreate = (financial_status: string): ShopifyEvent => ({
  topic: "orders/create",
  payload: {
    id: 1001,
    admin_graphql_api_id: "gid://shopify/Order/1001",
    name: "#1001",
    financial_status,
    total_price: "120.00",
    currency: "USD",
  },
});

const refund: ShopifyEvent = {
  topic: "refunds/create",
  payload: {
    id: 5,
    order_id: 1001,
    note: "Wrong size",
    transactions: [{ amount: "40.00", currency: "USD" }],
  },
};

const fulfillmentEvent = (status: string): ShopifyEvent => ({
  topic: "fulfillment_events/create",
  payload: {
    id: 9,
    fulfillment_id: 7,
    order_id: 1001,
    status,
    message: "No one home",
  },
});

describe("routeEvent", () => {
  it("ignores a paid, low-risk order", () => {
    expect(routeEvent({ store, event: orderCreate("paid"), order })).toBeNull();
  });

  it("routes a pending payment to Payments at high priority", () => {
    const decision = routeEvent({
      store,
      event: orderCreate("pending"),
      order,
    });
    expect(decision).toMatchObject({
      rule: "pending-payment",
      team: TEAMS.payments,
      priority: TicketPriority.High,
      tags: ["outlet", TAGS.paymentReview],
    });
    expect(decision?.subject).toContain("#1001");
  });

  it("routes a high-risk order to Payments even when it is paid", () => {
    const decision = routeEvent({
      store,
      event: orderCreate("paid"),
      order: { ...order, riskLevel: "HIGH" },
    });
    expect(decision?.rule).toBe("fraud-review");
    expect(decision?.team).toBe(TEAMS.payments);
  });

  it("routes a refund to Returns & Refunds and quotes the amount", () => {
    const decision = routeEvent({ store, event: refund, order });
    expect(decision).toMatchObject({
      rule: "refund",
      team: TEAMS.returns,
      priority: TicketPriority.Medium,
    });
    expect(decision?.message).toContain("40.00 USD");
    expect(decision?.message).toContain("Wrong size");
  });

  it("routes a failed delivery to the store's shipping team", () => {
    const decision = routeEvent({
      store,
      event: fulfillmentEvent("attempted_delivery"),
      order,
    });
    expect(decision).toMatchObject({
      rule: "delivery-issue",
      team: "Orders & Shipping",
      priority: TicketPriority.High,
      tags: ["outlet", TAGS.deliveryIssue],
    });
  });

  it("ignores routine fulfillment events", () => {
    expect(routeEvent({ store, event: fulfillmentEvent("in_transit"), order })).toBeNull();
    expect(routeEvent({ store, event: fulfillmentEvent("delivered"), order })).toBeNull();
  });

  it("escalates any ticket to VIP when lifetime spend meets the store threshold", () => {
    const vipOrder: OrderContext = {
      ...order,
      customer: {
        ...customer,
        amountSpent: { amount: "500.00", currencyCode: "USD" },
      },
    };
    const decision = routeEvent({ store, event: refund, order: vipOrder });
    expect(decision).toMatchObject({
      rule: "refund+vip",
      team: TEAMS.vip,
      priority: TicketPriority.Urgent,
      tags: ["outlet", TAGS.refund, TAGS.vip],
    });
    expect(decision?.message).toContain("VIP customer");
  });

  it("does not escalate when the event needs no ticket", () => {
    const vipOrder: OrderContext = {
      ...order,
      customer: {
        ...customer,
        amountSpent: { amount: "9999.00", currencyCode: "USD" },
      },
    };
    expect(routeEvent({ store, event: orderCreate("paid"), order: vipOrder })).toBeNull();
  });
});

describe("requiredTagsByTeam", () => {
  const eu: Store = {
    ...store,
    key: "eu",
    shippingTeam: "Orders & Shipping EU",
  };

  it("covers the rule teams plus every store's shipping team", () => {
    expect([...requiredTagsByTeam([store, eu]).keys()]).toEqual([
      "Payments",
      "Returns & Refunds",
      "VIP",
      "Orders & Shipping",
      "Orders & Shipping EU",
    ]);
  });

  it("lists per team the store tags plus the tags that team's rules attach", () => {
    const byTeam = requiredTagsByTeam([store, eu]);
    expect(byTeam.get("Payments")).toEqual(["outlet", "eu", "payment-review"]);
    expect(byTeam.get("Returns & Refunds")).toEqual(["outlet", "eu", "refund"]);
    expect(byTeam.get("Orders & Shipping")).toEqual(["outlet", "eu", "delivery-issue"]);
    expect(byTeam.get("Orders & Shipping EU")).toEqual(["outlet", "eu", "delivery-issue"]);
    expect(byTeam.get("VIP")).toEqual(["outlet", "eu", ...Object.values(TAGS)]);
  });
});
