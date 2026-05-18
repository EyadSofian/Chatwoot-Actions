const state = {
  tab: "dashboard",
  connection: loadConnection(),
  agents: [],
  teams: [],
  metrics: null,
  preview: null,
  jobs: [],
  audit: [],
  campaigns: [],
  webhooks: [],
  appContext: null,
  bulkCriteria: {
    scope: "conversations",
    status: "open",
    action: "assign_agent",
    ownerAttribute: "sales_owner_id",
    maxPages: 20
  }
};

const tabs = [
  ["dashboard", "Dashboard"],
  ["bulk", "Bulk Reassignment"],
  ["campaigns", "Campaigns"],
  ["audit", "Audit Log"],
  ["exports", "Exports"],
  ["settings", "Settings"]
];

const titles = {
  dashboard: ["Dashboard", "Live counters, Chatwoot report snapshots, and dashboard-app context."],
  bulk: ["Bulk Reassignment", "Transfer or unassign conversations and contact owners in controlled batches."],
  campaigns: ["Campaigns", "Track local campaigns and Chatwoot webhook reply signals."],
  audit: ["Audit Log", "Local action history plus optional Enterprise audit fetch."],
  exports: ["Exports", "Download CSV files for audit logs, campaigns, and bulk jobs."],
  settings: ["Settings", "Configure the Chatwoot self-hosted instance connection."]
};

document.addEventListener("DOMContentLoaded", () => {
  renderNav();
  bindDashboardAppContext();
  document.getElementById("refresh-button").addEventListener("click", refreshActiveTab);
  render();
  refreshBaseData();
});

function renderNav() {
  const nav = document.getElementById("nav");
  nav.innerHTML = tabs.map(([id, label]) => (
    `<button type="button" data-tab="${id}" class="${state.tab === id ? "active" : ""}">${label}</button>`
  )).join("");
  nav.querySelectorAll("button").forEach(button => {
    button.addEventListener("click", () => {
      state.tab = button.dataset.tab;
      render();
      refreshActiveTab();
    });
  });
}

function render() {
  renderNav();
  const [title, subtitle] = titles[state.tab];
  document.getElementById("page-title").textContent = title;
  document.getElementById("page-subtitle").textContent = subtitle;
  document.getElementById("connection-state").textContent = hasConnection() ? "Connected config" : "Not connected";
  document.getElementById("connection-state").className = `pill ${hasConnection() ? "ok" : "neutral"}`;
  renderContextBox();

  const view = document.getElementById("view");
  if (state.tab === "dashboard") view.innerHTML = dashboardView();
  if (state.tab === "bulk") view.innerHTML = bulkView();
  if (state.tab === "campaigns") view.innerHTML = campaignsView();
  if (state.tab === "audit") view.innerHTML = auditView();
  if (state.tab === "exports") view.innerHTML = exportsView();
  if (state.tab === "settings") view.innerHTML = settingsView();
  bindViewEvents();
}

function dashboardView() {
  const metric = state.metrics || {};
  const conversationMetrics = metric.conversationMetrics || {};
  return `
    <div class="grid three">
      ${stat("Open", conversationMetrics.open ?? "-")}
      ${stat("Unassigned", conversationMetrics.unassigned ?? "-")}
      ${stat("Unattended", conversationMetrics.unattended ?? "-")}
    </div>
    <div class="grid two" style="margin-top:16px">
      <section class="panel">
        <div class="panel-header"><h2>Chatwoot Reports</h2><button class="button secondary" data-action="load-reports">Load reports</button></div>
        <div class="panel-body">${reportsTable()}</div>
      </section>
      <section class="panel">
        <div class="panel-header"><h2>Dashboard App Context</h2><button class="button secondary" data-action="request-context">Request context</button></div>
        <div class="panel-body">${contextDetails()}</div>
      </section>
    </div>
  `;
}

