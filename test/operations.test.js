import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import {
  buildPhoneAssignPreview,
  evaluateCustomerTimeout,
  extractPhoneNumbers,
  filterDepartmentAgents,
  getBotpressDepartment,
  getOpenConversationReport,
  handleBotpressCloudHandoff,
  handleDepartmentRouterWebhook,
  handleReopenRouterWebhook,
  handleResolvedReentryReset,
  isWithinBusinessHours,
  normalizePhone,
  parseDepartmentSelection,
  parsePhoneAssignInput,
  runCustomerTimeoutSweep
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
  assert.equal(parseDepartmentSelection("3"), "complaints");
  assert.equal(parseDepartmentSelection("Operations"), "operations");
  assert.equal(parseDepartmentSelection("دعم المتدربين"), "operations");
  assert.equal(parseDepartmentSelection("شكاوي"), "complaints");
  assert.equal(parseDepartmentSelection("محتاج مساعدة"), null);
});

test("getBotpressDepartment prefers an explicit department field", () => {
  assert.equal(getBotpressDepartment({ department: "sales" }), "sales");
  assert.equal(getBotpressDepartment({ workflow: { department: "complaints" } }), "complaints");
  assert.equal(getBotpressDepartment({ department: "دعم المتدربين" }), "operations");
  assert.equal(getBotpressDepartment({ intent: "sales" }), "sales");
});

test("getBotpressDepartment infers from the summary intent line when no field is sent", () => {
  const salesSummary = "النية: sales\nالاسم: Eyad\nالدورة: CFM\nالطلب/المشكلة: يرغب العميل في شراء كورس CFM.";
  assert.equal(getBotpressDepartment({ summary: salesSummary }), "sales");

  const complaintSummary = "النية: complaints\nالطلب/المشكلة: شكوى من الخدمة";
  assert.equal(getBotpressDepartment({ summary: complaintSummary }), "complaints");

  const arabicIntent = "النية: مبيعات\nالاسم: Eyad";
  assert.equal(getBotpressDepartment({ workflow: { chatSummary: arabicIntent } }), "sales");
});

test("getBotpressDepartment does not misread a request/problem label as operations", () => {
  // The summary uses "الطلب/المشكلة:" as a label; that must not match operations.
  const salesSummary = "النية: sales\nالطلب/المشكلة: عايز اشتري كورس";
  assert.equal(getBotpressDepartment({ summary: salesSummary }), "sales");
});

test("getBotpressDepartment defaults to operations only as a last resort", () => {
  assert.equal(getBotpressDepartment({ summary: "العميل طلب التحدث لموظف." }), "operations");
  assert.equal(getBotpressDepartment({}), "operations");
});

test("filterDepartmentAgents enforces team, inbox, and configured agent ids", () => {
  const teamAgents = [
    { id: 20, name: "Asmaa Fathy", availability_status: "online" },
    { id: 18, name: "Mena Magdy", availability_status: "online" },
    { id: 74, name: "Nader Aziz", availability_status: "online" }
  ];
  const inboxAgents = {
    payload: [
      { id: 20, name: "Asmaa Fathy" },
      { id: 74, name: "Nader Aziz" },
      { id: 99, name: "Outside Team" }
    ]
  };

  assert.deepEqual(
    filterDepartmentAgents(teamAgents, inboxAgents, ["20", "18"]).map(agent => agent.id),
    [20]
  );
});

test("isWithinBusinessHours respects timezone, time range, and working days", () => {
  const base = {
    enabled: true,
    timezone: "Asia/Riyadh", // UTC+3, no daylight saving
    startMinutes: 9 * 60,
    endMinutes: 22 * 60,
    days: new Set([0, 1, 2, 3, 4, 5, 6])
  };

  // 10:00Z -> 13:00 Riyadh -> inside 09:00-22:00
  assert.equal(isWithinBusinessHours(base, new Date("2026-06-14T10:00:00Z")), true);
  // 20:00Z -> 23:00 Riyadh -> outside
  assert.equal(isWithinBusinessHours(base, new Date("2026-06-14T20:00:00Z")), false);
  // No working days configured -> always outside
  assert.equal(isWithinBusinessHours({ ...base, days: new Set() }, new Date("2026-06-14T10:00:00Z")), false);
  // Disabled -> always treated as within hours
  assert.equal(isWithinBusinessHours({ enabled: false }, new Date("2026-06-14T20:00:00Z")), true);
});

