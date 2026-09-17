# Shopify → Text Ticketing

Routes Shopify order, refund, and fulfillment events from multiple stores into Text tickets, each assigned to the correct team, priority, and tags.

Full setup guide: https://www.text.com/docs/guides/shopify-orders-to-tickets

## Quickstart

Requires a Text personal access token with the `accounts--my:ro` scope, and a Shopify Dev Dashboard app with the `read_orders`, `read_customers`, and `read_fulfillments` Admin API access scopes (add `write_fulfillments` to simulate a failed delivery).

Follow the setup guide above to create the Shopify stores and app, request protected customer data access, and expose the service to Shopify with a tunnel.

```shell
git clone https://github.com/livechat/shopify-text-ticketing.git
cd shopify-text-ticketing
npm install
cp config/stores.example.json config/stores.json   # one entry per Shopify store
cp .env.example .env                               # set TEXT_ACCOUNT_ID, TEXT_PAT, SHOPIFY_<KEY>_CLIENT_ID/SECRET

npm run setup:ticketing      # creates the teams, tags, and custom fields the rules refer to
npm run dev                  # starts the service on PORT (default 3000)
npm run register:webhooks    # subscribes every store to the three topics at PUBLIC_URL
```

A healthy service prints `Listening on http://localhost:<port> for <n> store(s)`.

## Configuration

| Variable                                              | Used by                          | Description                                                                                                     |
| ----------------------------------------------------- | -------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `TEXT_ACCOUNT_ID`                                     | Service and setup script         | Text account ID, sent as the Basic auth username.                                                               |
| `TEXT_PAT`                                            | Service and setup script         | Text personal access token, sent as the Basic auth password.                                                    |
| `PUBLIC_URL`                                          | Webhook registration             | Public HTTPS address for the service, without a trailing slash.                                                 |
| `PORT`                                                | Service                          | Local port the service listens on. Defaults to `3000`.                                                          |
| `SHOPIFY_<credentialsKey>_CLIENT_ID`/`_CLIENT_SECRET` | Service and webhook registration | Credentials of the Shopify app serving every store whose `config/stores.json` entry uses that `credentialsKey`. |

`config/stores.json` lists the Shopify stores this service routes for — see `config/stores.example.json` and the setup guide for its fields.

## Checks

```shell
npm test
npm run typecheck
npm run lint
```

---

See the full [Text documentation reference](https://www.text.com/docs).
