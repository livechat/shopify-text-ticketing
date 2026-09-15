import { z } from "zod";

export const SHOPIFY_TOPICS = [
  "orders/create",
  "refunds/create",
  "fulfillment_events/create",
] as const;
export type ShopifyTopic = (typeof SHOPIFY_TOPICS)[number];

export function isShopifyTopic(value: string | undefined): value is ShopifyTopic {
  return SHOPIFY_TOPICS.includes(value as ShopifyTopic);
}

// Only the fields the routing rules read. Shopify sends far more; Zod drops the rest.

export const orderCreateSchema = z.object({
  id: z.number(),
  admin_graphql_api_id: z.string(),
  name: z.string(),
  email: z.string().nullable().optional(),
  financial_status: z.string().nullable().optional(),
  total_price: z.string(),
  currency: z.string(),
});
export type OrderCreate = z.infer<typeof orderCreateSchema>;

export const refundCreateSchema = z.object({
  id: z.number(),
  order_id: z.number(),
  note: z.string().nullable().optional(),
  transactions: z.array(z.object({ amount: z.string(), currency: z.string() })).default([]),
});
export type RefundCreate = z.infer<typeof refundCreateSchema>;

export const fulfillmentEventCreateSchema = z.object({
  id: z.number(),
  fulfillment_id: z.number(),
  order_id: z.number(),
  status: z.string(),
  message: z.string().nullable().optional(),
  happened_at: z.string().optional(),
});
export type FulfillmentEventCreate = z.infer<typeof fulfillmentEventCreateSchema>;

export type ShopifyEvent =
  | { topic: "orders/create"; payload: OrderCreate }
  | { topic: "refunds/create"; payload: RefundCreate }
  | { topic: "fulfillment_events/create"; payload: FulfillmentEventCreate };

export function parseShopifyEvent(topic: ShopifyTopic, json: unknown): ShopifyEvent {
  switch (topic) {
    case "orders/create":
      return { topic, payload: orderCreateSchema.parse(json) };
    case "refunds/create":
      return { topic, payload: refundCreateSchema.parse(json) };
    case "fulfillment_events/create":
      return { topic, payload: fulfillmentEventCreateSchema.parse(json) };
  }
}

export function orderIdOf(event: ShopifyEvent): number {
  return event.topic === "orders/create" ? event.payload.id : event.payload.order_id;
}
