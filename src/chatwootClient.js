export function normalizeBaseUrl(baseUrl) {
  if (!baseUrl) return "";
  return String(baseUrl).replace(/\/+$/, "");
}

export function getPayload(response) {
  if (!response) return [];
  if (Array.isArray(response)) return response;
  if (Array.isArray(response.payload)) return response.payload;
  if (response.data && Array.isArray(response.data.payload)) return response.data.payload;
  return [];
}

export function getMeta(response) {
  if (!response) return {};
  if (response.meta) return response.meta;
  if (response.data && response.data.meta) return response.data.meta;
  return {};
}

export function buildFilterPayload({ fromAgentId, status, inboxId, teamId, labels = [] }) {
  const payload = [];

  if (fromAgentId) {
    payload.push({
      attribute_key: "assignee_id",
      filter_operator: "equal_to",
      values: [Number(fromAgentId)],
      query_operator: "AND"
    });
  }

  if (status && status !== "all") {
    payload.push({
      attribute_key: "status",
      filter_operator: "equal_to",
      values: [status],
      query_operator: "AND"
    });
  }

  if (inboxId) {
    payload.push({
      attribute_key: "inbox_id",
      filter_operator: "equal_to",
      values: [Number(inboxId)],
      query_operator: "AND"
    });
  }

  if (teamId) {
    payload.push({
      attribute_key: "team_id",
      filter_operator: "equal_to",
      values: [Number(teamId)],
      query_operator: "AND"
    });
  }

  if (labels.length > 0) {
    payload.push({
      attribute_key: "labels",
      filter_operator: "contains",
      values: labels,
      query_operator: "AND"
    });
  }

  if (payload.length > 0) {
    payload[payload.length - 1].query_operator = null;
  }

  return payload;
}

export class ChatwootClient {
  constructor({ baseUrl, accountId, apiToken }) {
    this.baseUrl = normalizeBaseUrl(baseUrl || process.env.CHATWOOT_BASE_URL);
    this.accountId = accountId || process.env.CHATWOOT_ACCOUNT_ID;
    this.apiToken = apiToken || process.env.CHATWOOT_API_TOKEN;

    if (!this.baseUrl || !this.accountId || !this.apiToken) {
      throw new Error("Missing Chatwoot connection. Provide baseUrl, accountId, and apiToken.");
    }
  }

  url(path, query = {}) {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === "") continue;
      if (Array.isArray(value)) {
        for (const item of value) url.searchParams.append(key, item);
      } else {
        url.searchParams.set(key, value);
      }
    }
    return url;
  }

  async request(path, { method = "GET", query, body } = {}) {
    const headers = {
      "api_access_token": this.apiToken
    };
    const options = { method, headers };

    if (body !== undefined) {
      headers["content-type"] = "application/json";
      options.body = JSON.stringify(body);
    }

    const response = await fetch(this.url(path, query), options);
    const text = await response.text();
    const parsed = text ? safeJsonParse(text) : null;

    if (!response.ok) {
      const message = parsed?.error || parsed?.message || parsed?.description || text || response.statusText;
      const error = new Error(`Chatwoot API ${response.status}: ${message}`);
      error.status = response.status;
      error.body = parsed || text;
      throw error;
    }

    return parsed;
  }

  accountPath(path) {
    return `/api/v1/accounts/${this.accountId}${path}`;
  }

  reportPath(path) {
    return `/api/v2/accounts/${this.accountId}${path}`;
  }

  listAgents() {
    return this.request(this.accountPath("/agents"));
  }

  listTeams() {
    return this.request(this.accountPath("/teams"));
  }

  listInboxes() {
    return this.request(this.accountPath("/inboxes"));
  }

  listConversations(query = {}) {
    return this.request(this.accountPath("/conversations"), { query });
  }

  filterConversations({ payload, page = 1 }) {
    return this.request(this.accountPath("/conversations/filter"), {
      method: "POST",
      query: { page },
      body: { payload }
    });
  }

  assignConversation(conversationId, payload) {
    return this.request(this.accountPath(`/conversations/${conversationId}/assignments`), {
      method: "POST",
      body: payload
    });
  }

  createMessage(conversationId, payload) {
    return this.request(this.accountPath(`/conversations/${conversationId}/messages`), {
      method: "POST",
      body: payload
    });
  }

  listContacts(query = {}) {
    return this.request(this.accountPath("/contacts"), { query });
  }

  searchContacts(query = {}) {
    return this.request(this.accountPath("/contacts/search"), { query });
  }

  updateContact(contactId, payload) {
    return this.request(this.accountPath(`/contacts/${contactId}`), {
      method: "PUT",
      body: payload
    });
  }

  contactConversations(contactId) {
    return this.request(this.accountPath(`/contacts/${contactId}/conversations`));
  }

  conversationMetrics(query = { type: "account" }) {
    return this.request(this.reportPath("/reports/conversations"), { query });
  }

  accountReport(query) {
    return this.request(this.reportPath("/reports"), { query });
  }

  reportingEvents(query = {}) {
    return this.request(this.accountPath("/reporting_events"), { query });
  }

  auditLogs(query = {}) {
    return this.request(this.accountPath("/audit_logs"), { query });
  }
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
