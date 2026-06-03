import { ChatwootClient, buildFilterPayload, getMeta, getPayload } from "./chatwootClient.js";
import { appendAudit, saveJob } from "./store.js";

const DEFAULT_STATUSES = ["open", "pending", "resolved", "snoozed"];

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
    contactName: sender.name || "",
    phoneNumber: sender.phone_number || "",
    assigneeId: assignee.id || null,
    assigneeName: assignee.name || "",
    targetAgentId: criteria.targetAgentId || null,
    targetTeamId: criteria.targetTeamId || null
  };
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