function bulkView() {
  const criteria = state.bulkCriteria;
  return `
    <section class="panel">
      <div class="panel-header">
        <h2>Bulk Ownership Transfer</h2>
        <span class="pill neutral">${state.preview?.count ?? 0} previewed</span>
      </div>
      <div class="panel-body">
        <div class="form-grid">
          ${selectField("scope", "Scope", [["conversations", "Conversations assigned to agent"], ["contacts", "Contacts by owner custom attribute"]], criteria.scope)}
          ${selectField("status", "Conversation status", [["open", "Open"], ["pending", "Pending"], ["resolved", "Resolved"], ["snoozed", "Snoozed"], ["all", "All"]], criteria.status)}
          ${agentSelect("fromAgentId", "From agent", criteria.fromAgentId)}
          ${selectField("action", "Action", [["assign_agent", "Assign to agent"], ["assign_team", "Assign to team"], ["unassign", "Unassign"]], criteria.action)}
          ${agentSelect("targetAgentId", "Target agent", criteria.targetAgentId)}
          ${teamSelect("targetTeamId", "Target team", criteria.targetTeamId)}
          ${inputField("ownerAttribute", "Contact owner attribute", criteria.ownerAttribute || "sales_owner_id")}
          ${inputField("maxPages", "Max pages to scan", criteria.maxPages || "20", "number")}
        </div>
        <label class="field" style="margin-top:14px">
          <span><input type="checkbox" id="includeContactConversations" ${criteria.includeContactConversations ? "checked" : ""}> Include matching contact conversations</span>
        </label>
        <div class="actions">
          <button class="button" data-action="preview-bulk">Preview</button>
          <button class="button danger" data-action="execute-bulk" ${state.preview?.count ? "" : "disabled"}>Execute bulk action</button>
        </div>
      </div>
    </section>
    <section class="panel" style="margin-top:16px">
      <div class="panel-header"><h2>Preview</h2>${state.preview ? `<span class="pill warn">${state.preview.count} items</span>` : ""}</div>
      <div class="panel-body">${previewTable()}</div>
    </section>
  `;
}

function campaignsView() {
  return `
    <div class="grid two">
      <section class="panel">
        <div class="panel-header"><h2>Create Local Campaign Tracker</h2></div>
        <div class="panel-body">
          <div class="form-grid">
            ${inputField("campaignName", "Campaign name", "May outbound")}
            ${inputField("chatwootCampaignId", "Chatwoot campaign ID", "")}
            ${agentSelect("campaignOwnerId", "Owner / sales")}
            ${inputField("campaignAudience", "Audience note", "VIP label")}
          </div>
          <div class="actions"><button class="button" data-action="create-campaign">Create tracker</button></div>
          <p class="notice">Configure Chatwoot webhooks to call <strong>/api/webhooks/chatwoot</strong> for message_created and message_updated events.</p>
        </div>
      </section>
      <section class="panel">
        <div class="panel-header"><h2>Webhook Events</h2><button class="button secondary" data-action="load-webhooks">Load events</button></div>
        <div class="panel-body">${simpleTable(state.webhooks.slice(0, 8), ["receivedAt", "event", "campaignId"])}</div>
      </section>
    </div>
    <section class="panel" style="margin-top:16px">
      <div class="panel-header"><h2>Campaigns</h2><button class="button secondary" data-action="load-campaigns">Refresh</button></div>
      <div class="panel-body">${simpleTable(state.campaigns, ["createdAt", "name", "chatwootCampaignId", "ownerName", "sentCount", "deliveredCount", "repliedCount", "failedCount"])}</div>
    </section>
  `;
}

function auditView() {
  return `
    <section class="panel">
      <div class="panel-header">
        <h2>Action Log</h2>
        <div class="actions" style="margin:0">
          <button class="button secondary" data-action="fetch-chatwoot-audit">Fetch Chatwoot audit</button>
          <button class="button secondary" data-action="load-audit">Refresh</button>
        </div>
      </div>
      <div class="panel-body">${simpleTable(state.audit, ["createdAt", "action", "summary", "actor.name", "metadata.jobId"])}</div>
    </section>
  `;
}

function exportsView() {
  return `
    <section class="panel">
      <div class="panel-header"><h2>CSV Downloads</h2></div>
      <div class="panel-body">
        <div class="actions">
          <a class="button secondary" href="/api/audit/export.csv">Audit CSV</a>
          <a class="button secondary" href="/api/campaigns/export.csv">Campaign CSV</a>
        </div>
        <h3>Bulk jobs</h3>
        ${jobsTable()}
      </div>
    </section>
  `;
}

function settingsView() {
  return `
    <section class="panel">
      <div class="panel-header"><h2>Connection</h2></div>
      <div class="panel-body">
        <div class="form-grid">
          ${inputField("baseUrl", "Chatwoot base URL", state.connection.baseUrl || "https://chatwoot.example.com")}
          ${inputField("accountId", "Account ID", state.connection.accountId || "1", "number")}
          ${inputField("apiToken", "User access token", state.connection.apiToken || "", "password")}
          ${inputField("operatorName", "Operator name", state.connection.operatorName || "Ops Admin")}
        </div>
        <div class="actions">
          <button class="button" data-action="save-settings">Save and test</button>
          <button class="button secondary" data-action="clear-settings">Clear local settings</button>
        </div>
      </div>
    </section>
  `;
}

