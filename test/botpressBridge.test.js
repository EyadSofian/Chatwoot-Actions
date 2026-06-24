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
