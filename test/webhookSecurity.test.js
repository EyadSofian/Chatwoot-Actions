import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { verifyChatwootWebhookSignature } from "../src/webhookSecurity.js";

test("verifyChatwootWebhookSignature accepts a valid Chatwoot HMAC signature", () => {
  const secret = "test-secret";
  const timestamp = "1770900000";
  const rawBody = Buffer.from(JSON.stringify({ event: "message_created", id: 33 }));
  const digest = createHmac("sha256", secret)
    .update(`${timestamp}.`)
    .update(rawBody)
    .digest("hex");

  assert.equal(verifyChatwootWebhookSignature({
    secret,
    timestamp,
    rawBody,
    signature: `sha256=${digest}`
  }), true);
});

test("verifyChatwootWebhookSignature rejects invalid signatures", () => {
  assert.equal(verifyChatwootWebhookSignature({
    secret: "test-secret",
    timestamp: "1770900000",
    rawBody: Buffer.from("{}"),
    signature: "sha256=wrong"
  }), false);
});
