import type {
  CreateCustomFieldPayload,
  CreateTagPayload,
  CreateTeamPayload,
  CreateTicketPayload,
  CustomField,
  Tag,
  Team,
  Ticket,
} from "./types.js";

export class TicketingApiError extends Error {
  constructor(
    readonly status: number,
    readonly method: string,
    readonly path: string,
    readonly body: unknown,
  ) {
    super(`Ticketing API ${method} ${path} failed with ${status}: ${JSON.stringify(body)}`);
    this.name = "TicketingApiError";
  }
}

/** Server listed in the Text Ticketing API reference: https://www.text.com/docs/api/ticketing */
const TICKETING_BASE_URL = "https://api.helpdesk.com";

export type TicketingClientOptions = {
  accountId: string;
  pat: string;
  baseUrl?: string;
  fetchFn?: typeof fetch;
};

export function createTicketingClient(options: TicketingClientOptions) {
  const baseUrl = (options.baseUrl ?? TICKETING_BASE_URL).replace(/\/$/, "");
  const fetchFn = options.fetchFn ?? fetch;
  // A Personal Access Token is sent as HTTP Basic auth: account ID as user, token as password.
  const authorization = `Basic ${Buffer.from(`${options.accountId}:${options.pat}`).toString("base64")}`;

  async function request<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const response = await fetchFn(`${baseUrl}${path}`, {
      method,
      headers: {
        Authorization: authorization,
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

    const text = await response.text();
    const parsed: unknown = text.length > 0 ? safeJson(text) : null;

    if (!response.ok) {
      throw new TicketingApiError(response.status, method, path, parsed);
    }
    return parsed as T;
  }

  return {
    listTeams: () => request<Team[]>("GET", "/v1/teams"),
    createTeam: (payload: CreateTeamPayload) => request<Team>("POST", "/v1/teams", payload),
    listTags: () => request<Tag[]>("GET", "/v1/tags"),
    createTag: (payload: CreateTagPayload) => request<Tag>("POST", "/v1/tags", payload),
    listCustomFields: () => request<CustomField[]>("GET", "/v1/customFields"),
    createCustomField: (payload: CreateCustomFieldPayload) =>
      request<CustomField>("POST", "/v1/customFields", payload),
    createTicket: (payload: CreateTicketPayload) => request<Ticket>("POST", "/v1/tickets", payload),
  };
}

export type TicketingClient = ReturnType<typeof createTicketingClient>;

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
