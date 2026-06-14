import { ChatwootClient, buildFilterPayload, getMeta, getPayload } from "./chatwootClient.js";
import { appendAudit, getDepartmentRoute, saveDepartmentRoute, saveJob } from "./store.js";

const DEFAULT_STATUSES = ["open", "pending", "resolved", "snoozed"];
const REOPEN_ROUTER_DEFAULT_UNAVAILABLE = ["offline", "busy", "away", "unavailable", "missing"];
const REOPEN_ROUTER_DEFAULT_FALLBACK = "unassign";
const reopenRouterCooldowns = new Map();
const departmentRouterLocks = new Map();
const DEPARTMENT_ATTRIBUTES = {
  department: "engosoft_department",
  state: "engosoft_department_route_state",
  teamId: "engosoft_department_team_id",
  promptNext: "engosoft_department_prompt_next",
  promptedAt: "engosoft_department_prompted_at",
  routedAt: "engosoft_department_routed_at"
};

export function makeClient(connection) {
  return new ChatwootClient(connection || {});
}

export async function probeChatwoot(connection) {
  const client = makeClient(connection);
  const [agents, teams, inboxes, metrics] = await Promise.allSettled([
    client.listAgents(),
    client.listTeams(),
    client.listInboxes(),
    client.conversationMetrics({ type: "account" })
  ]);

  return {
    agents: agents.status === "fulfilled" ? agents.value : [],
    teams: teams.status === "fulfilled" ? teams.value : [],
    inboxes: inboxes.status === "fulfilled" ? getPayload(inboxes.value) : [],
    metrics: metrics.status === "fulfilled" ? metrics.value : null,
    warnings: [agents, teams, inboxes, metrics]
      .filter(result => result.status === "rejected")
      .map(result => result.reason.message)
  };
}

export async function buildBulkPreview(connection, criteria = {}) {
  const client = makeClient(connection);
  const maxPages = Number(criteria.maxPages || process.env.CHATWOOT_MAX_PAGES || 20);
  const warnings = [];
  const items = [];

  if (criteria.scope === "contacts") {
    const contacts = await listContactsByOwner(client, criteria, maxPages);
    for (const contact of contacts) {
      items.push(contactToPreviewItem(contact, criteria));
    }

    if (criteria.includeContactConversations) {
      for (const contact of contacts.slice(0, Number(criteria.maxContactsForConversationLookup || 100))) {
        try {
          const response = await client.contactConversations(contact.id);
          const conversations = getPayload(response).filter(conversation => {
            const matchesInbox = criteria.inboxId ? Number(conversation.inbox_id) === Number(criteria.inboxId) : true;
            return matchesInbox && matchesStatus(conversation, criteria.status) && matchesUnread(conversation, criteria.unreadOnly);
          });
          for (const conversation of conversations) {
            items.push(conversationToPreviewItem(conversation, criteria, "contact_conversation"));
          }
        } catch (error) {
          warnings.push(`Could not load conversations for contact ${contact.id}: ${error.message}`);
        }
      }
    }
  } else {
    const conversations = await listConversationsByAgent(client, criteria, maxPages, warnings);
    for (const conversation of conversations) {
      items.push(conversationToPreviewItem(conversation, criteria, "conversation"));
    }
  }

  return {
    criteria,
    count: items.length,
    items,
    warnings
  };
}

export async function executeBulkAction(connection, criteria = {}, items = [], actor = {}) {
  const client = makeClient(connection);
  const results = [];
  const startedAt = new Date().toISOString();
  const action = criteria.action || "assign_agent";

  for (const item of items) {
    try {
      const result = await executeItem(client, criteria, item);
      results.push({ ...item, ok: true, result });
    } catch (error) {
      results.push({ ...item, ok: false, error: error.message });
    }
  }

  const succeeded = results.filter(item => item.ok).length;
  const failed = results.length - succeeded;
  const job = await saveJob({
    action,
    criteria: redactCriteria(criteria),
    actor,
    startedAt,
    finishedAt: new Date().toISOString(),
    total: results.length,
    succeeded,
    failed,
    results
  });

  await appendAudit({
    action: `bulk_${action}`,
    actor,
    summary: `${action} completed: ${succeeded}/${results.length} succeeded`,
    metadata: {
      jobId: job.id,
      total: results.length,
      succeeded,
      failed,
      criteria: redactCriteria(criteria)
    }
  });

  return job;
}

export async function buildPhoneAssignPreview(connection, criteria = {}) {
  const maxPhones = Math.max(1, Number(criteria.maxPhones || 100));
  const warnings = [];

  if (!criteria.targetAgentId) {
    throwValidationError("Choose the target agent before preview.");
  }

  const phoneEntries = await parsePhoneEntries(criteria);

  if (phoneEntries.length === 0) {
    throwValidationError("No phone numbers were found. Paste numbers or upload a CSV/XLSX file.");
  }

  if (phoneEntries.length > maxPhones) {
    warnings.push(`Only the first ${maxPhones} phone numbers were checked for safety.`);
  }

  const entriesToCheck = phoneEntries.slice(0, maxPhones);
  const client = makeClient(connection);
  const checked = await mapLimit(entriesToCheck, Number(criteria.lookupConcurrency || 4), entry => (
    buildPhonePreviewRows(client, entry, criteria)
  ));

  const items = [];
  const misses = [];
  for (const result of checked) {
    items.push(...result.items);
    misses.push(...result.misses);
    warnings.push(...result.warnings);
  }

  return {
    criteria: redactCriteria({ ...criteria, phoneCount: entriesToCheck.length }),
    phoneCount: entriesToCheck.length,
    totalPhoneCount: phoneEntries.length,
    matchedPhoneCount: new Set(items.map(item => item.normalizedPhone)).size,
    count: items.length,
    items,
    misses,
    warnings
  };
}

export async function parsePhoneAssignInput(criteria = {}) {
  const phoneEntries = await parsePhoneEntries(criteria);
  return {
    fileName: criteria.fileName || "",
    phoneCount: phoneEntries.length,
    sample: phoneEntries.slice(0, 20)
  };
}

export async function executePhoneAssign(connection, criteria = {}, items = [], actor = {}) {
  if (!criteria.targetAgentId) {
    throwValidationError("Choose the target agent before execution.");
  }

  const client = makeClient(connection);
  const results = [];
  const startedAt = new Date().toISOString();

  for (const item of items) {
    try {
      if (!item.conversationId) throw new Error("Missing conversation id");
      const result = await client.assignConversation(item.conversationId, {
        assignee_id: Number(criteria.targetAgentId)
      });
      results.push({ ...item, ok: true, result });
    } catch (error) {
      results.push({ ...item, ok: false, error: error.message });
    }
  }

  const succeeded = results.filter(item => item.ok).length;
  const failed = results.length - succeeded;
  const job = await saveJob({
    action: "phone_assign",
    criteria: redactCriteria(criteria),
    actor,
    startedAt,
    finishedAt: new Date().toISOString(),
    total: results.length,
    succeeded,
    failed,
    results
  });

  await appendAudit({
    action: "bulk_phone_assign",
    actor,
    summary: `phone_assign completed: ${succeeded}/${results.length} succeeded`,
    metadata: {
      jobId: job.id,
      total: results.length,
      succeeded,
      failed,
      criteria: redactCriteria(criteria)
    }
  });

  return job;
}

export async function getReportsSummary(connection, query = {}) {
  const client = makeClient(connection);
  const now = Math.floor(Date.now() / 1000);
  const since = query.since || now - 30 * 24 * 60 * 60;
  const until = query.until || now;

  const metrics = [
    "conversations_count",
    "incoming_messages_count",
    "outgoing_messages_count",
    "resolutions_count",
    "avg_first_response_time",
    "avg_resolution_time"
  ];

  const reportResults = await Promise.allSettled(
    metrics.map(metric => client.accountReport({ metric, type: "account", since, until }))
  );

  const reports = {};
  reportResults.forEach((result, index) => {
    reports[metrics[index]] = result.status === "fulfilled" ? result.value : { error: result.reason.message };
  });

  let conversationMetrics = null;
  try {
    conversationMetrics = await client.conversationMetrics({ type: "account" });
  } catch (error) {
    conversationMetrics = { error: error.message };
  }

  return { since, until, reports, conversationMetrics };
}

