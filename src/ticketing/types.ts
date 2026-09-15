// Subset of https://www.text.com/docs/api/ticketing used by this integration.

export const TicketPriority = {
  Low: -10,
  Medium: 0,
  High: 10,
  Urgent: 20,
} as const;

export type TicketPriority = (typeof TicketPriority)[keyof typeof TicketPriority];

export type TicketStatus = "open" | "pending" | "onhold" | "solved" | "closed";

export type Requester = {
  email: string;
  name?: string;
};

export type CreateTicketPayload = {
  subject?: string;
  status?: TicketStatus;
  priority?: TicketPriority;
  requester: Requester;
  message: { text: string };
  teamIDs?: string[];
  assignment?: { team: { ID: string }; agent: { ID: string } | null };
  tagIDs?: string[];
  customFields?: Record<string, string>;
  author?: { type: "client" | "agent" };
};

export type Ticket = {
  ID: string;
  shortID: string;
  subject: string;
  status: TicketStatus;
  priority: TicketPriority;
  teamIDs: string[];
  tagIDs: string[];
  customFields?: Record<string, string>;
};

export type Team = {
  ID: string;
  name: string;
};

export type CreateTeamPayload = {
  name: string;
};

export type Tag = {
  ID: string;
  /** A team UUID scopes the tag to that team; null makes it available to every team. */
  teamID: string | null;
  name: string;
};

export type CreateTagPayload = {
  teamID: string | null;
  name: string;
};

export type CustomFieldType = "singleLine" | "multiLine" | "date" | "url";

export type CustomField = {
  ID: string;
  teamIDs: string[];
  displayName: string;
  apiKey: string;
  type: CustomFieldType;
  status: "active" | "deactivated";
};

export type CreateCustomFieldPayload = {
  teamIDs: string[];
  displayName: string;
  apiKey: string;
  type: CustomFieldType;
  roleLevel: "owner" | "normal" | "readOnly";
  status: "active" | "deactivated";
};
