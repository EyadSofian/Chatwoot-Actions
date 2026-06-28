import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";

test("forwardIncomingToBotpress blocks assigned conversations using live Chatwoot details", async () => {
  let botpressCalled = false;
  const previousEnv = {
    CHATWOOT_BASE_URL: process.env.CHATWOOT_BASE_URL,
    CHATWOOT_ACCOUNT_ID: process.env.CHATWOOT_ACCOUNT_ID,
    CHATWOOT_API_TOKEN: process.env.CHATWOOT_API_TOKEN,
    BOTPRESS_WEBHOOK_URL: process.env.BOTPRESS_WEBHOOK_URL,
    BOTPRESS_PAT: process.env.BOTPRESS_PAT,
    BRIDGE_REQUIRE_LABEL: process.env.BRIDGE_REQUIRE_LABEL,
    BOT_INBOX_IDS: process.env.BOT_INBOX_IDS
  };

  const chatwootServer = createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    res.setHeader("content-type", "application/json; charset=utf-8");

    if (url.pathname === "/api/v1/accounts/1/conversations/33" && req.method === "GET") {
      res.end(JSON.stringify({
        id: 33,
        status: "open",
        inbox_id: 27,
        labels: ["needs-bot"],
        meta: {
          assignee: { id: 19, name: "Abdelrahman Tarek" },
          inbox: { id: 27, name: "WhatsApp" }
        }
      }));
      return;
    }

    res.statusCode = 404;
    res.end(JSON.stringify({ error: "not found" }));
  });

  const botpressServer = createServer((req, res) => {
    botpressCalled = true;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ ok: true }));
  });

  await new Promise(resolve => chatwootServer.listen(0, "127.0.0.1", resolve));
  await new Promise(resolve => botpressServer.listen(0, "127.0.0.1", resolve));

  try {
    process.env.CHATWOOT_BASE_URL = `http://127.0.0.1:${chatwootServer.address().port}`;
    process.env.CHATWOOT_ACCOUNT_ID = "1";
    process.env.CHATWOOT_API_TOKEN = "test-token";
    process.env.BOTPRESS_WEBHOOK_URL = `http://127.0.0.1:${botpressServer.address().port}/hook`;
    process.env.BOTPRESS_PAT = "";
    process.env.BRIDGE_REQUIRE_LABEL = "needs-bot";
    process.env.BOT_INBOX_IDS = "27";

    const { forwardIncomingToBotpress } = await import(`../src/botpressBridge.js?assigned-gate=${Date.now()}`);
    const result = await forwardIncomingToBotpress({
      id: "message-1",
      message_type: "incoming",
      private: false,
      content: "تم",
      conversation: {
        id: 33,
        inbox_id: 27,
        labels: ["needs-bot"]
      },
      sender: { id: 10, name: "Eyad Sofian" }
    });

    assert.equal(result.skipped, true);
    assert.equal(result.reason, "gate_blocked");
    assert.equal(result.hasLabel, true);
    assert.equal(result.assigneeId, 19);
    assert.equal(botpressCalled, false);
  } finally {
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await new Promise(resolve => chatwootServer.close(resolve));
    await new Promise(resolve => botpressServer.close(resolve));
  }
});