export async function getOpenConversationReport(connection, criteria = {}) {
  const client = makeClient(connection);
  const maxPages = Number(criteria.maxPages || process.env.CHATWOOT_MAX_PAGES || 20);
  const selectedInboxIds = normalizeIds(criteria.inboxIds);
  const selectedAgentIds = normalizeIds(criteria.agentIds);
  const unreadOnly = Boolean(criteria.unreadOnly);
  const includeReplyStatus = Boolean(criteria.includeReplyStatus || criteria.needsReplyOnly);
  const needsReplyOnly = Boolean(criteria.needsReplyOnly);
  const replyCheckLimit = Math.max(1, Math.min(Number(criteria.replyCheckLimit || 100), 1000));
  const warnings = [];

  const [agentsResult, inboxesResult] = await Promise.allSettled([
    client.listAgents(),
    client.listInboxes()
  ]);
  const agents = agentsResult.status === "fulfilled" ? normalizeRows(agentsResult.value) : [];
  const inboxes = inboxesResult.status === "fulfilled" ? getPayload(inboxesResult.value) : [];
  if (agentsResult.status === "rejected") warnings.push(`Could not load agents: ${agentsResult.reason.message}`);
  if (inboxesResult.status === "rejected") warnings.push(`Could not load inboxes: ${inboxesResult.reason.message}`);

  const inboxLookup = new Map(inboxes.map(inbox => [String(inbox.id), inbox]));
  const agentLookup = new Map(agents.map(agent => [String(agent.id), agent]));
  const inboxesToScan = selectedInboxIds.length ? selectedInboxIds : [""];
  const rows = [];
  for (const inboxId of inboxesToScan) {
    const conversations = await listConversationsByListEndpoint(client, {
      status: "open",
      inboxId,
      assigneeType: "all"
    }, maxPages);
    rows.push(...conversations);
  }

  const allConversations = dedupeBy(rows, item => item.id).map(conversation => {
    const item = conversationToPreviewItem(conversation, criteria, "open_report");
    const inbox = inboxLookup.get(String(item.inboxId));
    const agent = agentLookup.get(String(item.assigneeId));
    return {
      ...item,
      inboxName: item.inboxName || inbox?.name || "",
      assigneeName: item.assigneeName || agent?.name || ""
    };
  });
  let conversations = allConversations.filter(item => !unreadOnly || Number(item.unreadCount || 0) > 0);
  if (includeReplyStatus) {
    if (conversations.length > replyCheckLimit) {
      warnings.push(`Only the first ${replyCheckLimit} conversations were checked for sales replies. Increase the reply check limit to scan more.`);
    }

    const checkedConversations = await mapLimit(
      conversations.slice(0, replyCheckLimit),
      Number(criteria.replyLookupConcurrency || 4),
      item => attachSalesReplyStatus(client, item, warnings)
    );
    const skippedConversations = conversations.slice(replyCheckLimit).map(item => ({
      ...item,
      replyChecked: false,
      needsReply: false,
      replyStatus: "not_checked",
      lastCustomerMessageAt: "",
      lastSalesReplyAt: "",
      lastSalesReplyBy: "",
      lastMessageAt: "",
      lastMessageDirection: ""
    }));

    conversations = [...checkedConversations, ...skippedConversations];
    if (needsReplyOnly) conversations = conversations.filter(item => item.needsReply);
  }

  const inboxCounts = new Map();
  for (const item of conversations) {
    const key = String(item.inboxId || "unknown");
    const current = inboxCounts.get(key) || {
      inboxId: item.inboxId || "",
      inboxName: item.inboxName || inboxLookup.get(key)?.name || "Unknown inbox",
      openCount: 0,
      assignedCount: 0,
      unassignedCount: 0,
      unreadCount: 0,
      needsReplyCount: 0,
      repliedCount: 0,
      replyUnknownCount: 0
    };
    current.openCount += 1;
    if (item.assigneeId) current.assignedCount += 1;
    else current.unassignedCount += 1;
    if (Number(item.unreadCount || 0) > 0) current.unreadCount += 1;
    incrementReplyCounts(current, item);
    inboxCounts.set(key, current);
  }

  for (const inboxId of selectedInboxIds) {
    const key = String(inboxId);
    if (!inboxCounts.has(key)) {
      const inbox = inboxLookup.get(key);
      inboxCounts.set(key, {
        inboxId,
        inboxName: inbox?.name || `Inbox ${inboxId}`,
        openCount: 0,
        assignedCount: 0,
        unassignedCount: 0,
        unreadCount: 0,
        needsReplyCount: 0,
        repliedCount: 0,
        replyUnknownCount: 0
      });
    }
  }

  const agentCounts = new Map();
  for (const item of conversations) {
    if (!item.assigneeId) continue;
    const key = String(item.assigneeId);
    if (selectedAgentIds.length && !selectedAgentIds.includes(key)) continue;
    const agent = agentLookup.get(key);
    const current = agentCounts.get(key) || {
      agentId: item.assigneeId,
      agentName: item.assigneeName || agent?.name || `Agent ${item.assigneeId}`,
      openCount: 0,
      unreadCount: 0,
      needsReplyCount: 0,
      repliedCount: 0,
      replyUnknownCount: 0
    };
    current.openCount += 1;
    if (Number(item.unreadCount || 0) > 0) current.unreadCount += 1;
    incrementReplyCounts(current, item);
    agentCounts.set(key, current);
  }

  for (const agentId of selectedAgentIds) {
    if (!agentCounts.has(agentId)) {
      const agent = agentLookup.get(agentId);
      agentCounts.set(agentId, {
        agentId,
        agentName: agent?.name || `Agent ${agentId}`,
        openCount: 0,
        unreadCount: 0,
        needsReplyCount: 0,
        repliedCount: 0,
        replyUnknownCount: 0
      });
    }
  }

  const unassigned = conversations.filter(item => !item.assigneeId);
  const unread = conversations.filter(item => Number(item.unreadCount || 0) > 0);
  const assignedUnread = unread.filter(item => item.assigneeId);
  const unassignedUnread = unread.filter(item => !item.assigneeId);
  const needsReply = conversations.filter(item => item.needsReply);
  const selectedAgentNeedsReply = selectedAgentIds.length
    ? needsReply.filter(item => selectedAgentIds.includes(String(item.assigneeId)))
    : needsReply;
  const replied = conversations.filter(item => item.replyStatus === "replied");
  const replyUnknown = conversations.filter(item => item.replyStatus === "unknown" || item.replyStatus === "not_checked");

  return {
    generatedAt: new Date().toISOString(),
    criteria: {
      status: "open",
      inboxIds: selectedInboxIds,
      agentIds: selectedAgentIds,
      maxPages,
      unreadOnly,
      includeReplyStatus,
      needsReplyOnly,
      replyCheckLimit
    },
    totals: {
      openCount: conversations.length,
      assignedCount: conversations.length - unassigned.length,
      unassignedCount: unassigned.length,
      unreadCount: unread.length,
      assignedUnreadCount: assignedUnread.length,
      unassignedUnreadCount: unassignedUnread.length,
      needsReplyCount: needsReply.length,
      repliedCount: replied.length,
      replyUnknownCount: replyUnknown.length,
      inboxCount: inboxCounts.size,
      agentCount: agentCounts.size
    },
    inboxes: [...inboxCounts.values()].sort((a, b) => b.openCount - a.openCount || String(a.inboxName).localeCompare(String(b.inboxName))),
    agents: [...agentCounts.values()].sort((a, b) => b.openCount - a.openCount || String(a.agentName).localeCompare(String(b.agentName))),
    unassigned,
    unread,
    needsReply,
    selectedAgentNeedsReply,
    conversations,
    warnings
  };
}

export async function handleDepartmentRouterWebhook(payload = {}, options = {}) {
  const config = buildDepartmentRouterConfig(options);
  if (!config.enabled) return { ok: true, handled: false, skipped: true, reason: "department_router_disabled" };

  const eventName = String(payload.event || payload.name || "").toLowerCase();
  const message = getWebhookMessage(payload);
  const conversationId = getWebhookConversationId(payload, message) ||
    (eventName.startsWith("conversation_") ? payload?.id : null);
  if (!conversationId) {
    return { ok: false, handled: false, skipped: true, reason: "missing_conversation_id" };
  }

  return withDepartmentRouterLock(conversationId, async () => {
    const client = makeClient(options.connection || {});
    const conversation = await loadDepartmentConversation(client, payload, message, conversationId, eventName);
    const inboxId = getConversationInboxId(conversation);
    if (config.inboxIds.length && !config.inboxIds.includes(String(inboxId))) {
      return { ok: true, handled: false, skipped: true, reason: "department_inbox_not_enabled", conversationId, inboxId };
    }
    let localRoute = await config.stateStore.get(conversationId);

    if (config.skipCampaigns) {
      const alreadyBroadcast = String(localRoute?.state || "").toLowerCase() === "broadcast";
      const campaignId = getConversationCampaignMarker(conversation);
      if (alreadyBroadcast || campaignId) {
        if (!alreadyBroadcast) {
          localRoute = await config.stateStore.save(conversationId, {
            inboxId,
            state: "broadcast",
            campaignId: campaignId || null
          });
          await auditDepartmentRouter("department_router_broadcast_skipped", {
            conversationId,
            inboxId,
            campaignId: campaignId || null,
            event: eventName
          }, config.audit);
        }
        return {
          ok: true,
          handled: true,
          skipped: true,
          reason: "broadcast_conversation",
          conversationId,
          inboxId,
          campaignId: campaignId || localRoute?.campaignId || null
        };
      }
    }

    if (eventName.includes("conversation_status_changed")) {
      const status = getWebhookConversationStatus(payload, conversation);
      if (status !== "resolved" || !config.promptOnResolved) {
        return { ok: true, handled: false, skipped: true, reason: "department_status_ignored", conversationId, inboxId, status };
      }

      const customAttributes = await persistDepartmentState(client, conversation, config, {
        [DEPARTMENT_ATTRIBUTES.state]: "resolved",
        [DEPARTMENT_ATTRIBUTES.promptNext]: true
      });
      await auditDepartmentRouter("department_router_marked_for_reentry", {
        conversationId,
        inboxId,
        status,
        customAttributes
      }, config.audit);
      return {
        ok: true,
        handled: true,
        action: "marked_for_reentry",
        conversationId,
        inboxId,
        status
      };
    }

    if (eventName.includes("conversation_created")) {
      if (!config.promptOnNew) {
        return { ok: true, handled: false, skipped: true, reason: "new_prompt_disabled", conversationId, inboxId };
      }
      if (localRoute?.state || localRoute?.promptedAt) {
        return {
          ok: true,
          handled: true,
          skipped: true,
          reason: "conversation_already_seen",
          conversationId,
          inboxId
        };
      }
      return registerNewConversationForDepartmentPrompt(client, conversation, config);
    }

    if (!eventName.includes("message_created") || !isIncomingWebhookMessage(payload, message)) {
      return { ok: true, handled: false, skipped: true, reason: "department_event_ignored", conversationId, inboxId };
    }

    const content = String(message?.content || payload?.content || "");
    const customAttributes = getConversationCustomAttributes(conversation);
    const messageId = message?.id || payload?.message_id || null;
    if (messageId && String(localRoute?.lastIncomingMessageId || "") === String(messageId)) {
      return { ok: true, handled: true, skipped: true, reason: "duplicate_incoming_message", conversationId, inboxId };
    }
    if (messageId) {
      localRoute = await config.stateStore.save(conversationId, {
        inboxId,
        lastIncomingMessageId: String(messageId)
      });
    }

    const routeState = String(
      localRoute?.state ||
      customAttributes[DEPARTMENT_ATTRIBUTES.state] ||
      ""
    ).toLowerCase();
    const promptNext = parseBooleanOption(
      localRoute?.promptNext ?? customAttributes[DEPARTMENT_ATTRIBUTES.promptNext],
      undefined,
      false
    );

    if (isDepartmentChangeRequest(content)) {
      return promptForDepartment(client, conversation, config, { reason: "customer_requested_change", force: true });
    }

    if (promptNext && config.promptOnResolved) {
      return promptForDepartment(client, conversation, config, { reason: "resolved_conversation_reopened", force: true });
    }

    const selection = parseDepartmentSelection(content);
    if (routeState === "new_waiting_incoming") {
      return promptForDepartment(client, conversation, config, { reason: "first_incoming_message" });
    }

    if (routeState === "pending") {
      if (selection) {
        return routeConversationToDepartment(client, conversation, config, selection, "customer_selection");
      }

      return {
        ok: true,
        handled: true,
        action: "awaiting_department",
        conversationId,
        inboxId
      };
    }

    const knownDepartment = getKnownConversationDepartment(conversation, config, localRoute);
    if (knownDepartment) {
      return routeConversationToDepartment(client, conversation, config, knownDepartment, "existing_department");
    }

    if (!routeState && config.promptOnNew && config.newContactsOnly) {
      const registration = await registerNewConversationForDepartmentPrompt(client, conversation, config);
      if (registration.action === "new_conversation_registered") {
        return promptForDepartment(client, conversation, config, { reason: "first_incoming_message" });
      }
      return registration;
    }

    return {
      ok: true,
      handled: true,
      skipped: true,
      reason: "existing_department_unknown",
      conversationId,
      inboxId
    };
  });
}

