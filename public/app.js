const state = {
  tab: "actions",
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
  ["actions", "Actions"],
  ["dashboard", "Dashboard"],
  ["campaigns", "Campaigns"],
  ["audit", "Logs"],
  ["exports", "Exports"],
  ["settings", "Setup"]
];

const titles = {
  actions: ["Actions", "Run bulk transfers safely in three steps: choose, preview, execute."],
  dashboard: ["Dashboard", "Counters, report snapshots, and Chatwoot embedded context."],
  campaigns: ["Campaigns", "Track local campaigns and Chatwoot webhook reply signals."],
  audit: ["Logs", "Who did what, when, and which bulk job changed it."],
  exports: ["Exports", "Download CSV files for audit logs, campaigns, and bulk jobs."],
  settings: ["Setup", "Connect this app to your self-hosted Chatwoot instance."]
};

const quickActions = {
  assign_agent: {
    label: "Transfer to agent",
    shortLabel: "Agent",
    description: "Move all selected conversations from one sales/agent to another.",
    scope: "conversations"
  },
  unassign: {
    label: "Remove assignee",
    shortLabel: "Unassign",
    description: "Take conversations away from an agent and return them to Unassigned.",
    scope: "conversations"
  },
  assign_team: {
    label: "Move to team",
    shortLabel: "Team",
    description: "Route a batch of conversations to a team queue.",
    scope: "conversations"
  },
  contact_owner: {
    label: "Transfer customer owner",
    shortLabel: "Owner",
    description: "Change the contact owner custom attribute, with optional conversation reassignment.",
    scope: "contacts",
    action: "assign_agent"
  }
};

document.addEventListener("DOMContentLoaded", () => {
  setEmbeddedMode();
  renderNav();
  bindDashboardAppContext();
  document.getElementById("refresh-button").addEventListener("click", refreshActiveTab);
  render();
  refreshBaseData();
});

