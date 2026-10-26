import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { checkBotpressIncomingEligibility, checkBotpressWriteEligibility } from "../src/botpressEligibility.js";
import { handleBotpressCloudHandoff } from "../src/operations.js";

const releaseTime = "2026-10-26T17:30:00.000Z";

test("replayed customer webhooks from before Resolve cannot re-enter Fahd", async () => {
  const client = { async conversationMessages() { return { payload: [] }; } };
  const conversation = { status: "open", custom_attributes: { engosoft_bot_release: releaseTime } };
  const oldMessage = { id: 1842086, created_at: 1793034889, message_type: "incoming" };
  assert.deepEqual(await checkBotpressIncomingEligibility(client, 185658, { ...conversation, status: "resolved" }, oldMessage), {
    allowed: false, reason: "conversation_resolved"
  });
  assert.deepEqual(await checkBotpressIncomingEligibility(client, 185658, conversation, oldMessage), {
    allowed: false, reason: "incoming_before_resolve"
  });
  assert.deepEqual(await checkBotpressIncomingEligibility(client, 185658, conversation, {
    id: 1842656, created_at: "2026-10-26T18:40:17Z", message_type: "incoming"
  }), { allowed: true });
});

test("a resolve webhook carrying the last incoming message is not forwarded to Botpress", async () => {
  const previousUrl = process.env.BOTPRESS_WEBHOOK_URL;
  try {
    process.env.BOTPRESS_WEBHOOK_URL = "http://127.0.0.1:1/should-not-be-called";
    const { forwardIncomingToBotpress } = await import(`../src/botpressBridge.js?resolve-event=${Date.now()}`);
    const result = await forwardIncomingToBotpress({
      event: "conversation_status_changed",
      id: 123,
      status: "resolved",
      message_type: "incoming",
      content: "آخر رسالة من العميل",
      conversation: { id: 33, status: "resolved" }
    });
    assert.equal(result.reason, "not_message_created");
  } finally {
    if (previousUrl === undefined) delete process.env.BOTPRESS_WEBHOOK_URL;
    else process.env.BOTPRESS_WEBHOOK_URL = previousUrl;
  }
});