function buildDepartmentRouterConfig(options = {}) {
  return {
    enabled: parseBooleanOption(options.enabled, process.env.DEPARTMENT_ROUTER_ENABLED, false),
    inboxIds: parseListOption(options.inboxIds, process.env.DEPARTMENT_ROUTER_INBOX_IDS, []).map(String),
    salesTeamId: String(options.salesTeamId ?? process.env.DEPARTMENT_ROUTER_SALES_TEAM_ID ?? ""),
    operationsTeamId: String(options.operationsTeamId ?? process.env.DEPARTMENT_ROUTER_OPERATIONS_TEAM_ID ?? ""),
    promptOnNew: parseBooleanOption(options.promptOnNew, process.env.DEPARTMENT_ROUTER_PROMPT_ON_NEW, true),
    promptOnResolved: parseBooleanOption(options.promptOnResolved, process.env.DEPARTMENT_ROUTER_PROMPT_ON_RESOLVED, false),
    newContactsOnly: parseBooleanOption(options.newContactsOnly, process.env.DEPARTMENT_ROUTER_NEW_CONTACTS_ONLY, true),
    skipCampaigns: parseBooleanOption(options.skipCampaigns, process.env.DEPARTMENT_ROUTER_SKIP_CAMPAIGNS, true),
    assignAgent: parseBooleanOption(options.assignAgent, process.env.DEPARTMENT_ROUTER_ASSIGN_AGENT, true),
    businessHours: buildBusinessHoursConfig(options),
    confirmSelection: parseBooleanOption(options.confirmSelection, process.env.DEPARTMENT_ROUTER_CONFIRM_SELECTION, true),
    promptText: String(options.promptText ?? process.env.DEPARTMENT_ROUTER_PROMPT_TEXT ??
      "أهلاً بك مع فريق Engosoft.\nللتواصل مع فريق المبيعات اكتب 1.\nللتواصل مع فريق العمليات اكتب 2."),
    salesConfirmationText: String(options.salesConfirmationText ?? process.env.DEPARTMENT_ROUTER_SALES_CONFIRMATION_TEXT ??
      "تم تحويل محادثتك إلى فريق المبيعات، وسيتم الرد عليك في أقرب وقت."),
    operationsConfirmationText: String(options.operationsConfirmationText ?? process.env.DEPARTMENT_ROUTER_OPERATIONS_CONFIRMATION_TEXT ??
      "تم تحويل محادثتك إلى فريق العمليات، وسيتم الرد عليك في أقرب وقت."),
    stateStore: options.stateStore || {
      get: getDepartmentRoute,
      save: saveDepartmentRoute
    },
    audit: options.audit !== false
  };
}

const WEEKDAY_INDEX = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

function buildBusinessHoursConfig(options = {}) {
  if (options.businessHours) return options.businessHours;

  const enabled = parseBooleanOption(
    options.businessHoursEnabled,
    process.env.DEPARTMENT_ROUTER_BUSINESS_HOURS_ENABLED,
    false
  );
  if (!enabled) return { enabled: false };

  return {
    enabled: true,
    timezone: String(options.businessTimezone ?? process.env.DEPARTMENT_ROUTER_BUSINESS_TIMEZONE ?? "Africa/Cairo"),
    startMinutes: parseClockMinutes(options.businessStart ?? process.env.DEPARTMENT_ROUTER_BUSINESS_START, 9 * 60),
    endMinutes: parseClockMinutes(options.businessEnd ?? process.env.DEPARTMENT_ROUTER_BUSINESS_END, 22 * 60),
    days: new Set(
      parseListOption(options.businessDays, process.env.DEPARTMENT_ROUTER_BUSINESS_DAYS, ["0", "1", "2", "3", "4", "5", "6"])
        .map(value => Number(value))
        .filter(value => Number.isInteger(value) && value >= 0 && value <= 6)
    )
  };
}

function parseClockMinutes(value, fallback) {
  if (value == null || value === "") return fallback;
  const match = String(value).trim().match(/^(\d{1,2}):?(\d{2})?$/);
  if (!match) return fallback;
  const hours = Number(match[1]);
  const minutes = Number(match[2] || 0);
  if (hours > 23 || minutes > 59) return fallback;
  return hours * 60 + minutes;
}

// Returns true when "now" falls inside the configured business hours for the
// configured timezone. When business hours are disabled it returns true so the
// router keeps its default (assign-an-online-agent) behavior.
export function isWithinBusinessHours(businessHours, now) {
  if (!businessHours?.enabled) return true;

  const date = now || (typeof businessHours.now === "function" ? businessHours.now() : new Date());
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: businessHours.timezone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);

  const lookup = Object.fromEntries(parts.map(part => [part.type, part.value]));
  const dayIndex = WEEKDAY_INDEX[String(lookup.weekday || "").toLowerCase()];
  if (dayIndex == null || !businessHours.days.has(dayIndex)) return false;

  const minutesOfDay = Number(lookup.hour) * 60 + Number(lookup.minute);
  const { startMinutes, endMinutes } = businessHours;
  if (startMinutes === endMinutes) return false;
  if (startMinutes < endMinutes) return minutesOfDay >= startMinutes && minutesOfDay < endMinutes;
  return minutesOfDay >= startMinutes || minutesOfDay < endMinutes;
}

async function loadDepartmentConversation(client, payload, message, conversationId, eventName) {
  try {
    const response = await client.conversationDetails(conversationId);
    return unwrapConversationResponse(response) || {};
  } catch (error) {
    const conversation = getWebhookConversation(payload, message) ||
      (eventName.startsWith("conversation_") ? payload : null);
    if (conversation) return conversation;
    throw error;
  }
}

async function registerNewConversationForDepartmentPrompt(client, conversation, config) {
  const conversationId = conversation.id;
  const inboxId = getConversationInboxId(conversation);
  const history = await inspectContactConversationHistory(client, conversation);

  if (!history.canVerify) {
    await config.stateStore.save(conversationId, {
      inboxId,
      state: "history_unverified",
      contactId: history.contactId || null
    });
    return {
      ok: true,
      handled: true,
      skipped: true,
      reason: history.reason,
      conversationId,
      inboxId
    };
  }

  if (config.newContactsOnly && history.previousConversationCount > 0) {
    await config.stateStore.save(conversationId, {
      inboxId,
      state: "existing_contact",
      contactId: history.contactId,
      previousConversationCount: history.previousConversationCount
    });
    return {
      ok: true,
      handled: true,
      skipped: true,
      reason: "existing_contact_has_history",
      conversationId,
      inboxId,
      previousConversationCount: history.previousConversationCount
    };
  }

  await config.stateStore.save(conversationId, {
    inboxId,
    state: "new_waiting_incoming",
    contactId: history.contactId,
    previousConversationCount: history.previousConversationCount
  });
  return {
    ok: true,
    handled: true,
    action: "new_conversation_registered",
    conversationId,
    inboxId,
    previousConversationCount: history.previousConversationCount
  };
}

