import { ChatwootClient, buildFilterPayload, getMeta, getPayload } from "./chatwootClient.js";
import { automationSettingsToRouterOptions } from "./automationSettings.js";
import { appendAudit, getDepartmentRoute, readAutomationSettings, saveDepartmentRoute, saveJob } from "./store.js";

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
  routedAt: "engosoft_department_routed_at",
  autoAssignedAgentId: "engosoft_department_auto_assigned_agent_id",
  manualAssignment: "engosoft_department_manual_assignment"
};
const DEFAULT_CAMPAIGN_MARKER_TTL_SECONDS = 30 * 24 * 60 * 60;
const COMPLAINT_ROUTE_STATE = "complaint_pending";
const DEFAULT_COMPLAINT_AGENT_NAME = "Abdelrahman Tarek";
// Durable "this conversation was resolved at least once" marker, written as a
// Chatwoot custom attribute the moment we handle the resolve. Scanning the
// embedded messages array for the "marked resolved" activity is unreliable —
// Chatwoot does not consistently include that activity in webhook /
// conversationDetails payloads — so a resolved broadcast conversation would be
// re-skipped as a broadcast on re-entry and never reach the bot. A custom
// attribute is always returned by the API and survives redeploys, so the bridge
// can reliably release such a conversation back to the bot on the next message.
const BOT_RELEASE_ATTRIBUTE = "engosoft_bot_release";
const LEAD_SOURCE_ATTRIBUTES = {
  state: "lead_source_survey_state",
  promptedAt: "lead_source_survey_prompted_at",
  answeredAt: "lead_source_survey_answered_at",
  value: "lead_source",
  label: "lead_source_label",
  collectedBy: "lead_source_collected_by"
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

export async function handleBotpressCloudHandoff(body = {}, options = {}) {
  const botpressConfig = buildBotpressCloudConfig({
    ...await loadSavedRouterOptions("botpress", options),
    ...(options.botpress || {})
  });
  if (!botpressConfig.enabled) {
    return { ok: true, skipped: true, reason: "botpress_cloud_disabled" };
  }

  const conversationId = getBotpressConversationId(body);
  if (!conversationId) {
    const error = new Error("Missing Chatwoot conversation id.");
    error.status = 400;
    throw error;
  }

  if (botpressConfig.skipBroadcasts && isBotpressBroadcast(body)) {
    await auditDepartmentRouter("department_router_botpress_broadcast_skipped", {
      conversationId,
      source: body.source || "botpress-cloud"
    }, botpressConfig.audit);
    return {
      ok: true,
      skipped: true,
      reason: "botpress_broadcast_skipped",
      conversationId
    };
  }

  // The bot reuses the department routing config (teams, agents, business hours,
  // confirmation texts) but is gated by BOTPRESS_CLOUD_ENABLED only — it no longer
  // depends on the legacy DEPARTMENT_ROUTER_ENABLED switch, which is retired.
  const config = buildDepartmentRouterConfig({
    ...await loadSavedRouterOptions("department", options),
    ...options
  });

  const client = makeClient(options.connection || {});
  const response = await client.conversationDetails(conversationId);
  const conversation = unwrapConversationResponse(response) || { id: conversationId };
  conversation.id = conversation.id || conversationId;
  const localRoute = await config.stateStore.get(conversationId);

  if (botpressConfig.requireResolvedReentry && !isBotpressResolvedReentry(body, conversation, localRoute)) {
    await auditDepartmentRouter("department_router_botpress_not_resolved_reentry", {
      conversationId,
      source: body.source || "botpress-cloud"
    }, botpressConfig.audit);
    return {
      ok: true,
      skipped: true,
      reason: "botpress_not_resolved_reentry",
      conversationId
    };
  }

  const summaryText = getBotpressSummary(body);
  const department = getBotpressDepartment(body);
  const sendCustomerMessage = parseBooleanOption(body.sendCustomerMessage, undefined, false);

  let noteMessage = null;
  if (summaryText) {
    noteMessage = await client.createMessage(conversationId, {
      content: `${body.privateNotePrefix || "📝 **ملخص فهد:**"}\n${summaryText}`,
      private: true,
      message_type: "outgoing",
      content_type: "text",
      content_attributes: {}
    });
  }

  let statusResult = null;
  if (body.openConversation !== false) {
    statusResult = await client.toggleConversationStatus(conversationId, body.status || "open");
  }

  let routing = null;
  if (department === "complaints") {
    if (sendCustomerMessage && config.complaintReceivedText) {
      await sendDepartmentMessage(client, conversationId, config.complaintReceivedText);
    }
    routing = await routeComplaintToAgent(client, conversation, config, "botpress_cloud_handoff", {
      onlineOnly: false,
      assignAgent: isWithinBusinessHours(config.businessHours)
    });
  } else {
    routing = await routeConversationToDepartment(
      client,
      conversation,
      config,
      department,
      "botpress_cloud_handoff",
      {
        allowReassignment: true,
        // Sales routes to a Resale agent whether online or offline (per spec);
        // operations follows agent online status. Mirrors handleDepartmentSelection.
        agentMode: department === "sales" && config.salesAssignmentMode !== "online" ? "any_status" : "online",
        sendConfirmation: false
      }
    );
  }

  let queueMessage = null;
  if (shouldSendBotpressQueueMessage(routing)) {
    const content = getBotpressQueueMessage(botpressConfig);
    if (content) queueMessage = await sendDepartmentMessage(client, conversationId, content);
  } else if (sendCustomerMessage && config.confirmSelection && department !== "complaints") {
    await sendDepartmentMessage(
      client,
      conversationId,
      department === "sales" ? config.salesConfirmationText : config.operationsConfirmationText
    );
  }

  const removedBotLabel = await removeBotHandoffLabel(client, conversation, botpressConfig);

  await auditDepartmentRouter("department_router_botpress_cloud_handoff", {
    conversationId,
    department,
    noteMessageId: noteMessage?.id || null,
    queueMessageId: queueMessage?.id || null,
    removedBotLabel,
    routingAction: routing?.action || null,
    routingReason: routing?.reason || null,
    source: body.source || "botpress-cloud"
  }, config.audit);

  return {
    ok: true,
    action: "botpress_cloud_handoff",
    conversationId,
    department,
    noteMessageId: noteMessage?.id || null,
    queueMessageId: queueMessage?.id || null,
    removedBotLabel,
    statusChanged: Boolean(statusResult),
    routing
  };
}

export async function handleLeadSourceRouterWebhook(payload = {}, options = {}) {
  const config = buildLeadSourceRouterConfig(options);
  if (!config.enabled) return { ok: true, handled: false, skipped: true, reason: "lead_source_disabled" };
  if (config.options.length === 0) return { ok: true, handled: false, skipped: true, reason: "lead_source_no_options" };

  const eventName = String(payload.event || payload.name || "").toLowerCase();
  const message = getWebhookMessage(payload);
  const conversationId = getWebhookConversationId(payload, message);
  if (!conversationId) return { ok: true, handled: false, skipped: true, reason: "lead_source_missing_conversation_id" };

  return withDepartmentRouterLock(`lead_source:${conversationId}`, async () => {
    if (!eventName.includes("message_created") || !isIncomingWebhookMessage(payload, message)) {
      return { ok: true, handled: false, skipped: true, reason: "lead_source_event_ignored", conversationId };
    }

    const client = makeClient(options.connection || {});
    const conversation = await loadDepartmentConversation(client, payload, message, conversationId, eventName);
    const inboxId = getConversationInboxId(conversation);
    if (config.inboxIds.length && !config.inboxIds.includes(String(inboxId))) {
      return { ok: true, handled: false, skipped: true, reason: "lead_source_inbox_not_enabled", conversationId, inboxId };
    }

    if (config.skipCampaigns && hasAnyCampaignMarker(conversation, payload, message)) {
      return { ok: true, handled: true, skipped: true, reason: "lead_source_campaign_skipped", conversationId, inboxId };
    }

    const customAttributes = getConversationCustomAttributes(conversation);
    const state = String(customAttributes[LEAD_SOURCE_ATTRIBUTES.state] || "").toLowerCase();
    const currentConversationValue = String(customAttributes[config.attributeKey] || customAttributes[LEAD_SOURCE_ATTRIBUTES.value] || "").trim();
    const contactId = getConversationContactId(conversation);
    if (!contactId) {
      return { ok: true, handled: false, skipped: true, reason: "lead_source_missing_contact_id", conversationId, inboxId };
    }

    const contact = await loadLeadSourceContact(client, contactId, conversation);
    const contactAttributes = getContactCustomAttributes(contact);
    const currentContactValue = String(contactAttributes[config.attributeKey] || contactAttributes[LEAD_SOURCE_ATTRIBUTES.value] || "").trim();
    if (currentConversationValue || currentContactValue || state === "answered") {
      return { ok: true, handled: true, skipped: true, reason: "lead_source_already_collected", conversationId, inboxId, contactId };
    }

    if (state === "prompted") {
      const choice = parseLeadSourceChoice(message?.content || payload?.content || "", config.options);
      if (!choice) {
        return { ok: true, handled: true, action: "lead_source_awaiting_choice", conversationId, inboxId, contactId };
      }

      const saved = await saveLeadSourceChoice(client, conversation, contact, choice, config);
      await auditLeadSourceRouter("lead_source_collected", {
        conversationId,
        inboxId,
        contactId,
        label: choice.label,
        value: choice.value,
        createdLabel: saved.createdLabel
      }, config.audit);
      return {
        ok: true,
        handled: true,
        action: "lead_source_collected",
        conversationId,
        inboxId,
        contactId,
        label: choice.label,
        value: choice.value,
        createdLabel: saved.createdLabel
      };
    }

    if (config.askOncePerContact) {
      const newConversation = await isLeadSourceNewConversation(client, conversation, contactId, inboxId);
      if (!newConversation.isNew) {
        return {
          ok: true,
          handled: true,
          skipped: true,
          reason: "lead_source_existing_contact_conversation",
          conversationId,
          inboxId,
          contactId,
          previousConversationCount: newConversation.previousConversationCount
        };
      }
    }

    const prompt = await client.createMessage(conversationId, {
      content: buildLeadSourcePrompt(config),
      message_type: "outgoing",
      private: false,
      content_type: "text",
      content_attributes: {}
    });
    const now = new Date().toISOString();
    const mergedConversationAttributes = {
      ...customAttributes,
      [LEAD_SOURCE_ATTRIBUTES.state]: "prompted",
      [LEAD_SOURCE_ATTRIBUTES.promptedAt]: now
    };
    await client.updateConversationCustomAttributes(conversationId, mergedConversationAttributes);

    await auditLeadSourceRouter("lead_source_prompted", {
      conversationId,
      inboxId,
      contactId,
      messageId: prompt?.id || null
    }, config.audit);
    return {
      ok: true,
      handled: true,
      action: "lead_source_prompted",
      conversationId,
      inboxId,
      contactId,
      messageId: prompt?.id || null
    };
  });
}

export async function handleDepartmentRouterWebhook(payload = {}, options = {}) {
  const config = buildDepartmentRouterConfig({
    ...await loadSavedRouterOptions("department", options),
    ...options
  });
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
      const campaign = getConversationCampaignMarker(conversation, config.campaignMarkerTtlSeconds);
      const hasConversationCampaignMetadata = hasExternalCampaignMetadata(conversation);
      const localCampaign = hasConversationCampaignMetadata ? null : getLocalCampaignMarker(localRoute);
      if (localCampaign || campaign) {
        if (!localCampaign) {
          localRoute = await config.stateStore.save(conversationId, {
            inboxId,
            state: "broadcast",
            campaignId: campaign?.id || null,
            campaignExpiresAt: campaign?.expiresAt || null
          });
          await auditDepartmentRouter("department_router_broadcast_skipped", {
            conversationId,
            inboxId,
            campaignId: campaign?.id || null,
            campaignExpiresAt: campaign?.expiresAt || null,
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
          campaignId: campaign?.id || localCampaign?.id || null,
          campaignExpiresAt: campaign?.expiresAt || localCampaign?.expiresAt || null
        };
      }
      if (String(localRoute?.state || "").toLowerCase() === "broadcast") {
        localRoute = await config.stateStore.save(conversationId, {
          state: "campaign_expired",
          campaignId: null,
          campaignExpiresAt: null
        });
      }
    }

    if (eventName.includes("conversation_status_changed")) {
      const status = getWebhookConversationStatus(payload, conversation);
      if (status !== "resolved") {
        return { ok: true, handled: false, skipped: true, reason: "department_status_ignored", conversationId, inboxId, status };
      }

      const customAttributes = await persistDepartmentState(client, conversation, config, {
        [DEPARTMENT_ATTRIBUTES.state]: "resolved",
        [DEPARTMENT_ATTRIBUTES.promptNext]: true,
        [DEPARTMENT_ATTRIBUTES.autoAssignedAgentId]: null,
        [DEPARTMENT_ATTRIBUTES.manualAssignment]: false
      });
      const resolvedAssigneeId = getConversationAssigneeId(conversation);
      const resolvedTeamId = getConversationTeamId(conversation);
      const clearAssignment = await clearResolvedConversationAssignment(client, conversationId, conversation);
      await auditDepartmentRouter("department_router_marked_for_reentry", {
        conversationId,
        inboxId,
        status,
        resolvedAssigneeId: resolvedAssigneeId || null,
        resolvedTeamId: resolvedTeamId || null,
        unassignedOnResolve: clearAssignment.assigneeCleared,
        teamClearedOnResolve: clearAssignment.teamCleared,
        teamClearError: clearAssignment.teamError || null,
        customAttributes
      }, config.audit);
      return {
        ok: true,
        handled: true,
        action: "marked_for_reentry",
        conversationId,
        inboxId,
        status,
        unassignedOnResolve: clearAssignment.assigneeCleared,
        teamClearedOnResolve: clearAssignment.teamCleared,
        teamClearError: clearAssignment.teamError || null
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
    const legacyResolvedReopen = config.promptOnResolved &&
      wasResolvedReopenedWithoutAgentReply(conversation, message);

    if (isDepartmentChangeRequest(content)) {
      return promptForDepartment(client, conversation, config, { reason: "customer_requested_change", force: true });
    }

    if ((promptNext || routeState === "resolved" || legacyResolvedReopen) && config.promptOnResolved) {
      return promptForDepartment(client, conversation, config, { reason: "resolved_conversation_reopened", force: true });
    }

    const knownDepartment = getKnownConversationDepartment(conversation, config, localRoute);
    if (routeState === "resolved" && knownDepartment) {
      return routeConversationToDepartment(
        client,
        conversation,
        config,
        knownDepartment,
        "resolved_conversation_reopened",
        { allowReassignment: true }
      );
    }

    // Leave the conversation alone if a human agent is actively handling it.
    // The router only manages an assignment it made itself; any other current
    // assignee is treated as a manual takeover (for example an agent who
    // self-assigned a campaign conversation) and must not be prompted,
    // unassigned, or rerouted. Resolving clears this lock (handled above).
    const handlerAssigneeId = getConversationAssigneeId(conversation);
    const handlerAutoAssignedAgentId = getSavedAutoAssignedAgentId(conversation, localRoute);
    const humanAssigned = getSavedManualAssignment(conversation, localRoute) ||
      (Boolean(handlerAssigneeId) && String(handlerAssigneeId) !== (handlerAutoAssignedAgentId || ""));
    const unavailableManualRelease = humanAssigned
      ? getUnavailableManualAssignmentRelease(conversation, config)
      : null;
    if (humanAssigned && !unavailableManualRelease) {
      if (localRoute?.manualAssignment !== true) {
        await config.stateStore.save(conversationId, { manualAssignment: true });
      }
      return {
        ok: true,
        handled: true,
        skipped: true,
        reason: "manual_assignment_active",
        conversationId,
        inboxId,
        assigneeId: handlerAssigneeId
      };
    }

    const selection = parseDepartmentSelection(content);
    if (routeState === "new_waiting_incoming") {
      return promptForDepartment(client, conversation, config, { reason: "first_incoming_message" });
    }

    if (routeState === "pending") {
      if (selection) {
        return handleDepartmentSelection(client, conversation, config, selection, "customer_selection");
      }

      return {
        ok: true,
        handled: true,
        action: "awaiting_department",
        conversationId,
        inboxId
      };
    }

    if (routeState === COMPLAINT_ROUTE_STATE) {
      const complaintSelection = parseComplaintSelection(content);
      if (complaintSelection === "operations") {
        await sendDepartmentMessage(client, conversationId, config.operationsDataPromptText);
        return routeConversationToDepartment(client, conversation, config, "operations", "complaint_to_trainee_support", {
          sendConfirmation: false
        });
      }
      if (complaintSelection === "complaints") {
        await sendDepartmentMessage(client, conversationId, config.complaintDataPromptText);
        await sendDepartmentMessage(client, conversationId, config.complaintReceivedText);
        return routeComplaintToAgent(client, conversation, config, "complaint_confirmed");
      }

      return {
        ok: true,
        handled: true,
        action: "awaiting_complaint_confirmation",
        conversationId,
        inboxId
      };
    }

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

    if (unavailableManualRelease) {
      return handleUnavailableManualAssignmentFallback(
        client,
        conversation,
        config,
        unavailableManualRelease,
        "unavailable_manual_assignment"
      );
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

// Fahd (Botpress) is the only router now. The legacy department/reopen routers
// are no longer wired into the webhook flow. The one piece still needed from the
// old resolve handling is clearing the assignee/team when a bot-managed
// conversation is resolved, so the customer's next message arrives with no
// assignee and the bridge can hand it back to the bot for a fresh routing.
export async function handleResolvedReentryReset(payload = {}, options = {}) {
  const eventName = String(payload.event || payload.name || "").toLowerCase();
  if (!eventName.includes("conversation_status_changed")) {
    return { ok: true, handled: false, skipped: true, reason: "not_status_change" };
  }

  const botEnabled = parseBooleanOption(options.botEnabled, process.env.BOTPRESS_CLOUD_ENABLED, false);
  if (!botEnabled) {
    return { ok: true, handled: false, skipped: true, reason: "bot_disabled" };
  }

  const message = getWebhookMessage(payload);
  const conversationId = getWebhookConversationId(payload, message) ||
    (eventName.startsWith("conversation_") ? payload?.id : null);
  if (!conversationId) {
    return { ok: true, handled: false, skipped: true, reason: "missing_conversation_id" };
  }

  const botInboxIds = parseListOption(options.botInboxIds, process.env.BOT_INBOX_IDS, []).map(String);
  const client = makeClient(options.connection || {});

  let conversation;
  try {
    const response = await client.conversationDetails(conversationId);
    conversation = unwrapConversationResponse(response) || getWebhookConversation(payload, message) || { id: conversationId };
  } catch {
    conversation = getWebhookConversation(payload, message) || { id: conversationId };
  }
  conversation.id = conversation.id || conversationId;

  const inboxId = getConversationInboxId(conversation);
  if (botInboxIds.length && !botInboxIds.includes(String(inboxId))) {
    return { ok: true, handled: false, skipped: true, reason: "inbox_not_bot_managed", conversationId, inboxId };
  }

  const status = getWebhookConversationStatus(payload, conversation);
  if (status !== "resolved") {
    return { ok: true, handled: false, skipped: true, reason: "status_not_resolved", conversationId, inboxId, status };
  }

  const resolvedAssigneeId = getConversationAssigneeId(conversation);
  const resolvedTeamId = getConversationTeamId(conversation);
  const clearAssignment = await clearResolvedConversationAssignment(client, conversationId, conversation);
  // Stamp the durable resolve marker so the next customer message is released to
  // the bot even on a broadcast conversation, without depending on the embedded
  // messages array carrying the "marked resolved" activity.
  const releaseMarked = await stampBotReleaseMarker(client, conversation);

  await auditDepartmentRouter("bot_resolved_reentry_reset", {
    conversationId,
    inboxId,
    status,
    resolvedAssigneeId: resolvedAssigneeId || null,
    resolvedTeamId: resolvedTeamId || null,
    unassignedOnResolve: clearAssignment.assigneeCleared,
    teamClearedOnResolve: clearAssignment.teamCleared,
    teamClearError: clearAssignment.teamError || null,
    releaseMarked
  }, options.audit !== false);

  return {
    ok: true,
    handled: true,
    action: "resolved_reentry_reset",
    conversationId,
    inboxId,
    status,
    unassignedOnResolve: clearAssignment.assigneeCleared,
    teamClearedOnResolve: clearAssignment.teamCleared,
    teamClearError: clearAssignment.teamError || null,
    releaseMarked
  };
}

// When a human agent takes a bot-managed conversation (self-assign, or any assignee
// change), drop the needs-bot label so Fahd stops. The assignee gate already blocks the
// bot in the common case, but a conversation that was resolved before is released past
// that gate (an assignee no longer blocks it), so there the label is the only reliable
// stop signal — dropping it closes that gap. Resolved re-entries still bring the bot
// back on the customer's next message after a resolve, exactly as before.
export async function handleAgentAssignmentLabelDrop(payload = {}, options = {}) {
  const eventName = String(payload.event || payload.name || "").toLowerCase();
  // Chatwoot reports an assignee change through conversation_updated (some setups also
  // emit assignee_changed). Anything else is not this handler's concern.
  if (!eventName.includes("conversation_updated") && !eventName.includes("assignee_changed")) {
    return { ok: true, handled: false, skipped: true, reason: "not_conversation_update" };
  }

  const enabled = parseBooleanOption(options.enabled, process.env.BRIDGE_DROP_LABEL_ON_ASSIGN, true);
  if (!enabled) return { ok: true, handled: false, skipped: true, reason: "disabled" };

  const label = options.label !== undefined
    ? String(options.label || "").trim()
    : String(process.env.BRIDGE_REQUIRE_LABEL ?? "needs-bot").trim();
  if (!label) return { ok: true, handled: false, skipped: true, reason: "no_label" };

  const message = getWebhookMessage(payload);
  const payloadConversation = getWebhookConversation(payload, message) ||
    (eventName.startsWith("conversation_") ? payload : null);
  // Fast path: skip without an API call only when the payload positively carries
  // conversation state (a meta/assignee shape) AND shows no assignee. If the payload
  // does not echo that info, fall through and fetch authoritative details so we never
  // miss an assignment the webhook payload under-reported.
  const payloadCarriesAssigneeInfo = Boolean(payloadConversation && (
    payloadConversation.meta ||
    payloadConversation.assignee ||
    payloadConversation.assignee_id != null ||
    payloadConversation.assigneeId != null
  ));
  if (payloadCarriesAssigneeInfo && !getConversationAssigneeId(payloadConversation)) {
    return { ok: true, handled: false, skipped: true, reason: "no_assignee" };
  }

  const conversationId = getWebhookConversationId(payload, message) ||
    (eventName.startsWith("conversation_") ? payload?.id : null);
  if (!conversationId) return { ok: true, handled: false, skipped: true, reason: "missing_conversation_id" };

  const botInboxIds = parseListOption(options.botInboxIds, process.env.BOT_INBOX_IDS, []).map(String);
  const client = makeClient(options.connection || {});

  let conversation;
  try {
    const response = await client.conversationDetails(conversationId);
    conversation = unwrapConversationResponse(response) || payloadConversation || { id: conversationId };
  } catch {
    conversation = payloadConversation || { id: conversationId };
  }
  conversation.id = conversation.id || conversationId;

  const inboxId = getConversationInboxId(conversation);
  if (botInboxIds.length && !botInboxIds.includes(String(inboxId))) {
    return { ok: true, handled: false, skipped: true, reason: "inbox_not_bot_managed", conversationId, inboxId };
  }

  // Only act once a human agent is actually on the conversation.
  const assigneeId = getConversationAssigneeId(conversation);
  if (!assigneeId) {
    return { ok: true, handled: false, skipped: true, reason: "no_assignee", conversationId, inboxId };
  }

  let labels;
  try {
    const response = await client.conversationLabels(conversationId);
    labels = normalizeLabelNames(response?.payload || response || conversation?.labels || []);
  } catch {
    labels = normalizeLabelNames(conversation?.labels || []);
  }
  if (!labels.includes(label)) {
    return { ok: true, handled: false, skipped: true, reason: "label_absent", conversationId, inboxId, assigneeId };
  }

  const nextLabels = labels.filter(item => item !== label);
  try {
    await client.updateConversationLabels(conversationId, nextLabels);
  } catch (error) {
    return { ok: false, handled: false, reason: "label_update_error", error: error.message, conversationId, inboxId, assigneeId };
  }

  await auditDepartmentRouter("needs_bot_label_dropped_on_assign", {
    conversationId, inboxId, assigneeId, label
  }, options.audit !== false);

  return { ok: true, handled: true, action: "needs_bot_label_dropped", conversationId, inboxId, assigneeId, label };
}

// --- Customer-silence timeout escalation -------------------------------------
// When Fahd (the bot) sends a message and the customer goes silent, nobody is
// watching the clock: the conversation just sits in the bot inbox with needs-bot
// and no assignee until an agent happens to notice it. This sweep closes that
// gap. It periodically scans the bot inbox for conversations whose last public
// message is an unanswered outgoing (bot) message older than the timeout, then
// routes them to a human through the existing Botpress-cloud handoff (an online
// agent inside working hours, otherwise the team Unassigned) and clears
// needs-bot. Everything is inferred from Chatwoot, so it survives redeploys.
const customerTimeoutCooldowns = new Map();

export function evaluateCustomerTimeout(messages, { timeoutMs, now = Date.now() } = {}) {
  const rows = normalizeRows(messages)
    .map((message, index) => ({ message, index, timeMs: getMessageTimeMs(message) }))
    .filter(entry => isPublicMessage(entry.message))
    .sort((left, right) => {
      const leftValue = left.timeMs ?? left.index;
      const rightValue = right.timeMs ?? right.index;
      return leftValue - rightValue || left.index - right.index;
    });

  if (rows.length === 0) return { eligible: false, reason: "no_public_messages" };

  const last = rows[rows.length - 1];
  // Only a hanging outgoing message means the customer is the one who went
  // silent. If the last public message is incoming, the customer is waiting on
  // the bot instead — a different failure that this sweep deliberately ignores.
  if (!isOutgoingPublicMessage(last.message)) {
    return { eligible: false, reason: "awaiting_bot_reply", lastDirection: "incoming" };
  }
  // Require at least one customer message so a bot/agent-initiated outbound
  // thread with no customer engagement is never escalated.
  if (!rows.some(entry => isCustomerMessage(entry.message))) {
    return { eligible: false, reason: "no_customer_message", lastDirection: "outgoing" };
  }
  if (last.timeMs == null) {
    return { eligible: false, reason: "missing_timestamp", lastDirection: "outgoing" };
  }

  const ageMs = now - last.timeMs;
  if (ageMs < timeoutMs) {
    return { eligible: false, reason: "within_timeout", lastDirection: "outgoing", ageMs };
  }
  return {
    eligible: true,
    reason: "customer_silent",
    lastDirection: "outgoing",
    ageMs,
    lastMessageAt: new Date(last.timeMs).toISOString()
  };
}

export async function runCustomerTimeoutSweep(options = {}) {
  const config = buildCustomerTimeoutConfig(options);
  if (!config.enabled) return { ok: true, skipped: true, reason: "customer_timeout_disabled" };
  if (!config.inboxIds.length) return { ok: true, skipped: true, reason: "no_inbox_ids" };

  const client = options.client || makeClient(options.connection || {});
  const now = typeof config.now === "function" ? config.now().getTime() : Date.now();
  const timeoutMs = Math.max(1, config.minutes) * 60 * 1000;

  const seen = new Set();
  const candidates = [];
  for (const inboxId of config.inboxIds) {
    let rows = [];
    try {
      rows = await listConversationsByListEndpoint(client, {
        status: "open",
        inboxId,
        assigneeType: "unassigned",
        labels: config.label ? [config.label] : undefined
      }, config.maxPages);
    } catch (error) {
      await auditDepartmentRouter("customer_timeout_list_error", { inboxId, error: error.message }, config.audit);
      continue;
    }
    for (const conversation of rows) {
      const id = conversation?.id;
      if (id == null || seen.has(String(id))) continue;
      seen.add(String(id));
      candidates.push(conversation);
    }
  }

  const escalated = [];
  const skipped = [];
  let scanned = 0;
  for (const conversation of candidates) {
    if (escalated.length >= config.maxConversations) break;
    const conversationId = conversation.id;
    if (isCustomerTimeoutCooling(conversationId, config.cooldownSeconds)) {
      skipped.push({ conversationId, reason: "cooling" });
      continue;
    }
    scanned += 1;
    try {
      const decision = await assessCustomerTimeoutConversation(client, conversation, config, { now, timeoutMs });
      if (!decision.eligible) {
        skipped.push({ conversationId, reason: decision.reason });
        continue;
      }
      // Mark before the handoff so a slow call or a lagging label update can't
      // trigger a duplicate escalation on the next tick.
      markCustomerTimeoutCooldown(conversationId, config.cooldownSeconds);
      const handoff = await handleBotpressCloudHandoff(
        {
          conversationId,
          source: "customer-timeout",
          department: decision.department,
          sendCustomerMessage: true,
          openConversation: false
        },
        buildCustomerTimeoutHandoffOptions(options, config)
      );
      const routingAction = handoff?.routing?.action || handoff?.reason || null;
      escalated.push({ conversationId, ageMs: decision.ageMs, department: decision.department, routingAction });
      await auditDepartmentRouter("customer_timeout_escalated", {
        conversationId,
        inboxId: getConversationInboxId(conversation),
        ageMs: decision.ageMs,
        department: decision.department,
        routingAction
      }, config.audit);
    } catch (error) {
      skipped.push({ conversationId, reason: "error", error: error.message });
      await auditDepartmentRouter("customer_timeout_error", { conversationId, error: error.message }, config.audit);
    }
  }

  return { ok: true, scanned, candidates: candidates.length, escalated, skipped };
}

async function assessCustomerTimeoutConversation(client, listConversation, config, { now, timeoutMs }) {
  const conversationId = listConversation.id;

  // Re-fetch authoritative state: the list snapshot can be stale by the time we
  // act, and we must never escalate a chat a human already grabbed or answered.
  let conversation = listConversation;
  try {
    const response = await client.conversationDetails(conversationId);
    conversation = unwrapConversationResponse(response) || listConversation;
  } catch {
    conversation = listConversation;
  }

  if (String(conversation.status || "").toLowerCase() !== "open") {
    return { eligible: false, reason: "not_open" };
  }
  if (getConversationAssigneeId(conversation)) {
    return { eligible: false, reason: "already_assigned" };
  }
  if (config.label && !normalizeLabelNames(conversation.labels).includes(config.label)) {
    return { eligible: false, reason: "label_missing" };
  }
  if (config.inboxIds.length) {
    const inboxId = String(getConversationInboxId(conversation) || "");
    if (inboxId && !config.inboxIds.includes(inboxId)) return { eligible: false, reason: "inbox_mismatch" };
  }

  const messages = normalizeRows(await client.conversationMessages(conversationId));
  const evaluation = evaluateCustomerTimeout(messages, { timeoutMs, now });
  if (!evaluation.eligible) return evaluation;

  return { ...evaluation, department: getKnownTimeoutDepartment(conversation, config, messages) };
}

function getKnownTimeoutDepartment(conversation, config, messages = []) {
  const attributes = getConversationCustomAttributes(conversation);
  const saved = normalizeDepartmentText(attributes[DEPARTMENT_ATTRIBUTES.department] || "");
  if (saved === "sales" || saved === "operations" || saved === "complaints") return saved;
  // Not yet classified — e.g. the customer went silent before Fahd could route, or
  // a voice note that didn't transcribe. Mirror the live handoff and infer intent
  // from the customer's own words so a timed-out sales/complaint thread still
  // reaches the right desk; fall back to the configured default (operations).
  const inferred = inferDepartmentFromCustomerMessages(messages);
  if (inferred) return inferred;
  return config.department;
}

// Scan the customer's public messages newest-first for a department signal, using
// the same keyword matcher as the live handoff so timeout routing and normal
// routing agree. Returns null when nothing matches.
function inferDepartmentFromCustomerMessages(messages) {
  const rows = normalizeRows(messages).filter(isCustomerMessage);
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const matched = matchDepartmentInText(String(rows[i]?.content || ""));
    if (matched) return matched;
  }
  return null;
}

function buildCustomerTimeoutConfig(options = {}) {
  return {
    enabled: parseBooleanOption(options.enabled, process.env.CUSTOMER_TIMEOUT_ENABLED, false),
    minutes: numberOption(options.minutes, process.env.CUSTOMER_TIMEOUT_MINUTES, 10),
    inboxIds: parseListOption(
      options.inboxIds,
      process.env.CUSTOMER_TIMEOUT_INBOX_IDS || process.env.BOT_INBOX_IDS,
      []
    ).map(String),
    label: options.label !== undefined
      ? String(options.label || "").trim()
      : String(process.env.CUSTOMER_TIMEOUT_LABEL ?? process.env.BRIDGE_REQUIRE_LABEL ?? "needs-bot").trim(),
    department: String(options.department ?? process.env.CUSTOMER_TIMEOUT_DEPARTMENT ?? "operations").toLowerCase(),
    maxPages: numberOption(options.maxPages, process.env.CUSTOMER_TIMEOUT_MAX_PAGES, 3),
    maxConversations: numberOption(options.maxConversations, process.env.CUSTOMER_TIMEOUT_MAX_CONVERSATIONS, 50),
    cooldownSeconds: numberOption(options.cooldownSeconds, process.env.CUSTOMER_TIMEOUT_COOLDOWN_SECONDS, 600),
    workingHours: buildCustomerTimeoutWorkingHours(options),
    now: options.now,
    audit: options.audit !== false
  };
}

function buildLeadSourceRouterConfig(options = {}) {
  return {
    enabled: parseBooleanOption(options.enabled, process.env.LEAD_SOURCE_ROUTER_ENABLED, false),
    inboxIds: parseListOption(options.inboxIds, process.env.LEAD_SOURCE_ROUTER_INBOX_IDS, []).map(String),
    options: parseLeadSourceOptions(options.options, process.env.LEAD_SOURCE_OPTIONS),
    attributeKey: String(options.attributeKey ?? process.env.LEAD_SOURCE_ATTRIBUTE_KEY ?? LEAD_SOURCE_ATTRIBUTES.value).trim() || LEAD_SOURCE_ATTRIBUTES.value,
    promptText: String(options.promptText ?? process.env.LEAD_SOURCE_PROMPT_TEXT ?? "ممكن نعرف حضرتك عرفتنا منين؟\n\n{options}\n\nاكتب رقم الاختيار فقط."),
    labelColor: String(options.labelColor ?? process.env.LEAD_SOURCE_LABEL_COLOR ?? "#1f93ff"),
    askOncePerContact: parseBooleanOption(options.askOncePerContact, process.env.LEAD_SOURCE_ASK_ONCE_PER_CONTACT, true),
    skipCampaigns: parseBooleanOption(options.skipCampaigns, process.env.LEAD_SOURCE_SKIP_CAMPAIGNS, true),
    audit: options.audit !== false
  };
}

// The assign-vs-queue decision reuses Fahd's working hours by default so a
// timeout escalation behaves like any other handoff: an online agent inside
// hours, the team Unassigned on Friday / outside hours.
function buildCustomerTimeoutWorkingHours(options = {}) {
  if (options.businessHours) return options.businessHours;
  if (options.workingHours) return options.workingHours;

  const enabled = parseBooleanOption(
    options.workingHoursEnabled,
    process.env.CUSTOMER_TIMEOUT_WORKING_HOURS_ENABLED ?? process.env.BOTPRESS_CLOUD_WORKING_HOURS_ENABLED,
    true
  );
  if (!enabled) return { enabled: false };

  return {
    enabled: true,
    timezone: String(options.timezone ?? process.env.BOTPRESS_CLOUD_TIMEZONE ?? "Africa/Cairo"),
    startMinutes: parseClockMinutes(options.start ?? process.env.BOTPRESS_CLOUD_START, 10 * 60),
    endMinutes: parseClockMinutes(options.end ?? process.env.BOTPRESS_CLOUD_END, 21 * 60),
    days: new Set(
      parseListOption(options.days, process.env.BOTPRESS_CLOUD_DAYS, ["0", "1", "2", "3", "4", "6"])
        .map(value => Number(value))
        .filter(value => Number.isInteger(value) && value >= 0 && value <= 6)
    ),
    now: options.now
  };
}

function buildCustomerTimeoutHandoffOptions(options, config) {
  // Forward the caller's department-routing options (connection, team/agent ids,
  // texts) to the handoff, but strip the keys we override below. In particular
  // `enabled` must NOT leak through: a defined `enabled` makes the handoff skip
  // loading the operator's saved department settings (see loadSavedRouterOptions).
  const { enabled, now, businessHours, workingHours, botpress, audit, ...passthrough } = options;
  return {
    ...passthrough,
    // The timeout is its own trigger (not a resolved re-entry), and it must work
    // regardless of the live-bot switch, so force the handoff on and skip that gate.
    botpress: { ...(botpress || {}), enabled: true, requireResolvedReentry: false },
    // Honor working hours for the assign-vs-queue decision so Friday and off-hours
    // route to the team Unassigned by rule, never pinned to a (possibly offline) agent.
    businessHours: config.workingHours,
    now: config.now,
    audit: config.audit
  };
}

function isCustomerTimeoutCooling(conversationId, cooldownSeconds) {
  if (!cooldownSeconds) return false;
  const until = customerTimeoutCooldowns.get(String(conversationId));
  if (!until) return false;
  if (Date.now() > until) {
    customerTimeoutCooldowns.delete(String(conversationId));
    return false;
  }
  return true;
}

function markCustomerTimeoutCooldown(conversationId, cooldownSeconds) {
  if (!cooldownSeconds) return;
  customerTimeoutCooldowns.set(String(conversationId), Date.now() + cooldownSeconds * 1000);
}

function numberOption(optionValue, envValue, fallback) {
  for (const value of [optionValue, envValue]) {
    if (value === undefined || value === null || value === "") continue;
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function parseLeadSourceOptions(optionValue, envValue) {
  const source = optionValue !== undefined ? optionValue : envValue;
  if (source === undefined || source === null || source === "") return [];
  const rows = Array.isArray(source)
    ? source
    : String(source).split(/[\n|,;]+/);
  const seen = new Set();
  const options = [];
  for (const row of rows) {
    const raw = typeof row === "object" && row !== null
      ? String(row.label || row.title || row.value || "").trim()
      : String(row || "").trim();
    if (!raw) continue;
    const key = normalizeLeadSourceText(raw);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    options.push({
      index: options.length + 1,
      label: raw,
      value: raw,
      key
    });
  }
  return options;
}

function buildLeadSourcePrompt(config) {
  const optionLines = config.options.map(option => `${option.index}. ${option.label}`).join("\n");
  return config.promptText.includes("{options}")
    ? config.promptText.replace("{options}", optionLines)
    : `${config.promptText}\n\n${optionLines}`;
}

function parseLeadSourceChoice(content, options) {
  const normalized = normalizeLeadSourceText(content);
  if (!normalized) return null;
  const numeric = Number(normalized);
  if (Number.isInteger(numeric) && numeric >= 1 && numeric <= options.length) {
    return options[numeric - 1];
  }
  return options.find(option => option.key === normalized) || null;
}

function normalizeLeadSourceText(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\u0660-\u0669]/g, digit => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, digit => String(digit.charCodeAt(0) - 0x06F0))
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildDepartmentRouterConfig(options = {}) {
  return {
    enabled: parseBooleanOption(options.enabled, process.env.DEPARTMENT_ROUTER_ENABLED, false),
    inboxIds: parseListOption(options.inboxIds, process.env.DEPARTMENT_ROUTER_INBOX_IDS, []).map(String),
    salesTeamId: String(options.salesTeamId ?? process.env.DEPARTMENT_ROUTER_SALES_TEAM_ID ?? ""),
    operationsTeamId: String(options.operationsTeamId ?? process.env.DEPARTMENT_ROUTER_OPERATIONS_TEAM_ID ?? ""),
    salesAgentIds: parseListOption(
      options.salesAgentIds,
      process.env.DEPARTMENT_ROUTER_SALES_AGENT_IDS,
      []
    ).map(String),
    operationsAgentIds: parseListOption(
      options.operationsAgentIds,
      process.env.DEPARTMENT_ROUTER_OPERATIONS_AGENT_IDS,
      []
    ).map(String),
    promptOnNew: parseBooleanOption(options.promptOnNew, process.env.DEPARTMENT_ROUTER_PROMPT_ON_NEW, true),
    promptOnResolved: parseBooleanOption(options.promptOnResolved, process.env.DEPARTMENT_ROUTER_PROMPT_ON_RESOLVED, true),
    newContactsOnly: parseBooleanOption(options.newContactsOnly, process.env.DEPARTMENT_ROUTER_NEW_CONTACTS_ONLY, true),
    skipCampaigns: parseBooleanOption(options.skipCampaigns, process.env.DEPARTMENT_ROUTER_SKIP_CAMPAIGNS, true),
    campaignMarkerTtlSeconds: parseCampaignMarkerTtlSeconds(options.campaignMarkerTtlSeconds),
    assignAgent: parseBooleanOption(options.assignAgent, process.env.DEPARTMENT_ROUTER_ASSIGN_AGENT, true),
    businessHours: buildBusinessHoursConfig(options),
    confirmSelection: parseBooleanOption(options.confirmSelection, process.env.DEPARTMENT_ROUTER_CONFIRM_SELECTION, true),
    promptText: String(options.promptText ?? process.env.DEPARTMENT_ROUTER_PROMPT_TEXT ??
      "للمبيعات و العروض الجديدة اضغط 1\nلدعم المتدربين اضغط 2\nللشكاوي اضغط 3"),
    salesConfirmationText: String(options.salesConfirmationText ?? process.env.DEPARTMENT_ROUTER_SALES_CONFIRMATION_TEXT ??
      "سيتم التواصل معكم سريعا\nنقدر صبرك"),
    operationsConfirmationText: String(options.operationsConfirmationText ?? process.env.DEPARTMENT_ROUTER_OPERATIONS_CONFIRMATION_TEXT ??
      "تم تحويل محادثتك إلى فريق العمليات، وسيتم الرد عليك في أقرب وقت."),
    operationsDataPromptText: String(options.operationsDataPromptText ?? process.env.DEPARTMENT_ROUTER_OPERATIONS_DATA_PROMPT_TEXT ??
      "لتتمكن من مساعدتكم سريعا يرجى تزويدنا بالبيانات التالية\n1. الاسم الثلاثي\n2. رقم الهاتف الذي تم التسجيل به\n3. الدورة التي تم حجزها"),
    complaintIntroText: String(options.complaintIntroText ?? process.env.DEPARTMENT_ROUTER_COMPLAINT_INTRO_TEXT ??
      "يرجى العلم أن هذا الاختيار يتعلق بالشكاوي فقط و سيتم الرد عليكم من 48 إلى 72 ساعة عمل\nو في حالة إن أردتم حل مشكلة متعلقة بالدورة يرجى اختيار دعم المتدربين و ذلك للرد الفوري\nلدعم المتدربين اضغط 1\nلتأكيد اختيار قسم الشكاوي اضغط 2"),
    complaintDataPromptText: String(options.complaintDataPromptText ?? process.env.DEPARTMENT_ROUTER_COMPLAINT_DATA_PROMPT_TEXT ??
      "يرجى تزويدنا بالبيانات التالية\n1. الاسم الثلاثي\n2. رقم الهاتف الذي تم التسجيل به\n3. الدورة التي تم حجزها\n4. ملخص الشكوى"),
    complaintReceivedText: String(options.complaintReceivedText ?? process.env.DEPARTMENT_ROUTER_COMPLAINT_RECEIVED_TEXT ??
      "تم إستلام الشكوى و سيتم الرد عليكم من 48 إلى 72 ساعة عمل"),
    salesAssignmentMode: String(options.salesAssignmentMode ?? process.env.DEPARTMENT_ROUTER_SALES_ASSIGNMENT_MODE ?? "online").toLowerCase(),
    complaintAgentId: String(options.complaintAgentId ?? process.env.DEPARTMENT_ROUTER_COMPLAINT_AGENT_ID ?? "").trim(),
    complaintAgentEmail: String(options.complaintAgentEmail ?? process.env.DEPARTMENT_ROUTER_COMPLAINT_AGENT_EMAIL ?? "").trim().toLowerCase(),
    complaintAgentName: String(options.complaintAgentName ?? process.env.DEPARTMENT_ROUTER_COMPLAINT_AGENT_NAME ?? DEFAULT_COMPLAINT_AGENT_NAME).trim(),
    reassignUnavailableManualAssignments: parseBooleanOption(
      options.reassignUnavailableManualAssignments ?? options.rerouteUnavailableManualAssignments,
      process.env.DEPARTMENT_ROUTER_REROUTE_UNAVAILABLE_MANUAL_ASSIGNMENTS,
      false
    ),
    manualAssignmentUnavailableStatuses: parseListOption(
      options.manualAssignmentUnavailableStatuses,
      process.env.DEPARTMENT_ROUTER_MANUAL_ASSIGNMENT_UNAVAILABLE_STATUSES,
      REOPEN_ROUTER_DEFAULT_UNAVAILABLE
    ).map(value => String(value).toLowerCase()),
    unavailableManualFallback: String(
      options.unavailableManualFallback ?? process.env.DEPARTMENT_ROUTER_UNAVAILABLE_MANUAL_FALLBACK ?? "unassign"
    ).toLowerCase(),
    stateStore: options.stateStore || {
      get: getDepartmentRoute,
      save: saveDepartmentRoute
    },
    audit: options.audit !== false
  };
}

async function loadSavedRouterOptions(routerName, options = {}) {
  if (options.useSavedSettings === false) return {};
  if (routerName !== "botpress" && options.enabled !== undefined) return {};
  const saved = await readAutomationSettings();
  if (!saved) return {};
  const routerOptions = automationSettingsToRouterOptions(saved);
  return routerOptions[routerName] || {};
}

function buildBotpressCloudConfig(options = {}) {
  return {
    enabled: parseBooleanOption(options.enabled, process.env.BOTPRESS_CLOUD_ENABLED, false),
    skipBroadcasts: parseBooleanOption(options.skipBroadcasts, process.env.BOTPRESS_CLOUD_SKIP_BROADCASTS, true),
    requireResolvedReentry: parseBooleanOption(
      options.requireResolvedReentry,
      process.env.BOTPRESS_CLOUD_REQUIRE_RESOLVED_REENTRY,
      true
    ),
    clearLabel: String(options.clearLabel ?? process.env.BOTPRESS_CLOUD_CLEAR_LABEL ?? process.env.BRIDGE_REQUIRE_LABEL ?? "needs-bot").trim(),
    inHoursQueueMessage: String(options.inHoursQueueMessage ?? process.env.BOTPRESS_CLOUD_IN_HOURS_QUEUE_MESSAGE ??
      "سيتم التواصل معكم في أقرب وقت.\nنقدر صبركم."),
    outsideHoursMessage: String(options.outsideHoursMessage ?? process.env.BOTPRESS_CLOUD_OUTSIDE_HOURS_MESSAGE ??
      "شكراً لتواصلكم معنا،\n\nحالياً أنتم تتواصلون خارج أوقات العمل الرسمية، والتي تمتد من 10:00 صباحاً حتى 9:00 مساءً طوال أيام الأسبوع ما عدا الجمعة.\n\nتم استلام رسالتكم وسيقوم أحد أعضاء فريقنا بالتواصل معكم في أقرب وقت ممكن خلال ساعات العمل.\n\nمع خالص التقدير،\n\nفريق تشغيل إنجوسوفت"),
    outsideHoursMode: String(options.outsideHoursMode ?? process.env.BOTPRESS_CLOUD_OUTSIDE_HOURS_MODE ?? "send_message").toLowerCase(),
    workingHours: {
      enabled: parseBooleanOption(options.workingHoursEnabled, process.env.BOTPRESS_CLOUD_WORKING_HOURS_ENABLED, true),
      timezone: String(options.timezone ?? process.env.BOTPRESS_CLOUD_TIMEZONE ?? "Africa/Cairo"),
      startMinutes: parseClockMinutes(options.start ?? process.env.BOTPRESS_CLOUD_START, 10 * 60),
      endMinutes: parseClockMinutes(options.end ?? process.env.BOTPRESS_CLOUD_END, 21 * 60),
      days: new Set(
        parseListOption(options.days, process.env.BOTPRESS_CLOUD_DAYS, ["0", "1", "2", "3", "4", "6"])
          .map(value => Number(value))
          .filter(value => Number.isInteger(value) && value >= 0 && value <= 6)
      ),
      now: options.now
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

  if (config.newContactsOnly && history.activeConversationCount > 0) {
    await config.stateStore.save(conversationId, {
      inboxId,
      state: "existing_contact",
      contactId: history.contactId,
      previousConversationCount: history.previousConversationCount,
      activeConversationCount: history.activeConversationCount
    });
    return {
      ok: true,
      handled: true,
      skipped: true,
      reason: "existing_contact_has_active_history",
      conversationId,
      inboxId,
      previousConversationCount: history.previousConversationCount,
      activeConversationCount: history.activeConversationCount
    };
  }

  await config.stateStore.save(conversationId, {
    inboxId,
    state: "new_waiting_incoming",
    contactId: history.contactId,
    previousConversationCount: history.previousConversationCount,
    activeConversationCount: history.activeConversationCount
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
    return { canVerify: false, reason: "contact_id_unavailable", contactId: null, previousConversationCount: 0, activeConversationCount: 0 };
  }

  try {
    const response = await client.contactConversations(contactId);
    const previousConversations = getPayload(response).filter(item => String(item.id) !== String(conversation.id));
    const activeConversations = previousConversations.filter(item => String(item.status || "").toLowerCase() !== "resolved");
    return {
      canVerify: true,
      reason: "",
      contactId,
      previousConversationCount: previousConversations.length,
      activeConversationCount: activeConversations.length
    };
  } catch (error) {
    return {
      canVerify: false,
      reason: "contact_history_unavailable",
      contactId,
      previousConversationCount: 0,
      activeConversationCount: 0,
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
const CAMPAIGN_MARKER_KEYS = [
  "api_campaign_label",
  "api_campaign_created_at",
  "last_api_campaign_label",
  "last_api_template"
];

function getConversationCampaignMarker(conversation, ttlSeconds = DEFAULT_CAMPAIGN_MARKER_TTL_SECONDS) {
  const nativeId = getConversationCampaignId(conversation);
  if (nativeId) return { id: String(nativeId), expiresAt: null, source: "native" };

  // The external campaign uploader writes these markers to the conversation's
  // custom_attributes (and occasionally additional_attributes). Scan both.
  const sources = [
    getConversationCustomAttributes(conversation),
    conversation?.additional_attributes || conversation?.additionalAttributes || {}
  ];
  for (const source of sources) {
    const activeUntil = parseDateValue(source.api_campaign_active_until);
    if (activeUntil) {
      if (activeUntil.getTime() <= Date.now()) return null;
      return {
        id: String(source.api_campaign_label || source.last_api_campaign_label || "external_campaign"),
        expiresAt: activeUntil.toISOString(),
        source: "external"
      };
    }

    const datedMarkers = [
      source.api_campaign_marked_at,
      source.api_campaign_created_at,
      ...Object.entries(source)
        .filter(([key]) => key.startsWith("api_sent_"))
        .map(([, value]) => value)
    ].map(parseDateValue).filter(Boolean);
    const latestMarker = datedMarkers.sort((left, right) => right.getTime() - left.getTime())[0] || null;
    if (latestMarker) {
      if (ttlSeconds <= 0) continue;
      const expiresAt = new Date(latestMarker.getTime() + ttlSeconds * 1000);
      if (expiresAt.getTime() <= Date.now()) continue;
      return {
        id: String(source.api_campaign_label || source.last_api_campaign_label || "external_campaign"),
        expiresAt: expiresAt.toISOString(),
        source: "external_legacy"
      };
    }

    for (const key of CAMPAIGN_MARKER_KEYS) {
      if (source[key]) {
        return { id: String(source[key]), expiresAt: null, source: "external_legacy" };
      }
    }
    const sentKey = Object.keys(source).find(key => key.startsWith("api_sent_"));
    if (sentKey) return { id: sentKey, expiresAt: null, source: "external_legacy" };
  }
  return null;
}

function hasExternalCampaignMetadata(conversation) {
  const sources = [
    getConversationCustomAttributes(conversation),
    conversation?.additional_attributes || conversation?.additionalAttributes || {}
  ];
  return sources.some(source =>
    Boolean(source.api_campaign_active_until) ||
    CAMPAIGN_MARKER_KEYS.some(key => Boolean(source[key])) ||
    Object.keys(source).some(key => key.startsWith("api_sent_"))
  );
}

// True when a conversation came from (or was touched by) a broadcast/campaign,
// using the same native + external marker detection as the department router.
// The Botpress bridge uses this to avoid letting Fahd answer broadcast replies.
export function isBroadcastConversation(conversation, ttlSeconds) {
  if (!conversation) return false;
  return Boolean(getConversationCampaignMarker(conversation, ttlSeconds));
}

function getLocalCampaignMarker(localRoute) {
  if (String(localRoute?.state || "").toLowerCase() !== "broadcast") return null;
  const expiresAt = parseDateValue(localRoute?.campaignExpiresAt);
  if (expiresAt && expiresAt.getTime() <= Date.now()) return null;
  return {
    id: localRoute?.campaignId || "local_campaign",
    expiresAt: expiresAt?.toISOString() || null
  };
}

function hasAnyCampaignMarker(...items) {
  return items.filter(Boolean).some(item =>
    Boolean(getConversationCampaignId(item)) ||
    hasExternalCampaignMetadata(item)
  );
}

async function loadLeadSourceContact(client, contactId, conversation) {
  try {
    const response = await client.contactDetails(contactId);
    return unwrapConversationResponse(response) || response || getConversationContact(conversation) || { id: contactId };
  } catch {
    return getConversationContact(conversation) || { id: contactId };
  }
}

function getConversationContact(conversation) {
  return conversation?.contact || conversation?.meta?.sender || conversation?.sender || null;
}

function getContactCustomAttributes(contact) {
  return contact?.custom_attributes || contact?.customAttributes || {};
}

async function isLeadSourceNewConversation(client, conversation, contactId, inboxId) {
  try {
    const response = await client.contactConversations(contactId);
    const rows = getPayload(response);
    const currentId = String(conversation.id || "");
    const previousConversations = rows.filter(row => {
      if (currentId && String(row.id) === currentId) return false;
      return String(getConversationInboxId(row)) === String(inboxId);
    });
    return {
      isNew: previousConversations.length === 0,
      previousConversationCount: previousConversations.length
    };
  } catch (error) {
    return {
      isNew: false,
      previousConversationCount: 0,
      error: error.message
    };
  }
}

async function saveLeadSourceChoice(client, conversation, contact, choice, config) {
  const contactId = contact.id;
  const now = new Date().toISOString();
  const createdLabel = await ensureLeadSourceLabel(client, choice.label, config);
  await addLeadSourceLabelToContact(client, contactId, choice.label);

  const contactAttributes = {
    ...getContactCustomAttributes(contact),
    [config.attributeKey]: choice.value,
    [LEAD_SOURCE_ATTRIBUTES.value]: choice.value,
    [LEAD_SOURCE_ATTRIBUTES.label]: choice.label,
    [LEAD_SOURCE_ATTRIBUTES.answeredAt]: now,
    [LEAD_SOURCE_ATTRIBUTES.collectedBy]: "customer"
  };
  await client.updateContact(contactId, { custom_attributes: contactAttributes });

  const conversationAttributes = {
    ...getConversationCustomAttributes(conversation),
    [config.attributeKey]: choice.value,
    [LEAD_SOURCE_ATTRIBUTES.value]: choice.value,
    [LEAD_SOURCE_ATTRIBUTES.label]: choice.label,
    [LEAD_SOURCE_ATTRIBUTES.answeredAt]: now,
    [LEAD_SOURCE_ATTRIBUTES.collectedBy]: "customer",
    [LEAD_SOURCE_ATTRIBUTES.state]: "answered"
  };
  await client.updateConversationCustomAttributes(conversation.id, conversationAttributes);

  return { createdLabel };
}

async function ensureLeadSourceLabel(client, label, config) {
  const response = await client.listLabels();
  const labels = normalizeLabelNames(getPayload(response));
  if (labels.includes(label)) return false;

  try {
    await client.createLabel({ title: label, color: config.labelColor });
    return true;
  } catch (error) {
    if (error.status === 422) return false;
    throw error;
  }
}

async function addLeadSourceLabelToContact(client, contactId, label) {
  const response = await client.contactLabels(contactId);
  const labels = normalizeLabelNames(response?.payload || response || []);
  if (labels.includes(label)) return false;
  await client.updateContactLabels(contactId, [...labels, label]);
  return true;
}

function parseCampaignMarkerTtlSeconds(optionValue) {
  const value = Number(optionValue ?? process.env.CAMPAIGN_MARKER_TTL_SECONDS ?? DEFAULT_CAMPAIGN_MARKER_TTL_SECONDS);
  if (!Number.isFinite(value)) return DEFAULT_CAMPAIGN_MARKER_TTL_SECONDS;
  return Math.max(0, Math.floor(value));
}

function parseDateValue(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
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
    [DEPARTMENT_ATTRIBUTES.promptedAt]: new Date().toISOString(),
    [DEPARTMENT_ATTRIBUTES.autoAssignedAgentId]: null,
    [DEPARTMENT_ATTRIBUTES.manualAssignment]: false
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

async function handleDepartmentSelection(client, conversation, config, selection, reason) {
  const conversationId = conversation.id;
  if (selection === "sales") {
    await sendDepartmentMessage(client, conversationId, config.salesConfirmationText);
    return routeConversationToDepartment(client, conversation, config, "sales", reason, {
      agentMode: config.salesAssignmentMode === "online" ? "online" : "any_status",
      sendConfirmation: false
    });
  }

  if (selection === "operations") {
    await sendDepartmentMessage(client, conversationId, config.operationsDataPromptText);
    return routeConversationToDepartment(client, conversation, config, "operations", reason, {
      sendConfirmation: false
    });
  }

  if (selection === "complaints") {
    await sendDepartmentMessage(client, conversationId, config.complaintIntroText);
    const updatedAttributes = await persistDepartmentState(client, conversation, config, {
      [DEPARTMENT_ATTRIBUTES.department]: "complaints",
      [DEPARTMENT_ATTRIBUTES.state]: COMPLAINT_ROUTE_STATE,
      [DEPARTMENT_ATTRIBUTES.promptNext]: false,
      [DEPARTMENT_ATTRIBUTES.autoAssignedAgentId]: null,
      [DEPARTMENT_ATTRIBUTES.manualAssignment]: false
    });
    await auditDepartmentRouter("department_router_complaint_intro_sent", {
      conversationId,
      inboxId: getConversationInboxId(conversation),
      reason,
      updatedAttributes
    }, config.audit);
    return {
      ok: true,
      handled: true,
      action: "complaint_intro_sent",
      conversationId,
      inboxId: getConversationInboxId(conversation),
      reason
    };
  }

  return {
    ok: true,
    handled: true,
    skipped: true,
    reason: "unknown_department_selection",
    conversationId,
    inboxId: getConversationInboxId(conversation)
  };
}

async function sendDepartmentMessage(client, conversationId, content) {
  if (!content) return null;
  return client.createMessage(conversationId, {
    content,
    message_type: "outgoing",
    private: false,
    content_type: "text",
    content_attributes: {}
  });
}

async function clearResolvedConversationAssignment(client, conversationId, conversation) {
  const result = {
    assigneeCleared: false,
    teamCleared: false,
    teamError: null
  };

  if (getConversationAssigneeId(conversation)) {
    await client.assignConversation(conversationId, { assignee_id: null });
    result.assigneeCleared = true;
  }

  try {
    await client.assignConversation(conversationId, { team_id: null });
    result.teamCleared = true;
  } catch (error) {
    result.teamError = error.message || "Failed to clear team assignment";
  }

  return result;
}

export function conversationHasBotReleaseMarker(conversation) {
  return Boolean(getConversationCustomAttributes(conversation)[BOT_RELEASE_ATTRIBUTE]);
}

// Stamp the durable resolve marker, merging with existing custom attributes so we
// never clobber other keys. Best-effort: a failure here must not break the
// resolve handling, so callers treat the boolean result as advisory.
async function stampBotReleaseMarker(client, conversation) {
  try {
    const merged = {
      ...getConversationCustomAttributes(conversation),
      [BOT_RELEASE_ATTRIBUTE]: new Date().toISOString()
    };
    const response = await client.updateConversationCustomAttributes(conversation.id, merged);
    conversation.custom_attributes = response?.custom_attributes || merged;
    return true;
  } catch {
    return false;
  }
}

async function routeConversationToDepartment(
  client,
  conversation,
  config,
  department,
  reason,
  { allowReassignment = false, agentMode = "online", sendConfirmation = true } = {}
) {
  const conversationId = conversation.id;
  const inboxId = getConversationInboxId(conversation);
  const teamId = department === "sales" ? config.salesTeamId : config.operationsTeamId;
  if (!teamId) {
    throw new Error(`Missing ${department} team id for department router.`);
  }

  const localRoute = await config.stateStore.get(conversationId);
  const currentAssigneeId = getConversationAssigneeId(conversation);
  const autoAssignedAgentId = getSavedAutoAssignedAgentId(conversation, localRoute);

  // Respect manual assignments unless the operator explicitly allows the router
  // to release unavailable assignees back to the configured routing flow.
  const manuallyLocked = !allowReassignment && (
    getSavedManualAssignment(conversation, localRoute) ||
    (Boolean(currentAssigneeId) && String(currentAssigneeId) !== (autoAssignedAgentId || ""))
  );

  if (manuallyLocked) {
    const unavailableManualRelease = getUnavailableManualAssignmentRelease(conversation, config);
    if (unavailableManualRelease) {
      await config.stateStore.save(conversationId, {
        manualAssignment: false,
        autoAssignedAgentId: null
      });
      await auditDepartmentRouter("department_router_released_unavailable_manual_assignment", {
        conversationId,
        inboxId,
        department,
        teamId: Number(teamId),
        fromAgentId: unavailableManualRelease.assigneeId,
        fromAgentName: unavailableManualRelease.assigneeName,
        fromAgentStatus: unavailableManualRelease.assigneeStatus,
        reason
      }, config.audit);
    } else {
      const updatedAttributes = await persistDepartmentState(client, conversation, config, {
        [DEPARTMENT_ATTRIBUTES.department]: department,
        [DEPARTMENT_ATTRIBUTES.state]: "routed",
        [DEPARTMENT_ATTRIBUTES.teamId]: Number(teamId),
        [DEPARTMENT_ATTRIBUTES.promptNext]: false,
        [DEPARTMENT_ATTRIBUTES.routedAt]: new Date().toISOString(),
        [DEPARTMENT_ATTRIBUTES.autoAssignedAgentId]: null,
        [DEPARTMENT_ATTRIBUTES.manualAssignment]: true
      });
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
  }

  // Decide whether to assign a specific agent. Business hours gate every mode:
  // inside business hours we assign (agentMode then decides online-only vs any
  // status); outside them — including non-working days like Friday — we fall
  // back to team-only (Unassigned). When business hours are disabled, any_status
  // always assigns and the rest use the static flag.
  const assignAgentNow = config.businessHours?.enabled
    ? isWithinBusinessHours(config.businessHours)
    : agentMode === "any_status"
      ? true
      : config.assignAgent;

  // Team-only mode: route to the correct team and leave the conversation
  // Unassigned so the team's agents pick it up themselves. Never auto-assign a
  // specific agent. The Chatwoot assignments endpoint ignores team_id when
  // assignee_id is present, so the team and the unassign are two separate calls.
  if (!assignAgentNow) {
    const assignmentResult = await client.assignConversation(conversationId, { team_id: Number(teamId) });
    await client.assignConversation(conversationId, { assignee_id: null });
    const updatedAttributes = await persistDepartmentState(client, conversation, config, {
      [DEPARTMENT_ATTRIBUTES.department]: department,
      [DEPARTMENT_ATTRIBUTES.state]: "routed",
      [DEPARTMENT_ATTRIBUTES.teamId]: Number(teamId),
      [DEPARTMENT_ATTRIBUTES.promptNext]: false,
      [DEPARTMENT_ATTRIBUTES.routedAt]: new Date().toISOString(),
      [DEPARTMENT_ATTRIBUTES.autoAssignedAgentId]: null,
      [DEPARTMENT_ATTRIBUTES.manualAssignment]: false
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
  const allowedAgentIds = department === "sales" ? config.salesAgentIds : config.operationsAgentIds;
  const eligibleAgents = filterDepartmentAgents(teamAgentsResponse, inboxAgentsResponse, allowedAgentIds);
  const currentAgent = eligibleAgents.find(agent => String(getAgentId(agent)) === String(currentAssigneeId));
  const currentIsEligibleOnline = Boolean(currentAgent && getAgentAvailability(currentAgent) === "online");

  let action = "kept_current_agent";
  let targetAgent = currentAgent || null;
  let assignmentResult = null;

  if (!currentIsEligibleOnline) {
    const candidatePool = agentMode === "any_status"
      ? eligibleAgents
      : eligibleAgents.filter(agent => getAgentAvailability(agent) === "online");
    const onlineAgents = orderReopenRouterCandidates(
      candidatePool,
      conversationId
    );
    targetAgent = onlineAgents.find(agent => String(getAgentId(agent)) !== String(currentAssigneeId)) || onlineAgents[0] || null;
    if (targetAgent) {
      assignmentResult = await assignConversationToTeamAndAgent(client, conversationId, teamId, getAgentId(targetAgent));
      action = agentMode === "any_status" ? "department_assigned_any_status" : "department_assigned";
    } else {
      assignmentResult = await client.assignConversation(conversationId, { team_id: Number(teamId) });
      await client.assignConversation(conversationId, { assignee_id: null });
      action = "department_team_queue";
    }
  }

  const updatedAttributes = await persistDepartmentState(client, conversation, config, {
    [DEPARTMENT_ATTRIBUTES.department]: department,
    [DEPARTMENT_ATTRIBUTES.state]: "routed",
    [DEPARTMENT_ATTRIBUTES.teamId]: Number(teamId),
    [DEPARTMENT_ATTRIBUTES.promptNext]: false,
    [DEPARTMENT_ATTRIBUTES.routedAt]: new Date().toISOString(),
    [DEPARTMENT_ATTRIBUTES.autoAssignedAgentId]: targetAgent ? String(getAgentId(targetAgent)) : null,
    [DEPARTMENT_ATTRIBUTES.manualAssignment]: false
  });

  if (sendConfirmation && config.confirmSelection && reason === "customer_selection") {
    await sendDepartmentMessage(
      client,
      conversationId,
      department === "sales" ? config.salesConfirmationText : config.operationsConfirmationText
    );
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

export function filterDepartmentAgents(teamAgentsResponse, inboxAgentsResponse, allowedAgentIds = []) {
  const teamAgents = normalizeRows(teamAgentsResponse);
  const inboxAgentIds = new Set(normalizeRows(inboxAgentsResponse).map(agent => String(getAgentId(agent))));
  const whitelist = new Set((allowedAgentIds || []).map(String));
  return teamAgents.filter(agent => {
    const agentId = String(getAgentId(agent));
    if (!agentId || !inboxAgentIds.has(agentId)) return false;
    return whitelist.size === 0 || whitelist.has(agentId);
  });
}

async function routeComplaintToAgent(client, conversation, config, reason, { onlineOnly = false, assignAgent = true } = {}) {
  const conversationId = conversation.id;
  const inboxId = getConversationInboxId(conversation);
  const teamId = config.operationsTeamId;
  if (!teamId) throw new Error("Missing operations team id for complaint router.");

  // When assignAgent is false (e.g. outside business hours / on a non-working
  // day) the complaint is queued to the team Unassigned instead of pinned to
  // the complaint owner, who would otherwise receive it while off.
  const resolvedAgent = assignAgent
    ? await resolveComplaintAgent(client, config, { includeAvailability: onlineOnly })
    : null;
  const targetAgent = resolvedAgent && (!onlineOnly || getAgentAvailability(resolvedAgent, "offline") === "online")
    ? resolvedAgent
    : null;
  const currentAssigneeId = getConversationAssigneeId(conversation);

  let assignmentResult = null;
  let action = "complaint_team_queue";
  if (targetAgent) {
    assignmentResult = await assignConversationToTeamAndAgent(client, conversationId, teamId, getAgentId(targetAgent));
    action = "complaint_assigned";
  } else {
    assignmentResult = await client.assignConversation(conversationId, { team_id: Number(teamId) });
    await client.assignConversation(conversationId, { assignee_id: null });
  }

  const updatedAttributes = await persistDepartmentState(client, conversation, config, {
    [DEPARTMENT_ATTRIBUTES.department]: "complaints",
    [DEPARTMENT_ATTRIBUTES.state]: "routed",
    [DEPARTMENT_ATTRIBUTES.teamId]: Number(teamId),
    [DEPARTMENT_ATTRIBUTES.promptNext]: false,
    [DEPARTMENT_ATTRIBUTES.routedAt]: new Date().toISOString(),
    [DEPARTMENT_ATTRIBUTES.autoAssignedAgentId]: targetAgent ? String(getAgentId(targetAgent)) : null,
    [DEPARTMENT_ATTRIBUTES.manualAssignment]: false
  });

  const details = {
    conversationId,
    inboxId,
    department: "complaints",
    teamId: Number(teamId),
    fromAgentId: currentAssigneeId || null,
    toAgentId: targetAgent ? Number(getAgentId(targetAgent)) : null,
    toAgentName: getAgentName(targetAgent),
    reason,
    updatedAttributes
  };
  await auditDepartmentRouter(`department_router_${action}`, details, config.audit);
  return { ok: true, handled: true, action, ...details, result: assignmentResult };
}

async function handleUnavailableManualAssignmentFallback(client, conversation, config, release, reason) {
  const conversationId = conversation.id;
  const inboxId = getConversationInboxId(conversation);
  const fallback = config.unavailableManualFallback || "unassign";

  await config.stateStore.save(conversationId, {
    manualAssignment: false,
    autoAssignedAgentId: null
  });

  if (fallback === "prompt") {
    await auditDepartmentRouter("department_router_unavailable_manual_prompted", {
      conversationId,
      inboxId,
      fromAgentId: release.assigneeId,
      fromAgentName: release.assigneeName,
      fromAgentStatus: release.assigneeStatus,
      reason
    }, config.audit);
    return promptForDepartment(client, conversation, config, { reason, force: true });
  }

  if (fallback === "ignore") {
    await auditDepartmentRouter("department_router_unavailable_manual_ignored", {
      conversationId,
      inboxId,
      fromAgentId: release.assigneeId,
      fromAgentName: release.assigneeName,
      fromAgentStatus: release.assigneeStatus,
      reason
    }, config.audit);
    return {
      ok: true,
      handled: true,
      skipped: true,
      reason: "unavailable_manual_assignment_ignored",
      conversationId,
      inboxId,
      assigneeId: release.assigneeId,
      assigneeStatus: release.assigneeStatus
    };
  }

  let result = null;
  if (getConversationAssigneeId(conversation)) {
    result = await client.assignConversation(conversationId, { assignee_id: null });
  }
  const details = {
    conversationId,
    inboxId,
    fromAgentId: release.assigneeId,
    fromAgentName: release.assigneeName,
    fromAgentStatus: release.assigneeStatus,
    reason
  };
  await auditDepartmentRouter("department_router_unavailable_manual_unassigned", details, config.audit);
  return {
    ok: true,
    handled: true,
    action: "unavailable_manual_unassigned",
    ...details,
    result
  };
}

async function resolveComplaintAgent(client, config, { includeAvailability = false } = {}) {
  if (config.complaintAgentId) {
    if (includeAvailability) {
      const agents = normalizeRows(await client.listAgents());
      const agent = agents.find(item => String(getAgentId(item)) === String(config.complaintAgentId));
      if (agent) return agent;
    }
    return { id: Number(config.complaintAgentId), name: config.complaintAgentName };
  }

  const agents = normalizeRows(await client.listAgents());
  if (config.complaintAgentEmail) {
    const byEmail = agents.find(agent => String(agent.email || "").toLowerCase() === config.complaintAgentEmail);
    if (byEmail) return byEmail;
  }

  const targetName = normalizeDepartmentText(config.complaintAgentName);
  return agents.find(agent => normalizeDepartmentText(getAgentName(agent)) === targetName) || null;
}

async function assignConversationToTeamAndAgent(client, conversationId, teamId, agentId) {
  const teamResult = await client.assignConversation(conversationId, { team_id: Number(teamId) });
  const agentResult = await client.assignConversation(conversationId, { assignee_id: Number(agentId) });
  return { team: teamResult, assignee: agentResult };
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
  if (DEPARTMENT_ATTRIBUTES.autoAssignedAgentId in changes) {
    local.autoAssignedAgentId = changes[DEPARTMENT_ATTRIBUTES.autoAssignedAgentId];
  }
  if (DEPARTMENT_ATTRIBUTES.manualAssignment in changes) {
    local.manualAssignment = changes[DEPARTMENT_ATTRIBUTES.manualAssignment];
  }
  return local;
}

function getConversationCustomAttributes(conversation) {
  return conversation?.custom_attributes || conversation?.customAttributes || {};
}

function getConversationTeamId(conversation) {
  return conversation?.team_id || conversation?.team?.id || conversation?.meta?.team?.id || null;
}

function getSavedAutoAssignedAgentId(conversation, localRoute = null) {
  const customAttributes = getConversationCustomAttributes(conversation);
  const hasPersistedValue = Object.prototype.hasOwnProperty.call(
    customAttributes,
    DEPARTMENT_ATTRIBUTES.autoAssignedAgentId
  );
  const value = hasPersistedValue
    ? customAttributes[DEPARTMENT_ATTRIBUTES.autoAssignedAgentId]
    : localRoute?.autoAssignedAgentId;
  return value == null || value === "" ? null : String(value);
}

function getSavedManualAssignment(conversation, localRoute = null) {
  const customAttributes = getConversationCustomAttributes(conversation);
  const hasPersistedValue = Object.prototype.hasOwnProperty.call(
    customAttributes,
    DEPARTMENT_ATTRIBUTES.manualAssignment
  );
  return parseBooleanOption(
    hasPersistedValue
      ? customAttributes[DEPARTMENT_ATTRIBUTES.manualAssignment]
      : localRoute?.manualAssignment,
    undefined,
    false
  );
}

function getUnavailableManualAssignmentRelease(conversation, config) {
  if (!config.reassignUnavailableManualAssignments) return null;
  const assigneeId = getConversationAssigneeId(conversation);
  if (!assigneeId) return null;

  const assignee = getConversationAssignee(conversation);
  const assigneeStatus = getAgentAvailability(assignee, "missing");
  const unavailableStatuses = config.manualAssignmentUnavailableStatuses || REOPEN_ROUTER_DEFAULT_UNAVAILABLE;
  if (!unavailableStatuses.includes(String(assigneeStatus).toLowerCase())) return null;

  return {
    assigneeId,
    assigneeName: getAgentName(assignee),
    assigneeStatus
  };
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

export function wasResolvedReopenedWithoutAgentReply(conversation, incomingMessage) {
  const messages = normalizeRows(conversation?.messages);
  if (messages.length === 0) return false;

  const incomingId = incomingMessage?.id == null ? "" : String(incomingMessage.id);
  const incomingTime = getMessageTimeMs(incomingMessage);
  const priorMessages = messages
    .map((message, index) => ({ message, index, timeMs: getMessageTimeMs(message) }))
    .filter(entry => {
      if (incomingId && String(entry.message?.id || "") === incomingId) return false;
      if (incomingTime != null && entry.timeMs != null) return entry.timeMs <= incomingTime;
      return true;
    })
    .sort((left, right) => {
      const leftValue = left.timeMs ?? left.index;
      const rightValue = right.timeMs ?? right.index;
      return leftValue - rightValue || left.index - right.index;
    });

  let lastResolvedIndex = -1;
  for (let index = 0; index < priorMessages.length; index += 1) {
    if (isResolvedActivityMessage(priorMessages[index].message)) lastResolvedIndex = index;
  }
  if (lastResolvedIndex < 0) return false;

  // A customer who replies several times after a resolve is still reopening the
  // same conversation, so their own incoming messages must not cancel the
  // detection. Only an outgoing agent (or bot) reply after the resolve means a
  // human has re-engaged, and in that case the router leaves the conversation
  // alone instead of re-prompting.
  return !priorMessages
    .slice(lastResolvedIndex + 1)
    .some(entry => isOutgoingPublicMessage(entry.message));
}

function isResolvedActivityMessage(message) {
  if (!message) return false;
  const contentAttributes = message.content_attributes || message.contentAttributes || {};
  const additionalAttributes = message.additional_attributes || message.additionalAttributes || {};
  const values = [
    contentAttributes.status,
    contentAttributes.event,
    contentAttributes.action,
    additionalAttributes.status,
    additionalAttributes.event,
    additionalAttributes.action
  ].map(value => String(value || "").toLowerCase());
  if (values.some(value => value === "resolved" || value.includes("conversation_resolved"))) return true;

  const type = getMessageType(message);
  const contentType = String(message.content_type || message.contentType || "").toLowerCase();
  if (type !== 2 && type !== "activity" && contentType !== "activity") return false;

  const content = normalizeDepartmentText(message.content || message.processed_message_content || "");
  return content.includes("marked resolved") ||
    content.includes("conversation resolved") ||
    content.includes("تم حل المحادثه") ||
    content.includes("تم حل المحادثة") ||
    content.includes("تم اغلاق المحادثه") ||
    content.includes("تم اغلاق المحادثة");
}

// True when the conversation's recent messages contain a resolve activity,
// i.e. an agent closed it at least once. The Botpress bridge uses this so a
// broadcast conversation that was already handled and resolved is released
// back to the normal flow (Fahd) on the customer's next message.
export function conversationHasResolveActivity(conversation) {
  return normalizeRows(conversation?.messages).some(message => isResolvedActivityMessage(message));
}

export function parseDepartmentSelection(content) {
  const normalized = normalizeDepartmentText(content);
  if (["1", "01"].includes(normalized)) return "sales";
  if (["2", "02"].includes(normalized)) return "operations";
  if (["3", "03"].includes(normalized)) return "complaints";

  if (["sales", "sale", "sales team", "مبيعات", "المبيعات", "سيلز", "ريسيل", "ري سيل"].includes(normalized)) {
    return "sales";
  }
  if (["operations", "operation", "ops", "operations team", "دعم المتدربين", "متدربين", "عمليات", "العمليات", "اوبريشن", "أوبريشن", "تشغيل"].includes(normalized)) {
    return "operations";
  }
  if (["complaint", "complaints", "complaints team", "شكوى", "الشكاوي", "شكاوي", "الشكاوى", "الشكاوى"].includes(normalized)) {
    return "complaints";
  }
  return null;
}

function parseComplaintSelection(content) {
  const normalized = normalizeDepartmentText(content);
  if (["1", "01", "دعم المتدربين", "متدربين"].includes(normalized)) return "operations";
  if (["2", "02", "شكوى", "الشكاوي", "شكاوي", "الشكاوى"].includes(normalized)) return "complaints";
  return null;
}

function getBotpressConversationId(body) {
  return body.conversationId ||
    body.conversation_id ||
    body.chatwoot_conversation_id ||
    body.chatwootConversationId ||
    body.user?.chatwoot_conversation_id ||
    body.user?.chatwootConversationId ||
    body.workflow?.chatwoot_conversation_id ||
    body.workflow?.chatwootConversationId ||
    null;
}

function getBotpressSummary(body) {
  return String(
    body.summary ||
    body.chatSummary ||
    body.workflow?.chatSummary ||
    body.transcript ||
    body.workflow?.transcript ||
    "العميل طلب التحدث لموظف."
  ).trim();
}

// Keyword sets shared by the explicit-field match and the summary inference.
// Multi-word entries are matched as substrings; single words match whole tokens
// so a summary line like "الطلب/المشكلة: ..." never trips the operations match.
const DEPARTMENT_KEYWORDS = {
  sales: ["resale", "re sale", "sales", "sale", "مبيعات", "المبيعات", "سيلز", "ريسيل"],
  operations: ["operation", "operations", "ops", "support", "trainee support", "دعم المتدربين", "دعم", "عمليات", "العمليات", "متدربين", "تشغيل"],
  complaints: ["complaint", "complaints", "شكوى", "شكاوي", "الشكاوي", "الشكاوى", "اعتراض", "تصعيد"]
};

// Matches a free-form value (a field value or a summary line) to a department.
// Single-word keywords must appear as a standalone token; phrases match anywhere.
function matchDepartmentInText(value) {
  const normalized = normalizeDepartmentText(value);
  if (!normalized) return null;
  const tokens = new Set(normalized.split(" "));
  for (const [department, words] of Object.entries(DEPARTMENT_KEYWORDS)) {
    for (const word of words) {
      const normalizedWord = normalizeDepartmentText(word);
      if (!normalizedWord) continue;
      if (normalizedWord.includes(" ")) {
        if (normalized.includes(normalizedWord)) return department;
      } else if (tokens.has(normalizedWord)) {
        return department;
      }
    }
  }
  return null;
}

function getExplicitBotpressDepartment(body) {
  const values = [
    body.department,
    body.route,
    body.targetDepartment,
    body.handoffDepartment,
    body.selection,
    body.choice,
    body.intent,
    body.workflow?.department,
    body.workflow?.route,
    body.workflow?.targetDepartment,
    body.workflow?.handoffDepartment,
    body.workflow?.selection,
    body.workflow?.choice,
    body.workflow?.intent
  ];

  for (const value of values) {
    if (value == null || String(value).trim() === "") continue;
    const matched = matchDepartmentInText(value);
    if (matched) return matched;
    const parsed = parseDepartmentSelection(value);
    if (parsed) return parsed;
  }

  return null;
}

// Pulls the department out of the structured summary ("النية: sales") that Fahd
// writes. Tries the labelled intent line first, then scans the whole summary so
// a clear complaint/sales/ops signal is still caught when the label is missing.
const INTENT_LABEL_RE = /(?:الني[ةه]|intent|القسم|department)\s*[:：]\s*([^\n\r]+)/i;

function inferDepartmentFromSummary(text) {
  const raw = String(text || "");
  if (!raw.trim()) return null;
  const labelMatch = raw.match(INTENT_LABEL_RE);
  if (labelMatch) {
    const labelled = matchDepartmentInText(labelMatch[1]);
    if (labelled) return labelled;
  }
  return matchDepartmentInText(raw);
}

export function getBotpressDepartment(body) {
  const explicit = getExplicitBotpressDepartment(body);
  if (explicit) return explicit;

  const inferred = inferDepartmentFromSummary(getBotpressSummary(body));
  if (inferred) return inferred;

  return "operations";
}

function isBotpressResolvedReentry(body, conversation, localRoute) {
  const explicitFlags = [
    body.wasResolved,
    body.reopenedFromResolved,
    body.resolvedReentry,
    body.shouldResetContext,
    body.user?.wasResolved,
    body.user?.reopenedFromResolved,
    body.user?.resolvedReentry,
    body.user?.shouldResetContext,
    body.workflow?.wasResolved,
    body.workflow?.reopenedFromResolved,
    body.workflow?.resolvedReentry,
    body.workflow?.shouldResetContext
  ];
  if (explicitFlags.some(value => parseBooleanOption(value, undefined, false))) return true;

  // The durable resolve marker is the most reliable signal: if we stamped it on a
  // prior resolve, this is a genuine re-entry regardless of what flags Fahd echoes.
  if (conversationHasBotReleaseMarker(conversation)) return true;

  const customAttributes = getConversationCustomAttributes(conversation);
  const states = [
    localRoute?.state,
    customAttributes[DEPARTMENT_ATTRIBUTES.state],
    conversation?.status
  ].map(value => String(value || "").toLowerCase());
  if (states.includes("resolved")) return true;

  const promptNext = parseBooleanOption(
    localRoute?.promptNext ?? customAttributes[DEPARTMENT_ATTRIBUTES.promptNext],
    undefined,
    false
  );
  if (promptNext) return true;

  const messages = normalizeRows(conversation?.messages);
  return messages.some(message => isResolvedActivityMessage(message));
}

function shouldSendBotpressQueueMessage(routing) {
  const action = String(routing?.action || "").toLowerCase();
  return action === "department_team_queue" ||
    action === "department_team_unassigned" ||
    action === "complaint_team_queue";
}

function getBotpressQueueMessage(botpressConfig) {
  const outsideWorkingHours = botpressConfig.workingHours?.enabled &&
    !isWithinBusinessHours(botpressConfig.workingHours);
  if (outsideWorkingHours) {
    // "return_only": route the conversation but stay silent outside hours.
    if (botpressConfig.outsideHoursMode === "return_only") return "";
    return botpressConfig.outsideHoursMessage;
  }
  return botpressConfig.inHoursQueueMessage;
}

async function removeBotHandoffLabel(client, conversation, botpressConfig) {
  const label = botpressConfig.clearLabel;
  if (!label) return false;

  try {
    const latestResponse = await client.conversationDetails(conversation.id);
    const latestConversation = unwrapConversationResponse(latestResponse) || conversation;
    const latestAttributes = getConversationCustomAttributes(latestConversation);
    const latestState = String(latestAttributes[DEPARTMENT_ATTRIBUTES.state] || "").toLowerCase();
    const promptNext = parseBooleanOption(latestAttributes[DEPARTMENT_ATTRIBUTES.promptNext], undefined, false);
    const latestStatus = String(latestConversation.status || "").toLowerCase();
    if (latestStatus === "resolved" || latestState === "resolved" || promptNext) {
      return false;
    }

    const response = await client.conversationLabels(conversation.id);
    const labels = normalizeLabelNames(response?.payload || response || conversation?.labels || []);
    if (!labels.includes(label)) return false;
    const nextLabels = labels.filter(item => item !== label);
    await client.updateConversationLabels(conversation.id, nextLabels);
    conversation.labels = nextLabels;
    return true;
  } catch {
    return false;
  }
}

function normalizeLabelNames(labels) {
  if (!Array.isArray(labels)) return [];
  return labels
    .map(label => {
      if (typeof label === "string") return label;
      return label?.title || label?.name || label?.label || "";
    })
    .map(label => String(label).trim())
    .filter(Boolean);
}

function isBotpressBroadcast(body) {
  const values = [
    body.isBroadcast,
    body.isBroadcastReply,
    body.broadcast,
    body.broadcastReply,
    body.fromBroadcast,
    body.workflow?.isBroadcast,
    body.workflow?.isBroadcastReply,
    body.workflow?.broadcast,
    body.workflow?.broadcastReply,
    body.workflow?.fromBroadcast
  ];
  if (values.some(value => parseBooleanOption(value, undefined, false))) return true;

  const source = normalizeDepartmentText(body.source || body.workflow?.source || body.campaignSource || "");
  if (["broadcast", "campaign", "whatsapp broadcast", "chatwoot campaign"].includes(source)) return true;

  return Boolean(
    body.campaignId ||
    body.campaign_id ||
    body.chatwootCampaignId ||
    body.workflow?.campaignId ||
    body.workflow?.campaign_id ||
    body.workflow?.chatwootCampaignId
  );
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

async function auditLeadSourceRouter(action, details, enabled = true) {
  if (!enabled) return;

  await appendAudit({
    action,
    actor: { name: "Lead Source Router", type: "automation" },
    summary: `Lead source router handled conversation ${details.conversationId}: ${details.label || details.reason || action}`,
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
  const config = buildReopenRouterConfig({
    ...await loadSavedRouterOptions("reopen", options),
    ...options
  });
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
    const campaign = getConversationCampaignMarker(conversation, config.campaignMarkerTtlSeconds) ||
      getConversationCampaignMarker(getWebhookConversation(payload, message), config.campaignMarkerTtlSeconds);
    if (campaign) {
      return {
        ok: true,
        skipped: true,
        reason: "broadcast_conversation",
        conversationId,
        inboxId,
        campaignId: campaign.id,
        campaignExpiresAt: campaign.expiresAt
      };
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
    campaignMarkerTtlSeconds: parseCampaignMarkerTtlSeconds(options.campaignMarkerTtlSeconds),
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
  const senderType = getSenderType(message);
  if (senderType === "user" || senderType === "agent") return false;
  if (senderType === "contact") return true;
  const type = getMessageType(message);
  if (type === 0 || type === "incoming") return true;
  return false;
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

function isOutgoingPublicMessage(message) {
  if (!isPublicMessage(message)) return false;
  const type = getMessageType(message);
  return type === 1 || type === "outgoing";
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
