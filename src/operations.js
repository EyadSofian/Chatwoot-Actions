import { ChatwootClient, buildFilterPayload, getMeta, getPayload } from "./chatwootClient.js";
import { appendAudit, saveJob } from "./store.js";

const DEFAULT_STATUSES = ["open", "pending", "resolved", "snoozed"];

export function makeClient(connection) {
  return new ChatwootClient(connection || {});
}

export async function probeChatwoot(connection) {
  const client = makeClient(connection);
  const [agents, teams, metrics] = await Promise.allSettled([
    client.listAgents(),
    client.listTeams(),
    client.conversationMetrics({ type: "account" })
  ]);

  return {
    agents: agents.status === "fulfilled" ? agents.value : [],
    teams: teams.status === "fulfilled" ? teams.value : [],
    metrics: metrics.status === "fulfilled" ? metrics.value : null,
    warnings: [agents, teams, metrics]
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
          const conversations = getPayload(response).filter(conversation => matchesStatus(conversation, criteria.status));
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
    return criteria.fromAgentId ? Number(assigneeId) === Number(criteria.fromAgentId) : true;
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

  return {
    type: "conversation",
    source,
    conversationId: conversation.id,
    status: conversation.status,
    inboxId: conversation.inbox_id,
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

function dedupeBy(rows, keyFn) {
  const map = new Map();
  for (const row of rows) map.set(keyFn(row), row);
  return [...map.values()];
}

function redactCriteria(criteria) {
  const clone = { ...criteria };
  delete clone.apiToken;
  return clone;
}
