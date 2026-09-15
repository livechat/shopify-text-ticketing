import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

const env = {
  TEXT_ACCOUNT_ID: "account",
  TEXT_PAT: "token",
  SHOPIFY_ACME_CLIENT_ID: "client-id",
  SHOPIFY_ACME_CLIENT_SECRET: "client-secret",
};

describe("loadConfig", () => {
  it("treats an empty PUBLIC_URL as unset", () => {
    const config = loadConfig({ ...env, PUBLIC_URL: "" }, "config/stores.example.json");
    expect(config.publicUrl).toBeUndefined();
  });

  it("keeps a real PUBLIC_URL", () => {
    const config = loadConfig(
      { ...env, PUBLIC_URL: "https://abc.ngrok.app" },
      "config/stores.example.json",
    );
    expect(config.publicUrl).toBe("https://abc.ngrok.app");
  });

  it("rejects a PUBLIC_URL that is not a URL", () => {
    expect(() =>
      loadConfig({ ...env, PUBLIC_URL: "not a url" }, "config/stores.example.json"),
    ).toThrow();
  });
});
