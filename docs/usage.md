# Using Familiar

Linux, macOS and WSL:

```sh
curl -fsSL https://github.com/AidanZealley/familiar/releases/latest/download/install.sh | sh
```

Windows PowerShell:

```powershell
irm https://github.com/AidanZealley/familiar/releases/latest/download/install.ps1 | iex
```

The installer reuses Node 24.19 or newer, or downloads the official Node 24.19.0 binary for x64 or arm64 into your home directory and checks its SHA-256 checksum. It installs the release package without administrator access, saves PATH for new terminals, then starts guided setup. Setup installs the full local assistant, including its web UI and background service.

To read the script first, download `install.sh` or `install.ps1` from the release, inspect it, then run `sh install.sh` or `powershell -ExecutionPolicy Bypass -File .\install.ps1`.

Set `FAMILIAR_VERSION=v1.2.3` to choose a specific release tag, and `FAMILIAR_NO_SETUP=1` to install the command without starting setup. For example, after downloading the script:

```sh
FAMILIAR_VERSION=v1.2.3 FAMILIAR_NO_SETUP=1 sh install.sh
familiar
```

On Windows, set `$env:FAMILIAR_VERSION = 'v1.2.3'` and `$env:FAMILIAR_NO_SETUP = '1'` before running the script. If setup is interrupted, run `familiar` to resume. Only one Familiar is managed per user; an existing installation's settings and history are reused.

If you sign in on a different device from this machine, the browser's redirect to `127.0.0.1:1455` won't arrive. Paste the URL it ended on into the terminal instead.

On Linux the systemd user service can run while logged out. On macOS and Windows it starts at user login. The API and web UI listen on `127.0.0.1:4317`; setup prints the local URL and publishes a private Tailscale HTTPS URL when available.

Setup publishes a private HTTPS URL when Tailscale is installed and signed in. To configure it manually:

```sh
sudo tailscale serve --bg --https=10000 http://127.0.0.1:4317
```

Then open `https://<machine>.<tailnet>.ts.net:10000` and add it to your home screen.

Ask Familiar for reminders and anything regular in chat ("remind me at 6 to call Mum", "every weekday at 7, brief me on my day"). Each one runs at its time in the conversation, and its reply arrives as a notification on every device you enabled with **Enable** on the Schedules page:

- **iPhone:** only from the home-screen app, iOS 16.4 or later.
- **Brave on macOS:** turn on "Use Google services for push messaging" in `brave://settings/privacy`, and allow Brave in System Settings → Notifications.

### Guided setup

After installing a release package, run `familiar` to save settings, sign in with ChatGPT, install the background service and print its URLs. Service setup uses systemd on Linux, a LaunchAgent on macOS, and a Scheduled Task on Windows. macOS and Windows start at user login; Linux can run while logged out. Windows falls back to a Startup shortcut if task registration fails, with no automatic crash recovery in that mode. From a source checkout, build the UI with `pnpm build`, then run `node apps/daemon/src/cli.ts` for the same setup.

Setup reuses existing settings and login. Desktop sign-in opens the browser; over SSH or without a display, open the printed link on another device and paste the full URL the browser redirects to. The pinned Pi version has no device-code login. If a saved login stops working, run `familiar sign-in`, or sign in again from the web UI.

The web UI signs in from any device, without a restart: whenever Familiar isn't signed in, or its login stops working, the chat walks you through ChatGPT's sign-in. Its last page returns to this machine, so on another device it won't load; the chat asks you to paste that page's address. Settings signs out.

- `familiar status` shows the saved name, managed service state and local and existing tailnet URLs.
- `familiar rename` prompts for a new name; `familiar rename Willow` changes it directly. Renaming preserves other settings and restarts a running service.
- `familiar logs` follows the service output.
- `familiar update` updates an installed release and resumes its service if it was running. Run `familiar` after an update to apply service configuration changes. Source checkouts use git and `pnpm service:install`.
- `familiar uninstall` removes the service and its Tailscale publication, keeping the data directory.

