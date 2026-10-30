# Roadmap

Familiar is a personal assistant with one durable conversation, memory, schedules and tools. It also stays embeddable: another app can host one Familiar per owner or household. The [architecture rules](architecture.md#rules) define those boundaries.

## Done

- **Core and hosts.** Portable core, an HTTP and SSE API, a client store, a Node daemon and the web UI. Each capability owns its extension and owner API; see [architecture](architecture.md).
- **Chat.** Streamed Markdown, tool activity, stopped replies, history paging across compactions, and shared model and reasoning controls. The in-memory demo has separate startup, model routing and feature scenarios.
- **Memory.** A bounded context, searchable exchanges, dated facts and episodes, recall and `read_memory`, nightly upkeep and fact review, and health diagnostics. See [memory](memory.md). The model-free recall and unfiled evals exist; real-model evaluation is still pending.
- **Schedules and notifications.** One-off and recurring prompts, a Schedules page and Web Push delivery. Setup and device requirements are in the [usage guide](usage.md).
- **Plugins and Connections.** Pi extensions with a small Familiar context, write-only credential routes and a Connections UI. Authenticated requests attach credentials only to their declared destinations; the daemon owns network filtering.
- **Web search and reading.** Brave search plus bounded public-page reads as text or Markdown. mdream owns HTML conversion; the daemon uses Piscina for interruptible conversion. No page JavaScript, PDFs or browser automation.
- **MCP connections.** Saved HTTP and local stdio servers, deferred tools through Pi's tool search, and a searchable Connections workspace for status, credentials and server management. See [MCP ownership](architecture.md#mcp-connections) and the [setup guide](usage.md#mcp-connections).
- **Installation and CLI.** Release packages and user-owned installers for Linux, macOS and Windows, guided ChatGPT sign-in, private Tailscale access, service management, status and rename. Platform CI passes on all three OSes. Real macOS lifecycle testing is partly complete; real Windows testing is deferred. See [easy install](specs/easy-install.md) for verification still outstanding.

## Next

1. **Versioned export/import.** Move conversation, memory, episodes, schedules and portable settings between machines, with consistent snapshots and recoverable replacement. Sign in separately on the destination. See [backup format and move flow](specs/easy-install.md#6-export-and-import).
2. **Safer updates.** Build on snapshots to add compatibility checks, migrations, pre-update backups and recovery. The current update command installs the latest release without these safeguards. See [strengthened update](specs/easy-install.md#7-strengthened-update).

## Later

Write a spec before starting these unless one is linked below.

- **Multiple Familiars and collaboration.** [Draft spec](specs/multiple-familiars.md): one host with several named assistants, separate conversations and memory, safe lifecycle management, then explicit delegation between roles. Parked for later discussion.
- **Real-world tools.** Calendar, initially read-only from a private ICS URL, then email. Plugins use the existing [credential and network boundaries](architecture.md#credential-and-network-boundaries).
- **Action approvals.** Require approval before sensitive actions. Private data, untrusted pages and network access already coexist: destination-bound keys do not prevent private data leaking through a search query or public URL.
- **Agent-written tools and skills.** Consider Pi's code mode for saved scripts with no direct file or network access, and instruction-only skills when repeated tasks justify them. File and shell tools must not see Familiar's private data directory.
- **MCP authentication.** OAuth and additional secret headers when a server needs them.
- **Web fetch paging.** Add an offset if truncated pages become a practical problem. Add other search providers only when needed.
- **Secret masking.** Reconsider masking only for a concrete leak path; it is excluded from the current credential contract.
- **Photos.** Image input using the model's vision and Pi's image resizing.
- **Gatherbot.** A Cloudflare host with one Familiar per household and Gather's authentication. Decide whose identity it uses for actions when nobody is present.
- **UI improvements.** Sources and inline citations, context usage and suggestions where useful.
- **Native app.** Another client of the same API, with APNs instead of Web Push.
- **The real logo.** A cat. Replace `apps/web/public/icon.svg` and regenerate the icons.