test("forwardIncomingToBotpress skips broadcast conversations even with the needs-bot label", async () => {
  let botpressCalled = false;
  const previousEnv = {
    CHATWOOT_BASE_URL: process.env.CHATWOOT_BASE_URL,
    CHATWOOT_ACCOUNT_ID: process.env.CHATWOOT_ACCOUNT_ID,
    CHATWOOT_API_TOKEN: process.env.CHATWOOT_API_TOKEN,
    BOTPRESS_WEBHOOK_URL: process.env.BOTPRESS_WEBHOOK_URL,
    BOTPRESS_PAT: process.env.BOTPRESS_PAT,
    BRIDGE_REQUIRE_LABEL: process.env.BRIDGE_REQUIRE_LABEL,
    BOT_INBOX_IDS: process.env.BOT_INBOX_IDS
  };

  const chatwootServer = createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    res.setHeader("content-type", "application/json; charset=utf-8");

    if (url.pathname === "/api/v1/accounts/1/conversations/34" && req.method === "GET") {
      res.end(JSON.stringify({
        id: 34,
        status: "open",
        inbox_id: 27,
        labels: ["needs-bot"],
        campaign_id: 7,
        meta: { inbox: { id: 27, name: "WhatsApp" } }
      }));
      return;
    }

    res.statusCode = 404;
    res.end(JSON.stringify({ error: "not found" }));
  });

  const botpressServer = createServer((req, res) => {
    botpressCalled = true;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ ok: true }));
  });

  await new Promise(resolve => chatwootServer.listen(0, "127.0.0.1", resolve));
  await new Promise(resolve => botpressServer.listen(0, "127.0.0.1", resolve));

  try {
    process.env.CHATWOOT_BASE_URL = `http://127.0.0.1:${chatwootServer.address().port}`;
    process.env.CHATWOOT_ACCOUNT_ID = "1";
    process.env.CHATWOOT_API_TOKEN = "test-token";
    process.env.BOTPRESS_WEBHOOK_URL = `http://127.0.0.1:${botpressServer.address().port}/hook`;
    process.env.BOTPRESS_PAT = "";
    process.env.BRIDGE_REQUIRE_LABEL = "needs-bot";
    process.env.BOT_INBOX_IDS = "27";

    const { forwardIncomingToBotpress } = await import(`../src/botpressBridge.js?broadcast-gate=${Date.now()}`);
    const result = await forwardIncomingToBotpress({
      id: "message-2",
      message_type: "incoming",
      private: false,
      content: "مهتم بالعرض",
      conversation: {
        id: 34,
        inbox_id: 27,
        labels: ["needs-bot"]
      },
      sender: { id: 11, name: "Broadcast Lead" }
    });

    assert.equal(result.skipped, true);
    assert.equal(result.reason, "broadcast");
    assert.equal(botpressCalled, false);
  } finally {
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await new Promise(resolve => chatwootServer.close(resolve));
    await new Promise(resolve => botpressServer.close(resolve));
  }
});

test("forwardIncomingToBotpress releases a resolved broadcast conversation to Fahd", async () => {
  let botpressBody = null;
  const previousEnv = {
    CHATWOOT_BASE_URL: process.env.CHATWOOT_BASE_URL,
    CHATWOOT_ACCOUNT_ID: process.env.CHATWOOT_ACCOUNT_ID,
    CHATWOOT_API_TOKEN: process.env.CHATWOOT_API_TOKEN,
    BOTPRESS_WEBHOOK_URL: process.env.BOTPRESS_WEBHOOK_URL,
    BOTPRESS_PAT: process.env.BOTPRESS_PAT,
    BRIDGE_REQUIRE_LABEL: process.env.BRIDGE_REQUIRE_LABEL,
    BOT_INBOX_IDS: process.env.BOT_INBOX_IDS
  };

  const chatwootServer = createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    res.setHeader("content-type", "application/json; charset=utf-8");

    if (url.pathname === "/api/v1/accounts/1/conversations/35" && req.method === "GET") {
      res.end(JSON.stringify({
        id: 35,
        status: "open",
        inbox_id: 27,
        labels: ["needs-bot"],
        campaign_id: 7,
        meta: { inbox: { id: 27, name: "WhatsApp" } },
        messages: [
          { id: 1, message_type: 2, content_type: "activity", content: "Conversation was marked resolved by Agent" },
          { id: 2, message_type: 0, content: "أهلاً، عندي استفسار جديد" }
        ]
      }));
      return;
    }

    res.statusCode = 404;
    res.end(JSON.stringify({ error: "not found" }));
  });

  const botpressServer = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    botpressBody = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ ok: true }));
  });

  await new Promise(resolve => chatwootServer.listen(0, "127.0.0.1", resolve));
  await new Promise(resolve => botpressServer.listen(0, "127.0.0.1", resolve));

  try {
    process.env.CHATWOOT_BASE_URL = `http://127.0.0.1:${chatwootServer.address().port}`;
    process.env.CHATWOOT_ACCOUNT_ID = "1";
    process.env.CHATWOOT_API_TOKEN = "test-token";
    process.env.BOTPRESS_WEBHOOK_URL = `http://127.0.0.1:${botpressServer.address().port}/hook`;
    process.env.BOTPRESS_PAT = "";
    process.env.BRIDGE_REQUIRE_LABEL = "needs-bot";
    process.env.BOT_INBOX_IDS = "27";

    const { forwardIncomingToBotpress } = await import(`../src/botpressBridge.js?released-gate=${Date.now()}`);
    const result = await forwardIncomingToBotpress({
      id: "message-3",
      message_type: "incoming",
      private: false,
      content: "أهلاً، عندي استفسار جديد",
      conversation: { id: 35, inbox_id: 27, labels: ["needs-bot"] },
      sender: { id: 12, name: "Returning Lead" }
    });

    assert.equal(result.forwarded, true);
    assert.equal(result.conversationId, "35");
    assert.ok(botpressBody, "Botpress should receive the released conversation");
  } finally {
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await new Promise(resolve => chatwootServer.close(resolve));
    await new Promise(resolve => botpressServer.close(resolve));
  }
});

