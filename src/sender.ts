import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";

export type Bot = { alias: string; name: string };
export type Receipt = {
  requestId: string;
  bot: string;
  createdAt: string;
  status: "accepted" | "rejected" | "unknown";
  httpStatus?: number;
};
export type RunResult = { code: number | null; stdout: string };
export type Runner = (args: string[], input?: string) => Promise<RunResult>;
const aliasPattern = /^[a-z0-9][a-z0-9-]{0,47}$/;
const idPattern = /^[A-Za-z0-9_-]{1,80}$/;
const safeError =
  "Mac sender unavailable. Check ~/.local/bin/grok-bots in your terminal. Private diagnostic output is hidden.";

// Fixed executable, argument arrays, and stdin only. Never invoke a shell or read configuration.
export function runCli(
  args: string[],
  input?: string,
  executable = join(homedir(), ".local/bin/grok-bots"),
): Promise<RunResult> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const child = spawn(executable, args, {
      shell: false,
      stdio: ["pipe", "pipe", "ignore"],
    });
    const finish = (
      code: number | null,
      output = Buffer.concat(chunks).toString("utf8"),
    ) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, stdout: output });
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(null, "");
    }, 30_000);
    child.on("error", () => finish(null, ""));
    child.stdin.on("error", () => {
      /* EPIPE is handled by the process result. */
    });
    child.stdout.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > 128_000) {
        child.kill();
        finish(null, "");
      } else chunks.push(chunk);
    });
    child.on("close", (code) => finish(code));
    child.stdin.end(input ?? "");
  });
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
function parse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

// Explicit allowlists discard raw notes, chat URLs, stderr, extra fields, and upstream bodies.
export function readReceipt(
  value: unknown,
  expectedId?: string,
  expectedBot?: string,
): Receipt | undefined {
  const row = object(value);
  if (
    !row ||
    typeof row.requestId !== "string" ||
    !idPattern.test(row.requestId) ||
    (expectedId !== undefined && row.requestId !== expectedId) ||
    typeof row.bot !== "string" ||
    !aliasPattern.test(row.bot) ||
    (expectedBot !== undefined && row.bot !== expectedBot) ||
    typeof row.createdAt !== "string" ||
    !Number.isFinite(Date.parse(row.createdAt)) ||
    typeof row.status !== "string" ||
    !["accepted", "rejected", "unknown"].includes(row.status)
  )
    return;
  return {
    requestId: row.requestId,
    bot: row.bot,
    createdAt: new Date(row.createdAt).toISOString(),
    status: row.status as Receipt["status"],
    ...(Number.isInteger(row.httpStatus) &&
    Number(row.httpStatus) >= 100 &&
    Number(row.httpStatus) <= 599
      ? { httpStatus: Number(row.httpStatus) }
      : {}),
  };
}

export function createRequest(bot: string): Receipt {
  if (!aliasPattern.test(bot)) throw new Error("Select a configured Bot.");
  return {
    requestId: `raycast-${randomUUID()}`,
    bot,
    createdAt: new Date().toISOString(),
    status: "unknown",
  };
}

export function validateMessage(message: string): string | undefined {
  if (!message.trim()) return "Write a message first.";
  if (Buffer.byteLength(message, "utf8") > 32_000)
    return "Keep the message within 32,000 UTF-8 bytes.";
}

export type NewBot = { alias: string; name: string; url: string; key: string };
export type NewBotErrors = Partial<Record<keyof NewBot, string>>;
const addError =
  "Couldn’t save this Bot. Check the webhook URL and key, then try again. Existing Bots were not changed.";

export function suggestAlias(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .slice(0, 48)
    .replace(/-+$/, "");
}

// Field-level checks for the Raycast form. The sender validates again and has the final say.
export function validateNewBot(
  bot: NewBot,
  existingAliases: string[] = [],
): NewBotErrors {
  const errors: NewBotErrors = {};
  const name = bot.name.trim();
  if (
    !name ||
    name.length > 100 ||
    [...name].some(
      (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
    )
  )
    errors.name = "Enter a name";
  if (!aliasPattern.test(bot.alias)) errors.alias = "Use a–z, 0–9 and hyphens";
  else if (existingAliases.includes(bot.alias))
    errors.alias = "Alias already in use";
  let url: URL | undefined;
  try {
    url = new URL(bot.url.trim());
  } catch {
    /* Reported below. */
  }
  if (
    !url ||
    url.protocol !== "https:" ||
    url.hostname !== "api2.cursor.sh" ||
    url.port ||
    url.username ||
    url.password ||
    !/^\/automations\/webhook\/[A-Za-z0-9_-]+$/.test(url.pathname) ||
    url.search ||
    url.hash
  )
    errors.url = "Use the api2.cursor.sh webhook URL";
  const key = bot.key.trim();
  if (/^bearer\s/i.test(key)) errors.key = "Key only, without Bearer";
  else if (
    !key ||
    /\s/.test(key) ||
    key.length > 4096 ||
    [...key].some(
      (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
    )
  )
    errors.key = "Paste the webhook key";
  return errors;
}

export class Sender {
  constructor(private readonly run: Runner = runCli) {}

  // Credentials travel on stdin only, never in arguments. The sender refuses existing aliases.
  async add(bot: NewBot): Promise<void> {
    if (Object.keys(validateNewBot(bot)).length) throw new Error(addError);
    let result: RunResult;
    try {
      result = await this.run(
        ["add", bot.alias, "--stdin"],
        JSON.stringify({
          name: bot.name.trim(),
          url: bot.url.trim(),
          key: bot.key.trim(),
        }),
      );
    } catch {
      throw new Error(addError);
    }
    if (result.code !== 0) throw new Error(addError);
  }

  async list(): Promise<Bot[]> {
    const result = await this.run(["list"]);
    const value = parse(result.stdout);
    if (result.code !== 0 || !Array.isArray(value)) throw new Error(safeError);
    return value.flatMap((value) => {
      const row = object(value);
      if (
        !row ||
        typeof row.alias !== "string" ||
        !aliasPattern.test(row.alias) ||
        typeof row.name !== "string" ||
        !row.name.trim() ||
        row.name.length > 100 ||
        [...row.name].some(
          (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
        )
      )
        return [];
      return [{ alias: row.alias, name: row.name }];
    });
  }

  async status(pending: Receipt): Promise<Receipt> {
    try {
      const result = await this.run(["status", pending.requestId]);
      const receipt =
        result.code === 0
          ? readReceipt(parse(result.stdout), pending.requestId, pending.bot)
          : undefined;
      if (!receipt) throw new Error(safeError);
      return receipt;
    } catch {
      throw new Error(safeError);
    }
  }

  // Call only after the unknown receipt is durably saved. No retry path exists.
  async send(pending: Receipt, message: string): Promise<Receipt> {
    const error = validateMessage(message);
    if (error) throw new Error(error);
    if (
      !idPattern.test(pending.requestId) ||
      !aliasPattern.test(pending.bot) ||
      pending.status !== "unknown"
    )
      throw new Error("Invalid pending request.");
    try {
      const result = await this.run(
        ["send", pending.bot, "--id", pending.requestId],
        message,
      );
      const receipt = [0, 2].includes(result.code ?? -1)
        ? readReceipt(parse(result.stdout), pending.requestId, pending.bot)
        : undefined;
      if (receipt) return receipt;
    } catch {
      /* The sender may have transmitted. Inspect the same ID only. */
    }
    try {
      return await this.status(pending);
    } catch {
      return pending;
    }
  }
}
