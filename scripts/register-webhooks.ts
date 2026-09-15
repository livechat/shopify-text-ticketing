import { loadConfig } from "../src/config.js";
import { createShopifyAdminClient } from "../src/shopify/admin.js";
import { SHOPIFY_TOPICS, type ShopifyTopic } from "../src/shopify/schemas.js";

/**
 * Subscribes every configured store to the topics this service handles, pointing
 * them at PUBLIC_URL. Rerun after the tunnel URL changes: existing matches are skipped
 * and subscriptions left over from a previous PUBLIC_URL of this service are deleted.
 */
const config = loadConfig();
if (!config.publicUrl) {
  console.error("Set PUBLIC_URL in .env to the HTTPS address of this service first.");
  process.exit(1);
}
const WEBHOOK_PATH = "/webhooks/shopify";
const callbackUrl = `${config.publicUrl}${WEBHOOK_PATH}`;

// The GraphQL enum spells topics differently from the REST-style `X-Shopify-Topic` header.
const TOPIC_ENUM: Record<ShopifyTopic, string> = {
  "orders/create": "ORDERS_CREATE",
  "refunds/create": "REFUNDS_CREATE",
  "fulfillment_events/create": "FULFILLMENT_EVENTS_CREATE",
};

const LIST_QUERY = /* GraphQL */ `
  query Subscriptions {
    webhookSubscriptions(first: 100) {
      nodes { id topic endpoint { __typename ... on WebhookHttpEndpoint { callbackUrl } } }
    }
  }
`;

const CREATE_MUTATION = /* GraphQL */ `
  mutation Subscribe($topic: WebhookSubscriptionTopic!, $callbackUrl: URL!) {
    webhookSubscriptionCreate(topic: $topic, webhookSubscription: { callbackUrl: $callbackUrl, format: JSON }) {
      webhookSubscription { id }
      userErrors { field message }
    }
  }
`;

type ListData = {
  webhookSubscriptions: {
    nodes: {
      id: string;
      topic: string;
      endpoint: { __typename: string; callbackUrl?: string };
    }[];
  };
};

type CreateData = {
  webhookSubscriptionCreate: {
    webhookSubscription: { id: string } | null;
    userErrors: { field: string[] | null; message: string }[];
  };
};

const DELETE_MUTATION = /* GraphQL */ `
  mutation Unsubscribe($id: ID!) {
    webhookSubscriptionDelete(id: $id) { deletedWebhookSubscriptionId userErrors { message } }
  }
`;

type DeleteData = {
  webhookSubscriptionDelete: {
    deletedWebhookSubscriptionId: string | null;
    userErrors: { message: string }[];
  };
};

for (const store of config.stores) {
  const client = createShopifyAdminClient(store);
  const existing = await client.graphql<ListData>(LIST_QUERY, {});
  const registered = new Set(
    existing.webhookSubscriptions.nodes
      .filter((node) => node.endpoint.callbackUrl === callbackUrl)
      .map((node) => node.topic),
  );

  // Same path, different host: a subscription this script made for an earlier tunnel URL.
  const stale = existing.webhookSubscriptions.nodes.filter(
    (node) =>
      node.endpoint.callbackUrl?.endsWith(WEBHOOK_PATH) &&
      node.endpoint.callbackUrl !== callbackUrl,
  );
  for (const node of stale) {
    const result = await client.graphql<DeleteData>(DELETE_MUTATION, { id: node.id });
    const { userErrors } = result.webhookSubscriptionDelete;
    const outcome = userErrors.length > 0 ? `FAILED ${JSON.stringify(userErrors)}` : "deleted";
    console.log(
      `${store.key.padEnd(8)} ${node.topic.padEnd(28)} ${outcome} (was ${node.endpoint.callbackUrl})`,
    );
  }

  for (const topic of SHOPIFY_TOPICS) {
    const enumTopic = TOPIC_ENUM[topic];
    if (registered.has(enumTopic)) {
      console.log(`${store.key.padEnd(8)} ${topic.padEnd(28)} exists`);
      continue;
    }
    const result = await client.graphql<CreateData>(CREATE_MUTATION, {
      topic: enumTopic,
      callbackUrl,
    });
    const { webhookSubscription, userErrors } = result.webhookSubscriptionCreate;
    if (userErrors.length > 0 || !webhookSubscription) {
      console.error(
        `${store.key.padEnd(8)} ${topic.padEnd(28)} FAILED ${JSON.stringify(userErrors)}`,
      );
      process.exitCode = 1;
      continue;
    }
    console.log(`${store.key.padEnd(8)} ${topic.padEnd(28)} created ${webhookSubscription.id}`);
  }
}