test("forwardIncomingToBotpress forwards a resolved re-entry even if a stale assignee remains", async () => {
  let botpressCalled = false;
  const previousEnv = {
    CHATWOOT_BASE_URL: process.env.CHATWOOT_BASE_URL,
    CHATWOOT_ACCOUNT_ID: process.env.CHATWOOT_ACCOUNT_ID,
    CHATWOOT_API_TOKEN: process.env.CHATWOOT_API_TOKEN,
    BOTPRESS_WEBHOOK_URL: process.env.BOTPRESS_WEBHOOK_URL,
    BOTPRESS_PAT: process.env.BOTPRESS_PAT,
    BRIDGE_REQUIRE_LABEL: process.env.BRIDGE_REQUIRE_LABEL,
    BOT_INBOX_IDS: process.env.BOT_INBOX_IDS
  };

  const chatwootServer = createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    res.setHeader("content-type", "application/json; charset=utf-8");

    if (url.pathname === "/api/v1/accounts/1/conversations/36" && req.method === "GET") {
      res.end(JSON.stringify({
        id: 36,
        status: "open",
        inbox_id: 27,
        labels: ["needs-bot"],
        meta: {
          assignee: { id: 19, name: "Stale Agent" },
          inbox: { id: 27, name: "WhatsApp" }
        },
        messages: [
          { id: 1, message_type: 2, content_type: "activity", content: "Conversation was marked resolved by Agent" },
          { id: 2, message_type: 0, content: "رجعت تاني عندي سؤال" }
        ]
      }));
      return;
    }

    res.statusCode = 404;
    res.end(JSON.stringify({ error: "not found" }));
  });

  const botpressServer = createServer((req, res) => {
    botpressCalled = true;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ ok: true }));
  });

  await new Promise(resolve => chatwootServer.listen(0, "127.0.0.1", resolve));
  await new Promise(resolve => botpressServer.listen(0, "127.0.0.1", resolve));

  try {
    process.env.CHATWOOT_BASE_URL = `http://127.0.0.1:${chatwootServer.address().port}`;
    process.env.CHATWOOT_ACCOUNT_ID = "1";
    process.env.CHATWOOT_API_TOKEN = "test-token";
    process.env.BOTPRESS_WEBHOOK_URL = `http://127.0.0.1:${botpressServer.address().port}/hook`;
    process.env.BOTPRESS_PAT = "";
    process.env.BRIDGE_REQUIRE_LABEL = "needs-bot";
    process.env.BOT_INBOX_IDS = "27";

    const { forwardIncomingToBotpress } = await import(`../src/botpressBridge.js?stale-assignee=${Date.now()}`);
    const result = await forwardIncomingToBotpress({
      id: "message-4",
      message_type: "incoming",
      private: false,
      content: "رجعت تاني عندي سؤال",
      conversation: { id: 36, inbox_id: 27, labels: ["needs-bot"] },
      sender: { id: 13, name: "Returning Customer" }
    });

    assert.equal(result.forwarded, true);
    assert.equal(result.conversationId, "36");
    assert.equal(botpressCalled, true);
  } finally {
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await new Promise(resolve => chatwootServer.close(resolve));
    await new Promise(resolve => botpressServer.close(resolve));
  }
});

