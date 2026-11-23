import assert from "node:assert/strict";
import { test } from "node:test";
import {
  botDropdownTitle,
  botHistorySummary,
  botTone,
  escapeMarkdownInline,
  fencedTextBlock,
  formatAttentionSummary,
  formatBotDetailMarkdown,
  formatByteCount,
  formatReceiptMarkdown,
  formatSearchPlaceholder,
  inlineCode,
} from "../src/ui-helpers";
import { Receipt } from "../src/sender";

test("botTone is deterministic across standard, empty, and non-ASCII aliases", () => {
  const allowed = new Set([
    "blue",
    "purple",
    "green",
    "orange",
    "magenta",
    "yellow",
  ]);
  for (const alias of [
    "fleet",
    "ops",
    "research",
    "daily-brief",
    "a",
    "z-9",
    "",
    "bot-🚀",
  ]) {
    const first = botTone(alias);
    const second = botTone(alias);
    assert.equal(first, second);
    assert.ok(allowed.has(first));
  }
});

test("markdown helpers safely escape Bot names, aliases, IDs, and backtick-heavy drafts", () => {
  assert.equal(
    escapeMarkdownInline("Bot ![x](https://a.test)\n<img src=x> *bold*"),
    "Bot \\!\\[x\\]\\(https://a\\.test\\) \\<img src=x\\> \\*bold\\*",
  );

  assert.equal(inlineCode("plain"), "`plain`");
  assert.equal(inlineCode("has `tick`\nline2"), "``has `tick` line2``");
  assert.equal(inlineCode("`edge`"), "`` `edge` ``");

  const tricky = "Here is a block:\r\n```ts\rconsole.log(`hi`)\n````\n~~~";
  const fenced = fencedTextBlock(tricky);
  assert.ok(fenced.startsWith("`````text\n"));
  assert.ok(fenced.endsWith("\n`````"));
  assert.ok(!fenced.includes("\r"));

  // Large backtick-heavy input should not overflow the call stack.
  const hugeBackticks = "`a".repeat(50_000);
  const hugeFenced = fencedTextBlock(hugeBackticks);
  assert.ok(hugeFenced.startsWith("```text\n"));

  const draftMd = formatBotDetailMarkdown(
    { alias: "fleet", name: "Fleet [Prod]\nInjected" },
    tricky,
  );
  assert.ok(draftMd.startsWith("## Draft for Fleet \\[Prod\\] Injected\n"));
  assert.ok(draftMd.includes("Opening a draft never sends it."));

  const emptyDraftMd = formatBotDetailMarkdown(
    { alias: "fleet", name: "Fleet" },
    "",
  );
  assert.ok(emptyDraftMd.startsWith("## Draft for Fleet\n"));

  const idleMd = formatBotDetailMarkdown({ alias: "ops`x", name: "Ops" });
  assert.ok(idleMd.includes("Type ``ops`x <message>``"));
});

test("botHistorySummary handles newest-first order, invalid dates, and attention counts", () => {
  const history: Receipt[] = [
    {
      requestId: "req-newest",
      bot: "fleet",
      createdAt: "2026-11-23T09:00:00.000Z",
      status: "accepted",
      httpStatus: 202,
    },
    {
      requestId: "req-older-unknown",
      bot: "fleet",
      createdAt: "2026-11-22T09:00:00.000Z",
      status: "unknown",
    },
    {
      requestId: "req-older-rejected",
      bot: "fleet",
      createdAt: "2026-11-21T09:00:00.000Z",
      status: "rejected",
      httpStatus: 401,
    },
    {
      requestId: "req-bad-date",
      bot: "ops",
      createdAt: "not-a-date",
      status: "unknown",
    },
    {
      requestId: "req-valid-date",
      bot: "ops",
      createdAt: "2026-11-20T00:00:00.000Z",
      status: "accepted",
    },
  ];

  const fleet = botHistorySummary(history, "fleet");
  assert.equal(fleet.total, 3);
  assert.equal(fleet.attentionCount, 2);
  assert.equal(fleet.latest?.requestId, "req-newest");
  assert.equal(formatAttentionSummary(fleet), "3 (2 need attention)");

  const ops = botHistorySummary(history, "ops");
  assert.equal(ops.total, 2);
  assert.equal(ops.attentionCount, 1);
  assert.equal(ops.latest?.requestId, "req-valid-date");
  assert.equal(formatAttentionSummary(ops), "2 (1 needs attention)");

  const none = botHistorySummary(history, "research");
  assert.equal(none.total, 0);
  assert.equal(none.attentionCount, 0);
  assert.equal(none.latest, undefined);
  assert.equal(formatAttentionSummary(none), "0");
});

test("dropdown, placeholder, byte-count boundaries, and receipt formatting stay crisp", () => {
  assert.equal(botDropdownTitle({ alias: "fleet", name: "Fleet " }), "Fleet");
  assert.equal(
    botDropdownTitle({ alias: "ops-bot", name: " Operations " }),
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

  assert.equal(formatByteCount(0), "0 bytes");
  assert.equal(formatByteCount(1), "1 byte");
  assert.equal(formatByteCount(42), "42 bytes");
  assert.equal(formatByteCount(28_000), "28,000 bytes");
  assert.equal(formatByteCount(28_001), "28,001 / 32,000 bytes");
  assert.equal(formatByteCount(35_000), "35,000 / 32,000 bytes");

  const copy = {
    title: "Message accepted",
    label: "Accepted",
    text: "Accepted text.",
    next: "Open Grok Bot.",
  };
  const withHttp: Receipt = {
    requestId: "raycast-123",
    bot: "fleet",
    createdAt: "2026-11-23T00:00:00.000Z",
    status: "accepted",
    httpStatus: 202,
  };
  const brief = formatReceiptMarkdown(copy, withHttp, false);
  assert.ok(!brief.includes("raycast-123"));
  const full = formatReceiptMarkdown(copy, withHttp, true);
  assert.ok(full.includes("`raycast-123`"));
  assert.ok(full.includes("HTTP 202 · "));

  const withoutHttp: Receipt = {
    requestId: "raycast-`weird`",
    bot: "fleet",
    createdAt: "2026-11-23T00:00:00.000Z",
    status: "unknown",
  };
  const noHttpMd = formatReceiptMarkdown(copy, withoutHttp, true);
  assert.ok(noHttpMd.includes("`` raycast-`weird` ``"));
  assert.ok(!noHttpMd.includes("HTTP "));
  assert.ok(!noHttpMd.includes(" · "));
});
