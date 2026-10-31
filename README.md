# Familiar

A personal AI assistant with one ongoing conversation, long-term memory, reminders and tools. Built on [Pi Durable](https://github.com/earendil-works/pi/tree/main/packages/durable), with a local SQLite database and a web UI. It stores your conversation locally and resumes after restarts.

## Install

### macOS

```sh
curl -fsSL https://github.com/AidanZealley/familiar/releases/latest/download/install.sh | sh
```

### Linux

```sh
curl -fsSL https://github.com/AidanZealley/familiar/releases/latest/download/install.sh | sh
```

### Windows

Run in PowerShell:

```powershell
irm https://github.com/AidanZealley/familiar/releases/latest/download/install.ps1 | iex
```

The installer downloads Node if needed, asks for a name, signs you into ChatGPT and starts Familiar in the background. Open the local URL it prints. Optional [Tailscale](https://tailscale.com/download) access lets you use it privately from your other devices.

Familiar currently manages one assistant per user. Linux and macOS have had real-machine testing; Windows has automated CI coverage, with real-machine testing still pending. Export/import and backup safeguards for updates are planned.

## More

- [Setup, CLI commands and settings](docs/usage.md)
- [Development and release packaging](docs/development.md)
- [Architecture and rules](docs/architecture.md)
- [Familiar on Cloudflare](docs/cloudflare.md)
- [Roadmap](docs/roadmap.md)
