# Hibira for Make

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
| Get a channel | Action | occupied, subscriptions, members (presence) |
| List occupied channels | Search | by name prefix, with member counts for presence- prefixes |
| List members of a presence channel | Search | user IDs |

For example: a new row in a Google Sheet or a paid Stripe invoice triggers
`order-updated` on `orders`, and every open dashboard updates at once; a
member joining `presence-support` posts to Slack.

## Install in your Make account

1. In Make, create an API token (Profile > API access) with the scopes
   `sdk-apps:read` and `sdk-apps:write`.
2. Upload the app:

   ```sh
   git clone https://github.com/hibira-io/make && cd make
   MAKE_API_TOKEN=... MAKE_ZONE=eu1.make.com node tools/deploy.mjs --create
   ```

   `MAKE_ZONE` is the host of your Make URL (eu1, eu2, us1 or us2.make.com).
   Make app names are unique: if `hibira` is taken, create the app in Make
   (Custom apps > Create a new app) and pass its name as `MAKE_APP_NAME`.
   Run it again without `--create` to upload changes.
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