Setup publishes through Tailscale when available. It preserves existing routes and refuses public Funnel access on Familiar's port. When permissions prevent setup or logged-out operation, it prints the command to run before repeating setup.

## Settings

Familiar reads `settings.json` from its data directory. Saved `name`, `owner`, `model` and `port` values override defaults; environment variables override saved values. Setup saves the chosen name and explicit environment overrides for the service, leaving other defaults free to change with later releases.

| Variable                | Default                       |                                                           |
| ----------------------- | ----------------------------- | --------------------------------------------------------- |
| `FAMILIAR_MODEL`        | `gpt-6.1-sol`                 | Memory upkeep's model, and the chat's first; see below    |
| `FAMILIAR_NAME`         | `Familiar`                    | What the assistant calls itself                           |
| `FAMILIAR_OWNER`        | `owner`                       | The author the model sees on your messages                |
| `FAMILIAR_PORT`         | `4317`                        |                                                           |
| `FAMILIAR_HOST`         | `127.0.0.1`                   |                                                           |
| `FAMILIAR_DATA_DIR`     | `~/.local/share/familiar`     | Or `$XDG_DATA_HOME/familiar`                              |
| `FAMILIAR_PUSH_CONTACT` | `mailto:familiar@example.com` | Sent to push services with notifications                  |
| `FAMILIAR_PLUGINS`      | (none)                        | Extra plugins, comma-separated packages or absolute paths |

The chat's model and reasoning level are picked in the composer, saved with the conversation and shared by every device. The models offered, and the level each starts on, are `chatModels` in `apps/daemon/src/config.ts`; `FAMILIAR_MODEL` must be one of them. It sets the chat's model only until one is picked, and the level a model was last set to is kept for when you switch back. Memory upkeep always runs on `FAMILIAR_MODEL` at its default level.

Dates, reminders and the 04:00 memory pass follow the machine's time zone, read once when the daemon starts. Node honours `TZ`, so a service can be given another zone with `TZ=America/New_York`. Restart after travelling or changing the zone; [how Familiar handles a change](architecture.md#changing-zone) explains what moves and what stays.

The Pi packages are pinned to exact versions in `pnpm-workspace.yaml`'s catalog: their API changes without notice between releases.

## Reading web pages

`web_fetch` reads public HTTP(S) pages as Markdown or plain text. It uses the host's fetch, without a service key or browser automation. Markdown is requested first; HTML is converted by `@mdream/js`, which handles parsing, links, tables and common navigation filtering. Familiar does not implement its own HTML parser, article scoring or Markdown rules. PDFs and images are unsupported.

Reads stop with an error above 3 MB or after 15 seconds, including body reading and conversion. Output defaults to 12,000 characters, at most 30,000, with a truncation marker. Text uses the declared HTTP charset through `TextDecoder`, otherwise UTF-8; HTML meta-charset sniffing is deliberately omitted.

The plugin uses portable JavaScript and Web APIs. Its default HTML conversion runs in the host's thread, suitable for a Worker with platform CPU limits. Hosts without an interruptible per-request CPU limit should pass `webPlugin({ convert })`. The Node daemon uses Piscina: at most two conversions run, eight may wait, worker old-generation heaps are limited to 128 MB, and the request's abort signal stops the conversion worker. These Node dependencies stay in the daemon.

Fetched text is untrusted. Network filtering prevents private-network requests, but does not stop prompt injection or the model putting private information into a public URL. Pages are not made trustworthy by converting them to Markdown.

## MCP connections

Hosts can manage MCP servers through `familiar.mcp.add({ name, transport })`, `remove(name)` and `reconnect(name)`. An HTTP transport is `{ type: 'http', url, auth: { type: 'none' | 'bearer' } }`. A local process uses `{ type: 'stdio', command, args }`, with an executable and an argument array. The equivalent owner routes live under `/api/mcp`; bearer tokens use the write-only Connections routes at `/api/connections/mcp/:name/secrets/token`. The Connections page does the same: it adds, removes and reconnects servers, sets bearer tokens and shows each server's status and tools. A server's name and transport are fixed, so changing either means removing it and adding it again.