async function inspectContactConversationHistory(client, conversation) {
  const contactId = getConversationContactId(conversation);
  if (!contactId) {
    return { canVerify: false, reason: "contact_id_unavailable", contactId: null, previousConversationCount: 0 };
  }

  try {
    const response = await client.contactConversations(contactId);
    const previousConversations = getPayload(response).filter(item => String(item.id) !== String(conversation.id));
    return {
      canVerify: true,
      reason: "",
      contactId,
      previousConversationCount: previousConversations.length
    };
  } catch (error) {
    return {
      canVerify: false,
      reason: "contact_history_unavailable",
      contactId,
      previousConversationCount: 0,
      error: error.message
    };
  }
}

function getConversationContactId(conversation) {
  return conversation?.contact_id ||
    conversation?.contact?.id ||
    conversation?.meta?.sender?.id ||
    conversation?.sender?.id ||
    null;
}

function getConversationCampaignId(conversation) {
  if (!conversation) return null;
  const additional = conversation.additional_attributes || conversation.additionalAttributes || {};
  const meta = conversation.meta || {};
  return conversation.campaign_id ||
    conversation.campaignId ||
    conversation.campaign?.id ||
    additional.campaign_id ||
    additional.campaignId ||
    meta.campaign?.id ||
    meta.campaign_id ||
    null;
}

// Detects conversations opened or touched by a broadcast/campaign. Covers both
// Chatwoot native campaigns (campaign_id) and the external campaign uploader,
// which marks conversations with custom attributes instead of a campaign id.
function getConversationCampaignMarker(conversation) {
  const nativeId = getConversationCampaignId(conversation);
  if (nativeId) return String(nativeId);

  const customAttributes = getConversationCustomAttributes(conversation);
  if (customAttributes.api_campaign_label) return String(customAttributes.api_campaign_label);
  if (customAttributes.last_api_campaign_label) return String(customAttributes.last_api_campaign_label);
  const sentKey = Object.keys(customAttributes).find(key => key.startsWith("api_sent_"));
  if (sentKey) return sentKey;
  return null;
}

async function promptForDepartment(client, conversation, config, { reason, force = false } = {}) {
  const conversationId = conversation.id;
  const inboxId = getConversationInboxId(conversation);
  const customAttributes = getConversationCustomAttributes(conversation);
  const localRoute = await config.stateStore.get(conversationId);
  const routeState = String(
    localRoute?.state ||
    customAttributes[DEPARTMENT_ATTRIBUTES.state] ||
    ""
  ).toLowerCase();

  if (!force && routeState === "pending") {
    return {
      ok: true,
      handled: true,
      action: "prompt_already_sent",
      conversationId,
      inboxId,
      reason
    };
  }

  if (getConversationAssigneeId(conversation)) {
    await client.assignConversation(conversationId, { assignee_id: null });
  }

  const message = await client.createMessage(conversationId, {
    content: config.promptText,
    message_type: "outgoing",
    private: false,
    content_type: "text",
    content_attributes: {}
  });
  const updatedAttributes = await persistDepartmentState(client, conversation, config, {
    [DEPARTMENT_ATTRIBUTES.state]: "pending",
    [DEPARTMENT_ATTRIBUTES.promptNext]: false,
    [DEPARTMENT_ATTRIBUTES.promptedAt]: new Date().toISOString()
  });
  await auditDepartmentRouter("department_router_prompted", {
    conversationId,
    inboxId,
    reason,
    updatedAttributes
  }, config.audit);
  return {
    ok: true,
    handled: true,
    action: "department_prompt_sent",
    conversationId,
    inboxId,
    reason,
    messageId: message?.id || null
  };
}

async function routeConversationToDepartment(client, conversation, config, department, reason) {
  const conversationId = conversation.id;
  const inboxId = getConversationInboxId(conversation);
  const teamId = department === "sales" ? config.salesTeamId : config.operationsTeamId;
  if (!teamId) {
    throw new Error(`Missing ${department} team id for department router.`);
  }

  const localRoute = await config.stateStore.get(conversationId);
  const currentAssigneeId = getConversationAssigneeId(conversation);
  const autoAssignedAgentId = localRoute?.autoAssignedAgentId != null ? String(localRoute.autoAssignedAgentId) : null;

  // Respect manual assignments. A human moved this conversation if it currently
  // has an assignee that the router did not assign itself. Once locked, the
  // router never reassigns it again, even when that agent is offline.
  const manuallyLocked = localRoute?.manualAssignment === true ||
    (Boolean(currentAssigneeId) && String(currentAssigneeId) !== (autoAssignedAgentId || ""));

  if (manuallyLocked) {
    const updatedAttributes = await persistDepartmentState(client, conversation, config, {
      [DEPARTMENT_ATTRIBUTES.department]: department,
      [DEPARTMENT_ATTRIBUTES.state]: "routed",
      [DEPARTMENT_ATTRIBUTES.teamId]: Number(teamId),
      [DEPARTMENT_ATTRIBUTES.promptNext]: false,
      [DEPARTMENT_ATTRIBUTES.routedAt]: new Date().toISOString()
    });
    await config.stateStore.save(conversationId, { manualAssignment: true });
    const details = {
      conversationId,
      inboxId,
      department,
      teamId: Number(teamId),
      fromAgentId: currentAssigneeId || null,
      toAgentId: currentAssigneeId || null,
      toAgentName: getAgentName(getConversationAssignee(conversation)),
      reason,
      manual: true,
      updatedAttributes
    };
    await auditDepartmentRouter("department_router_kept_manual_assignment", details, config.audit);
    return { ok: true, handled: true, action: "kept_manual_assignment", ...details };
  }

  // Decide whether to assign a specific agent. When business hours are enabled,
  // assign an online agent inside business hours and fall back to team-only
  // (Unassigned) outside business hours. Otherwise use the static flag.
  const assignAgentNow = config.businessHours?.enabled
    ? isWithinBusinessHours(config.businessHours)
    : config.assignAgent;

  // Team-only mode: route to the correct team and leave the conversation
  // Unassigned so the team's agents pick it up themselves. Never auto-assign a
  // specific agent. The Chatwoot assignments endpoint ignores team_id when
  // assignee_id is present, so the team and the unassign are two separate calls.
  if (!assignAgentNow) {
    const assignmentResult = await client.assignConversation(conversationId, { team_id: Number(teamId) });
    if (currentAssigneeId) {
      await client.assignConversation(conversationId, { assignee_id: null });
    }
    const updatedAttributes = await persistDepartmentState(client, conversation, config, {
      [DEPARTMENT_ATTRIBUTES.department]: department,
      [DEPARTMENT_ATTRIBUTES.state]: "routed",
      [DEPARTMENT_ATTRIBUTES.teamId]: Number(teamId),
      [DEPARTMENT_ATTRIBUTES.promptNext]: false,
      [DEPARTMENT_ATTRIBUTES.routedAt]: new Date().toISOString()
    });
    await config.stateStore.save(conversationId, { autoAssignedAgentId: null, manualAssignment: false });

    if (config.confirmSelection && reason === "customer_selection") {
      await client.createMessage(conversationId, {
        content: department === "sales" ? config.salesConfirmationText : config.operationsConfirmationText,
        message_type: "outgoing",
        private: false,
        content_type: "text",
        content_attributes: {}
      });
    }

    const details = {
      conversationId,
      inboxId,
      department,
      teamId: Number(teamId),
      fromAgentId: currentAssigneeId || null,
      toAgentId: null,
      toAgentName: "",
      reason,
      updatedAttributes
    };
    await auditDepartmentRouter("department_router_department_team_unassigned", details, config.audit);
    return { ok: true, handled: true, action: "department_team_unassigned", ...details, result: assignmentResult };
  }

  const [teamAgentsResponse, inboxAgentsResponse] = await Promise.all([
    client.listTeamAgents(teamId),
    client.listInboxAgents(inboxId)
  ]);
  const teamAgents = normalizeRows(teamAgentsResponse);
  const inboxAgentIds = new Set(normalizeRows(inboxAgentsResponse).map(agent => String(getAgentId(agent))));
  const eligibleAgents = teamAgents.filter(agent => inboxAgentIds.has(String(getAgentId(agent))));
  const currentAgent = eligibleAgents.find(agent => String(getAgentId(agent)) === String(currentAssigneeId));
  const currentIsEligibleOnline = Boolean(currentAgent && getAgentAvailability(currentAgent) === "online");

  let action = "kept_current_agent";
  let targetAgent = currentAgent || null;
  let assignmentResult = null;

  if (!currentIsEligibleOnline) {
    const onlineAgents = orderReopenRouterCandidates(
      eligibleAgents.filter(agent => getAgentAvailability(agent) === "online"),
      conversationId
    );
    targetAgent = onlineAgents.find(agent => String(getAgentId(agent)) !== String(currentAssigneeId)) || onlineAgents[0] || null;
    const assignmentPayload = {
      team_id: Number(teamId),
      assignee_id: targetAgent ? Number(getAgentId(targetAgent)) : null
    };
    assignmentResult = await client.assignConversation(conversationId, assignmentPayload);
    action = targetAgent ? "department_assigned" : "department_team_queue";
  }

  const updatedAttributes = await persistDepartmentState(client, conversation, config, {
    [DEPARTMENT_ATTRIBUTES.department]: department,
    [DEPARTMENT_ATTRIBUTES.state]: "routed",
    [DEPARTMENT_ATTRIBUTES.teamId]: Number(teamId),
    [DEPARTMENT_ATTRIBUTES.promptNext]: false,
    [DEPARTMENT_ATTRIBUTES.routedAt]: new Date().toISOString()
  });
  await config.stateStore.save(conversationId, {
    autoAssignedAgentId: targetAgent ? String(getAgentId(targetAgent)) : null,
    manualAssignment: false
  });

  if (config.confirmSelection && reason === "customer_selection") {
    await client.createMessage(conversationId, {
      content: department === "sales" ? config.salesConfirmationText : config.operationsConfirmationText,
      message_type: "outgoing",
      private: false,
      content_type: "text",
      content_attributes: {}
    });
  }

  const details = {
    conversationId,
    inboxId,
    department,
    teamId: Number(teamId),
    fromAgentId: currentAssigneeId || null,
    toAgentId: targetAgent ? Number(getAgentId(targetAgent)) : null,
    toAgentName: getAgentName(targetAgent),
    reason,
    eligibleAgentCount: eligibleAgents.length,
    updatedAttributes
  };
  await auditDepartmentRouter(`department_router_${action}`, details, config.audit);
  return {
    ok: true,
    handled: true,
    action,
    ...details,
    result: assignmentResult
  };
}

