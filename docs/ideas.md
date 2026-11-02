# Ideas for Familiar

These are uncommitted ideas, not a delivery schedule. The installed app remains one personal assistant with ChatGPT sign-in and private network access. Write or revisit a spec before implementation.

## Data safety first

- Versioned export/import of conversation, memory, episodes, schedules and portable settings. Use consistent snapshots and recoverable replacement; sign in separately on the destination. See the [draft move flow](specs/easy-install.md#6-export-and-import).
- Safer updates with compatibility checks, migrations, pre-update backups and recovery. The current updater does not provide these safeguards. See the [draft update design](specs/easy-install.md#7-strengthened-update).

## Embedding and shared conversations

- A shared chat demo with several humans talking to one agent, using a demo identity switcher. This would exercise stable author IDs without adding profiles to the installed app.
- An embedded household shopping-tool app, showing domain tools and a Familiar conversation in the same app.
- A site with approachable package docs and runnable demos. Publish links when those exist.
- Further browser experiments. Source core, faux models, MemoryStorage, HTTP/SSE and the client ran in Chrome without backend or shims. Published artifacts, real providers, other browsers and iframe embedding still need testing.
- Gatherbot on Cloudflare with one Familiar per household and Gather authentication. Decide whose authority background actions use.
- Several independent assistants, then possible explicit delegation. The [multiple-Familiars draft](specs/multiple-familiars.md) is parked; it is distinct from several people sharing one assistant.

## Other possibilities

- Read-only calendar access, then email; approvals before sensitive actions. Destination-bound keys do not prevent private data escaping in a search query or URL.
- Saved scripts through Pi code mode and instruction-only skills, when repeated tasks justify them. File and shell tools must never see Familiar's private login or conversation directory.
- MCP OAuth or extra secret headers when required by a server.
- Web page paging and additional search providers when needed. Revisit secret masking only for a concrete leak path.
- Image input, sources and inline citations, useful context usage indicators, a native notification client and a cat logo.

[Installation spec](specs/easy-install.md) records remaining platform validation. Current behavior belongs in the READMEs and [usage guide](usage.md), rather than a second inventory here.
