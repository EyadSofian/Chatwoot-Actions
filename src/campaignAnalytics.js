import { ChatwootClient, getPayload } from "./chatwootClient.js";

// Maps a campaign uploader job status onto a coarse bucket for the dashboard:
// running (بيرن) — actively sending; pending (لسه) — queued, not started yet;
// completed (خلص) — finished (with or without row errors); failed — the whole job
// failed; stopped — user-stopped or interrupted by a restart.
export function bucketForStatus(status, active = false) {
  const value = String(status || "").toLowerCase();
  if (active || value === "running") return "running";
  if (value === "queued") return "pending";
  if (value === "completed" || value === "completed_with_errors") return "completed";
  if (value === "failed") return "failed";
  if (value === "stopped" || value === "interrupted") return "stopped";
  return "other";
}

// Pure aggregation over the uploader's job list. Only `send` jobs are campaigns
// (`upload` jobs are contact imports). Kept side-effect free so it is unit-testable
// and reusable by the email digest. `inboxLookup` maps inboxId -> inbox name.
export function aggregateCampaignJobs(jobs = [], { inboxLookup = new Map() } = {}) {
  const campaigns = (jobs || []).filter(job => String(job?.type) === "send");
  const totals = { totalCampaigns: 0, running: 0, pending: 0, completed: 0, failed: 0, stopped: 0, other: 0, sentTotal: 0 };
  const perInbox = new Map();
  const rows = [];

  for (const job of campaigns) {
    const settings = job.settings || {};
    const inboxId = settings.inboxId != null && settings.inboxId !== "" ? String(settings.inboxId) : "";
    const inboxName = inboxLookup.get(inboxId) || (inboxId ? `Inbox ${inboxId}` : "Unknown inbox");
    const bucket = bucketForStatus(job.status, job.active);
    const sent = Number(job.counters?.sent || 0);
    const name = String(settings.originalLabelName || settings.labelName || job.queueLabel || "(no name)");

    totals.totalCampaigns += 1;
    totals[bucket] = (totals[bucket] || 0) + 1;
    totals.sentTotal += sent;

    const inbox = perInbox.get(inboxId) || {
      inboxId, inboxName, campaignCount: 0, running: 0, pending: 0, completed: 0, failed: 0, sentTotal: 0
    };
    inbox.campaignCount += 1;
    if (bucket in inbox) inbox[bucket] += 1;
    inbox.sentTotal += sent;
    perInbox.set(inboxId, inbox);

    rows.push({
      name,
      template: String(settings.templateName || ""),
      inboxId,
      inboxName,
      status: String(job.status || ""),
      statusBucket: bucket,
      sent,
      total: Number(job.total || 0),
      failed: Number(job.counters?.failed || 0) + Number(job.counters?.errors || 0),
      operatorName: String(job.operatorName || settings.operatorName || ""),
      createdAt: job.createdAt || ""
    });
  }

  rows.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));

  return {
    totals,
    perInbox: [...perInbox.values()].sort(
      (a, b) => b.campaignCount - a.campaignCount || String(a.inboxName).localeCompare(String(b.inboxName))
    ),
    campaigns: rows
  };
}

// Full campaign report: fetches the uploader's saved jobs over HTTP and merges live
// Chatwoot inbox names. Best-effort — if the uploader or Chatwoot is unreachable it
// degrades to whatever it could load, with warnings, so the dashboard never hard-fails.
export async function getCampaignReport(connection, options = {}) {
  const warnings = [];
  const uploaderUrl = String(options.uploaderUrl || process.env.CAMPAIGN_UPLOADER_URL || "").replace(/\/+$/, "");
  const limit = Math.max(1, Math.min(Number(options.limit || 200), 200));

  let jobs = [];
  if (!uploaderUrl) {
    warnings.push("Campaign uploader URL is not set. Set CAMPAIGN_UPLOADER_URL (or pass options.uploaderUrl) to load campaigns.");
  } else {
    try {
      jobs = await fetchUploaderJobs(uploaderUrl, {
        limit,
        token: options.uploaderToken || process.env.CAMPAIGN_UPLOADER_TOKEN || ""
      });
    } catch (error) {
      warnings.push(`Could not load campaigns from the uploader: ${error.message}`);
    }
  }

  const inboxLookup = new Map();
  try {
    const client = new ChatwootClient(connection || {});
    const inboxes = getPayload(await client.listInboxes());
    for (const inbox of inboxes) inboxLookup.set(String(inbox.id), inbox.name);
  } catch (error) {
    warnings.push(`Could not load inbox names from Chatwoot: ${error.message}`);
  }

  const aggregated = aggregateCampaignJobs(jobs, { inboxLookup });
  return {
    generatedAt: new Date().toISOString(),
    source: uploaderUrl || null,
    ...aggregated,
    warnings
  };
}

async function fetchUploaderJobs(uploaderUrl, { limit, token }) {
  const headers = {};
  if (token) headers["x-webhook-secret"] = token;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(`${uploaderUrl}/api/jobs?limit=${limit}`, { headers, signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    return Array.isArray(data?.jobs) ? data.jobs : [];
  } finally {
    clearTimeout(timer);
  }
}