async function updateDepartmentAttributes(client, conversation, changes) {
  const merged = {
    ...getConversationCustomAttributes(conversation),
    ...changes
  };
  const response = await client.updateConversationCustomAttributes(conversation.id, merged);
  conversation.custom_attributes = response?.custom_attributes || merged;
  return conversation.custom_attributes;
}

async function persistDepartmentState(client, conversation, config, changes) {
  const localChanges = departmentAttributeChangesToLocalState(changes);
  const localRoute = await config.stateStore.save(conversation.id, {
    inboxId: getConversationInboxId(conversation),
    ...localChanges
  });

  try {
    await updateDepartmentAttributes(client, conversation, changes);
  } catch (error) {
    await auditDepartmentRouter("department_router_custom_attributes_failed", {
      conversationId: conversation.id,
      inboxId: getConversationInboxId(conversation),
      error: error.message
    }, config.audit);
  }

  return {
    ...getConversationCustomAttributes(conversation),
    ...changes,
    _localRoute: localRoute
  };
}

function departmentAttributeChangesToLocalState(changes) {
  const local = {};
  if (DEPARTMENT_ATTRIBUTES.department in changes) local.department = changes[DEPARTMENT_ATTRIBUTES.department];
  if (DEPARTMENT_ATTRIBUTES.state in changes) local.state = changes[DEPARTMENT_ATTRIBUTES.state];
  if (DEPARTMENT_ATTRIBUTES.teamId in changes) local.teamId = changes[DEPARTMENT_ATTRIBUTES.teamId];
  if (DEPARTMENT_ATTRIBUTES.promptNext in changes) local.promptNext = changes[DEPARTMENT_ATTRIBUTES.promptNext];
  if (DEPARTMENT_ATTRIBUTES.promptedAt in changes) local.promptedAt = changes[DEPARTMENT_ATTRIBUTES.promptedAt];
  if (DEPARTMENT_ATTRIBUTES.routedAt in changes) local.routedAt = changes[DEPARTMENT_ATTRIBUTES.routedAt];
  return local;
}

function getConversationCustomAttributes(conversation) {
  return conversation?.custom_attributes || conversation?.customAttributes || {};
}

function getConversationTeamId(conversation) {
  return conversation?.team_id || conversation?.team?.id || conversation?.meta?.team?.id || null;
}

function getWebhookConversationStatus(payload, conversation) {
  return String(payload?.status || payload?.conversation?.status || conversation?.status || "").toLowerCase();
}

function getKnownConversationDepartment(conversation, config, localRoute = null) {
  const customAttributes = getConversationCustomAttributes(conversation);
  const saved = String(
    localRoute?.department ||
    customAttributes[DEPARTMENT_ATTRIBUTES.department] ||
    ""
  ).toLowerCase();
  if (saved === "sales" || saved === "operations") return saved;

  const teamId = String(
    localRoute?.teamId ||
    customAttributes[DEPARTMENT_ATTRIBUTES.teamId] ||
    getConversationTeamId(conversation) ||
    ""
  );
  if (teamId && teamId === config.salesTeamId) return "sales";
  if (teamId && teamId === config.operationsTeamId) return "operations";
  return null;
}

export function parseDepartmentSelection(content) {
  const normalized = normalizeDepartmentText(content);
  if (["1", "01"].includes(normalized)) return "sales";
  if (["2", "02"].includes(normalized)) return "operations";

  if (["sales", "sale", "sales team", "مبيعات", "المبيعات", "سيلز", "ريسيل", "ري سيل"].includes(normalized)) {
    return "sales";
  }
  if (["operations", "operation", "ops", "operations team", "عمليات", "العمليات", "اوبريشن", "أوبريشن", "تشغيل"].includes(normalized)) {
    return "operations";
  }
  return null;
}

function isDepartmentChangeRequest(content) {
  const normalized = normalizeDepartmentText(content);
  return [
    "تغيير القسم",
    "غير القسم",
    "غيّر القسم",
    "القائمة",
    "اختيار القسم",
    "change department",
    "change team",
    "menu"
  ].includes(normalized);
}

function normalizeDepartmentText(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[٠-٩]/g, digit => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
    .replace(/[۰-۹]/g, digit => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)))
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function auditDepartmentRouter(action, details, enabled = true) {
  if (!enabled) return;
  await appendAudit({
    action,
    actor: { name: "Department Router", type: "automation" },
    summary: `Department router ${action} for conversation ${details.conversationId}`,
    metadata: details
  });
}

async function withDepartmentRouterLock(conversationId, worker) {
  const key = String(conversationId);
  const previous = departmentRouterLocks.get(key) || Promise.resolve();
  const current = previous.catch(() => {}).then(worker);
  departmentRouterLocks.set(key, current);
  try {
    return await current;
  } finally {
    if (departmentRouterLocks.get(key) === current) departmentRouterLocks.delete(key);
  }
}

export async function handleReopenRouterWebhook(payload = {}, options = {}) {
  const config = buildReopenRouterConfig(options);
  if (!config.enabled) return { ok: true, skipped: true, reason: "disabled" };

  const eventName = String(payload.event || payload.name || "").toLowerCase();
  if (eventName && !eventName.includes("message_created")) {
    return { ok: true, skipped: true, reason: "unsupported_event", event: payload.event || payload.name || "" };
  }

  const message = getWebhookMessage(payload);
  if (!isIncomingWebhookMessage(payload, message)) {
    return { ok: true, skipped: true, reason: "not_incoming_message", event: payload.event || payload.name || "" };
  }

  const conversationId = getWebhookConversationId(payload, message);
  if (!conversationId) return { ok: false, skipped: true, reason: "missing_conversation_id" };

  if (isReopenRouterCooling(conversationId, config.cooldownSeconds)) {
    return { ok: true, skipped: true, reason: "cooldown", conversationId };
  }

  const client = makeClient(options.connection || {});
  const conversation = await loadWebhookConversation(client, payload, message, conversationId);
  const inboxId = getConversationInboxId(conversation) || getConversationInboxId(getWebhookConversation(payload, message));
  if (config.inboxIds.length && !config.inboxIds.includes(String(inboxId))) {
    return { ok: true, skipped: true, reason: "inbox_not_enabled", conversationId, inboxId };
  }

  if (config.skipCampaigns) {
    const campaignId = getConversationCampaignMarker(conversation) ||
      getConversationCampaignMarker(getWebhookConversation(payload, message));
    if (campaignId) {
      return { ok: true, skipped: true, reason: "broadcast_conversation", conversationId, inboxId, campaignId };
    }
  }

  const assignee = getConversationAssignee(conversation);
  const assigneeId = getConversationAssigneeId(conversation);
  if (!assigneeId && !config.assignUnassigned) {
    return { ok: true, skipped: true, reason: "conversation_unassigned", conversationId, inboxId };
  }

  const agents = normalizeRows(await client.listAgents());
  const targetAgents = await loadReopenRouterTargetAgents(client, config, agents, inboxId);
  const agentLookup = new Map(agents.map(agent => [String(getAgentId(agent)), agent]));
  const targetAgentLookup = new Map(targetAgents.map(agent => [String(getAgentId(agent)), agent]));
  const currentAgentFromList = assigneeId ? agentLookup.get(String(assigneeId)) : null;
  const currentAgent = currentAgentFromList || assignee;
  const currentStatus = assigneeId ? getAgentAvailability(currentAgent, currentAgentFromList ? "unknown" : "missing") : "unassigned";
  const currentOutsideTargetTeam = Boolean(config.teamId && assigneeId && !targetAgentLookup.has(String(assigneeId)));

  if (assigneeId && !currentOutsideTargetTeam && !config.unavailableStatuses.includes(currentStatus)) {
    return {
      ok: true,
      skipped: true,
      reason: currentStatus === "online" ? "assignee_online" : "assignee_status_not_configured",
      conversationId,
      inboxId,
      assigneeId,
      assigneeName: getAgentName(currentAgent),
      assigneeStatus: currentStatus,
      targetTeamId: config.teamId || null
    };
  }

  const candidates = orderReopenRouterCandidates(targetAgents.filter(agent => {
    const agentId = getAgentId(agent);
    if (!agentId) return false;
    if (assigneeId && Number(agentId) === Number(assigneeId)) return false;
    if (config.agentIds.length && !config.agentIds.includes(String(agentId))) return false;
    if (getAgentAvailability(agent) !== "online") return false;
    return agentMatchesInbox(agent, inboxId);
  }), conversationId);

  const attempts = [];
  for (const candidate of candidates) {
    const targetAgentId = Number(getAgentId(candidate));
    try {
      const response = await client.assignConversation(conversationId, buildReopenRouterAssignmentPayload(targetAgentId, config));
      markReopenRouterCooldown(conversationId, config.cooldownSeconds);
      await auditReopenRouter("reopen_router_reassigned", {
        conversationId,
        inboxId,
        fromAgentId: assigneeId || null,
        fromAgentName: getAgentName(currentAgent),
        fromAgentStatus: currentStatus,
        fromOutsideTargetTeam: currentOutsideTargetTeam,
        targetTeamId: config.teamId || null,
        toAgentId: targetAgentId,
        toAgentName: getAgentName(candidate)
      }, config.audit);
      return {
        ok: true,
        action: "assigned",
        conversationId,
        inboxId,
        fromAgentId: assigneeId || null,
        fromAgentName: getAgentName(currentAgent),
        fromAgentStatus: currentStatus,
        fromOutsideTargetTeam: currentOutsideTargetTeam,
        targetTeamId: config.teamId || null,
        toAgentId: targetAgentId,
        toAgentName: getAgentName(candidate),
        result: response
      };
    } catch (error) {
      attempts.push({
        agentId: targetAgentId,
        agentName: getAgentName(candidate),
        error: error.message
      });
    }
  }

  return applyReopenRouterFallback(client, config, {
    conversationId,
    inboxId,
    assigneeId: assigneeId || null,
    assigneeName: getAgentName(currentAgent),
    assigneeStatus: currentStatus,
    fromOutsideTargetTeam: currentOutsideTargetTeam,
    targetTeamId: config.teamId || null,
    attempts,
    reason: candidates.length ? "assignment_failed" : noCandidateReason(config, targetAgents, inboxId)
  });
}

