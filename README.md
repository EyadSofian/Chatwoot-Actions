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

## Automation tab

The Chatwoot Dashboard App includes an **Automation** tab. Admins can change the Department Router and Reopen Router without redeploying Railway:

- chatbot/menu text and confirmation messages
- enabled inboxes
- Sales and Operations teams
- allowed agents for each route
- business hours
- campaign skipping
- fallback behavior when no online agent is available
- whether an offline/busy/away manually assigned agent should be released

Saved settings live in `DATA_DIR/automation-settings.json` and override the matching Railway environment variables. If no settings were saved yet, the app shows the Railway defaults. Keep a Railway Volume attached if these settings must survive redeploys.

### Fahd Botpress handoff

Botpress Cloud should call this app instead of calling Chatwoot directly:

```text
POST /botpress-cloud
Header: x-botpress-secret: WEBHOOK_SECRET
```

The Automation tab controls whether Fahd is enabled, its working hours, whether broadcast handoffs are ignored, and the outside-hours reply. Default Fahd hours are `10:00` to `21:00` in `Africa/Cairo`, every day except Friday.

Useful Railway defaults:

```text
BOTPRESS_CLOUD_ENABLED=false
BOTPRESS_CLOUD_SKIP_BROADCASTS=true
BOTPRESS_CLOUD_REQUIRE_RESOLVED_REENTRY=true
BOTPRESS_CLOUD_WORKING_HOURS_ENABLED=true
BOTPRESS_CLOUD_TIMEZONE=Africa/Cairo
BOTPRESS_CLOUD_START=10:00
BOTPRESS_CLOUD_END=21:00
BOTPRESS_CLOUD_DAYS=0,1,2,3,4,6
BOTPRESS_CLOUD_IN_HOURS_QUEUE_MESSAGE=سيتم التواصل معكم في أقرب وقت. نقدر صبركم.
```

Minimal Botpress Execute Code payload:

```ts
await axios.post(
  "https://your-ops-console.example.com/botpress-cloud",
  {
    conversationId: user.chatwoot_conversation_id,
    summary: workflow.chatSummary || workflow.transcript || "العميل طلب التحدث لموظف.",
    department: workflow.department || "operations",
    isBroadcastReply: Boolean(workflow.isBroadcastReply),
    source: "botpress-cloud"
  },
  { headers: { "x-botpress-secret": env.WEBHOOK_SECRET } }
);
```

Broadcast handoffs are skipped when `isBroadcastReply=true` or a campaign/broadcast marker is sent in the payload.

With `BOTPRESS_CLOUD_REQUIRE_RESOLVED_REENTRY=true`, the app only accepts Fahd handoffs for conversations that were marked `resolved` before the customer came back. If a configured agent is online after Fahd collects the customer details, the app opens the conversation, adds Fahd's private note, and assigns it to that agent. If no configured agent is online, the app assigns the conversation to the selected team, clears the old assignee, and sends either `BOTPRESS_CLOUD_IN_HOURS_QUEUE_MESSAGE` during business hours or `BOTPRESS_CLOUD_OUTSIDE_HOURS_MESSAGE` outside business hours.

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

## Lead Source Survey

The Lead Source Router asks brand-new customers in selected inboxes how they heard about the business. It never assigns, unassigns, changes team, opens, resolves, or otherwise changes routing. It only sends the question, reads the customer's numeric reply, ensures the selected label exists, adds that label to the Chatwoot contact **and the conversation**, stores the selected value in contact and conversation custom attributes, and finally sends a thank-you/confirmation message.

The survey only starts on a **genuinely fresh conversation**. It is skipped when a human agent is already assigned (`LEAD_SOURCE_SKIP_ASSIGNED`, default on) or when the conversation already carries a message history — an agent reply, or an earlier customer message before this one (`LEAD_SOURCE_NEW_CONVERSATIONS_ONLY`, default on). Combined with `LEAD_SOURCE_ASK_ONCE_PER_CONTACT`, a returning customer or an in-progress chat is never interrupted.

Campaign/broadcast conversations are skipped completely. If the conversation has a native Chatwoot `campaign_id` or an external uploader marker such as `api_campaign_status`, `api_campaign_label`, `api_campaign_active_until`, `last_api_campaign_label`, or any `api_sent_*` key, the router does nothing.

Railway example (Arabic prompt, English labels):

