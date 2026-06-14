# Chatwoot Ops Console

Small self-hosted companion app for Chatwoot operations:

- Bulk transfer conversations from one agent to another.
- Bulk assign conversations to a team.
- Bulk unassign conversations from an agent.
- Assign conversations from a pasted phone list, CSV, or XLSX file.
- Report open conversations by selected inbox, unassigned queue, and selected agents.
- Check whether selected open conversations still need a public sales reply.
- Transfer contact ownership via a configurable contact custom attribute such as `sales_owner_id`.
- Preview every affected row before writing.
- Store a local audit log for every action made through this app.
- Export audit logs, campaign trackers, and bulk job results as CSV.
- Receive Chatwoot webhooks and count campaign replies.
- Automatically reroute reopened incoming conversations away from offline/busy agents.
- Run as a Chatwoot Dashboard App and read conversation/contact/currentAgent context.

## Run

```powershell
npm start -- --port=3317
```

Open:

```text
http://localhost:3317
```

You can provide the Chatwoot connection from the Settings screen, or with environment variables:

```powershell
$env:CHATWOOT_BASE_URL="https://chatwoot.example.com"
$env:CHATWOOT_ACCOUNT_ID="1"
$env:CHATWOOT_API_TOKEN="your-user-access-token"
$env:CHATWOOT_OPS_PORT="3317"
$env:OPS_USERNAME="admin"
$env:OPS_PASSWORD="use-a-strong-password"
npm start
```

## Railway

Railway provides a `PORT` variable automatically, and the app listens on `0.0.0.0:$PORT` in production. Do not set `CHATWOOT_OPS_PORT` on Railway unless you also know how the service port is exposed.

Set these Railway variables:

```text
CHATWOOT_BASE_URL=https://your-chatwoot-domain.com
CHATWOOT_ACCOUNT_ID=1
CHATWOOT_API_TOKEN=your-user-access-token
OPS_USERNAME=admin
OPS_PASSWORD=use-a-strong-password
WEBHOOK_SECRET=use-a-different-strong-secret
REOPEN_ROUTER_ENABLED=false
```

If you want local audit logs, bulk job history, webhook events, and campaign counters to persist after redeploys, attach a Railway Volume. Either mount it to `/app/data`, or mount it anywhere and set `DATA_DIR` to that mount path.

Use `/api/health` as the healthcheck path.

## Chatwoot setup

1. Create or copy a user access token from Chatwoot profile settings.
2. Give that user enough permissions to view agents, teams, conversations, contacts, and reports.
3. Optional: add this app as a Dashboard App in Chatwoot settings with the app URL.
4. Optional: add a Chatwoot webhook pointing to:

```text
https://your-ops-console.example.com/api/webhooks/chatwoot
```

Subscribe at least to `conversation_created`, `conversation_status_changed`, and `message_created`. The other events can remain enabled for reporting.

If `OPS_PASSWORD` is enabled, set `WEBHOOK_SECRET` to the same secret configured in Chatwoot. Chatwoot will sign webhook requests with `X-Chatwoot-Signature`, and this app will verify that signature.

For older setups that cannot send a signed webhook, you can also use:

```text
https://your-ops-console.example.com/api/webhooks/chatwoot?secret=your-webhook-secret
```

## Reopen Router

The Reopen Router fixes the Chatwoot behavior where an incoming WhatsApp reply can reopen an old conversation and keep it assigned to the previous agent even when that agent is offline or busy.

When enabled, `/api/webhooks/chatwoot` listens for incoming `message_created` events. If the current assignee is unavailable, the app assigns the conversation to an online agent. If no online agent can be assigned, the default fallback is to unassign the conversation so it returns to the shared queue.

Set these variables on Railway:

