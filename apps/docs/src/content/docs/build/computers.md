---
title: Give Familiars computers
description: Add a computer in Docker to a workspace you host on Node, so Familiars can use a browser and a shell.
---

A computer gives a Familiar a real browser and a shell of its own, so it can use a website as a person would or run a program. `@familiar-ai/computer` runs each Familiar's computer as a Docker container on the machine your workspace runs on.

```sh
npm install @familiar-ai/computer
```

The installable daemon includes computers already. This page is for a workspace you host yourself on Node, such as the [Node server example](/familiar/examples/node-server/).

## Add the plugin

Docker must be installed, and the process must be able to run the `docker` command. Then add one plugin:

```ts
import { computer } from '@familiar-ai/computer'
import { dockerHost } from '@familiar-ai/computer/docker'

const workspace = await openWorkspace({
  // …
  plugins: [computer({ host: dockerHost() })],
})
```

When the workspace opens, the host starts downloading the computers' image in the background, so it's usually ready before anyone needs it. The image is about 420 MB to download and 1.5 GB unpacked. Its tag matches the package's version. The host keeps one version: once the image is ready, it removes the image's other versions that no container uses, and a computer made from an earlier version is made again on the current one when it next wakes, keeping its disk.

## Turn it on per Familiar

Adding the plugin makes computers available. Each Familiar's `computer` capability decides whether it has one:

```ts
await workspace.familiars.create({
  name: 'Ada',
  capabilities: { plugins: ['computer'] },
})

// Later: on, or off
await familiar.setCapabilities({ plugins: ['computer'] })
await familiar.setCapabilities({ plugins: [] })
```

Turning it on makes the Familiar's computer once the image is ready. Turning it off removes the computer and its disk. Removing a Familiar does the same. If your UI turns it off, confirm first.

## The tools

A Familiar with a computer has sixteen tools. Each call goes to that Familiar's own computer, never another's.

- `browser_snapshot`: the open page as text, with a ref for each element.
- `browser_screenshot`: a picture of the open page.
- `browser_navigate`: opens an address.
- `browser_click`: clicks an element by its ref.
- `browser_type`: fills in a field, optionally pressing Enter.
- `screen_screenshot`: a picture of the whole screen.
- `screen_click`, `screen_type`, `screen_key` and `screen_scroll`: use the mouse and keyboard on any app, then show the screen.
- `run_command`: runs a shell command in its home directory, for up to 10 minutes.
- `read_file`: reads a text file.
- `write_file`: writes a text file.
- `saved_logins`, `request_login` and `sign_in`: use the Familiar's saved website logins. See [Saved logins](#saved-logins).

The computer has a desktop, 1280×800 pixels, with a taskbar and a launcher. The browser is Chromium, shown on it, and the browser tools act on its shown tab. Screen tools use display pixels, so they work in any app, such as one the Familiar installed and started with `run_command`. Long results are shortened. For commands, the end of the output is kept.

The four tools that only look (`browser_snapshot`, `browser_screenshot`, `screen_screenshot` and `read_file`) and `browser_navigate` run at once. The others ask the person first, as any tool that might change something does. Keep that default where your UI can answer approvals.

The Node server example's UI can't answer approvals, so it clears **Ask first** on the computer tools that require it by calling `workspace.connections.updateToolSettings` for each one.

Then nobody approves what the Familiar does with its browser and shell. It can submit forms, post, buy, upload its files and download whatever it's led to on any public site. Isolation protects your machine, not the services the computer can reach.

The four that only look are also safe to run again after a restart. Familiar reports any other call that a restart interrupted, so the model looks before trying again.

## Sleep and wake

There's nothing to start or stop. A computer starts on its Familiar's first tool call. After 15 minutes without a call it goes to sleep: its container stops, and its home directory is kept. The next call wakes it, and the result tells the Familiar that programs it left running have stopped. Change the wait with `dockerHost({ idleMs })`.

## How many computers

`maxComputers` caps how many computers one host makes. The default is 10. Pass a function to read a setting each time, so a change applies without a restart:

```ts
dockerHost({ maxComputers: () => settings.maxComputers })
```

When the cap is reached, a Familiar without a computer can't get one. Its tool calls and status say why. Lowering the cap removes no computers. It only stops new ones being made.

Each computer may use up to 4 GB of memory, 2 CPUs and 512 processes.

## Isolation

A computer has no network of its own, so it can't reach another computer directly. Its only way out is a proxy container that the host runs. The proxy refuses private and reserved addresses, such as your LAN, a tailnet and loopback, and the addresses it detects as the host machine's own. Two exceptions remain:

