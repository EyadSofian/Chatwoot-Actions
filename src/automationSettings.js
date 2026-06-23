const DEFAULT_UNAVAILABLE_STATUSES = ["offline", "busy", "away", "unavailable", "missing"];
const DEFAULT_BUSINESS_DAYS = ["0", "1", "2", "3", "4", "5", "6"];
const DEFAULT_BOTPRESS_BUSINESS_DAYS = ["0", "1", "2", "3", "4", "6"];
const DEFAULT_BOTPRESS_IN_HOURS_QUEUE_MESSAGE = `سيتم التواصل معكم في أقرب وقت.
نقدر صبركم.`;
const DEFAULT_BOTPRESS_OUTSIDE_HOURS_MESSAGE = `شكراً لتواصلكم معنا،

حالياً أنتم تتواصلون خارج أوقات العمل الرسمية، والتي تمتد من 10:00 صباحاً حتى 9:00 مساءً طوال أيام الأسبوع ما عدا الجمعة.

تم استلام رسالتكم وسيقوم أحد أعضاء فريقنا بالتواصل معكم في أقرب وقت ممكن خلال ساعات العمل.

مع خالص التقدير،

فريق تشغيل إنجوسوفت`;

export function defaultAutomationSettings(env = process.env) {
  return {
    department: {
      enabled: parseBoolean(env.DEPARTMENT_ROUTER_ENABLED, false),
      inboxIds: parseList(env.DEPARTMENT_ROUTER_INBOX_IDS, []),
      salesTeamId: stringValue(env.DEPARTMENT_ROUTER_SALES_TEAM_ID),
      operationsTeamId: stringValue(env.DEPARTMENT_ROUTER_OPERATIONS_TEAM_ID),
      salesAgentIds: parseList(env.DEPARTMENT_ROUTER_SALES_AGENT_IDS, []),
      operationsAgentIds: parseList(env.DEPARTMENT_ROUTER_OPERATIONS_AGENT_IDS, []),
      promptOnNew: parseBoolean(env.DEPARTMENT_ROUTER_PROMPT_ON_NEW, true),
      promptOnResolved: parseBoolean(env.DEPARTMENT_ROUTER_PROMPT_ON_RESOLVED, true),
      newContactsOnly: parseBoolean(env.DEPARTMENT_ROUTER_NEW_CONTACTS_ONLY, true),
      skipCampaigns: parseBoolean(env.DEPARTMENT_ROUTER_SKIP_CAMPAIGNS, true),
      assignAgent: parseBoolean(env.DEPARTMENT_ROUTER_ASSIGN_AGENT, true),
      confirmSelection: parseBoolean(env.DEPARTMENT_ROUTER_CONFIRM_SELECTION, true),
      businessHoursEnabled: parseBoolean(env.DEPARTMENT_ROUTER_BUSINESS_HOURS_ENABLED, false),
      businessTimezone: stringValue(env.DEPARTMENT_ROUTER_BUSINESS_TIMEZONE, "Africa/Cairo"),
      businessStart: stringValue(env.DEPARTMENT_ROUTER_BUSINESS_START, "09:00"),
      businessEnd: stringValue(env.DEPARTMENT_ROUTER_BUSINESS_END, "22:00"),
      businessDays: parseList(env.DEPARTMENT_ROUTER_BUSINESS_DAYS, DEFAULT_BUSINESS_DAYS),
      salesAssignmentMode: stringValue(env.DEPARTMENT_ROUTER_SALES_ASSIGNMENT_MODE, "online"),
      complaintAgentId: stringValue(env.DEPARTMENT_ROUTER_COMPLAINT_AGENT_ID),
      complaintAgentEmail: stringValue(env.DEPARTMENT_ROUTER_COMPLAINT_AGENT_EMAIL),
      complaintAgentName: stringValue(env.DEPARTMENT_ROUTER_COMPLAINT_AGENT_NAME, "Abdelrahman Tarek"),
      promptText: stringValue(env.DEPARTMENT_ROUTER_PROMPT_TEXT,
        "للمبيعات و العروض الجديدة اضغط 1\nلدعم المتدربين اضغط 2\nللشكاوي اضغط 3"),
      salesConfirmationText: stringValue(env.DEPARTMENT_ROUTER_SALES_CONFIRMATION_TEXT,
        "سيتم التواصل معكم سريعا\nنقدر صبرك"),
      operationsConfirmationText: stringValue(env.DEPARTMENT_ROUTER_OPERATIONS_CONFIRMATION_TEXT,
        "تم تحويل محادثتك إلى فريق العمليات، وسيتم الرد عليك في أقرب وقت."),
      operationsDataPromptText: stringValue(env.DEPARTMENT_ROUTER_OPERATIONS_DATA_PROMPT_TEXT,
        "لتتمكن من مساعدتكم سريعا يرجى تزويدنا بالبيانات التالية\n1. الاسم الثلاثي\n2. رقم الهاتف الذي تم التسجيل به\n3. الدورة التي تم حجزها"),
      complaintIntroText: stringValue(env.DEPARTMENT_ROUTER_COMPLAINT_INTRO_TEXT,
        "يرجى العلم أن هذا الاختيار يتعلق بالشكاوي فقط و سيتم الرد عليكم من 48 إلى 72 ساعة عمل\nو في حالة إن أردتم حل مشكلة متعلقة بالدورة يرجى اختيار دعم المتدربين و ذلك للرد الفوري\nلدعم المتدربين اضغط 1\nلتأكيد اختيار قسم الشكاوي اضغط 2"),
      complaintDataPromptText: stringValue(env.DEPARTMENT_ROUTER_COMPLAINT_DATA_PROMPT_TEXT,
        "يرجى تزويدنا بالبيانات التالية\n1. الاسم الثلاثي\n2. رقم الهاتف الذي تم التسجيل به\n3. الدورة التي تم حجزها\n4. ملخص الشكوى"),
      complaintReceivedText: stringValue(env.DEPARTMENT_ROUTER_COMPLAINT_RECEIVED_TEXT,
        "تم إستلام الشكوى و سيتم الرد عليكم من 48 إلى 72 ساعة عمل"),
      rerouteUnavailableManualAssignments: parseBoolean(
        env.DEPARTMENT_ROUTER_REROUTE_UNAVAILABLE_MANUAL_ASSIGNMENTS,
        false
      ),
      manualAssignmentUnavailableStatuses: parseList(
        env.DEPARTMENT_ROUTER_MANUAL_ASSIGNMENT_UNAVAILABLE_STATUSES,
        DEFAULT_UNAVAILABLE_STATUSES
      ),
      unavailableManualFallback: stringValue(
        env.DEPARTMENT_ROUTER_UNAVAILABLE_MANUAL_FALLBACK,
        "unassign"
      )
    },
    reopen: {
      enabled: parseBoolean(env.REOPEN_ROUTER_ENABLED, false),
      inboxIds: parseList(env.REOPEN_ROUTER_INBOX_IDS, []),
      teamId: stringValue(env.REOPEN_ROUTER_TEAM_ID),
      agentIds: parseList(env.REOPEN_ROUTER_AGENT_IDS, []),
      unavailableStatuses: parseList(env.REOPEN_ROUTER_STATUSES, DEFAULT_UNAVAILABLE_STATUSES),
      fallback: stringValue(env.REOPEN_ROUTER_FALLBACK, "unassign"),
      assignUnassigned: parseBoolean(env.REOPEN_ROUTER_ASSIGN_UNASSIGNED, true),
      cooldownSeconds: numberValue(env.REOPEN_ROUTER_COOLDOWN_SECONDS, 60),
      skipCampaigns: parseBoolean(env.REOPEN_ROUTER_SKIP_CAMPAIGNS, true)
    },
    botpress: {
      enabled: parseBoolean(env.BOTPRESS_CLOUD_ENABLED, false),
      skipBroadcasts: parseBoolean(env.BOTPRESS_CLOUD_SKIP_BROADCASTS, true),
      requireResolvedReentry: parseBoolean(env.BOTPRESS_CLOUD_REQUIRE_RESOLVED_REENTRY, true),
      workingHoursEnabled: parseBoolean(env.BOTPRESS_CLOUD_WORKING_HOURS_ENABLED, true),
      timezone: stringValue(env.BOTPRESS_CLOUD_TIMEZONE, "Africa/Cairo"),
      start: stringValue(env.BOTPRESS_CLOUD_START, "10:00"),
      end: stringValue(env.BOTPRESS_CLOUD_END, "21:00"),
      days: parseList(env.BOTPRESS_CLOUD_DAYS, DEFAULT_BOTPRESS_BUSINESS_DAYS),
      inHoursQueueMessage: stringValue(
        env.BOTPRESS_CLOUD_IN_HOURS_QUEUE_MESSAGE,
        DEFAULT_BOTPRESS_IN_HOURS_QUEUE_MESSAGE
      ),
      outsideHoursMessage: stringValue(
        env.BOTPRESS_CLOUD_OUTSIDE_HOURS_MESSAGE,
        DEFAULT_BOTPRESS_OUTSIDE_HOURS_MESSAGE
      ),
      outsideHoursMode: stringValue(env.BOTPRESS_CLOUD_OUTSIDE_HOURS_MODE, "send_message")
    }
  };
}

