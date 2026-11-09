import {
  Action,
  ActionPanel,
  Form,
  Icon,
  LaunchType,
  Toast,
  launchCommand,
  showToast,
} from "@raycast/api";
import { useEffect, useRef, useState } from "react";
import {
  Bot,
  NewBot,
  NewBotErrors,
  Sender,
  suggestAlias,
  validateNewBot,
} from "./sender";

const sender = new Sender();

export function AddBotForm({
  existingAliases,
  onAdded,
}: {
  existingAliases?: string[];
  onAdded: (bot: Bot) => Promise<void>;
}) {
  const saving = useRef(false);
  const [busy, setBusy] = useState(false);
  const [known, setKnown] = useState(existingAliases ?? []);
  const [errors, setErrors] = useState<NewBotErrors>({});
  const [name, setName] = useState("");
  const [alias, setAlias] = useState("");
  const [aliasEdited, setAliasEdited] = useState(false);

  useEffect(() => {
    if (existingAliases) return;
    sender
      .list()
      .then((bots) => setKnown(bots.map((bot) => bot.alias)))
      .catch(() => {
        /* The sender still refuses existing aliases on save. */
      });
  }, []);

  function clear(field: keyof NewBot) {
    if (errors[field]) setErrors({ ...errors, [field]: undefined });
  }

  async function submit(values: { url: string; key: string }) {
    if (saving.current) return;
    const bot: NewBot = { alias, name, url: values.url, key: values.key };
    const problems = validateNewBot(bot, known);
    setErrors(problems);
    if (Object.keys(problems).length) return;
    saving.current = true;
    setBusy(true);
    try {
      await sender.add(bot);
      await showToast({
        style: Toast.Style.Success,
        title: `Added ${bot.name.trim()}`,
        message: `Type ${bot.alias} followed by a message to send.`,
      });
      await onAdded({ alias: bot.alias, name: bot.name.trim() });
    } catch (error) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Bot not added",
        message: error instanceof Error ? error.message : undefined,
      });
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }

  return (
    <Form
      navigationTitle="Add Grok Bot"
      isLoading={busy}
      enableDrafts={false}
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title={busy ? "Adding…" : "Add Bot"}
            icon={Icon.Plus}
            onSubmit={submit}
          />
        </ActionPanel>
      }
    >
      <Form.Description text="Ask your Bot to create a webhook routine, then copy its URL and key from the routine’s private settings." />
      <Form.TextField
        id="name"
        title="Name"
        placeholder="Fleet"
        autoFocus
        storeValue={false}
        value={name}
        error={errors.name}
        onChange={(value) => {
          setName(value);
          clear("name");
          if (!aliasEdited) setAlias(suggestAlias(value));
        }}
      />
      <Form.TextField
        id="alias"
        title="Alias"
        placeholder="fleet"
        info="Type the alias before a message to compose quickly, like “fleet say hi”."
        storeValue={false}
        value={alias}
        error={errors.alias}
        onChange={(value) => {
          setAlias(value);
          setAliasEdited(true);
          clear("alias");
        }}
      />
      <Form.PasswordField
        id="url"
        title="Webhook URL"
        placeholder="https://api2.cursor.sh/automations/webhook/…"
        storeValue={false}
        error={errors.url}
        onChange={() => clear("url")}
      />
      <Form.PasswordField
        id="key"
        title="Webhook Key"
        placeholder="Key only, without Bearer"
        storeValue={false}
        error={errors.key}
        onChange={() => clear("key")}
      />
      <Form.Description text="Saved by the local sender in ~/.config/grok-bots with owner-only permissions. Raycast doesn’t store the URL or key." />
    </Form>
  );
}

export default function Command() {
  return (
    <AddBotForm
      onAdded={() =>
        launchCommand({
          name: "send-message",
          type: LaunchType.UserInitiated,
        })
      }
    />
  );
}