test("handleBotpressCloudHandoff queues resolved reentry after hours when no online agent exists", async () => {
  const messages = [];
  const assignments = [];
  let statusCalled = false;
  let customAttributesBody = null;
  let labelsBody = null;
  let customAttributes = {
    engosoft_department_route_state: "resolved",
    engosoft_department_prompt_next: true
  };
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    res.setHeader("content-type", "application/json; charset=utf-8");

    if (url.pathname === "/api/v1/accounts/1/conversations/33" && req.method === "GET") {
      res.end(JSON.stringify({
        id: 33,
        status: "open",
        inbox_id: 2,
        labels: ["needs-bot", "vip"],
        custom_attributes: customAttributes,
        meta: {
          assignee: { id: 4, name: "Old Agent" },
          inbox: { id: 2, name: "WhatsApp" }
        }
      }));
      return;
    }

    if (url.pathname === "/api/v1/accounts/1/conversations/33/labels" && req.method === "GET") {
      res.end(JSON.stringify({ payload: ["needs-bot", "vip"] }));
      return;
    }

    if (url.pathname === "/api/v1/accounts/1/conversations/33/labels" && req.method === "POST") {
      labelsBody = await readRequestJson(req);
      res.end(JSON.stringify({ payload: labelsBody.labels }));
      return;
    }

    if (url.pathname === "/api/v1/accounts/1/conversations/33/messages" && req.method === "POST") {
      messages.push(await readRequestJson(req));
      res.end(JSON.stringify({ id: 700 + messages.length }));
      return;
    }

    if (url.pathname === "/api/v1/accounts/1/conversations/33/toggle_status" && req.method === "POST") {
      statusCalled = true;
      res.end(JSON.stringify({ status: "open" }));
      return;
    }
    if (url.pathname === "/api/v1/accounts/1/teams/3/team_members" && req.method === "GET") {
      res.end(JSON.stringify([
        { id: 21, name: "Abdelrahman Adel", availability_status: "offline" }
      ]));
      return;
    }
    if (url.pathname === "/api/v1/accounts/1/inbox_members/2" && req.method === "GET") {
      res.end(JSON.stringify([
        { id: 21, name: "Abdelrahman Adel", availability_status: "offline" }
      ]));
      return;
    }
    if (url.pathname === "/api/v1/accounts/1/conversations/33/assignments" && req.method === "POST") {
      assignments.push(await readRequestJson(req));
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    if (url.pathname === "/api/v1/accounts/1/conversations/33/custom_attributes" && req.method === "POST") {
      customAttributesBody = await readRequestJson(req);
      customAttributes = customAttributesBody.custom_attributes;
      res.end(JSON.stringify({ custom_attributes: customAttributesBody.custom_attributes }));
      return;
    }

    res.statusCode = 404;
    res.end(JSON.stringify({ error: "not found" }));
  });

  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const { port } = server.address();
    const result = await handleBotpressCloudHandoff({
      conversationId: 33,
      summary: "customer asked after hours",
      department: "operations"
    }, {
      connection: { baseUrl: `http://127.0.0.1:${port}`, accountId: "1", apiToken: "test-token" },
      enabled: true,
      operationsTeamId: "3",
      operationsAgentIds: ["21"],
      businessHoursEnabled: true,
      businessTimezone: "Africa/Cairo",
      businessStart: "10:00",
      businessEnd: "21:00",
      businessDays: ["0", "1", "2", "3", "4", "6"],
      businessHours: {
        enabled: true,
        timezone: "Africa/Cairo",
        startMinutes: 10 * 60,
        endMinutes: 21 * 60,
        days: new Set([0, 1, 2, 3, 4, 6]),
        now: () => new Date("2026-06-14T19:30:00Z")
      },
      botpress: {
        enabled: true,
        requireResolvedReentry: true,
        workingHoursEnabled: true,
        timezone: "Africa/Cairo",
        start: "10:00",
        end: "21:00",
        days: ["0", "1", "2", "3", "4", "6"],
        inHoursQueueMessage: "please wait",
        outsideHoursMessage: "outside hours",
        clearLabel: "needs-bot",
        now: () => new Date("2026-06-14T19:30:00Z")
      },
      audit: false
    });

    assert.equal(result.action, "botpress_cloud_handoff");
    assert.equal(result.routing.action, "department_team_unassigned");
    assert.equal(result.queueMessageId, 702);
    assert.equal(statusCalled, true);
    assert.equal(result.removedBotLabel, true);
    assert.deepEqual(assignments, [{ team_id: 3 }, { assignee_id: null }]);
    assert.deepEqual(labelsBody, { labels: ["vip"] });
    assert.equal(customAttributesBody.custom_attributes.engosoft_department_route_state, "routed");
    assert.deepEqual(messages, [{
      content: "\u{1F4DD} **\u0645\u0644\u062E\u0635 \u0641\u0647\u062F:**\ncustomer asked after hours",
      private: true,
      message_type: "outgoing",
      content_type: "text",
      content_attributes: {}
    }, {
      content: "outside hours",
      message_type: "outgoing",
      private: false,
      content_type: "text",
      content_attributes: {}
    }]);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test("handleBotpressCloudHandoff assigns resolved reentry to an online operations agent", async () => {
  const mock = createBotpressHandoffMock({
    teamAgents: [{ id: 21, name: "Abdelrahman Adel", availability_status: "online" }],
    inboxAgents: [{ id: 21, name: "Abdelrahman Adel", availability_status: "online" }]
  });

  await new Promise(resolve => mock.server.listen(0, "127.0.0.1", resolve));
  try {
    const { port } = mock.server.address();
    const result = await handleBotpressCloudHandoff({
      conversationId: 33,
      summary: "customer needs operations support",
      department: "operations"
    }, botpressHandoffOptions(port, {
      now: () => new Date("2026-06-14T12:00:00Z")
    }));

    assert.equal(result.action, "botpress_cloud_handoff");
    assert.equal(result.routing.action, "department_assigned");
    assert.equal(result.routing.toAgentId, 21);
    assert.equal(result.queueMessageId, null);
    assert.equal(result.removedBotLabel, true);
    assert.deepEqual(mock.assignments, [{ team_id: 3 }, { assignee_id: 21 }]);
    assert.deepEqual(mock.labelsBody, { labels: ["vip"] });
    assert.equal(mock.messages.length, 1);
    assert.equal(mock.statusCalled, true);
  } finally {
    await new Promise(resolve => mock.server.close(resolve));
  }
});

test("handleBotpressCloudHandoff queues resolved reentry during hours when no operations agent is online", async () => {
  const mock = createBotpressHandoffMock({
    teamAgents: [{ id: 21, name: "Abdelrahman Adel", availability_status: "offline" }],
    inboxAgents: [{ id: 21, name: "Abdelrahman Adel", availability_status: "offline" }]
  });

  await new Promise(resolve => mock.server.listen(0, "127.0.0.1", resolve));
  try {
    const { port } = mock.server.address();
    const result = await handleBotpressCloudHandoff({
      conversationId: 33,
      summary: "customer needs operations support",
      department: "operations"
    }, botpressHandoffOptions(port, {
      inHoursQueueMessage: "please wait",
      outsideHoursMessage: "outside hours",
      now: () => new Date("2026-06-14T12:00:00Z")
    }));

    assert.equal(result.action, "botpress_cloud_handoff");
    assert.equal(result.routing.action, "department_team_queue");
    assert.equal(result.routing.toAgentId, null);
    assert.equal(result.queueMessageId, 702);
    assert.equal(result.removedBotLabel, true);
    assert.deepEqual(mock.assignments, [{ team_id: 3 }, { assignee_id: null }]);
    assert.deepEqual(mock.labelsBody, { labels: ["vip"] });
    assert.deepEqual(mock.messages.map(item => item.content), [
      "\u{1F4DD} **\u0645\u0644\u062E\u0635 \u0641\u0647\u062F:**\ncustomer needs operations support",
      "please wait"
    ]);
    assert.equal(mock.statusCalled, true);
  } finally {
    await new Promise(resolve => mock.server.close(resolve));
  }
});

test("handleBotpressCloudHandoff queues complaints unassigned and notifies on a non-working day", async () => {
  // Friday (2026-06-26) is excluded from the business days, so the complaint is
  // queued to the team Unassigned instead of being pinned to the owner, and the
  // outside-hours message tells the customer no one is available.
  const mock = createBotpressHandoffMock({
    agents: [{ id: 19, name: "Abdelrahman Tarek", availability_status: "online" }]
  });

  await new Promise(resolve => mock.server.listen(0, "127.0.0.1", resolve));
  try {
    const { port } = mock.server.address();
    const result = await handleBotpressCloudHandoff({
      conversationId: 33,
      summary: "customer submitted a formal complaint",
      department: "complaints"
    }, {
      ...botpressHandoffOptions(port, {
        outsideHoursMessage: "no one available now",
        now: () => new Date("2026-06-26T12:00:00Z")
      }),
      complaintAgentName: "Abdelrahman Tarek"
    });

    assert.equal(result.routing.action, "complaint_team_queue");
    assert.equal(result.routing.toAgentId, null);
    assert.deepEqual(mock.assignments, [{ team_id: 3 }, { assignee_id: null }]);
    assert.deepEqual(mock.messages.map(item => item.content), [
      "\u{1F4DD} **ملخص فهد:**\ncustomer submitted a formal complaint",
      "no one available now"
    ]);
  } finally {
    await new Promise(resolve => mock.server.close(resolve));
  }
});

test("handleBotpressCloudHandoff stays silent after hours when outsideHoursMode is return_only", async () => {
  const mock = createBotpressHandoffMock({
    teamAgents: [{ id: 21, name: "Abdelrahman Adel", availability_status: "offline" }],
    inboxAgents: [{ id: 21, name: "Abdelrahman Adel", availability_status: "offline" }]
  });

  await new Promise(resolve => mock.server.listen(0, "127.0.0.1", resolve));
  try {
    const { port } = mock.server.address();
    const result = await handleBotpressCloudHandoff({
      conversationId: 33,
      summary: "customer asked after hours",
      department: "operations"
    }, botpressHandoffOptions(port, {
      inHoursQueueMessage: "please wait",
      outsideHoursMessage: "outside hours",
      outsideHoursMode: "return_only",
      now: () => new Date("2026-06-14T19:30:00Z")
    }));

    assert.equal(result.routing.action, "department_team_unassigned");
    assert.equal(result.queueMessageId, null);
    // Only the internal private note is posted; no customer-facing message.
    assert.deepEqual(mock.messages.map(item => item.content), [
      "\u{1F4DD} **ملخص فهد:**\ncustomer asked after hours"
    ]);
    assert.equal(mock.statusCalled, true);
  } finally {
    await new Promise(resolve => mock.server.close(resolve));
  }
});

test("handleBotpressCloudHandoff assigns complaints to the configured owner even when offline", async () => {
  const mock = createBotpressHandoffMock({
    agents: [{ id: 19, name: "Abdelrahman Tarek", availability_status: "offline" }]
  });

  await new Promise(resolve => mock.server.listen(0, "127.0.0.1", resolve));
  try {
    const { port } = mock.server.address();
    const result = await handleBotpressCloudHandoff({
      conversationId: 33,
      summary: "customer submitted a formal complaint",
      department: "complaints"
    }, {
      ...botpressHandoffOptions(port, {
        now: () => new Date("2026-06-14T12:00:00Z")
      }),
      complaintAgentName: "Abdelrahman Tarek"
    });

    assert.equal(result.action, "botpress_cloud_handoff");
    assert.equal(result.routing.action, "complaint_assigned");
    assert.equal(result.routing.toAgentId, 19);
    assert.equal(result.queueMessageId, null);
    assert.equal(result.removedBotLabel, true);
    assert.deepEqual(mock.assignments, [{ team_id: 3 }, { assignee_id: 19 }]);
    assert.deepEqual(mock.labelsBody, { labels: ["vip"] });
    assert.equal(mock.statusCalled, true);
  } finally {
    await new Promise(resolve => mock.server.close(resolve));
  }
});

test("handleBotpressCloudHandoff keeps needs-bot when a concurrent resolve marks the next reentry", async () => {
  let detailsCount = 0;
  const messages = [];
  const assignments = [];
  let labelsBody = null;
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    res.setHeader("content-type", "application/json; charset=utf-8");

    if (url.pathname === "/api/v1/accounts/1/conversations/33" && req.method === "GET") {
      detailsCount += 1;
      res.end(JSON.stringify({
        id: 33,
        status: detailsCount === 1 ? "open" : "resolved",
        inbox_id: 2,
        labels: ["needs-bot", "vip"],
        custom_attributes: {
          engosoft_department_route_state: "resolved",
          engosoft_department_prompt_next: true
        },
        meta: {
          assignee: { id: 4, name: "Old Agent" },
          inbox: { id: 2, name: "WhatsApp" }
        }
      }));
      return;
    }

    if (url.pathname === "/api/v1/accounts/1/conversations/33/labels" && req.method === "GET") {
      res.end(JSON.stringify({ payload: ["needs-bot", "vip"] }));
      return;
    }

    if (url.pathname === "/api/v1/accounts/1/conversations/33/labels" && req.method === "POST") {
      labelsBody = await readRequestJson(req);
      res.end(JSON.stringify({ payload: labelsBody.labels }));
      return;
    }

    if (url.pathname === "/api/v1/accounts/1/conversations/33/messages" && req.method === "POST") {
      messages.push(await readRequestJson(req));
      res.end(JSON.stringify({ id: 700 + messages.length }));
      return;
    }

    if (url.pathname === "/api/v1/accounts/1/conversations/33/toggle_status" && req.method === "POST") {
      res.end(JSON.stringify({ status: "open" }));
      return;
    }

    if (url.pathname === "/api/v1/accounts/1/teams/3/team_members" && req.method === "GET") {
      res.end(JSON.stringify([{ id: 21, name: "Abdelrahman Adel", availability_status: "offline" }]));
      return;
    }

    if (url.pathname === "/api/v1/accounts/1/inbox_members/2" && req.method === "GET") {
      res.end(JSON.stringify([{ id: 21, name: "Abdelrahman Adel", availability_status: "offline" }]));
      return;
    }

    if (url.pathname === "/api/v1/accounts/1/conversations/33/assignments" && req.method === "POST") {
      assignments.push(await readRequestJson(req));
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (url.pathname === "/api/v1/accounts/1/conversations/33/custom_attributes" && req.method === "POST") {
      res.end(JSON.stringify({ custom_attributes: (await readRequestJson(req)).custom_attributes }));
      return;
    }

    res.statusCode = 404;
    res.end(JSON.stringify({ error: "not found" }));
  });

  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const { port } = server.address();
    const result = await handleBotpressCloudHandoff({
      conversationId: 33,
      summary: "late handoff",
      department: "operations"
    }, botpressHandoffOptions(port, {
      inHoursQueueMessage: "please wait",
      now: () => new Date("2026-06-14T12:00:00Z")
    }));

    assert.equal(result.action, "botpress_cloud_handoff");
    assert.equal(result.removedBotLabel, false);
    assert.equal(labelsBody, null);
    assert.deepEqual(assignments, [{ team_id: 3 }, { assignee_id: null }]);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test("handleBotpressCloudHandoff skips broadcast handoffs before touching Chatwoot", async () => {
  const result = await handleBotpressCloudHandoff({
    conversationId: 33,
    isBroadcastReply: true,
    source: "broadcast"
  }, {
    botpress: {
      enabled: true,
      skipBroadcasts: true
    },
    audit: false
  });

  assert.equal(result.skipped, true);
  assert.equal(result.reason, "botpress_broadcast_skipped");
});

test("handleBotpressCloudHandoff skips conversations that are not resolved re-entry", async () => {
  let messagesCalled = false;
  let assignmentCalled = false;
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    res.setHeader("content-type", "application/json; charset=utf-8");

    if (url.pathname === "/api/v1/accounts/1/conversations/33" && req.method === "GET") {
      res.end(JSON.stringify({
        id: 33,
        status: "open",
        inbox_id: 2,
        custom_attributes: {},
        meta: { inbox: { id: 2, name: "WhatsApp" } }
      }));
      return;
    }

    if (url.pathname === "/api/v1/accounts/1/conversations/33/messages") messagesCalled = true;
    if (url.pathname === "/api/v1/accounts/1/conversations/33/assignments") assignmentCalled = true;

    res.statusCode = 404;
    res.end(JSON.stringify({ error: "not found" }));
  });

  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const { port } = server.address();
    const result = await handleBotpressCloudHandoff({
      conversationId: 33,
      summary: "active conversation",
      department: "operations"
    }, {
      connection: { baseUrl: `http://127.0.0.1:${port}`, accountId: "1", apiToken: "test-token" },
      enabled: true,
      operationsTeamId: "3",
      botpress: {
        enabled: true,
        requireResolvedReentry: true
      },
      audit: false
    });

    assert.equal(result.skipped, true);
    assert.equal(result.reason, "botpress_not_resolved_reentry");
    assert.equal(messagesCalled, false);
    assert.equal(assignmentCalled, false);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
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

test("handleDepartmentRouterWebhook routes choice 1 to an online resale team inbox member", async () => {
  const assignmentBodies = [];
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
        { id: 20, name: "Asmaa Fathy", availability_status: "online" },
        { id: 74, name: "Nader Aziz", availability_status: "online" }
      ]));
      return;
    }

    if (url.pathname === "/api/v1/accounts/1/inbox_members/2") {
      res.end(JSON.stringify({
        payload: [
          { id: 20, name: "Asmaa Fathy", availability_status: "online" }
        ]
      }));
      return;
    }

    if (url.pathname === "/api/v1/accounts/1/conversations/33/assignments" && req.method === "POST") {
      assignmentBodies.push(await readRequestJson(req));
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
    assert.equal(result.toAgentId, 20);
    assert.deepEqual(assignmentBodies, [{ team_id: 4 }, { assignee_id: 20 }]);
    assert.equal(customAttributesBody.custom_attributes.engosoft_department, "sales");
    assert.equal(customAttributesBody.custom_attributes.engosoft_department_route_state, "routed");
    assert.equal(customAttributesBody.custom_attributes.engosoft_department_auto_assigned_agent_id, "20");
    assert.equal(customAttributesBody.custom_attributes.engosoft_department_manual_assignment, false);
    assert.equal(outgoingMessages.length, 1);
    assert.match(outgoingMessages[0].content, /صبرك/);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test("handleDepartmentRouterWebhook routes to the team unassigned outside business hours", async () => {
  const assignmentBodies = [];
  let teamAgentsCalled = false;
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    res.setHeader("content-type", "application/json; charset=utf-8");

    if (url.pathname === "/api/v1/accounts/1/conversations/33" && req.method === "GET") {
      res.end(JSON.stringify({
        id: 33,
        status: "open",
        inbox_id: 2,
        custom_attributes: { engosoft_department_route_state: "pending" },
        meta: { sender: { id: 10, name: "Ahmed" }, assignee: null, inbox: { id: 2, name: "WhatsApp" } }
      }));
      return;
    }

    if (url.pathname === "/api/v1/accounts/1/teams/3/team_members") {
      teamAgentsCalled = true;
      res.end(JSON.stringify([{ id: 7, name: "Operations", availability_status: "online" }]));
      return;
    }

    if (url.pathname === "/api/v1/accounts/1/conversations/33/assignments" && req.method === "POST") {
      assignmentBodies.push(await readRequestJson(req));
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (url.pathname === "/api/v1/accounts/1/conversations/33/custom_attributes" && req.method === "POST") {
      const body = await readRequestJson(req);
      res.end(JSON.stringify({ custom_attributes: body.custom_attributes }));
      return;
    }

    if (url.pathname === "/api/v1/accounts/1/conversations/33/messages" && req.method === "POST") {
      res.end(JSON.stringify({ id: 503 }));
      return;
    }

    res.statusCode = 404;
    res.end(JSON.stringify({ error: "not found" }));
  });

  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const { port } = server.address();
    const stateStore = createMemoryDepartmentStateStore({ 33: { conversationId: 33, state: "pending" } });
    const payload = reopenPayload();
    payload.message.content = "2";
    const result = await handleDepartmentRouterWebhook(payload, {
      connection: { baseUrl: `http://127.0.0.1:${port}`, accountId: "1", apiToken: "test-token" },
      enabled: true,
      inboxIds: ["2"],
      salesTeamId: "4",
      operationsTeamId: "3",
      // assignAgent default true, but business hours override forces team-only outside hours.
      businessHours: {
        enabled: true,
        timezone: "Asia/Riyadh",
        startMinutes: 9 * 60,
        endMinutes: 22 * 60,
        days: new Set([0, 1, 2, 3, 4, 5, 6]),
        now: () => new Date("2026-06-14T20:00:00Z") // 23:00 Riyadh -> outside
      },
      stateStore,
      audit: false
    });

    assert.equal(result.action, "department_team_unassigned");
    assert.equal(result.department, "operations");
    assert.deepEqual(assignmentBodies, [{ team_id: 3 }, { assignee_id: null }]);
    assert.equal(teamAgentsCalled, false);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test("handleDepartmentRouterWebhook can route a choice to the team and leave it unassigned", async () => {
  const assignmentBodies = [];
  let teamAgentsCalled = false;
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
        custom_attributes: { engosoft_department_route_state: "pending" },
        meta: { sender: { id: 10, name: "Ahmed" }, assignee: null, inbox: { id: 2, name: "WhatsApp" } }
      }));
      return;
    }

    if (url.pathname === "/api/v1/accounts/1/teams/3/team_members") {
      teamAgentsCalled = true;
      res.end(JSON.stringify([{ id: 7, name: "Operations", availability_status: "online" }]));
      return;
    }

    if (url.pathname === "/api/v1/accounts/1/conversations/33/assignments" && req.method === "POST") {
      assignmentBodies.push(await readRequestJson(req));
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
      res.end(JSON.stringify({ id: 502 }));
      return;
    }

    res.statusCode = 404;
    res.end(JSON.stringify({ error: "not found" }));
  });

  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const { port } = server.address();
    const stateStore = createMemoryDepartmentStateStore({ 33: { conversationId: 33, state: "pending" } });
    const payload = reopenPayload();
    payload.message.content = "2";
    const result = await handleDepartmentRouterWebhook(payload, {
      connection: { baseUrl: `http://127.0.0.1:${port}`, accountId: "1", apiToken: "test-token" },
      enabled: true,
      inboxIds: ["2"],
      salesTeamId: "4",
      operationsTeamId: "3",
      assignAgent: false,
      stateStore,
      audit: false
    });

    assert.equal(result.action, "department_team_unassigned");
    assert.equal(result.department, "operations");
    assert.equal(result.toAgentId, null);
    assert.deepEqual(assignmentBodies, [{ team_id: 3 }, { assignee_id: null }]);
    assert.equal(teamAgentsCalled, false);
    assert.equal(customAttributesBody.custom_attributes.engosoft_department_route_state, "routed");
    assert.match(outgoingMessages[0].content, /الاسم الثلاثي/);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test("handleDepartmentRouterWebhook routes trainee support to an online operations team inbox member", async () => {
  const assignmentBodies = [];
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
        custom_attributes: { engosoft_department_route_state: "pending" },
        meta: { sender: { id: 10, name: "Ahmed" }, assignee: null, inbox: { id: 2, name: "WhatsApp" } }
      }));
      return;
    }

    if (url.pathname === "/api/v1/accounts/1/teams/3/team_members") {
      res.end(JSON.stringify([
        { id: 74, name: "Nader Aziz", availability_status: "online" },
        { id: 12, name: "Abdelrahman Tarek", availability_status: "online" },
        { id: 21, name: "Abdelrman Adel", availability_status: "online" }
      ]));
      return;
    }

    if (url.pathname === "/api/v1/accounts/1/inbox_members/2") {
      res.end(JSON.stringify({
        payload: [
          { id: 21, name: "Abdelrman Adel", availability_status: "online" }
        ]
      }));
      return;
    }

    if (url.pathname === "/api/v1/accounts/1/conversations/33/assignments" && req.method === "POST") {
      assignmentBodies.push(await readRequestJson(req));
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
      res.end(JSON.stringify({ id: 504 }));
      return;
    }

    res.statusCode = 404;
    res.end(JSON.stringify({ error: "not found" }));
  });

  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const { port } = server.address();
    const stateStore = createMemoryDepartmentStateStore({ 33: { conversationId: 33, state: "pending" } });
    const payload = reopenPayload();
    payload.message.content = "2";
    const result = await handleDepartmentRouterWebhook(payload, {
      connection: { baseUrl: `http://127.0.0.1:${port}`, accountId: "1", apiToken: "test-token" },
      enabled: true,
      inboxIds: ["2"],
      salesTeamId: "4",
      operationsTeamId: "3",
      stateStore,
      audit: false
    });

    assert.equal(result.action, "department_assigned");
    assert.equal(result.department, "operations");
    assert.equal(result.toAgentId, 21);
    assert.deepEqual(assignmentBodies, [{ team_id: 3 }, { assignee_id: 21 }]);
    assert.equal(customAttributesBody.custom_attributes.engosoft_department, "operations");
    assert.equal(customAttributesBody.custom_attributes.engosoft_department_auto_assigned_agent_id, "21");
    assert.equal(outgoingMessages.length, 1);
    assert.match(outgoingMessages[0].content, /الاسم الثلاثي/);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test("handleDepartmentRouterWebhook queues trainee support when no online operations agent exists", async () => {
  const assignmentBodies = [];
  const outgoingMessages = [];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    res.setHeader("content-type", "application/json; charset=utf-8");

    if (url.pathname === "/api/v1/accounts/1/conversations/33" && req.method === "GET") {
      res.end(JSON.stringify({
        id: 33,
        status: "open",
        inbox_id: 2,
        custom_attributes: { engosoft_department_route_state: "pending" },
        meta: { sender: { id: 10, name: "Ahmed" }, assignee: null, inbox: { id: 2, name: "WhatsApp" } }
      }));
      return;
    }

    if (url.pathname === "/api/v1/accounts/1/teams/3/team_members") {
      res.end(JSON.stringify([
        { id: 21, name: "Abdelrman Adel", availability_status: "offline" }
      ]));
      return;
    }

    if (url.pathname === "/api/v1/accounts/1/inbox_members/2") {
      res.end(JSON.stringify({
        payload: [
          { id: 21, name: "Abdelrman Adel", availability_status: "offline" }
        ]
      }));
      return;
    }

    if (url.pathname === "/api/v1/accounts/1/conversations/33/assignments" && req.method === "POST") {
      assignmentBodies.push(await readRequestJson(req));
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (url.pathname === "/api/v1/accounts/1/conversations/33/custom_attributes" && req.method === "POST") {
      const body = await readRequestJson(req);
      res.end(JSON.stringify({ custom_attributes: body.custom_attributes }));
      return;
    }

    if (url.pathname === "/api/v1/accounts/1/conversations/33/messages" && req.method === "POST") {
      outgoingMessages.push(await readRequestJson(req));
      res.end(JSON.stringify({ id: 505 }));
      return;
    }

    res.statusCode = 404;
    res.end(JSON.stringify({ error: "not found" }));
  });

  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const { port } = server.address();
    const stateStore = createMemoryDepartmentStateStore({ 33: { conversationId: 33, state: "pending" } });
    const payload = reopenPayload();
    payload.message.content = "دعم المتدربين";
    const result = await handleDepartmentRouterWebhook(payload, {
      connection: { baseUrl: `http://127.0.0.1:${port}`, accountId: "1", apiToken: "test-token" },
      enabled: true,
      inboxIds: ["2"],
      salesTeamId: "4",
      operationsTeamId: "3",
      stateStore,
      audit: false
    });

    assert.equal(result.action, "department_team_queue");
    assert.equal(result.department, "operations");
    assert.equal(result.toAgentId, null);
    assert.deepEqual(assignmentBodies, [{ team_id: 3 }, { assignee_id: null }]);
    assert.equal(outgoingMessages.length, 1);
    assert.match(outgoingMessages[0].content, /الاسم الثلاثي/);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test("handleDepartmentRouterWebhook sends the complaint confirmation menu before assigning complaints", async () => {
  const outgoingMessages = [];
  let assignmentCalled = false;
  let customAttributesBody = null;
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    res.setHeader("content-type", "application/json; charset=utf-8");

    if (url.pathname === "/api/v1/accounts/1/conversations/33" && req.method === "GET") {
      res.end(JSON.stringify({
        id: 33,
        status: "open",
        inbox_id: 2,
        custom_attributes: { engosoft_department_route_state: "pending" },
        meta: { sender: { id: 10, name: "Ahmed" }, assignee: null, inbox: { id: 2, name: "WhatsApp" } }
      }));
      return;
    }

    if (url.pathname === "/api/v1/accounts/1/conversations/33/messages" && req.method === "POST") {
      outgoingMessages.push(await readRequestJson(req));
      res.end(JSON.stringify({ id: 506 }));
      return;
    }

    if (url.pathname === "/api/v1/accounts/1/conversations/33/custom_attributes" && req.method === "POST") {
      customAttributesBody = await readRequestJson(req);
      res.end(JSON.stringify({ custom_attributes: customAttributesBody.custom_attributes }));
      return;
    }

    if (url.pathname === "/api/v1/accounts/1/conversations/33/assignments" && req.method === "POST") {
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
    const stateStore = createMemoryDepartmentStateStore({ 33: { conversationId: 33, state: "pending" } });
    const payload = reopenPayload();
    payload.message.content = "3";
    const result = await handleDepartmentRouterWebhook(payload, {
      connection: { baseUrl: `http://127.0.0.1:${port}`, accountId: "1", apiToken: "test-token" },
      enabled: true,
      inboxIds: ["2"],
      salesTeamId: "4",
      operationsTeamId: "3",
      stateStore,
      audit: false
    });

    assert.equal(result.action, "complaint_intro_sent");
    assert.equal(assignmentCalled, false);
    assert.equal(outgoingMessages.length, 1);
    assert.match(outgoingMessages[0].content, /48/);
    assert.match(outgoingMessages[0].content, /اضغط 2/);
    assert.equal(customAttributesBody.custom_attributes.engosoft_department, "complaints");
    assert.equal(customAttributesBody.custom_attributes.engosoft_department_route_state, "complaint_pending");
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test("handleDepartmentRouterWebhook assigns confirmed complaints to the configured owner even when offline", async () => {
  const assignmentBodies = [];
  const outgoingMessages = [];
  let customAttributesBody = null;
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    res.setHeader("content-type", "application/json; charset=utf-8");

    if (url.pathname === "/api/v1/accounts/1/conversations/33" && req.method === "GET") {
      res.end(JSON.stringify({
        id: 33,
        status: "open",
        inbox_id: 2,
        custom_attributes: {
          engosoft_department: "complaints",
          engosoft_department_route_state: "complaint_pending"
        },
        meta: { sender: { id: 10, name: "Ahmed" }, assignee: null, inbox: { id: 2, name: "WhatsApp" } }
      }));
      return;
    }

    if (url.pathname === "/api/v1/accounts/1/agents") {
      res.end(JSON.stringify([
        { id: 12, name: "Abdelrahman Tarek", email: "abdelrahman@example.com", availability_status: "offline" }
      ]));
      return;
    }

    if (url.pathname === "/api/v1/accounts/1/conversations/33/messages" && req.method === "POST") {
      outgoingMessages.push(await readRequestJson(req));
      res.end(JSON.stringify({ id: 507 }));
      return;
    }

    if (url.pathname === "/api/v1/accounts/1/conversations/33/assignments" && req.method === "POST") {
      assignmentBodies.push(await readRequestJson(req));
      res.end(JSON.stringify({ ok: true }));
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
    const stateStore = createMemoryDepartmentStateStore({ 33: { conversationId: 33, state: "complaint_pending" } });
    const payload = reopenPayload();
    payload.message.content = "2";
    const result = await handleDepartmentRouterWebhook(payload, {
      connection: { baseUrl: `http://127.0.0.1:${port}`, accountId: "1", apiToken: "test-token" },
      enabled: true,
      inboxIds: ["2"],
      salesTeamId: "4",
      operationsTeamId: "3",
      complaintAgentName: "Abdelrahman Tarek",
      stateStore,
      audit: false
    });

    assert.equal(result.action, "complaint_assigned");
    assert.equal(result.toAgentId, 12);
    assert.deepEqual(assignmentBodies, [{ team_id: 3 }, { assignee_id: 12 }]);
    assert.equal(outgoingMessages.length, 2);
    assert.match(outgoingMessages[0].content, /ملخص الشكوى/);
    assert.match(outgoingMessages[1].content, /تم إستلام الشكوى/);
    assert.equal(customAttributesBody.custom_attributes.engosoft_department, "complaints");
    assert.equal(customAttributesBody.custom_attributes.engosoft_department_auto_assigned_agent_id, "12");
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test("handleDepartmentRouterWebhook does not touch a conversation a human agent is handling", async () => {
  let assignmentCalled = false;
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
          sender: { id: 10, name: "Ahmed" },
          // A human self-assigned this conversation (e.g. a campaign reply).
          assignee: { id: 9, name: "Asmaa", availability_status: "offline" },
          inbox: { id: 2, name: "WhatsApp" }
        }
      }));
      return;
    }

    if (url.pathname === "/api/v1/accounts/1/conversations/33/assignments" && req.method === "POST") {
      assignmentCalled = true;
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (url.pathname === "/api/v1/accounts/1/conversations/33/messages" && req.method === "POST") {
      outgoingMessages.push(await readRequestJson(req));
      res.end(JSON.stringify({ id: 600 }));
      return;
    }

    res.statusCode = 404;
    res.end(JSON.stringify({ error: "not found" }));
  });

  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const { port } = server.address();
    const stateStore = createMemoryDepartmentStateStore();
    const payload = reopenPayload();
    payload.message.content = "نعم";
    const result = await handleDepartmentRouterWebhook(payload, {
      connection: { baseUrl: `http://127.0.0.1:${port}`, accountId: "1", apiToken: "test-token" },
      enabled: true,
      inboxIds: ["2"],
      salesTeamId: "4",
      operationsTeamId: "3",
      stateStore,
      audit: false
    });

    assert.equal(result.skipped, true);
    assert.equal(result.reason, "manual_assignment_active");
    assert.equal(assignmentCalled, false);
    assert.equal(outgoingMessages.length, 0);
    assert.equal((await stateStore.get(33)).manualAssignment, true);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test("handleDepartmentRouterWebhook keeps a manual assignment even when that agent is offline", async () => {
  let assignmentCalled = false;
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    res.setHeader("content-type", "application/json; charset=utf-8");

    if (url.pathname === "/api/v1/accounts/1/conversations/33" && req.method === "GET") {
      res.end(JSON.stringify({
        id: 33,
        status: "open",
        inbox_id: 2,
        team_id: 4,
        custom_attributes: {},
        meta: {
          sender: { id: 10, name: "Ahmed" },
          // An admin manually assigned this offline agent; the router never did.
          assignee: { id: 9, name: "Manually Picked Agent", availability_status: "offline" },
          inbox: { id: 2, name: "WhatsApp" }
        }
      }));
      return;
    }

    if (url.pathname === "/api/v1/accounts/1/conversations/33/assignments" && req.method === "POST") {
      assignmentCalled = true;
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (url.pathname === "/api/v1/accounts/1/conversations/33/custom_attributes" && req.method === "POST") {
      const body = await readRequestJson(req);
      res.end(JSON.stringify({ custom_attributes: body.custom_attributes }));
      return;
    }

    res.statusCode = 404;
    res.end(JSON.stringify({ error: "not found" }));
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
    assert.equal(result.reason, "manual_assignment_active");
    assert.equal(result.assigneeId, 9);
    assert.equal(assignmentCalled, false);
    assert.equal((await stateStore.get(33)).manualAssignment, true);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test("handleDepartmentRouterWebhook reroutes unavailable manual assignees when enabled", async () => {
  const assignmentBodies = [];
  let customAttributesBody = null;
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    res.setHeader("content-type", "application/json; charset=utf-8");

    if (url.pathname === "/api/v1/accounts/1/conversations/33" && req.method === "GET") {
      res.end(JSON.stringify({
        id: 33,
        status: "open",
        inbox_id: 2,
        team_id: 3,
        custom_attributes: {},
        meta: {
          sender: { id: 10, name: "Ahmed" },
          assignee: { id: 71, name: "Omar Mohsen", availability_status: "offline" },
          team: { id: 3, name: "operations" },
          inbox: { id: 2, name: "WhatsApp" }
        }
      }));
      return;
    }

    if (url.pathname === "/api/v1/accounts/1/teams/3/team_members") {
      res.end(JSON.stringify([
        { id: 71, name: "Omar Mohsen", availability_status: "offline" },
        { id: 21, name: "Abdelrman Adel", availability_status: "online" }
      ]));
      return;
    }

    if (url.pathname === "/api/v1/accounts/1/inbox_members/2") {
      res.end(JSON.stringify({
        payload: [
          { id: 71, name: "Omar Mohsen", availability_status: "offline" },
          { id: 21, name: "Abdelrman Adel", availability_status: "online" }
        ]
      }));
      return;
    }

    if (url.pathname === "/api/v1/accounts/1/conversations/33/assignments" && req.method === "POST") {
      assignmentBodies.push(await readRequestJson(req));
      res.end(JSON.stringify({ ok: true }));
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
    const payload = reopenPayload();
    payload.message.content = "Ø§Ù„Ø³Ù„Ø§Ù… Ø¹Ù„ÙŠÙƒÙ…";
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
      operationsAgentIds: ["21", "71"],
      reassignUnavailableManualAssignments: true,
      stateStore,
      audit: false
    });

    assert.equal(result.action, "department_assigned");
    assert.equal(result.department, "operations");
    assert.equal(result.fromAgentId, 71);
    assert.equal(result.toAgentId, 21);
    assert.deepEqual(assignmentBodies, [{ team_id: 3 }, { assignee_id: 21 }]);
    assert.equal(customAttributesBody.custom_attributes.engosoft_department_auto_assigned_agent_id, "21");
    assert.equal(customAttributesBody.custom_attributes.engosoft_department_manual_assignment, false);
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
          assignee: null
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
    assert.match(outgoingMessages[0].content, /اضغط 1/);
    assert.match(outgoingMessages[0].content, /اضغط 2/);
    assert.match(outgoingMessages[0].content, /اضغط 3/);
    assert.equal(assignmentBody, null);
    assert.equal(customAttributesBody.custom_attributes.engosoft_department_route_state, "pending");
    assert.equal(customAttributesBody.custom_attributes.engosoft_department_prompt_next, false);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test("handleDepartmentRouterWebhook does not prompt a new waiting conversation already held by a human", async () => {
  let assignmentCalled = false;
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
          assignee: { id: 4, name: "Mahmoud Hassan" }
        }
      }));
      return;
    }

    if (url.pathname === "/api/v1/accounts/1/conversations/33/assignments" && req.method === "POST") {
      assignmentCalled = true;
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (url.pathname === "/api/v1/accounts/1/conversations/33/messages" && req.method === "POST") {
      outgoingMessages.push(await readRequestJson(req));
      res.end(JSON.stringify({ id: 509 }));
      return;
    }

    res.statusCode = 404;
    res.end(JSON.stringify({ error: "not found" }));
  });

  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const { port } = server.address();
    const stateStore = createMemoryDepartmentStateStore({
      33: { conversationId: 33, state: "new_waiting_incoming" }
    });
    const incoming = reopenPayload();
    incoming.message.content = "نعم";
    const result = await handleDepartmentRouterWebhook(incoming, {
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
    assert.equal(result.reason, "manual_assignment_active");
    assert.equal(result.assigneeId, 4);
    assert.equal(assignmentCalled, false);
    assert.equal(outgoingMessages.length, 0);
    assert.equal((await stateStore.get(33)).manualAssignment, true);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test("handleDepartmentRouterWebhook ignores agent-created messages even if the conversation is waiting", async () => {
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
        meta: {
          sender: { id: 10, name: "New Contact" },
          assignee: null
        }
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
      33: { conversationId: 33, state: "new_waiting_incoming" }
    });
    const payload = reopenPayload();
    payload.message.message_type = "outgoing";
    payload.message.sender_type = "User";
    payload.message.sender = { id: 4, type: "user", name: "Mahmoud Hassan" };
    payload.message.content = "هتابع معاك";

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
    assert.equal(result.reason, "department_event_ignored");
    assert.equal(writeCalls, 0);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test("handleDepartmentRouterWebhook never prompts a contact with previous active conversations", async () => {
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
          { id: 12, status: "open", inbox_id: 2 },
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

    assert.equal(created.reason, "existing_contact_has_active_history");
    assert.equal(replied.reason, "existing_department_unknown");
    assert.equal(writeCalls, 0);
    assert.equal((await stateStore.get(33)).state, "existing_contact");
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test("handleDepartmentRouterWebhook treats resolved-only contact history as a fresh entry", async () => {
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
        meta: { sender: { id: 10, name: "Returning Resolved Contact" }, assignee: null }
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

    if (url.pathname === "/api/v1/accounts/1/conversations/33/assignments" && req.method === "POST") {
      assignmentBody = await readRequestJson(req);
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (url.pathname === "/api/v1/accounts/1/conversations/33/messages" && req.method === "POST") {
      outgoingMessages.push(await readRequestJson(req));
      res.end(JSON.stringify({ id: 508 }));
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
      connection: { baseUrl: `http://127.0.0.1:${port}`, accountId: "1", apiToken: "test-token" },
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

    assert.equal(created.action, "new_conversation_registered");
    assert.equal(created.previousConversationCount, 1);
    assert.equal(outgoingMessages.length, 0);

    const incoming = reopenPayload();
    incoming.message.content = "السلام عليكم";
    const prompted = await handleDepartmentRouterWebhook(incoming, options);

    assert.equal(prompted.action, "department_prompt_sent");
    assert.equal(outgoingMessages.length, 1);
    assert.match(outgoingMessages[0].content, /اضغط 1/);
    assert.equal(assignmentBody, null);
    assert.equal(customAttributesBody.custom_attributes.engosoft_department_route_state, "pending");
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test("handleDepartmentRouterWebhook marks resolved conversations to prompt on the next reply", async () => {
  let customAttributesBody = null;
  const assignments = [];
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
        },
        meta: { assignee: { id: 9, name: "Old Sales Agent" } }
      }));
      return;
    }

    if (url.pathname === "/api/v1/accounts/1/conversations/33/custom_attributes" && req.method === "POST") {
      customAttributesBody = await readRequestJson(req);
      res.end(JSON.stringify({ custom_attributes: customAttributesBody.custom_attributes }));
      return;
    }

    if (url.pathname === "/api/v1/accounts/1/conversations/33/assignments" && req.method === "POST") {
      assignments.push(await readRequestJson(req));
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    res.statusCode = 404;
    res.end(JSON.stringify({ error: "not found" }));
  });

  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const { port } = server.address();
    const stateStore = createMemoryDepartmentStateStore({
      33: { conversationId: 33, manualAssignment: true, autoAssignedAgentId: 9 }
    });
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
    assert.equal(result.unassignedOnResolve, true);
    assert.equal(result.teamClearedOnResolve, true);
    assert.deepEqual(assignments, [{ assignee_id: null }, { team_id: null }]);
    assert.equal(customAttributesBody.custom_attributes.engosoft_department_prompt_next, true);
    assert.equal(customAttributesBody.custom_attributes.engosoft_department_route_state, "resolved");
    // Resolving releases the manual-assignment lock so the reopen reroutes.
    const saved = await stateStore.get(33);
    assert.equal(saved.manualAssignment, false);
    assert.equal(saved.autoAssignedAgentId, null);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test("handleDepartmentRouterWebhook prompts a resolved conversation again on the next reply", async () => {
  let phase = "resolved";
  let customAttributes = {
    engosoft_department: "sales",
    engosoft_department_route_state: "routed",
    engosoft_department_team_id: 4,
    engosoft_department_auto_assigned_agent_id: "9",
    engosoft_department_manual_assignment: false
  };
  let assignee = { id: 9, name: "Old Sales Agent", availability_status: "offline" };
  const assignments = [];
  const outgoingMessages = [];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    res.setHeader("content-type", "application/json; charset=utf-8");

    if (url.pathname === "/api/v1/accounts/1/conversations/33" && req.method === "GET") {
      res.end(JSON.stringify({
        id: 33,
        status: phase === "resolved" ? "resolved" : "open",
        inbox_id: 2,
        team_id: 4,
        custom_attributes: customAttributes,
        meta: {
          sender: { id: 10, name: "Ahmed" },
          assignee,
          inbox: { id: 2, name: "WhatsApp" }
        }
      }));
      return;
    }

    if (url.pathname === "/api/v1/accounts/1/conversations/33/custom_attributes" && req.method === "POST") {
      const body = await readRequestJson(req);
      customAttributes = body.custom_attributes;
      res.end(JSON.stringify({ custom_attributes: customAttributes }));
      return;
    }

    if (url.pathname === "/api/v1/accounts/1/conversations/33/assignments" && req.method === "POST") {
      const body = await readRequestJson(req);
      assignments.push(body);
      if (body.assignee_id === null) assignee = null;
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (url.pathname === "/api/v1/accounts/1/conversations/33/messages" && req.method === "POST") {
      outgoingMessages.push(await readRequestJson(req));
      res.end(JSON.stringify({ id: 700 }));
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
      promptOnResolved: true,
      stateStore,
      audit: false
    };

    const resolved = await handleDepartmentRouterWebhook({
      event: "conversation_status_changed",
      id: 33,
      status: "resolved",
      inbox_id: 2
    }, options);

    assert.equal(resolved.action, "marked_for_reentry");
    assert.equal(resolved.teamClearedOnResolve, true);
    assert.equal(customAttributes.engosoft_department_prompt_next, true);
    assert.equal(customAttributes.engosoft_department_auto_assigned_agent_id, null);
    assert.equal(customAttributes.engosoft_department_manual_assignment, false);

    phase = "reopened";
    const incoming = reopenPayload();
    incoming.message.content = "question";
    const prompted = await handleDepartmentRouterWebhook(incoming, options);

    assert.equal(prompted.action, "department_prompt_sent");
    assert.equal(prompted.reason, "resolved_conversation_reopened");
    assert.deepEqual(assignments, [{ assignee_id: null }, { team_id: null }]);
    assert.equal(outgoingMessages.length, 1);
    assert.match(outgoingMessages[0].content, /اضغط 1/);
    assert.equal(customAttributes.engosoft_department_route_state, "pending");
    assert.equal(customAttributes.engosoft_department_prompt_next, false);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test("handleDepartmentRouterWebhook detects a legacy resolved reopen from conversation activities", async () => {
  const assignments = [];
  const outgoingMessages = [];
  let customAttributesBody = null;
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    res.setHeader("content-type", "application/json; charset=utf-8");

    if (url.pathname === "/api/v1/accounts/1/conversations/33" && req.method === "GET") {
      res.end(JSON.stringify({
        id: 33,
        status: "open",
        inbox_id: 2,
        custom_attributes: {},
        messages: [
          { id: 1, message_type: 1, sender_type: "User", content: "Old reply", created_at: 100 },
          {
            id: 2,
            message_type: 2,
            content_type: "activity",
            content: "Conversation was marked resolved by Abdelrman Adel",
            created_at: 200
          },
          { id: 99, message_type: 0, sender_type: "Contact", content: "New question", created_at: 300 }
        ],
        meta: {
          sender: { id: 10, name: "Returning Customer" },
          assignee: { id: 21, name: "Abdelrman Adel", availability_status: "offline" },
          inbox: { id: 2, name: "WhatsApp" }
        }
      }));
      return;
    }

    if (url.pathname === "/api/v1/accounts/1/conversations/33/assignments" && req.method === "POST") {
      assignments.push(await readRequestJson(req));
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (url.pathname === "/api/v1/accounts/1/conversations/33/messages" && req.method === "POST") {
      outgoingMessages.push(await readRequestJson(req));
      res.end(JSON.stringify({ id: 701 }));
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
    const incoming = reopenPayload();
    incoming.message.content = "New question";
    incoming.message.created_at = 300;

    const result = await handleDepartmentRouterWebhook(incoming, {
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
      stateStore: createMemoryDepartmentStateStore(),
      audit: false
    });

    assert.equal(result.action, "department_prompt_sent");
    assert.equal(result.reason, "resolved_conversation_reopened");
    assert.deepEqual(assignments, [{ assignee_id: null }]);
    assert.equal(outgoingMessages.length, 1);
    assert.match(outgoingMessages[0].content, /اضغط 1/);
    assert.equal(customAttributesBody.custom_attributes.engosoft_department_route_state, "pending");
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test("handleDepartmentRouterWebhook still detects a resolved reopen after several customer follow-ups", async () => {
  const assignments = [];
  const outgoingMessages = [];
  let customAttributesBody = null;
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    res.setHeader("content-type", "application/json; charset=utf-8");

    if (url.pathname === "/api/v1/accounts/1/conversations/33" && req.method === "GET") {
      res.end(JSON.stringify({
        id: 33,
        status: "open",
        inbox_id: 2,
        custom_attributes: {},
        messages: [
          { id: 1, message_type: 1, sender_type: "User", content: "Old reply", created_at: 100 },
          {
            id: 2,
            message_type: 2,
            content_type: "activity",
            content: "Conversation was marked resolved by Abdelrman Adel",
            created_at: 200
          },
          { id: 97, message_type: 0, sender_type: "Contact", content: "السلام عليكم", created_at: 300 },
          { id: 98, message_type: 0, sender_type: "Contact", content: "اقعد احاول ادخل", created_at: 310 },
          { id: 99, message_type: 0, sender_type: "Contact", content: "يقول البيانات لا تتطابق", created_at: 320 }
        ],
        meta: {
          sender: { id: 10, name: "Returning Customer" },
          assignee: { id: 21, name: "Abdelrman Adel", availability_status: "offline" },
          inbox: { id: 2, name: "WhatsApp" }
        }
      }));
      return;
    }

    if (url.pathname === "/api/v1/accounts/1/conversations/33/assignments" && req.method === "POST") {
      assignments.push(await readRequestJson(req));
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (url.pathname === "/api/v1/accounts/1/conversations/33/messages" && req.method === "POST") {
      outgoingMessages.push(await readRequestJson(req));
      res.end(JSON.stringify({ id: 701 }));
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
    // The third customer follow-up after the resolve. The previous customer
    // messages must not cancel reopen detection, and the offline previous agent
    // must be released instead of keeping the conversation locked to them.
    const incoming = reopenPayload();
    incoming.message.content = "يقول البيانات لا تتطابق";
    incoming.message.created_at = 320;

    const result = await handleDepartmentRouterWebhook(incoming, {
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
      stateStore: createMemoryDepartmentStateStore(),
      audit: false
    });

    assert.equal(result.action, "department_prompt_sent");
    assert.equal(result.reason, "resolved_conversation_reopened");
    assert.deepEqual(assignments, [{ assignee_id: null }]);
    assert.equal(outgoingMessages.length, 1);
    assert.match(outgoingMessages[0].content, /اضغط 1/);
    assert.equal(customAttributesBody.custom_attributes.engosoft_department_route_state, "pending");
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test("handleDepartmentRouterWebhook leaves a reopen alone once the agent has replied after the resolve", async () => {
  const writes = [];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    res.setHeader("content-type", "application/json; charset=utf-8");

    if (url.pathname === "/api/v1/accounts/1/conversations/33" && req.method === "GET") {
      res.end(JSON.stringify({
        id: 33,
        status: "open",
        inbox_id: 2,
        custom_attributes: {},
        messages: [
          {
            id: 2,
            message_type: 2,
            content_type: "activity",
            content: "Conversation was marked resolved by Abdelrman Adel",
            created_at: 200
          },
          { id: 97, message_type: 0, sender_type: "Contact", content: "السلام عليكم", created_at: 300 },
          { id: 98, message_type: 1, sender_type: "User", content: "أهلا بك", created_at: 305 },
          { id: 99, message_type: 0, sender_type: "Contact", content: "عندي سؤال", created_at: 320 }
        ],
        meta: {
          sender: { id: 10, name: "Returning Customer" },
          assignee: { id: 21, name: "Abdelrman Adel", availability_status: "offline" },
          inbox: { id: 2, name: "WhatsApp" }
        }
      }));
      return;
    }

    writes.push(url.pathname);
    res.end(JSON.stringify({ ok: true }));
  });

  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const { port } = server.address();
    const incoming = reopenPayload();
    incoming.message.content = "عندي سؤال";
    incoming.message.created_at = 320;

    const result = await handleDepartmentRouterWebhook(incoming, {
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
      stateStore: createMemoryDepartmentStateStore(),
      audit: false
    });

    assert.equal(result.skipped, true);
    assert.equal(result.reason, "manual_assignment_active");
    assert.equal(writes.length, 0);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test("handleDepartmentRouterWebhook restores automated ownership from Chatwoot after local state is lost", async () => {
  const assignmentBodies = [];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    res.setHeader("content-type", "application/json; charset=utf-8");

    if (url.pathname === "/api/v1/accounts/1/conversations/33" && req.method === "GET") {
      res.end(JSON.stringify({
        id: 33,
        status: "open",
        inbox_id: 2,
        team_id: 4,
        custom_attributes: {
          engosoft_department: "sales",
          engosoft_department_route_state: "routed",
          engosoft_department_team_id: 4,
          engosoft_department_auto_assigned_agent_id: "9",
          engosoft_department_manual_assignment: false
        },
        meta: {
          assignee: { id: 9, name: "Old Automated Agent", availability_status: "offline" }
        }
      }));
      return;
    }

    if (url.pathname === "/api/v1/accounts/1/teams/4/team_members") {
      res.end(JSON.stringify([
        { id: 7, name: "Online Sales Agent", availability_status: "online" },
        { id: 9, name: "Old Automated Agent", availability_status: "offline" }
      ]));
      return;
    }

    if (url.pathname === "/api/v1/accounts/1/inbox_members/2") {
      res.end(JSON.stringify({
        payload: [
          { id: 7, name: "Online Sales Agent", availability_status: "online" },
          { id: 9, name: "Old Automated Agent", availability_status: "offline" }
        ]
      }));
      return;
    }

    if (url.pathname === "/api/v1/accounts/1/conversations/33/assignments" && req.method === "POST") {
      assignmentBodies.push(await readRequestJson(req));
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (url.pathname === "/api/v1/accounts/1/conversations/33/custom_attributes" && req.method === "POST") {
      const body = await readRequestJson(req);
      res.end(JSON.stringify({ custom_attributes: body.custom_attributes }));
      return;
    }

    res.statusCode = 404;
    res.end(JSON.stringify({ error: "not found" }));
  });

  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const { port } = server.address();
    const stateStore = createMemoryDepartmentStateStore();
    const result = await handleDepartmentRouterWebhook(reopenPayload(), {
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

    assert.equal(result.action, "department_assigned");
    assert.equal(result.toAgentId, 7);
    assert.deepEqual(assignmentBodies, [{ team_id: 4 }, { assignee_id: 7 }]);
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
    // An old conversation an agent is already handling is left alone.
    assert.equal(result.reason, "manual_assignment_active");
    assert.equal(writeCalls, 0);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test("handleDepartmentRouterWebhook keeps unknown conversations inside the department router boundary", async () => {
  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    res.setHeader("content-type", "application/json; charset=utf-8");

    if (url.pathname === "/api/v1/accounts/1/conversations/33" && req.method === "GET") {
      res.end(JSON.stringify({
        id: 33,
        status: "open",
        inbox_id: 2,
        custom_attributes: {},
        meta: { assignee: null }
      }));
      return;
    }

    res.statusCode = 404;
    res.end(JSON.stringify({ error: "not found" }));
  });

  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const { port } = server.address();
    const stateStore = createMemoryDepartmentStateStore();
    const result = await handleDepartmentRouterWebhook(reopenPayload(), {
      connection: {
        baseUrl: `http://127.0.0.1:${port}`,
        accountId: "1",
        apiToken: "test-token"
      },
      enabled: true,
      promptOnNew: false,
      inboxIds: ["2"],
      salesTeamId: "4",
      operationsTeamId: "3",
      stateStore,
      audit: false
    });

    assert.equal(result.reason, "existing_department_unknown");
    assert.equal(result.handled, true);
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
        // The external campaign uploader marks conversations with custom
        // attributes instead of a native campaign_id.
        custom_attributes: { api_campaign_label: "june-promo", api_sent_june_promo_welcome: "2026-06-14T00:00:00Z" },
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
      inbox_id: 2
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

test("campaign pending markers block both routers even when the conversation is unassigned", async () => {
  let writeCalls = 0;
  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    res.setHeader("content-type", "application/json; charset=utf-8");

    if (url.pathname === "/api/v1/accounts/1/conversations/33" && req.method === "GET") {
      res.end(JSON.stringify({
        id: 33,
        status: "open",
        inbox_id: 2,
        custom_attributes: {
          api_campaign_label: "june",
          api_campaign_status: "pending",
          api_campaign_active_until: "2099-01-01T00:00:00.000Z"
        },
        meta: { assignee: null }
      }));
      return;
    }

    writeCalls += 1;
    res.end(JSON.stringify({ ok: true }));
  });

  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const { port } = server.address();
    const connection = {
      baseUrl: `http://127.0.0.1:${port}`,
      accountId: "1",
      apiToken: "test-token"
    };
    const department = await handleDepartmentRouterWebhook(reopenPayload(), {
      connection,
      enabled: true,
      inboxIds: ["2"],
      salesTeamId: "4",
      operationsTeamId: "3",
      stateStore: createMemoryDepartmentStateStore(),
      audit: false
    });
    const reopen = await handleReopenRouterWebhook(reopenPayload(), {
      connection,
      enabled: true,
      inboxIds: ["2"],
      cooldownSeconds: 0,
      audit: false
    });

    assert.equal(department.reason, "broadcast_conversation");
    assert.equal(reopen.reason, "broadcast_conversation");
    assert.equal(writeCalls, 0);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test("expired external campaign markers no longer block normal routing", async () => {
  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    res.setHeader("content-type", "application/json; charset=utf-8");

    if (url.pathname === "/api/v1/accounts/1/conversations/33" && req.method === "GET") {
      res.end(JSON.stringify({
        id: 33,
        status: "open",
        inbox_id: 2,
        custom_attributes: {
          api_campaign_label: "old-campaign",
          api_campaign_status: "sent",
          api_campaign_active_until: "2020-01-01T00:00:00.000Z"
        },
        meta: { assignee: null }
      }));
      return;
    }

    res.statusCode = 404;
    res.end(JSON.stringify({ error: "not found" }));
  });

  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const { port } = server.address();
    const stateStore = createMemoryDepartmentStateStore({
      33: {
        conversationId: 33,
        state: "broadcast",
        campaignId: "old-campaign",
        campaignExpiresAt: "2099-01-01T00:00:00.000Z"
      }
    });
    const result = await handleDepartmentRouterWebhook(reopenPayload(), {
      connection: {
        baseUrl: `http://127.0.0.1:${port}`,
        accountId: "1",
        apiToken: "test-token"
      },
      enabled: true,
      promptOnNew: false,
      inboxIds: ["2"],
      salesTeamId: "4",
      operationsTeamId: "3",
      stateStore,
      audit: false
    });

    assert.equal(result.reason, "existing_department_unknown");
    assert.equal(result.handled, true);
    assert.equal((await stateStore.get(33)).state, "campaign_expired");
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

function createBotpressHandoffMock({
  agents = [],
  teamAgents = [],
  inboxAgents = [],
  labels = ["needs-bot", "vip"]
} = {}) {
  const state = {
    messages: [],
    assignments: [],
    statusCalled: false,
    customAttributesBody: null,
    customAttributes: {
      engosoft_department_route_state: "resolved",
      engosoft_department_prompt_next: true
    },
    labelsBody: null,
    server: null
  };

  state.server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    res.setHeader("content-type", "application/json; charset=utf-8");

    if (url.pathname === "/api/v1/accounts/1/conversations/33" && req.method === "GET") {
      res.end(JSON.stringify({
        id: 33,
        status: "open",
        inbox_id: 2,
        labels,
        custom_attributes: state.customAttributes,
        meta: {
          assignee: { id: 4, name: "Old Agent" },
          inbox: { id: 2, name: "WhatsApp" }
        }
      }));
      return;
    }

    if (url.pathname === "/api/v1/accounts/1/conversations/33/labels" && req.method === "GET") {
      res.end(JSON.stringify({ payload: labels }));
      return;
    }

    if (url.pathname === "/api/v1/accounts/1/conversations/33/labels" && req.method === "POST") {
      state.labelsBody = await readRequestJson(req);
      res.end(JSON.stringify({ payload: state.labelsBody.labels }));
      return;
    }

    if (url.pathname === "/api/v1/accounts/1/conversations/33/messages" && req.method === "POST") {
      state.messages.push(await readRequestJson(req));
      res.end(JSON.stringify({ id: 700 + state.messages.length }));
      return;
    }

    if (url.pathname === "/api/v1/accounts/1/conversations/33/toggle_status" && req.method === "POST") {
      state.statusCalled = true;
      res.end(JSON.stringify({ status: "open" }));
      return;
    }

    if (url.pathname === "/api/v1/accounts/1/teams/3/team_members" && req.method === "GET") {
      res.end(JSON.stringify(teamAgents));
      return;
    }

    if (url.pathname === "/api/v1/accounts/1/inbox_members/2" && req.method === "GET") {
      res.end(JSON.stringify(inboxAgents));
      return;
    }

    if (url.pathname === "/api/v1/accounts/1/agents" && req.method === "GET") {
      res.end(JSON.stringify(agents));
      return;
    }

    if (url.pathname === "/api/v1/accounts/1/conversations/33/assignments" && req.method === "POST") {
      state.assignments.push(await readRequestJson(req));
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (url.pathname === "/api/v1/accounts/1/conversations/33/custom_attributes" && req.method === "POST") {
      state.customAttributesBody = await readRequestJson(req);
      state.customAttributes = state.customAttributesBody.custom_attributes;
      res.end(JSON.stringify({ custom_attributes: state.customAttributesBody.custom_attributes }));
      return;
    }

    res.statusCode = 404;
    res.end(JSON.stringify({ error: "not found" }));
  });

  return state;
}

function botpressHandoffOptions(port, botpressOverrides = {}) {
  const now = botpressOverrides.now;
  return {
    connection: { baseUrl: `http://127.0.0.1:${port}`, accountId: "1", apiToken: "test-token" },
    enabled: true,
    operationsTeamId: "3",
    operationsAgentIds: ["21"],
    businessHoursEnabled: true,
    businessTimezone: "Africa/Cairo",
    businessStart: "10:00",
    businessEnd: "21:00",
    businessDays: ["0", "1", "2", "3", "4", "6"],
    businessHours: {
      enabled: true,
      timezone: "Africa/Cairo",
      startMinutes: 10 * 60,
      endMinutes: 21 * 60,
      days: new Set([0, 1, 2, 3, 4, 6]),
      ...(now ? { now } : {})
    },
    botpress: {
      enabled: true,
      requireResolvedReentry: true,
      workingHoursEnabled: true,
      timezone: "Africa/Cairo",
      start: "10:00",
      end: "21:00",
      days: ["0", "1", "2", "3", "4", "6"],
      inHoursQueueMessage: "please wait",
      outsideHoursMessage: "outside hours",
      clearLabel: "needs-bot",
      ...botpressOverrides
    },
    audit: false
  };
}

test("handleResolvedReentryReset clears assignee and team when a bot conversation is resolved", async () => {
  const assignments = [];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    res.setHeader("content-type", "application/json; charset=utf-8");

    if (url.pathname === "/api/v1/accounts/1/conversations/33" && req.method === "GET") {
      res.end(JSON.stringify({
        id: 33,
        status: "resolved",
        inbox_id: 2,
        team_id: 4,
        meta: { assignee: { id: 9, name: "Old Agent" } }
      }));
      return;
    }

    if (url.pathname === "/api/v1/accounts/1/conversations/33/assignments" && req.method === "POST") {
      assignments.push(await readRequestJson(req));
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    res.statusCode = 404;
    res.end(JSON.stringify({ error: "not found" }));
  });

  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const { port } = server.address();
    const result = await handleResolvedReentryReset({
      event: "conversation_status_changed",
      id: 33,
      status: "resolved",
      inbox_id: 2
    }, {
      connection: { baseUrl: `http://127.0.0.1:${port}`, accountId: "1", apiToken: "test-token" },
      botEnabled: true,
      botInboxIds: ["2"],
      audit: false
    });

    assert.equal(result.handled, true);
    assert.equal(result.action, "resolved_reentry_reset");
    assert.equal(result.unassignedOnResolve, true);
    assert.equal(result.teamClearedOnResolve, true);
    assert.deepEqual(assignments, [{ assignee_id: null }, { team_id: null }]);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test("handleResolvedReentryReset ignores non-resolve events and a disabled bot", async () => {
  const ignored = await handleResolvedReentryReset({
    event: "message_created",
    id: 33,
    inbox_id: 2
  }, { botEnabled: true, botInboxIds: ["2"], audit: false });
  assert.equal(ignored.handled, false);
  assert.equal(ignored.reason, "not_status_change");

  const disabled = await handleResolvedReentryReset({
    event: "conversation_status_changed",
    id: 33,
    status: "resolved",
    inbox_id: 2
  }, { botEnabled: false, botInboxIds: ["2"], audit: false });
  assert.equal(disabled.handled, false);
  assert.equal(disabled.reason, "bot_disabled");
});

test("handleResolvedReentryReset skips conversations outside the bot inboxes", async () => {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    res.setHeader("content-type", "application/json; charset=utf-8");
    if (url.pathname === "/api/v1/accounts/1/conversations/55" && req.method === "GET") {
      res.end(JSON.stringify({ id: 55, status: "resolved", inbox_id: 9, meta: { assignee: { id: 9 } } }));
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ error: "not found" }));
  });

  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const { port } = server.address();
    const result = await handleResolvedReentryReset({
      event: "conversation_status_changed",
      id: 55,
      status: "resolved",
      inbox_id: 9
    }, {
      connection: { baseUrl: `http://127.0.0.1:${port}`, accountId: "1", apiToken: "test-token" },
      botEnabled: true,
      botInboxIds: ["2"],
      audit: false
    });
    assert.equal(result.handled, false);
    assert.equal(result.reason, "inbox_not_bot_managed");
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

// --- Customer-silence timeout escalation -------------------------------------

test("evaluateCustomerTimeout flags an unanswered bot message older than the timeout", () => {
  const now = Date.parse("2026-06-15T12:00:00Z");
  const sec = Math.floor(now / 1000);
  const messages = [
    { id: 1, message_type: 0, content: "السلام عليكم", created_at: sec - 1800, sender_type: "contact" },
    { id: 2, message_type: 1, content: "ما اسم الدورة؟", created_at: sec - 900 }
  ];
  const result = evaluateCustomerTimeout(messages, { timeoutMs: 10 * 60 * 1000, now });
  assert.equal(result.eligible, true);
  assert.equal(result.reason, "customer_silent");
  assert.equal(result.lastDirection, "outgoing");
});

test("evaluateCustomerTimeout ignores a chat where the customer is awaiting the bot", () => {
  const now = Date.parse("2026-06-15T12:00:00Z");
  const sec = Math.floor(now / 1000);
  const messages = [
    { id: 1, message_type: 1, content: "اهلا", created_at: sec - 1800 },
    { id: 2, message_type: 0, content: "محتاج مساعدة", created_at: sec - 900, sender_type: "contact" }
  ];
  const result = evaluateCustomerTimeout(messages, { timeoutMs: 10 * 60 * 1000, now });
  assert.equal(result.eligible, false);
  assert.equal(result.reason, "awaiting_bot_reply");
});

test("evaluateCustomerTimeout keeps a recent bot message inside the window", () => {
  const now = Date.parse("2026-06-15T12:00:00Z");
  const sec = Math.floor(now / 1000);
  const messages = [
    { id: 1, message_type: 0, content: "اهلا", created_at: sec - 300, sender_type: "contact" },
    { id: 2, message_type: 1, content: "اهلا بيك", created_at: sec - 120 }
  ];
  const result = evaluateCustomerTimeout(messages, { timeoutMs: 10 * 60 * 1000, now });
  assert.equal(result.eligible, false);
  assert.equal(result.reason, "within_timeout");
});

test("evaluateCustomerTimeout skips activity and private messages when picking the last public one", () => {
  const now = Date.parse("2026-06-15T12:00:00Z");
  const sec = Math.floor(now / 1000);
  const messages = [
    { id: 1, message_type: 0, content: "سؤال", created_at: sec - 1800, sender_type: "contact" },
    { id: 2, message_type: 1, content: "رد البوت", created_at: sec - 1500 },
    { id: 3, message_type: 2, content: "Conversation was marked resolved", created_at: sec - 60, content_type: "activity" },
    { id: 4, message_type: 1, content: "ملخص فهد", private: true, created_at: sec - 30 }
  ];
  const result = evaluateCustomerTimeout(messages, { timeoutMs: 10 * 60 * 1000, now });
  assert.equal(result.eligible, true);
  assert.equal(result.lastDirection, "outgoing");
});

test("runCustomerTimeoutSweep is inert until enabled", async () => {
  const result = await runCustomerTimeoutSweep({
    enabled: false,
    inboxIds: ["2"],
    connection: { baseUrl: "http://127.0.0.1:1", accountId: "1", apiToken: "t" }
  });
  assert.equal(result.skipped, true);
  assert.equal(result.reason, "customer_timeout_disabled");
});

test("runCustomerTimeoutSweep escalates an abandoned bot chat to the team Unassigned", async () => {
  const nowDate = () => new Date("2026-06-15T12:00:00Z");
  const sec = Math.floor(Date.parse("2026-06-15T12:00:00Z") / 1000);
  const mock = createCustomerTimeoutMock({
    conversationId: 34,
    inboxId: 2,
    labels: ["needs-bot", "vip"],
    teamAgents: [{ id: 21, name: "Abdelrahman Adel", availability_status: "offline" }],
    inboxAgents: [{ id: 21, name: "Abdelrahman Adel", availability_status: "offline" }],
    messages: [
      { id: 1, message_type: 0, content: "محتاج مساعدة", created_at: sec - 1800, sender_type: "contact" },
      { id: 2, message_type: 1, content: "هل ترغب في تسجيل شكوى؟", created_at: sec - 900 }
    ]
  });

  await new Promise(resolve => mock.server.listen(0, "127.0.0.1", resolve));
  try {
    const { port } = mock.server.address();
    const result = await runCustomerTimeoutSweep({
      enabled: true,
      inboxIds: ["2"],
      minutes: 10,
      label: "needs-bot",
      cooldownSeconds: 0,
      now: nowDate,
      connection: { baseUrl: `http://127.0.0.1:${port}`, accountId: "1", apiToken: "test-token" },
      operationsTeamId: "3",
      operationsAgentIds: ["21"],
      workingHours: {
        enabled: true,
        timezone: "Africa/Cairo",
        startMinutes: 10 * 60,
        endMinutes: 21 * 60,
        days: new Set([0, 1, 2, 3, 4, 6]),
        now: nowDate
      },
      audit: false
    });

    assert.equal(result.escalated.length, 1);
    assert.equal(result.escalated[0].conversationId, 34);
    assert.equal(result.escalated[0].routingAction, "department_team_queue");
    assert.deepEqual(mock.assignments, [{ team_id: 3 }, { assignee_id: null }]);
    assert.deepEqual(mock.labelsBody, { labels: ["vip"] });
    const publicMessages = mock.messages.filter(item => item.private !== true);
    assert.equal(publicMessages.length, 1);
  } finally {
    await new Promise(resolve => mock.server.close(resolve));
  }
});

test("runCustomerTimeoutSweep leaves a chat where the customer is awaiting the bot", async () => {
  const nowDate = () => new Date("2026-06-15T12:00:00Z");
  const sec = Math.floor(Date.parse("2026-06-15T12:00:00Z") / 1000);
  const mock = createCustomerTimeoutMock({
    conversationId: 34,
    inboxId: 2,
    labels: ["needs-bot"],
    messages: [
      { id: 1, message_type: 1, content: "اهلا", created_at: sec - 1800 },
      { id: 2, message_type: 0, content: "عندي مشكلة", created_at: sec - 900, sender_type: "contact" }
    ]
  });

  await new Promise(resolve => mock.server.listen(0, "127.0.0.1", resolve));
  try {
    const { port } = mock.server.address();
    const result = await runCustomerTimeoutSweep({
      enabled: true,
      inboxIds: ["2"],
      minutes: 10,
      label: "needs-bot",
      cooldownSeconds: 0,
      now: nowDate,
      connection: { baseUrl: `http://127.0.0.1:${port}`, accountId: "1", apiToken: "test-token" },
      operationsTeamId: "3",
      audit: false
    });

    assert.equal(result.escalated.length, 0);
    assert.equal(mock.assignments.length, 0);
    assert.equal(result.skipped.some(item => item.reason === "awaiting_bot_reply"), true);
  } finally {
    await new Promise(resolve => mock.server.close(resolve));
  }
});

function createCustomerTimeoutMock({
  conversationId = 34,
  inboxId = 2,
  labels = ["needs-bot"],
  messages = [],
  teamAgents = [],
  inboxAgents = [],
  agents = []
} = {}) {
  const state = {
    messages: [],
    assignments: [],
    labelsBody: null,
    statusCalled: false,
    currentLabels: [...labels],
    server: null
  };
  const base = "/api/v1/accounts/1";

  state.server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    const p = url.pathname;
    res.setHeader("content-type", "application/json; charset=utf-8");

    if (p === `${base}/conversations` && req.method === "GET") {
      const page = Number(url.searchParams.get("page") || "1");
      const payload = page === 1
        ? [{ id: conversationId, status: "open", inbox_id: inboxId, labels: state.currentLabels }]
        : [];
      res.end(JSON.stringify({ payload }));
      return;
    }
    if (p === `${base}/conversations/${conversationId}` && req.method === "GET") {
      res.end(JSON.stringify({
        id: conversationId,
        status: "open",
        inbox_id: inboxId,
        labels: state.currentLabels,
        custom_attributes: {},
        meta: { assignee: null, inbox: { id: inboxId, name: "WhatsApp" } }
      }));
      return;
    }
    if (p === `${base}/conversations/${conversationId}/messages` && req.method === "GET") {
      res.end(JSON.stringify({ payload: messages }));
      return;
    }
    if (p === `${base}/conversations/${conversationId}/messages` && req.method === "POST") {
      state.messages.push(await readRequestJson(req));
      res.end(JSON.stringify({ id: 800 + state.messages.length }));
      return;
    }
    if (p === `${base}/conversations/${conversationId}/labels` && req.method === "GET") {
      res.end(JSON.stringify({ payload: state.currentLabels }));
      return;
    }
    if (p === `${base}/conversations/${conversationId}/labels` && req.method === "POST") {
      state.labelsBody = await readRequestJson(req);
      state.currentLabels = state.labelsBody.labels;
      res.end(JSON.stringify({ payload: state.currentLabels }));
      return;
    }
    if (p === `${base}/conversations/${conversationId}/toggle_status` && req.method === "POST") {
      state.statusCalled = true;
      res.end(JSON.stringify({ status: "open" }));
      return;
    }
    if (p === `${base}/conversations/${conversationId}/custom_attributes` && req.method === "POST") {
      await readRequestJson(req);
      res.end(JSON.stringify({ custom_attributes: {} }));
      return;
    }
    if (p === `${base}/conversations/${conversationId}/assignments` && req.method === "POST") {
      state.assignments.push(await readRequestJson(req));
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    if (p === `${base}/teams/3/team_members` && req.method === "GET") {
      res.end(JSON.stringify(teamAgents));
      return;
    }
    if (p === `${base}/inbox_members/${inboxId}` && req.method === "GET") {
      res.end(JSON.stringify(inboxAgents));
      return;
    }
    if (p === `${base}/agents` && req.method === "GET") {
      res.end(JSON.stringify(agents));
      return;
    }

    res.statusCode = 404;
    res.end(JSON.stringify({ error: "not found", path: p, method: req.method }));
  });

  return state;
}

test("runCustomerTimeoutSweep assigns to an ONLINE eligible agent and never an offline one", async () => {
  const nowDate = () => new Date("2026-06-15T12:00:00Z"); // Monday, inside 10:00-21:00 Cairo
  const sec = Math.floor(Date.parse("2026-06-15T12:00:00Z") / 1000);
  const mock = createCustomerTimeoutMock({
    conversationId: 34,
    inboxId: 2,
    labels: ["needs-bot", "vip"],
    // Agent 21 is OFFLINE, agent 28 is ONLINE; both are in the team, the inbox,
    // and the allowed operations pool. Only the online one (28) may be picked.
    teamAgents: [
      { id: 21, name: "Offline Agent", availability_status: "offline" },
      { id: 28, name: "Online Agent", availability_status: "online" }
    ],
    inboxAgents: [
      { id: 21, name: "Offline Agent" },
      { id: 28, name: "Online Agent" }
    ],
    messages: [
      { id: 1, message_type: 0, content: "محتاج مساعدة", created_at: sec - 1800, sender_type: "contact" },
      { id: 2, message_type: 1, content: "هل ترغب في تسجيل شكوى؟", created_at: sec - 900 }
    ]
  });

  await new Promise(resolve => mock.server.listen(0, "127.0.0.1", resolve));
  try {
    const { port } = mock.server.address();
    const result = await runCustomerTimeoutSweep({
      enabled: true,
      inboxIds: ["2"],
      minutes: 10,
      label: "needs-bot",
      cooldownSeconds: 0,
      now: nowDate,
      connection: { baseUrl: `http://127.0.0.1:${port}`, accountId: "1", apiToken: "test-token" },
      operationsTeamId: "3",
      operationsAgentIds: ["21", "28"],
      workingHours: {
        enabled: true,
        timezone: "Africa/Cairo",
        startMinutes: 10 * 60,
        endMinutes: 21 * 60,
        days: new Set([0, 1, 2, 3, 4, 6]),
        now: nowDate
      },
      audit: false
    });

    assert.equal(result.escalated.length, 1);
    assert.equal(result.escalated[0].routingAction, "department_assigned");
    // Assigned to the ONLINE agent (28), never the offline one (21).
    assert.deepEqual(mock.assignments, [{ team_id: 3 }, { assignee_id: 28 }]);
    const assignedIds = mock.assignments.map(item => item.assignee_id).filter(value => value != null);
    assert.equal(assignedIds.includes(21), false);
    assert.deepEqual(mock.labelsBody, { labels: ["vip"] });
  } finally {
    await new Promise(resolve => mock.server.close(resolve));
  }
});

test("handleResolvedReentryReset stamps the durable resolve marker, preserving existing attributes", async () => {
  let customAttributesBody = null;
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    res.setHeader("content-type", "application/json; charset=utf-8");

    if (url.pathname === "/api/v1/accounts/1/conversations/40" && req.method === "GET") {
      res.end(JSON.stringify({
        id: 40,
        status: "resolved",
        inbox_id: 2,
        custom_attributes: { existing_key: "keep" },
        meta: { assignee: { id: 9 } }
      }));
      return;
    }
    if (url.pathname === "/api/v1/accounts/1/conversations/40/assignments" && req.method === "POST") {
      await readRequestJson(req);
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    if (url.pathname === "/api/v1/accounts/1/conversations/40/custom_attributes" && req.method === "POST") {
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
    const result = await handleResolvedReentryReset({
      event: "conversation_status_changed",
      id: 40,
      status: "resolved",
      inbox_id: 2
    }, {
      connection: { baseUrl: `http://127.0.0.1:${port}`, accountId: "1", apiToken: "test-token" },
      botEnabled: true,
      botInboxIds: ["2"],
      audit: false
    });

    assert.equal(result.handled, true);
    assert.equal(result.releaseMarked, true);
    assert.ok(customAttributesBody, "custom attributes should be written");
    assert.equal(customAttributesBody.custom_attributes.existing_key, "keep");
    assert.ok(customAttributesBody.custom_attributes.engosoft_bot_release, "marker timestamp set");
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