test("the bridge rejects an old incoming webhook after Resolve even when Chatwoot is reopened", async () => {
  const forwarded = [];
  let status = "resolved";
  const server = createServer(async (req, res) => {
    res.setHeader("content-type", "application/json");
    if (req.method === "GET" && req.url === "/api/v1/accounts/1/conversations/185658") {
      res.end(JSON.stringify({
        id: 185658, status, inbox_id: 27, labels: ["needs-bot"],
        custom_attributes: { engosoft_bot_release: releaseTime }
      }));
      return;
    }
    if (req.method === "POST" && req.url === "/botpress") {
      forwarded.push(JSON.parse(await new Promise(resolve => {
        let raw = "";
        req.on("data", chunk => { raw += chunk; });
        req.on("end", () => resolve(raw));
      })));
    }
    res.end(JSON.stringify({ ok: true }));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const names = ["CHATWOOT_BASE_URL", "CHATWOOT_ACCOUNT_ID", "CHATWOOT_API_TOKEN", "BOTPRESS_WEBHOOK_URL"];
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    process.env.CHATWOOT_BASE_URL = baseUrl;
    process.env.CHATWOOT_ACCOUNT_ID = "1";
    process.env.CHATWOOT_API_TOKEN = "test-token";
    process.env.BOTPRESS_WEBHOOK_URL = `${baseUrl}/botpress`;
    const { forwardIncomingToBotpress } = await import(`../src/botpressBridge.js?old-incoming=${Date.now()}`);
    const message = {
      event: "message_created", id: 1842086, created_at: "2026-10-26T17:25:39Z",
      message_type: "incoming", private: false, content: "تسلم",
      sender: { id: 55 }, conversation: { id: 185658, inbox_id: 27 }
    };
    const resolved = await forwardIncomingToBotpress(message);
    assert.equal(resolved.reason, "conversation_resolved");

    status = "open";
    const reopened = await forwardIncomingToBotpress({ ...message, id: 1842087 });
    assert.equal(reopened.reason, "incoming_before_resolve");
    assert.deepEqual(forwarded, []);

    const newMessage = await forwardIncomingToBotpress({
      ...message, id: 1842656, created_at: "2026-10-26T18:40:17Z"
    });
    assert.equal(newMessage.forwarded, true);
    assert.equal(forwarded.length, 1);
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    await new Promise(resolve => server.close(resolve));
  }
});

test("a Botpress write needs a new customer message after the latest resolve", async () => {
  const conversation = {
    status: "open", // an automation may have reopened it without a customer reply
    custom_attributes: { engosoft_bot_release: releaseTime }
  };
  const client = {
    async conversationMessages() {
      return { payload: [
        { message_type: 0, created_at: "2026-10-26T17:25:00Z" },
        { message_type: 1, created_at: "2026-10-26T17:31:00Z" }
      ] };
    }
  };
  assert.deepEqual(await checkBotpressWriteEligibility(client, 33, conversation), {
    allowed: false, reason: "no_customer_reply_after_resolve"
  });

  client.conversationMessages = async () => ({ payload: [
    { message_type: 0, created_at: "2026-10-26T17:31:00Z" }
  ] });
  assert.deepEqual(await checkBotpressWriteEligibility(client, 33, conversation), { allowed: true });
  assert.deepEqual(await checkBotpressWriteEligibility(client, 33, { ...conversation, status: "resolved" }), {
    allowed: false, reason: "conversation_resolved"
  });
  assert.deepEqual(await checkBotpressWriteEligibility(client, 33, { status: "resolved" }), {
    allowed: false, reason: "conversation_resolved"
  });
  assert.deepEqual(await checkBotpressWriteEligibility(client, 33, {}), {
    allowed: false, reason: "conversation_unverified"
  });
});

test("a delayed Botpress response cannot send to a resolved Chatwoot conversation", async () => {
  const sent = [];
  const server = createServer(async (req, res) => {
    res.setHeader("content-type", "application/json");
    if (req.method === "GET" && req.url === "/api/v1/accounts/1/conversations/33") {
      res.end(JSON.stringify({ id: 33, status: "resolved" }));
      return;
    }
    if (req.method === "POST") sent.push(req.url);
    res.end(JSON.stringify({ id: 1 }));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const names = ["CHATWOOT_BASE_URL", "CHATWOOT_ACCOUNT_ID", "CHATWOOT_API_TOKEN"];
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
  try {
    process.env.CHATWOOT_BASE_URL = `http://127.0.0.1:${server.address().port}`;
    process.env.CHATWOOT_ACCOUNT_ID = "1";
    process.env.CHATWOOT_API_TOKEN = "test-token";
    const { handleBotpressResponse } = await import(`../src/botpressBridge.js?resolved-response=${Date.now()}`);
    const result = await handleBotpressResponse({ conversationId: "chatwoot-conv-33", text: "رد متأخر" });
    assert.equal(result.skipped, true);
    assert.equal(result.reason, "conversation_resolved");
    assert.deepEqual(sent, []);
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    await new Promise(resolve => server.close(resolve));
  }
});

test("an automation reopening the chat without a customer reply cannot release old Botpress responses", async () => {
  const sent = [];
  let customerReturned = false;
  const server = createServer(async (req, res) => {
    res.setHeader("content-type", "application/json");
    if (req.method === "GET" && req.url === "/api/v1/accounts/1/conversations/34") {
      res.end(JSON.stringify({
        id: 34, status: "open",
        custom_attributes: { engosoft_bot_release: releaseTime }
      }));
      return;
    }
    if (req.method === "GET" && req.url === "/api/v1/accounts/1/conversations/34/messages") {
      res.end(JSON.stringify({ payload: [
        { message_type: 0, created_at: customerReturned ? "2026-10-26T17:31:00Z" : "2026-10-26T17:25:00Z" }
      ] }));
      return;
    }
    if (req.method === "POST") sent.push(req.url);
    res.end(JSON.stringify({ id: 1 }));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const names = ["CHATWOOT_BASE_URL", "CHATWOOT_ACCOUNT_ID", "CHATWOOT_API_TOKEN"];
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
  try {
    process.env.CHATWOOT_BASE_URL = `http://127.0.0.1:${server.address().port}`;
    process.env.CHATWOOT_ACCOUNT_ID = "1";
    process.env.CHATWOOT_API_TOKEN = "test-token";
    const { handleBotpressResponse } = await import(`../src/botpressBridge.js?reopened-response=${Date.now()}`);
    const stale = await handleBotpressResponse({ conversationId: "chatwoot-conv-34", text: "رد قديم" });
    assert.equal(stale.reason, "no_customer_reply_after_resolve");
    assert.deepEqual(sent, []);

    customerReturned = true;
    const fresh = await handleBotpressResponse({ conversationId: "chatwoot-conv-34", text: "رد جديد" });
    assert.equal(fresh.sent, 1);
    assert.deepEqual(sent, ["/api/v1/accounts/1/conversations/34/messages"]);
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    await new Promise(resolve => server.close(resolve));
  }
});

test("a delayed Botpress handoff cannot reopen a resolved Chatwoot conversation", async () => {
  const writes = [];
  const server = createServer(async (req, res) => {
    res.setHeader("content-type", "application/json");
    if (req.method === "GET" && req.url === "/api/v1/accounts/1/conversations/33") {
      res.end(JSON.stringify({ id: 33, status: "resolved", inbox_id: 27 }));
      return;
    }
    if (req.method === "POST") writes.push(req.url);
    res.end(JSON.stringify({ ok: true }));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const result = await handleBotpressCloudHandoff({ conversationId: 33, summary: "ملخص" }, {
      connection: { baseUrl: `http://127.0.0.1:${server.address().port}`, accountId: "1", apiToken: "test-token" },
      botpress: { enabled: true },
      audit: false
    });
    assert.equal(result.skipped, true);
    assert.equal(result.reason, "conversation_resolved");
    assert.deepEqual(writes, []);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