```text
REOPEN_ROUTER_ENABLED=true
REOPEN_ROUTER_STATUSES=offline,busy,away,unavailable,missing
REOPEN_ROUTER_FALLBACK=unassign
REOPEN_ROUTER_ASSIGN_UNASSIGNED=true
REOPEN_ROUTER_COOLDOWN_SECONDS=60
REOPEN_ROUTER_INBOX_IDS=27
REOPEN_ROUTER_TEAM_ID=3
```

Optional filters:

```text
REOPEN_ROUTER_INBOX_IDS=1,2
REOPEN_ROUTER_AGENT_IDS=4,7,9
REOPEN_ROUTER_FALLBACK=team
REOPEN_ROUTER_TEAM_ID=3
```

Notes:

- If the current assignee is `online` and inside the configured target team, the app does nothing. If the current assignee is outside that team, the app reroutes the conversation back to the target team.
- If `REOPEN_ROUTER_TEAM_ID` is set, the app loads that team's members from Chatwoot and intersects them with the current inbox members. It will only assign to online agents who are in both the target team and the conversation inbox. It also sends `team_id` with the assignment.
- The router only handles public incoming customer messages.
- `REOPEN_ROUTER_INBOX_IDS` limits the automation to specific inboxes.
- `REOPEN_ROUTER_AGENT_IDS` limits target agents to a safe online pool. When `REOPEN_ROUTER_TEAM_ID` is also set, this whitelist is applied inside that team only.
- Each router decision is saved in local webhook events and the local audit log.

## Department Router

The Department Router asks new customers to choose Sales or Operations, then assigns the conversation only to an online agent who is both a member of the selected team and a member of the current inbox.

Railway configuration for Engosoft:

```text
DEPARTMENT_ROUTER_ENABLED=true
DEPARTMENT_ROUTER_INBOX_IDS=27
DEPARTMENT_ROUTER_SALES_TEAM_ID=4
DEPARTMENT_ROUTER_OPERATIONS_TEAM_ID=3
DEPARTMENT_ROUTER_PROMPT_ON_NEW=true
DEPARTMENT_ROUTER_PROMPT_ON_RESOLVED=false
DEPARTMENT_ROUTER_NEW_CONTACTS_ONLY=true
DEPARTMENT_ROUTER_CONFIRM_SELECTION=true
DEPARTMENT_ROUTER_SKIP_CAMPAIGNS=true
DEPARTMENT_ROUTER_ASSIGN_AGENT=false
```

`DEPARTMENT_ROUTER_ASSIGN_AGENT=false` makes the router send the menu and, after the customer picks `1` or `2`, assign the conversation to the chosen team **without** assigning a specific agent. The conversation stays Unassigned so the team's agents pick it up themselves. The Chatwoot assignments endpoint ignores `team_id` when `assignee_id` is present, so the router sets the team and clears the assignee in two separate calls. With the default `true`, the router instead assigns an online member of the team and inbox.

Default customer menu:

```text
أهلاً بك مع فريق Engosoft.
للتواصل مع فريق المبيعات اكتب 1.
للتواصل مع فريق العمليات اكتب 2.
```

The parser accepts `1`, Arabic `١`, Sales/مبيعات/سيلز and `2`, Arabic `٢`, Operations/عمليات/أوبريشن. It only treats a reply as a department choice while the conversation is waiting for a choice. The customer can send `تغيير القسم` to show the menu again.

Behavior:

