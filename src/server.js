import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { appendAudit, appendWebhookEvent, createCampaign, readCollection, updateCampaignFromWebhook } from "./store.js";
import { toCsv } from "./exporters.js";
import {
  buildBulkPreview,
  buildPhoneAssignPreview,
  executeBulkAction,
  executePhoneAssign,
  getOpenConversationReport,
  getReportsSummary,
  handleReopenRouterWebhook,
  makeClient,
  parsePhoneAssignInput,
  probeChatwoot
} from "./operations.js";

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

    if (!isAuthorized(req)) {
      res.writeHead(401, {
        "www-authenticate": 'Basic realm="Chatwoot Ops Console"',
        "content-type": "text/plain; charset=utf-8"
      });
      res.end("Authentication required");
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

function isAuthorized(req) {
  if (isWebhookSecretAuthorized(req)) return true;

  const password = process.env.OPS_PASSWORD;
  if (!password) return true;

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

function isWebhookSecretAuthorized(req) {
  const secret = process.env.WEBHOOK_SECRET || process.env.CHATWOOT_WEBHOOK_SECRET;
  if (!secret || !req.url) return false;

  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  if (url.pathname !== "/api/webhooks/chatwoot") return false;

  const suppliedSecret = req.headers["x-chatwoot-ops-secret"] || req.headers["x-webhook-secret"] ||
    url.searchParams.get("secret") || url.searchParams.get("token");
  return suppliedSecret === secret;
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

  if (req.method === "POST" && url.pathname === "/api/conversations/open-report") {
    const body = await readJsonBody(req);
    return sendJson(res, 200, await getOpenConversationReport(body.connection, body.criteria));
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
    const body = await readJsonBody(req);
    let router = null;
    try {
      router = await handleReopenRouterWebhook(body);
    } catch (error) {
      router = {
        ok: false,
        reason: "reopen_router_error",
        error: error.message || "Unexpected reopen router error"
      };
      try {
        await appendAudit({
          action: "reopen_router_error",
          actor: { name: "Reopen Router", type: "automation" },
          summary: router.error,
          metadata: { event: body.event || body.name || "", body }
        });
      } catch {
        // Keep webhook acknowledgements reliable even if local audit storage is unavailable.
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
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    const error = new Error("Invalid JSON body");
    error.status = 400;
    throw error;
  }
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
