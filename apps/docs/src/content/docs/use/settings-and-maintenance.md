---
title: Settings and maintenance
description: Familiar's commands, settings file, data location, updates and removal.
---

## Commands

```sh
familiar             # Guided setup, or resume it
familiar status      # Name, service status, URLs and the plugins folder
familiar rename      # Change the assistant's name. Pass the new name or answer the prompt
familiar sign-in     # Sign in with ChatGPT again
familiar restart     # Restart the service, such as after changing your plugins
familiar logs        # Follow the service logs
familiar update      # Install the latest release and restart
familiar uninstall   # Remove the service, keeping your data
familiar serve       # Run in the foreground instead of as a service
```

## Settings

Settings live in `settings.json` in the data directory:

```json
{
  "name": "Willow",
  "owner": "Aidan",
  "port": 4317
}
```

- `name` is the assistant's name.
- `owner` is the name your messages carry until you change it in the web app. Familiar reads it the first time it starts; after that, your name is the one you set. It defaults to `owner`.
- `port` is where Familiar listens. It defaults to `4317`.

Environment variables override the file: `FAMILIAR_NAME`, `FAMILIAR_OWNER`, `FAMILIAR_PORT`, `FAMILIAR_MODEL` for the starting chat and upkeep model, and `FAMILIAR_DATA_DIR` for the data directory. Restart the service after changing either.

The **Settings** menu in the web app switches between light, dark and system appearance, and signs out of ChatGPT.

## Your data

| Platform | Data directory                           |
| -------- | ---------------------------------------- |
| Linux    | `~/.local/share/familiar`                |
| macOS    | `~/Library/Application Support/Familiar` |
| Windows  | `%LOCALAPPDATA%\Familiar`                |

It holds the conversation, memory, your ChatGPT login, connection keys, notification subscriptions and [your own plugins](/familiar/use/extend/). Keep it private.

Dates and reminders use the computer's time zone when Familiar starts. Restart it after you change time zones.

## Updates and removal

`familiar update` installs the latest release and restarts the service. It doesn't back up your data first, and there's no rollback. Familiar has no export, import or automatic backups yet.

`familiar uninstall` removes the background service and the Tailscale address. Your data directory stays where it is.
