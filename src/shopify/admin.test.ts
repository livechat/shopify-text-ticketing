import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Store } from "../config.js";
import { ShopifyAdminError, createShopifyAdminClient } from "./admin.js";

const store: Store = {
  key: "main",
  label: "Acme Main",
  shopDomain: "acme-main.myshopify.com",
  credentialsKey: "ACME",
  shippingTeam: "Orders & Shipping",
  vipThreshold: 1000,
  clientId: "client-id",
  clientSecret: "client-secret",
};

const tokenResponse = (token: string) =>
  new Response(JSON.stringify({ access_token: token, expires_in: 86399, scope: "read_orders" }));

const dataResponse = (data: unknown, status = 200) =>
  new Response(JSON.stringify({ data }), { status });

describe("createShopifyAdminClient", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("exchanges client credentials for a token and reuses it", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(tokenResponse("token-1"))
      .mockResolvedValueOnce(dataResponse({ shop: { name: "Acme" } }))
      .mockResolvedValueOnce(dataResponse({ shop: { name: "Acme" } }));
    const client = createShopifyAdminClient(store, fetchFn);

    await client.graphql("{ shop { name } }", {});
    await client.graphql("{ shop { name } }", {});

    expect(fetchFn).toHaveBeenCalledTimes(3);
    const [tokenUrl, tokenInit] = fetchFn.mock.calls[0] ?? [];
    expect(tokenUrl).toBe("https://acme-main.myshopify.com/admin/oauth/access_token");
    expect(String(tokenInit?.body)).toBe(
      "grant_type=client_credentials&client_id=client-id&client_secret=client-secret",
    );
    const [, graphqlInit] = fetchFn.mock.calls[1] ?? [];
    expect(graphqlInit?.headers).toMatchObject({ "X-Shopify-Access-Token": "token-1" });
  });

  it("requests a fresh token shortly before the old one expires", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(tokenResponse("token-1"))
      .mockResolvedValueOnce(dataResponse({}))
      .mockResolvedValueOnce(tokenResponse("token-2"))
      .mockResolvedValueOnce(dataResponse({}));
    const client = createShopifyAdminClient(store, fetchFn);

    await client.graphql("{ shop { name } }", {});
    vi.advanceTimersByTime((86399 - 30) * 1000);
    await client.graphql("{ shop { name } }", {});

    const [, secondGraphqlInit] = fetchFn.mock.calls[3] ?? [];
    expect(secondGraphqlInit?.headers).toMatchObject({ "X-Shopify-Access-Token": "token-2" });
  });

  it("drops the cached token when Shopify answers 401", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(tokenResponse("token-1"))
      .mockResolvedValueOnce(new Response("", { status: 401 }))
      .mockResolvedValueOnce(tokenResponse("token-2"))
      .mockResolvedValueOnce(dataResponse({}));
    const client = createShopifyAdminClient(store, fetchFn);

    await expect(client.graphql("{ shop { name } }", {})).rejects.toBeInstanceOf(ShopifyAdminError);
    await client.graphql("{ shop { name } }", {});

    const [, retriedInit] = fetchFn.mock.calls[3] ?? [];
    expect(retriedInit?.headers).toMatchObject({ "X-Shopify-Access-Token": "token-2" });
  });

  it("reduces an HTML error page from the token endpoint to its title", async () => {
    const page =
      "<html><head><title>400 - Oauth error app_not_installed</title></head><body>…</body></html>";
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(page, { status: 400 }));
    const client = createShopifyAdminClient(store, fetchFn);

    await expect(client.graphql("{ shop { name } }", {})).rejects.toThrow(
      '"body":"400 - Oauth error app_not_installed"',
    );
  });

  it("surfaces GraphQL errors as ShopifyAdminError", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(tokenResponse("token-1"))
      .mockResolvedValueOnce(new Response(JSON.stringify({ errors: [{ message: "nope" }] })));
    const client = createShopifyAdminClient(store, fetchFn);

    await expect(client.graphql("{ shop { name } }", {})).rejects.toThrow("nope");
  });
});
