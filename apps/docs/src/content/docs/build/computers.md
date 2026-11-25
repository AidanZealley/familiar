---
title: Give Familiars computers
description: Add a computer in Docker to a workspace you host on Node, so Familiars can use a browser and a shell.
---

A computer gives a Familiar its own browser and shell, so it can use a website as a person would or run a program. `@familiar-ai/computer` runs each Familiar's computer as a Docker container on the workspace's machine. The installed daemon includes it already; this page is for a workspace you host on Node, such as the [Node server example](/familiar/examples/node-server/).

```sh
npm install @familiar-ai/computer
```

## Add the plugin

The process must be able to run `docker`. Then add the plugin, and turn it on for each Familiar that should have a computer:

```ts
import { computer } from '@familiar-ai/computer'
import { dockerHost } from '@familiar-ai/computer/docker'

const workspace = await openWorkspace({
  // …
  plugins: [computer({ host: dockerHost() })],
})

await workspace.familiars.create({
  name: 'Ada',
  capabilities: { plugins: ['computer'] },
})
// Later: familiar.setCapabilities({ plugins: [] }) turns it off
```

The host downloads the image (about 420 MB, 1.5 GB unpacked) in the background when the workspace opens, and removes old versions once it's ready.

Turning the plugin off for a Familiar, or removing the Familiar, deletes its computer and its disk. Confirm first in your UI.

## The tools

- `browser_snapshot`, `browser_screenshot`, `browser_navigate`, `browser_click`, `browser_type`: Chromium, by element refs from the snapshot
- `screen_screenshot`, `screen_click`, `screen_type`, `screen_key`, `screen_scroll`: any app on the 1280×800 desktop, by pixel
- `run_command`: a shell command in its home directory, for up to 10 minutes
- `read_file`, `write_file`: text files
- `saved_logins`, `request_login`, `sign_in`: see [Saved logins](#saved-logins)

The tools that only look (`browser_snapshot`, `browser_screenshot`, `screen_screenshot`, `read_file`) and `browser_navigate` run at once. The rest ask the person first. Keep that default wherever your UI can answer approvals: without it, nobody approves what the Familiar submits, posts, buys or downloads.

## Sleep, wake and limits

There's nothing to start or stop. A computer starts on its Familiar's first call and sleeps after 15 minutes without one, keeping its home directory. Programs it left running stop, and the next result says so.

| `dockerHost` option | Default   | Meaning                                                         |
| ------------------- | --------- | --------------------------------------------------------------- |
| `idleMs`            | 15 min    | How long before a computer sleeps                               |
| `maxComputers`      | 10        | Most computers this host makes. Pass a function to read it live |
| `hostId`            | `default` | Names its containers. Give each workspace on one engine its own |

Each computer may use 4 GB of memory, 2 CPUs and 512 processes. Disk isn't capped.

## Isolation

A computer has no network of its own. Its only way out is a proxy that refuses private and reserved addresses, such as your LAN, tailnet, loopback and the host machine's own addresses. Two things stay reachable: ports forwarded through your router's public address, and a remote Docker engine's public addresses.

## Status, screen and take-over

The plugin serves these under `/plugins/computer/familiars/:familiar`, all needing `plugins.computer` in your `allow`:

- `GET …/status`: `running`, `asleep`, `setting-up` (image downloading), `none`, or `unavailable` with a `reason`, such as no Docker or the cap reached.
- `GET …/screen`: a WebSocket of the display as VNC (RFB) bytes, for a viewer such as [noVNC](https://novnc.com) in view-only mode. It never wakes the computer, and closes when it sleeps.
- `GET …/control`: a WebSocket that takes over the computer, for a sign-in or a CAPTCHA. It wakes the computer and sends `held` once you have control.

WebSocket routes need your runtime's Hono `upgradeWebSocket` passed to `createHttpApi`; without it they answer 501.

While you hold control:

- Answer the server's `ping`, sent every 5 seconds, with any message. A socket silent for 15 seconds hands control back.
- One person at a time. A second take-over is closed with code 4000.
- The Familiar's reads still run. Its actions wait, then tell it to look again.
- Send input to the screen socket only while you hold control. This is coordination, not security.

## Saved logins

A Familiar can sign in to websites with logins saved for it, one per site and username:

- `saved_logins` lists sites and usernames, never passwords.
- `request_login` asks the person for a login in a private form. It goes to the plugin, never into the chat or storage.
- `sign_in` fills a saved login and submits it, asking first. It fills only where the page, frame and form target all match the saved origin exactly.

Your settings UI can manage them with `GET`, `PUT` and `DELETE …/logins`. They need a `secrets` store in `openWorkspace`, or the routes answer 503.

**The trust boundary.** Saved logins keep passwords out of the chat, storage and what the model reads, but not out of the computer: the password is typed into its browser, and the Familiar can run any command there as root. Save a login only where you'd let the Familiar hold the account. Prefer accounts made for it, app passwords and scoped tokens. Otherwise take over and sign in yourself.

## Limits

- Docker only. Cloudflare and browser workspaces can't have computers yet.
- Verified with Docker Engine on Linux and Docker Desktop on Apple Silicon. Windows hasn't been verified.
- The image is published for `linux/amd64` and `linux/arm64`.
