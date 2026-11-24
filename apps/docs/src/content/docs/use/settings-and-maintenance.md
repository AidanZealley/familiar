---
title: Settings and maintenance
description: Familiar's commands, settings file, data location, updates and removal.
---

## Commands

```sh
familiar             # Guided setup, or resume it
familiar status      # Name, version, service status, URLs and the plugins folder
familiar rename      # Change the assistant's name. Pass the new name or answer the prompt
familiar sign-in     # Sign in with ChatGPT again
familiar restart     # Restart the service, such as after changing your plugins
familiar logs        # Follow the service logs
familiar update      # Update and restart. --main or --release switches source
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

Environment variables override the file: `FAMILIAR_NAME`, `FAMILIAR_OWNER`, `FAMILIAR_PORT`, `FAMILIAR_MODEL` for the default ChatGPT chat and memory model until you choose others in **Settings › Models**, and `FAMILIAR_DATA_DIR` for the data directory. Restart the service after changing either.

The **Settings** menu in the web app switches between light, dark and system appearance, and signs out of ChatGPT.

### Model providers

Familiar reaches OpenAI's models through your ChatGPT sign-in. To use Anthropic, Google, xAI or OpenRouter (for open-weight models such as DeepSeek, Kimi, GLM, MiniMax and Qwen), enter the provider's API key in **Settings › Providers**, where the ChatGPT sign-in also lives, then restart Familiar (`familiar restart`). Familiar then offers that provider's models. While you're signed in to ChatGPT its models come first and stay the default; otherwise the first provider with a key does, until you choose another in **Settings › Models**. Without a sign-in or any key, Familiar offers ChatGPT's models and asks you to sign in.

## Your data

| Platform | Data directory                           |
| -------- | ---------------------------------------- |
| Linux    | `~/.local/share/familiar`                |
| macOS    | `~/Library/Application Support/Familiar` |
| Windows  | `%LOCALAPPDATA%\Familiar`                |

It holds the conversation, memory, your ChatGPT login, model providers' API keys, connection keys, notification subscriptions, [your own plugins](/familiar/use/extend/) and your Familiars' portraits. Keep it private.

The service also runs in the data directory, so anything a tool writes to its working folder, such as a browser MCP server's screenshots, lands there and survives updates. A service installed by an older version runs in the app's own folder, which an update replaces; run `familiar` once to reinstall the service and move it.

### Stored credentials

Familiar encrypts connection keys in `secrets.json`, and your ChatGPT login and
model providers' API keys in `auth.json`, under a `vault.key` it creates in the data directory. There's
nothing to set up.

Stop Familiar before backing up or restoring the data directory, and keep
`vault.key` with the files in every backup. Without it they can't be read: if
it's lost, Familiar says so and leaves them alone. Delete them, then sign in
and enter your keys again.

Keep the machine and its backups private. Encryption protects copied credential
files when the key is absent. The running daemon can decrypt them, and someone
with control of its machine can too. Conversation history and other data are
not encrypted by this credential store.

### Portraits

Each Familiar starts with its own pixel character, generated from its ID, which looks around and blinks. In the web UI, its settings' Profile changes it to its initial on a colour, another character's shape or colour, or one of your own images.

Your own images go in the `avatars` folder in the data directory, which `familiar status` shows and the Image tab names. Each is a 64×32 PNG strip of two 32×32 frames, which the web UI alternates while the Familiar replies: draw whatever animation you like across them, the first frame being the one shown at rest. The file's name is the portrait's name. Familiar reads the folder as you use it, so new images show when you reopen the app.

Dates and reminders use the computer's time zone when Familiar starts. Restart it after you change time zones.

## Updates and removal

`familiar update` installs the newest version from where this installation came from, and restarts the service. A release updates to the latest release. A build of `main`, installed with `FAMILIAR_VERSION=main`, updates to the latest build of `main`. `familiar status` shows the version and which of the two it updates from.

`familiar update --main` switches a release to the latest build of `main`, and `familiar update --release` switches back. Switching back installs the latest release even when it's older than your build of `main`, so wait for a release newer than it.

Updates don't back up your data first, and there's no rollback. Familiar has no export, import or automatic backups yet.

`familiar uninstall` removes the background service and the Tailscale address. Your data directory stays where it is.
