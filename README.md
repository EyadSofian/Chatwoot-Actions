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

Subscribe at least to `message_created`, `message_updated`, `conversation_updated`, and `contact_updated`.

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
```

Optional filters:

```text
REOPEN_ROUTER_INBOX_IDS=1,2
REOPEN_ROUTER_AGENT_IDS=4,7,9
REOPEN_ROUTER_FALLBACK=team
REOPEN_ROUTER_TEAM_ID=3
```

Notes:

- If the current assignee is `online`, the app does nothing.
- The router only handles public incoming customer messages.
- `REOPEN_ROUTER_INBOX_IDS` limits the automation to specific inboxes.
- `REOPEN_ROUTER_AGENT_IDS` limits target agents to a safe online pool.
- Each router decision is saved in local webhook events and the local audit log.

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
