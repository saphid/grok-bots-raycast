import {
  Action,
  ActionPanel,
  Color,
  closeMainWindow,
  Detail,
  Form,
  Icon,
  List,
  LocalStorage,
  Toast,
  open,
  showToast,
  useNavigation,
  Keyboard,
} from "@raycast/api";
import { homedir } from "node:os";
import { join } from "node:path";
import { useEffect, useRef, useState } from "react";
import { deliver, loadHistory, saveReceipt, Storage } from "./history";
import { Bot, createRequest, Receipt, Sender, validateMessage } from "./sender";
import { parseComposeQuery } from "./compose-query";
import { AddBotForm } from "./add-bot";

async function openBot() {
  try {
    await open(join(homedir(), "Applications", "Grok Bot.app"));
    await closeMainWindow();
  } catch {
    await showToast({
      style: Toast.Style.Failure,
      title: "Could not open Grok Bot",
      message: "Open the installed app from your Applications folder.",
    });
  }
}

const sender = new Sender();
const storage: Storage = {
  getItem: (key) => LocalStorage.getItem<string>(key),
  setItem: (key, value) => LocalStorage.setItem(key, value),
};
const states = {
  accepted: {
    title: "Message accepted",
    label: "Accepted",
    color: Color.Green,
    icon: Icon.CheckCircle,
    text: "Your message was accepted for delivery. The Bot may still be processing it.",
    next: "Open Grok Bot to read the reply.",
  },
  rejected: {
    title: "Message rejected",
    label: "Rejected",
    color: Color.Red,
    icon: Icon.XMarkCircle,
    text: "The webhook rejected this message. No automatic retry was made.",
    next: "Check this Bot’s routine in Grok Bot and the existing sender setup in your terminal before composing a new message.",
  },
  unknown: {
    title: "Check before sending again",
    label: "Unknown",
    color: Color.Orange,
    icon: Icon.QuestionMarkCircle,
    text: "This message may have arrived, but delivery couldn’t be confirmed.",
    next: "Check the Bot’s conversation first. Keep this request ID and check its receipt without resending.",
  },
};