- New conversation: register it without sending anything. Send the menu once only after the first incoming customer message opens the WhatsApp service window.
- Existing contact with any previous Chatwoot conversation: never send the department menu.
- Broadcast/campaign conversation: never send the menu and never reassign it, even when the customer later replies and even if the current agent is offline. A conversation counts as a broadcast when it carries a native Chatwoot `campaign_id`, or when it was opened/touched by the external campaign uploader, which marks the conversation with custom attributes (`api_campaign_label`, `last_api_campaign_label`, or any `api_sent_*` key). Set `DEPARTMENT_ROUTER_SKIP_CAMPAIGNS=false` only if you want broadcasts to flow through the router. The reopen router honors the same guard via `REOPEN_ROUTER_SKIP_CAMPAIGNS`.
- Resolved conversation: do not show the menu again by default. `DEPARTMENT_ROUTER_PROMPT_ON_RESOLVED` must be explicitly enabled to change this.
- While waiting for the department choice, remove any temporary agent assignment so the conversation cannot be handled by the wrong department.
- Manual assignment wins: if a human assigned the conversation to a specific agent, the router locks it and never reassigns it again, even when that agent is offline. The router only manages an agent it assigned itself (it may still move that agent to an online colleague while the conversation is auto-handled). A "manual" assignment is detected whenever the current assignee is not the agent the router last assigned.
- Old open conversation already assigned to Sales Team `4` or Operations Team `3`: keep the same department. The router only moves an auto-assigned agent who is no longer an eligible online team/inbox member; a manually assigned agent is never moved.
- Old open conversation with no known Sales/Operations team: do nothing. Never send the menu just because an old conversation has no saved department.
- While waiting for `1` or `2`, an invalid reply does not repeat the menu. Duplicate `message_created` webhooks are ignored by message id.
- No online eligible member: assign the selected team and leave the agent unassigned so nobody outside the team receives the conversation.
- Routing state is stored both locally and in Chatwoot conversation custom attributes. Local state remains the fallback when custom attributes are unavailable.

For WhatsApp, the default menu is text-based because it works reliably for every provider. Chatwoot supports interactive message content types, but WhatsApp reply buttons generally require a compatible provider flow or an approved WhatsApp template. Keep the text menu unless the WhatsApp integration has a tested interactive template.

## Operator flow

Use the `Actions` screen for daily work. It is designed as a three-step flow:

1. Pick the action: transfer to agent, remove assignee, move to team, or transfer customer owner.
2. Choose filters: current agent/owner, inbox, status, target agent/team, and the scan safety limit.
3. Preview affected rows, then execute only after the preview looks correct.

When the app is opened inside Chatwoot as a Dashboard App, it switches to a compact embedded layout automatically: the large sidebar is hidden, tabs move to the top, and the current Chatwoot agent/contact/conversation context is shown in the banner.

Use the language button in the top bar to switch between English and Arabic. Arabic mode is saved in the browser, switches the UI to right-to-left layout, and keeps the same bulk action workflow. You can also open the Arabic version directly with `?lang=ar`, for example `https://your-railway-url/?lang=ar`.

For the customer transfer report, use the local action logs and bulk job CSV exports. Every transfer executed from the app records the actor, action, source owner/agent, target owner/agent, affected row, and job id.

Use the `Open Report` screen when you only need visibility, not a write action. It can show open conversation counts per selected inbox, unassigned open conversations, unread counts, customer name/phone, and open conversation counts for selected agents. Enable `Check sales reply status` when you also need to know whether the customer's last public message has been answered by sales. This reads messages inside each conversation, so start with a small sales reply check limit and increase it after the report looks correct. After running the report, use `Download report CSV` to export the current result set.

Use the `Phone Assign` screen when you receive a list like `Contact Name, Phone, Salesperson`. Paste the CSV content or upload `.csv`, `.txt`, or `.xlsx`, choose the target agent, preview matches, then execute. The app first reads the file and shows how many phone numbers were found, then searches Chatwoot contacts by phone number, filters their conversations by status/inbox, and only assigns the conversations shown in the preview. The inbox field is a source filter for existing conversations; it does not move a conversation to another inbox.

## Notes

- Unassignment uses the standard assignments endpoint with `assignee_id: null`. Current Chatwoot source routes that through the assignment service and saves the conversation with no assignee.
- Built-in Chatwoot Enterprise audit logs can be fetched from the Audit Log page when the installed plan/edition has `audit_logs` enabled.
- Local audit logs cover actions executed through this app even when Enterprise audit logs are unavailable.

Research notes and source links are in `docs/chatwoot-research.md`.
