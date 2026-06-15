# Chatwoot Research Notes

These notes anchor the app design to official Chatwoot documentation and current source behavior.

## Integration model

- Chatwoot Application APIs are built for account-level automation, internal tools, and bulk import/export. They require a user access token and are available on Cloud and self-hosted installations.
- Platform APIs are self-hosted/managed-hosting only and are for installation-level user/account provisioning. This app uses Application APIs for day-to-day operations.
- Dashboard Apps let an independently hosted app be embedded inside Chatwoot and receive conversation/contact/currentAgent context through `window.postMessage`.

Sources:
- https://developers.chatwoot.com/api-reference/introduction
- https://www.chatwoot.com/hc/user-guide/articles/1677691702-how-to-use-dashboard-apps

## Bulk assignment and unassignment

- Official API: `POST /api/v1/accounts/{account_id}/conversations/{conversation_id}/assignments`.
- Request supports `assignee_id` for an agent and `team_id` for a team.
- Source controller checks `params.key?(:assignee_id)`, so sending `assignee_id: null` still calls assignment service.
- Source service resolves `conversation.account.users.find_by(id: assignee_id)`. With null, the resolved assignee is nil and `conversation.assignee = nil` is saved.
- Source activity handler generates a removed-assignee activity when `assignee_id` is absent after change.

Sources:
- https://developers.chatwoot.com/api-reference/conversation-assignments/assign-conversation
- https://raw.githubusercontent.com/chatwoot/chatwoot/develop/app/controllers/api/v1/accounts/conversations/assignments_controller.rb
- https://raw.githubusercontent.com/chatwoot/chatwoot/develop/app/services/conversations/assignment_service.rb
- https://raw.githubusercontent.com/chatwoot/chatwoot/develop/app/models/concerns/assignee_activity_message_handler.rb

## Finding target conversations

- Conversation list supports `assignee_type`, `status`, `q`, `inbox_id`, `team_id`, `labels`, and `page`.
- Conversation filter supports a `payload` of attribute filters. The app tries this first for `assignee_id`, then falls back to paginated list filtering if the installed version behaves differently.
- Inbox selection comes from `GET /api/v1/accounts/{account_id}/inboxes`, which returns a `payload` array with inbox `id`, `name`, and `channel_type`.
- Bulk transfer can safely combine filters such as `assignee_id + inbox_id + status` before calling the assignment endpoint.

Sources:
- https://developers.chatwoot.com/api-reference/conversations/conversations-list
- https://developers.chatwoot.com/api-reference/conversations/conversations-filter
- https://chatwoot-447c5a93.mintlify.app/api-reference/inboxes/list-all-inboxes
- https://raw.githubusercontent.com/chatwoot/chatwoot/develop/app/finders/conversation_finder.rb
- https://raw.githubusercontent.com/chatwoot/chatwoot/develop/app/services/conversations/filter_service.rb

## Contact owner transfer

- Contacts can store `custom_attributes`.
- Contact update endpoint accepts `custom_attributes`, so a sales owner field such as `sales_owner_id` can model ownership beyond active conversations.
- Contact conversations endpoint lets the app optionally reassign conversations for matched contacts.

Sources:
- https://developers.chatwoot.com/api-reference/contacts/list-contacts
- https://developers.chatwoot.com/api-reference/contacts/update-contact
- https://developers.chatwoot.com/api-reference/contacts/contact-conversations

## Team-aware department routing

- The assignment API can assign a conversation to a team or an agent, but Chatwoot documents that `team_id` is ignored when `assignee_id` is present. The app therefore writes team assignment and agent assignment as two separate calls when both are required.
- Agent and team-member responses expose `availability_status` as the effective online/busy/offline status. The Department Router uses this for Trainee Support/Operations routing and falls back to the team queue when no eligible online agent exists.
- Team members can be loaded with `/teams/{team_id}/team_members`; inbox membership is loaded separately and intersected with team members so the app never assigns a conversation to someone outside the current inbox.
- Conversation details include `status`, `inbox_id`, `meta.assignee`, and `custom_attributes`. The router stores its state in conversation custom attributes so it can resume after redeploys and avoid mistaking its own previous assignment for a manual human takeover.
- Conversation list supports `assignee_type=unassigned`, `status`, `inbox_id`, and `team_id`, which is enough for a future queue-drainer if Engosoft wants unassigned Operations conversations to be auto-picked when someone later becomes online.

Sources:
- https://developers.chatwoot.com/api-reference/conversation-assignments/assign-conversation
- https://developers.chatwoot.com/api-reference/agents/list-agents-in-account
- https://developers.chatwoot.com/api-reference/teams/list-agents-in-team
- https://developers.chatwoot.com/api-reference/conversations/conversation-details
- https://developers.chatwoot.com/api-reference/conversations/conversations-list

## Reports, audit, campaigns, and webhooks

- Reports API exposes account metrics such as conversations, incoming/outgoing messages, first response time, resolution time, and resolutions.
- Reporting events are paginated and filterable by time, inbox, user, and event name.
- Enterprise audit logs API exposes who/what/when/where style account audit rows when the feature is enabled.
- Webhooks can publish conversation and message events; the app logs them locally and can count campaign replies from `message_created`.
- Message creation supports `campaign_id` and WhatsApp `template_params`, so outbound campaign tracking can be correlated where the Chatwoot channel supports it.

Sources:
- https://developers.chatwoot.com/api-reference/reports/get-account-reports
- https://developers.chatwoot.com/api-reference/reports/account-reporting-events
- https://developers.chatwoot.com/api-reference/audit-logs/list-audit-logs-in-account
- https://developers.chatwoot.com/api-reference/webhooks/list-all-webhooks
- https://developers.chatwoot.com/api-reference/messages/create-new-message
