import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const dataDir = join(rootDir, "data");

const files = {
  audit: join(dataDir, "audit-log.json"),
  jobs: join(dataDir, "jobs.json"),
  webhooks: join(dataDir, "webhook-events.json"),
  campaigns: join(dataDir, "campaigns.json")
};

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
