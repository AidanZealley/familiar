# Familiar daemon

The Node host for the installed assistant. It owns SQLite storage, ChatGPT credentials, CLI setup and services, Web Push, network filtering and isolated HTML conversion. It serves core's HTTP API and the built web UI.

For development, run `pnpm install` then `pnpm dev:demo` from the repository root. This starts the scripted daemon on port 4318 and the UI on 5174 with disposable memory, without opening the owner's data. [Development](../../docs/development.md) lists demo scenarios and release checks.

`pnpm start` serves the real assistant; `pnpm sign-in` changes its saved provider login. Use them only when you intend to work with that installation. Never run a second daemon over its storage. Leave the running service, port 4317 and `~/.local/share/familiar` untouched during ordinary development.

Start reading at `src/main.ts`, `src/serve.ts` and `src/config.ts`. Platform-specific setup is under `src/cli/`; scripted development is under `src/demo/`. Portable capabilities belong in [core](../../packages/core/README.md), not this host. [Usage](../../docs/usage.md) describes installed commands and data settings.
