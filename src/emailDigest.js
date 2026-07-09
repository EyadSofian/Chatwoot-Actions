import nodemailer from "nodemailer";
import { getAnalyticsReport } from "./operations.js";
import { getCampaignReport } from "./campaignAnalytics.js";
import { appendAudit, readCollection, writeCollection } from "./store.js";

// Daily analytics email digest over Zoho Mail SMTP. Each recipient can be scoped to a
// single inbox so different people get their own numbers. Everything is env-gated and
// inert until ZOHO_SMTP_USER/ZOHO_SMTP_PASS and recipients are configured.

// --- Recipients -------------------------------------------------------------------

export function isEmail(value) {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(value || "").trim());
}

export function normalizeRecipients(list = []) {
  const seen = new Set();
  const out = [];
  for (const item of Array.isArray(list) ? list : []) {
    const email = String(item?.email || "").trim().toLowerCase();
    if (!isEmail(email) || seen.has(email)) continue;
    seen.add(email);
    out.push({
      email,
      inboxId: item?.inboxId != null ? String(item.inboxId).trim() : "",
      label: String(item?.label || "").trim().slice(0, 120)
    });
  }
  return out;
}

// Accepts a JSON array or a comma/newline separated list of bare emails.
export function parseRecipientsConfig(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return normalizeRecipients(raw);
  const text = String(raw).trim();
  if (text.startsWith("[")) {
    try { return normalizeRecipients(JSON.parse(text)); } catch { return []; }
  }
  return normalizeRecipients(text.split(/[\n,;]+/).map(email => ({ email })));
}

export async function readDigestRecipients() {
  const stored = await readCollection("digestRecipients");
  if (Array.isArray(stored) && stored.length) return normalizeRecipients(stored);
  return parseRecipientsConfig(process.env.ANALYTICS_DIGEST_RECIPIENTS || "");
}

export async function saveDigestRecipients(list, actor = null) {
  const recipients = normalizeRecipients(list);
  await writeCollection("digestRecipients", recipients);
  await appendAudit({
    action: "digest_recipients_saved",
    actor,
    summary: `Saved ${recipients.length} analytics digest recipient(s)`,
    metadata: { count: recipients.length }
  });
  return recipients;
}

// --- Scheduling (pure decision, unit-tested) --------------------------------------

