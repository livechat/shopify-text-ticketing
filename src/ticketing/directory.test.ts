import { describe, expect, it } from "vitest";
import type { TicketingClient } from "./client.js";
import { buildDirectory } from "./directory.js";
import type { CustomField, Tag, Team } from "./types.js";

const payments: Team = { ID: "t-pay", name: "Payments" };
const vip: Team = { ID: "t-vip", name: "VIP" };
const tags: Tag[] = [
  { ID: "g-1", teamID: null, name: "payment-review" },
  { ID: "g-2", teamID: "t-vip", name: "vip" },
  { ID: "g-3", teamID: null, name: "main" },
];
const fields: CustomField[] = ["shopify_order_id", "shopify_order_url"].map((apiKey) => ({
  ID: `f-${apiKey}`,
  teamIDs: ["t-pay", "t-vip"],
  displayName: apiKey,
  apiKey,
  type: "singleLine",
  status: "active",
}));

function fakeClient(
  overrides: Partial<{ teams: Team[]; tags: Tag[]; fields: CustomField[] }> = {},
): Pick<TicketingClient, "listTeams" | "listTags" | "listCustomFields"> {
  return {
    listTeams: async () => overrides.teams ?? [payments, vip],
    listTags: async () => overrides.tags ?? tags,
    listCustomFields: async () => overrides.fields ?? fields,
  };
}

const required = new Map([
  ["Payments", ["main", "payment-review"]],
  ["VIP", ["main", "payment-review", "vip"]],
]);

describe("buildDirectory", () => {
  it("resolves shared tags for any team and scoped tags for their own team only", async () => {
    const directory = await buildDirectory(fakeClient(), required);

    expect(directory.teamId("Payments")).toBe("t-pay");
    expect(directory.tagIds("t-pay", ["main", "payment-review"])).toEqual(["g-3", "g-1"]);
    expect(directory.tagIds("t-vip", ["main", "payment-review", "vip"])).toEqual([
      "g-3",
      "g-1",
      "g-2",
    ]);
    expect(directory.tagIds("t-pay", ["vip"])).toEqual([]);
  });

  it("fails when a team is missing", async () => {
    await expect(buildDirectory(fakeClient({ teams: [payments] }), required)).rejects.toThrow(
      'team "VIP"',
    );
  });

  it("fails when a tag is missing or scoped to a different team", async () => {
    const withoutVip = tags.filter((tag) => tag.name !== "vip");
    await expect(buildDirectory(fakeClient({ tags: withoutVip }), required)).rejects.toThrow(
      'tag "vip" for team "VIP"',
    );

    const scopedElsewhere = tags.map((tag) =>
      tag.name === "payment-review" ? { ...tag, teamID: "t-pay" } : tag,
    );
    await expect(buildDirectory(fakeClient({ tags: scopedElsewhere }), required)).rejects.toThrow(
      'tag "payment-review" for team "VIP"',
    );
  });

  it("fails when a custom field is missing or deactivated", async () => {
    const deactivated: CustomField[] = fields.map((field) =>
      field.apiKey === "shopify_order_id" ? { ...field, status: "deactivated" } : field,
    );
    await expect(buildDirectory(fakeClient({ fields: deactivated }), required)).rejects.toThrow(
      'custom field "shopify_order_id"',
    );
  });
});
