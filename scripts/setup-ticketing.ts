import { loadConfig } from "../src/config.js";
import { requiredTagsByTeam } from "../src/routing/rules.js";
import { createTicketingClient } from "../src/ticketing/client.js";
import { CUSTOM_FIELDS } from "../src/ticketing/directory.js";
import type { CustomFieldType } from "../src/ticketing/types.js";

/**
 * Creates the teams, tags and custom fields the routing rules refer to.
 * Safe to rerun: anything that already exists is left alone.
 */
const config = loadConfig();
const client = createTicketingClient(config.text);

const tagsByTeam = requiredTagsByTeam(config.stores);

const existingTeams = await client.listTeams();
const teamIdByName = new Map(existingTeams.map((team) => [team.name, team.ID]));

for (const name of tagsByTeam.keys()) {
  if (teamIdByName.has(name)) {
    console.log(`team   ${pad(name)} exists  ${teamIdByName.get(name)}`);
    continue;
  }
  const team = await client.createTeam({ name });
  teamIdByName.set(name, team.ID);
  console.log(`team   ${pad(name)} created ${team.ID}`);
}

// Tag names are unique per account. A tag is either shared with all teams (teamID null)
// or scoped to one team. Names that do not exist yet are created as shared; a name that
// exists but is scoped to another team cannot be recreated, so it is reported instead.
const existingTags = await client.listTags();
const tagByName = new Map(existingTags.map((tag) => [tag.name, tag]));

const tagsToCreate = new Set<string>();
const tagsToWiden = new Map<string, string[]>();
for (const [teamName, tagNames] of tagsByTeam) {
  const teamID = teamIdByName.get(teamName);
  if (!teamID) continue;
  for (const name of tagNames) {
    const tag = tagByName.get(name);
    if (!tag) {
      tagsToCreate.add(name);
    } else if (tag.teamID !== null && tag.teamID !== teamID) {
      tagsToWiden.set(name, [...(tagsToWiden.get(name) ?? []), teamName]);
    }
  }
}
for (const name of tagsToCreate) {
  await client.createTag({ teamID: null, name });
  console.log(`tag    ${pad(name)} created for all teams`);
}
if (tagsToWiden.size > 0) {
  console.log("\nThese tags are scoped to one team but other teams need them too.");
  console.log("In the Text app, change each one to all teams, then rerun this script:");
  for (const [name, teamNames] of tagsToWiden) {
    console.log(`  - "${name}" also needed by ${teamNames.join(", ")}`);
  }
  process.exit(1);
}
if (tagsToCreate.size === 0) console.log("tags   all available");

const allTeamIds = [...teamIdByName.values()];
const existingFields = await client.listCustomFields();
const fieldByKey = new Map(existingFields.map((field) => [field.apiKey, field]));

const wantedFields: { apiKey: string; displayName: string; type: CustomFieldType }[] = [
  { apiKey: CUSTOM_FIELDS.orderId, displayName: "Shopify order ID", type: "singleLine" },
  { apiKey: CUSTOM_FIELDS.orderUrl, displayName: "Shopify order", type: "url" },
];

for (const wanted of wantedFields) {
  if (fieldByKey.has(wanted.apiKey)) {
    console.log(`field  ${pad(wanted.apiKey)} exists`);
    continue;
  }
  await client.createCustomField({
    ...wanted,
    teamIDs: allTeamIds,
    roleLevel: "normal",
    status: "active",
  });
  console.log(`field  ${pad(wanted.apiKey)} created`);
}

console.log(
  "\nTicketing account is ready. Next: npm run dev, start a tunnel, then npm run register:webhooks.",
);

function pad(value: string): string {
  return value.padEnd(24);
}
