import { createHmac, timingSafeEqual } from "node:crypto";

export function verifyChatwootWebhookSignature({ secret, signature, timestamp, rawBody, maxAgeSeconds = 0, nowMs = Date.now() }) {
  if (!secret || !signature || !timestamp || rawBody === undefined || rawBody === null) return false;

  const timestampNumber = Number(timestamp);
  if (maxAgeSeconds > 0) {
    if (!Number.isFinite(timestampNumber)) return false;
    const ageSeconds = Math.abs(Math.floor(nowMs / 1000) - timestampNumber);
    if (ageSeconds > maxAgeSeconds) return false;
  }

  const bodyBuffer = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody), "utf8");
  const digest = createHmac("sha256", String(secret))
    .update(`${timestamp}.`)
    .update(bodyBuffer)
    .digest("hex");
  return timingSafeStringEqual(String(signature), `sha256=${digest}`) || timingSafeStringEqual(String(signature), digest);
}

function timingSafeStringEqual(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}
