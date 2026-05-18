import test from "node:test";
import assert from "node:assert/strict";
import { buildFilterPayload, normalizeBaseUrl } from "../src/chatwootClient.js";

test("normalizeBaseUrl removes trailing slashes", () => {
  assert.equal(normalizeBaseUrl("https://cw.example.com///"), "https://cw.example.com");
});

test("buildFilterPayload terminates last query operator", () => {
  const payload = buildFilterPayload({ fromAgentId: 7, status: "open", inboxId: 2 });
  assert.equal(payload.length, 3);
  assert.equal(payload[0].query_operator, "AND");
  assert.equal(payload[2].query_operator, null);
  assert.deepEqual(payload[0].values, [7]);
});
