const state = {
  tab: "actions",
  lang: loadLanguage(),
  connection: loadConnection(),
  agents: [],
  teams: [],
  inboxes: [],
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
    inboxId: "",
    action: "assign_agent",
    ownerAttribute: "sales_owner_id",
    maxPages: 20
  }
};

const translations = {
  ar: {
    "Actions": "الإجراءات",
    "Dashboard": "لوحة المتابعة",
    "Campaigns": "الحملات",
    "Logs": "السجل",
    "Exports": "التصدير",
    "Setup": "الإعداد",
    "Run bulk transfers safely in three steps: choose, preview, execute.": "نفذ التحويلات الجماعية بأمان في ثلاث خطوات: اختار، راجع، نفذ.",
    "Counters, report snapshots, and Chatwoot embedded context.": "أرقام سريعة، تقارير، وسياق Chatwoot داخل التطبيق.",
    "Track local campaigns and Chatwoot webhook reply signals.": "تابع الحملات المحلية وردود العملاء من Webhooks.",
    "Who did what, when, and which bulk job changed it.": "اعرف مين عمل إيه، إمتى، وأي عملية جماعية نفذتها.",
    "Download CSV files for audit logs, campaigns, and bulk jobs.": "حمل ملفات CSV للسجل والحملات والعمليات الجماعية.",
    "Connect this app to your self-hosted Chatwoot instance.": "اربط التطبيق بنسخة Chatwoot self-hosted.",
    "Transfer to agent": "تحويل لموظف",
    "Agent": "موظف",
    "Move all selected conversations from one sales/agent to another.": "انقل المحادثات المختارة من موظف أو سيلز لموظف آخر.",
    "Remove assignee": "إزالة التعيين",
    "Unassign": "بدون تعيين",
    "Take conversations away from an agent and return them to Unassigned.": "شيل المحادثات من الموظف ورجعها بدون تعيين.",
    "Move to team": "تحويل لفريق",
    "Team": "فريق",
    "Route a batch of conversations to a team queue.": "حول مجموعة محادثات إلى Queue فريق معين.",
    "Transfer customer owner": "تحويل مسؤول العميل",
    "Owner": "مسؤول",
    "Change the contact owner custom attribute, with optional conversation reassignment.": "غير مسؤول العميل في custom attribute مع إمكانية تحويل محادثاته.",
    "Quick actions": "إجراءات سريعة",
    "Pick the job you want. Nothing is changed until you preview and confirm.": "اختار العملية المطلوبة. مفيش أي تغيير بيحصل غير بعد المعاينة والتأكيد.",
    "Connected": "متصل",
    "Needs setup": "محتاج إعداد",
    "How it works": "طريقة العمل",
    "Choose action": "اختار الإجراء",
    "Select transfer, unassign, team routing, or contact owner transfer.": "اختار تحويل، إزالة تعيين، تحويل لفريق، أو تحويل مسؤول العميل.",
    "Preview": "معاينة",
    "The app asks Chatwoot for matching conversations/customers and shows the exact rows.": "التطبيق يجيب من Chatwoot العملاء أو المحادثات المطابقة ويعرضها قبل التنفيذ.",
    "Execute": "تنفيذ",
    "Only after confirmation, it calls Chatwoot assignment/contact APIs and logs every row.": "بعد التأكيد فقط، التطبيق ينفذ من خلال APIs ويسجل كل صف اتغير.",
    "For Chatwoot Dashboard App usage: add the Railway URL in Chatwoot Settings -> Integrations -> Dashboard Apps.": "لاستخدامه داخل Chatwoot: ضيف رابط Railway من Settings -> Integrations -> Dashboard Apps.",
    "Bulk action": "إجراء جماعي",
    "previewed": "تمت معاينتها",
    "Preview affected rows": "معاينة الصفوف المتأثرة",
    "Execute confirmed action": "تنفيذ الإجراء المؤكد",
    "Preview before execution": "المعاينة قبل التنفيذ",
    "Review the first 100 affected rows. Export full results after execution.": "راجع أول 100 صف متأثر. تقدر تصدر النتائج كاملة بعد التنفيذ.",
    "rows": "صف",
    "Open": "مفتوحة",
    "Unassigned": "غير معينة",
    "Unattended": "بدون متابعة",
    "Chatwoot Reports": "تقارير Chatwoot",
    "Load reports": "تحميل التقارير",
    "Dashboard App Context": "سياق Dashboard App",
    "Request context": "طلب السياق",
    "Create Local Campaign Tracker": "إنشاء متابعة حملة محلية",
    "Campaign name": "اسم الحملة",
    "May outbound": "حملة مايو",
    "Chatwoot campaign ID": "رقم حملة Chatwoot",
    "Owner / sales": "المسؤول / السيلز",
    "Audience note": "ملاحظة الجمهور",
    "VIP label": "عملاء VIP",
    "Create tracker": "إنشاء المتابعة",
    "Configure Chatwoot webhooks to call": "اضبط Chatwoot webhooks عشان تستدعي",
    "for message_created and message_updated events.": "لأحداث message_created و message_updated.",
    "Webhook Events": "أحداث Webhook",
    "Load events": "تحميل الأحداث",
    "Refresh": "تحديث",
    "Action Log": "سجل الإجراءات",
    "Fetch Chatwoot audit": "جلب Audit من Chatwoot",
    "CSV Downloads": "تحميل CSV",
    "Audit CSV": "سجل الإجراءات CSV",
    "Campaign CSV": "الحملات CSV",
    "Bulk jobs": "العمليات الجماعية",
    "Chatwoot connection": "اتصال Chatwoot",
    "These values can also live in Railway environment variables.": "القيم دي ممكن تتحط كمان في Environment Variables على Railway.",
    "Chatwoot base URL": "رابط Chatwoot الأساسي",
    "Account ID": "رقم الحساب",
    "User access token": "توكن المستخدم",
    "Operator name": "اسم المشغل",
    "Save and test": "حفظ وتجربة",
    "Clear local settings": "مسح الإعدادات المحلية",
    "Add it inside Chatwoot": "إضافته داخل Chatwoot",
    "Open Chatwoot": "افتح Chatwoot",
    "Go to Settings -> Integrations -> Dashboard Apps.": "ادخل Settings -> Integrations -> Dashboard Apps.",
    "Add app URL": "ضيف رابط التطبيق",
    "Paste your Railway public URL, then save.": "حط رابط Railway العام واعمل حفظ.",
    "Open any conversation": "افتح أي محادثة",
    "A new tab appears in the conversation panel and sends context to this app.": "هيظهر Tab جديد داخل المحادثة ويبعت السياق للتطبيق.",
    "Keep OPS_PASSWORD enabled on Railway. Chatwoot will ask for the same username/password the first time the embedded tab opens.": "خلي OPS_PASSWORD شغال على Railway. أول مرة التاب يفتح داخل Chatwoot هيطلب نفس اسم المستخدم وكلمة السر.",
    "Connected config": "الإعدادات متصلة",
    "Not connected": "غير متصل",
    "Save Chatwoot connection first.": "احفظ اتصال Chatwoot الأول.",
    "Connection saved locally.": "تم حفظ الاتصال محليًا.",
    "Requested Chatwoot dashboard context.": "تم طلب سياق Chatwoot.",
    "Fetched {count} Enterprise audit rows.": "تم جلب {count} سجل Audit من Enterprise.",
    "Bulk job finished: {succeeded}/{total} succeeded.": "انتهت العملية: {succeeded}/{total} تمت بنجاح.",
    "Execute {action} on {count} item(s)?": "تنفذ {action} على {count} عنصر؟",
    "Dashboard context": "سياق Chatwoot",
    "No embedded context received.": "لم يصل سياق من Chatwoot.",
    "Open this app as a Chatwoot Dashboard App to receive conversation, contact, and currentAgent context.": "افتح التطبيق كـ Dashboard App داخل Chatwoot عشان يستقبل بيانات المحادثة والعميل والموظف الحالي.",
    "Preview first. The app will show exactly which conversations/customers are affected before it writes anything.": "اعمل معاينة الأول. التطبيق هيعرض بالظبط المحادثات أو العملاء المتأثرين قبل أي تعديل.",
    "Running inside Chatwoot": "يعمل داخل Chatwoot",
    "Standalone mode": "وضع منفصل",
    "It works from Railway now. To make it feel native in Chatwoot, add this URL as a Dashboard App.": "التطبيق شغال من Railway حاليًا. عشان يبقى داخل Chatwoot، ضيف الرابط كـ Dashboard App.",
    "Refresh context": "تحديث السياق",
    "Setup guide": "شرح الإعداد",
    "1. Action": "1. الإجراء",
    "2. Filters": "2. الفلاتر",
    "3. Preview": "3. المعاينة",
    "4. Execute": "4. التنفيذ",
    "What should be changed?": "إيه اللي هيتغير؟",
    "Conversations": "المحادثات",
    "Customer owner field": "مسؤول العميل",
    "Conversation status": "حالة المحادثة",
    "Pending": "معلقة",
    "Resolved": "مغلقة",
    "Snoozed": "مؤجلة",
    "All": "الكل",
    "Current owner / from sales": "المسؤول الحالي / من سيلز",
    "Current assignee": "الموظف الحالي",
    "Inbox": "الإنبوكس",
    "All inboxes": "كل الإنبوكسات",
    "Action": "الإجراء",
    "Transfer owner": "تحويل المسؤول",
    "Remove owner": "إزالة المسؤول",
    "Remove assignee": "إزالة التعيين",
    "New owner / to sales": "المسؤول الجديد / إلى سيلز",
    "New assignee": "الموظف الجديد",
    "Target team": "الفريق المستهدف",
    "Owner custom attribute": "Custom attribute للمسؤول",
    "Search limit: Chatwoot API pages": "حد البحث: صفحات API من Chatwoot",
    "Chatwoot sends results in pages. 20 means scan up to 20 API pages, then stop for safety. This does not execute anything.": "Chatwoot بيرجع النتائج على صفحات. رقم 20 يعني التطبيق يفحص لحد 20 صفحة API ثم يتوقف للأمان. ده لا ينفذ أي تعديل.",
    "Conversation mode finds conversations assigned to the selected agent. Use this for moving chats from one employee to another.": "وضع المحادثات بيجيب المحادثات المعينة للموظف المختار. استخدمه لو عايز تنقل شاتات من موظف لموظف.",
    "Customer owner mode only finds contacts that already have this custom attribute. If you never filled sales_owner_id, preview can be zero.": "وضع مسؤول العميل بيجيب العملاء اللي عندهم الـ custom attribute ده بالفعل. لو sales_owner_id مش متسجل قبل كده، المعاينة ممكن تطلع صفر.",
    "No rows matched these filters. Try Status = All, remove the inbox filter, or confirm the current assignee/owner is correct.": "مفيش صفوف مطابقة للفلاتر دي. جرّب الحالة = الكل، أو شيل فلتر الإنبوكس، أو اتأكد إن الموظف/المسؤول الحالي صحيح.",
    "Also reassign conversations for these customers": "حوّل محادثات العملاء دول كمان",
    "Tip: start with Open conversations and a small page limit. After Preview looks correct, increase the limit and execute.": "نصيحة: ابدأ بالمحادثات المفتوحة وحد صفحات صغير. بعد ما المعاينة تبقى مظبوطة، زود الحد ونفذ.",
    "Select agent": "اختار موظف",
    "Select team": "اختار فريق",
    "No rows yet.": "لا توجد بيانات بعد.",
    "Download": "تحميل",
    "createdAt": "تاريخ الإنشاء",
    "action": "الإجراء",
    "summary": "الملخص",
    "actor.name": "من نفذ",
    "metadata.jobId": "رقم العملية",
    "receivedAt": "وقت الاستلام",
    "event": "الحدث",
    "campaignId": "رقم الحملة",
    "name": "الاسم",
    "chatwootCampaignId": "رقم حملة Chatwoot",
    "ownerName": "المسؤول",
    "sentCount": "تم الإرسال",
    "deliveredCount": "تم التسليم",
    "repliedCount": "ردود",
    "failedCount": "فشل",
    "total": "الإجمالي",
    "succeeded": "نجح",
    "failed": "فشل",
    "id": "الرقم",
    "type": "النوع",
    "conversationId": "رقم المحادثة",
    "inboxId": "رقم الإنبوكس",
    "inboxName": "اسم الإنبوكس",
    "contactId": "رقم العميل",
    "contactName": "اسم العميل",
    "status": "الحالة",
    "assigneeName": "الموظف",
    "source": "المصدر",
    "metric": "المؤشر",
    "points": "النقاط",
    "Ops Console": "لوحة العمليات",
    "Bulk control for Chatwoot": "تحكم جماعي لـ Chatwoot"
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
  applyLocale();
  renderNav();
  bindDashboardAppContext();
  document.getElementById("language-toggle").addEventListener("click", toggleLanguage);
  document.getElementById("refresh-button").addEventListener("click", refreshActiveTab);
  render();
  refreshBaseData();
});

