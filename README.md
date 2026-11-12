# Hibira for Make

![Hibira for Make](.github/cover.jpg)

[![ci](https://github.com/hibira-io/make/actions/workflows/ci.yml/badge.svg)](https://github.com/hibira-io/make/actions/workflows/ci.yml)

A [Make](https://www.make.com) custom app for
[Hibira](https://hibira.io/?utm_source=github&utm_medium=readme&utm_campaign=plugins),
a hosted realtime service that speaks the Pusher Channels protocol. Push live
updates from a scenario to websites and apps, and start scenarios from
channel and presence events.

| Module | Type | |
|---|---|---|
| Watch webhook events | Instant trigger | channel occupied or vacated, member added or removed, client events |
| Trigger an event | Action | sends an event to up to 100 channels |
| Update a live chart | Action | updates a live chart or poll opened through the Hibira MCP server: set or add to a number, add to or set bars, or reset, with an optional goal, title, subtitle and status |
| Request an approval | Action | asks a person to approve or choose through a hosted answer link, optionally sent by push |
| Get an approval | Action | status and answer of a request, waiting up to 25 s |
| Send a push notification | Action | iOS, Android and web, by interest or user ID (Hibira Push connection) |
| Get a waiting room | Action | settings and how many visitors are waiting and admitted |
| Create or update a waiting room | Action | open, pause or close a room, set its rate, start time, title and return URLs |
| Admit visitors from a waiting room | Action | lets the next N visitors through now |
| Verify a waiting room pass | Action | checks a visitor's pass; returns its queue number and ticket ID |
| Get a channel | Action | occupied, subscriptions, members (presence) |
| List occupied channels | Search | by name prefix, with member counts for presence- prefixes |
| List members of a presence channel | Search | user IDs |
| Make an API call | Universal | a signed request to any other HTTP API endpoint |

For example: a new row in a Google Sheet or a paid Stripe invoice triggers
`order-updated` on `orders`, and every open dashboard updates at once; a
member joining `presence-support` posts to Slack.

### Recipe: supervisor approval for database changes

Reads run by themselves; a change waits for a supervisor who sees the exact
statement and its plan. Make keeps the database connection, so Hibira only
carries the question and the answer.

1. A trigger brings the statement, such as a webhook from your app with
   `sql`.
2. A **Router** with two routes. Route *read* has a filter: `sql` *Matches
   pattern (case insensitive)* `^\s*(select|with|explain|show)\b` **and**
   *Does not match pattern (case insensitive)*
   `\b(insert|update|delete|merge|create|alter|drop|truncate|grant|revoke|copy|call|into|analyze|set|nextval|setval)\b|\bfor\s+(update|share)\b|;\s*\S`.
   It runs the statement with your database app's query module, on a user
   that can only read. The other route is the fallback, so anything unsure
   is a change.
3. On the change route: run `EXPLAIN {{sql}}` (it does not run the
   statement) → **Request an approval** with Question `Run this change on
   the shop database?` and Details holding the statement, the plan and
   `SHA-256: {{sha256(sql)}}`. Add push user IDs to reach the supervisor's
   phone, or a channel to show it live in your own app.
4. **Repeater** + **Get an approval** until Status is not `pending`, then a
   filter on Status `approved` **and** `sha256(sql)` equal to the
   fingerprint you sent → run `sql` with the query module. On `rejected`,
   send `comment` back to the requester.

The same pattern with a web console and a phone approval page is the
[database changes guide](https://hibira.io/use-cases/database-write-approvals).

## Install in your Make account

1. In Make, create an API token (Profile > API access) with the scopes
   `sdk-apps:read` and `sdk-apps:write`.
2. Upload the app:

   ```sh
   git clone https://github.com/hibira-io/make && cd make
   MAKE_API_TOKEN=... MAKE_ZONE=eu1.make.com node tools/deploy.mjs --create
   ```

   `MAKE_ZONE` is the host of your Make URL (eu1, eu2, us1 or us2.make.com).
   Make app names are unique: if `hibira` is taken, pick another one, such
   as `MAKE_APP_NAME=hibira-yourteam`, on this and every later run. Run it
   again without `--create` to upload changes. It needs git and Node.js 18
   or later. Later runs reuse the connections and webhooks the app already
   has, matched by label, so they also work from CI or a fresh clone.
3. In a scenario, add a Hibira module and create a connection with your
   app ID and key from the [Hibira portal](https://hibira.io/portal)
   (your app > Overview > Credentials) and the secret, which is shown once
   when you create the app.

For **Watch webhook events**, copy the webhook address Make shows into your
app's Webhooks settings in the Hibira portal and pick the events to send.

## How it works

The Pusher HTTP API signs each request with HMAC-SHA256 of the method, path
and sorted query, and adds the MD5 of the body. Each module builds the body
once with `createJSON`, then signs it with Make's built-in `md5` and
`sha256(text, 'hex', secret)`, so the app needs no custom IML functions.

## Layout

```
app/
  app.json, base.iml.json, groups.json, readme.md, icon.png
  connections/hibira/   connection.json, api.iml.json (connection test), parameters.iml.json
  webhooks/events/      webhook.json, api.iml.json (one bundle per event)
  modules/<name>/       module.json, api, parameters, expect, interface, samples (.iml.json)
tools/deploy.mjs        uploads app/ with the Make API
test/iml.mjs            runs the app's IML in Node for the tests
```

## Develop

```sh
npm install
npm test
HIBIRA_E2E_APP_ID=... HIBIRA_E2E_KEY=... HIBIRA_E2E_SECRET=... HIBIRA_E2E_HOST=ws.hibira.io npm run test:e2e
```

The tests run the modules' IML with a small stand-in for Make's evaluator
(`test/iml.mjs`) against a real server and a pusher-js client. It covers the
parts of IML this app uses; after changing a module, also run it once in a
Make scenario.

## License

MIT