test("forwardIncomingToBotpress releases a broadcast conversation via the durable resolve marker even when no resolve activity is in the messages", async () => {
  // Reproduces the production failure: a resolved campaign conversation re-enters,
  // but Chatwoot does not return the "marked resolved" activity in the messages
  // payload. The durable marker (engosoft_bot_release) must still release it.
  let botpressBody = null;
  const previousEnv = {
    CHATWOOT_BASE_URL: process.env.CHATWOOT_BASE_URL,
    CHATWOOT_ACCOUNT_ID: process.env.CHATWOOT_ACCOUNT_ID,
    CHATWOOT_API_TOKEN: process.env.CHATWOOT_API_TOKEN,
    BOTPRESS_WEBHOOK_URL: process.env.BOTPRESS_WEBHOOK_URL,
    BOTPRESS_PAT: process.env.BOTPRESS_PAT,
    BRIDGE_REQUIRE_LABEL: process.env.BRIDGE_REQUIRE_LABEL,
    BOT_INBOX_IDS: process.env.BOT_INBOX_IDS
  };

  const chatwootServer = createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    res.setHeader("content-type", "application/json; charset=utf-8");

    if (url.pathname === "/api/v1/accounts/1/conversations/68426" && req.method === "GET") {
      res.end(JSON.stringify({
        id: 68426,
        status: "open",
        inbox_id: 27,
        labels: ["needs-bot"],
        campaign_id: 7,
        // No resolve-activity message here — the message scan would miss it.
        custom_attributes: { engosoft_bot_release: "2026-06-28T16:18:00.000Z" },
        meta: { inbox: { id: 27, name: "WhatsApp" } },
        messages: [
          { id: 9, message_type: 0, content: "انا دافع الدورات حضوري" }
        ]
      }));
      return;
    }

    res.statusCode = 404;
    res.end(JSON.stringify({ error: "not found" }));
  });

  const botpressServer = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    botpressBody = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ ok: true }));
  });

  await new Promise(resolve => chatwootServer.listen(0, "127.0.0.1", resolve));
  await new Promise(resolve => botpressServer.listen(0, "127.0.0.1", resolve));

  try {
    process.env.CHATWOOT_BASE_URL = `http://127.0.0.1:${chatwootServer.address().port}`;
    process.env.CHATWOOT_ACCOUNT_ID = "1";
    process.env.CHATWOOT_API_TOKEN = "test-token";
    process.env.BOTPRESS_WEBHOOK_URL = `http://127.0.0.1:${botpressServer.address().port}/hook`;
    process.env.BOTPRESS_PAT = "";
    process.env.BRIDGE_REQUIRE_LABEL = "needs-bot";
    process.env.BOT_INBOX_IDS = "27";

    const { forwardIncomingToBotpress } = await import(`../src/botpressBridge.js?marker-release=${Date.now()}`);
    const result = await forwardIncomingToBotpress({
      id: "message-68426",
      message_type: "incoming",
      private: false,
      content: "انا دافع الدورات حضوري",
      conversation: { id: 68426, inbox_id: 27, labels: ["needs-bot"] },
      sender: { id: 13, name: "Basel" }
    });

    assert.equal(result.forwarded, true);
    assert.equal(result.conversationId, "68426");
    assert.ok(botpressBody, "Botpress should receive the marker-released conversation");
  } finally {
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await new Promise(resolve => chatwootServer.close(resolve));
    await new Promise(resolve => botpressServer.close(resolve));
  }
});
