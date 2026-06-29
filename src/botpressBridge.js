import { conversationHasBotReleaseMarker, conversationHasResolveActivity, isBroadcastConversation, makeClient, wasResolvedReopenedWithoutAgentReply } from "./operations.js";
import { transcribeAudioUrl, firstAudioAttachmentUrl, voiceTranscriptionEnabled } from "./voiceTranscription.js";

const BOTPRESS_WEBHOOK_URL = process.env.BOTPRESS_WEBHOOK_URL || "";
const BOTPRESS_PAT = process.env.BOTPRESS_PAT || "";
const REQUIRE_LABEL = String(process.env.BRIDGE_REQUIRE_LABEL ?? "needs-bot").trim();
const BOT_INBOX_IDS = String(process.env.BOT_INBOX_IDS || "").split(",").map(s => s.trim()).filter(Boolean);
const SKIP_BROADCASTS = String(process.env.BRIDGE_SKIP_BROADCASTS ?? "true").toLowerCase() !== "false";
const CAMPAIGN_MARKER_TTL_SECONDS = Number(process.env.CAMPAIGN_MARKER_TTL_SECONDS) || undefined;
const VOICE_PLACEHOLDER = String(process.env.VOICE_TRANSCRIBE_FALLBACK_TEXT ?? "[رسالة صوتية]");

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
  try {
    const r = await makeClient({}).conversationDetails(convId);
    const c = r?.payload || r || {};
    return {
      ...g,
      labels: Array.isArray(c.labels) ? c.labels : g.labels,
      assigneeId: c.meta?.assignee?.id || c.assignee?.id || g.assigneeId,
      status: String(c.status || g.status || "").toLowerCase(),
      inboxId: String(c.inbox_id || c.inbox?.id || c.meta?.inbox?.id || g.inboxId || ""),
      raw: c,
    };
  } catch {
    return g;
  }
}

export async function forwardIncomingToBotpress(body = {}) {
  if (!BOTPRESS_WEBHOOK_URL) return { ok: true, skipped: true, reason: "no_botpress_url" };
  if (body.message_type !== "incoming") return { ok: true, skipped: true, reason: "not_incoming" };
  if (body.private === true) return { ok: true, skipped: true, reason: "private_note" };
  const audioUrl = firstAudioAttachmentUrl(body);
  // Only treat an audio-only message as forwardable when transcription is on;
  // otherwise it stays a "missing" skip exactly like before (feature is inert).
  const transcribeVoice = Boolean(audioUrl) && voiceTranscriptionEnabled();
  if ((!body.content && !transcribeVoice) || !body.conversation?.id) return { ok: true, skipped: true, reason: "missing" };

  const convId = String(body.conversation.id);
  const userId = String(body.sender?.id || "unknown");
  const msgId = String(body.id || `${convId}-${Date.now()}`);
  if (dup(msgId)) return { ok: true, skipped: true, reason: "duplicate" };

  let g = gateInfo(body);
  if (BOT_INBOX_IDS.length && g.inboxId && !BOT_INBOX_IDS.includes(g.inboxId)) {
    return { ok: true, skipped: true, reason: "inbox", inboxId: g.inboxId };
  }

  g = await fillFromApi(convId, g);

  // Broadcast/campaign conversations are handled by the team, not Fahd. Skip
  // them even when an automation stamped needs-bot on every new conversation.
  // Once an agent has resolved the conversation, the campaign episode is over:
  // release it so the customer's next message flows to Fahd normally. The durable
  // resolve marker (stamped on resolve) is the reliable signal; the message-scan
  // is kept as a fallback for conversations resolved before the marker existed.
  const releasedAfterResolve = conversationHasBotReleaseMarker(g.raw) ||
    conversationHasBotReleaseMarker(body.conversation) ||
    conversationHasResolveActivity(g.raw) ||
    conversationHasResolveActivity(body.conversation);
  if (SKIP_BROADCASTS && !releasedAfterResolve &&
    (isBroadcastConversation(body.conversation, CAMPAIGN_MARKER_TTL_SECONDS) ||
      isBroadcastConversation(g.raw, CAMPAIGN_MARKER_TTL_SECONDS))) {
    return { ok: true, skipped: true, reason: "broadcast", conversationId: convId };
  }

  const hasLabel = !REQUIRE_LABEL || g.labels.includes(REQUIRE_LABEL);
  // An assignee normally blocks Fahd (a human is actively handling the chat). But a
  // needs-bot conversation that shows a prior resolve is a fresh re-entry: the old
  // assignee is stale, so hand it back to the bot even if a missed/late resolve
  // webhook left the assignee attached. needs-bot is cleared once Fahd hands off,
  // so an actively-handled conversation never reaches this branch.
  const blockedByAssignee = Boolean(g.assigneeId) && !releasedAfterResolve;
  // A *fresh* resolved re-entry (the agent closed the chat and the customer came
  // back, with no agent/bot reply since) belongs to Fahd even if a Chatwoot rule
  // stripped needs-bot or a missed resolve webhook left a stale assignee. This is
  // stricter than "any prior resolve": once Fahd hands off and a public reply lands
  // after the resolve, it is false again, so an active chat is never interrupted.
  const freshResolvedReentry = wasResolvedReopenedWithoutAgentReply(g.raw, body) ||
    wasResolvedReopenedWithoutAgentReply(body.conversation, body);
  if (!freshResolvedReentry && (!hasLabel || blockedByAssignee)) {
    return { ok: true, skipped: true, reason: "gate_blocked", hasLabel, assigneeId: g.assigneeId, freshResolvedReentry };
  }

  // Voice note → transcribe so Fahd understands it; fall back to a placeholder so
  // the chat still reaches the bot instead of stalling. The conversation id is
  // unchanged, so the transcript and Fahd's reply stay in the SAME Chatwoot
  // conversation — whether it is a new chat or an existing/re-entered one.
  let messageText = body.content;
  let voiceTranscribed = false;
  if (!messageText && transcribeVoice) {
    const transcription = await transcribeAudioUrl(audioUrl);
    messageText = transcription.transcript || VOICE_PLACEHOLDER;
    voiceTranscribed = transcription.ok;
  }
  if (!messageText) messageText = VOICE_PLACEHOLDER;

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
    isVoiceNote: Boolean(audioUrl),
    voiceTranscribed,
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
      text: messageText,
      payload: {
        type: "text",
        text: messageText,
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
