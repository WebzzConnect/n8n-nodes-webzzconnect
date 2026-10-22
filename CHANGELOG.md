# Changelog

## 0.4.0

- Conversation > Send Message: new **Message Type**: Text, **Reply Buttons** (up to 3), **List** (up to 10 rows, optional menu label, descriptions and sections) and **Link Button** (one URL button). **Interactive Options** add a text, image, video or document header and a footer. A list only takes a text header. WhatsApp's limits are checked by WebzzConnect, which answers with a clear message.
- Conversation: new **Set Custom Attributes** (merged into the existing attributes; needs conversations view + resolve) and **Add Labels** (lowercased, added to the existing labels; needs conversations view + reply) operations.
- For a chatbot flow, use an API key: its messages arrive with `sender` null, so they never match the human-reply rule documented in the trigger's New Message description and the README. Messages sent through OAuth show the connected user as sender.
- Send Message: if the WhatsApp 24-hour window is closed, the node succeeds (the message is queued) and the message then fails in WebzzConnect with the window reason.
- Send Message: a Header Media URL with Header Type None or Text is refused.
- Trigger: New Message events get a top-level `button_payload`: the ID of the tapped reply button or list row, the text (or payload) of a template quick reply, or `null` for typed text. Branch on `{{$json.button_payload}}` in a Switch node.

## 0.3.0

- Conversation: new **Assign** operation (agent and/or team). The team is assigned first, then the agent; the node fails if the agent or team was not applied (for example an agent who is not a member of the inbox).
- Conversation: new **Unassign** operation (agent, team, or both).
- Conversation: new **Update Status** operation (Open, Resolved, Snoozed with an optional **Snooze Until**). Resolved sends the CSAT survey when the inbox has CSAT on. Open through an agent's OAuth connection assigns the conversation to that agent.
- Conversation: **Send Message** can attach a file by **File URL** (the text becomes optional when a file is given).
- WhatsApp Template: **Template Fields** mapper. Choosing a template shows one field per variable (header text or media URL, numbered or named body variables, URL button variables, copy-code coupon), the same as the Make app. **Body Variables** remains for templates set by an expression.
- New **Agent** (per inbox) and **Team** pickers.
- These operations need the `conversations:assign` and `conversations:resolve` permissions.

## 0.2.0

- **Breaking:** credentials changed. Existing 0.1.x credentials stop working; create a new one and re-select it in your nodes.
- New **WebzzConnect API** credential (API key, sent as a Bearer token) for self-hosted n8n. Create the key in WebzzConnect > Settings > API keys (admins).
- **WebzzConnect OAuth2 API** is now a public PKCE client with the client id built in (for n8n Cloud). The URL, client id and client secret fields are gone.
- Both nodes have an **Authentication** selector (API Key or OAuth2). The WebzzConnect address is fixed to `https://connect.webzz.cloud`, so there is no URL field.
- CRM requests (deals, pipelines, stages, lost reasons) use the `/crm/` API paths; the old `/wz_crm/` paths no longer exist.
- OAuth now also requests `conversations:assign` and `conversations:resolve`.

## 0.1.1

- Trigger: optional **Inboxes** filter for conversation and message events, and an optional **Pipelines** filter for deal events.
- Trigger: if the n8n webhook address changes, the next activation replaces the old registration.
- Deal search: the stage list now follows the pipeline chosen in the filters.
- Errors from a failed item now point at that item.
- README: Custom API Call (HTTP Request node with the WebzzConnect credential) documented.

## 0.1.0

- First release: contact, deal, conversation and WhatsApp template actions, and an instant trigger.
