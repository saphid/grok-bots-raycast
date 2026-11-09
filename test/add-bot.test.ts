import { test } from "node:test";
import assert from "node:assert/strict";
import {
  chmod,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  NewBot,
  runCli,
  Sender,
  suggestAlias,
  validateNewBot,
} from "../src/sender";

const secret = "SYNTHETIC_PRIVATE_KEY_DO_NOT_DISPLAY";
const bot: NewBot = {
  alias: "fleet",
  name: "Fleet",
  url: "https://api2.cursor.sh/automations/webhook/test-id",
  key: secret,
};

test("add passes credentials on stdin only, never in arguments", async () => {
  const calls: { args: string[]; input?: string }[] = [];
  const sender = new Sender(async (args, input) => {
    calls.push({ args, input });
    return { code: 0, stdout: "Saved fleet. Credentials were not printed.\n" };
  });
  await sender.add({
    ...bot,
    name: "  Fleet ",
    url: ` ${bot.url}\n`,
    key: ` ${secret}\n`,
  });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args, ["add", "fleet", "--stdin"]);
  assert.ok(!calls[0].args.join(" ").includes(secret));
  assert.ok(!calls[0].args.join(" ").includes("api2.cursor.sh"));
  assert.deepEqual(JSON.parse(calls[0].input ?? ""), {
    name: "Fleet",
    url: bot.url,
    key: secret,
  });
});

test("add failures hide sender output and invalid input never reaches the sender", async () => {
  await assert.rejects(
    new Sender(async () => ({ code: 1, stdout: secret })).add(bot),
    (error: Error) =>
      !error.message.includes(secret) && /not changed/.test(error.message),
  );
  await assert.rejects(
    new Sender(async () => {
      throw new Error(secret);
    }).add(bot),
    (error: Error) => !error.message.includes(secret),
  );
  let called = false;
  await assert.rejects(
    new Sender(async () => {
      called = true;
      return { code: 0, stdout: "" };
    }).add({ ...bot, url: "https://example.com/automations/webhook/x" }),
  );
  assert.equal(called, false);
});

test("form validation names each bad field without echoing credentials", () => {
  assert.deepEqual(validateNewBot(bot), {});
  assert.deepEqual(Object.keys(validateNewBot(bot, ["fleet"])), ["alias"]);
  const errors = validateNewBot({
    alias: "Fleet Bot",
    name: " ",
    url: `http://api2.cursor.sh/automations/webhook/x?k=${secret}`,
    key: `Bearer ${secret}`,
  });
  assert.deepEqual(Object.keys(errors).sort(), ["alias", "key", "name", "url"]);
  assert.ok(Object.values(errors).every((text) => !text?.includes(secret)));
  for (const url of [
    "https://api2.cursor.sh.evil.test/automations/webhook/x",
    "https://user:pass@api2.cursor.sh/automations/webhook/x",
    "https://api2.cursor.sh:8443/automations/webhook/x",
    "https://api2.cursor.sh/automations/webhook/x#frag",
    "https://api2.cursor.sh/other/x",
    "not a url",
  ])
    assert.ok(validateNewBot({ ...bot, url }).url, url);
  assert.ok(validateNewBot({ ...bot, key: "two words" }).key);
  assert.ok(validateNewBot({ ...bot, key: "" }).key);
});

test("alias suggestions follow the sender's alias rules", () => {
  assert.equal(suggestAlias("Chief of Staff"), "chief-of-staff");
  assert.equal(suggestAlias("  Fleet! "), "fleet");
  assert.equal(suggestAlias("Ünïcode Bot 2"), "n-code-bot-2");
  assert.equal(suggestAlias("!!!"), "");
  const long = suggestAlias(`${"a".repeat(47)} b`);
  assert.equal(long, "a".repeat(47));
  assert.deepEqual(validateNewBot({ ...bot, alias: long }), {});
});

test("the bundled sender saves a Bot added from Raycast and refuses a duplicate", async () => {
  const home = await mkdtemp(join(tmpdir(), "raycast-grok-add-"));
  try {
    const executable = join(home, "grok-bots");
    const cli = resolve(__dirname, "../cli/grok-bots.ts");
    await writeFile(
      executable,
      `#!/bin/sh\nHOME='${home}' exec '${process.execPath}' '${cli}' "$@"\n`,
    );
    await chmod(executable, 0o700);
    const sender = new Sender((args, input) => runCli(args, input, executable));
    await sender.add(bot);
    assert.deepEqual(await sender.list(), [{ alias: "fleet", name: "Fleet" }]);
    const config = join(home, ".config", "grok-bots", "config.json");
    assert.equal((await stat(config)).mode & 0o777, 0o600);
    assert.equal(
      JSON.parse(await readFile(config, "utf8")).bots.fleet.key,
      secret,
    );
    await assert.rejects(sender.add({ ...bot, key: "replacement" }));
    assert.equal(
      JSON.parse(await readFile(config, "utf8")).bots.fleet.key,
      secret,
    );
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