function renderNav() {
  const containers = [document.getElementById("nav"), document.getElementById("compact-nav")].filter(Boolean);
  containers.forEach(nav => {
    nav.innerHTML = tabs.map(([id, label]) => (
      `<button type="button" data-tab="${id}" class="${state.tab === id ? "active" : ""}">${tr(label)}</button>`
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
  document.getElementById("page-title").textContent = tr(title);
  document.getElementById("page-subtitle").textContent = tr(subtitle);
  document.getElementById("connection-state").textContent = hasConnection() ? tr("Connected config") : tr("Not connected");
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
            <h2>${tr("Quick actions")}</h2>
            <p class="panel-note">${tr("Pick the job you want. Nothing is changed until you preview and confirm.")}</p>
          </div>
          <span class="pill ${hasConnection() ? "ok" : "warn"}">${hasConnection() ? tr("Connected") : tr("Needs setup")}</span>
        </div>
        <div class="panel-body">
          <div class="action-cards">
            ${Object.entries(quickActions).map(([id, action]) => `
              <button class="action-card ${activePreset === id ? "active" : ""}" type="button" data-quick-action="${id}">
                <span>${tr(action.shortLabel)}</span>
                <strong>${tr(action.label)}</strong>
                <small>${tr(action.description)}</small>
              </button>
            `).join("")}
          </div>
        </div>
      </section>
      <aside class="guide-panel">
        <h2>${tr("How it works")}</h2>
        <ol class="steps-list">
          <li><strong>${tr("Choose action")}</strong><span>${tr("Select transfer, unassign, team routing, or contact owner transfer.")}</span></li>
          <li><strong>${tr("Preview")}</strong><span>${tr("The app asks Chatwoot for matching conversations/customers and shows the exact rows.")}</span></li>
          <li><strong>${tr("Execute")}</strong><span>${tr("Only after confirmation, it calls Chatwoot assignment/contact APIs and logs every row.")}</span></li>
        </ol>
        <p class="guide-note">${tr("For Chatwoot Dashboard App usage: add the Railway URL in Chatwoot Settings -> Integrations -> Dashboard Apps.")}</p>
      </aside>
    </div>
    <section class="panel" style="margin-top:16px">
      <div class="panel-header">
        <div>
          <h2>${tr(quickActions[activePreset]?.label || "Bulk action")}</h2>
          <p class="panel-note">${tr(quickActions[activePreset]?.description || "")}</p>
        </div>
        <span class="pill neutral">${state.preview?.count ?? 0} ${tr("previewed")}</span>
      </div>
      <div class="panel-body">
        ${workflowSteps()}
        ${actionForm(criteria)}
        <div class="actions sticky-actions">
          <button class="button" data-action="preview-bulk">${tr("Preview affected rows")}</button>
          <button class="button danger" data-action="execute-bulk" ${state.preview?.count ? "" : "disabled"}>${tr("Execute confirmed action")}</button>
        </div>
      </div>
    </section>
    <section class="panel" style="margin-top:16px">
      <div class="panel-header">
        <div>
          <h2>${tr("Preview before execution")}</h2>
          <p class="panel-note">${tr("Review the first 100 affected rows. Export full results after execution.")}</p>
        </div>
        ${state.preview ? `<span class="pill warn">${state.preview.count} ${tr("rows")}</span>` : ""}
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
        <div class="panel-header"><h2>${tr("Chatwoot Reports")}</h2><button class="button secondary" data-action="load-reports">${tr("Load reports")}</button></div>
        <div class="panel-body">${reportsTable()}</div>
      </section>
      <section class="panel">
        <div class="panel-header"><h2>${tr("Dashboard App Context")}</h2><button class="button secondary" data-action="request-context">${tr("Request context")}</button></div>
        <div class="panel-body">${contextDetails()}</div>
      </section>
    </div>
  `;
}

function bulkView() {
  return actionsView();
}

function toggleLanguage() {
  state.lang = state.lang === "ar" ? "en" : "ar";
  localStorage.setItem("chatwootOpsLanguage", state.lang);
  const url = new URL(window.location.href);
  url.searchParams.set("lang", state.lang);
  window.history.replaceState(null, "", url);
  applyLocale();
  render();
}

function applyLocale() {
  const isArabic = state.lang === "ar";
  document.documentElement.lang = isArabic ? "ar" : "en";
  document.documentElement.dir = isArabic ? "rtl" : "ltr";
  document.body.classList.toggle("rtl", isArabic);
  const brandTitle = document.getElementById("brand-title");
  const brandSubtitle = document.getElementById("brand-subtitle");
  const refreshButton = document.getElementById("refresh-button");
  const languageToggle = document.getElementById("language-toggle");
  if (brandTitle) brandTitle.textContent = tr("Ops Console");
  if (brandSubtitle) brandSubtitle.textContent = tr("Bulk control for Chatwoot");
  if (refreshButton) refreshButton.textContent = tr("Refresh");
  if (languageToggle) {
    languageToggle.textContent = isArabic ? "English" : "العربية";
    languageToggle.title = isArabic ? "Switch to English" : "التحويل للعربية";
  }
}

function campaignsView() {
  return `
    <div class="grid two">
      <section class="panel">
        <div class="panel-header"><h2>${tr("Create Local Campaign Tracker")}</h2></div>
        <div class="panel-body">
          <div class="form-grid">
            ${inputField("campaignName", "Campaign name", "May outbound")}
            ${inputField("chatwootCampaignId", "Chatwoot campaign ID", "")}
            ${agentSelect("campaignOwnerId", "Owner / sales")}
            ${inputField("campaignAudience", "Audience note", "VIP label")}
          </div>
          <div class="actions"><button class="button" data-action="create-campaign">${tr("Create tracker")}</button></div>
          <p class="notice">${tr("Configure Chatwoot webhooks to call")} <strong>/api/webhooks/chatwoot</strong> ${tr("for message_created and message_updated events.")}</p>
        </div>
      </section>
      <section class="panel">
        <div class="panel-header"><h2>${tr("Webhook Events")}</h2><button class="button secondary" data-action="load-webhooks">${tr("Load events")}</button></div>
        <div class="panel-body">${simpleTable(state.webhooks.slice(0, 8), ["receivedAt", "event", "campaignId"])}</div>
      </section>
    </div>
    <section class="panel" style="margin-top:16px">
      <div class="panel-header"><h2>${tr("Campaigns")}</h2><button class="button secondary" data-action="load-campaigns">${tr("Refresh")}</button></div>
      <div class="panel-body">${simpleTable(state.campaigns, ["createdAt", "name", "chatwootCampaignId", "ownerName", "sentCount", "deliveredCount", "repliedCount", "failedCount"])}</div>
    </section>
  `;
}

function auditView() {
  return `
    <section class="panel">
      <div class="panel-header">
        <h2>${tr("Action Log")}</h2>
        <div class="actions" style="margin:0">
          <button class="button secondary" data-action="fetch-chatwoot-audit">${tr("Fetch Chatwoot audit")}</button>
          <button class="button secondary" data-action="load-audit">${tr("Refresh")}</button>
        </div>
      </div>
      <div class="panel-body">${simpleTable(state.audit, ["createdAt", "action", "summary", "actor.name", "metadata.jobId"])}</div>
    </section>
  `;
}

function exportsView() {
  return `
    <section class="panel">
      <div class="panel-header"><h2>${tr("CSV Downloads")}</h2></div>
      <div class="panel-body">
        <div class="actions">
          <a class="button secondary" href="/api/audit/export.csv">${tr("Audit CSV")}</a>
          <a class="button secondary" href="/api/campaigns/export.csv">${tr("Campaign CSV")}</a>
        </div>
        <h3>${tr("Bulk jobs")}</h3>
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
            <h2>${tr("Chatwoot connection")}</h2>
            <p class="panel-note">${tr("These values can also live in Railway environment variables.")}</p>
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
            <button class="button" data-action="save-settings">${tr("Save and test")}</button>
            <button class="button secondary" data-action="clear-settings">${tr("Clear local settings")}</button>
          </div>
        </div>
      </section>
      <section class="panel">
        <div class="panel-header"><h2>${tr("Add it inside Chatwoot")}</h2></div>
        <div class="panel-body">
          <ol class="steps-list compact">
            <li><strong>${tr("Open Chatwoot")}</strong><span>${tr("Go to Settings -> Integrations -> Dashboard Apps.")}</span></li>
            <li><strong>${tr("Add app URL")}</strong><span>${tr("Paste your Railway public URL, then save.")}</span></li>
            <li><strong>${tr("Open any conversation")}</strong><span>${tr("A new tab appears in the conversation panel and sends context to this app.")}</span></li>
          </ol>
          <p class="notice">${tr("Keep OPS_PASSWORD enabled on Railway. Chatwoot will ask for the same username/password the first time the embedded tab opens.")}</p>
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
    state.inboxes = data.inboxes || [];
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
  if (!hasConnection()) return notify(tr("Save Chatwoot connection first."), "warn");
  const data = await api("/api/reports/summary", { connection: state.connection });
  state.metrics = data;
  render();
}

async function previewBulk() {
  if (!hasConnection()) return notify(tr("Save Chatwoot connection first."), "warn");
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
  const confirmed = window.confirm(tr("Execute {action} on {count} item(s)?", { action: criteria.action, count: state.preview.items.length }));
  if (!confirmed) return;
  const job = await api("/api/bulk/execute", {
    connection: state.connection,
    criteria,
    items: state.preview.items,
    actor
  });
  state.preview = null;
  await loadJobs();
  notify(tr("Bulk job finished: {succeeded}/{total} succeeded.", { succeeded: job.succeeded, total: job.total }), job.failed ? "warn" : "ok");
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
  notify(tr("Connection saved locally."), "ok");
}

function clearSettings() {
  localStorage.removeItem("chatwootOpsConnection");
  state.connection = {};
  state.agents = [];
  state.teams = [];
  state.inboxes = [];
  state.metrics = null;
  render();
}

async function loadAudit() {
  state.audit = await getJson("/api/audit");
  render();
}

async function fetchChatwootAudit() {
  if (!hasConnection()) return notify(tr("Save Chatwoot connection first."), "warn");
  const data = await api("/api/chatwoot/audit", {
    connection: state.connection,
    actor: state.appContext?.currentAgent || { name: state.connection.operatorName || "Ops Admin" }
  });
  notify(tr("Fetched {count} Enterprise audit rows.", { count: data.audit_logs?.length || 0 }), "ok");
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
    inboxId: value("inboxId"),
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

function loadLanguage() {
  const requested = new URLSearchParams(window.location.search).get("lang");
  if (requested === "ar" || requested === "en") return requested;
  const saved = localStorage.getItem("chatwootOpsLanguage");
  return saved === "ar" ? "ar" : "en";
}

function tr(text, values = {}) {
  const translated = state.lang === "ar" ? translations.ar[text] || text : text;
  return Object.entries(values).reduce(
    (output, [key, value]) => output.replaceAll(`{${key}}`, String(value)),
    translated
  );
}

function requestDashboardContext() {
  window.parent?.postMessage("chatwoot-dashboard-app:fetch-info", "*");
  notify(tr("Requested Chatwoot dashboard context."), "neutral");
}

function renderContextBox() {
  const box = document.getElementById("dashboard-context");
  if (!box) return;
  const agent = state.appContext?.currentAgent;
  const contact = state.appContext?.contact;
  const conversation = state.appContext?.conversation;
  box.innerHTML = agent || contact || conversation
    ? `<strong>${tr("Dashboard context")}</strong><br>${tr("Agent")}: ${escapeHtml(agent?.name || "-")}<br>${tr("contactName")}: ${escapeHtml(contact?.name || "-")}<br>${tr("conversationId")}: ${conversation?.id || "-"}`
    : `<strong>${tr("Dashboard context")}</strong><br><span>${tr("No embedded context received.")}</span>`;
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
  if (!state.appContext) return `<p class="notice">${tr("Open this app as a Chatwoot Dashboard App to receive conversation, contact, and currentAgent context.")}</p>`;
  return `<pre>${escapeHtml(JSON.stringify(state.appContext, null, 2))}</pre>`;
}

function previewTable() {
  if (!state.preview) return `<p class="notice">${tr("Preview first. The app will show exactly which conversations/customers are affected before it writes anything.")}</p>`;
  const warnings = (state.preview.warnings || []).map(item => `<p class="notice warn">${escapeHtml(item)}</p>`).join("");
  const emptyHint = state.preview.count === 0
    ? `<p class="notice warn">${tr("No rows matched these filters. Try Status = All, remove the inbox filter, or confirm the current assignee/owner is correct.")}</p>`
    : "";
  return `${warnings}${emptyHint}${simpleTable(state.preview.items.slice(0, 100), ["type", "conversationId", "inboxName", "inboxId", "contactId", "contactName", "status", "assigneeName", "source"])}`;
}

function embeddedBanner() {
  const agent = state.appContext?.currentAgent;
  const contact = state.appContext?.contact;
  const conversation = state.appContext?.conversation;
  if (agent || contact || conversation) {
    return `
      <section class="embed-banner connected">
        <div>
          <strong>${tr("Running inside Chatwoot")}</strong>
          <span>${tr("Agent")}: ${escapeHtml(agent?.name || "-")} - ${tr("contactName")}: ${escapeHtml(contact?.name || "-")} - ${tr("conversationId")}: ${conversation?.id || "-"}</span>
        </div>
        <button class="button secondary" data-action="request-context">${tr("Refresh context")}</button>
      </section>
    `;
  }

  return `
    <section class="embed-banner">
      <div>
        <strong>${tr("Standalone mode")}</strong>
        <span>${tr("It works from Railway now. To make it feel native in Chatwoot, add this URL as a Dashboard App.")}</span>
      </div>
      <button class="button secondary" data-open-tab="settings">${tr("Setup guide")}</button>
    </section>
  `;
}

function workflowSteps() {
  const hasPreview = Boolean(state.preview?.count);
  return `
    <div class="workflow">
      <span class="done">${tr("1. Action")}</span>
      <span class="done">${tr("2. Filters")}</span>
      <span class="${hasPreview ? "done" : ""}">${tr("3. Preview")}</span>
      <span>${tr("4. Execute")}</span>
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
      ${!isContacts ? inboxSelect("inboxId", "Inbox", criteria.inboxId) : ""}
      ${agentSelect("fromAgentId", isContacts ? "Current owner / from sales" : "Current assignee", criteria.fromAgentId)}
      ${selectField("action", "Action", actionOptions, action)}
      ${!isUnassign && !isTeam ? agentSelect("targetAgentId", isContacts ? "New owner / to sales" : "New assignee", criteria.targetAgentId) : ""}
      ${isTeam ? teamSelect("targetTeamId", "Target team", criteria.targetTeamId) : ""}
      ${isContacts ? inputField("ownerAttribute", "Owner custom attribute", criteria.ownerAttribute || "sales_owner_id") : ""}
      ${inputField("maxPages", "Search limit: Chatwoot API pages", criteria.maxPages || "20", "number")}
    </div>
    ${isContacts ? `
      <label class="field checkbox-field">
        <span><input type="checkbox" id="includeContactConversations" ${criteria.includeContactConversations ? "checked" : ""}> ${tr("Also reassign conversations for these customers")}</span>
      </label>
    ` : `<input type="checkbox" id="includeContactConversations" hidden ${criteria.includeContactConversations ? "checked" : ""}>`}
    <p class="notice">${tr(isContacts ? "Customer owner mode only finds contacts that already have this custom attribute. If you never filled sales_owner_id, preview can be zero." : "Conversation mode finds conversations assigned to the selected agent. Use this for moving chats from one employee to another.")}</p>
    <p class="notice">${tr("Chatwoot sends results in pages. 20 means scan up to 20 API pages, then stop for safety. This does not execute anything.")}</p>
  `;
}

function jobsTable() {
  return simpleTable(state.jobs, ["createdAt", "action", "total", "succeeded", "failed", "id"], row => (
    `<a href="/api/jobs/${row.id}/export.csv">${tr("Download")}</a>`
  ));
}

function simpleTable(rows, keys, extraCell) {
  if (!rows || rows.length === 0) return `<p class="notice">${tr("No rows yet.")}</p>`;
  return `
    <div class="table-wrap">
      <table>
        <thead><tr>${keys.map(key => `<th>${tr(key)}</th>`).join("")}${extraCell ? `<th>${tr("Exports")}</th>` : ""}</tr></thead>
        <tbody>
          ${rows.map(row => `<tr>${keys.map(key => `<td>${escapeHtml(readPath(row, key) ?? "")}</td>`).join("")}${extraCell ? `<td>${extraCell(row)}</td>` : ""}</tr>`).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function stat(label, value) {
  return `<section class="panel stat"><span>${tr(label)}</span><strong>${escapeHtml(value)}</strong></section>`;
}

function inputField(id, label, defaultValue = "", type = "text") {
  const translatedDefault = state.lang === "ar" ? tr(defaultValue) : defaultValue;
  return `<label class="field" for="${id}"><span>${tr(label)}</span><input id="${id}" type="${type}" value="${escapeHtml(translatedDefault)}"></label>`;
}

function selectField(id, label, options, selected = "") {
  return `<label class="field" for="${id}"><span>${tr(label)}</span><select id="${id}">${options.map(([value, text]) => `<option value="${value}" ${String(value) === String(selected || "") ? "selected" : ""}>${tr(text)}</option>`).join("")}</select></label>`;
}

function agentSelect(id, label, selected = "") {
  const options = [["", "Select agent"], ...state.agents.map(agent => [agent.id, `${agent.name} (${agent.email})`])];
  return selectField(id, label, options, selected);
}

function teamSelect(id, label, selected = "") {
  const options = [["", "Select team"], ...state.teams.map(team => [team.id, team.name])];
  return selectField(id, label, options, selected);
}

function inboxSelect(id, label, selected = "") {
  const options = [["", "All inboxes"], ...state.inboxes.map(inbox => [inbox.id, `${inbox.name} (${inbox.channel_type || inbox.channelType || "inbox"})`])];
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
