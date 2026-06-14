import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import {
  buildPhoneAssignPreview,
  extractPhoneNumbers,
  getOpenConversationReport,
  handleDepartmentRouterWebhook,
  handleReopenRouterWebhook,
  normalizePhone,
  parseDepartmentSelection,
  parsePhoneAssignInput
} from "../src/operations.js";

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

test("parseDepartmentSelection understands numeric, Arabic, and English replies", () => {
  assert.equal(parseDepartmentSelection("1"), "sales");
  assert.equal(parseDepartmentSelection("١"), "sales");
  assert.equal(parseDepartmentSelection("المبيعات"), "sales");
  assert.equal(parseDepartmentSelection("2"), "operations");
  assert.equal(parseDepartmentSelection("٢"), "operations");
  assert.equal(parseDepartmentSelection("Operations"), "operations");
  assert.equal(parseDepartmentSelection("محتاج مساعدة"), null);
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
              sender: { id: 10, name: "Ahmed", phone_number: "+966558262332" },
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
              sender: { id: 11, name: "Sara", phone_number: "+966566969482" },
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
    assert.equal(report.conversations[0].phoneNumber, "+966558262332");
    assert.equal(report.conversations[0].contactDisplay, "Ahmed - +966558262332");
    assert.equal(report.unread.length, 1);
    assert.equal(report.inboxes[0].unreadCount, 1);
    assert.equal(report.agents[0].unreadCount, 1);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test("getOpenConversationReport can detect customers needing a sales reply", async () => {
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
            unread_count: 1,
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
              assignee: { id: 4, name: "Old Agent" },
              inbox: { id: 2, name: "WhatsApp" }
            }
          }
        ] : []
      }));
      return;
    }

    if (url.pathname === "/api/v1/accounts/1/conversations/33/messages") {
      res.end(JSON.stringify({
        payload: [
          { id: 1, message_type: 1, sender_type: "User", sender: { name: "Old Agent" }, created_at: 100 },
          { id: 2, message_type: 0, sender_type: "Contact", sender: { name: "Ahmed" }, created_at: 200 }
        ]
      }));
      return;
    }

    if (url.pathname === "/api/v1/accounts/1/conversations/34/messages") {
      res.end(JSON.stringify({
        payload: [
          { id: 3, message_type: 0, sender_type: "Contact", sender: { name: "Sara" }, created_at: 100 },
          { id: 4, message_type: 1, sender_type: "User", sender: { name: "Old Agent" }, created_at: 300 }
        ]
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
      includeReplyStatus: true,
      replyCheckLimit: 10,
      maxPages: 2
    });

    assert.equal(report.criteria.includeReplyStatus, true);
    assert.equal(report.totals.openCount, 2);
    assert.equal(report.totals.needsReplyCount, 1);
    assert.equal(report.totals.repliedCount, 1);
    assert.equal(report.needsReply.length, 1);
    assert.equal(report.selectedAgentNeedsReply.length, 1);
    assert.equal(report.needsReply[0].conversationId, 33);
    assert.equal(report.needsReply[0].replyStatus, "needs_reply");
    assert.equal(report.conversations.find(item => item.conversationId === 34).replyStatus, "replied");
    assert.equal(report.agents[0].needsReplyCount, 1);
    assert.equal(report.agents[0].repliedCount, 1);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test("handleReopenRouterWebhook assigns incoming reopened conversations to an online agent", async () => {
  let assignmentBody = null;
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    res.setHeader("content-type", "application/json; charset=utf-8");

    if (url.pathname === "/api/v1/accounts/1/agents") {
      res.end(JSON.stringify([
        { id: 4, name: "Old Agent", availability_status: "offline" },
        { id: 7, name: "Online Agent", availability_status: "online" }
      ]));
      return;
    }

    if (url.pathname === "/api/v1/accounts/1/inbox_members/2") {
      res.end(JSON.stringify({
        payload: [
          { id: 4, name: "Old Agent", availability_status: "offline" },
          { id: 7, name: "Online Agent", availability_status: "online" }
        ]
      }));
      return;
    }

    if (url.pathname === "/api/v1/accounts/1/conversations/33/assignments" && req.method === "POST") {
      assignmentBody = await readRequestJson(req);
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    res.statusCode = 404;
    res.end(JSON.stringify({ error: "not found" }));
  });

  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const { port } = server.address();
    const result = await handleReopenRouterWebhook(reopenPayload(), {
      connection: {
        baseUrl: `http://127.0.0.1:${port}`,
        accountId: "1",
        apiToken: "test-token"
      },
      enabled: true,
      cooldownSeconds: 0,
      audit: false
    });

    assert.equal(result.action, "assigned");
    assert.equal(result.fromAgentId, 4);
    assert.equal(result.fromAgentStatus, "offline");
    assert.equal(result.toAgentId, 7);
    assert.deepEqual(assignmentBody, { assignee_id: 7 });
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test("handleDepartmentRouterWebhook routes choice 1 to an online sales team inbox member", async () => {
  let assignmentBody = null;
  let customAttributesBody = null;
  const outgoingMessages = [];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    res.setHeader("content-type", "application/json; charset=utf-8");

    if (url.pathname === "/api/v1/accounts/1/conversations/33" && req.method === "GET") {
      res.end(JSON.stringify({
        id: 33,
        status: "open",
        inbox_id: 2,
        custom_attributes: {
          engosoft_department_route_state: "pending"
        },
        meta: {
          sender: { id: 10, name: "Ahmed" },
          assignee: null,
          inbox: { id: 2, name: "WhatsApp" }
        }
      }));
      return;
    }

    if (url.pathname === "/api/v1/accounts/1/teams/4/team_members") {
      res.end(JSON.stringify([
        { id: 7, name: "Sales Online", availability_status: "online" },
        { id: 9, name: "Sales Outside Inbox", availability_status: "online" }
      ]));
      return;
    }

    if (url.pathname === "/api/v1/accounts/1/inbox_members/2") {
      res.end(JSON.stringify({
        payload: [
          { id: 7, name: "Sales Online", availability_status: "online" }
        ]
      }));
      return;
    }

    if (url.pathname === "/api/v1/accounts/1/conversations/33/assignments" && req.method === "POST") {
      assignmentBody = await readRequestJson(req);
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (url.pathname === "/api/v1/accounts/1/conversations/33/custom_attributes" && req.method === "POST") {
      customAttributesBody = await readRequestJson(req);
      res.end(JSON.stringify({ custom_attributes: customAttributesBody.custom_attributes }));
      return;
    }

    if (url.pathname === "/api/v1/accounts/1/conversations/33/messages" && req.method === "POST") {
      outgoingMessages.push(await readRequestJson(req));
      res.end(JSON.stringify({ id: 501 }));
      return;
    }

    res.statusCode = 404;
    res.end(JSON.stringify({ error: "not found" }));
  });

  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const { port } = server.address();
    const stateStore = createMemoryDepartmentStateStore({
      33: { conversationId: 33, state: "pending" }
    });
    const payload = reopenPayload();
    payload.message.content = "1";
    const result = await handleDepartmentRouterWebhook(payload, {
      connection: {
        baseUrl: `http://127.0.0.1:${port}`,
        accountId: "1",
        apiToken: "test-token"
      },
      enabled: true,
      inboxIds: ["2"],
      salesTeamId: "4",
      operationsTeamId: "3",
      stateStore,
      audit: false
    });

    assert.equal(result.handled, true);
    assert.equal(result.action, "department_assigned");
    assert.equal(result.department, "sales");
    assert.equal(result.teamId, 4);
    assert.equal(result.toAgentId, 7);
    assert.deepEqual(assignmentBody, { team_id: 4, assignee_id: 7 });
    assert.equal(customAttributesBody.custom_attributes.engosoft_department, "sales");
    assert.equal(customAttributesBody.custom_attributes.engosoft_department_route_state, "routed");
    assert.equal(outgoingMessages.length, 1);
    assert.match(outgoingMessages[0].content, /المبيعات/);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test("handleDepartmentRouterWebhook waits for the first incoming message before prompting a new contact", async () => {
  let customAttributesBody = null;
  let assignmentBody = null;
  const outgoingMessages = [];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    res.setHeader("content-type", "application/json; charset=utf-8");

    if (url.pathname === "/api/v1/accounts/1/conversations/33" && req.method === "GET") {
      res.end(JSON.stringify({
        id: 33,
        status: "open",
        inbox_id: 2,
        contact_id: 10,
        custom_attributes: {},
        meta: {
          sender: { id: 10, name: "New Contact" },
          assignee: { id: 4, name: "Temporary Agent" }
        }
      }));
      return;
    }

    if (url.pathname === "/api/v1/accounts/1/contacts/10/conversations") {
      res.end(JSON.stringify({
        payload: [{ id: 33, status: "open", inbox_id: 2 }]
      }));
      return;
    }

    if (url.pathname === "/api/v1/accounts/1/conversations/33/assignments" && req.method === "POST") {
      assignmentBody = await readRequestJson(req);
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (url.pathname === "/api/v1/accounts/1/conversations/33/messages" && req.method === "POST") {
      outgoingMessages.push(await readRequestJson(req));
      res.end(JSON.stringify({ id: 500 }));
      return;
    }

    if (url.pathname === "/api/v1/accounts/1/conversations/33/custom_attributes" && req.method === "POST") {
      customAttributesBody = await readRequestJson(req);
      res.end(JSON.stringify({ custom_attributes: customAttributesBody.custom_attributes }));
      return;
    }

    res.statusCode = 404;
    res.end(JSON.stringify({ error: "not found" }));
  });

  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const { port } = server.address();
    const stateStore = createMemoryDepartmentStateStore();
    const options = {
      connection: {
        baseUrl: `http://127.0.0.1:${port}`,
        accountId: "1",
        apiToken: "test-token"
      },
      enabled: true,
      inboxIds: ["2"],
      salesTeamId: "4",
      operationsTeamId: "3",
      stateStore,
      audit: false
    };
    const created = await handleDepartmentRouterWebhook({
      event: "conversation_created",
      id: 33,
      inbox_id: 2
    }, options);

    assert.equal(created.handled, true);
    assert.equal(created.action, "new_conversation_registered");
    assert.equal(outgoingMessages.length, 0);
    assert.equal(assignmentBody, null);
    assert.equal((await stateStore.get(33)).state, "new_waiting_incoming");

    const incoming = reopenPayload();
    incoming.message.content = "السلام عليكم";
    const prompted = await handleDepartmentRouterWebhook(incoming, options);

    assert.equal(prompted.action, "department_prompt_sent");
    assert.equal(outgoingMessages.length, 1);
    assert.match(outgoingMessages[0].content, /اكتب 1/);
    assert.match(outgoingMessages[0].content, /اكتب 2/);
    assert.deepEqual(assignmentBody, { assignee_id: null });
    assert.equal(customAttributesBody.custom_attributes.engosoft_department_route_state, "pending");
    assert.equal(customAttributesBody.custom_attributes.engosoft_department_prompt_next, false);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test("handleDepartmentRouterWebhook never prompts a contact with previous conversations", async () => {
  let writeCalls = 0;
  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    res.setHeader("content-type", "application/json; charset=utf-8");

    if (url.pathname === "/api/v1/accounts/1/conversations/33" && req.method === "GET") {
      res.end(JSON.stringify({
        id: 33,
        status: "open",
        inbox_id: 2,
        contact_id: 10,
        custom_attributes: {},
        meta: { sender: { id: 10, name: "Existing Contact" } }
      }));
      return;
    }

    if (url.pathname === "/api/v1/accounts/1/contacts/10/conversations") {
      res.end(JSON.stringify({
        payload: [
          { id: 12, status: "resolved", inbox_id: 2 },
          { id: 33, status: "open", inbox_id: 2 }
        ]
      }));
      return;
    }

    writeCalls += 1;
    res.end(JSON.stringify({ ok: true }));
  });

  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const { port } = server.address();
    const stateStore = createMemoryDepartmentStateStore();
    const options = {
      connection: {
        baseUrl: `http://127.0.0.1:${port}`,
        accountId: "1",
        apiToken: "test-token"
      },
      enabled: true,
      inboxIds: ["2"],
      salesTeamId: "4",
      operationsTeamId: "3",
      stateStore,
      audit: false
    };
    const created = await handleDepartmentRouterWebhook({
      event: "conversation_created",
      id: 33,
      inbox_id: 2
    }, options);
    const incoming = reopenPayload();
    incoming.message.content = "السلام عليكم";
    const replied = await handleDepartmentRouterWebhook(incoming, options);

    assert.equal(created.reason, "existing_contact_has_history");
    assert.equal(replied.reason, "existing_department_unknown");
    assert.equal(writeCalls, 0);
    assert.equal((await stateStore.get(33)).state, "existing_contact");
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test("handleDepartmentRouterWebhook marks resolved conversations to prompt on the next reply", async () => {
  let customAttributesBody = null;
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    res.setHeader("content-type", "application/json; charset=utf-8");

    if (url.pathname === "/api/v1/accounts/1/conversations/33" && req.method === "GET") {
      res.end(JSON.stringify({
        id: 33,
        status: "resolved",
        inbox_id: 2,
        custom_attributes: {
          engosoft_department: "sales",
          engosoft_department_team_id: 4
        }
      }));
      return;
    }

    if (url.pathname === "/api/v1/accounts/1/conversations/33/custom_attributes" && req.method === "POST") {
      customAttributesBody = await readRequestJson(req);
      res.end(JSON.stringify({ custom_attributes: customAttributesBody.custom_attributes }));
      return;
    }

    res.statusCode = 404;
    res.end(JSON.stringify({ error: "not found" }));
  });

  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const { port } = server.address();
    const stateStore = createMemoryDepartmentStateStore();
    const result = await handleDepartmentRouterWebhook({
      event: "conversation_status_changed",
      id: 33,
      status: "resolved",
      inbox_id: 2
    }, {
      connection: {
        baseUrl: `http://127.0.0.1:${port}`,
        accountId: "1",
        apiToken: "test-token"
      },
      enabled: true,
      inboxIds: ["2"],
      salesTeamId: "4",
      operationsTeamId: "3",
      promptOnResolved: true,
      stateStore,
      audit: false
    });

    assert.equal(result.handled, true);
    assert.equal(result.action, "marked_for_reentry");
    assert.equal(customAttributesBody.custom_attributes.engosoft_department_prompt_next, true);
    assert.equal(customAttributesBody.custom_attributes.engosoft_department_route_state, "resolved");
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test("handleDepartmentRouterWebhook ignores old open conversations with no known department", async () => {
  let writeCalls = 0;
  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    res.setHeader("content-type", "application/json; charset=utf-8");

    if (url.pathname === "/api/v1/accounts/1/conversations/33" && req.method === "GET") {
      res.end(JSON.stringify({
        id: 33,
        status: "open",
        inbox_id: 2,
        custom_attributes: {},
        meta: { assignee: { id: 4, name: "Existing Agent" } }
      }));
      return;
    }

    writeCalls += 1;
    res.end(JSON.stringify({ ok: true }));
  });

  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const { port } = server.address();
    const stateStore = createMemoryDepartmentStateStore();
    const payload = reopenPayload();
    payload.message.content = "عندي استفسار";
    const result = await handleDepartmentRouterWebhook(payload, {
      connection: {
        baseUrl: `http://127.0.0.1:${port}`,
        accountId: "1",
        apiToken: "test-token"
      },
      enabled: true,
      inboxIds: ["2"],
      salesTeamId: "4",
      operationsTeamId: "3",
      stateStore,
      audit: false
    });

    assert.equal(result.skipped, true);
    assert.equal(result.reason, "contact_id_unavailable");
    assert.equal(writeCalls, 0);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test("handleDepartmentRouterWebhook does not repeat the menu for invalid or duplicate replies", async () => {
  let writeCalls = 0;
  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    res.setHeader("content-type", "application/json; charset=utf-8");

    if (url.pathname === "/api/v1/accounts/1/conversations/33" && req.method === "GET") {
      res.end(JSON.stringify({
        id: 33,
        status: "open",
        inbox_id: 2,
        custom_attributes: {}
      }));
      return;
    }

    writeCalls += 1;
    res.end(JSON.stringify({ ok: true }));
  });

  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const { port } = server.address();
    const stateStore = createMemoryDepartmentStateStore({
      33: { conversationId: 33, state: "pending", promptedAt: new Date().toISOString() }
    });
    const payload = reopenPayload();
    payload.message.content = "محتاج مساعدة";

    const options = {
      connection: {
        baseUrl: `http://127.0.0.1:${port}`,
        accountId: "1",
        apiToken: "test-token"
      },
      enabled: true,
      inboxIds: ["2"],
      salesTeamId: "4",
      operationsTeamId: "3",
      stateStore,
      audit: false
    };
    const first = await handleDepartmentRouterWebhook(payload, options);
    const duplicate = await handleDepartmentRouterWebhook(payload, options);

    assert.equal(first.action, "awaiting_department");
    assert.equal(duplicate.reason, "duplicate_incoming_message");
    assert.equal(writeCalls, 0);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test("handleDepartmentRouterWebhook never prompts or routes broadcast conversations", async () => {
  let writeCalls = 0;
  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    res.setHeader("content-type", "application/json; charset=utf-8");

    if (url.pathname === "/api/v1/accounts/1/conversations/33" && req.method === "GET") {
      res.end(JSON.stringify({
        id: 33,
        status: "open",
        inbox_id: 2,
        contact_id: 10,
        custom_attributes: {},
        additional_attributes: { campaign_id: 88 },
        meta: { assignee: { id: 4, name: "Old Agent" } }
      }));
      return;
    }

    writeCalls += 1;
    res.end(JSON.stringify({ ok: true }));
  });

  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const { port } = server.address();
    const stateStore = createMemoryDepartmentStateStore();
    const options = {
      connection: {
        baseUrl: `http://127.0.0.1:${port}`,
        accountId: "1",
        apiToken: "test-token"
      },
      enabled: true,
      inboxIds: ["2"],
      salesTeamId: "4",
      operationsTeamId: "3",
      stateStore,
      audit: false
    };

    const created = await handleDepartmentRouterWebhook({
      event: "conversation_created",
      id: 33,
      inbox_id: 2,
      additional_attributes: { campaign_id: 88 }
    }, options);

    assert.equal(created.skipped, true);
    assert.equal(created.reason, "broadcast_conversation");
    assert.equal((await stateStore.get(33)).state, "broadcast");

    const reply = reopenPayload();
    reply.message.content = "1";
    const replied = await handleDepartmentRouterWebhook(reply, options);

    assert.equal(replied.skipped, true);
    assert.equal(replied.reason, "broadcast_conversation");
    assert.equal(writeCalls, 0);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test("handleReopenRouterWebhook leaves conversations assigned to online agents", async () => {
  let assignmentCalled = false;
  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    res.setHeader("content-type", "application/json; charset=utf-8");

    if (url.pathname === "/api/v1/accounts/1/agents") {
      res.end(JSON.stringify([
        { id: 4, name: "Old Agent", availability_status: "online" },
        { id: 7, name: "Online Agent", availability_status: "online" }
      ]));
      return;
    }

    if (url.pathname === "/api/v1/accounts/1/inbox_members/2") {
      res.end(JSON.stringify({
        payload: [
          { id: 4, name: "Old Agent", availability_status: "online" },
          { id: 7, name: "Online Agent", availability_status: "online" }
        ]
      }));
      return;
    }

    if (url.pathname === "/api/v1/accounts/1/conversations/33/assignments") {
      assignmentCalled = true;
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    res.statusCode = 404;
    res.end(JSON.stringify({ error: "not found" }));
  });

  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const { port } = server.address();
    const result = await handleReopenRouterWebhook(reopenPayload(), {
      connection: {
        baseUrl: `http://127.0.0.1:${port}`,
        accountId: "1",
        apiToken: "test-token"
      },
      enabled: true,
      cooldownSeconds: 0,
      audit: false
    });

    assert.equal(result.skipped, true);
    assert.equal(result.reason, "assignee_online");
    assert.equal(assignmentCalled, false);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test("handleReopenRouterWebhook restricts automatic assignment to the configured team", async () => {
  let assignmentBody = null;
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    res.setHeader("content-type", "application/json; charset=utf-8");

    if (url.pathname === "/api/v1/accounts/1/agents") {
      res.end(JSON.stringify([
        { id: 4, name: "Outside Current Agent", availability_status: "online" },
        { id: 8, name: "Outside Online Agent", availability_status: "online" },
        { id: 7, name: "Team Online Agent", availability_status: "online" },
        { id: 9, name: "Team Agent Outside Inbox", availability_status: "online" }
      ]));
      return;
    }

    if (url.pathname === "/api/v1/accounts/1/teams/3/team_members") {
      res.end(JSON.stringify([
        { id: 7, name: "Team Online Agent", availability_status: "online" },
        { id: 9, name: "Team Agent Outside Inbox", availability_status: "online" }
      ]));
      return;
    }

    if (url.pathname === "/api/v1/accounts/1/inbox_members/2") {
      res.end(JSON.stringify({
        payload: [
          { id: 7, name: "Team Online Agent", availability_status: "online" }
        ]
      }));
      return;
    }

    if (url.pathname === "/api/v1/accounts/1/conversations/33/assignments" && req.method === "POST") {
      assignmentBody = await readRequestJson(req);
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    res.statusCode = 404;
    res.end(JSON.stringify({ error: "not found" }));
  });

  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const { port } = server.address();
    const result = await handleReopenRouterWebhook(reopenPayload(), {
      connection: {
        baseUrl: `http://127.0.0.1:${port}`,
        accountId: "1",
        apiToken: "test-token"
      },
      enabled: true,
      teamId: "3",
      cooldownSeconds: 0,
      audit: false
    });

    assert.equal(result.action, "assigned");
    assert.equal(result.fromAgentStatus, "online");
    assert.equal(result.fromOutsideTargetTeam, true);
    assert.equal(result.targetTeamId, "3");
    assert.equal(result.toAgentId, 7);
    assert.deepEqual(assignmentBody, { assignee_id: 7, team_id: 3 });
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test("handleReopenRouterWebhook unassigns when no online agent is available", async () => {
  let assignmentBody = null;
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    res.setHeader("content-type", "application/json; charset=utf-8");

    if (url.pathname === "/api/v1/accounts/1/agents") {
      res.end(JSON.stringify([
        { id: 4, name: "Old Agent", availability_status: "offline" },
        { id: 7, name: "Busy Agent", availability_status: "busy" }
      ]));
      return;
    }

    if (url.pathname === "/api/v1/accounts/1/inbox_members/2") {
      res.end(JSON.stringify({
        payload: [
          { id: 4, name: "Old Agent", availability_status: "offline" },
          { id: 7, name: "Busy Agent", availability_status: "busy" }
        ]
      }));
      return;
    }

    if (url.pathname === "/api/v1/accounts/1/conversations/33/assignments" && req.method === "POST") {
      assignmentBody = await readRequestJson(req);
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    res.statusCode = 404;
    res.end(JSON.stringify({ error: "not found" }));
  });

  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const { port } = server.address();
    const result = await handleReopenRouterWebhook(reopenPayload(), {
      connection: {
        baseUrl: `http://127.0.0.1:${port}`,
        accountId: "1",
        apiToken: "test-token"
      },
      enabled: true,
      fallback: "unassign",
      cooldownSeconds: 0,
      audit: false
    });

    assert.equal(result.action, "unassigned");
    assert.equal(result.reason, "no_online_candidates");
    assert.deepEqual(assignmentBody, { assignee_id: null });
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

function reopenPayload(overrides = {}) {
  return {
    event: "message_created",
    message: {
      id: 99,
      message_type: 0,
      sender_type: "Contact",
      conversation_id: 33,
      conversation: {
        id: 33,
        status: "open",
        inbox_id: 2,
        meta: {
          sender: { id: 10, name: "Ahmed", phone_number: "+966558262332" },
          assignee: { id: 4, name: "Old Agent" },
          inbox: { id: 2, name: "WhatsApp" }
        }
      }
    },
    ...overrides
  };
}

async function readRequestJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function createMemoryDepartmentStateStore(initial = {}) {
  const rows = new Map(
    Object.entries(initial).map(([key, value]) => [String(key), { ...value }])
  );
  return {
    async get(conversationId) {
      const row = rows.get(String(conversationId));
      return row ? { ...row } : null;
    },
    async save(conversationId, changes) {
      const key = String(conversationId);
      const row = {
        ...(rows.get(key) || { conversationId }),
        ...changes,
        conversationId
      };
      rows.set(key, row);
      return { ...row };
    }
  };
}
