# Hibira

[Hibira](https://hibira.io/?utm_source=make&utm_medium=app&utm_campaign=plugins) is a hosted realtime service that speaks the Pusher Channels protocol. Use this app to push live updates from your scenarios to websites and apps, and to start scenarios from channel and presence events.

## Connect

1. Create a free app at [hibira.io](https://hibira.io/portal) (no card needed).
2. Copy the secret as soon as the app is created: it is shown only once (you can rotate it later). The app ID and key are under your app > **Overview** > **Credentials**.
3. In the app's **Settings**, add the sites that will receive events to **Allowed origins** (one per line, such as https://example.com).

The secret only signs requests in Make; it is never sent.

**Send a push notification** uses a second connection, **Hibira Push**: turn on Push on your app's **Push** tab and copy the instance ID and secret key from there.

## Modules

- **Watch webhook events**: starts when a channel is occupied or vacated, a member joins or leaves a presence channel, or a client event is sent. Add the webhook's address to your app's webhooks in the Hibira portal and pick the events to send. Every event is one scenario run.
- **Trigger an event**: sends an event to up to 100 channels. Browsers and apps that subscribe with pusher-js, Laravel Echo or any Pusher client get it at once.
- **Request an approval**: asks a person to approve or choose (2 to 4 choices; the first approves) and returns an answer link anyone can use once. Send the link by email or chat, or let Hibira push it to interests or user IDs, or announce it on a channel for the @hibira-io/approvals inbox. Needs an app in a Hibira account.
- **Get an approval**: the request's status (pending, approved, rejected or expired), choice and comment. It waits up to 25 seconds for an answer; to wait longer, run it after a **Repeater** and stop once Status is not pending, or check later in another scenario.
- **Send a push notification**: title, body and web link to iOS, Android and web devices subscribed to interests, or to user IDs.
- **Get a channel**: whether a channel is occupied, its subscriptions, and its members for presence channels.
- **List occupied channels**: channels with at least one subscriber, optionally by name prefix.
- **List members of a presence channel**: the user IDs in a presence channel.
- **Make an API call**: a signed request to any other endpoint of the HTTP API, such as `/batch_events` or `/users/{id}/terminate_connections`. Enter the path after `/apps/{app ID}`.