function buildReopenRouterConfig(options = {}) {
  return {
    enabled: parseBooleanOption(options.enabled, process.env.REOPEN_ROUTER_ENABLED, false),
    unavailableStatuses: parseListOption(
      options.unavailableStatuses ?? options.statuses,
      process.env.REOPEN_ROUTER_STATUSES,
      REOPEN_ROUTER_DEFAULT_UNAVAILABLE
    ).map(value => String(value).toLowerCase()),
    fallback: String(
      options.fallback ?? process.env.REOPEN_ROUTER_FALLBACK ?? REOPEN_ROUTER_DEFAULT_FALLBACK
    ).toLowerCase(),
    cooldownSeconds: Math.max(0, Number(
      options.cooldownSeconds ?? process.env.REOPEN_ROUTER_COOLDOWN_SECONDS ?? 60
    ) || 0),
    inboxIds: parseListOption(options.inboxIds, process.env.REOPEN_ROUTER_INBOX_IDS, []).map(String),
    agentIds: parseListOption(options.agentIds, process.env.REOPEN_ROUTER_AGENT_IDS, []).map(String),
    teamId: options.teamId ?? process.env.REOPEN_ROUTER_TEAM_ID ?? "",
    assignUnassigned: parseBooleanOption(
      options.assignUnassigned,
      process.env.REOPEN_ROUTER_ASSIGN_UNASSIGNED,
      true
    ),
    skipCampaigns: parseBooleanOption(options.skipCampaigns, process.env.REOPEN_ROUTER_SKIP_CAMPAIGNS, true),
    audit: options.audit !== false
  };
}

async function loadReopenRouterTargetAgents(client, config, fallbackAgents, inboxId) {
  let agents = config.teamId ? normalizeRows(await client.listTeamAgents(config.teamId)) : fallbackAgents;
  if (!inboxId) return agents;

  const inboxAgents = normalizeRows(await client.listInboxAgents(inboxId));
  const inboxAgentIds = new Set(inboxAgents.map(agent => String(getAgentId(agent))));
  return agents.filter(agent => inboxAgentIds.has(String(getAgentId(agent))));
}

function buildReopenRouterAssignmentPayload(targetAgentId, config) {
  const payload = { assignee_id: targetAgentId };
  if (config.teamId) payload.team_id = Number(config.teamId);
  return payload;
}

function noCandidateReason(config, targetAgents, inboxId) {
  if (config.teamId && inboxId && targetAgents.length === 0) return "no_team_inbox_members";
  if (inboxId && targetAgents.length === 0) return "no_inbox_members";
  if (config.teamId && targetAgents.length === 0) return "no_team_members";
  if (config.teamId) return "no_online_team_candidates";
  return "no_online_candidates";
}

async function loadWebhookConversation(client, payload, message, conversationId) {
  const conversation = getWebhookConversation(payload, message);
  if (conversation && getConversationAssigneeId(conversation) && getConversationInboxId(conversation)) {
    return conversation;
  }

  try {
    const response = await client.conversationDetails(conversationId);
    return unwrapConversationResponse(response) || conversation || {};
  } catch (error) {
    if (conversation) return conversation;
    throw error;
  }
}

function unwrapConversationResponse(response) {
  if (!response) return null;
  if (response.payload && !Array.isArray(response.payload)) return response.payload;
  if (response.data?.payload && !Array.isArray(response.data.payload)) return response.data.payload;
  return response;
}

function getWebhookMessage(payload) {
  if (payload?.message && typeof payload.message === "object") return payload.message;
  if (payload && ("message_type" in payload || "messageType" in payload || "sender_type" in payload || "content" in payload)) {
    return payload;
  }
  return null;
}

function getWebhookConversation(payload, message) {
  return payload?.conversation || message?.conversation || payload?.conversation_payload || null;
}

function getWebhookConversationId(payload, message) {
  const conversation = getWebhookConversation(payload, message);
  return conversation?.id || payload?.conversation_id || payload?.conversationId || message?.conversation_id || message?.conversationId || null;
}

function isIncomingWebhookMessage(payload, message) {
  const eventName = String(payload?.event || payload?.name || "").toLowerCase();
  if (eventName && !eventName.includes("message_created")) return false;
  if (!message) return false;
  if (!isPublicMessage(message)) return false;
  return isCustomerMessage(message);
}

function getConversationAssignee(conversation) {
  return conversation?.meta?.assignee || conversation?.assignee || conversation?.assigned_agent || conversation?.assignedAgent || null;
}

function getConversationAssigneeId(conversation) {
  const assignee = getConversationAssignee(conversation);
  return assignee?.id || conversation?.assignee_id || conversation?.assigneeId || null;
}

function getAgentId(agent) {
  return agent?.id || agent?.agent_id || agent?.agentId || agent?.user_id || agent?.userId || agent?.user?.id || null;
}

function getAgentName(agent) {
  return agent?.name || agent?.available_name || agent?.display_name || agent?.user?.name || agent?.email || "";
}

function getAgentAvailability(agent, missingFallback = "unknown") {
  if (!agent) return missingFallback;
  const value = agent.availability_status ?? agent.availabilityStatus ?? agent.availability ?? agent.status;
  return value ? String(value).toLowerCase() : missingFallback;
}

function agentMatchesInbox(agent, inboxId) {
  if (!inboxId) return true;

  const inboxIds = [
    ...asArray(agent?.inbox_ids),
    ...asArray(agent?.inboxIds),
    ...asArray(agent?.inboxes).map(item => item?.id ?? item?.inbox_id ?? item),
    ...asArray(agent?.inbox_members).map(item => item?.inbox_id ?? item?.inboxId ?? item?.id ?? item)
  ].filter(value => value !== undefined && value !== null && value !== "").map(String);

  return inboxIds.length === 0 || inboxIds.includes(String(inboxId));
}

function orderReopenRouterCandidates(candidates, conversationId) {
  const ordered = [...candidates].sort((left, right) => Number(getAgentId(left)) - Number(getAgentId(right)));
  if (ordered.length <= 1) return ordered;
  const start = Number(conversationId) % ordered.length;
  return [...ordered.slice(start), ...ordered.slice(0, start)];
}

async function applyReopenRouterFallback(client, config, details) {
  markReopenRouterCooldown(details.conversationId, config.cooldownSeconds);

  if (config.fallback === "team" && config.teamId) {
    const response = await client.assignConversation(details.conversationId, { team_id: Number(config.teamId) });
    await auditReopenRouter("reopen_router_moved_to_team", {
      ...details,
      teamId: Number(config.teamId)
    }, config.audit);
    return {
      ok: true,
      action: "moved_to_team",
      ...details,
      teamId: Number(config.teamId),
      result: response
    };
  }

  if (config.fallback === "unassign") {
    if (!details.assigneeId) {
      await auditReopenRouter("reopen_router_left_unassigned", details, config.audit);
      return {
        ok: true,
        action: "left_unassigned",
        ...details
      };
    }

    const response = await client.assignConversation(details.conversationId, { assignee_id: null });
    await auditReopenRouter("reopen_router_unassigned", details, config.audit);
    return {
      ok: true,
      action: "unassigned",
      ...details,
      result: response
    };
  }

  await auditReopenRouter("reopen_router_no_target", details, config.audit);
  return {
    ok: true,
    action: "no_target",
    ...details
  };
}

async function auditReopenRouter(action, details, enabled = true) {
  if (!enabled) return;

  const summary = action === "reopen_router_reassigned"
    ? `Reopen router moved conversation ${details.conversationId} from ${details.fromAgentName || details.fromAgentId || "unassigned"} to ${details.toAgentName || details.toAgentId}`
    : `Reopen router handled conversation ${details.conversationId}: ${details.reason || action}`;

  await appendAudit({
    action,
    actor: { name: "Reopen Router", type: "automation" },
    summary,
    metadata: details
  });
}

