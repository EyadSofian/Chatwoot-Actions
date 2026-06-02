import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { buildPhoneAssignPreview, extractPhoneNumbers, getOpenConversationReport, normalizePhone, parsePhoneAssignInput } from "../src/operations.js";

test("normalizePhone removes formatting and international prefix", () => {
  assert.equal(normalizePhone("+966 55 826 2332"), "966558262332");
  assert.equal(normalizePhone("00966-55-826-2332"), "966558262332");
});

test("extractPhoneNumbers reads mixed CSV-style content and deduplicates", () => {
  const rows = [
    "Contact Name,Phone,Salesperson",
    "Ahmed,966558262332,Ahmed El-Shiekh",
    "Sara,+966 56 696 9482,Ahmed El-Shiekh",
    "Duplicate,966558262332,Ahmed El-Shiekh"
  ].join("\n");

  assert.deepEqual(extractPhoneNumbers(rows), [
    { inputPhone: "966558262332", normalizedPhone: "966558262332" },
    { inputPhone: "+966 56 696 9482", normalizedPhone: "966566969482" }
  ]);
});

test("buildPhoneAssignPreview matches phone contacts and conversations", async () => {
  const server = createServer((req, res) => {
    res.setHeader("content-type", "application/json; charset=utf-8");
    if (req.url.startsWith("/api/v1/accounts/1/contacts/search?")) {
      res.end(JSON.stringify({
        payload: [{ id: 10, name: "Ahmed", phone_number: "+966558262332" }]
      }));
      return;
    }

    if (req.url === "/api/v1/accounts/1/contacts/10/conversations") {
      res.end(JSON.stringify({
        payload: [{
          id: 33,
          status: "open",
          inbox_id: 2,
          meta: {
            sender: { id: 10, name: "Ahmed", phone_number: "+966558262332" },
            assignee: { id: 4, name: "Old Agent" },
            inbox: { id: 2, name: "WhatsApp" }
          }
        }]
      }));
      return;
    }

    res.statusCode = 404;
    res.end(JSON.stringify({ error: "not found" }));
  });

  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const { port } = server.address();
    const preview = await buildPhoneAssignPreview({
      baseUrl: `http://127.0.0.1:${port}`,
      accountId: "1",
      apiToken: "test-token"
    }, {
      rawText: "966558262332",
      targetAgentId: "7",
      status: "open",
      inboxId: "2",
      maxPhones: 20
    });

    assert.equal(preview.phoneCount, 1);
    assert.equal(preview.count, 1);
    assert.equal(preview.items[0].conversationId, 33);
    assert.equal(preview.items[0].targetAgentId, "7");
    assert.equal(preview.misses.length, 0);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test("buildPhoneAssignPreview rejects fuzzy search results without phone equality", async () => {
  const server = createServer((req, res) => {
    res.setHeader("content-type", "application/json; charset=utf-8");
    if (req.url.startsWith("/api/v1/accounts/1/contacts/search?")) {
      res.end(JSON.stringify({
        payload: [{ id: 113176, name: "Wrong Contact", phone_number: "+966500000000" }]
      }));
      return;
    }

    res.statusCode = 404;
    res.end(JSON.stringify({ error: "not found" }));
  });

  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const { port } = server.address();
    const preview = await buildPhoneAssignPreview({
      baseUrl: `http://127.0.0.1:${port}`,
      accountId: "1",
      apiToken: "test-token"
    }, {
      rawText: "966541582969",
      targetAgentId: "7",
      status: "all",
      maxPhones: 20
    });

    assert.equal(preview.count, 0);
    assert.equal(preview.misses.length, 1);
    assert.equal(preview.misses[0].reason, "No exact phone match in Chatwoot search results");
    assert.equal(preview.warnings.length, 0);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test("parsePhoneAssignInput returns a quick file count without Chatwoot", async () => {
  const parsed = await parsePhoneAssignInput({
    rawText: "Name,Phone\nAhmed,966558262332\nSara,+966 56 696 9482"
  });

  assert.equal(parsed.phoneCount, 2);
  assert.equal(parsed.sample[0].normalizedPhone, "966558262332");
});

test("getOpenConversationReport can filter unread conversations locally", async () => {
  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    res.setHeader("content-type", "application/json; charset=utf-8");

    if (url.pathname === "/api/v1/accounts/1/agents") {
      res.end(JSON.stringify([
        { id: 4, name: "Old Agent", email: "old@example.com" }
      ]));
      return;
    }

    if (url.pathname === "/api/v1/accounts/1/inboxes") {
      res.end(JSON.stringify({
        payload: [{ id: 2, name: "WhatsApp" }]
      }));
      return;
    }

    if (url.pathname === "/api/v1/accounts/1/conversations") {
      const page = Number(url.searchParams.get("page") || 1);
      res.end(JSON.stringify({
        payload: page === 1 ? [
          {
            id: 33,
            status: "open",
            unread_count: 2,
            inbox_id: 2,
            meta: {
              sender: { id: 10, name: "Ahmed" },
              assignee: { id: 4, name: "Old Agent" },
              inbox: { id: 2, name: "WhatsApp" }
            }
          },
          {
            id: 34,
            status: "open",
            unread_count: 0,
            inbox_id: 2,
            meta: {
              sender: { id: 11, name: "Sara" },
              assignee: null,
              inbox: { id: 2, name: "WhatsApp" }
            }
          }
        ] : []
      }));
      return;
    }

    res.statusCode = 404;
    res.end(JSON.stringify({ error: "not found" }));
  });

  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const { port } = server.address();
    const report = await getOpenConversationReport({
      baseUrl: `http://127.0.0.1:${port}`,
      accountId: "1",
      apiToken: "test-token"
    }, {
      inboxIds: ["2"],
      unreadOnly: true,
      maxPages: 2
    });

    assert.equal(report.criteria.unreadOnly, true);
    assert.equal(report.totals.openCount, 1);
    assert.equal(report.totals.unreadCount, 1);
    assert.equal(report.totals.assignedUnreadCount, 1);
    assert.equal(report.totals.unassignedUnreadCount, 0);
    assert.equal(report.conversations[0].conversationId, 33);
    assert.equal(report.conversations[0].unreadCount, 2);
    assert.equal(report.unread.length, 1);
    assert.equal(report.inboxes[0].unreadCount, 1);
    assert.equal(report.agents[0].unreadCount, 1);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
