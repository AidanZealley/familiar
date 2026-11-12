# Familiar daemon

The installable Familiar: core and its Node building blocks, plus opinions. It adds the web search and fetch tools, the owner's own plugins from the data directory, ChatGPT sign-in, Web Push, CLI setup and services. It serves core's HTTP API and the built web UI. [examples/node-server](../../examples/node-server/) is built from the same pieces without those opinions.

User guides, including commands, settings and notifications, are under [Use Familiar](https://aidanzealley.github.io/familiar/use/install/) (publishes once GitHub Pages deployment is enabled).

## Installed assistant

Run the [installer](../../README.md#install), then open the URL it prints. Run `familiar --help` for commands.

The daemon listens on `127.0.0.1:4317` and authenticates every request as its owner, with the stable author ID `owner`. Setup publishes a private HTTPS URL when Tailscale is available. There is no separate app login: anyone with access can use the conversation, change credentials and install MCP tools, and local MCP commands run as the daemon's user. Keep the endpoint private.

The owner's plugins are `.ts` and `.js` files in `plugins/` in the data directory, loaded at start by [src/plugins.ts](src/plugins.ts). A file that fails to load is skipped and logged. [Extend your Familiar](https://aidanzealley.github.io/familiar/use/extend/) is the guide.

Settings live in `settings.json` in the data directory (`~/.local/share/familiar` on Linux, `~/Library/Application Support/Familiar` on macOS, `%LOCALAPPDATA%\Familiar` on Windows). `FAMILIAR_NAME`, `FAMILIAR_OWNER`, `FAMILIAR_PORT`, `FAMILIAR_MODEL`, `FAMILIAR_HOST` and `FAMILIAR_DATA_DIR` override them. Model choices live in [src/config.ts](src/config.ts).

## Development

From the repository root:

```sh
pnpm install
pnpm dev
```

This starts the scripted daemon on port 4318 and the UI on 5174 with disposable in-memory data. It opens on Rowan's household, a few days in: four Familiars, their DMs and rooms, memory, schedules and connections, with Spool still busy watching a print. The household is written as data in [src/demo/household/story.ts](src/demo/household/story.ts), each message with the replies it gets; add to it there. Anything the story doesn't script falls back to the scenarios: try `tool`, `memory`, `remind`, `key`, `mcp`, `slow`, `compact` or `error` in Juniper's DM, which has the demo plugin. Only the model and external services are simulated. Add scenarios under `src/demo/scenarios/` and register them in `src/demo/model.ts`.

`pnpm start` serves the real assistant; `pnpm sign-in` changes its saved provider login. In this package, `pnpm dev:live` starts a real daemon too. Use these only when you intend to work with that installation. Never run a second daemon over its storage. Leave the running service, port 4317 and its data untouched during ordinary development.

`pnpm eval:recall` and `pnpm eval:unfiled` check memory retrieval against a scripted year of conversation, in [src/memory-eval](src/memory-eval/), without a model. Results are saved under `eval/results`.

`pnpm eval:core` grades what memory upkeep keeps and where it puts it. It replays two months of a household's messages, labelled with where each thing belongs, through a real workspace. Replies are scripted and free; only upkeep calls a model, Claude Haiku 5.5 at low thinking (`--model` picks another Anthropic model). It needs an eval-only Anthropic API key in `ANTHROPIC_API_KEY` or `~/.local/share/familiar-eval/anthropic-api-key`, never your sign-in. A full run is roughly 1M tokens, about $0.15–0.25 on Haiku, and 30–60 minutes. It stops once it passes `--max-tokens` (default 1,500,000), and after the first 3 active days it prints tokens, time and a projection and stops if the projection is over the cap. `--probe` runs only those 3 days. The final memory is saved in `eval/fixtures/core-<hash>.json`, keyed by upkeep's prompts and tools, the scenario and the model. Until one of those changes, a rerun only grades the fixture, re-running the current core ranking first, so ranking changes are measured free.

`pnpm bundle` creates the installable tarball; `pnpm test:release` verifies it using temporary storage. Both run from the repository root. The [release workflow](../../.github/workflows/release.yml) publishes tagged releases.

Start reading at `src/cli.ts`, the entry, then `src/daemon.ts`, which assembles the host, `src/serve.ts`, `src/config.ts` and `src/web/`, the web plugin. Platform setup is under `src/cli/`. Portable assistant capabilities belong in [core](../../packages/core/README.md), not this host.
