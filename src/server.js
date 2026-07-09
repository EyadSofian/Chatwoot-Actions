import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import {
  appendAudit,
  appendWebhookEvent,
  createCampaign,
  readAutomationSettings,
  readCollection,
  updateCampaignFromWebhook,
  writeAutomationSettings
} from "./store.js";
import { mergeAutomationSettings, normalizeAutomationSettings } from "./automationSettings.js";
import { toCsv } from "./exporters.js";
import { verifyChatwootWebhookSignature } from "./webhookSecurity.js";
import {
  buildBulkPreview,
  handleBotpressCloudHandoff,
  buildPhoneAssignPreview,
  executeBulkAction,
  executePhoneAssign,
  getAnalyticsReport,
  getOpenConversationReport,
  getReportsSummary,
  handleAgentAssignmentLabelDrop,
  handleDepartmentRouterWebhook,
  handleLeadSourceRouterWebhook,
  handleReopenRouterWebhook,
  handleResolveSurveyWebhook,
  handleResolvedReentryReset,
  makeClient,
  parsePhoneAssignInput,
  probeChatwoot,
  runCustomerTimeoutSweep
} from "./operations.js";
import { forwardIncomingToBotpress, handleBotpressResponse } from "./botpressBridge.js";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const publicDir = join(rootDir, "public");
const cliPort = process.argv.find(arg => arg.startsWith("--port="))?.split("=")[1];
const port = Number(cliPort || process.env.PORT || process.env.CHATWOOT_OPS_PORT || 3317);
const host = process.env.HOST || "0.0.0.0";

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

const server = createServer(async (req, res) => {
  try {
    if (req.url?.startsWith("/api/health")) {
      sendJson(res, 200, { ok: true, name: "chatwoot-ops-console" });
      return;
    }

    if (!isWebhookRoute(req) && !isAuthorized(req)) {
      sendUnauthorized(res);
      return;
    }
    await route(req, res);
  } catch (error) {
    sendJson(res, error.status || 500, {
      error: error.message || "Unexpected server error",
      details: error.body || null
    });
  }
});

server.listen(port, host, () => {
  console.log(`Chatwoot Ops Console running at http://${host}:${port}`);
});

startCustomerTimeoutSweep();

// Background sweep: hand off conversations the customer abandoned mid-chat with
// Fahd. Opt-in via CUSTOMER_TIMEOUT_ENABLED so it is inert unless configured.
function startCustomerTimeoutSweep() {
  if (!parseBooleanEnv(process.env.CUSTOMER_TIMEOUT_ENABLED)) return;

  const seconds = Number(process.env.CUSTOMER_TIMEOUT_SWEEP_SECONDS);
  const intervalMs = Math.max(15, Number.isFinite(seconds) && seconds > 0 ? seconds : 60) * 1000;
  const minutes = Number(process.env.CUSTOMER_TIMEOUT_MINUTES) || 10;
  let running = false;

  const tick = async () => {
    if (running) return; // never let two sweeps overlap
    running = true;
    try {
      const result = await runCustomerTimeoutSweep();
      if (result?.escalated?.length) {
        console.log("customer-timeout sweep:", JSON.stringify({
          scanned: result.scanned,
          escalated: result.escalated.length,
          conversationIds: result.escalated.map(item => item.conversationId)
        }));
      }
    } catch (error) {
      console.log("customer-timeout sweep error:", error.message);
    } finally {
      running = false;
    }
  };

  const timer = setInterval(tick, intervalMs);
  if (typeof timer.unref === "function") timer.unref();
  console.log(`Customer-timeout sweep enabled (every ${intervalMs / 1000}s, ${minutes}m threshold)`);
}

function parseBooleanEnv(value) {
  return ["1", "true", "yes", "on", "enabled"].includes(String(value ?? "").trim().toLowerCase());
}

function isAuthorized(req) {
  if (isSharedSecretAuthorized(req)) return true;
  if (isBasicAuthorized(req)) return true;

  const password = process.env.OPS_PASSWORD;
  return !password;
}

