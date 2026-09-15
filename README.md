# Shopify → Text Ticketing

Reference integration for the use-case guide. It listens to webhooks from several Shopify stores, enriches each event with one Admin API lookup, decides which support team should own it, and creates a ticket through the [Text Ticketing API](https://www.text.com/docs/api/ticketing).

It brings many stores into one Ticketing account, routes each event by order and customer data, and writes the order context into the ticket before an agent opens it.

## How routing works

`src/routing/rules.ts` is an ordered list of rules. The first match wins, then a VIP override may escalate it.

| Shopify event | Condition | Team | Priority | Tags |
| --- | --- | --- | --- | --- |
| `orders/create` | fraud assessment is `HIGH` | Payments | high | `<store>`, `payment-review` |
| `orders/create` | payment `pending` or `authorized` | Payments | high | `<store>`, `payment-review` |
| `refunds/create` | always | Returns & Refunds | medium | `<store>`, `refund` |
| `fulfillment_events/create` | status `failure` or `attempted_delivery` | the store's `shippingTeam` | high | `<store>`, `delivery-issue` |
| any of the above | customer lifetime spend ≥ store `vipThreshold` | VIP | urgent | + `vip` |

Anything else (a paid low-risk order, a routine tracking scan) is acknowledged and dropped.

Every ticket carries the order ID and admin URL in two custom fields (`shopify_order_id`, `shopify_order_url`), the shopper as requester, and `author.type: "client"` so it reads as an inbound request.

Tag names are unique per account, and each tag is either scoped to one team or shared with all teams (`teamID: null` in the API). The service uses a tag when it is shared or scoped to the ticket's team. The setup script creates missing tags as shared. The store tags and the rule tags that VIP escalation reuses (`payment-review`, `refund`, `delivery-issue`) must therefore be shared; `vip` may stay scoped to the VIP team. If an existing tag is scoped to one team but another team needs it, the script names it and asks you to widen it in the Text app.

## Request flow

```
Shopify store ──webhook──▶ POST /webhooks/shopify
                              1. find store by X-Shopify-Shop-Domain
                              2. verify X-Shopify-Hmac-Sha256 over the raw body
                              3. drop duplicate X-Shopify-Webhook-Id
                              4. parse payload (zod)
                              5. Admin GraphQL: order, customer spend, risk   ──▶ Shopify Admin API
                              6. routeEvent → team / priority / tags
                              7. POST /v1/tickets                              ──▶ Text Ticketing API
```

## Getting started

The setup lives in one place: [docs/walkthrough.md](docs/walkthrough.md). It covers creating the Shopify stores and the Dev Dashboard app, the protected customer data request, the Text token, the Ticketing teams and tags, the tunnel, webhook registration, the test scenarios, and the failures you may hit on the way.

The commands you will run, in order:

```bash
npm install
cp .env.example .env
cp config/stores.example.json config/stores.json
npm run setup:ticketing      # creates the teams, tags and custom fields the rules refer to
npm run dev                  # starts the service on PORT (default 3000)
npm run register:webhooks    # subscribes every store to the three topics at PUBLIC_URL
```

The service logs one JSON line per delivery with the rule that matched and the ticket short ID.

## Project layout

```
src/index.ts                     Hono server, boot-time directory check
src/config.ts                    env + stores.json → typed config
src/handlers/shopify-webhook.ts  verify → dedupe → parse → enrich → route → create ticket
src/routing/rules.ts             the routing table
src/ticketing/build-ticket.ts    routing decision + order context → ticket body
src/shopify/verify.ts            HMAC verification
src/shopify/schemas.ts           zod schemas for the three topics
src/shopify/admin.ts             token exchange + cache, Admin GraphQL client, order context query
src/ticketing/client.ts          Ticketing API client (Basic auth, fetch)
src/ticketing/directory.ts       team/tag names → UUIDs
scripts/setup-ticketing.ts       creates teams, tags, custom fields
scripts/register-webhooks.ts     creates webhook subscriptions per store
```

## Checks

```bash
npm test
npm run typecheck
npm run lint
```

## Before running this in production

- Replace the in-memory dedupe (`src/dedupe.ts`) with Redis or a database so restarts and multiple instances do not create duplicate tickets.
- Respond to Shopify within 5 seconds. The Admin API lookup and ticket creation fit today, but under load queue the work and acknowledge first.
- Keep tokens out of the repo. `.env` and `config/stores.json` are gitignored; use your platform's secret store when deploying.
- Rotate the Shopify client secret and Text token like any other credential. Both are read at boot only.
