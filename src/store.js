import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const dataDir = process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || join(rootDir, "data");

const files = {
  audit: join(dataDir, "audit-log.json"),
  jobs: join(dataDir, "jobs.json"),
  webhooks: join(dataDir, "webhook-events.json"),
  campaigns: join(dataDir, "campaigns.json"),
  departmentRoutes: join(dataDir, "department-routes.json"),
  automationSettings: join(dataDir, "automation-settings.json"),
  metrics: join(dataDir, "metrics.json"),
  digestRecipients: join(dataDir, "digest-recipients.json"),
  digestState: join(dataDir, "digest-state.json")
};

const METRICS_STORE_LIMIT = Math.max(1000, Number(process.env.METRICS_STORE_LIMIT) || 50000);

export async function readCollection(name) {
  await ensureDataDir();
  try {
    const text = await readFile(files[name], "utf8");
    return JSON.parse(text);
  } catch {
    return [];
  }
}

export async function writeCollection(name, data) {
  await ensureDataDir();
  await writeFile(files[name], `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

export async function readAutomationSettings() {
  await ensureDataDir();
  try {
    const text = await readFile(files.automationSettings, "utf8");
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export async function writeAutomationSettings(settings, actor = null) {
  await ensureDataDir();
  const row = {
    ...settings,
    updatedAt: new Date().toISOString()
  };
  await writeFile(files.automationSettings, `${JSON.stringify(row, null, 2)}\n`, "utf8");
  await appendAudit({
    action: "automation_settings_saved",
    actor,
    summary: "Automation settings saved from the app",
    metadata: {
      departmentEnabled: Boolean(row.department?.enabled),
      reopenEnabled: Boolean(row.reopen?.enabled),
      botpressEnabled: Boolean(row.botpress?.enabled),
      inboxIds: row.department?.inboxIds || row.reopen?.inboxIds || []
    }
  });
  return row;
}

export async function appendAudit(entry) {
  const audit = await readCollection("audit");
  const row = {
    id: entry.id || createId("audit"),
    createdAt: new Date().toISOString(),
    ...entry
  };
  audit.unshift(row);
  await writeCollection("audit", audit.slice(0, 1000));
  return row;
}

export async function saveJob(job) {
  const jobs = await readCollection("jobs");
  const row = {
    id: job.id || createId("job"),
    createdAt: new Date().toISOString(),
    ...job
  };
  jobs.unshift(row);
  await writeCollection("jobs", jobs.slice(0, 200));
  return row;
}

export async function appendWebhookEvent(event) {
  const webhooks = await readCollection("webhooks");
  const row = {
    id: createId("evt"),
    receivedAt: new Date().toISOString(),
    ...event
  };
  webhooks.unshift(row);
  await writeCollection("webhooks", webhooks.slice(0, 2000));
  return row;
}

// Durable analytics fact log. Every CSAT rating and every lead-source answer is
// appended here the moment it happens, so reporting history survives redeploys and the
// capped webhook buffer. Deduped by an optional dedupeKey so a replayed webhook never
// double-counts. Attach a Railway Volume (DATA_DIR) to persist it across deploys.
export async function appendMetricEvent(event) {
  const metrics = await readCollection("metrics");
  if (event?.dedupeKey && metrics.some(item => item.dedupeKey === event.dedupeKey)) {
    return null;
  }
  const row = {
    id: createId("mtr"),
    recordedAt: new Date().toISOString(),
    ...event
  };
  metrics.unshift(row);
  await writeCollection("metrics", metrics.slice(0, METRICS_STORE_LIMIT));
  return row;
}

export async function readMetricEvents() {
  return readCollection("metrics");
}

export async function getDepartmentRoute(conversationId) {
  const routes = await readCollection("departmentRoutes");
  return routes.find(item => String(item.conversationId) === String(conversationId)) || null;
}

export async function saveDepartmentRoute(conversationId, changes = {}) {
  const routes = await readCollection("departmentRoutes");
  const index = routes.findIndex(item => String(item.conversationId) === String(conversationId));
  const current = index >= 0 ? routes[index] : { conversationId };
  const row = {
    ...current,
    ...changes,
    conversationId,
    updatedAt: new Date().toISOString()
  };

  if (index >= 0) routes[index] = row;
  else routes.unshift(row);
  await writeCollection("departmentRoutes", routes.slice(0, 10000));
  return row;
}

export async function createCampaign(campaign) {
  const campaigns = await readCollection("campaigns");
  const row = {
    id: createId("cmp"),
    createdAt: new Date().toISOString(),
    sentCount: 0,
    repliedCount: 0,
    failedCount: 0,
    deliveredCount: 0,
    ...campaign
  };
  campaigns.unshift(row);
  await writeCollection("campaigns", campaigns);
  await appendAudit({
    action: "campaign_created",
    actor: campaign.actor || null,
    summary: `Campaign ${campaign.name} created`,
    metadata: { campaignId: row.id }
  });
  return row;
}

export async function updateCampaignFromWebhook(event) {
  const campaigns = await readCollection("campaigns");
  const campaignId = event?.campaignId || event?.payload?.campaign_id || event?.payload?.message?.campaign_id;
  if (!campaignId) return null;

  const campaign = campaigns.find(item => String(item.id) === String(campaignId) || String(item.chatwootCampaignId) === String(campaignId));
  if (!campaign) return null;

  const eventName = String(event.event || event.payload?.event || "").toLowerCase();
  const messageType = event.payload?.message_type ?? event.payload?.message?.message_type;
  const status = String(event.payload?.status || event.payload?.message?.status || "").toLowerCase();

  if (eventName.includes("message_created") && (messageType === 0 || messageType === "incoming")) {
    campaign.repliedCount = Number(campaign.repliedCount || 0) + 1;
  }
  if (status === "failed") campaign.failedCount = Number(campaign.failedCount || 0) + 1;
  if (status === "delivered") campaign.deliveredCount = Number(campaign.deliveredCount || 0) + 1;
  if (status === "sent") campaign.sentCount = Number(campaign.sentCount || 0) + 1;

  campaign.updatedAt = new Date().toISOString();
  await writeCollection("campaigns", campaigns);
  return campaign;
}

export function createId(prefix) {
  const random = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}_${random}`;
}

async function ensureDataDir() {
  await mkdir(dataDir, { recursive: true });
}
