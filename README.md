# @webzzconnect/n8n-nodes-webzzconnect

This is an n8n community node package for [WebzzConnect](https://connect.webzz.cloud), the omnichannel inbox, CRM and chatbot platform for small businesses. It lets you manage contacts, deals, conversations and WhatsApp templates from your n8n workflows, and start workflows instantly when something happens in WebzzConnect.

[n8n](https://n8n.io/) is a [fair-code licensed](https://docs.n8n.io/sustainable-use-license/) workflow automation platform.

[Installation](#installation) · [Credentials](#credentials) · [Operations](#operations) · [Trigger](#trigger) · [Rate limits](#rate-limits) · [Compatibility](#compatibility)

## Installation

Follow the [community nodes installation guide](https://docs.n8n.io/integrations/community-nodes/installation/) and install `@webzzconnect/n8n-nodes-webzzconnect`.

## Credentials

The package ships two credentials. Both nodes have an **Authentication** selector to pick one. The WebzzConnect address is fixed (`https://connect.webzz.cloud`), so there is no URL field.

**WebzzConnect API (self-hosted n8n)**

1. In WebzzConnect, open **Settings > API keys** (administrators) and create a key. Tick `contacts:edit`, `deals:edit`, `conversations:reply`, `conversations:assign` and `conversations:resolve`, and optionally limit it to specific inboxes. The key is shown once.
2. In n8n, create a **WebzzConnect API** credential and paste the key. The credential test calls `token_info`; the account is taken from the key.

**WebzzConnect OAuth2 API (n8n Cloud)**

Create a **WebzzConnect OAuth2 API** credential and click **Connect my account**. It is a public PKCE (S256) client with the client id built in, so there is nothing to paste. Sign in to WebzzConnect if asked and approve the permissions: `contacts:edit`, `deals:edit`, `conversations:reply`, `conversations:assign` and `conversations:resolve` (each edit scope includes the matching read access). The account is taken from the token. If you untick a permission, the matching actions fail with a clear "insufficient scope" message.

**Connect as a virtual agent**

Create the key in WebzzConnect → Settings → API keys. To answer customers as a bot, make the key act as a virtual agent (admins only): its role then decides what it can do, and this connection sees only the conversations that agent handles. For reminders, CRM sync and other account-wide flows, use a key that doesn't act as a virtual agent and tick the scopes it needs.

To answer customers as a bot, choose Connect as → A virtual agent on the consent screen (admins only, one account). Choose Me to act as yourself.

Add a trigger on the same connection: it keeps the agent listening. With a virtual agent connection, keep this workflow active: it is what keeps the agent listening. While it is off, new conversations go to your team, and each conversation the agent holds goes to your team when the customer writes next. To stop the bot, pause the virtual agent in WebzzConnect. Deactivate the workflow before you switch its credential. If a credential was revoked while the workflow was active, deactivation still completes and writes "Couldn't remove WebzzConnect webhook subscription {id}: the credential is no longer valid. It may keep sending events to this URL until it's removed in WebzzConnect → Settings → App webhooks." to the n8n log; delete the leftover in WebzzConnect → Settings → App webhooks.

Replacing a connection: switching a trigger's credential, even to another credential of the same account, leaves the old subscription delivering to the old address until it is deleted. A leftover row of a virtual agent keeps that agent listening. Replacing an all-inboxes key with a one-inbox key makes activation fail with a 422 until the old row is gone. The remedy is the same: an administrator deletes the subscription in WebzzConnect → Settings → App webhooks.

Two agents' flows can hand a conversation back and forth (A hands to B, B hands back to A). Nothing stops that for you: your flow logic must prevent it, for example by recording a hand-off in a custom attribute and not handing the same conversation back.

A conversation the bot holds and the customer leaves quiet gets a nudge after 5 minutes and closes 10 minutes later (auto-closed).

Use **Connection → Get Info** to see who a credential acts as (`kind`, account, virtual agent, person). It works while the agent is paused.

**Hand off to a person or another agent**

Use Assign (a person or a virtual agent) or Unassign (your team), with a hand-off note. The person is notified and reads the note in the conversation; the customer sees nothing. Labels don't move a conversation: keep them for tagging. A virtual agent hands off to one target: pick a team or an agent, not both.

**Flows on an account key**

A person replied when `message_type` is outgoing, `private` is false, `content_attributes.automation_rule_id` is empty, and `sender.type` is "user" or `content_attributes.external_echo` is true (a reply from the WhatsApp Business app). WhatsApp campaign and scheduled template sends arrive with `message_type` "template", so they never match. An account key's messages arrive with `sender` null.

`button_payload` is customer input: compare it with Equals in a Switch node and keep a fallback; never use it in a Code node, a URL or an ID field.

Both credentials also work with n8n's HTTP Request node (**Predefined Credential Type**) for any WebzzConnect API call this node does not cover. Requests go to `https://connect.webzz.cloud/api/v1/accounts/<account id>/...`.

## Operations

**Contact**
- Create
- Update
- Get
- Search (by name, email or phone)
- Create or Update: finds an existing contact by exact email or by phone number (national formats such as `050-1234567` match the stored international number), updates it, or creates a new one. Running it twice with the same data never creates a duplicate.

**Deal**
- Create (pick the pipeline and stage from your own lists)
- Update
- Move Stage (including won and lost, with an optional lost reason and note)
- Get
- Search (query, contact, pipeline, stage, owner, status)

**Conversation**
- Create (with an optional first message and an optional Status). With a virtual agent connection, a new conversation is handled by that agent, so the customer's reply comes to your flow. A virtual agent can send only into conversations it handles: for reminders and broadcasts, use an account key or an "as me" connection.
- Send Message (reply, or add a private note; optionally attach a file by public URL, with the text as a caption). **Message Type** also offers WhatsApp interactive messages: **Reply Buttons** (up to 3), **List** (up to 10 rows with optional descriptions and sections, and a menu label) and **Link Button** (one button that opens a URL), each with an optional header (text, or image / video / document by URL; a list only takes text) and footer. The message text is the body and is required. Each button or row has an ID (the title if left empty) that comes back as `button_payload` when the contact taps it. Interactive messages need a WhatsApp Cloud inbox and the 24-hour window; WebzzConnect checks WhatsApp's limits and answers with a clear message.
- Set Custom Attributes (key / value pairs, merged into the conversation's existing attributes; needs the conversations view and resolve permissions)
- Add Labels (comma-separated, sent in lowercase, added to the conversation's existing labels; needs the conversations view and reply permissions)
- Get
- Get Many (by status, inbox and virtual agent; statuses include With a Virtual Agent, Waiting on Customer and Pending (Both). With a virtual agent connection, Open finds none)
- Assign (a person or a virtual agent in the conversation's inbox, and/or a team, with an optional hand-off note; an unknown or unavailable one is refused and nothing changes)
- Unassign (agent, team, or both, with an optional hand-off note)
- Update Status (Open, Resolved, Snoozed with an optional Snooze Until, or Waiting on Customer). Resolved sends the CSAT survey when the inbox has CSAT on. Open through an "as me" connection of an agent-role user also assigns the conversation to that user.

**Connection**
- Get Info (who this credential acts as)

**WhatsApp Template**
- Send: choose a WhatsApp inbox, a contact and an approved template, then fill the fields that appear for the template: header text or media URL, body variables (numbered or named), URL button variables and the copy-code coupon. If the template is set by an expression, fill **Body Variables** in order instead. The message is created in the contact's open conversation, or in a new one.

**Custom API Call**
- For an endpoint the node doesn't cover, pick **Custom API Call** in the node's actions. It opens an HTTP Request node. Set **Authentication** to *Predefined Credential Type*, choose **WebzzConnect API** (or **WebzzConnect OAuth2 API**), and call `https://connect.webzz.cloud/api/v1/accounts/<account id>/...`.

List-style operations have **Return All** and **Limit**. Fields that WebzzConnect uses internally (names starting with `wz_`) are removed from the output. Errors show the message from WebzzConnect; a rate-limit error tells you how long to wait.

## Trigger

**WebzzConnect Trigger** starts a workflow instantly (no polling). Choose one or more events:

- New Conversation, Conversation Status Changed, Conversation Updated
- Conversation Handed Off: a virtual agent handed a conversation to a person, another virtual agent or the team. The output has `handoff.from`, `handoff.to` (type agent, person or team; no ID or name for the team), `handoff.note` and `handoff.waiting_message`, each possibly null. It is sent at least once: skip a repeat with the same waiting message ID, when there is one.
- New Message (filter by direction; new triggers default to Incoming, which keeps a reply bot from answering its own messages and their status updates). The output has a top-level `button_payload`: the ID of the tapped reply button or list row, the text (or payload) of a template quick reply, or `null` for typed text, so a Switch node can branch on `{{$json.button_payload}}`.
- Contact Created, Contact Updated
- Deal Created, Deal Updated, Deal Stage Changed, Deal Won, Deal Lost, Deal Deleted

Optionally narrow conversation and message events to some inboxes, and deal events to some pipelines. Leave a picker empty to receive events from all of them. To change the events or the pickers, deactivate and activate the workflow again.

Activating the workflow registers the n8n webhook address in WebzzConnect; deactivating removes it. If the same address is already registered, its secret is rotated (the registration stays). If the n8n webhook address changes (for example a new host), the next activation replaces the old registration. Every delivery is checked against its HMAC-SHA256 signature (`X-WebzzConnect-Signature`) and rejected if it is older than five minutes. Your n8n webhook address must be reachable from the internet (set `WEBHOOK_URL` for self-hosted n8n).

The connected person or virtual agent needs access to the data behind each event, otherwise activation fails with a message naming the missing permission.

## Errors you may see

| Code | What it means | What to do |
|---|---|---|
| `[409] not_handling` | This virtual agent isn't handling this conversation any more: a person took it, it was handed off, or it's resolved. | Stop the flow for this conversation. |
| `[403] agent_paused` | The virtual agent is paused, so this connection can't act. | Set the agent live in WebzzConnect, then run again. |
| `[403]` other | This connection isn't allowed to do this. For a virtual agent its role decides; for an API key, its scopes and inboxes; for OAuth, what was approved at consent. | Check the server message in brackets. |
| `[422] assignee_not_available` | That person or virtual agent is unknown, removed, or not in the conversation's inbox. | Nothing was changed; pick another. |
| `[422] conversation_resolved` | A virtual agent can't be assigned to a resolved conversation. | Reopen it first, or assign a person. |
| `[422] handoff_note_not_allowed` | Only the virtual agent handling the conversation can add a hand-off note, and only when it hands the conversation to someone. | Remove the note, or use a virtual agent connection. |
| `[422] handoff_note_invalid` | The hand-off note must be 1 to 500 characters. | Shorten it. |
| `handoff_one_target` | A virtual agent hands off to one target. | Choose an agent or a team, not both. |
| `assign_no_target` | No person or virtual agent was chosen (or the ID was 0). | Pick one, or use Unassign. |
| `[422]` on a contact | The contact may exist but this virtual agent sees only the contacts of conversations it handles. | Use an account key or an "as me" connection. |

## Rate limits

WebzzConnect allows 600 requests per minute per connection, and contact search is limited to 100 requests per minute per account. When a limit is hit the node fails with a rate-limit error that includes the `Retry-After` wait. Use **Retry On Fail** on the node, or a Wait node, in high-volume workflows.

## Example workflows

- [WhatsApp sales chatbot with hand-off](examples/whatsapp-sales-flow.json): a menu of reply buttons, a pricing link button, a demo-slot list, and a hand-off to your team with a note. It answers only conversations its virtual agent holds (it checks Connection → Get Info), and a button tapped at the wrong step does nothing. To use it, copy the file's contents and paste them into the n8n editor, or use **Import from URL** with the file's raw GitHub link. Setup steps are in the sticky note inside the workflow.

## Compatibility

Tested with n8n 1.x and 2.x (Node.js 22). Requires a WebzzConnect account.

## Resources

- [n8n community nodes documentation](https://docs.n8n.io/integrations/#community-nodes)
- [WebzzConnect](https://connect.webzz.cloud)

## Version history

See [CHANGELOG.md](CHANGELOG.md).
