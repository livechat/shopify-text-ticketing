import { readFileSync } from "node:fs";
import { z } from "zod";

const envSchema = z.object({
  TEXT_ACCOUNT_ID: z.string().min(1, "TEXT_ACCOUNT_ID is required"),
  TEXT_PAT: z.string().min(1, "TEXT_PAT is required"),
  // `PUBLIC_URL=` in .env arrives as an empty string; treat it the same as unset.
  PUBLIC_URL: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.string().url().optional(),
  ),
  PORT: z.coerce.number().int().positive().default(3000),
});

const storeEntrySchema = z.object({
  key: z.string().regex(/^[a-z0-9-]+$/, "store key must be kebab-case"),
  label: z.string().min(1),
  shopDomain: z.string().regex(/\.myshopify\.com$/, "shopDomain must end with .myshopify.com"),
  credentialsKey: z.string().regex(/^[A-Z0-9_]+$/, "credentialsKey must be UPPER_SNAKE"),
  shippingTeam: z.string().min(1),
  vipThreshold: z.number().nonnegative(),
});

const storesFileSchema = z.object({ stores: z.array(storeEntrySchema).min(1) });

type StoreEntry = z.infer<typeof storeEntrySchema>;

export type Store = StoreEntry & {
  clientId: string;
  clientSecret: string;
};

export type Config = {
  text: { accountId: string; pat: string };
  publicUrl: string | undefined;
  port: number;
  stores: Store[];
};

type Env = Record<string, string | undefined>;

export function loadConfig(env: Env = process.env, storesPath = "config/stores.json"): Config {
  const parsedEnv = envSchema.parse(env);
  const storesFile = storesFileSchema.parse(JSON.parse(readFileSync(storesPath, "utf8")));

  const stores = storesFile.stores.map((entry) => withCredentials(entry, env));

  return {
    text: { accountId: parsedEnv.TEXT_ACCOUNT_ID, pat: parsedEnv.TEXT_PAT },
    publicUrl: parsedEnv.PUBLIC_URL,
    port: parsedEnv.PORT,
    stores,
  };
}

function withCredentials(entry: StoreEntry, env: Env): Store {
  const idKey = `SHOPIFY_${entry.credentialsKey}_CLIENT_ID`;
  const secretKey = `SHOPIFY_${entry.credentialsKey}_CLIENT_SECRET`;
  const clientId = env[idKey];
  const clientSecret = env[secretKey];

  if (!clientId || !clientSecret) {
    throw new Error(`Store "${entry.key}" needs ${idKey} and ${secretKey} in the environment`);
  }

  return { ...entry, clientId, clientSecret };
}

export function findStoreByDomain(
  stores: Store[],
  shopDomain: string | undefined,
): Store | undefined {
  if (!shopDomain) return undefined;
  return stores.find((store) => store.shopDomain === shopDomain.toLowerCase());
}