function bindViewEvents() {
  document.querySelectorAll("[data-action]").forEach(element => {
    element.addEventListener("click", async event => {
      const action = event.currentTarget.dataset.action;
      if (action === "save-settings") return saveSettings();
      if (action === "clear-settings") return clearSettings();
      if (action === "preview-bulk") return previewBulk();
      if (action === "execute-bulk") return executeBulk();
      if (action === "load-reports") return loadReports();
      if (action === "load-audit") return loadAudit();
      if (action === "fetch-chatwoot-audit") return fetchChatwootAudit();
      if (action === "create-campaign") return createCampaign();
      if (action === "load-campaigns") return loadCampaigns();
      if (action === "load-webhooks") return loadWebhooks();
      if (action === "request-context") return requestDashboardContext();
    });
  });
}

async function refreshBaseData() {
  if (!hasConnection()) return;
  try {
    const data = await api("/api/chatwoot/probe", { connection: state.connection });
    state.agents = data.agents || [];
    state.teams = data.teams || [];
    state.metrics = { conversationMetrics: data.metrics };
    render();
  } catch (error) {
    notify(error.message, "bad");
  }
}

async function refreshActiveTab() {
  if (state.tab === "dashboard") return loadReports();
  if (state.tab === "audit") return loadAudit();
  if (state.tab === "campaigns") return Promise.all([loadCampaigns(), loadWebhooks()]);
  if (state.tab === "exports") return loadJobs();
}

async function loadReports() {
  if (!hasConnection()) return notify("Save Chatwoot connection first.", "warn");
  const data = await api("/api/reports/summary", { connection: state.connection });
  state.metrics = data;
  render();
}

async function previewBulk() {
  if (!hasConnection()) return notify("Save Chatwoot connection first.", "warn");
  const criteria = getBulkCriteria();
  state.bulkCriteria = criteria;
  const data = await api("/api/bulk/preview", { connection: state.connection, criteria });
  state.preview = data;
  render();
}

async function executeBulk() {
  if (!state.preview?.items?.length) return;
  const criteria = state.preview.criteria || getBulkCriteria();
  const actor = state.appContext?.currentAgent || { name: state.connection.operatorName || "Ops Admin" };
  const confirmed = window.confirm(`Execute ${criteria.action} on ${state.preview.items.length} item(s)?`);
  if (!confirmed) return;
  const job = await api("/api/bulk/execute", {
    connection: state.connection,
    criteria,
    items: state.preview.items,
    actor
  });
  state.preview = null;
  await loadJobs();
  notify(`Bulk job finished: ${job.succeeded}/${job.total} succeeded.`, job.failed ? "warn" : "ok");
  state.tab = "exports";
  render();
}

async function saveSettings() {
  state.connection = {
    baseUrl: value("baseUrl"),
    accountId: value("accountId"),
    apiToken: value("apiToken"),
    operatorName: value("operatorName")
  };
  localStorage.setItem("chatwootOpsConnection", JSON.stringify(state.connection));
  await refreshBaseData();
  notify("Connection saved locally.", "ok");
}

function clearSettings() {
  localStorage.removeItem("chatwootOpsConnection");
  state.connection = {};
  state.agents = [];
  state.teams = [];
  state.metrics = null;
  render();
}

async function loadAudit() {
  state.audit = await getJson("/api/audit");
  render();
}

async function fetchChatwootAudit() {
  if (!hasConnection()) return notify("Save Chatwoot connection first.", "warn");
  const data = await api("/api/chatwoot/audit", {
    connection: state.connection,
    actor: state.appContext?.currentAgent || { name: state.connection.operatorName || "Ops Admin" }
  });
  notify(`Fetched ${data.audit_logs?.length || 0} Enterprise audit rows.`, "ok");
  await loadAudit();
}

async function loadJobs() {
  state.jobs = await getJson("/api/jobs");
  render();
}

async function loadCampaigns() {
  state.campaigns = await getJson("/api/campaigns");
  render();
}

async function loadWebhooks() {
  state.webhooks = await getJson("/api/webhooks");
  render();
}

async function createCampaign() {
  const owner = state.agents.find(agent => String(agent.id) === String(value("campaignOwnerId")));
  await api("/api/campaigns", {
    name: value("campaignName"),
    chatwootCampaignId: value("chatwootCampaignId"),
    ownerId: value("campaignOwnerId"),
    ownerName: owner?.name || "",
    audience: value("campaignAudience"),
    actor: state.appContext?.currentAgent || { name: state.connection.operatorName || "Ops Admin" }
  });
  await loadCampaigns();
}

function getBulkCriteria() {
  return {
    scope: value("scope"),
    status: value("status"),
    fromAgentId: value("fromAgentId"),
    action: value("action"),
    targetAgentId: value("targetAgentId"),
    targetTeamId: value("targetTeamId"),
    ownerAttribute: value("ownerAttribute") || "sales_owner_id",
    ownerValue: value("fromAgentId"),
    includeContactConversations: Boolean(document.getElementById("includeContactConversations")?.checked),
    maxPages: Number(value("maxPages") || 20)
  };
}

