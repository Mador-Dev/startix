import test from "node:test";
import assert from "node:assert/strict";

test("appendFeedEvent returns a well-formed record when no DB is configured", async () => {
  const { appendFeedEvent } = await import("./feedService.js");

  const record = await appendFeedEvent("test-user", {
    kind: "market_news",
    ticker: "AAPL",
    title: "Apple event",
    summary: "A fresh headline arrived.",
    source: "percolation",
    url: "https://example.com/apple",
  });

  assert.equal(record.kind, "market_news");
  assert.equal(record.ticker, "AAPL");
  assert.equal(record.title, "Apple event");
  assert.ok(record.id.startsWith("evt_"));
  assert.ok(typeof record.createdAt === "string");
});