function isReopenRouterCooling(conversationId, cooldownSeconds) {
  if (!cooldownSeconds) return false;
  const key = String(conversationId);
  const until = reopenRouterCooldowns.get(key);
  if (!until) return false;
  if (Date.now() < until) return true;
  reopenRouterCooldowns.delete(key);
  return false;
}

function markReopenRouterCooldown(conversationId, cooldownSeconds) {
  if (!cooldownSeconds) return;
  reopenRouterCooldowns.set(String(conversationId), Date.now() + cooldownSeconds * 1000);
}

function parseBooleanOption(optionValue, envValue, fallback) {
  const value = optionValue !== undefined ? optionValue : envValue;
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  return ["1", "true", "yes", "on", "enabled"].includes(String(value).trim().toLowerCase());
}

function parseListOption(optionValue, envValue, fallback) {
  const value = optionValue !== undefined ? optionValue : envValue;
  if (value === undefined || value === null || value === "") return fallback;
  return asArray(value)
    .flatMap(item => String(item).split(/[,\s]+/))
    .map(item => item.trim())
    .filter(Boolean);
}

function asArray(value) {
  return Array.isArray(value) ? value : [value];
}

async function buildPhonePreviewRows(client, entry, criteria) {
  const warnings = [];
  const misses = [];
  const items = [];

  try {
    const contacts = await searchContactsByPhone(client, entry.normalizedPhone);
    if (contacts.length === 0) {
      misses.push(phoneMiss(entry, "Contact not found"));
      return { items, misses, warnings };
    }

    const match = chooseContactByPhone(contacts, entry.normalizedPhone);
    if (!match) {
      misses.push(phoneMiss(entry, "No exact phone match in Chatwoot search results", null, contacts.length));
      return { items, misses, warnings };
    }

    const response = await client.contactConversations(match.contact.id);
    const conversations = getPayload(response).filter(conversation => {
      const matchesInbox = criteria.inboxId ? Number(getConversationInboxId(conversation)) === Number(criteria.inboxId) : true;
      return matchesInbox && matchesStatus(conversation, criteria.status || "open");
    });

    if (conversations.length === 0) {
      misses.push(phoneMiss(entry, "No matching conversation", match.contact));
      return { items, misses, warnings };
    }

    for (const conversation of conversations) {
      items.push({
        ...conversationToPreviewItem(conversation, criteria, "phone_list"),
        inputPhone: entry.inputPhone,
        normalizedPhone: entry.normalizedPhone,
        targetAgentId: criteria.targetAgentId,
        matchStatus: match.matchStatus,
        contactSearchMatches: contacts.length
      });
    }
  } catch (error) {
    misses.push(phoneMiss(entry, error.message));
  }

  return { items, misses, warnings };
}

async function parsePhoneEntries(criteria) {
  const parts = [];
  if (criteria.rawText) parts.push(String(criteria.rawText));

  if (criteria.fileBase64) {
    const fileName = String(criteria.fileName || "");
    const buffer = Buffer.from(String(criteria.fileBase64), "base64");
    if (isSpreadsheetFile(fileName)) {
      parts.push(await spreadsheetBufferToText(buffer));
    } else {
      parts.push(buffer.toString("utf8").replace(/^\uFEFF/, ""));
    }
  }

  return extractPhoneNumbers(parts.join("\n"));
}

async function spreadsheetBufferToText(buffer) {
  const { readSheet } = await import("read-excel-file/node");
  const rows = await readSheet(buffer);
  return rows.map(row => row.map(cell => cell ?? "").join(",")).join("\n");
}

function isSpreadsheetFile(fileName) {
  return /\.xlsx$/i.test(fileName);
}

export function extractPhoneNumbers(text) {
  const rows = [];
  const seen = new Set();
  const pattern = /(?:\+|00)?\d[\d\s().-]{6,}\d/g;

  for (const match of String(text || "").matchAll(pattern)) {
    const inputPhone = match[0].trim();
    const normalizedPhone = normalizePhone(inputPhone);
    if (!isLikelyPhone(normalizedPhone) || seen.has(normalizedPhone)) continue;
    seen.add(normalizedPhone);
    rows.push({ inputPhone, normalizedPhone });
  }

  return rows;
}

export function normalizePhone(value) {
  let digits = String(value || "").replace(/[^\d]/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  return digits;
}

async function searchContactsByPhone(client, normalizedPhone) {
  const contacts = [];
  for (const term of phoneSearchTerms(normalizedPhone)) {
    let response;
    try {
      response = await client.searchContacts({ q: term, page: 1 });
    } catch {
      response = await client.listContacts({ q: term, page: 1 });
    }
    contacts.push(...normalizeRows(response));
    if (contacts.some(contact => contactMatchesPhone(contact, normalizedPhone))) break;
  }
  return dedupeBy(contacts, contact => contact.id);
}

function phoneSearchTerms(normalizedPhone) {
  const terms = [normalizedPhone, `+${normalizedPhone}`];
  if (normalizedPhone.startsWith("966") && normalizedPhone.length > 3) {
    terms.push(`0${normalizedPhone.slice(3)}`);
  }
  if (normalizedPhone.length > 10) terms.push(normalizedPhone.slice(-10));
  if (normalizedPhone.length > 9) terms.push(normalizedPhone.slice(-9));
  return [...new Set(terms.filter(Boolean))];
}

function chooseContactByPhone(contacts, normalizedPhone) {
  const exact = contacts.find(contact => contactPhoneValues(contact).some(value => normalizePhone(value) === normalizedPhone));
  if (exact) return { contact: exact, matchStatus: "Exact phone" };

  const tail = contacts.find(contact => contactMatchesPhone(contact, normalizedPhone));
  if (tail) return { contact: tail, matchStatus: "Phone tail match" };

  return null;
}

function contactMatchesPhone(contact, normalizedPhone) {
  return contactPhoneValues(contact).some(value => phonesMatch(value, normalizedPhone));
}

function contactPhoneValues(contact) {
  const additional = contact?.additional_attributes || {};
  const custom = contact?.custom_attributes || {};
  return [
    contact?.phone_number,
    contact?.identifier,
    additional.phone,
    additional.phone_number,
    additional.whatsapp,
    custom.phone,
    custom.phone_number,
    custom.whatsapp
  ].filter(Boolean);
}

function phonesMatch(left, right) {
  const a = normalizePhone(left);
  const b = normalizePhone(right);
  if (!isLikelyPhone(a) || !isLikelyPhone(b)) return false;
  if (a === b) return true;

  const tailLength = Math.min(10, a.length, b.length);
  return tailLength >= 8 && a.slice(-tailLength) === b.slice(-tailLength);
}

function isLikelyPhone(phone) {
  return /^\d{8,16}$/.test(phone);
}

function phoneMiss(entry, reason, contact = null, searchMatches = 0) {
  return {
    inputPhone: entry.inputPhone,
    normalizedPhone: entry.normalizedPhone,
    reason,
    contactId: contact?.id || "",
    contactName: contact?.name || "",
    phoneNumber: contact?.phone_number || "",
    contactSearchMatches: searchMatches || ""
  };
}

async function executeItem(client, criteria, item) {
  if (item.type === "contact") {
    return updateContactOwner(client, item, criteria);
  }

  if (item.type !== "conversation") {
    throw new Error(`Unsupported item type: ${item.type}`);
  }

  if (criteria.action === "assign_team") {
    return client.assignConversation(item.conversationId, { team_id: Number(criteria.targetTeamId) });
  }

  if (criteria.action === "unassign") {
    return client.assignConversation(item.conversationId, { assignee_id: null });
  }

  return client.assignConversation(item.conversationId, { assignee_id: Number(criteria.targetAgentId) });
}

async function updateContactOwner(client, item, criteria) {
  const customAttributes = {
    ...(item.customAttributes || {})
  };
  const key = criteria.ownerAttribute || "sales_owner_id";

  if (criteria.action === "unassign") {
    delete customAttributes[key];
  } else {
    customAttributes[key] = String(criteria.targetAgentId || criteria.ownerTargetValue || "");
  }

  const payload = {
    name: item.contactName || "",
    email: item.email || "",
    phone_number: item.phoneNumber || "",
    identifier: item.identifier || "",
    additional_attributes: item.additionalAttributes || {},
    custom_attributes: customAttributes
  };

  return client.updateContact(item.contactId, payload);
}

async function listConversationsByAgent(client, criteria, maxPages, warnings) {
  const statuses = criteria.status === "all" ? ["all"] : [criteria.status || "open"];
  const conversations = [];
  let usedFilterEndpoint = false;

  for (const status of statuses) {
    try {
      const filtered = await listConversationsByFilter(client, { ...criteria, status }, maxPages);
      conversations.push(...filtered);
      usedFilterEndpoint = true;
    } catch (error) {
      warnings.push(`Conversation filter API failed, using list fallback: ${error.message}`);
      const fallback = await listConversationsByListEndpoint(client, { ...criteria, status }, maxPages);
      conversations.push(...fallback);
    }
  }

  return dedupeBy(conversations, item => item.id).filter(conversation => {
    const assigneeId = conversation?.meta?.assignee?.id;
    const matchesAssignee = criteria.fromAgentId ? Number(assigneeId) === Number(criteria.fromAgentId) : true;
    return matchesAssignee && matchesUnread(conversation, criteria.unreadOnly);
  }).map(item => ({ ...item, _source: usedFilterEndpoint ? "filter" : "list" }));
}

async function listConversationsByFilter(client, criteria, maxPages) {
  const payload = buildFilterPayload(criteria);
  if (payload.length === 0) return [];

  const rows = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const response = await client.filterConversations({ payload, page });
    const payloadRows = getPayload(response);
    rows.push(...payloadRows);
    if (payloadRows.length === 0) break;
  }
  return rows;
}

