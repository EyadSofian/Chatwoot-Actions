import test from "node:test";
import assert from "node:assert/strict";
import {
  buildDigestHtml,
  buildDigestSubject,
  formatDurationSeconds,
  normalizeRecipients,
  parseRecipientsConfig,
  shouldRunDigestNow
} from "../src/emailDigest.js";

test("normalizeRecipients drops invalid/duplicate emails and keeps inbox + label", () => {
  const result = normalizeRecipients([
    { email: "A@Engosoft.com", inboxId: 15, label: "Sales" },
    { email: "a@engosoft.com", inboxId: "16" },       // duplicate (case-insensitive)
    { email: "not-an-email" },                          // invalid
    { email: "b@engosoft.com" }
  ]);
  assert.equal(result.length, 2);
  assert.deepEqual(result[0], { email: "a@engosoft.com", inboxId: "15", label: "Sales" });
  assert.equal(result[1].email, "b@engosoft.com");
  assert.equal(result[1].inboxId, "");
});

test("parseRecipientsConfig accepts a JSON array or a bare email list", () => {
  const fromJson = parseRecipientsConfig('[{"email":"x@engosoft.com","inboxId":"10"}]');
  assert.equal(fromJson[0].email, "x@engosoft.com");
  assert.equal(fromJson[0].inboxId, "10");

  const fromList = parseRecipientsConfig("a@engosoft.com, b@engosoft.com\nc@engosoft.com");
  assert.deepEqual(fromList.map(r => r.email), ["a@engosoft.com", "b@engosoft.com", "c@engosoft.com"]);
});

test("shouldRunDigestNow fires once per day at or after the hour", () => {
  const opts = { hour: 8, timezone: "UTC", lastRunDate: "" };
  assert.equal(shouldRunDigestNow(new Date("2026-07-09T06:00:00Z"), opts), false, "before the hour");
  assert.equal(shouldRunDigestNow(new Date("2026-07-09T10:00:00Z"), opts), "2026-07-09", "eligible → returns date");
  assert.equal(
    shouldRunDigestNow(new Date("2026-07-09T10:00:00Z"), { ...opts, lastRunDate: "2026-07-09" }),
    false,
    "already ran today"
  );
});

test("formatDurationSeconds humanises seconds", () => {
  assert.equal(formatDurationSeconds(0), "0s");
  assert.equal(formatDurationSeconds(90), "1m 30s");
  assert.equal(formatDurationSeconds(3661), "1h 1m 1s");
  assert.equal(formatDurationSeconds(null), "-");
  assert.equal(formatDurationSeconds(""), "-");
});

test("buildDigestSubject includes the day and recipient scope", () => {
  const subject = buildDigestSubject({ label: "Sales" }, "2026-07-09T08:00:00.000Z");
  assert.match(subject, /2026-07-09/);
  assert.match(subject, /Sales/);
});

test("buildDigestHtml renders CSAT, lead sources, and campaign totals", () => {
  const html = buildDigestHtml({
    analytics: {
      csat: { ratedCount: 7, averageRating: 4.3, distribution: { 4: 3, 5: 4 } },
      leadSources: { total: 5, bySource: [{ label: "Facebook", count: 3, percentage: 60 }] },
      agents: [{ agentName: "Sara", ratedCount: 4, averageRating: 4.5, conversationsCount: 12, resolutionsCount: 10, avgFirstResponseTime: 90, avgResolutionTime: 3600 }],
      teams: []
    },
    campaigns: { totals: { totalCampaigns: 3, running: 1, pending: 1, sentTotal: 240 }, perInbox: [{ inboxName: "WhatsApp Sales", campaignCount: 2, running: 1, pending: 1, completed: 0, sentTotal: 40 }] },
    recipient: { label: "Sales", inboxId: "15" },
    generatedAt: "2026-07-09T08:00:00.000Z"
  });
  assert.match(html, /Sara/);
  assert.match(html, /Facebook/);
  assert.match(html, /WhatsApp Sales/);
  assert.match(html, /4\.3/);          // average rating
  assert.match(html, /240/);           // campaign messages sent
  assert.match(html, /1m 30s/);        // formatted first-response time
});
