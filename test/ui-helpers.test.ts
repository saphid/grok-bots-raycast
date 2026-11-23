import assert from "node:assert/strict";
import { test } from "node:test";
import {
  botDropdownTitle,
  botHistorySummary,
  botTone,
  escapeMarkdownInline,
  fencedTextBlock,
  formatBotDetailMarkdown,
  formatByteCount,
  formatReceiptMarkdown,
  formatSearchPlaceholder,
} from "../src/ui-helpers";
import { Receipt } from "../src/sender";

test("botTone is deterministic and stays within the supported palette", () => {
  const allowed = new Set([
    "blue",
    "purple",
    "green",
    "orange",
    "magenta",
    "yellow",
  ]);
  for (const alias of ["fleet", "ops", "research", "daily-brief", "a", "z-9"]) {
    const first = botTone(alias);
    const second = botTone(alias);
    assert.equal(first, second);
    assert.ok(allowed.has(first));
  }
});

test("markdown helpers safely escape Bot names and backtick-heavy drafts", () => {
  assert.equal(
    escapeMarkdownInline("Bot [1](https://example.com) *bold*"),
    "Bot \\[1\\]\\(https://example\\.com\\) \\*bold\\*",
  );

  const tricky = "Here is a block:\r\n```ts\r\nconsole.log(`hi`)\r\n```";
  const fenced = fencedTextBlock(tricky);
  assert.ok(fenced.startsWith("````text\n"));
  assert.ok(fenced.endsWith("\n````"));
  assert.ok(!fenced.includes("\r"));

  const draftMd = formatBotDetailMarkdown(
    { alias: "fleet", name: "Fleet [Prod]" },
    tricky,
  );
  assert.ok(draftMd.startsWith("## Draft for Fleet \\[Prod\\]"));
  assert.ok(draftMd.includes("Opening a draft never sends it."));

  const idleMd = formatBotDetailMarkdown({ alias: "ops", name: "Ops" });
  assert.ok(idleMd.includes("Type `ops <message>`"));
});

test("botHistorySummary finds latest delivery and counts non-accepted rows", () => {
  const history: Receipt[] = [
    {
      requestId: "req-1",
      bot: "fleet",
      createdAt: "2026-11-20T01:00:00.000Z",
      status: "accepted",
      httpStatus: 202,
    },
    {
      requestId: "req-2",
      bot: "fleet",
      createdAt: "2026-11-22T09:00:00.000Z",
      status: "unknown",
    },
    {
      requestId: "req-3",
      bot: "ops",
      createdAt: "2026-11-23T00:00:00.000Z",
      status: "rejected",
      httpStatus: 401,
    },
  ];

  const fleet = botHistorySummary(history, "fleet");
  assert.equal(fleet.total, 2);
  assert.equal(fleet.attentionCount, 1);
  assert.equal(fleet.latest?.requestId, "req-2");

  const none = botHistorySummary(history, "research");
  assert.equal(none.total, 0);
  assert.equal(none.attentionCount, 0);
  assert.equal(none.latest, undefined);
});

test("dropdown, placeholder, byte-count, and receipt formatting stay crisp", () => {
  assert.equal(botDropdownTitle({ alias: "fleet", name: "Fleet" }), "Fleet");
  assert.equal(
    botDropdownTitle({ alias: "ops-bot", name: "Operations" }),
    "Operations (ops-bot)",
  );

  assert.equal(
    formatSearchPlaceholder([]),
    "Choose a Bot, or type fleet <message>…",
  );
  assert.equal(
    formatSearchPlaceholder([{ alias: "research", name: "Research" }]),
    "Choose a Bot, or type research <message>…",
  );

  assert.equal(formatByteCount(1), "1 byte");
  assert.equal(formatByteCount(42), "42 bytes");
  assert.equal(formatByteCount(29_500), "29,500 / 32,000 bytes");

  const receipt: Receipt = {
    requestId: "raycast-123",
    bot: "fleet",
    createdAt: "2026-11-23T00:00:00.000Z",
    status: "accepted",
    httpStatus: 202,
  };
  const copy = {
    title: "Message accepted",
    label: "Accepted",
    text: "Accepted text.",
    next: "Open Grok Bot.",
  };
  const brief = formatReceiptMarkdown(copy, receipt, false);
  assert.ok(!brief.includes("raycast-123"));
  const full = formatReceiptMarkdown(copy, receipt, true);
  assert.ok(full.includes("`raycast-123`"));
  assert.ok(full.includes("HTTP 202 · "));
});
