import { getPayload } from "./chatwootClient.js";

const RELEASE_ATTRIBUTE = "engosoft_bot_release";

function messageTimeMs(message) {
  const rawTime = message?.created_at ?? message?.createdAt ?? message?.timestamp;
  if (rawTime === undefined || rawTime === null || rawTime === "") return null;
  const numericTime = Number(rawTime);
  const parsed = Number.isFinite(numericTime)
    ? (numericTime > 1e12 ? numericTime : numericTime * 1000)
    : Date.parse(String(rawTime));
  return Number.isFinite(parsed) ? parsed : null;
}

export async function checkBotpressIncomingEligibility(client, conversationId, conversation, message) {
  const status = String(conversation?.status || "").toLowerCase();
  if (!status) return { allowed: false, reason: "conversation_unverified" };
  if (status === "resolved") return { allowed: false, reason: "conversation_resolved" };

  const releaseValue = conversation?.custom_attributes?.[RELEASE_ATTRIBUTE] ??
    conversation?.customAttributes?.[RELEASE_ATTRIBUTE];
  if (!releaseValue) return { allowed: true };
  const releasedAt = Date.parse(String(releaseValue));
  if (!Number.isFinite(releasedAt)) return { allowed: false, reason: "invalid_resolve_marker" };

  let incomingAt = messageTimeMs(message);
  if (incomingAt === null && message?.id != null) {
    try {
      const messages = getPayload(await client.conversationMessages(conversationId));
      const matching = messages.find(item => String(item.id) === String(message.id));
      incomingAt = messageTimeMs(matching);
    } catch {
      return { allowed: false, reason: "incoming_time_unverified" };
    }
  }
  if (incomingAt === null) return { allowed: false, reason: "incoming_time_unverified" };
  return incomingAt > releasedAt
    ? { allowed: true }
    : { allowed: false, reason: "incoming_before_resolve" };
}

// A resolve ends the current bot turn. An old Botpress response or handoff must
// not reopen the conversation unless the customer has sent a new public message.
export async function checkBotpressWriteEligibility(client, conversationId, conversation) {
  const status = String(conversation?.status || "").toLowerCase();
  if (!status) return { allowed: false, reason: "conversation_unverified" };
  const releaseValue = conversation?.custom_attributes?.[RELEASE_ATTRIBUTE] ??
    conversation?.customAttributes?.[RELEASE_ATTRIBUTE];

  // A fresh incoming Chatwoot message normally reopens the conversation. Never
  // let an old callback write while Chatwoot still says it is resolved.
  if (status === "resolved") {
    return { allowed: false, reason: "conversation_resolved" };
  }

  if (!releaseValue) {
    return { allowed: true };
  }

  const releasedAt = Date.parse(String(releaseValue));
  if (!Number.isFinite(releasedAt)) {
    return { allowed: false, reason: "invalid_resolve_marker" };
  }

  let messages;
  try {
    messages = getPayload(await client.conversationMessages(conversationId));
  } catch {
    return { allowed: false, reason: "reentry_unverified" };
  }

  const customerReturned = messages.some(message => {
    if (message?.private) return false;
    const type = String(message?.message_type ?? message?.messageType ?? "").toLowerCase();
    if (type !== "0" && type !== "incoming") return false;
    const messageTime = messageTimeMs(message);
    return messageTime !== null && messageTime > releasedAt;
  });

  return customerReturned
    ? { allowed: true }
    : { allowed: false, reason: "no_customer_reply_after_resolve" };
}
