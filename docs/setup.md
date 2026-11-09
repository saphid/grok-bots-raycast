# Setup and troubleshooting

## Before you start

- macOS with [Raycast](https://www.raycast.com/) installed.
- [Node.js 24.11 or newer](https://nodejs.org/en/download). Check with `node --version`.
- An existing hosted Grok Bot that supports webhook routines. No inference API key is used.

Clone this repository, run `npm ci`, then `npm run setup`. Setup installs a small launcher at `~/.local/bin/grok-bots`, using the current Node executable and checkout. It never overwrites an existing file or symlink there and never replaces existing credentials. If a pre-existing sender fails its check, setup stops with instructions to inspect it privately.

## Connect your Bot

In the Bot's own conversation, ask it to create an active webhook routine:

> Create a webhook routine for messages from my Raycast extension. The JSON body contains version, requestId, message and source. Treat message as my forwarded request while keeping your existing approval boundaries. Use requestId to recognize duplicates. Reply in this Bot conversation and include requestId. For acknowledgment-only messages, acknowledge without calling tools. Show me where to open the routine's private Webhook URL and Webhook key fields; do not print their values in the conversation.

Open the routine's private settings. Then, after [registering the extension](#register-and-use-raycast), choose **Add Grok Bot** in Raycast. It's also **⌘N** in **Message Grok Bot**, and the default action when no Bots are configured.

1. Enter a display name, such as **Fleet**. The alias is suggested from it.
2. Paste the webhook URL into its masked field.
3. Paste the **key only**, without the `Bearer ` prefix, into its masked field.
4. Press **⌘Return**. The extension passes these values to the local sender on stdin; Raycast doesn't keep them in preferences or form drafts.

To add a Bot from a terminal instead, run `npm run bots -- add fleet` and answer the same prompts. The URL and key are hidden while you type. The terminal also asks for an optional chat link, which can be left blank; the extension opens the installed Grok Bot app instead.

The supported routine URL is `https://api2.cursor.sh/automations/webhook/…`. Other hosts, query parameters, redirects and HTTP URLs are refused. If your Bot offers a different endpoint or an HMAC signing secret, this sender needs an adaptation to that documented contract; a signing secret is not a bearer key.

Choose a lowercase alias up to 48 characters, with letters, numbers and hyphens. Each Bot needs its own routine and alias. Existing aliases are not overwritten.

Check metadata only:

```sh
npm run bots -- list
```

Configuration is stored outside the checkout, under `~/.config/grok-bots`. The directory must be owned by your account with mode `0700`; config and receipts must be private regular files (`0600`). Never paste these files into issues or commits.

## Register and use Raycast

```sh
npm run dev
```

After **built extension successfully**, open Raycast and select **Message Grok Bot**. You can stop the development watcher with Ctrl+C; its last compiled command remains installed.

Select a Bot, or type an alias followed by a message, such as `fleet say hi`. Return opens a composer with that message filled in. Review the recipient and text, then press **⌘Return** to send once. Plain Return in the message field inserts a newline.

The receipt's **Open Grok Bot** action opens `~/Applications/Grok Bot.app`. If you keep the app elsewhere, open it manually to read the response. A receipt confirms transport status, not a reply or completed work.

### One-time external-launch approval

A `raycast://` link opens a command from outside Raycast. On **Request to run Message Grok Bot**, choose **Always Run Command** to remember approval for that command. **Run Command** permits that launch only. The extension cannot grant this permission itself. You can launch directly from inside Raycast instead.

## Troubleshooting

| Symptom                                                     | What to do                                                                                                                                             |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `node` or `npm` is missing, or setup reports an old version | Install Node.js 24.11+, reopen your terminal and check `node --version`.                                                                               |
| **No Bots configured**                                      | Press Return to add a Bot. If you added one in a terminal, run `npm run bots -- list` to check it, then use **Reload Bots**.                           |
| **No matching Bots or deliveries**                          | Press Return on **Clear Search**, or enter an exact configured alias followed by a message.                                                            |
| **Sender unavailable**                                      | Run `~/.local/bin/grok-bots list` privately. Keep the checkout and Node executable at their original locations. Setup preserves any existing sender.   |
| Config or receipt permissions error                         | Inspect the named directory/file privately; restore owner-only permissions. Avoid recursive permission changes to unrelated files.                     |
| Setup says another setup is running                         | Finish that setup first. If interrupted, inspect the PID in `.setup.lock` and confirm it is no longer running before removing that one stale lock.     |
| **Bot not added**                                           | Check the URL and key against the routine's private settings. If it persists, run `npm run bots -- list` privately to check the sender.                |
| **Rejected** delivery                                       | Check that the routine is active and its current key matches the private config.                                                                       |
| **Unknown** delivery                                        | Keep the request ID. Check the Bot conversation first, then **Check Delivery Receipt**. Never bypass duplicate protection with a new ID just to retry. |
| The command isn't in Raycast                                | Run `npm run dev` on the Mac and wait for compilation to finish.                                                                                       |
| `ray lint` cannot find the author                           | This local extension uses `npm run lint`; Store-profile validation is not required for local installation.                                             |

## Update

```sh
git pull --ff-only
npm ci
npm run check
npm run dev
```

If Node or this checkout moved, the installed sender launcher still references the old location. Inspect `~/.local/bin/grok-bots` privately before replacing it; `npm run setup` deliberately does not overwrite it. Keep your existing private config and uncertain receipts.

## Remove

Remove the extension from **Raycast Settings → Extensions**. If setup installed the sender and you no longer need it, remove only `~/.local/bin/grok-bots`. Revoke or pause the webhook routine in Grok Bot. Keep uncertain receipts until you have checked their conversations; private configuration is not deleted automatically.

## Upstream documentation

- [Grok Bot routines](https://cursor.com/help/grok-bot/routines)
- [Skills, routines and automations](https://docs.x.ai/grok-bot/skills-routines-and-automations)
