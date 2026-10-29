# Hibira

[Hibira](https://hibira.io/?utm_source=make&utm_medium=app&utm_campaign=plugins) is a hosted realtime service that speaks the Pusher Channels protocol. Use this app to push live updates from your scenarios to websites and apps, and to start scenarios from channel and presence events.

## Connect

1. Create a free app at [hibira.io](https://hibira.io/portal) (no card needed).
2. In the portal, open your app > **App keys** and copy the app ID, key and secret into the connection.

The secret only signs requests in Make; it is never sent.

## Modules

- **Watch webhook events**: starts when a channel is occupied or vacated, a member joins or leaves a presence channel, or a client event is sent. Copy the webhook's address into your app's **Webhooks** settings in the Hibira portal.
- **Trigger an event**: sends an event to up to 100 channels. Browsers and apps that subscribe with pusher-js, Laravel Echo or any Pusher client get it at once.
- **Get a channel**: whether a channel is occupied, its subscriptions, and its members for presence channels.
- **List occupied channels**: channels with at least one subscriber, optionally by name prefix.
- **List members of a presence channel**: the user IDs in a presence channel.