function bindDashboardAppContext() {
  window.addEventListener("message", event => {
    if (typeof event.data !== "string") return;
    try {
      const parsed = JSON.parse(event.data);
      if (parsed.event === "appContext") {
        state.appContext = parsed.data;
        renderContextBox();
      }
    } catch {
      // Ignore non-JSON dashboard messages.
    }
  });
}

function requestDashboardContext() {
  window.parent?.postMessage("chatwoot-dashboard-app:fetch-info", "*");
  notify("Requested Chatwoot dashboard context.", "neutral");
}

function renderContextBox() {
  const box = document.getElementById("dashboard-context");
  if (!box) return;
  const agent = state.appContext?.currentAgent;
  const contact = state.appContext?.contact;
  const conversation = state.appContext?.conversation;
  box.innerHTML = agent || contact || conversation
    ? `<strong>Dashboard context</strong><br>Agent: ${escapeHtml(agent?.name || "-")}<br>Contact: ${escapeHtml(contact?.name || "-")}<br>Conversation: ${conversation?.id || "-"}`
    : `<strong>Dashboard context</strong><br><span>No embedded context received.</span>`;
}

function reportsTable() {
  const reports = state.metrics?.reports || {};
  const rows = Object.entries(reports).map(([metric, value]) => ({
    metric,
    points: Array.isArray(value) ? value.length : "-",
    status: value?.error ? value.error : "ok"
  }));
  return simpleTable(rows, ["metric", "points", "status"]);
}

function contextDetails() {
  if (!state.appContext) return `<p class="notice">Open this app as a Chatwoot Dashboard App to receive conversation, contact, and currentAgent context.</p>`;
  return `<pre>${escapeHtml(JSON.stringify(state.appContext, null, 2))}</pre>`;
}

function previewTable() {
  if (!state.preview) return `<p class="notice">Run Preview to see affected conversations or contacts before any write action.</p>`;
  const warnings = (state.preview.warnings || []).map(item => `<p class="notice warn">${escapeHtml(item)}</p>`).join("");
  return `${warnings}${simpleTable(state.preview.items.slice(0, 100), ["type", "conversationId", "contactId", "contactName", "status", "assigneeName", "source"])}`;
}

function jobsTable() {
  return simpleTable(state.jobs, ["createdAt", "action", "total", "succeeded", "failed", "id"], row => (
    `<a href="/api/jobs/${row.id}/export.csv">Download</a>`
  ));
}

function simpleTable(rows, keys, extraCell) {
  if (!rows || rows.length === 0) return `<p class="notice">No rows yet.</p>`;
  return `
    <div class="table-wrap">
      <table>
        <thead><tr>${keys.map(key => `<th>${key}</th>`).join("")}${extraCell ? "<th>Export</th>" : ""}</tr></thead>
        <tbody>
          ${rows.map(row => `<tr>${keys.map(key => `<td>${escapeHtml(readPath(row, key) ?? "")}</td>`).join("")}${extraCell ? `<td>${extraCell(row)}</td>` : ""}</tr>`).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function stat(label, value) {
  return `<section class="panel stat"><span>${label}</span><strong>${escapeHtml(value)}</strong></section>`;
}

function inputField(id, label, defaultValue = "", type = "text") {
  return `<label class="field" for="${id}"><span>${label}</span><input id="${id}" type="${type}" value="${escapeHtml(defaultValue)}"></label>`;
}

function selectField(id, label, options, selected = "") {
  return `<label class="field" for="${id}"><span>${label}</span><select id="${id}">${options.map(([value, text]) => `<option value="${value}" ${String(value) === String(selected || "") ? "selected" : ""}>${text}</option>`).join("")}</select></label>`;
}

function agentSelect(id, label, selected = "") {
  const options = [["", "Select agent"], ...state.agents.map(agent => [agent.id, `${agent.name} (${agent.email})`])];
  return selectField(id, label, options, selected);
}

function teamSelect(id, label, selected = "") {
  const options = [["", "Select team"], ...state.teams.map(team => [team.id, team.name])];
  return selectField(id, label, options, selected);
}

async function api(path, body) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body || {})
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
}

async function getJson(path) {
  const response = await fetch(path);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
}

function loadConnection() {
  try {
    return JSON.parse(localStorage.getItem("chatwootOpsConnection") || "{}");
  } catch {
    return {};
  }
}

function hasConnection() {
  return Boolean(state.connection.baseUrl && state.connection.accountId && state.connection.apiToken);
}

function value(id) {
  return document.getElementById(id)?.value || "";
}

function readPath(row, path) {
  return path.split(".").reduce((value, key) => value?.[key], row);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function notify(message, type = "neutral") {
  const stateEl = document.getElementById("connection-state");
  stateEl.textContent = message;
  stateEl.className = `pill ${type === "bad" ? "bad" : type === "ok" ? "ok" : type === "warn" ? "warn" : "neutral"}`;
}
