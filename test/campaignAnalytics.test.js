import test from "node:test";
import assert from "node:assert/strict";
import { aggregateCampaignJobs, bucketForStatus, parseUploaderUrls } from "../src/campaignAnalytics.js";

const sampleJobs = [
  { type: "send", status: "running", active: true, createdAt: "2026-07-01T09:00:00.000Z", total: 100, counters: { sent: 40, failed: 2 }, settings: { originalLabelName: "Revit_July", templateName: "promo_ar", inboxId: "15" }, operatorName: "Sara" },
  { type: "send", status: "queued", createdAt: "2026-07-02T09:00:00.000Z", total: 50, counters: { sent: 0 }, settings: { originalLabelName: "AutoCAD_Aug", templateName: "promo_ar", inboxId: "15" } },
  { type: "send", status: "completed", createdAt: "2026-06-20T09:00:00.000Z", total: 200, counters: { sent: 200 }, settings: { originalLabelName: "Summer_Sale", templateName: "promo2", inboxId: "16" } },
  { type: "send", status: "failed", createdAt: "2026-06-10T09:00:00.000Z", total: 30, counters: { sent: 0, errors: 30 }, settings: { originalLabelName: "Broken", templateName: "promo2", inboxId: "16" } },
  { type: "upload", status: "completed", createdAt: "2026-06-19T09:00:00.000Z", counters: {}, settings: { labelName: "contacts_import" } }
];

const inboxLookup = new Map([["15", "WhatsApp Sales"], ["16", "WhatsApp Support"]]);

test("bucketForStatus maps uploader statuses to coarse buckets", () => {
  assert.equal(bucketForStatus("running"), "running");
  assert.equal(bucketForStatus("queued"), "pending");
  assert.equal(bucketForStatus("queued", true), "running");
  assert.equal(bucketForStatus("completed_with_errors"), "completed");
  assert.equal(bucketForStatus("failed"), "failed");
  assert.equal(bucketForStatus("interrupted"), "stopped");
});

test("aggregateCampaignJobs counts campaigns, buckets, and per-inbox totals", () => {
  const report = aggregateCampaignJobs(sampleJobs, { inboxLookup });

  // Only `send` jobs are campaigns — the upload job is excluded.
  assert.equal(report.totals.totalCampaigns, 4);
  assert.equal(report.totals.running, 1);
  assert.equal(report.totals.pending, 1);
  assert.equal(report.totals.completed, 1);
  assert.equal(report.totals.failed, 1);
  assert.equal(report.totals.sentTotal, 240);

  const sales = report.perInbox.find(inbox => inbox.inboxId === "15");
  assert.equal(sales.inboxName, "WhatsApp Sales");
  assert.equal(sales.campaignCount, 2);
  assert.equal(sales.running, 1);
  assert.equal(sales.pending, 1);
  assert.equal(sales.sentTotal, 40);

  const support = report.perInbox.find(inbox => inbox.inboxId === "16");
  assert.equal(support.campaignCount, 2);
  assert.equal(support.completed, 1);
  assert.equal(support.failed, 1);
});

test("aggregateCampaignJobs lists campaigns newest-first with names and inbox names", () => {
  const report = aggregateCampaignJobs(sampleJobs, { inboxLookup });
  assert.equal(report.campaigns.length, 4);
  assert.equal(report.campaigns[0].name, "AutoCAD_Aug", "newest campaign first");
  const revit = report.campaigns.find(row => row.name === "Revit_July");
  assert.equal(revit.inboxName, "WhatsApp Sales");
  assert.equal(revit.statusBucket, "running");
  assert.equal(revit.sent, 40);
  assert.equal(revit.operatorName, "Sara");
});

test("aggregateCampaignJobs falls back to Inbox <id> when the name is unknown", () => {
  const report = aggregateCampaignJobs(
    [{ type: "send", status: "completed", createdAt: "2026-07-01", counters: { sent: 5 }, settings: { originalLabelName: "X", inboxId: "99" } }],
    { inboxLookup }
  );
  assert.equal(report.campaigns[0].inboxName, "Inbox 99");
});

test("aggregateCampaignJobs returns empty shape for no jobs", () => {
  const report = aggregateCampaignJobs([], {});
  assert.equal(report.totals.totalCampaigns, 0);
  assert.deepEqual(report.perInbox, []);
  assert.deepEqual(report.campaigns, []);
});

test("parseUploaderUrls splits and de-dupes multiple URLs", () => {
  assert.deepEqual(
    parseUploaderUrls("https://a.railway.app/, https://b.railway.app"),
    ["https://a.railway.app", "https://b.railway.app"]
  );
  assert.deepEqual(parseUploaderUrls("https://a.app\nhttps://a.app https://b.app"), ["https://a.app", "https://b.app"]);
  assert.deepEqual(parseUploaderUrls(""), []);
  assert.deepEqual(parseUploaderUrls(["https://x.app/"]), ["https://x.app"]);
});

test("aggregateCampaignJobs carries the uploader source per campaign", () => {
  const report = aggregateCampaignJobs([
    { type: "send", status: "running", _source: "campaign.railway.app", createdAt: "2026-07-01", counters: { sent: 1 }, settings: { originalLabelName: "A", inboxId: "15" } },
    { type: "send", status: "running", _source: "sales.railway.app", createdAt: "2026-07-02", counters: { sent: 2 }, settings: { originalLabelName: "B", inboxId: "16" } }
  ], {});
  assert.equal(report.totals.totalCampaigns, 2);
  const a = report.campaigns.find(row => row.name === "A");
  const b = report.campaigns.find(row => row.name === "B");
  assert.equal(a.source, "campaign.railway.app");
  assert.equal(b.source, "sales.railway.app");
});
