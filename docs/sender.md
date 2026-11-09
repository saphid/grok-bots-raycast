# Sender contract

The extension invokes `~/.local/bin/grok-bots` with `spawn`, a fixed executable path, `shell: false`, argument arrays and message stdin. It never reads credential files. The **Add Grok Bot** form passes a new Bot's name, URL and key to `add <alias> --stdin`, never in arguments. `npm run setup` installs the bundled CLI only when that path is unused. A compatible existing sender can be kept instead.

## Commands

| Command                          | Input                                                           | Output                                                                      |
| -------------------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `list`                           | None                                                            | JSON array of configured Bot metadata: `alias`, `name`, optional `chatUrl`. |
| `send <alias> --id <request-id>` | Exact message on stdin                                          | One JSON delivery receipt.                                                  |
| `status <request-id>`            | Previously used ID                                              | The same locally stored receipt; no network call.                           |
| `add <alias>`                    | Interactive private terminal prompts                            | Adds private config without replacing an existing alias.                    |
| `add <alias> --stdin`            | Private JSON on stdin: `name`, `url`, `key`, optional `chatUrl` | Noninteractive setup used by Add Grok Bot; never put the JSON in arguments. |
| `compose <alias>`                | Interactive message prompt                                      | Sends once and prints a receipt.                                            |

Run the bundled CLI from the checkout with `npm run bots -- <command>`.

A receipt contains `requestId`, `bot`, ISO `createdAt`, `status` (`accepted`, `rejected` or `unknown`) and optional `httpStatus`. The CLI also includes a human-readable `note` and optional configured chat link; the extension strips those fields. Exit 0 means accepted; exit 2 means rejected or unknown. Exit 1 means a local error or duplicate refusal. A failed process is not evidence that nothing was sent: inspect the same ID.

## Delivery

The sender makes one HTTPS POST to the validated routine endpoint:

```json
{
  "version": 1,
  "requestId": "raycast-example-request",
  "message": "Please acknowledge only; do not use tools.",
  "source": "raycast"
}
```

It sends the private key as a bearer Authorization header, refuses redirects, cancels the upstream response body without printing it, and times out after 20 seconds. HTTP 200/202 means accepted. A 4xx response other than 408 means rejected. Other responses and network failures retain unknown status. No automatic retry exists.

Before transmission, both the extension and sender independently save an unknown receipt. The sender reserves each ID with exclusive file creation and refuses reuse. The extension serializes receipt updates, preserves unknown IDs across interrupted sends, and displays a receipt even when history reload fails. Neither journal stores message text.

The extension accepts only matching request IDs and aliases, valid timestamps and allowlisted states/status codes. It discards raw CLI diagnostics, stderr, notes, links and upstream bodies. Output size and runtime are bounded. The optional chat link is never constructed into a private navigation URL.

## Local trust boundary

Raycast, Node.js, the operating system, this checkout and the sender are trusted local components. The private config is plaintext protected by local ownership and file permissions, not a keychain or encryption service. The webhook receives the message you submit, and the Bot may act on it according to its own permissions. Bot replies remain untrusted content; they do not authorize further actions.