function isBasicAuthorized(req) {
  const password = process.env.OPS_PASSWORD;
  if (!password) return false;

  const username = process.env.OPS_USERNAME || "admin";
  const header = req.headers.authorization || "";
  const [scheme, encoded] = header.split(" ");
  if (scheme !== "Basic" || !encoded) return false;

  const decoded = Buffer.from(encoded, "base64").toString("utf8");
  const separator = decoded.indexOf(":");
  if (separator === -1) return false;

  const requestUsername = decoded.slice(0, separator);
  const requestPassword = decoded.slice(separator + 1);
  return requestUsername === username && requestPassword === password;
}

function isWebhookRoute(req) {
  if (!req.url) return false;
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  return req.method === "POST" && (url.pathname === "/api/webhooks/chatwoot" || url.pathname === "/botpress/response");
}

function isBotpressRoute(req) {
  if (!req.url) return false;
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  return req.method === "POST" && (url.pathname === "/botpress-cloud" || url.pathname === "/api/botpress-cloud");
}

function isWebhookAuthorized(req, rawBody) {
  const hasPassword = Boolean(process.env.OPS_PASSWORD);
  const hasWebhookSecret = Boolean(getWebhookSecret());
  if (isSharedSecretAuthorized(req) || isWebhookSignatureAuthorized(req, rawBody) || isBasicAuthorized(req)) return true;
  return !hasPassword && !hasWebhookSecret;
}

function isSharedSecretAuthorized(req) {
  const secret = getWebhookSecret();
  if (!secret || !req.url) return false;

  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  if (!["/api/webhooks/chatwoot", "/botpress-cloud", "/api/botpress-cloud", "/botpress/response"].includes(url.pathname)) return false;

  const suppliedSecret = getFirstHeader(req.headers["x-chatwoot-ops-secret"]) ||
    getFirstHeader(req.headers["x-botpress-secret"]) ||
    getFirstHeader(req.headers["x-webhook-secret"]) ||
    url.searchParams.get("secret") || url.searchParams.get("token");
  return suppliedSecret === secret;
}

function isWebhookSignatureAuthorized(req, rawBody) {
  return verifyChatwootWebhookSignature({
    secret: getWebhookSecret(),
    signature: getFirstHeader(req.headers["x-chatwoot-signature"]),
    timestamp: getFirstHeader(req.headers["x-chatwoot-timestamp"]),
    rawBody,
    maxAgeSeconds: Number(process.env.WEBHOOK_MAX_AGE_SECONDS || 0)
  });
}

function getWebhookSecret() {
  return process.env.WEBHOOK_SECRET || process.env.CHATWOOT_WEBHOOK_SECRET;
}

function getFirstHeader(value) {
  return Array.isArray(value) ? value[0] : value;
}