// Returns the { date: "YYYY-MM-DD", hour } for `now` in the given IANA timezone.
export function zonedDateParts(now, timezone = "Africa/Cairo") {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23"
  });
  const parts = Object.fromEntries(formatter.formatToParts(now).map(part => [part.type, part.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}

// Fire once per local day, at or after the configured hour, and never twice the same day.
export function shouldRunDigestNow(now, { hour = 8, lastRunDate = "", timezone = "Africa/Cairo" } = {}) {
  const { date, hour: currentHour } = zonedDateParts(now, timezone);
  if (currentHour < Number(hour)) return false;
  if (lastRunDate === date) return false;
  return date;
}

export async function readDigestState() {
  const state = await readCollection("digestState");
  return state && !Array.isArray(state) ? state : {};
}

export async function writeDigestLastRun(date) {
  await writeCollection("digestState", { lastRunDate: date, updatedAt: new Date().toISOString() });
}

// --- Transport --------------------------------------------------------------------

export function isDigestEmailConfigured(env = process.env) {
  return Boolean((env.ZOHO_SMTP_USER || env.SMTP_USER) && (env.ZOHO_SMTP_PASS || env.SMTP_PASS));
}

export function buildZohoTransport(env = process.env) {
  const user = env.ZOHO_SMTP_USER || env.SMTP_USER || "";
  const pass = env.ZOHO_SMTP_PASS || env.SMTP_PASS || "";
  if (!user || !pass) {
    throw new Error("Zoho SMTP is not configured. Set ZOHO_SMTP_USER and ZOHO_SMTP_PASS.");
  }
  const port = Number(env.ZOHO_SMTP_PORT || env.SMTP_PORT || 465);
  const secure = port === 465;
  return nodemailer.createTransport({
    host: env.ZOHO_SMTP_HOST || env.SMTP_HOST || "smtp.zoho.com",
    port,
    secure,               // 465 = implicit TLS; 587 = STARTTLS (secure:false + requireTLS)
    requireTLS: !secure,
    auth: { user, pass }
  });
}

// --- HTML rendering ---------------------------------------------------------------

function esc(value) {
  return String(value ?? "").replace(/[&<>"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
}

export function formatDurationSeconds(seconds) {
  if (seconds == null || seconds === "" || Number.isNaN(Number(seconds))) return "-";
  let remaining = Math.round(Number(seconds));
  if (remaining <= 0) return "0s";
  const hours = Math.floor(remaining / 3600); remaining -= hours * 3600;
  const minutes = Math.floor(remaining / 60); remaining -= minutes * 60;
  const parts = [];
  if (hours) parts.push(`${hours}h`);
  if (minutes) parts.push(`${minutes}m`);
  if (remaining || !parts.length) parts.push(`${remaining}s`);
  return parts.join(" ");
}

function table(headers, rows) {
  if (!rows.length) return `<p style="color:#667">لا يوجد بيانات.</p>`;
  const head = headers.map(header => `<th style="text-align:right;padding:6px 10px;border-bottom:2px solid #e5e7eb;font-size:13px;color:#374151">${esc(header.label)}</th>`).join("");
  const body = rows.map(row => `<tr>${headers.map(header => `<td style="padding:6px 10px;border-bottom:1px solid #f0f0f3;font-size:13px">${esc(row[header.key] ?? "-")}</td>`).join("")}</tr>`).join("");
  return `<table style="border-collapse:collapse;width:100%;margin:6px 0 14px">${`<thead><tr>${head}</tr></thead>`}<tbody>${body}</tbody></table>`;
}

function statCard(label, value) {
  return `<td style="padding:10px 14px;background:#f8fafc;border:1px solid #e5e7eb;border-radius:10px;text-align:center">
    <div style="font-size:12px;color:#64748b">${esc(label)}</div>
    <div style="font-size:22px;font-weight:700;color:#0f172a">${esc(value)}</div></td>`;
}

export function buildDigestHtml({ analytics, campaigns, recipient = {}, generatedAt = new Date().toISOString() }) {
  const csat = analytics?.csat || {};
  const leads = analytics?.leadSources || {};
  const scope = recipient.label || (recipient.inboxId ? `Inbox ${recipient.inboxId}` : "كل الإنبوكسات");
  const day = String(generatedAt).slice(0, 10);

  const distribution = csat.distribution || {};
  const distRows = Object.keys(distribution).sort((a, b) => Number(a) - Number(b)).map(r => ({ rating: r, count: distribution[r] }));
  const sourceRows = (leads.bySource || []).map(s => ({ source: s.label, count: s.count, share: `${s.percentage}%` }));
  const agentRows = (analytics?.agents || []).map(a => ({
    agent: a.agentName, rated: a.ratedCount ?? 0, avg: a.averageRating ?? "-",
    convos: a.conversationsCount ?? "-", resolved: a.resolutionsCount ?? "-",
    first: formatDurationSeconds(a.avgFirstResponseTime), resolution: formatDurationSeconds(a.avgResolutionTime)
  }));
  const teamRows = (analytics?.teams || []).map(t => ({
    team: t.teamName, convos: t.conversationsCount ?? "-", resolved: t.resolutionsCount ?? "-",
    first: formatDurationSeconds(t.avgFirstResponseTime), resolution: formatDurationSeconds(t.avgResolutionTime)
  }));

  const campaignTotals = campaigns?.totals || {};
  const inboxRows = (campaigns?.perInbox || []).map(i => ({
    inbox: i.inboxName, count: i.campaignCount, running: i.running, pending: i.pending, completed: i.completed, sent: i.sentTotal
  }));

  return `<!doctype html><html lang="ar" dir="rtl"><body style="margin:0;background:#f1f5f9;font-family:'Segoe UI',Tahoma,Arial,sans-serif;color:#0f172a">
  <div style="max-width:720px;margin:0 auto;padding:20px">
    <div style="background:#0f172a;color:#fff;padding:18px 20px;border-radius:12px 12px 0 0">
      <div style="font-size:19px;font-weight:700">تقرير Chatwoot اليومي</div>
      <div style="font-size:13px;color:#cbd5e1;margin-top:4px">${esc(day)} · النطاق: ${esc(scope)}</div>
    </div>
    <div style="background:#fff;padding:18px 20px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px">
      <h3 style="margin:6px 0 8px;font-size:15px">رضا العملاء (CSAT)</h3>
      <table style="border-collapse:separate;border-spacing:8px 0;width:100%"><tr>
        ${statCard("عملاء قيّموا", csat.ratedCount ?? 0)}
        ${statCard("متوسط التقييم", csat.averageRating ?? "-")}
        ${statCard("إجمالي العملاء", leads.total ?? 0)}
      </tr></table>
      <div style="margin-top:14px"></div>
      ${table([{ key: "rating", label: "التقييم" }, { key: "count", label: "العدد" }], distRows)}

      <h3 style="margin:14px 0 8px;font-size:15px">مصادر العملاء</h3>
      ${table([{ key: "source", label: "المصدر" }, { key: "count", label: "العدد" }, { key: "share", label: "النسبة" }], sourceRows)}

      <h3 style="margin:14px 0 8px;font-size:15px">أداء الموظفين</h3>
      ${table([
        { key: "agent", label: "الموظف" }, { key: "rated", label: "تقييمات" }, { key: "avg", label: "متوسط" },
        { key: "convos", label: "محادثات" }, { key: "resolved", label: "محلولة" },
        { key: "first", label: "أول رد" }, { key: "resolution", label: "زمن الحل" }
      ], agentRows)}

      <h3 style="margin:14px 0 8px;font-size:15px">أداء التيمات</h3>
      ${table([
        { key: "team", label: "التيم" }, { key: "convos", label: "محادثات" }, { key: "resolved", label: "محلولة" },
        { key: "first", label: "أول رد" }, { key: "resolution", label: "زمن الحل" }
      ], teamRows)}

      <h3 style="margin:14px 0 8px;font-size:15px">الكامبينات</h3>
      <table style="border-collapse:separate;border-spacing:8px 0;width:100%"><tr>
        ${statCard("إجمالي", campaignTotals.totalCampaigns ?? 0)}
        ${statCard("شغّال", campaignTotals.running ?? 0)}
        ${statCard("منتظر", campaignTotals.pending ?? 0)}
        ${statCard("رسائل مرسلة", campaignTotals.sentTotal ?? 0)}
      </tr></table>
      <div style="margin-top:14px"></div>
      ${table([
        { key: "inbox", label: "الإنبوكس" }, { key: "count", label: "كامبينات" }, { key: "running", label: "شغّال" },
        { key: "pending", label: "منتظر" }, { key: "completed", label: "خلص" }, { key: "sent", label: "مُرسل" }
      ], inboxRows)}

      <p style="margin-top:16px;color:#94a3b8;font-size:12px">تم إنشاء التقرير آليًا · Chatwoot Ops Console</p>
    </div>
  </div></body></html>`;
}

export function buildDigestSubject(recipient = {}, generatedAt = new Date().toISOString()) {
  const day = String(generatedAt).slice(0, 10);
  const scope = recipient.label || (recipient.inboxId ? `Inbox ${recipient.inboxId}` : "All inboxes");
  return `Chatwoot daily report — ${day} — ${scope}`;
}

// --- Runner -----------------------------------------------------------------------

export async function runDailyDigest({ connection, uploaderUrl } = {}, options = {}) {
  const recipients = options.recipients || await readDigestRecipients();
  if (!recipients.length) return { ok: true, skipped: true, reason: "no_recipients", sent: 0, total: 0, results: [] };

  const transport = options.transport || buildZohoTransport();
  const from = process.env.ANALYTICS_DIGEST_FROM || process.env.ZOHO_SMTP_USER || process.env.SMTP_USER || "";
  const generatedAt = new Date().toISOString();

  // Campaigns are account-wide; fetch once and reuse across recipients.
  let campaigns = null;
  try {
    campaigns = await getCampaignReport(connection, { uploaderUrl });
  } catch (error) {
    campaigns = { totals: {}, perInbox: [], campaigns: [], warnings: [error.message] };
  }

  const results = [];
  for (const recipient of recipients) {
    try {
      const analytics = await getAnalyticsReport(connection, { inboxId: recipient.inboxId || "" });
      const html = buildDigestHtml({ analytics, campaigns, recipient, generatedAt });
      await sendDigestEmail({ transport, from, to: recipient.email, subject: buildDigestSubject(recipient, generatedAt), html });
      results.push({ email: recipient.email, ok: true });
    } catch (error) {
      results.push({ email: recipient.email, ok: false, error: error.message });
    }
  }

  const sent = results.filter(item => item.ok).length;
  await appendAudit({
    action: "analytics_digest_sent",
    actor: { name: "Analytics Digest", type: "automation" },
    summary: `Analytics digest sent to ${sent}/${results.length} recipient(s)`,
    metadata: { results }
  });
  return { ok: true, sent, total: results.length, results };
}

async function sendDigestEmail({ transport, from, to, subject, html }) {
  if (!from) throw new Error("Digest sender is not configured. Set ANALYTICS_DIGEST_FROM or ZOHO_SMTP_USER.");
  return transport.sendMail({ from, to, subject, html });
}
