import type { Store } from "../config.js";
import type { OrderContext } from "../shopify/admin.js";
import type { ShopifyEvent, ShopifyTopic } from "../shopify/schemas.js";
import { TicketPriority } from "../ticketing/types.js";

export const TEAMS = {
  payments: "Payments",
  returns: "Returns & Refunds",
  vip: "VIP",
} as const;

export const TAGS = {
  paymentReview: "payment-review",
  refund: "refund",
  deliveryIssue: "delivery-issue",
  vip: "vip",
} as const;

export type RoutingDecision = {
  rule: string;
  team: string;
  priority: TicketPriority;
  tags: string[];
  subject: string;
  message: string;
};

export type RoutingInput<T extends ShopifyTopic = ShopifyTopic> = {
  store: Store;
  event: ShopifyEvent & { topic: T };
  order: OrderContext;
};

type Outcome = Omit<RoutingDecision, "rule">;

type RuleDefinition<T extends ShopifyTopic> = {
  name: string;
  topic: T;
  when: (input: RoutingInput<T>) => boolean;
  decide: (input: RoutingInput<T>) => Outcome;
};

type Rule = {
  name: string;
  match: (input: RoutingInput) => Outcome | null;
};

/** Checks the topic once here so rule bodies never re-narrow the event. */
function rule<T extends ShopifyTopic>({ name, topic, when, decide }: RuleDefinition<T>): Rule {
  return {
    name,
    match: (input) => (hasTopic(input, topic) && when(input) ? decide(input) : null),
  };
}

function hasTopic<T extends ShopifyTopic>(input: RoutingInput, topic: T): input is RoutingInput<T> {
  return input.event.topic === topic;
}

const PENDING_PAYMENT = new Set(["pending", "authorized"]);
const DELIVERY_PROBLEMS = new Set(["failure", "attempted_delivery"]);

/**
 * Ordered: the first matching rule wins. Each rule reads Shopify data the ticket
 * would not otherwise carry — that is why routing lives here and not in Ticketing rules.
 */
const RULES: Rule[] = [
  rule({
    name: "fraud-review",
    topic: "orders/create",
    when: ({ order }) => order.riskLevel === "HIGH",
    decide: ({ store, order }) => ({
      team: TEAMS.payments,
      priority: TicketPriority.High,
      tags: [TAGS.paymentReview],
      subject: `[${store.label}] Fraud review for order ${order.name}`,
      message: lines(
        `Shopify flagged order ${order.name} as high risk.`,
        `Amount: ${money(order.totalPrice)}. Payment status: ${order.financialStatus ?? "unknown"}.`,
      ),
    }),
  }),
  rule({
    name: "pending-payment",
    topic: "orders/create",
    when: ({ event }) => PENDING_PAYMENT.has((event.payload.financial_status ?? "").toLowerCase()),
    decide: ({ store, order }) => ({
      team: TEAMS.payments,
      priority: TicketPriority.High,
      tags: [TAGS.paymentReview],
      subject: `[${store.label}] Payment pending on order ${order.name}`,
      message: lines(
        `Order ${order.name} was placed but payment is ${order.financialStatus ?? "pending"}.`,
        `Amount: ${money(order.totalPrice)}. Follow up with the customer or the payment provider.`,
      ),
    }),
  }),
  rule({
    name: "refund",
    topic: "refunds/create",
    when: () => true,
    decide: ({ store, event, order }) => {
      const refunded = event.payload.transactions
        .map((t) => `${t.amount} ${t.currency}`)
        .join(", ");
      return {
        team: TEAMS.returns,
        priority: TicketPriority.Medium,
        tags: [TAGS.refund],
        subject: `[${store.label}] Refund issued on order ${order.name}`,
        message: lines(
          `A refund was created for order ${order.name}.`,
          refunded ? `Refunded: ${refunded}.` : "Refund amount not reported.",
          event.payload.note && `Note: ${event.payload.note}`,
        ),
      };
    },
  }),
  rule({
    name: "delivery-issue",
    topic: "fulfillment_events/create",
    when: ({ event }) => DELIVERY_PROBLEMS.has(event.payload.status),
    decide: ({ store, event, order }) => ({
      team: store.shippingTeam,
      priority: TicketPriority.High,
      tags: [TAGS.deliveryIssue],
      subject: `[${store.label}] Delivery ${event.payload.status.replace("_", " ")} for order ${order.name}`,
      message: lines(
        `The carrier reported "${event.payload.status}" for order ${order.name}.`,
        event.payload.message && `Carrier message: ${event.payload.message}`,
        "Reach out to the customer before they reach out to us.",
      ),
    }),
  }),
];

/** Returns null when the event needs no ticket (a paid, low-risk order; a routine scan event). */
export function routeEvent(input: RoutingInput): RoutingDecision | null {
  for (const candidate of RULES) {
    const outcome = candidate.match(input);
    if (!outcome) continue;

    const decision: RoutingDecision = {
      rule: candidate.name,
      ...outcome,
      tags: [input.store.key, ...outcome.tags],
    };
    return applyVipOverride(decision, input);
  }
  return null;
}

function applyVipOverride(
  decision: RoutingDecision,
  { store, order }: RoutingInput,
): RoutingDecision {
  const customer = order.customer;
  if (!customer || store.vipThreshold <= 0) return decision;
  if (Number(customer.amountSpent.amount) < store.vipThreshold) return decision;

  return {
    ...decision,
    rule: `${decision.rule}+vip`,
    team: TEAMS.vip,
    priority: TicketPriority.Urgent,
    tags: [...decision.tags, TAGS.vip],
    message: lines(
      decision.message,
      "",
      `VIP customer: ${customer.numberOfOrders} orders, ${money(customer.amountSpent)} lifetime spend.`,
    ),
  };
}

/**
 * Which tags each team must have available, either scoped to the team or shared with
 * all teams. Every team gets one tag per store; VIP gets every rule tag because any
 * decision can be escalated there.
 */
export function requiredTagsByTeam(stores: Store[]): Map<string, string[]> {
  const storeTags = stores.map((store) => store.key);
  const byTeam = new Map<string, string[]>([
    [TEAMS.payments, [...storeTags, TAGS.paymentReview]],
    [TEAMS.returns, [...storeTags, TAGS.refund]],
    [TEAMS.vip, [...storeTags, ...Object.values(TAGS)]],
  ]);
  for (const store of stores) {
    byTeam.set(store.shippingTeam, [...storeTags, TAGS.deliveryIssue]);
  }
  return byTeam;
}

function lines(...parts: (string | null | undefined | false)[]): string {
  return parts.filter((part) => typeof part === "string").join("\n");
}

function money({ amount, currencyCode }: { amount: string; currencyCode: string }): string {
  return `${amount} ${currencyCode}`.trim();
}