async function route(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "POST" && url.pathname === "/api/chatwoot/probe") {
    const body = await readJsonBody(req);
    return sendJson(res, 200, await probeChatwoot(body.connection));
  }

  if (req.method === "POST" && url.pathname === "/api/bulk/preview") {
    const body = await readJsonBody(req);
    return sendJson(res, 200, await buildBulkPreview(body.connection, body.criteria));
  }

  if (req.method === "POST" && url.pathname === "/api/bulk/execute") {
    const body = await readJsonBody(req);
    return sendJson(res, 200, await executeBulkAction(body.connection, body.criteria, body.items, body.actor));
  }

  if (req.method === "POST" && url.pathname === "/api/phone-assign/preview") {
    const body = await readJsonBody(req);
    return sendJson(res, 200, await buildPhoneAssignPreview(body.connection, body.criteria));
  }

  if (req.method === "POST" && url.pathname === "/api/phone-assign/parse") {
    const body = await readJsonBody(req);
    return sendJson(res, 200, await parsePhoneAssignInput(body.criteria));
  }

  if (req.method === "POST" && url.pathname === "/api/phone-assign/execute") {
    const body = await readJsonBody(req);
    return sendJson(res, 200, await executePhoneAssign(body.connection, body.criteria, body.items, body.actor));
  }

  if (req.method === "POST" && url.pathname === "/api/reports/summary") {
    const body = await readJsonBody(req);
    return sendJson(res, 200, await getReportsSummary(body.connection, body.query));
  }

  if (req.method === "POST" && url.pathname === "/api/reports/analytics") {
    const body = await readJsonBody(req);
    return sendJson(res, 200, await getAnalyticsReport(body.connection, body.filters || body.criteria || {}));
  }

  if (req.method === "POST" && url.pathname === "/api/conversations/open-report") {
    const body = await readJsonBody(req);
    return sendJson(res, 200, await getOpenConversationReport(body.connection, body.criteria));
  }

  if (req.method === "GET" && url.pathname === "/api/automation-settings") {
    const saved = await readAutomationSettings();
    return sendJson(res, 200, {
      settings: mergeAutomationSettings(saved),
      saved: Boolean(saved?.updatedAt),
      updatedAt: saved?.updatedAt || null
    });
  }

  if (req.method === "POST" && url.pathname === "/api/automation-settings") {
    const body = await readJsonBody(req);
    const settings = normalizeAutomationSettings(body.settings || {});
    const saved = await writeAutomationSettings(settings, body.actor || null);
    return sendJson(res, 200, {
      settings: mergeAutomationSettings(saved),
      saved: true,
      updatedAt: saved.updatedAt
    });
  }

  if (req.method === "POST" && (url.pathname === "/botpress-cloud" || url.pathname === "/api/botpress-cloud")) {
    if (!isBotpressRoute(req)) return sendJson(res, 404, { error: "Not found" });
    const body = await readJsonBody(req);
    return sendJson(res, 200, await handleBotpressCloudHandoff(body));
  }

  if (req.method === "POST" && url.pathname === "/api/chatwoot/audit") {
    const body = await readJsonBody(req);
    const client = makeClient(body.connection);
    const auditLogs = await client.auditLogs({ page: body.page || 1 });
    await appendAudit({
      action: "chatwoot_audit_fetched",
      actor: body.actor || null,
      summary: "Fetched Chatwoot Enterprise audit logs",
      metadata: { page: body.page || 1 }
    });
    return sendJson(res, 200, auditLogs);
  }

  if (req.method === "GET" && url.pathname === "/api/audit") {
    return sendJson(res, 200, await readCollection("audit"));
  }

  if (req.method === "GET" && url.pathname === "/api/jobs") {
    return sendJson(res, 200, await readCollection("jobs"));
  }

  if (req.method === "GET" && url.pathname === "/api/webhooks") {
    return sendJson(res, 200, await readCollection("webhooks"));
  }

  if (req.method === "POST" && url.pathname === "/api/webhooks/chatwoot") {
    const rawBody = await readRawBody(req);
    if (!isWebhookAuthorized(req, rawBody)) {
      sendUnauthorized(res);
      return;
    }

    const body = parseJsonBody(rawBody);
    let bridge = null;
    try { bridge = await forwardIncomingToBotpress(body); console.log("bridge:", JSON.stringify(bridge)); } catch (e) { console.log("bridge fwd:", e.message); }
    let router = null;
    if (bridge?.forwarded === true) {
      router = { ok: true, reason: "forwarded_to_botpress", skippedRouters: true };
    } else {
      try {
        // Post-resolution CSAT survey runs first for its inboxes: on resolve it asks,
        // and it must capture the customer's rating reply (a bare number) before the
        // other handlers see it. A non-rating reply falls through untouched.
        const resolveSurvey = await handleResolveSurveyWebhook(body);
        const leadSourceRouter = resolveSurvey.handled ? null : await handleLeadSourceRouterWebhook(body);
        if (resolveSurvey.handled) {
          router = resolveSurvey;
        } else if (leadSourceRouter.handled) {
          router = leadSourceRouter;
        } else {
          // Legacy department/reopen routers are retired. Fahd (Botpress) owns all
          // routing now; the remaining server-side steps are: clear the assignee/team
          // when a bot-managed conversation is resolved (so the next customer message
          // flows back to the bot), and drop the needs-bot label when a human agent takes
          // the conversation (so Fahd stops). A given webhook is only ever one of these.
          router = await handleResolvedReentryReset(body);
          if (router?.handled !== true) {
            router = await handleAgentAssignmentLabelDrop(body);
            // Diagnostic: log the outcome for assignment-related events (conversation_updated)
            // so we can see whether the label drop fired and why. Other events are silent.
            if (router && router.reason !== "not_conversation_update") {
              console.log("assign:", JSON.stringify(router));
            }
          }
        }
      } catch (error) {
        router = {
          ok: false,
          reason: "webhook_automation_error",
          error: error.message || "Unexpected webhook automation error"
        };
        try {
          await appendAudit({
            action: "webhook_automation_error",
            actor: { name: "Webhook Automation", type: "automation" },
            summary: router.error,
            metadata: { event: body.event || body.name || "", body }
          });
        } catch {
          // Keep webhook acknowledgements reliable even if local audit storage is unavailable.
        }
      }
    }

    const row = await appendWebhookEvent({
      event: body.event,
      campaignId: body.campaign_id || body.message?.campaign_id,
      router,
      payload: body
    });
    await updateCampaignFromWebhook(row);
    return sendJson(res, 200, { ok: true, id: row.id, router });
  }

  if (req.method === "GET" && url.pathname === "/api/campaigns") {
    return sendJson(res, 200, await readCollection("campaigns"));
  }

  if (req.method === "POST" && url.pathname === "/api/campaigns") {
    const body = await readJsonBody(req);
    return sendJson(res, 200, await createCampaign(body));
  }

  if (req.method === "GET" && url.pathname === "/api/audit/export.csv") {
    return sendCsv(res, "audit-log.csv", toCsv(await readCollection("audit")));
  }

  if (req.method === "GET" && url.pathname === "/api/campaigns/export.csv") {
    return sendCsv(res, "campaigns.csv", toCsv(await readCollection("campaigns")));
  }

  const jobExportMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)\/export\.csv$/);
  if (req.method === "GET" && jobExportMatch) {
    const jobs = await readCollection("jobs");
    const job = jobs.find(item => item.id === jobExportMatch[1]);
    if (!job) return sendJson(res, 404, { error: "Job not found" });
    return sendCsv(res, `${job.id}.csv`, toCsv(job.results || []));
  }

  if (url.pathname === "/botpress/response") {
    if (req.method !== "POST") return sendJson(res, 200, { status: "ready" });
    const rawBody = await readRawBody(req);
    if (!isWebhookAuthorized(req, rawBody)) {
      sendUnauthorized(res);
      return;
    }
    const body = parseJsonBody(rawBody);
    return sendJson(res, 200, await handleBotpressResponse(body));
  }

  if (req.method === "GET") {
    return serveStatic(url.pathname, res);
  }

  sendJson(res, 404, { error: "Not found" });
}

