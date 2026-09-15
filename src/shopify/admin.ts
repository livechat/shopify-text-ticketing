import type { Store } from "../config.js";

const SHOPIFY_API_VERSION = "2025-07";

export class ShopifyAdminError extends Error {
  constructor(
    readonly shopDomain: string,
    readonly details: unknown,
  ) {
    super(`Shopify Admin API call to ${shopDomain} failed: ${JSON.stringify(details)}`);
    this.name = "ShopifyAdminError";
  }
}

export type RiskLevel = "HIGH" | "MEDIUM" | "LOW" | "NONE" | "PENDING";

export type OrderContext = {
  legacyId: number;
  name: string;
  email: string | null;
  financialStatus: string | null;
  totalPrice: { amount: string; currencyCode: string };
  customer: {
    firstName: string | null;
    lastName: string | null;
    email: string | null;
    numberOfOrders: number;
    amountSpent: { amount: string; currencyCode: string };
  } | null;
  riskLevel: RiskLevel | null;
  adminUrl: string;
};

type GraphqlResponse<T> = {
  data?: T;
  errors?: { message: string }[];
};

type TokenResponse = {
  access_token: string;
  expires_in: number;
};

export function createShopifyAdminClient(store: Store, fetchFn: typeof fetch = fetch) {
  const tokenEndpoint = `https://${store.shopDomain}/admin/oauth/access_token`;
  const graphqlEndpoint = `https://${store.shopDomain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`;
  let cached: { token: string; expiresAt: number } | null = null;

  /**
   * Apps created in the Dev Dashboard have no permanent admin token. The client
   * credentials grant exchanges the app's client ID and secret for a token that lives
   * 24 hours, so the client caches it and asks for a new one shortly before it expires.
   */
  async function accessToken(): Promise<string> {
    if (cached && Date.now() < cached.expiresAt) return cached.token;

    const response = await fetchFn(tokenEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: store.clientId,
        client_secret: store.clientSecret,
      }),
    });
    if (!response.ok) {
      throw new ShopifyAdminError(store.shopDomain, {
        step: "access_token",
        status: response.status,
        body: summarize(await response.text()),
      });
    }

    const json = (await response.json()) as TokenResponse;
    cached = { token: json.access_token, expiresAt: Date.now() + (json.expires_in - 60) * 1000 };
    return cached.token;
  }

  async function graphql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    const response = await fetchFn(graphqlEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": await accessToken(),
      },
      body: JSON.stringify({ query, variables }),
    });

    if (!response.ok) {
      // A revoked or expired token is fetched again on the next call.
      if (response.status === 401) cached = null;
      throw new ShopifyAdminError(store.shopDomain, {
        step: "graphql",
        status: response.status,
        body: summarize(await response.text()),
      });
    }
    const json = (await response.json()) as GraphqlResponse<T>;
    if (json.errors?.length || !json.data) {
      throw new ShopifyAdminError(store.shopDomain, json.errors ?? "empty data");
    }
    return json.data;
  }

  return { store, graphql };
}

export type ShopifyAdminClient = ReturnType<typeof createShopifyAdminClient>;

/** Shopify answers some OAuth failures with a full HTML page; its title carries the reason. */
function summarize(body: string): string {
  const title = /<title>([^<]*)<\/title>/i.exec(body)?.[1]?.trim();
  return title ?? body.slice(0, 500);
}

const ORDER_CONTEXT_QUERY = /* GraphQL */ `
  query OrderContext($id: ID!) {
    order(id: $id) {
      legacyResourceId
      name
      email
      displayFinancialStatus
      totalPriceSet { shopMoney { amount currencyCode } }
      customer {
        firstName
        lastName
        email
        numberOfOrders
        amountSpent { amount currencyCode }
      }
      risk { assessments { riskLevel } }
    }
  }
`;

type OrderContextData = {
  order: {
    legacyResourceId: string;
    name: string;
    email: string | null;
    displayFinancialStatus: string | null;
    totalPriceSet: { shopMoney: { amount: string; currencyCode: string } };
    customer: {
      firstName: string | null;
      lastName: string | null;
      email: string | null;
      numberOfOrders: string;
      amountSpent: { amount: string; currencyCode: string };
    } | null;
    risk: { assessments: { riskLevel: RiskLevel }[] } | null;
  } | null;
};

/**
 * Webhook payloads for refunds and fulfillment events carry only the order ID, and
 * none of them carry the customer's lifetime value or the fraud assessment. One
 * Admin API round-trip fills in everything the routing rules need.
 */
export async function getOrderContext(
  client: ShopifyAdminClient,
  orderLegacyId: number,
): Promise<OrderContext> {
  const { store } = client;
  const data = await client.graphql<OrderContextData>(ORDER_CONTEXT_QUERY, {
    id: `gid://shopify/Order/${orderLegacyId}`,
  });
  const order = data.order;
  if (!order) {
    throw new ShopifyAdminError(store.shopDomain, `order ${orderLegacyId} not found`);
  }

  return {
    legacyId: Number(order.legacyResourceId),
    name: order.name,
    email: order.email,
    financialStatus: order.displayFinancialStatus,
    totalPrice: order.totalPriceSet.shopMoney,
    customer: order.customer
      ? {
          firstName: order.customer.firstName,
          lastName: order.customer.lastName,
          email: order.customer.email,
          numberOfOrders: Number(order.customer.numberOfOrders),
          amountSpent: order.customer.amountSpent,
        }
      : null,
    riskLevel: highestRisk(order.risk?.assessments ?? []),
    adminUrl: `https://${store.shopDomain}/admin/orders/${orderLegacyId}`,
  };
}

const RISK_ORDER: RiskLevel[] = ["HIGH", "MEDIUM", "LOW", "NONE", "PENDING"];

function highestRisk(assessments: { riskLevel: RiskLevel }[]): RiskLevel | null {
  for (const level of RISK_ORDER) {
    if (assessments.some((assessment) => assessment.riskLevel === level)) return level;
  }
  return null;
}