Declarations persist with the conversation, while tokens stay in the host's secret store. `familiar.connections.list()` includes runtime status and discovered tools. Servers connect independently, so an unavailable server does not block chat. Tools load through Pi's `tool_search`; failed calls are never replayed automatically. Reconnect restores an expired session for subsequent calls.

The host supplies `mcpFetch` separately from plugins' `fetch`. The daemon allows localhost, LAN and tailnet addresses for these owner-configured endpoints. Requests and bearer credentials are restricted to that exact endpoint, and redirects fail. Existing web search/fetch restrictions are unchanged. Core retains portable imports; Cloudflare runtime testing is deferred.

The daemon also supplies `mcpStdio`, a small factory for the SDK's `StdioClientTransport`. Core never imports subprocess code. Commands run directly without a shell; relative paths use the daemon's working directory, so prefer absolute paths for scripts. The SDK inherits a limited environment such as PATH and HOME, excluding Familiar's configuration, provider-token variables and NODE_OPTIONS. It handles stdin/stdout, shutdown and process termination. Process exit removes the tools and reports `disconnected`; Reconnect starts a fresh process. Hosts without this factory report stdio servers as unsupported.

Local MCP programs are trusted owner-installed code running as the daemon's user. The filtered environment is not a filesystem sandbox. Stdio servers have no bearer-token field or custom environment settings in this version.

Access to the daemon's owner API includes permission to launch stdio commands as its user. Keep that API on trusted devices and networks. Commands and arguments are saved with the conversation and returned by Connections, so keep secrets in the MCP program's own configuration or a wrapper script, not in arguments.

## Writing a plugin

Import authoring helpers and types from `@familiar-ai/core`. A plugin needs no direct Pi imports.

```ts
import { definePlugin, defineTool, Type } from '@familiar-ai/core'

export default definePlugin({
  name: 'example',
  title: 'Example',
  extension: ({ fetch }) => ({
    tools: [
      defineTool({
        name: 'read_status',
        description: 'Read the public service status.',
        parameters: Type.Object({}),
        replay: 'safe',
        execute: async (_args, context) => {
          const response = await fetch('https://example.com/status', {
            signal: context.abortSignal,
          })
          if (!response.ok)
            throw new Error(`Status service answered ${response.status}`)
          return {
            output: [{ type: 'text', text: await response.text() }],
            details: { url: response.url },
          }
        },
      }),
    ],
  }),
})
```

`Type` builds argument schemas. `defineTool` infers arguments from `parameters`; `Static` is exported for separately named argument types. `FamiliarTool`, `ToolContext` and `ToolResult` describe the public contract. Execution now takes two arguments, the validated parameters and a Familiar context, replacing Pi's three-argument callback. Move `call.abortSignal` to `context.abortSignal` and keep using `context.now()` for the host clock.

Return text or image blocks in `output`. Text remains the fallback for every client. Optional JSON-safe `details` travels with the persisted tool result to the client's `ToolCall.details`, where the host must narrow the unknown value before rendering. `context.details(value)` replaces running details; its last value becomes the result's details unless the return value supplies `details`. `context.output(text)` appends running text and supplies the final output when the result omits it. Details are stored beside model output, not appended to the text.

`structuredOutputSchema` and `structuredOutput` describe program output, separate from UI details. Pi validates structured output against that schema. Tools may select `executionMode` and `outputLimits`. Throwing produces a tool error through Pi; returning `isError: true` supplies an explicit error result.

Replay defaults to `unsafe`. A call interrupted by restart is not rerun. Use `safe` only when repeating the operation is safe, including any external side effects. Forward the abort signal to network or other cancellable work. Cancellation cannot undo an external effect. The adapter adds no retries or undo mechanism.

`PluginExtension` currently supports tools only. Pi hooks, tasks, wrappers, transactions and harness access are no longer part of the plugin contract. Existing first-party plugins need none of them. Demo memory is seeded offline before Familiar opens its demo storage; its scripted seed calls acknowledge that prepared data.