async function listConversationsByListEndpoint(client, criteria, maxPages) {
  const rows = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const response = await client.listConversations({
      page,
      status: criteria.status || "open",
      assignee_type: criteria.fromAgentId ? "assigned" : criteria.assigneeType || "all",
      inbox_id: criteria.inboxId || undefined,
      team_id: criteria.teamId || undefined,
      labels: criteria.labels || undefined
    });
    const payloadRows = getPayload(response);
    rows.push(...payloadRows);
    if (payloadRows.length === 0) break;
  }
  return rows;
}

async function listContactsByOwner(client, criteria, maxPages) {
  const ownerAttribute = criteria.ownerAttribute || "sales_owner_id";
  const ownerValue = String(criteria.ownerValue || criteria.fromAgentId || "");
  const rows = [];

  for (let page = 1; page <= maxPages; page += 1) {
    const response = await client.listContacts({ page, sort: "-last_activity_at" });
    const payload = getPayload(response);
    rows.push(...payload);
    const meta = getMeta(response);
    if (payload.length === 0 || (meta.current_page && Number(meta.current_page) < page)) break;
  }

  return rows.filter(contact => {
    const value = contact?.custom_attributes?.[ownerAttribute];
    return ownerValue ? String(value) === ownerValue : Boolean(value);
  });
}

function conversationToPreviewItem(conversation, criteria, source) {
  const sender = conversation?.meta?.sender || {};
  const assignee = conversation?.meta?.assignee || {};
  const team = conversation?.meta?.team || conversation?.team || {};
  const inbox = conversation?.inbox || conversation?.meta?.inbox || {};
  const inboxId = getConversationInboxId(conversation);
  const phoneNumber = sender.phone_number || "";
  const contactName = sender.name || "";

  return {
    type: "conversation",
    source,
    conversationId: conversation.id,
    status: conversation.status,
    unreadCount: getUnreadCount(conversation),
    inboxId,
    inboxName: inbox.name || "",
    teamId: team.id || conversation.team_id || null,
    teamName: team.name || "",
    contactId: sender.id || conversation.contact_id || null,
    contactName,
    phoneNumber,
    contactDisplay: contactDisplay(contactName, phoneNumber),
    assigneeId: assignee.id || null,
    assigneeName: assignee.name || "",
    targetAgentId: criteria.targetAgentId || null,
    targetTeamId: criteria.targetTeamId || null
  };
}

function contactDisplay(name, phoneNumber) {
  return [name, phoneNumber].filter(Boolean).join(" - ");
}

function getConversationInboxId(conversation) {
  return conversation?.inbox_id || conversation?.inbox?.id || conversation?.meta?.inbox?.id || null;
}

function contactToPreviewItem(contact, criteria) {
  return {
    type: "contact",
    source: "contact_owner",
    contactId: contact.id,
    contactName: contact.name || "",
    email: contact.email || "",
    phoneNumber: contact.phone_number || "",
    identifier: contact.identifier || "",
    additionalAttributes: contact.additional_attributes || {},
    customAttributes: contact.custom_attributes || {},
    ownerAttribute: criteria.ownerAttribute || "sales_owner_id",
    ownerValue: contact?.custom_attributes?.[criteria.ownerAttribute || "sales_owner_id"] || ""
  };
}

function matchesStatus(conversation, status) {
  if (!status || status === "all") return DEFAULT_STATUSES.includes(conversation.status);
  return conversation.status === status;
}

function matchesUnread(conversation, unreadOnly) {
  return !unreadOnly || getUnreadCount(conversation) > 0;
}

async function attachSalesReplyStatus(client, item, warnings) {
  try {
    const response = await client.conversationMessages(item.conversationId);
    return {
      ...item,
      ...analyzeSalesReplyStatus(normalizeRows(response))
    };
  } catch (error) {
    warnings.push(`Could not load messages for conversation ${item.conversationId}: ${error.message}`);
    return {
      ...item,
      replyChecked: false,
      needsReply: false,
      replyStatus: "unknown",
      lastCustomerMessageAt: "",
      lastSalesReplyAt: "",
      lastSalesReplyBy: "",
      lastMessageAt: "",
      lastMessageDirection: ""
    };
  }
}

function analyzeSalesReplyStatus(messages) {
  const entries = messages
    .map((message, index) => ({
      message,
      index,
      timeMs: getMessageTimeMs(message)
    }))
    .sort((a, b) => {
      const left = a.timeMs ?? a.index;
      const right = b.timeMs ?? b.index;
      return left - right || a.index - b.index;
    });

  let lastCustomer = null;
  let lastSalesReply = null;
  let lastPublic = null;

  for (const entry of entries) {
    if (isCustomerMessage(entry.message)) {
      lastCustomer = entry;
      lastPublic = { ...entry, direction: "customer" };
    } else if (isSalesReplyMessage(entry.message)) {
      lastSalesReply = entry;
      lastPublic = { ...entry, direction: "sales" };
    }
  }

  const needsReply = Boolean(lastCustomer && (!lastSalesReply || compareMessageEntries(lastCustomer, lastSalesReply) > 0));
  const replyStatus = !lastCustomer ? "no_customer_message" : needsReply ? "needs_reply" : "replied";

  return {
    replyChecked: true,
    needsReply,
    replyStatus,
    lastCustomerMessageAt: formatMessageTime(lastCustomer),
    lastSalesReplyAt: formatMessageTime(lastSalesReply),
    lastSalesReplyBy: getSenderName(lastSalesReply?.message),
    lastMessageAt: formatMessageTime(lastPublic),
    lastMessageDirection: lastPublic?.direction || ""
  };
}

function incrementReplyCounts(current, item) {
  if (item.replyStatus === "needs_reply") current.needsReplyCount += 1;
  if (item.replyStatus === "replied") current.repliedCount += 1;
  if (item.replyStatus === "unknown" || item.replyStatus === "not_checked") current.replyUnknownCount += 1;
}

function getUnreadCount(conversation) {
  const value = conversation?.unread_count ?? conversation?.unreadCount ?? 0;
  const count = Number(value);
  return Number.isFinite(count) && count > 0 ? count : 0;
}

function compareMessageEntries(left, right) {
  const leftValue = left.timeMs ?? left.index;
  const rightValue = right.timeMs ?? right.index;
  return leftValue - rightValue || left.index - right.index;
}

function isCustomerMessage(message) {
  if (!isPublicMessage(message)) return false;
  const type = getMessageType(message);
  if (type === 0 || type === "incoming") return true;
  return getSenderType(message) === "contact";
}

function isSalesReplyMessage(message) {
  if (!isPublicMessage(message)) return false;
  const senderType = getSenderType(message);
  if (senderType === "user" || senderType === "agent") return true;
  const type = getMessageType(message);
  return (type === 1 || type === "outgoing") && senderType !== "contact";
}

function isPublicMessage(message) {
  if (!message || message.private) return false;
  const type = getMessageType(message);
  if (type === 2 || type === "activity") return false;
  const contentType = String(message.content_type || message.contentType || "").toLowerCase();
  return contentType !== "activity";
}

function getMessageType(message) {
  const value = message?.message_type ?? message?.messageType;
  const numberValue = Number(value);
  if (Number.isFinite(numberValue)) return numberValue;
  return String(value || "").toLowerCase();
}

function getSenderType(message) {
  return String(message?.sender_type || message?.sender?.type || "").toLowerCase();
}

function getSenderName(message) {
  return message?.sender?.name || message?.sender_name || "";
}

function getMessageTimeMs(message) {
  const raw = message?.created_at ?? message?.createdAt ?? message?.timestamp ?? message?.updated_at ?? message?.updatedAt;
  if (raw === undefined || raw === null || raw === "") return null;
  if (typeof raw === "number") return raw > 1000000000000 ? raw : raw * 1000;
  const parsedNumber = Number(raw);
  if (Number.isFinite(parsedNumber)) return parsedNumber > 1000000000000 ? parsedNumber : parsedNumber * 1000;
  const parsedDate = Date.parse(raw);
  return Number.isFinite(parsedDate) ? parsedDate : null;
}

function formatMessageTime(entry) {
  if (!entry?.timeMs) return "";
  return new Date(entry.timeMs).toISOString();
}

function dedupeBy(rows, keyFn) {
  const map = new Map();
  for (const row of rows) map.set(keyFn(row), row);
  return [...map.values()];
}

function normalizeIds(values) {
  return (Array.isArray(values) ? values : [values])
    .filter(value => value !== undefined && value !== null && value !== "")
    .map(value => String(value));
}

function normalizeRows(response) {
  return Array.isArray(response) ? response : getPayload(response);
}

async function mapLimit(rows, limit, worker) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 1, 8));
  const results = new Array(rows.length);
  let nextIndex = 0;

  async function runWorker() {
    while (nextIndex < rows.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await worker(rows[currentIndex], currentIndex);
    }
  }

  await Promise.all(Array.from({ length: Math.min(safeLimit, rows.length) }, runWorker));
  return results;
}

function throwValidationError(message) {
  const error = new Error(message);
  error.status = 400;
  throw error;
}

function redactCriteria(criteria) {
  const clone = { ...criteria };
  delete clone.apiToken;
  delete clone.rawText;
  delete clone.fileBase64;
  return clone;
}