async function serveStatic(pathname, res) {
  const requested = pathname === "/" ? "/index.html" : pathname;
  const normalized = normalize(requested).replace(/^([/\\])+/, "");
  const filePath = join(publicDir, normalized);

  if (!filePath.startsWith(publicDir)) {
    return sendJson(res, 403, { error: "Forbidden" });
  }

  try {
    const content = await readFile(filePath);
    res.writeHead(200, { "content-type": mimeTypes[extname(filePath)] || "application/octet-stream" });
    res.end(content);
  } catch {
    sendJson(res, 404, { error: "File not found" });
  }
}

async function readJsonBody(req) {
  return parseJsonBody(await readRawBody(req));
}

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

function parseJsonBody(rawBody) {
  const text = Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : String(rawBody || "");
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    const error = new Error("Invalid JSON body");
    error.status = 400;
    throw error;
  }
}

function sendUnauthorized(res) {
  res.writeHead(401, {
    "www-authenticate": 'Basic realm="Chatwoot Ops Console"',
    "content-type": "text/plain; charset=utf-8"
  });
  res.end("Authentication required");
}

function sendJson(res, status, data) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data, null, 2));
}

function sendCsv(res, filename, csv) {
  res.writeHead(200, {
    "content-type": "text/csv; charset=utf-8",
    "content-disposition": `attachment; filename="${filename}"`
  });
  res.end(csv);
}
