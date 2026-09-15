import { describe, expect, it } from "vitest";
import { signShopifyBody, verifyShopifyHmac } from "./verify.js";

const secret = "shpss_test_secret";
const body = JSON.stringify({ id: 1, name: "#1001" });

describe("verifyShopifyHmac", () => {
  it("accepts a body signed with the store secret", () => {
    expect(verifyShopifyHmac(body, signShopifyBody(body, secret), secret)).toBe(true);
  });

  it("rejects a tampered body", () => {
    const signature = signShopifyBody(body, secret);
    expect(verifyShopifyHmac(`${body} `, signature, secret)).toBe(false);
  });

  it("rejects a signature made with another store's secret", () => {
    expect(verifyShopifyHmac(body, signShopifyBody(body, "other"), secret)).toBe(false);
  });

  it("rejects a missing or malformed header", () => {
    expect(verifyShopifyHmac(body, undefined, secret)).toBe(false);
    expect(verifyShopifyHmac(body, "not-base64!", secret)).toBe(false);
  });
});
