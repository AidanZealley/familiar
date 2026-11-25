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

Dates and reminders use the computer's time zone when Familiar starts. Restart it after you change time zones.

The **Settings** menu in the web app switches between light, dark and system appearance, and signs out of ChatGPT.

### Model providers

Familiar reaches OpenAI's models through your ChatGPT sign-in. To use Anthropic, Google, xAI or OpenRouter (for open-weight models such as DeepSeek, Kimi, GLM, MiniMax and Qwen), enter the provider's API key in **Settings › Providers**, where the ChatGPT sign-in also lives, then restart Familiar (`familiar restart`). Familiar then offers that provider's models. While you're signed in to ChatGPT its models come first and stay the default; otherwise the first provider with a key does, until you choose another in **Settings › Models**. Without a sign-in or any key, Familiar offers ChatGPT's models and asks you to sign in.

## Your data

| Platform | Data directory                           |
| -------- | ---------------------------------------- |
| Linux    | `~/.local/share/familiar`                |
| macOS    | `~/Library/Application Support/Familiar` |
| Windows  | `%LOCALAPPDATA%\Familiar`                |

It holds the conversation, memory, logins and keys, notification subscriptions, [your own plugins](/familiar/use/extend/) and portraits. Keep it private. The service runs in it too, so files a tool writes to its working folder survive updates.

### Stored credentials

Familiar encrypts connection keys in `secrets.json`, and your ChatGPT login and API keys in `auth.json`, under a `vault.key` it creates beside them.

Stop Familiar before backing up or restoring the data directory, and keep `vault.key` with the files. Without it they can't be read: delete them, then sign in and enter your keys again. Encryption protects copied files, not a machine someone controls, and the conversation itself isn't encrypted.

### Portraits

Each Familiar starts with a pixel character generated from its ID. Its settings' **Profile** changes it to its initial, another character, or one of your own images.

Your own images go in the `avatars` folder in the data directory. Each is a 64×32 PNG: two 32×32 frames, the first shown at rest, alternating while the Familiar replies. The file's name is the portrait's name.

## Updates and removal

`familiar update` installs the newest version from the same source, a release or a build of `main`, and restarts. `familiar status` shows which. `--main` and `--release` switch source; switching back to releases installs the latest release even if it's older than your build.

**Settings › Updates** in the web app does the same and follows Familiar through the restart. It works only for an installed Familiar running as its service.

A failed download leaves Familiar running, and a failed install starts it again on the old version. If an interrupted update leaves it unable to start, run the install script again. Updates don't back up your data, and there's no rollback.

`familiar uninstall` removes the background service and the Tailscale address. Your data directory stays where it is.