export function mergeAutomationSettings(saved = null, env = process.env) {
  const defaults = defaultAutomationSettings(env);
  if (!saved || typeof saved !== "object") return defaults;
  return normalizeAutomationSettings({
    department: { ...defaults.department, ...(saved.department || {}) },
    reopen: { ...defaults.reopen, ...(saved.reopen || {}) },
    botpress: { ...defaults.botpress, ...(saved.botpress || {}) }
  }, env);
}

export function normalizeAutomationSettings(settings = {}, env = process.env) {
  const defaults = defaultAutomationSettings(env);
  const department = { ...defaults.department, ...(settings.department || {}) };
  const reopen = { ...defaults.reopen, ...(settings.reopen || {}) };
  const botpress = { ...defaults.botpress, ...(settings.botpress || {}) };

  return {
    department: {
      enabled: Boolean(department.enabled),
      inboxIds: parseList(department.inboxIds, []),
      salesTeamId: stringValue(department.salesTeamId),
      operationsTeamId: stringValue(department.operationsTeamId),
      salesAgentIds: parseList(department.salesAgentIds, []),
      operationsAgentIds: parseList(department.operationsAgentIds, []),
      promptOnNew: Boolean(department.promptOnNew),
      promptOnResolved: Boolean(department.promptOnResolved),
      newContactsOnly: Boolean(department.newContactsOnly),
      skipCampaigns: Boolean(department.skipCampaigns),
      assignAgent: Boolean(department.assignAgent),
      confirmSelection: Boolean(department.confirmSelection),
      businessHoursEnabled: Boolean(department.businessHoursEnabled),
      businessTimezone: stringValue(department.businessTimezone, defaults.department.businessTimezone),
      businessStart: stringValue(department.businessStart, defaults.department.businessStart),
      businessEnd: stringValue(department.businessEnd, defaults.department.businessEnd),
      businessDays: parseList(department.businessDays, DEFAULT_BUSINESS_DAYS),
      salesAssignmentMode: normalizeChoice(department.salesAssignmentMode, ["online", "any_status"], "online"),
      complaintAgentId: stringValue(department.complaintAgentId),
      complaintAgentEmail: stringValue(department.complaintAgentEmail).toLowerCase(),
      complaintAgentName: stringValue(department.complaintAgentName, defaults.department.complaintAgentName),
      promptText: stringValue(department.promptText, defaults.department.promptText),
      salesConfirmationText: stringValue(department.salesConfirmationText, defaults.department.salesConfirmationText),
      operationsConfirmationText: stringValue(department.operationsConfirmationText, defaults.department.operationsConfirmationText),
      operationsDataPromptText: stringValue(department.operationsDataPromptText, defaults.department.operationsDataPromptText),
      complaintIntroText: stringValue(department.complaintIntroText, defaults.department.complaintIntroText),
      complaintDataPromptText: stringValue(department.complaintDataPromptText, defaults.department.complaintDataPromptText),
      complaintReceivedText: stringValue(department.complaintReceivedText, defaults.department.complaintReceivedText),
      rerouteUnavailableManualAssignments: Boolean(department.rerouteUnavailableManualAssignments),
      manualAssignmentUnavailableStatuses: parseList(
        department.manualAssignmentUnavailableStatuses,
        DEFAULT_UNAVAILABLE_STATUSES
      ).map(value => value.toLowerCase()),
      unavailableManualFallback: normalizeChoice(department.unavailableManualFallback, ["unassign", "prompt", "ignore"], "unassign")
    },
    reopen: {
      enabled: Boolean(reopen.enabled),
      inboxIds: parseList(reopen.inboxIds, []),
      teamId: stringValue(reopen.teamId),
      agentIds: parseList(reopen.agentIds, []),
      unavailableStatuses: parseList(reopen.unavailableStatuses, DEFAULT_UNAVAILABLE_STATUSES).map(value => value.toLowerCase()),
      fallback: normalizeChoice(reopen.fallback, ["unassign", "team", "none"], "unassign"),
      assignUnassigned: Boolean(reopen.assignUnassigned),
      cooldownSeconds: numberValue(reopen.cooldownSeconds, 60),
      skipCampaigns: Boolean(reopen.skipCampaigns)
    },
    botpress: {
      enabled: Boolean(botpress.enabled),
      skipBroadcasts: Boolean(botpress.skipBroadcasts),
      requireResolvedReentry: Boolean(botpress.requireResolvedReentry),
      workingHoursEnabled: Boolean(botpress.workingHoursEnabled),
      timezone: stringValue(botpress.timezone, defaults.botpress.timezone),
      start: stringValue(botpress.start, defaults.botpress.start),
      end: stringValue(botpress.end, defaults.botpress.end),
      days: parseList(botpress.days, DEFAULT_BOTPRESS_BUSINESS_DAYS),
      inHoursQueueMessage: stringValue(botpress.inHoursQueueMessage, defaults.botpress.inHoursQueueMessage),
      outsideHoursMessage: stringValue(botpress.outsideHoursMessage, defaults.botpress.outsideHoursMessage),
      outsideHoursMode: normalizeChoice(botpress.outsideHoursMode, ["send_message", "return_only"], "send_message")
    }
  };
}

