/**
 * Shopify retries a webhook for up to 48 hours until it gets a 2xx, so the same
 * `X-Shopify-Webhook-Id` can arrive more than once. A bounded in-memory set is
 * enough for a single-process demo; swap in Redis or a database for production.
 */
export function createDedupe(capacity = 10_000) {
  const seen = new Set<string>();

  return {
    has: (id: string) => seen.has(id),
    add: (id: string) => {
      if (seen.size >= capacity) {
        const oldest = seen.values().next().value;
        if (oldest !== undefined) seen.delete(oldest);
      }
      seen.add(id);
    },
  };
}

export type Dedupe = ReturnType<typeof createDedupe>;
