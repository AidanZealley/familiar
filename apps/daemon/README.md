# Familiar daemon

The Node host for the installed assistant. It owns SQLite storage, ChatGPT credentials, CLI setup and services, Web Push, network filtering and isolated HTML conversion. It serves core's HTTP API and the built web UI.

## Using the installed assistant

Run the [installer](../../README.md#install), then open the URL it prints. Run `familiar` again to resume setup. Sign-in uses your ChatGPT subscription. If you complete sign-in on another device, paste the final redirect URL when prompted, even if that page failed to load.

Useful commands:

```sh
familiar status
familiar sign-in
familiar rename Willow
familiar logs
familiar update
familiar uninstall
```

`update` installs the latest release; it does not make a backup or provide rollback. `uninstall` removes the managed service and Tailscale publication but keeps your data.

The daemon listens on `127.0.0.1:4317`. Setup publishes a private HTTPS URL when Tailscale is available. There is no separate app login: anyone with access can use the conversation, change credentials and install MCP tools. Local MCP commands run as the daemon's user. Keep the endpoint private.

Enable notifications on the Schedules page of each device. Reminders run in the shared conversation and notify every subscribed device. Push needs HTTPS; on iPhone, use a home-screen web app with iOS 16.4 or later.

## Settings and storage

Settings live in `settings.json` in the data directory. Environment variables override saved settings. For example:

```json
{
  "name": "Willow",
  "owner": "Aidan",
  "port": 4317
}
```

`name` is the assistant's name. `owner` labels your messages; the daemon always uses the stable author ID `owner`. `FAMILIAR_NAME`, `FAMILIAR_OWNER` and `FAMILIAR_PORT` override saved settings. `FAMILIAR_HOST` changes the bind address; `FAMILIAR_DATA_DIR` changes the storage directory. Model choices live in [src/config.ts](src/config.ts); `FAMILIAR_MODEL` selects the initial chat model and upkeep's model. Chat model and reasoning choices made in the UI persist separately with the conversation.

Data defaults to `~/.local/share/familiar` on Linux, `~/Library/Application Support/Familiar` on macOS and `%LOCALAPPDATA%\Familiar` on Windows. It includes the provider login, conversation, plugin secrets and push subscriptions. Treat it as private. Dates and reminders use the machine's time zone at startup; restart after changing zones.

## Development

From the repository root:

```sh
pnpm install
pnpm dev:demo
```

This starts the scripted daemon on port 4318 and the UI on 5174 with disposable in-memory data. Try `tool`, `memory`, `remind`, `key`, `mcp`, `slow`, `compact` or `error` in chat. Only the model and external services are simulated. Add scenarios under `src/demo/scenarios/` and register them in `src/demo/model.ts`.

`pnpm start` serves the real assistant; `pnpm sign-in` changes its saved provider login. `pnpm dev` starts a real daemon too. Use these only when you intend to work with that installation. Never run a second daemon over its storage. Leave the running service, port 4317 and its data untouched during ordinary development.

`pnpm eval:recall` and `pnpm eval:unfiled` check retrieval without a real model. `pnpm eval:memory` runs the model-backed replay, uses a separate eval login and can take hours. Its setup and output paths are in [src/memory-eval](src/memory-eval/). Do not substitute the owner's login for the eval login.

`pnpm bundle` creates the installable tarball; `pnpm test:release` verifies it using temporary storage. Both run from the repository root. The [release workflow](../../.github/workflows/release.yml) publishes tagged releases.

Start reading at `src/main.ts`, `src/serve.ts` and `src/config.ts`. Platform setup is under `src/cli/`. Portable assistant capabilities belong in [core](../../packages/core/README.md), not this host.
