import { makeClient } from "./operations.js";

const BOTPRESS_WEBHOOK_URL = process.env.BOTPRESS_WEBHOOK_URL || "";
const BOTPRESS_PAT = process.env.BOTPRESS_PAT || "";
const REQUIRE_LABEL = String(process.env.BRIDGE_REQUIRE_LABEL ?? "needs-bot").trim();
const BOT_INBOX_IDS = String(process.env.BOT_INBOX_IDS || "").split(",").map(s => s.trim()).filter(Boolean);

const seen = new Map();
const TTL = 5 * 60 * 1000;
function dup(id) {
  const k = String(id), now = Date.now();
  if (seen.size > 5000) for (const [a, t] of seen) if (now - t > TTL) seen.delete(a);
  if (seen.has(k) && now - seen.get(k) < TTL) return true;
  seen.set(k, now);
  return false;
}

function gateInfo(p) {
  const c = p.conversation || {};
  const status = String(c.status || p.status || "").toLowerCase();
  const assignee = c.meta?.assignee || c.assignee || p.meta?.assignee || null;
  let labels = c.labels || p.labels || [];
  if (!Array.isArray(labels)) labels = [];
  const inboxId = String(c.inbox_id || p.inbox?.id || c.inbox?.id || "");
  return { status, assigneeId: assignee?.id || null, labels, inboxId };
}

async function fillFromApi(convId, g) {
  if (g.labels.length || g.assigneeId) return g;
  try {
    const r = await makeClient({}).conversationDetails(convId);
    const c = r?.payload || r || {};
    return {
      ...g,
      labels: Array.isArray(c.labels) ? c.labels : g.labels,
      assigneeId: c.meta?.assignee?.id || c.assignee?.id || g.assigneeId,
    };
  } catch {
    return g;
  }
}

export async function forwardIncomingToBotpress(body = {}) {
  if (!BOTPRESS_WEBHOOK_URL) return { ok: true, skipped: true, reason: "no_botpress_url" };
  if (body.message_type !== "incoming") return { ok: true, skipped: true, reason: "not_incoming" };
  if (body.private === true) return { ok: true, skipped: true, reason: "private_note" };
  if (!body.content || !body.conversation?.id) return { ok: true, skipped: true, reason: "missing" };

  const convId = String(body.conversation.id);
  const userId = String(body.sender?.id || "unknown");
  const msgId = String(body.id || `${convId}-${Date.now()}`);
  if (dup(msgId)) return { ok: true, skipped: true, reason: "duplicate" };

  let g = gateInfo(body);
  if (BOT_INBOX_IDS.length && g.inboxId && !BOT_INBOX_IDS.includes(g.inboxId)) {
    return { ok: true, skipped: true, reason: "inbox", inboxId: g.inboxId };
  }

  g = await fillFromApi(convId, g);
  const hasLabel = !REQUIRE_LABEL || g.labels.includes(REQUIRE_LABEL);
  if (!hasLabel || g.assigneeId) {
    return { ok: true, skipped: true, reason: "gate_blocked", hasLabel, assigneeId: g.assigneeId };
  }

  const res = await fetch(BOTPRESS_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(BOTPRESS_PAT ? { Authorization: `Bearer ${BOTPRESS_PAT}` } : {}) },
    body: JSON.stringify({
      userId: `chatwoot-user-${userId}`,
      messageId: `msg-${msgId}`,
      conversationId: `chatwoot-conv-${convId}`,
      type: "text",
      text: body.content,
      payload: { type: "text", text: body.content },
      metadata: {
        chatwootConvId: convId,
        chatwootUserId: userId,
        senderName: body.sender?.name || "",
        conversationStatus: g.status,
        assigneeId: g.assigneeId,
        labels: g.labels,
        inboxId: g.inboxId,
      },
    }),
  });
  return { ok: res.ok, forwarded: true, conversationId: convId };
}

function extractConvId(b) {
  const cand = [b.metadata?.chatwootConvId, b.chatwoot_conversation_id, b.conversationId, b.botpressConversationId].filter(Boolean);
  for (const c of cand) {
    const v = String(c);
    const m = v.match(/(?:chatwoot-conv-|cw_conv_0*)(\d+)/);
    if (m) return m[1];
    if (/^\d+$/.test(v)) return v;
  }
  return null;
}
function extractTexts(b) {
  const items = [];
  if (Array.isArray(b.responses)) items.push(...b.responses);
  if (Array.isArray(b.messages)) items.push(...b.messages);
  items.push(b);
  return items.map(i => i.text || i.payload?.text || i.message?.payload?.text || i.message || i.content)
    .filter(t => typeof t === "string" && t.trim());
}

export async function handleBotpressResponse(body = {}) {
  if (!body || Object.keys(body).length === 0) return { ok: true, status: "ready" };
  const convId = extractConvId(body);
  const texts = extractTexts(body);
  if (!convId) return { ok: true, skipped: true, reason: "no_conv_id" };
  if (!texts.length) return { ok: true, skipped: true, reason: "no_text" };

  const client = makeClient({});
  for (const t of texts) {
    await client.createMessage(convId, { content: t, message_type: "outgoing", private: false, content_type: "text" });
  }
  return { ok: true, sent: texts.length, conversationId: convId };
}
