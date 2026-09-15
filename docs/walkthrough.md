# Walkthrough: from empty accounts to the first routed ticket

This is the end-to-end setup and test procedure for the integration. Every command runs from the project root.

You need Node 22 or newer, a Text account with Ticketing, a Shopify Dev Dashboard account, and [ngrok](https://ngrok.com) to expose the local service to Shopify.

## 1. Shopify stores

You need one store per entry in `config/stores.json`. Two are enough to show multi-store routing.

1. Sign in at [dev.shopify.com](https://dev.shopify.com). This is the Dev Dashboard, and its organization is what ties stores and apps together.
2. Under **Stores**, create a development store. Pick the option that pre-fills test products and customers. Name it after the store key you will use, for example `acme-main`.
3. Repeat for a second store, for example `acme-outlet`.
4. Note each store's `.myshopify.com` domain from its admin URL.

A regular trial store works too, as long as it appears in the same Dev Dashboard organization as the app. Development stores are free for as long as you need them, which is why they are the default here.

## 2. Shopify app

One app serves every store in the organization.

1. In the Dev Dashboard open **Apps** and create an app. Choose the manual path, not the Shopify CLI template. This app has no UI.
2. Under the app's **Admin API access scopes**, add `read_orders`, `read_customers`, `read_fulfillments`, and `write_fulfillments`. The last one is only used to simulate a failed delivery in step 7.
3. Release the app version.
4. Request access to protected customer data. Order, refund, and fulfillment webhooks carry customer details, and Shopify refuses those subscriptions until the app declares why it needs them. Open the app's **API access requests** or **Protected customer data access** section, click **Request access**, select **Protected customer data**, and give a one-line reason such as "Create support tickets from order events and route them to the right team". Under the optional fields, also request **Name** and **Email** with a reason each. The integration uses both for the ticket requester. Skip address and phone. For development stores the access is granted immediately.
5. Install the app on every store, either from the install button next to the store or through a generated install link opened while signed in to that store.
6. From the app's credentials page copy the **client ID** and **client secret**. The service exchanges them for a 24-hour Admin API token per store, and Shopify signs webhooks with the same client secret.

## 3. Text account

1. Sign in to your Text account with Ticketing enabled.
2. In Text create a Personal Access Token. Select `accounts--my:ro` scope.
3. Note your account ID. It is shown next to the token. The token travels as HTTP Basic auth with the account ID as user and the token as password.

## 4. Project configuration

```bash
npm install
cp config/stores.example.json config/stores.json
cp .env.example .env
```

In `config/stores.json` keep one entry per store you created and delete the rest. Set each `shopDomain` to the real domain. Leave `credentialsKey` as `ACME` for every store served by the same app.

In `.env` fill in `TEXT_ACCOUNT_ID`, `TEXT_PAT`, `SHOPIFY_ACME_CLIENT_ID`, and `SHOPIFY_ACME_CLIENT_SECRET`. Leave `PUBLIC_URL` for step 6.

## 5. Ticketing teams, tags, and custom fields

```bash
npm run setup:ticketing
```

The script creates what is missing and prints one line per team, tag, and field. Rerunning is safe and prints `exists` or `all available`.

Teams: **Payments**, **Returns & Refunds**, **VIP**, and every `shippingTeam` from `stores.json`. The example config uses **Orders & Shipping** and **Orders & Shipping EU**.

Tags. Names are unique per account, and each tag is either scoped to one team or shared with all teams:

| Tag | Scope |
| --- | --- |
| one per store key (`main`, `outlet`, `eu`) | all teams |
| `payment-review` | all teams |
| `refund` | all teams |
| `delivery-issue` | all teams |
| `vip` | VIP, or all teams |

The three rule tags must be shared because VIP escalation keeps them on the ticket, and `delivery-issue` spans two shipping teams.

Custom fields, if you create them by hand: `shopify_order_id` as a single-line field and `shopify_order_url` as a URL field, both attached to all teams. Only the API key and the type matter; the display name is yours.

## 6. Run the service and register webhooks

Terminal one:

```bash
npm run dev
```

Expected:

```
Listening on http://localhost:3000 for 3 store(s)
```

If it prints "Ticketing account is missing", step 5 is incomplete. If it prints "Configuration is incomplete", a variable in `.env` is empty.

Terminal two:

```bash
curl -s http://localhost:3000/health
ngrok http 3000
```

Copy the `https` Forwarding address ngrok prints, without a trailing slash, into `.env` as `PUBLIC_URL`. Then restart `npm run dev` with Ctrl+C and the same command. The watcher restarts on source and `config/stores.json` changes but cannot see `.env`, so environment edits always need a manual restart. The second boot line now shows the webhook URL.

Terminal three:

```bash
npm run register:webhooks
```

Expected output is three `created` lines per store. Rerunning prints `exists`. Subscriptions created through the API do not appear on the Shopify admin's Notifications page, so this script is how you inspect them.

ngrok's free plan issues a new hostname on every restart. When that happens, update `PUBLIC_URL`, restart `npm run dev`, and rerun this script. It creates subscriptions for the new address and deletes the ones that pointed at the previous one.

Two failures are common here:

- `step: "access_token"` with status 400 or 401. The app is not installed on that store, the store is not in the same organization as the app, or the client secret is wrong.
- `FAILED` with "not approved to subscribe to webhook topics containing protected customer data". Step 2.4 was skipped or not saved.

The ngrok inspector at http://127.0.0.1:4040 shows every delivery Shopify sends. Keep it open during step 7.

## 7. Scenarios

Keep the `npm run dev` terminal visible. Every delivery logs one JSON line whose `message` says what happened. `rule` and `ticket` appear when a ticket was created.

**7.1 Pending payment goes to Payments.** In the main store admin: **Orders**, **Create order**. Add a product. Add a customer with an email address. Under Payment choose **Payment due later**, then **Create order**. Within seconds the log shows `"rule":"pending-payment"`. In the Text app the Payments team has a new open ticket at high priority, tagged with the store key and `payment-review`, with the customer as requester. The sidebar shows the order ID and a clickable link to the order.

**7.2 Paid order creates nothing.** Create another order, then **Collect payment**, **Mark as paid**. The log shows `no ticket needed`.

**7.3 Refund goes to Returns & Refunds.** Open the paid order, **Refund**, choose an item, confirm. The log shows `"rule":"refund"` and the ticket quotes the refunded amount and your note.

**7.4 Multi-store.** Repeat 7.1 in the outlet store. Same Payments team, `outlet` tag, outlet label in the subject.

**7.5 VIP escalation.** In `config/stores.json` set `vipThreshold` for the main store to `1`. The dev server restarts on its own. Refund another item on the main store order. The log shows `"rule":"refund+vip"` and the ticket sits in VIP at urgent priority with a "VIP customer" line. Restore the threshold afterwards.

**7.6 Delivery failure.** Shopify's admin has no button for carrier events, so use the Admin API. Fulfill the paid order from its page with **Fulfill items**, then run the three commands below with your store domain and app credentials. The first fetches a token, the second lists recent orders with their fulfillment IDs, the third records a failed delivery.

```bash
STORE=acme-main.myshopify.com
TOKEN=$(curl -s -X POST "https://$STORE/admin/oauth/access_token" \
  -d grant_type=client_credentials -d client_id=<client id> -d client_secret=<client secret> \
  | node -pe 'JSON.parse(require("fs").readFileSync(0)).access_token')

curl -s "https://$STORE/admin/api/2025-07/graphql.json" \
  -H "X-Shopify-Access-Token: $TOKEN" -H "Content-Type: application/json" \
  -d '{"query":"{ orders(first: 5, reverse: true) { nodes { name fulfillments { id } } } }"}'

curl -s "https://$STORE/admin/api/2025-07/graphql.json" \
  -H "X-Shopify-Access-Token: $TOKEN" -H "Content-Type: application/json" \
  -d '{"query":"mutation { fulfillmentEventCreate(fulfillmentEvent: { fulfillmentId: \"gid://shopify/Fulfillment/<id>\", status: FAILURE, message: \"Address not found\" }) { fulfillmentEvent { id } userErrors { message } } }"}'
```

The log shows `"rule":"delivery-issue"` and the ticket lands in the store's shipping team with the carrier message in the body.

**7.7 Fraud review** rarely triggers on a development store because the risk assessment seldom returns HIGH. The unit tests cover that rule.

## 8. Troubleshooting

- **Nothing arrives.** No requests in the ngrok inspector means Shopify is not sending: rerun `register:webhooks` and check that `PUBLIC_URL` matches the running tunnel. Requests with a non-200 response mean the service rejected them; read the log line.
- **`register:webhooks` works but the dev server fails with `app_not_installed` or `invalid signature`.** The server was started before you changed `.env` and still holds the old values. Node reads `--env-file` once at start and the watcher does not track `.env`. Restart `npm run dev`.
- **The boot log shows a URL, account, or app prefix that does not match `.env`.** The shell you start from has those variables exported, and `--env-file` never overrides existing environment variables. The usual source is a shell auto-loader such as the oh-my-zsh `dotenv` plugin or direnv, which exported an earlier version of `.env` when you entered the directory. Leave and re-enter the directory so it reloads, run `unset PUBLIC_URL TEXT_ACCOUNT_ID TEXT_PAT SHOPIFY_ACME_CLIENT_ID SHOPIFY_ACME_CLIENT_SECRET`, or open a new terminal, and start again.
- **401 `unknown store`.** The `shopDomain` in `stores.json` does not match the `X-Shopify-Shop-Domain` header.
- **401 `invalid signature`.** The client secret in `.env` is not the one Shopify signs with. Either it belongs to another app, or the app has two active client secrets and `.env` holds the secondary one. The token exchange accepts both secrets, so `register:webhooks` still works. Keep a single secret in the Dev Dashboard, or copy the primary one.
- **400 `payload did not match the expected shape`.** The response lists the rejected fields. Compare with the payload in the inspector.
- **502.** The Admin API lookup or the ticket creation failed; the line above has the response body. A 401 from Shopify points at the token exchange or scopes. A 4xx from Ticketing usually means a team, tag, or field changed after boot, so restart the service. Shopify redelivers after a 502, so a fixed service usually receives the same event again without a new order.
- **Empty customer fields in the ticket.** Protected customer data access, or the Name and Email fields within it, was not granted.
- **Duplicate ticket after a restart.** Deduplication is in memory. A redelivery after a restart creates a second ticket. Expected for the demo, and called out in the README's production section.
