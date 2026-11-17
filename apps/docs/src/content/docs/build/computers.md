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

When the workspace opens, the host starts downloading the computers' image in the background, so it's usually ready before anyone needs it. The image is about 420 MB to download and 1.5 GB unpacked. Its tag matches the package's version.

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

A Familiar with a computer has eight tools. Each call goes to that Familiar's own computer, never another's.

- `browser_snapshot`: the open page as text, with a ref for each element.
- `browser_screenshot`: a picture of the open page.
- `browser_navigate`: opens an address.
- `browser_click`: clicks an element by its ref.
- `browser_type`: fills in a field, optionally pressing Enter.
- `run_command`: runs a shell command in its home directory, for up to 10 minutes.
- `read_file`: reads a text file.
- `write_file`: writes a text file.

The browser is Chromium, run headless. Long results are shortened. For commands, the end of the output is kept.

The three tools that only look (`browser_snapshot`, `browser_screenshot` and `read_file`) and `browser_navigate` run at once. The others ask the person first, as any tool that might change something does. Keep that default where your UI can answer approvals.

The Node server example's UI can't, so it chooses to let every computer tool run unattended:

```ts
await workspace.connections.setPolicy(
  { kind: 'plugin', name: 'computer' },
  undefined,
  'allow',
)
```

Then nobody approves what the Familiar does with its browser and shell. It can submit forms, post, buy, upload its files and download whatever it's led to on any public site. Isolation protects your machine, not the services the computer can reach.

The three that only look are also safe to run again after a restart. Familiar reports any other call that a restart interrupted, so the model looks before trying again.

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

## Limits

- Docker only. Workspaces on Cloudflare and in a browser can't have computers yet.
- Disk use isn't capped. Each computer's home directory is a Docker volume that grows as the Familiar uses it.
- Verified with Docker Engine on Linux. Docker Desktop on macOS and Windows hasn't been verified.
- The image is published for `linux/amd64` and `linux/arm64` only. Docker pulls the one for its machine.
