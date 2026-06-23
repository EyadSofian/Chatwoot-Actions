import { makeClient } from "./operations.js";

const BOTPRESS_WEBHOOK_URL = process.env.BOTPRESS_WEBHOOK_URL || "";
const BOTPRESS_PAT = process.env.BOTPRESS_PAT || "";
const REQUIRE_LABEL = String(process.env.BRIDGE_REQUIRE_LABEL ?? "needs-bot").trim();
const BOT_INBOX_IDS = String(process.env.BOT_INBOX_IDS || "").split(",").map(s => s.trim()).filter(Boolean);

const seen = new Map();
const botpressConversationMap = new Map();
const TTL = 5 * 60 * 1000;
const MAP_TTL = 24 * 60 * 60 * 1000;
function dup(id) {
  const k = String(id), now = Date.now();
  if (seen.size > 5000) for (const [a, t] of seen) if (now - t > TTL) seen.delete(a);
  if (seen.has(k) && now - seen.get(k) < TTL) return true;
  seen.set(k, now);
  return false;
}

function rememberBotpressConversation(keys, convId) {
  const now = Date.now();
  if (botpressConversationMap.size > 5000) {
    for (const [key, row] of botpressConversationMap) {
      if (now - row.time > MAP_TTL) botpressConversationMap.delete(key);
    }
  }
  for (const key of keys.filter(Boolean).map(String)) {
    botpressConversationMap.set(key, { convId: String(convId), time: now });
  }
}

function lookupRememberedConversation(value) {
  if (!value) return null;
  const row = botpressConversationMap.get(String(value));
  if (!row) return null;
  if (Date.now() - row.time > MAP_TTL) {
    botpressConversationMap.delete(String(value));
    return null;
  }
  return row.convId;
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

function getSenderPhone(body = {}) {
  const sender = body.sender || body.conversation?.meta?.sender || body.conversation?.contact || {};
  return String(
    sender.phone_number ||
    sender.phoneNumber ||
    sender.phone ||
    sender.additional_attributes?.phone_number ||
    sender.additional_attributes?.phone ||
    sender.custom_attributes?.phone_number ||
    sender.custom_attributes?.phone ||
    ""
  ).trim();
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

  const botpressUserId = `chatwoot-user-${userId}`;
  const botpressConversationId = `chatwoot-conv-${convId}`;
  const chatwootContext = {
    chatwootConvId: convId,
    chatwootConversationId: Number(convId),
    chatwootUserId: userId,
    senderName: body.sender?.name || "",
    senderPhone: getSenderPhone(body),
    conversationStatus: g.status,
    assigneeId: g.assigneeId,
    labels: g.labels,
    inboxId: g.inboxId,
    shouldResetContext: true,
    resolvedReentry: true,
    isResolvedReentry: true,
  };
  rememberBotpressConversation([botpressUserId, botpressConversationId], convId);

  const res = await fetch(BOTPRESS_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(BOTPRESS_PAT ? { Authorization: `Bearer ${BOTPRESS_PAT}` } : {}) },
    body: JSON.stringify({
      userId: botpressUserId,
      messageId: `msg-${msgId}`,
      conversationId: botpressConversationId,
      type: "text",
      text: body.content,
      payload: {
        type: "text",
        text: body.content,
        ...chatwootContext,
        metadata: chatwootContext,
      },
      metadata: chatwootContext,
      ...chatwootContext,
    }),
  });
  return { ok: res.ok, forwarded: true, conversationId: convId };
}

function extractConvId(b) {
  const items = [
    b,
    b.payload,
    b.payload?.metadata,
    b.metadata,
    ...(Array.isArray(b.responses) ? b.responses : []),
    ...(Array.isArray(b.messages) ? b.messages : [])
  ].filter(Boolean);
  const cand = [];
  for (const item of items) {
    cand.push(
      item.metadata?.chatwootConvId,
      item.metadata?.chatwootConversationId,
      item.payload?.chatwootConvId,
      item.payload?.chatwootConversationId,
      item.payload?.metadata?.chatwootConvId,
      item.payload?.metadata?.chatwootConversationId,
      item.chatwootConvId,
      item.chatwootConversationId,
      item.chatwoot_conversation_id,
      item.conversationId,
      item.botpressConversationId,
      item.userId
    );
  }
  for (const c of cand) {
    const remembered = lookupRememberedConversation(c);
    if (remembered) return remembered;
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