function ReceiptView({
  initial,
  bots,
  onUpdate,
}: {
  initial: Receipt;
  bots: Bot[];
  onUpdate: () => Promise<void>;
}) {
  const { pop } = useNavigation();
  const [receipt, setReceipt] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [details, setDetails] = useState(initial.status === "unknown");
  const refreshing = useRef(false);
  const state = states[receipt.status];
  const name =
    bots.find((bot) => bot.alias === receipt.bot)?.name ?? receipt.bot;
  async function refresh() {
    if (refreshing.current) return;
    refreshing.current = true;
    setBusy(true);
    try {
      const next = await sender.status(receipt);
      await saveReceipt(storage, next);
      setReceipt(next);
      await onUpdate().catch(() => {});
      await showToast({
        style: Toast.Style.Success,
        title: "Receipt checked",
        message: "No message was resent.",
      });
    } catch {
      await showToast({
        style: Toast.Style.Failure,
        title: "Receipt unavailable",
        message:
          "Last known state kept. Check the Bot’s conversation before resending.",
      });
    } finally {
      refreshing.current = false;
      setBusy(false);
    }
  }
  return (
    <Detail
      navigationTitle={`${name} · ${state.label}`}
      isLoading={busy}
      markdown={`# ${state.title}\n\n${state.text}\n\n${state.next}${details ? `\n\n---\n\n**Request ID**\n\n\`${receipt.requestId}\`\n\n${receipt.httpStatus ? `HTTP ${receipt.httpStatus} · ` : ""}This is a delivery receipt, not the Bot’s answer.` : ""}`}
      metadata={
        <Detail.Metadata>
          <Detail.Metadata.Label title="To" text={name} icon={Icon.Message} />
          <Detail.Metadata.TagList title="Delivery">
            <Detail.Metadata.TagList.Item
              text={state.label}
              color={state.color}
              icon={state.icon}
            />
          </Detail.Metadata.TagList>
          <Detail.Metadata.Separator />
          <Detail.Metadata.Label
            title="Submitted"
            text={new Date(receipt.createdAt).toLocaleString(undefined, {
              dateStyle: "medium",
              timeStyle: "short",
            })}
          />
          <Detail.Metadata.Label title="Conversation" text="Grok Bot" />
        </Detail.Metadata>
      }
      actions={
        <ActionPanel>
          <ActionPanel.Section>
            <Action
              title="Open Grok Bot"
              icon={Icon.Message}
              onAction={openBot}
            />
            <Action
              title={busy ? "Checking Receipt…" : "Check Delivery Receipt"}
              icon={Icon.ArrowClockwise}
              shortcut={Keyboard.Shortcut.Common.Refresh}
              onAction={refresh}
            />
          </ActionPanel.Section>
          <ActionPanel.Section title="Receipt">
            <Action
              title={
                details ? "Hide Delivery Details" : "Show Delivery Details"
              }
              icon={Icon.Info}
              shortcut={{ modifiers: ["cmd"], key: "d" }}
              onAction={() => setDetails(!details)}
            />
            <Action.CopyToClipboard
              title="Copy Request ID"
              content={receipt.requestId}
              shortcut={Keyboard.Shortcut.Common.Copy}
            />
          </ActionPanel.Section>
          <ActionPanel.Section>
            <Action
              title="Back to Bots"
              icon={Icon.ArrowLeft}
              shortcut={Keyboard.Shortcut.Common.New}
              onAction={pop}
            />
          </ActionPanel.Section>
        </ActionPanel>
      }
    />
  );
}

function Compose({
  bots,
  initialBot,
  initialMessage = "",
  onUpdate,
}: {
  bots: Bot[];
  initialBot: Bot;
  initialMessage?: string;
  onUpdate: () => Promise<void>;
}) {
  const sending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [botAlias, setBotAlias] = useState(initialBot.alias);
  const [messageBytes, setMessageBytes] = useState(
    Buffer.byteLength(initialMessage, "utf8"),
  );
  const [result, setResult] = useState<Receipt>();
  const selectedBot = bots.find((bot) => bot.alias === botAlias) ?? initialBot;

  async function submit(values: { bot: string; message: string }) {
    if (sending.current) return;
    const problem = validateMessage(values.message);
    if (problem) {
      setError(problem);
      return;
    }
    if (!bots.some((bot) => bot.alias === values.bot)) return;
    sending.current = true;
    setBusy(true);
    const pending = createRequest(values.bot);
    try {
      const receipt = await deliver(
        storage,
        pending,
        values.message,
        (request, message) => sender.send(request, message),
      );
      // Replace the form with its result. Back returns straight to the Bot list.
      // A summary reload must never hide the receipt or leave a spent form.
      setResult(receipt);
    } catch {
      // Keep the original ID visible even if the journal could not be read.
      setResult(pending);
    } finally {
      setBusy(false);
      await onUpdate().catch(() => {});
    }
  }

  if (result)
    return <ReceiptView initial={result} bots={bots} onUpdate={onUpdate} />;
  return (
    <Form
      navigationTitle={`Message ${selectedBot.name}`}
      isLoading={busy}
      enableDrafts={false}
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title={busy ? "Sending…" : `Send to ${selectedBot.name}`}
            icon={Icon.ArrowUp}
            onSubmit={submit}
          />
        </ActionPanel>
      }
    >
      <Form.Dropdown
        id="bot"
        title="To"
        value={botAlias}
        onChange={setBotAlias}
        storeValue={false}
      >
        {bots.map((bot) => (
          <Form.Dropdown.Item
            key={bot.alias}
            value={bot.alias}
            title={bot.name}
            icon={Icon.Message}
          />
        ))}
      </Form.Dropdown>
      <Form.TextArea
        id="message"
        title="Message"
        placeholder={`What would you like to tell ${selectedBot.name}?`}
        defaultValue={initialMessage}
        autoFocus
        storeValue={false}
        error={error}
        onChange={(value) => {
          setError(undefined);
          setMessageBytes(Buffer.byteLength(value, "utf8"));
        }}
      />
      {messageBytes > 28_000 && (
        <Form.Description
          title="Length"
          text={`${messageBytes.toLocaleString()} / 32,000 bytes`}
        />
      )}
      <Form.Description
        text={
          busy
            ? `Sending to ${selectedBot.name}… Please wait for the delivery receipt.`
            : "Messages aren’t saved. Replies appear in Grok Bot."
        }
      />
    </Form>
  );
}

export default function Command() {
  const { push, pop } = useNavigation();
  const [bots, setBots] = useState<Bot[]>([]);
  const [history, setHistory] = useState<Receipt[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string>();
  const [selectedId, setSelectedId] = useState<string>();
  const [searchText, setSearchText] = useState("");
  const draft = parseComposeQuery(searchText, bots);
  const reloadHistory = async () => setHistory(await loadHistory(storage));
  async function load() {
    setBusy(true);
    setError(undefined);
    try {
      const receipts = await loadHistory(storage);
      setHistory(receipts);
      const configured = await sender.list();
      setBots(configured);
      const attention = receipts.find(
        (receipt) => receipt.status !== "accepted",
      );
      setSelectedId(
        attention?.requestId ?? (configured[0] && `bot-${configured[0].alias}`),
      );
    } catch {
      setBots([]);
      setError(
        "Check ~/.local/bin/grok-bots and delivery history in your terminal, then reload. Private diagnostics stay hidden.",
      );
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  function addBot() {
    push(
      <AddBotForm
        existingAliases={bots.map((bot) => bot.alias)}
        onAdded={async () => {
          pop();
          setSearchText("");
          await load();
        }}
      />,
    );
  }
  const addBotAction = (
    <Action
      title="Add Bot"
      icon={Icon.Plus}
      shortcut={Keyboard.Shortcut.Common.New}
      onAction={addBot}
    />
  );

  function receiptRow(receipt: Receipt) {
    const state = states[receipt.status];
    const name =
      bots.find((bot) => bot.alias === receipt.bot)?.name ?? receipt.bot;
    const label = {
      accepted: "Accepted",
      rejected: "Rejected",
      unknown: "Unknown",
    }[receipt.status];
    return (
      <List.Item
        id={receipt.requestId}
        key={receipt.requestId}
        title={name}
        subtitle={
          receipt.status === "unknown"
            ? "Check conversation before resending"
            : undefined
        }
        keywords={[
          receipt.requestId,
          receipt.bot,
          receipt.status,
          "receipt",
          "history",
        ]}
        icon={{ source: state.icon, tintColor: state.color }}
        accessories={[
          { tag: { value: label, color: state.color } },
          {
            date: new Date(receipt.createdAt),
            tooltip: `${new Date(receipt.createdAt).toLocaleString()} · ${receipt.requestId}`,
          },
        ]}
        actions={
          <ActionPanel>
            <Action
              title="View Delivery"
              icon={Icon.Document}
              onAction={() =>
                push(
                  <ReceiptView
                    initial={receipt}
                    bots={bots}
                    onUpdate={reloadHistory}
                  />,
                )
              }
            />
            <Action
              title="Open Grok Bot"
              icon={Icon.Message}
              onAction={openBot}
            />
            <Action.CopyToClipboard
              title="Copy Request ID"
              content={receipt.requestId}
            />
            <Action
              title="Reload Bots and History"
              icon={Icon.ArrowClockwise}
              shortcut={Keyboard.Shortcut.Common.Refresh}
              onAction={load}
            />
          </ActionPanel>
        }
      />
    );
  }
  return (
    <List
      isLoading={busy}
      navigationTitle="Grok Bots"
      searchBarPlaceholder="Choose a Bot, or type fleet <message>…"
      searchText={searchText}
      onSearchTextChange={(text) => {
        setSearchText(text);
        setSelectedId(undefined);
      }}
      filtering={!draft}
      selectedItemId={draft ? `bot-${draft.bot.alias}` : selectedId}
      onSelectionChange={(id) => setSelectedId(id ?? undefined)}
    >
      {error && (
        <List.Section title="Connection">
          <List.Item
            id="sender-error"
            title="Sender unavailable"
            subtitle="Reload to reconnect"
            icon={{ source: Icon.ExclamationMark, tintColor: Color.Orange }}
            actions={
              <ActionPanel>
                <Action
                  title="Reload Bots and History"
                  icon={Icon.ArrowClockwise}
                  onAction={load}
                />
                <Action
                  title="Show Setup Help"
                  icon={Icon.Info}
                  onAction={() =>
                    push(
                      <Detail
                        markdown={`# Check the Mac sender\n\n${error}`}
                      />,
                    )
                  }
                />
              </ActionPanel>
            }
          />
        </List.Section>
      )}
      <List.Section title="Needs attention">
        {!draft &&
          history
            .filter((receipt) => receipt.status !== "accepted")
            .map(receiptRow)}
      </List.Section>
      <List.Section title="Message a Bot">
        {(draft ? [draft.bot] : bots).map((bot) => (
          <List.Item
            id={`bot-${bot.alias}`}
            key={bot.alias}
            title={bot.name}
            subtitle={
              draft ? "Review typed message, then send" : "Write a message"
            }
            keywords={[bot.alias, "new", "compose", "send"]}
            icon={{ source: Icon.Message, tintColor: Color.Blue }}
            actions={
              <ActionPanel>
                <Action
                  title={`Message ${bot.name}`}
                  icon={Icon.Pencil}
                  onAction={() => {
                    push(
                      <Compose
                        bots={bots}
                        initialBot={bot}
                        initialMessage={draft?.message}
                        onUpdate={reloadHistory}
                      />,
                    );
                    setSearchText("");
                  }}
                />
                <Action
                  title="Open Grok Bot"
                  icon={Icon.Message}
                  onAction={openBot}
                />
                {addBotAction}
                <Action
                  title="Reload Bots and History"
                  icon={Icon.ArrowClockwise}
                  shortcut={Keyboard.Shortcut.Common.Refresh}
                  onAction={load}
                />
              </ActionPanel>
            }
          />
        ))}
      </List.Section>
      <List.Section
        title="Recent deliveries"
        subtitle="Message text isn’t saved"
      >
        {!draft &&
          history
            .filter((receipt) => receipt.status === "accepted")
            .map(receiptRow)}
      </List.Section>
      {!busy && !error && (
        <List.EmptyView
          title={
            bots.length === 0 && history.length === 0
              ? "No Bots configured"
              : "No matching Bots or deliveries"
          }
          description={
            bots.length === 0 && history.length === 0
              ? "Add a Bot with its webhook routine’s URL and key."
              : "Clear your search to choose a Bot, or type a configured alias followed by your message."
          }
          icon={Icon.Message}
          actions={
            <ActionPanel>
              {bots.length === 0 && !searchText && addBotAction}
              <Action
                title={searchText ? "Clear Search" : "Reload Bots"}
                icon={Icon.ArrowClockwise}
                onAction={searchText ? () => setSearchText("") : load}
              />
            </ActionPanel>
          }
        />
      )}
    </List>
  );
}