```text
LEAD_SOURCE_ROUTER_ENABLED=true
LEAD_SOURCE_ROUTER_INBOX_IDS=25
LEAD_SOURCE_OPTIONS=فيسبوك=facebook|إنستجرام=instagram|يوتيوب=youtube|تيك توك=tiktok|جوجل=google|سناب شات=snapchat|ترشيح=referral|أخرى=other
LEAD_SOURCE_ATTRIBUTE_KEY=lead_source
LEAD_SOURCE_SKIP_CAMPAIGNS=true
LEAD_SOURCE_ASK_ONCE_PER_CONTACT=true
LEAD_SOURCE_SKIP_ASSIGNED=true
LEAD_SOURCE_NEW_CONVERSATIONS_ONLY=true
LEAD_SOURCE_LABEL_COLOR=#1f93ff
LEAD_SOURCE_PROMPT_TEXT=أهلاً بيك مع إنجوسوفت 👋\nممكن نعرف حضرتك عرفتنا منين؟\n\n{options}\n\nاكتب رقم الاختيار فقط.
LEAD_SOURCE_CONFIRM_TEXT=شكرًا لتواصلك مع إنجوسوفت 🌟\nتم تسجيل بياناتك بنجاح، وسيتواصل معك أحد مستشارينا التعليميين في أقرب وقت. 🙏
```

`LEAD_SOURCE_OPTIONS` is required; the app does not add default choices. Separate choices with `|`, comma, semicolon, or new lines.

**Display vs. label value:** a choice may be written as `display=value` (or `display=>value`), e.g. `فيسبوك=facebook`. The customer sees the display (`فيسبوك`); the Chatwoot label title and the `lead_source` attribute use the value (`facebook`). This keeps labels ASCII — Chatwoot slugifies label titles and rejects some Arabic or spaced titles — while the prompt stays in Arabic. Without a separator the display is used for both. Customers can reply with the choice number, the display text, or the value.

`LEAD_SOURCE_PROMPT_TEXT` and `LEAD_SOURCE_CONFIRM_TEXT` support `\n` for line breaks: a literal `\n` in the env value is converted to a real newline before the message is sent (Node keeps env values verbatim, so without this it would print `\n` to the customer). `{options}` in the prompt is replaced with the numbered choice list. Set `LEAD_SOURCE_CONFIRM_TEXT=` (empty) to skip the confirmation message.

Labelling is best-effort: if a label still can't be created or applied, the router records the answer in the `lead_source` custom attribute and thanks the customer anyway — the reply is never lost to a label error.

## Post-Resolution Rating Survey (CSAT)

The Resolve Survey asks for a satisfaction rating **after a conversation is resolved** in selected inboxes (instead of at the start of the conversation). When a conversation is resolved, it sends two messages:

1. An acknowledgement (`RESOLVE_SURVEY_ACK_TEXT`, e.g. "تم تسجيل بياناتك بنجاح ✅").
2. A rating request (`RESOLVE_SURVEY_RATING_TEXT`) that names the responsible agent and asks for a score from `min` to `max`.

It then waits for the customer's reply. The **first number** in the reply (Arabic or ASCII digits) within the scale is stored on the conversation as the `csat_rating` custom attribute, along with the responsible agent (`resolve_survey_agent_id` / `resolve_survey_agent_name`, captured at resolve time), and the customer is thanked (`RESOLVE_SURVEY_THANKS_TEXT`). A non-numeric reply is left alone and flows to the normal handling, so a fresh question is never swallowed by the survey. Each conversation is surveyed once.

Railway example (Arabic, 1–5 scale):

```text
RESOLVE_SURVEY_ENABLED=true
RESOLVE_SURVEY_INBOX_IDS=25
RESOLVE_SURVEY_MIN_RATING=1
RESOLVE_SURVEY_MAX_RATING=5
RESOLVE_SURVEY_ATTRIBUTE_KEY=csat_rating
RESOLVE_SURVEY_ACK_TEXT=تم تسجيل بياناتك بنجاح ✅
RESOLVE_SURVEY_RATING_TEXT=قيّم تجربتك مع خدمتنا{agent} من {min} إلى {max}:\n{max} = ممتاز، {min} = سيئة جدًا\nاكتب رقم من {min} إلى {max} فقط.
RESOLVE_SURVEY_AGENT_TEMPLATE= ومع الموظف المسؤول ({agent})
RESOLVE_SURVEY_THANKS_TEXT=شكرًا لتقييمك! 🌟 استلمنا تقييمك ({rating}/{max}) وهيساعدنا نطوّر خدمتنا.

# Turn off the start-of-conversation lead-source question on this inbox:
LEAD_SOURCE_ROUTER_ENABLED=false
```

