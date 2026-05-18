# Chatwoot Ops Console

Small self-hosted companion app for Chatwoot operations:

- Bulk transfer conversations from one agent to another.
- Bulk assign conversations to a team.
- Bulk unassign conversations from an agent.
- Transfer contact ownership via a configurable contact custom attribute such as `sales_owner_id`.
- Preview every affected row before writing.
- Store a local audit log for every action made through this app.
- Export audit logs, campaign trackers, and bulk job results as CSV.
- Receive Chatwoot webhooks and count campaign replies.
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

## Operator flow

Use the `Actions` screen for daily work. It is designed as a three-step flow:

1. Pick the action: transfer to agent, remove assignee, move to team, or transfer customer owner.
2. Choose filters: current agent/owner, status, target agent/team, and the scan safety limit.
3. Preview affected rows, then execute only after the preview looks correct.

When the app is opened inside Chatwoot as a Dashboard App, it switches to a compact embedded layout automatically: the large sidebar is hidden, tabs move to the top, and the current Chatwoot agent/contact/conversation context is shown in the banner.

For the customer transfer report, use the local action logs and bulk job CSV exports. Every transfer executed from the app records the actor, action, source owner/agent, target owner/agent, affected row, and job id.

## Notes

- Unassignment uses the standard assignments endpoint with `assignee_id: null`. Current Chatwoot source routes that through the assignment service and saves the conversation with no assignee.
- Built-in Chatwoot Enterprise audit logs can be fetched from the Audit Log page when the installed plan/edition has `audit_logs` enabled.
- Local audit logs cover actions executed through this app even when Enterprise audit logs are unavailable.

Research notes and source links are in `docs/chatwoot-research.md`.
