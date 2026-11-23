import { Bot, Receipt } from "./sender";

export type BotTone =
  "blue" | "purple" | "green" | "orange" | "magenta" | "yellow";

export interface ReceiptStateCopy {
  title: string;
  label: string;
  text: string;
  next: string;
}

export interface BotHistorySummary {
  latest?: Receipt;
  total: number;
  attentionCount: number;
}

const tones: readonly BotTone[] = [
  "blue",
  "purple",
  "green",
  "orange",
  "magenta",
  "yellow",
];

export function botTone(alias: string): BotTone {
  let hash = 2166136261;
  for (let i = 0; i < alias.length; i++) {
    hash ^= alias.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return tones[(hash >>> 0) % tones.length];
}

export function escapeMarkdownInline(text: string): string {
  return text
    .replace(/[\r\n]+/g, " ")
    .replace(/([\\`*_{}[\]()#+\-.!|~<>])/g, "\\$1");
}

function longestBacktickRun(text: string): number {
  let longest = 0;
  let current = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 96) {
      current++;
      if (current > longest) longest = current;
    } else {
      current = 0;
    }
  }
  return longest;
}

export function inlineCode(text: string): string {
  const normalized = text.replace(/[\r\n]+/g, " ");
  const fence = "`".repeat(longestBacktickRun(normalized) + 1);
  const needsPadding =
    normalized.startsWith("`") ||
    normalized.endsWith("`") ||
    (normalized.startsWith(" ") &&
      normalized.endsWith(" ") &&
      normalized.trim().length > 0);
  return needsPadding
    ? `${fence} ${normalized} ${fence}`
    : `${fence}${normalized}${fence}`;
}

export function fencedTextBlock(text: string): string {
  const normalized = text.replace(/\r\n?/g, "\n");
  const fence = "`".repeat(Math.max(3, longestBacktickRun(normalized) + 1));
  return `${fence}text\n${normalized}\n${fence}`;
}

export function botDropdownTitle(bot: Bot): string {
  const name = bot.name.trim();
  const alias = bot.alias.trim();
  return name.toLowerCase() === alias.toLowerCase()
    ? name
    : `${name} (${alias})`;
}

export function botHistorySummary(
  history: readonly Receipt[],
  alias: string,
): BotHistorySummary {
  let latest: Receipt | undefined;
  let latestTs = Number.NEGATIVE_INFINITY;
  let total = 0;
  let attentionCount = 0;
  for (const receipt of history) {
    if (receipt.bot !== alias) continue;
    total++;
    if (receipt.status !== "accepted") attentionCount++;
    const ts = Date.parse(receipt.createdAt);
    if (!latest) {
      latest = receipt;
      latestTs = Number.isFinite(ts) ? ts : Number.NEGATIVE_INFINITY;
    } else if (Number.isFinite(ts) && ts > latestTs) {
      latest = receipt;
      latestTs = ts;
    }
  }
  return { latest, total, attentionCount };
}

export function formatAttentionSummary(summary: BotHistorySummary): string {
  if (summary.attentionCount === 0) return String(summary.total);
  const verb = summary.attentionCount === 1 ? "needs" : "need";
  return `${summary.total} (${summary.attentionCount} ${verb} attention)`;
}

export function formatByteCount(bytes: number): string {
  if (bytes > 28_000) {
    return `${bytes.toLocaleString("en-US")} / 32,000 bytes`;
  }
  return bytes === 1 ? "1 byte" : `${bytes.toLocaleString("en-US")} bytes`;
}

export function formatSearchPlaceholder(bots: readonly Bot[]): string {
  const example = bots[0]?.alias ?? "fleet";
  return `Choose a Bot, or type ${example} <message>…`;
}

export function formatBotDetailMarkdown(
  bot: Bot,
  draftMessage?: string,
): string {
  const safeName = escapeMarkdownInline(bot.name);
  if (draftMessage !== undefined) {
    return [
      `## Draft for ${safeName}`,
      "",
      fencedTextBlock(draftMessage),
      "",
      "Press **Return** to open in the composer, then **⌘Return** to send. Opening a draft never sends it.",
    ].join("\n");
  }
  return [
    `## ${safeName}`,
    "",
    `Type ${inlineCode(`${bot.alias} <message>`)} in the search bar to preview a draft, or press **Return** to open the composer.`,
    "",
    "Messages go straight through your local sender and aren’t saved in history. Replies appear in **Grok Bot**.",
  ].join("\n");
}

export function formatReceiptMarkdown(
  state: ReceiptStateCopy,
  receipt: Receipt,
  showDetails: boolean,
): string {
  const body = `# ${state.title}\n\n${state.text}\n\n${state.next}`;
  if (!showDetails) return body;
  const statusPrefix = receipt.httpStatus
    ? `HTTP ${receipt.httpStatus} · `
    : "";
  return `${body}\n\n---\n\n**Request ID**\n\n${inlineCode(receipt.requestId)}\n\n${statusPrefix}This is a delivery receipt, not the Bot’s answer.`;
}
