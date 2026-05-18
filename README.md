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
npm start
```

## Chatwoot setup

1. Create or copy a user access token from Chatwoot profile settings.
2. Give that user enough permissions to view agents, teams, conversations, contacts, and reports.
3. Optional: add this app as a Dashboard App in Chatwoot settings with the app URL.
4. Optional: add a Chatwoot webhook pointing to:

```text
https://your-ops-console.example.com/api/webhooks/chatwoot
```

Subscribe at least to `message_created`, `message_updated`, `conversation_updated`, and `contact_updated`.

## Notes

- Unassignment uses the standard assignments endpoint with `assignee_id: null`. Current Chatwoot source routes that through the assignment service and saves the conversation with no assignee.
- Built-in Chatwoot Enterprise audit logs can be fetched from the Audit Log page when the installed plan/edition has `audit_logs` enabled.
- Local audit logs cover actions executed through this app even when Enterprise audit logs are unavailable.

Research notes and source links are in `docs/chatwoot-research.md`.
