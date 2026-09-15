import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Shopify signs every webhook with HMAC-SHA256 over the raw request body using the
 * app's client secret and sends the base64 digest in `X-Shopify-Hmac-Sha256`.
 * The body must be verified before it is parsed — re-serialised JSON will not match.
 */
export function verifyShopifyHmac(
  rawBody: string,
  hmacHeader: string | undefined,
  clientSecret: string,
): boolean {
  if (!hmacHeader) return false;

  const expected = createHmac("sha256", clientSecret).update(rawBody, "utf8").digest();
  const received = Buffer.from(hmacHeader, "base64");

  return expected.length === received.length && timingSafeEqual(expected, received);
}

export function signShopifyBody(rawBody: string, clientSecret: string): string {
  return createHmac("sha256", clientSecret).update(rawBody, "utf8").digest("base64");
}
