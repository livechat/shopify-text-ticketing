import type { Store } from "../config.js";
import type { RoutingDecision } from "../routing/rules.js";
import type { OrderContext } from "../shopify/admin.js";
import { CUSTOM_FIELDS, type Directory } from "./directory.js";
import type { CreateTicketPayload } from "./types.js";

export function buildTicketPayload(
  store: Store,
  decision: RoutingDecision,
  order: OrderContext,
  directory: Directory,
): CreateTicketPayload {
  const teamId = directory.teamId(decision.team);

  return {
    subject: decision.subject,
    status: "open",
    priority: decision.priority,
    requester: requesterFor(store, order),
    message: {
      text: [
        decision.message,
        "",
        `Order: ${order.name}`,
        `Store: ${store.label}`,
        `Admin: ${order.adminUrl}`,
      ].join("\n"),
    },
    teamIDs: [teamId],
    // Without an assignment the API assigns the account's default team and then rejects
    // it for not being in teamIDs. `agent: null` means "this team's queue, nobody yet".
    assignment: { team: { ID: teamId }, agent: null },
    tagIDs: directory.tagIds(teamId, decision.tags),
    customFields: {
      [CUSTOM_FIELDS.orderId]: String(order.legacyId),
      [CUSTOM_FIELDS.orderUrl]: order.adminUrl,
    },
    // The shopper is the requester, so the ticket reads as an inbound request rather than an agent note.
    author: { type: "client" },
  };
}

function requesterFor(store: Store, order: OrderContext): CreateTicketPayload["requester"] {
  const email = order.email ?? order.customer?.email;
  if (!email) {
    // Guest checkouts without an email still need a requester; use the store mailbox.
    return { email: `orders@${store.shopDomain}`, name: "Guest checkout" };
  }

  const name = [order.customer?.firstName, order.customer?.lastName].filter(Boolean).join(" ");
  return name ? { email, name } : { email };
}
