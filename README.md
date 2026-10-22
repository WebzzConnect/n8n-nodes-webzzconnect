# n8n-nodes-webzzconnect

This is an n8n community node package for [WebzzConnect](https://connect.webzz.cloud), the omnichannel inbox, CRM and chatbot platform for small businesses. It lets you manage contacts, deals, conversations and WhatsApp templates from your n8n workflows, and start workflows instantly when something happens in WebzzConnect.

[n8n](https://n8n.io/) is a [fair-code licensed](https://docs.n8n.io/sustainable-use-license/) workflow automation platform.

[Installation](#installation) · [Credentials](#credentials) · [Operations](#operations) · [Trigger](#trigger) · [Rate limits](#rate-limits) · [Compatibility](#compatibility)

## Installation

Follow the [community nodes installation guide](https://docs.n8n.io/integrations/community-nodes/installation/) and install `n8n-nodes-webzzconnect`.

## Credentials

The package ships two credentials. Both nodes have an **Authentication** selector to pick one. The WebzzConnect address is fixed (`https://connect.webzz.cloud`), so there is no URL field.

**WebzzConnect API (self-hosted n8n)**

1. In WebzzConnect, open **Settings > API keys** (administrators) and create a key. Tick `contacts:edit`, `deals:edit`, `conversations:reply`, `conversations:assign` and `conversations:resolve`, and optionally limit it to specific inboxes. The key is shown once.
2. In n8n, create a **WebzzConnect API** credential and paste the key. The credential test calls `token_info`; the account is taken from the key.

**WebzzConnect OAuth2 API (n8n Cloud)**

Create a **WebzzConnect OAuth2 API** credential and click **Connect my account**. It is a public PKCE (S256) client with the client id built in, so there is nothing to paste. Sign in to WebzzConnect if asked and approve the permissions: `contacts:edit`, `deals:edit`, `conversations:reply`, `conversations:assign` and `conversations:resolve` (each edit scope includes the matching read access). The account is taken from the token. If you untick a permission, the matching actions fail with a clear "insufficient scope" message.

**Chatbot flows**

Use an API key: messages sent with it arrive with `sender` null and `additional_attributes.sender_name` = the key's name ("Sent by <key name>"), so they never match the human-reply rule. Messages sent through OAuth show the connected user as sender.

A human replied when `message_type` is outgoing, `private` is false, `content_attributes.automation_rule_id` is empty, and `sender.type` is "user" or `content_attributes.external_echo` is true (a reply from the WhatsApp Business app). WhatsApp campaign and scheduled template sends arrive with `message_type` "template", so they never match.

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
- Create (with an optional first message)
- Send Message (reply, or add a private note; optionally attach a file by public URL, with the text as a caption). **Message Type** also offers WhatsApp interactive messages: **Reply Buttons** (up to 3), **List** (up to 10 rows with optional descriptions and sections, and a menu label) and **Link Button** (one button that opens a URL), each with an optional header (text, or image / video / document by URL; a list only takes text) and footer. The message text is the body and is required. Each button or row has an ID (the title if left empty) that comes back as `button_payload` when the contact taps it. Interactive messages need a WhatsApp Cloud inbox and the 24-hour window; WebzzConnect checks WhatsApp's limits and answers with a clear message.
- Set Custom Attributes (key / value pairs, merged into the conversation's existing attributes; needs the conversations view and resolve permissions)
- Add Labels (comma-separated, sent in lowercase, added to the conversation's existing labels; needs the conversations view and reply permissions)
- Get
- Get Many (by status and inbox)
- Assign (an agent and/or a team; the agent must be a member of the conversation's inbox, and the node fails if the assignment was not applied)
- Unassign (agent, team, or both)
- Update Status (Open, Resolved or Snoozed with an optional Snooze Until). Resolved sends the CSAT survey when the inbox has CSAT on. Open through an agent's OAuth connection assigns the conversation to that agent; API keys do not.

**WhatsApp Template**
- Send: choose a WhatsApp inbox, a contact and an approved template, then fill the fields that appear for the template: header text or media URL, body variables (numbered or named), URL button variables and the copy-code coupon. If the template is set by an expression, fill **Body Variables** in order instead. The message is created in the contact's open conversation, or in a new one.

**Custom API Call**
- For an endpoint the node doesn't cover, pick **Custom API Call** in the node's actions. It opens an HTTP Request node. Set **Authentication** to *Predefined Credential Type*, choose **WebzzConnect API** (or **WebzzConnect OAuth2 API**), and call `https://connect.webzz.cloud/api/v1/accounts/<account id>/...`.

List-style operations have **Return All** and **Limit**. Fields that WebzzConnect uses internally (names starting with `wz_`) are removed from the output. Errors show the message from WebzzConnect; a rate-limit error tells you how long to wait.

## Trigger

**WebzzConnect Trigger** starts a workflow instantly (no polling). Choose one or more events:

- New Conversation, Conversation Status Changed, Conversation Updated
- New Message (filter by incoming or outgoing). The output has a top-level `button_payload`: the ID of the tapped reply button or list row, the text (or payload) of a template quick reply, or `null` for typed text, so a Switch node can branch on `{{$json.button_payload}}`.
- Contact Created, Contact Updated
- Deal Created, Deal Updated, Deal Stage Changed, Deal Won, Deal Lost, Deal Deleted

Optionally narrow conversation and message events to some inboxes, and deal events to some pipelines. Leave a picker empty to receive events from all of them. To change the events or the pickers, deactivate and activate the workflow again.

Activating the workflow registers the n8n webhook address in WebzzConnect; deactivating removes it. If the n8n webhook address changes (for example a new host), the next activation replaces the old registration. Every delivery is checked against its HMAC-SHA256 signature (`X-WebzzConnect-Signature`) and rejected if it is older than five minutes. Your n8n webhook address must be reachable from the internet (set `WEBHOOK_URL` for self-hosted n8n).

The connected user needs access to the data behind each event, otherwise activation fails with a message naming the missing permission.

## Rate limits

WebzzConnect allows 600 requests per minute per connection, and contact search is limited to 100 requests per minute per account. When a limit is hit the node fails with a rate-limit error that includes the `Retry-After` wait. Use **Retry On Fail** on the node, or a Wait node, in high-volume workflows.

## Compatibility

Tested with n8n 1.x and 2.x (Node.js 22). Requires a WebzzConnect account.

## Resources

- [n8n community nodes documentation](https://docs.n8n.io/integrations/#community-nodes)
- [WebzzConnect](https://connect.webzz.cloud)

## Version history

- 0.1.0: first release.