- Your router's public address, and any port forwarded through it. A LAN service you've forwarded to the internet is reachable, as it is from anywhere.
- A remote Docker engine (`DOCKER_HOST`). The proxy refuses the workspace machine's addresses, not the engine machine's, so the engine's own public addresses stay reachable.

Containers and volumes are named and labelled with the host's ID, `dockerHost({ hostId })`, which defaults to `default`. Give each workspace that shares a Docker engine its own ID. A host removes computers under its ID that its Familiars don't have, and leaves every other ID's alone.

## Show a computer's status

The plugin serves `GET /plugins/computer/familiars/:familiar/status`, which returns the Familiar's `ComputerStatus`:

- `running` or `asleep`.
- `setting-up`: the image is still downloading.
- `none`: it has no computer, such as while one is being made.
- `unavailable`, with a `reason`, such as Docker not being installed or the cap being reached.

Allow `plugins.computer` in your `allow` for whoever may see it. See [routes](/familiar/reference/plugins/#routes).

## Watch a computer's screen

The plugin also serves `GET /plugins/computer/familiars/:familiar/screen`, a WebSocket of the computer's display as VNC (RFB) bytes, which a viewer such as [noVNC](https://novnc.com) speaks as it is. Give `createHttpApi` your runtime's Hono `upgradeWebSocket`, such as `@hono/node-server`'s, as the daemon does; without it, the route answers 501. The display is 1280×800 and shared by every viewer, with no password and no clipboard.

Watching never wakes a computer or keeps it awake. A sleeping computer's socket closes at once, and an open one closes when the computer goes to sleep, so ask again once its status says `running`. Use the viewer's view-only mode unless you hold control (below).

It needs the same `plugins.computer` permission as its status.

## Take over a computer

To use the computer yourself, for a sign-in or a CAPTCHA, hold `GET /plugins/computer/familiars/:familiar/control`, a WebSocket. It wakes a sleeping computer, and the server sends `held` once you have control. You have it until the socket closes, which hands it back at once:

- The server sends `ping` every 5 seconds. Answer each with any message: a socket silent for 15 seconds is taken as gone, such as a phone that lost its connection, and hands back.
- Only one person has control at a time. A second take-over is closed with code 4000 and why; so is one whose computer can't start.
- If the computer stops, or the daemon restarts, control ends and the socket closes.

While you have control, the computer stays awake. The Familiar's reads still run, with a note that someone is using it. Its actions wait, without their time limit running, and the chat shows "Waiting for you to hand back the computer". An action that waited never runs: its result tells the Familiar to look again. The Familiar's first call after you hand back is told too, so a take-over between its calls isn't missed.

Send input to the screen socket only while you hold control. This is coordination, not security: watching and taking over need the same permission.

## Saved logins

A Familiar can sign in to websites with logins you've saved for it, one per site and username:

- `saved_logins` lists the sites and usernames. Passwords are never shown.
- `request_login` asks you for a login in a private form in the chat. What you type goes to the plugin, not into the conversation or storage.
- `sign_in` fills in a saved login and submits it. It asks you first, showing the site and username.

`sign_in` fills a login only where the password stays on its site: the page, the form's frame and where the form sends it must all match the saved origin exactly, including `www`. Its form is made to send by POST, so the password never lands in the page's address, and snapshots mask every password field. A login it couldn't submit, such as with a required field still empty, is cleared from the field. These checks follow what a password manager does: they stop the form sending the password to another site, but a site's own script can read what's typed into its page.

The plugin serves the Familiar's logins on `GET`, `PUT` and `DELETE /plugins/computer/familiars/:familiar/logins`, which your settings UI can use. They need a `secrets` store in `openWorkspace`: they're kept there, encrypted by the daemon's store, and deleted when the Familiar is removed. Without one, the routes answer 503.

### The trust boundary

Saved logins keep passwords out of the chat, the transcript, workspace storage and what the model reads. They don't keep them from the computer. To sign in, the password is typed into the computer's browser, and the Familiar can run any command on that computer, as root. A Familiar set on it could read a password from the browser while a sign-in runs, or take the session it leaves signed in.

So save a login only where you'd be content for the Familiar to hold the account. Prefer accounts made for it, app passwords and scoped tokens to your own main logins. For anything else, take over the computer and sign in yourself: the Familiar then has the session, but never the password. A site that needs two-factor sign-in needs that anyway.

## Limits

- Docker only. Workspaces on Cloudflare and in a browser can't have computers yet.
- Disk use isn't capped. Each computer's home directory is a Docker volume that grows as the Familiar uses it.
- Verified with Docker Engine on Linux and Docker Desktop on Apple Silicon macOS. Docker Desktop on Windows hasn't been verified.
- The image is published for `linux/amd64` and `linux/arm64` only. Docker pulls the one for its machine.
