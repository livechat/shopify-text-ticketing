import type { TicketingClient } from "./client.js";

export const CUSTOM_FIELDS = {
  orderId: "shopify_order_id",
  orderUrl: "shopify_order_url",
} as const;

export type Directory = {
  teamId: (teamName: string) => string;
  tagIds: (teamId: string, tagNames: string[]) => string[];
};

/**
 * Resolves human-readable team and tag names from the routing rules into the UUIDs
 * the Ticketing API expects.
 */
export async function buildDirectory(
  client: Pick<TicketingClient, "listTeams" | "listTags" | "listCustomFields">,
  requiredTagsByTeam: Map<string, string[]>,
): Promise<Directory> {
  const [teams, tags, customFields] = await Promise.all([
    client.listTeams(),
    client.listTags(),
    client.listCustomFields(),
  ]);

  const teamIdByName = new Map(teams.map((team) => [team.name, team.ID]));
  // Tag names are unique per account; a tag is available to a team when it is shared
  // with all teams (teamID null) or scoped to that team.
  const tagByName = new Map(tags.map((tag) => [tag.name, tag]));
  const resolveTag = (teamId: string, name: string) => {
    const tag = tagByName.get(name);
    return tag && (tag.teamID === null || tag.teamID === teamId) ? tag.ID : undefined;
  };
  const activeFieldKeys = new Set(
    customFields.filter((field) => field.status === "active").map((field) => field.apiKey),
  );

  const missing: string[] = [];
  for (const [teamName, tagNames] of requiredTagsByTeam) {
    const teamId = teamIdByName.get(teamName);
    if (!teamId) {
      missing.push(`team "${teamName}"`);
      continue;
    }
    for (const tagName of tagNames) {
      if (!resolveTag(teamId, tagName)) missing.push(`tag "${tagName}" for team "${teamName}"`);
    }
  }
  for (const key of Object.values(CUSTOM_FIELDS)) {
    if (!activeFieldKeys.has(key)) missing.push(`custom field "${key}"`);
  }
  if (missing.length > 0) {
    throw new Error(
      `Ticketing account is missing: ${missing.join(", ")}. Run "npm run setup:ticketing" first.`,
    );
  }

  return {
    teamId: (teamName) => {
      const id = teamIdByName.get(teamName);
      if (!id) throw new Error(`Unknown team "${teamName}"`);
      return id;
    },
    tagIds: (teamId, tagNames) =>
      tagNames.flatMap((name) => {
        const id = resolveTag(teamId, name);
        return id ? [id] : [];
      }),
  };
}
