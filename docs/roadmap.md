# Roadmap

Familiar is a personal assistant with one durable conversation, memory, schedules and tools. It also stays embeddable: another app can host one Familiar per owner or household. The [README's rules](../README.md#rules) define those boundaries.

## Done

- **Core and hosts.** Portable core, an HTTP and SSE API, a client store, a Node daemon and the web UI. Each capability owns its extension and owner API; see [architecture](architecture.md).
- **Chat.** Streamed Markdown, tool activity, stopped replies and history paging across compactions. The in-memory demo has separate startup, model routing and feature scenarios.
- **Memory.** A bounded context, searchable exchanges, dated facts and episodes, recall and `read_memory`, nightly upkeep and fact review, and health diagnostics. See [memory](memory.md). The model-free recall eval exists; real-model evaluation is still pending.
- **Schedules and notifications.** One-off and recurring prompts, a Schedules page and Web Push delivery. Setup and device requirements are in the [README](../README.md#use-it).
- **Plugins and Connections.** Pi extensions with a small Familiar context, write-only credential routes and a Connections UI. Authenticated requests attach credentials only to their declared destinations; the daemon owns network filtering.
- **Web search and reading.** Brave search plus bounded public-page reads as text or Markdown. mdream owns HTML conversion; the daemon uses Piscina for interruptible conversion. No page JavaScript, PDFs or browser automation.

## Next

1. [MCP connections](specs/mcp.md): connect remote services, expose deferred tools through Pi's tool search and manage their status on Connections.
2. [Easy install](specs/easy-install.md): install and sign in on Linux, macOS, Windows or a VPS, and export/import to move between machines.

## Later

Write a spec before starting these.

- **Real-world tools.** Calendar, initially read-only from a private ICS URL, then email. Plugins use the existing [credential and network boundaries](architecture.md#credential-and-network-boundaries).
- **Action approvals.** Require approval before sensitive actions. Private data, untrusted pages and network access already coexist: destination-bound keys do not prevent private data leaking through a search query or public URL.
- **Agent-written tools and skills.** Consider Pi's code mode for saved scripts with no direct file or network access, and instruction-only skills when repeated tasks justify them. File and shell tools must not see Familiar's private data directory.
- **MCP authentication.** OAuth and additional secret headers after the basic MCP connection flow works.
- **Web fetch paging.** Add an offset if truncated pages become a practical problem. Add other search providers only when needed.
- **Secret masking.** The prototype is preserved at tag `archive/secret-masking`. Reconsider it only for a concrete leak path; it is excluded from the current credential contract.
- **Photos.** Image input using the model's vision and Pi's image resizing.
- **Gatherbot.** A Cloudflare host with one Familiar per household and Gather's authentication. Decide whose identity it uses for actions when nobody is present.
- **UI improvements.** Sources and inline citations, context usage and suggestions where useful. A model switcher has been discussed but is not specified.
- **Native app.** Another client of the same API, with APNs instead of Web Push.
- **The real logo.** A cat. Replace `apps/web/public/icon.svg` and regenerate the icons.
