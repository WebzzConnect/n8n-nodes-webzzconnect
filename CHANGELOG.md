# Changelog

## 0.6.0

- **Labels on contacts.** New Contact > **Add Labels** and **Remove Labels**. The contact keeps its other labels. Needs the contacts view and edit permissions.
- **More label operations on conversations.** New Conversation > **Remove Labels** and **Set Labels** (replaces all labels). Set Labels refuses an empty list unless **Clear All Labels** is on, so an empty expression never clears a conversation's labels by mistake. Removing a label the record doesn't have is ignored.
- **Label picker.** Label fields list the account's labels. An expression can still give a list or comma-separated text. Labels are sent in lowercase. This comes with node version 1.1: workflows made before 0.6.0 stay on version 1 and keep their comma-separated Labels text field.
- **Deal notes.** New Deal > **Add Note**, **Get Notes**, **Update Note** and **Delete Note**. Notes also show on the contact's notes. Only the connection or person that wrote a note, or an administrator, can change or delete it. A note written through an API key belongs to that key. Notes are limited to 10,000 characters.
- **Deal product lines.** New Deal > **Add Product**, **Get Products**, **Update Product** and **Delete Product**. Pick a product from the catalog, or add a custom line with a name and unit price. Once a deal has product lines, its value is the sum of its lines, and the Value field in Deal Create and Update is ignored (its description now says so).
- Deleting deals is intentionally not offered.

## 0.5.1

- **New address.** WebzzConnect moved to `https://app.webzz.io`. The nodes, both credentials (including the OAuth authorization and token URLs) and the docs links (`https://api-docs.webzz.io`) use it. Credentials created before 0.5.1 keep working: the old address still answers.
- **Clearer errors.** When WebzzConnect refuses a call with a code, the node shows its message as `[status] message (code)`, in the account's language, instead of a generic "not allowed": the plan doesn't include an area (`feature_disabled`), a plan limit was reached (`[402] limit_exceeded`, e.g. the webhooks limit when a trigger is activated), pipeline access (`pipeline_required`, `owner_not_pipeline_member`, `owner_not_assignable`) and `[409] active_conversation_not_visible`. The generic 403 explanation stays for permission and scope refusals.
- **A message blocked at send time fails the step.** Send Message, Conversation Create (with a message) and WhatsApp Template Send now fail with `monthly_active_contacts_limit_reached` when the account reached its monthly active contacts limit, instead of returning the failed message as a success.
- **Paused virtual agents.** WebzzConnect no longer refuses a paused agent's connection with `agent_paused`: the calls succeed but reach only the agent's test chat. The `agent_paused` message was removed and the descriptions updated.
- **Deals.** WebzzConnect no longer sends a deal's `source`; deal outputs and deal trigger events carry `original_source` and `created` instead. Pipeline lists and deals follow pipeline membership for person and virtual agent connections (documented under Pipelines and access). The Pipeline and Owner ID descriptions say so.
- The node's documentation links point to the right GitHub repository. The support address is support@webzz.io.

## 0.5.0

- **Virtual agents.** Credentials can act as a virtual agent (API key that acts as the agent, or OAuth with Connect as → A virtual agent). New **Connection → Get Info** shows who a credential acts as and works while the agent is paused.
- Conversation > **Assign** / **Unassign**: the Agent picker lists people and virtual agents; new **Hand-Off Note**; a team plus an agent on a virtual agent connection is refused before any write. An unknown or unavailable assignee is refused by the server instead of unassigning. A zero or malformed agent is refused with no request. After a write the node no longer fails when the connection can no longer see the conversation (a virtual agent that let go): it returns what the write answered.
- Conversation > **Update Status**: new **Waiting on Customer**. **Get Many**: new statuses **With a Virtual Agent**, **Waiting on Customer** and **Pending (Both)**, and a **Virtual Agent ID** filter. Defaults are unchanged.
- Conversation > **Create** and WhatsApp Template > **Send**: optional **Status** (Open or Resolved).
- Clear error messages with the HTTP status and the server code for `not_handling`, `agent_paused`, `assignee_not_available`, `conversation_resolved` and the hand-off note refusals.
- Trigger: new event **Conversation Handed Off**. **Message Direction** now applies to new and updated messages. **Trigger version 1.1** defaults Direction to Incoming so a reply bot doesn't answer its own messages; existing workflows keep Any.
- Trigger: activating with an address that is already registered rotates the secret instead of deleting and recreating the registration. Deactivating with a revoked credential completes and logs a warning.
- The WhatsApp sales example now uses a virtual agent and a hand-off with a note instead of the `human` label.

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