All texts support `\n` for line breaks. Placeholders: `{min}`/`{max}` (scale bounds), `{agent}` in the rating text (expands to `RESOLVE_SURVEY_AGENT_TEMPLATE` with the agent name, or nothing when the conversation was unassigned), and `{rating}`/`{max}` in the thanks text. Set `RESOLVE_SURVEY_ACK_TEXT=` or `RESOLVE_SURVEY_THANKS_TEXT=` (empty) to skip either message. Use a **dedicated inbox** for the survey — one that is not also a Fahd/Botpress bot inbox — so the rating reply is captured by the survey and not forwarded to the bot.

## Analytics

> **Standalone reports view:** open `/?view=reports` for a clean, managers-only dashboard that shows just the **Analytics**, **Campaign Analytics**, and **Email Digest** tabs (no operations tabs). It loads full-screen from the app's own URL and uses the server-side Chatwoot connection, so it does not need to be embedded inside Chatwoot. Share that link (behind `OPS_PASSWORD`) with people who only need reports.

The **Analytics** tab (and the `POST /api/reports/analytics` endpoint) combines two data sources into one report:

- **Lead sources and CSAT ratings** come from a durable local fact log. Every lead source collected and every rating captured is appended to `DATA_DIR/metrics.json` the moment it happens, so history survives redeploys and the capped webhook buffer. Each fact carries a `dedupeKey` (one rating per conversation, one source per contact) so a replayed webhook never double-counts. Attach a **Railway Volume** (`DATA_DIR`) to keep it.
- **Agent and team response / resolution times** come live from Chatwoot's own reporting API (`/reports/summary`), best-effort. If Chatwoot reporting is unavailable the lead-source and CSAT parts still render, with a warning.

The report answers: how many customers were surveyed, the average rating and its distribution, how many leads came from each source (deduped per contact, with percentages), customer satisfaction per agent, and per-agent / per-team conversation counts with average first-response and resolution times. Filter by date range and inbox, and download the whole thing as CSV.

The report object is built by the pure `aggregateAnalytics()` helper (CSAT + lead sources) wrapped by `getAnalyticsReport()` (which adds the live Chatwoot merge), so it can be reused later for a scheduled email digest — that part is not wired yet, and no email configuration is required today.

```text
# Optional: raise the durable fact-log cap (default 50000 records)
METRICS_STORE_LIMIT=50000
```

## Campaign Analytics