export function automationSettingsToRouterOptions(settings = {}) {
  const normalized = normalizeAutomationSettings(settings, {});
  return {
    department: {
      ...normalized.department,
      businessHoursEnabled: normalized.department.businessHoursEnabled,
      businessTimezone: normalized.department.businessTimezone,
      businessStart: normalized.department.businessStart,
      businessEnd: normalized.department.businessEnd,
      businessDays: normalized.department.businessDays,
      reassignUnavailableManualAssignments: normalized.department.rerouteUnavailableManualAssignments
    },
    reopen: normalized.reopen,
    botpress: normalized.botpress
  };
}

function parseBoolean(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  return ["1", "true", "yes", "on", "enabled"].includes(String(value).trim().toLowerCase());
}

function parseList(value, fallback = []) {
  if (value === undefined || value === null || value === "") return [...fallback];
  return asArray(value)
    .flatMap(item => String(item).split(/[,\s]+/))
    .map(item => item.trim())
    .filter(Boolean);
}

function stringValue(value, fallback = "") {
  if (value === undefined || value === null || value === "") return fallback;
  return String(value);
}

function numberValue(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeChoice(value, allowed, fallback) {
  const normalized = stringValue(value, fallback).toLowerCase();
  return allowed.includes(normalized) ? normalized : fallback;
}

function asArray(value) {
  return Array.isArray(value) ? value : [value];
}