function renderNav() {
  const containers = [document.getElementById("nav"), document.getElementById("compact-nav")].filter(Boolean);
  containers.forEach(nav => {
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
  if (state.tab === "actions") view.innerHTML = actionsView();
  if (state.tab === "dashboard") view.innerHTML = dashboardView();
  if (state.tab === "campaigns") view.innerHTML = campaignsView();
  if (state.tab === "audit") view.innerHTML = auditView();
  if (state.tab === "exports") view.innerHTML = exportsView();
  if (state.tab === "settings") view.innerHTML = settingsView();
  bindViewEvents();
}

function actionsView() {
  const criteria = state.bulkCriteria;
  const activePreset = criteria.scope === "contacts" ? "contact_owner" : criteria.action || "assign_agent";
  return `
    ${embeddedBanner()}
    <div class="action-layout">
      <section class="panel action-panel">
        <div class="panel-header">
          <div>
            <h2>Quick actions</h2>
            <p class="panel-note">Pick the job you want. Nothing is changed until you preview and confirm.</p>
          </div>
          <span class="pill ${hasConnection() ? "ok" : "warn"}">${hasConnection() ? "Connected" : "Needs setup"}</span>
        </div>
        <div class="panel-body">
          <div class="action-cards">
            ${Object.entries(quickActions).map(([id, action]) => `
              <button class="action-card ${activePreset === id ? "active" : ""}" type="button" data-quick-action="${id}">
                <span>${action.shortLabel}</span>
                <strong>${action.label}</strong>
                <small>${action.description}</small>
              </button>
            `).join("")}
          </div>
        </div>
      </section>
      <aside class="guide-panel">
        <h2>How it works</h2>
        <ol class="steps-list">
          <li><strong>Choose action</strong><span>Select transfer, unassign, team routing, or contact owner transfer.</span></li>
          <li><strong>Preview</strong><span>The app asks Chatwoot for matching conversations/customers and shows the exact rows.</span></li>
          <li><strong>Execute</strong><span>Only after confirmation, it calls Chatwoot assignment/contact APIs and logs every row.</span></li>
        </ol>
        <p class="guide-note">For Chatwoot Dashboard App usage: add the Railway URL in Chatwoot Settings -> Integrations -> Dashboard Apps.</p>
      </aside>
    </div>
    <section class="panel" style="margin-top:16px">
      <div class="panel-header">
        <div>
          <h2>${quickActions[activePreset]?.label || "Bulk action"}</h2>
          <p class="panel-note">${quickActions[activePreset]?.description || ""}</p>
        </div>
        <span class="pill neutral">${state.preview?.count ?? 0} previewed</span>
      </div>
      <div class="panel-body">
        ${workflowSteps()}
        ${actionForm(criteria)}
        <div class="actions sticky-actions">
          <button class="button" data-action="preview-bulk">Preview affected rows</button>
          <button class="button danger" data-action="execute-bulk" ${state.preview?.count ? "" : "disabled"}>Execute confirmed action</button>
        </div>
      </div>
    </section>
    <section class="panel" style="margin-top:16px">
      <div class="panel-header">
        <div>
          <h2>Preview before execution</h2>
          <p class="panel-note">Review the first 100 affected rows. Export full results after execution.</p>
        </div>
        ${state.preview ? `<span class="pill warn">${state.preview.count} rows</span>` : ""}
      </div>
      <div class="panel-body">${previewTable()}</div>
    </section>
  `;
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
  return actionsView();
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
    <div class="grid two">
      <section class="panel">
        <div class="panel-header">
          <div>
            <h2>Chatwoot connection</h2>
            <p class="panel-note">These values can also live in Railway environment variables.</p>
          </div>
        </div>
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
      <section class="panel">
        <div class="panel-header"><h2>Add it inside Chatwoot</h2></div>
        <div class="panel-body">
          <ol class="steps-list compact">
            <li><strong>Open Chatwoot</strong><span>Go to Settings -> Integrations -> Dashboard Apps.</span></li>
            <li><strong>Add app URL</strong><span>Paste your Railway public URL, then save.</span></li>
            <li><strong>Open any conversation</strong><span>A new tab appears in the conversation panel and sends context to this app.</span></li>
          </ol>
          <p class="notice">Keep <code>OPS_PASSWORD</code> enabled on Railway. Chatwoot will ask for the same username/password the first time the embedded tab opens.</p>
        </div>
      </section>
    </div>
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

  document.querySelectorAll("[data-quick-action]").forEach(element => {
    element.addEventListener("click", event => {
      selectQuickAction(event.currentTarget.dataset.quickAction);
    });
  });

  document.querySelectorAll("[data-open-tab]").forEach(element => {
    element.addEventListener("click", event => {
      state.tab = event.currentTarget.dataset.openTab;
      render();
      refreshActiveTab();
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

function selectQuickAction(id) {
  const preset = quickActions[id];
  if (!preset) return;

  state.preview = null;
  state.bulkCriteria = {
    ...state.bulkCriteria,
    scope: preset.scope,
    action: preset.action || id,
    targetTeamId: id === "assign_team" ? state.bulkCriteria.targetTeamId : "",
    targetAgentId: id === "assign_agent" || id === "contact_owner" ? state.bulkCriteria.targetAgentId : "",
    includeContactConversations: id === "contact_owner" ? state.bulkCriteria.includeContactConversations : false
  };
  render();
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
  const scope = value("scope");
  let action = value("action");
  if (scope === "contacts" && action === "assign_team") action = "assign_agent";

  return {
    scope,
    status: value("status"),
    fromAgentId: value("fromAgentId"),
    action,
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
        document.body.classList.add("embedded");
        renderContextBox();
      }
    } catch {
      // Ignore non-JSON dashboard messages.
    }
  });
}

function setEmbeddedMode() {
  try {
    document.body.classList.toggle("embedded", window.parent !== window);
  } catch {
    document.body.classList.add("embedded");
  }
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
  if (!state.preview) return `<p class="notice">Preview first. The app will show exactly which conversations/customers are affected before it writes anything.</p>`;
  const warnings = (state.preview.warnings || []).map(item => `<p class="notice warn">${escapeHtml(item)}</p>`).join("");
  return `${warnings}${simpleTable(state.preview.items.slice(0, 100), ["type", "conversationId", "contactId", "contactName", "status", "assigneeName", "source"])}`;
}

function embeddedBanner() {
  const agent = state.appContext?.currentAgent;
  const contact = state.appContext?.contact;
  const conversation = state.appContext?.conversation;
  if (agent || contact || conversation) {
    return `
      <section class="embed-banner connected">
        <div>
          <strong>Running inside Chatwoot</strong>
          <span>Agent: ${escapeHtml(agent?.name || "-")} - Contact: ${escapeHtml(contact?.name || "-")} - Conversation: ${conversation?.id || "-"}</span>
        </div>
        <button class="button secondary" data-action="request-context">Refresh context</button>
      </section>
    `;
  }

  return `
    <section class="embed-banner">
      <div>
        <strong>Standalone mode</strong>
        <span>It works from Railway now. To make it feel native in Chatwoot, add this URL as a Dashboard App.</span>
      </div>
      <button class="button secondary" data-open-tab="settings">Setup guide</button>
    </section>
  `;
}

function workflowSteps() {
  const hasPreview = Boolean(state.preview?.count);
  return `
    <div class="workflow">
      <span class="done">1. Action</span>
      <span class="done">2. Filters</span>
      <span class="${hasPreview ? "done" : ""}">3. Preview</span>
      <span>4. Execute</span>
    </div>
  `;
}

function actionForm(criteria) {
  const isContacts = criteria.scope === "contacts";
  const action = isContacts && criteria.action === "assign_team" ? "assign_agent" : criteria.action;
  const actionOptions = isContacts
    ? [["assign_agent", "Transfer owner"], ["unassign", "Remove owner"]]
    : [["assign_agent", "Transfer to agent"], ["assign_team", "Move to team"], ["unassign", "Remove assignee"]];
  const isTeam = action === "assign_team";
  const isUnassign = action === "unassign";
  return `
    <div class="form-grid action-form">
      ${selectField("scope", "What should be changed?", [["conversations", "Conversations"], ["contacts", "Customer owner field"]], criteria.scope)}
      ${selectField("status", "Conversation status", [["open", "Open"], ["pending", "Pending"], ["resolved", "Resolved"], ["snoozed", "Snoozed"], ["all", "All"]], criteria.status)}
      ${agentSelect("fromAgentId", isContacts ? "Current owner / from sales" : "Current assignee", criteria.fromAgentId)}
      ${selectField("action", "Action", actionOptions, action)}
      ${!isUnassign && !isTeam ? agentSelect("targetAgentId", isContacts ? "New owner / to sales" : "New assignee", criteria.targetAgentId) : ""}
      ${isTeam ? teamSelect("targetTeamId", "Target team", criteria.targetTeamId) : ""}
      ${isContacts ? inputField("ownerAttribute", "Owner custom attribute", criteria.ownerAttribute || "sales_owner_id") : ""}
      ${inputField("maxPages", "Safety limit: pages to scan", criteria.maxPages || "20", "number")}
    </div>
    ${isContacts ? `
      <label class="field checkbox-field">
        <span><input type="checkbox" id="includeContactConversations" ${criteria.includeContactConversations ? "checked" : ""}> Also reassign conversations for these customers</span>
      </label>
    ` : `<input type="checkbox" id="includeContactConversations" hidden ${criteria.includeContactConversations ? "checked" : ""}>`}
    <p class="notice">Tip: start with Open conversations and a small page limit. After Preview looks correct, increase the limit and execute.</p>
  `;
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