The **Campaign Analytics** tab (and `POST /api/reports/campaigns`) reads broadcast campaigns from the separate [Campaign Uploader](https://github.com/EyadSofian/chatwoot-campain-uploder) service over HTTP (`GET /api/jobs`) and merges live Chatwoot inbox names. It answers: how many campaigns exist, which are **running** vs **pending (not started)** vs **completed/failed**, the name and template of each campaign, its inbox, total messages sent, and the **campaign count per inbox**.

Only `send` jobs are treated as campaigns (`upload` jobs are contact imports). Set the uploader's public URL either in the tab or on the server:

```text
# One URL, or several comma-separated (they are fetched and merged, each campaign
# tagged with its source host):
CAMPAIGN_UPLOADER_URL=https://uploader-a.up.railway.app,https://uploader-b.up.railway.app
# Optional, only if the uploaders' /api/jobs is protected:
CAMPAIGN_UPLOADER_TOKEN=your-secret
```

It is best-effort — if the uploader or Chatwoot is unreachable the tab still renders what it could load, with a warning.

## Email Digest

The **Email Digest** tab sends a **daily analytics email per recipient**, each scoped to its own inbox, over **Zoho Mail SMTP**. The email bundles CSAT, lead sources, per-agent / per-team response times, and campaign totals for that recipient's inbox. Recipients are managed in the tab (saved to `DATA_DIR/digest-recipients.json`) and can be seeded from an env var.

```text
ANALYTICS_DIGEST_ENABLED=true
ANALYTICS_DIGEST_HOUR=8                       # local hour to send (default 8)
ANALYTICS_DIGEST_TIMEZONE=Africa/Cairo        # IANA timezone (default Africa/Cairo)
ANALYTICS_DIGEST_FROM=reports@your-domain.com # defaults to ZOHO_SMTP_USER

# Zoho Mail SMTP (use an app-specific password, not your login password):
ZOHO_SMTP_HOST=smtp.zoho.com                  # default
ZOHO_SMTP_PORT=465                            # 465 (SSL) or 587 (TLS)
ZOHO_SMTP_USER=reports@your-domain.com
ZOHO_SMTP_PASS=your-zoho-app-password

# Optional seed (the tab overrides this once you save there):
ANALYTICS_DIGEST_RECIPIENTS=[{"email":"a@x.com","inboxId":"15","label":"Sales"}]
```

The scheduler fires once per local day at or after `ANALYTICS_DIGEST_HOUR` and never twice the same day (it claims the day before sending). Use **Send now (test)** in the tab to email everyone immediately. The whole feature is inert until `ZOHO_SMTP_USER`/`ZOHO_SMTP_PASS` and at least one recipient are configured.

## Department Router

The Department Router implements the trainee WhatsApp flow from the operations playbook. It asks customers to choose Sales, Trainee Support, or Complaints, then routes only inside the configured Chatwoot teams/inbox.

Railway configuration for Engosoft:

```text
DEPARTMENT_ROUTER_ENABLED=true
DEPARTMENT_ROUTER_INBOX_IDS=27
DEPARTMENT_ROUTER_SALES_TEAM_ID=4
DEPARTMENT_ROUTER_OPERATIONS_TEAM_ID=3
DEPARTMENT_ROUTER_SALES_AGENT_IDS=20,18
DEPARTMENT_ROUTER_OPERATIONS_AGENT_IDS=21,28,71,73,22
DEPARTMENT_ROUTER_PROMPT_ON_NEW=true
DEPARTMENT_ROUTER_PROMPT_ON_RESOLVED=true
DEPARTMENT_ROUTER_NEW_CONTACTS_ONLY=true
DEPARTMENT_ROUTER_CONFIRM_SELECTION=true
DEPARTMENT_ROUTER_SKIP_CAMPAIGNS=true
DEPARTMENT_ROUTER_ASSIGN_AGENT=true
DEPARTMENT_ROUTER_SALES_ASSIGNMENT_MODE=online
DEPARTMENT_ROUTER_REROUTE_UNAVAILABLE_MANUAL_ASSIGNMENTS=false
DEPARTMENT_ROUTER_MANUAL_ASSIGNMENT_UNAVAILABLE_STATUSES=offline,busy,away,unavailable,missing
DEPARTMENT_ROUTER_UNAVAILABLE_MANUAL_FALLBACK=unassign
DEPARTMENT_ROUTER_COMPLAINT_AGENT_NAME=Abdelrahman Tarek
# Or set the exact Chatwoot user id to avoid name matching:
# DEPARTMENT_ROUTER_COMPLAINT_AGENT_ID=123
CAMPAIGN_MARKER_TTL_SECONDS=2592000
```

Chatwoot's assignment endpoint ignores `team_id` when `assignee_id` is present, so this router always sets the team and the assignee in two separate calls when both are needed.

`DEPARTMENT_ROUTER_SALES_AGENT_IDS` and `DEPARTMENT_ROUTER_OPERATIONS_AGENT_IDS` are strict allowlists. A target must be in the configured list, the selected Chatwoot team, and inbox `27`. This prevents an accidental team member such as a Resale agent from receiving Trainee Support.

Keep `DEPARTMENT_ROUTER_SALES_ASSIGNMENT_MODE=online` so agents who are offline or on leave do not receive new Sales conversations. When no allowed agent is online, the router assigns the selected team and leaves the conversation Unassigned.

For inbox `27`, disable the generic Reopen Router (`REOPEN_ROUTER_ENABLED=false`). The Department Router owns new, routed, and reopened conversations and keeps their department boundary. A generic Reopen Router configured with team `3` can otherwise move an unknown Sales conversation into Operations.

In Chatwoot, disable team Auto Assignment for teams `3` and `4`, and disable assignment/unassignment Automation rules for inbox `27`. Assigning a team while Chatwoot Auto Assignment is enabled can temporarily assign an unrelated team member before this app applies its selected agent.

### Business hours

To switch behavior by time of day, enable business hours:

```text
DEPARTMENT_ROUTER_BUSINESS_HOURS_ENABLED=true
DEPARTMENT_ROUTER_BUSINESS_TIMEZONE=Africa/Cairo
DEPARTMENT_ROUTER_BUSINESS_START=09:00
DEPARTMENT_ROUTER_BUSINESS_END=22:00
DEPARTMENT_ROUTER_BUSINESS_DAYS=0,1,2,3,4,5,6
```

When enabled, the menu is always sent, but Trainee Support assignment depends on the clock in the configured timezone:

- **Inside** business hours: assign an online member of the team and inbox (falling back to the team queue if none are online).
- **Outside** business hours: route to the chosen team and leave the conversation Unassigned for the team to pick up.

Business hours override `DEPARTMENT_ROUTER_ASSIGN_AGENT`. `DEPARTMENT_ROUTER_BUSINESS_DAYS` uses `0=Sunday … 6=Saturday`; omit a day to mark it fully closed. The timezone must be an IANA name (e.g. `Africa/Cairo`) so daylight saving is handled correctly.

Default customer menu:

```text
للمبيعات و العروض الجديدة اضغط 1
لدعم المتدربين اضغط 2
للشكاوي اضغط 3
```

The parser accepts `1`, Arabic `١`, Sales/مبيعات/سيلز/ريسيل; `2`, Arabic `٢`, Operations/دعم المتدربين/عمليات/أوبريشن; and `3`, Arabic `٣`, شكاوي/الشكاوى. It only treats a reply as a department choice while the conversation is waiting for a choice. The customer can send `تغيير القسم` to show the menu again.

Behavior:

- New conversation: register it without sending anything. Send the menu once only after the first incoming customer message opens the WhatsApp service window.
- Existing contact with an active previous Chatwoot conversation: never send the department menu.
- Existing contact whose previous conversations are all `resolved`: treat the next conversation as a fresh entry and send the menu after the first incoming message.
- Broadcast/campaign conversation: never send the menu and never reassign it while its campaign marker is active, even when the customer replies immediately or the conversation is still Unassigned. The external uploader writes a verified `pending` marker before sending and changes it to `sent` afterwards. Pending markers expire after one hour if a job is interrupted. `CAMPAIGN_MARKER_TTL_SECONDS` controls how long successful external campaign replies bypass both routers (default 30 days); native Chatwoot `campaign_id` conversations remain protected. Use the same TTL in both apps.
- Resolved conversation: the next customer reply is treated as a fresh entry and the menu is sent again. This is the default with `DEPARTMENT_ROUTER_PROMPT_ON_RESOLVED=true`.
- Sales / option `1`: send the quick acknowledgement, then route only to online Resale agents in `DEPARTMENT_ROUTER_SALES_AGENT_IDS`. If none are online, leave it Unassigned in the Resale team.
- Trainee Support / option `2`: ask for full name, registered phone, and booked course, then assign an online Operations team/inbox member. If no eligible Operations agent is online, assign the Operations team and leave the conversation Unassigned.
- Complaints / option `3`: first send the complaint warning and ask the customer to confirm. If they reply `1`, route them to Trainee Support. If they reply `2`, ask for complaint details, send the received confirmation, and assign to `DEPARTMENT_ROUTER_COMPLAINT_AGENT_ID`, `DEPARTMENT_ROUTER_COMPLAINT_AGENT_EMAIL`, or `DEPARTMENT_ROUTER_COMPLAINT_AGENT_NAME` even if that person is offline.
- The router only reacts to public incoming customer messages. Agent/user outgoing messages are ignored even when the conversation is waiting for the first customer reply.
- A human agent handling the conversation wins. If the conversation currently has an assignee that the router did not assign itself, the router leaves it completely alone — no menu, no unassign, no reroute — even when that agent is offline. This includes the new-contact first-message flow, so an agent who self-assigns before the customer replies will not be interrupted.
- If `DEPARTMENT_ROUTER_REROUTE_UNAVAILABLE_MANUAL_ASSIGNMENTS=true`, that manual protection is relaxed only when the current assignee's status is in `DEPARTMENT_ROUTER_MANUAL_ASSIGNMENT_UNAVAILABLE_STATUSES`. Known Sales/Operations conversations are routed to an eligible online agent in the same department. Unknown conversations use `DEPARTMENT_ROUTER_UNAVAILABLE_MANUAL_FALLBACK`: `unassign`, `prompt`, or `ignore`.
- Resolving always releases the manual lock so the next customer message can enter the menu flow again.
- Old open conversation already assigned to an agent: left alone (see above). The router only moves an agent it assigned itself when that agent is no longer an eligible online team/inbox member; a human-assigned agent is never moved.
- A reopened conversation whose old `conversation_status_changed` webhook was missed is detected from the latest resolved activity in its Chatwoot message history. The old assignee is cleared and the department menu is shown. The customer's own follow-up messages after the resolve do not cancel this detection — only an agent reply sent after the resolve marks the conversation as actively handled again, so a customer who sends several messages to a resolved conversation still reaches the menu instead of staying locked to the previous (often offline) agent.
- Old open conversation with no known Sales/Operations/Complaints route: the Department Router leaves it untouched and does not pass it to a generic team router, preventing cross-department assignment.
- While waiting for `1`, `2`, or `3`, an invalid reply does not repeat the menu. Duplicate `message_created` webhooks are ignored by message id.
- No online eligible member: assign the selected team and leave the agent unassigned so nobody outside the team receives the conversation.
- Routing state and the router-assigned agent id are stored both locally and in Chatwoot conversation custom attributes. After a Railway redeploy, Chatwoot remains the ownership source of truth so an automated assignment is not mistaken for a human takeover.

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
