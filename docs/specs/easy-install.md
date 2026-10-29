# Easy install

Anyone should be able to run Familiar on a machine they own (a Linux box, a Mac mini, a VPS or a Windows PC) with one command, and move it to another machine later without losing anything. Today it takes a clone, pnpm, `pnpm sign-in`, `pnpm service:install` and a hand-run `tailscale serve`, and it works only on Linux.

The goal, from nothing:

```sh
curl -fsSL https://raw.githubusercontent.com/<owner>/familiar/main/install.sh | sh
```

It installs what's missing, signs in with ChatGPT, starts Familiar as a service and prints the URLs to open. Moving it:

```sh
ssh vps familiar export - | familiar import -
```

Known decisions:

- **One `familiar` command** replaces the pnpm scripts for people who aren't developing Familiar: `familiar` (setup, the default), `serve`, `sign-in`, `export`, `import`, `update`, `logs`, `uninstall`. Setup is idempotent, so running it again repairs an install. The pnpm scripts stay for development and call the same code.
- **Distributed through GitHub Releases, not the npm registry.** The name `familiar` is taken on npm, and the install script installs Node anyway, so a registry adds an account without making anything simpler. CI builds a package tarball for each version tag and attaches it to the release; `npm i -g <release URL>` installs it. Publishing to npm as well, for `npx`, can come later. This needs the repo (or at least its releases) public on GitHub.
- **The published app is bundled.** Node won't strip types from files inside `node_modules`, so development's run-unbuilt convention cannot be the release format. Bundle the application with Rolldown and ship the built web UI beside it. Web fetch now also runs `page-worker.ts`: ship a JavaScript worker entry and ensure the daemon resolves it correctly in the installed package. Keep Piscina as a runtime dependency so its own worker assets resolve normally; its optional native scheduling helper is not required for correctness. Storage uses Node's built-in `node:sqlite`.
- **Sign-in is ChatGPT's subscription login**, the Codex OAuth pi-ai already uses. OpenAI supports subscription OAuth in external tools; OpenClaw relies on it the same way. pi-ai offers "Browser login" and "Device code login (headless)"; setup picks for the user (step 3).
- **Remote access is Tailscale or nothing.** The daemon has no auth of its own: the network is the auth (README Rules), so it only ever listens on `127.0.0.1`. Setup publishes it with `tailscale serve` when Tailscale is installed, which also gives the HTTPS the home-screen app and push need. Setup never binds a public address. Built-in auth is out of scope.
- **The conversation file is the unit of portability.** Everything a Familiar is (conversation, facts, history, episodes, durable tasks) is in `familiar.sqlite`. Export is a consistent snapshot of that file; the login stays behind (step 6).

Do the steps in order and commit each separately. Steps 1–4 alone give a one-command install on Linux and VPSs.

## 1. The `familiar` command

All of it lives in `apps/daemon`. Give each responsibility one owner:

- `src/cli.ts`: the `familiar` entry point. Parses the subcommand and calls one function; holds no logic of its own.
- `src/paths.ts`: where things live on this platform, the only place that decides. Data directory: `$FAMILIAR_DATA_DIR`, else `$XDG_DATA_HOME/familiar` or `~/.local/share/familiar` on Linux, `~/Library/Application Support/Familiar` on macOS, `%LOCALAPPDATA%\Familiar` on Windows. The web UI directory, relative to the running code, so it works both unbuilt in the repo and bundled.
- `src/settings.ts`: reads `settings.json` in the data directory (name, owner, model, port), which setup writes. Environment variables override it, so the demo, the eval and development keep working unchanged. This replaces `config.ts`'s environment-only settings, which the service never sees.

`main.ts` becomes `familiar serve`; `sign-in.ts` becomes `familiar sign-in`.

Done when `node apps/daemon/src/cli.ts serve` runs the daemon, the pnpm scripts call the CLI, and every existing test passes.

## 2. The release package

1. A `bundle` script in `apps/daemon` that builds the web UI, bundles `src/cli.ts` with Rolldown into `dist/familiar.js` and `src/page-worker.ts` into `dist/page-worker.js` (Node target, `node:*` and Piscina external), and copies the web build to `dist/web/`. Resolve the page worker correctly in both source and installed builds.
2. A package manifest for the bundle with `"bin": { "familiar": "familiar.js" }`, `"engines": { "node": ">=24.19" }`, and Piscina as a pinned runtime dependency. Include both application entries and the web assets, then `npm pack` it.
3. A GitHub Actions workflow: on a `v*` tag, run the hand-off checks, bundle, pack, and attach `familiar.tgz` to the release. Use the repository's GitHub remote for release assets.

Done when `npm i -g ./familiar.tgz` on a machine with only Node gives a working `familiar serve` that serves the UI and can convert an HTML page through its worker.

## 3. Setup

`familiar` with no subcommand. Each step checks before it acts, so a second run changes nothing that's already right:

1. **Settings.** On first run, ask for the assistant's name (default `Familiar`) and write `settings.json`.
2. **Sign in**, unless `auth.json` holds a working login. Answer pi-ai's login choice for the user: device code when there's no display (`SSH_CONNECTION` set, or on Linux neither `DISPLAY` nor `WAYLAND_DISPLAY`), otherwise browser login, opening the URL with `open`, `xdg-open` or `start`. Keep the paste-the-URL fallback.
3. **Install the service** (step 4).
4. **Publish** on the tailnet if `tailscale` is installed and logged in: `tailscale serve --bg --https=10000 http://127.0.0.1:<port>`, skipped when `tailscale serve status` already shows it. On Linux this needs `tailscale set --operator=$USER` once; when it fails for that reason, print the one `sudo` command to run and continue. Find the CLI on macOS inside `/Applications/Tailscale.app` when it isn't on `PATH`.
5. **Print the URLs**: local always, the tailnet HTTPS address when published, otherwise one line on installing Tailscale to reach it from other devices.

Done when setup on a fresh Linux machine ends with a working URL, and a second run reports everything as already done.

## 4. Services

`src/service/` owns "run at boot". `index.ts` picks the implementation for `process.platform`; each one offers the same `install`, `uninstall`, `restart`, `isRunning` and `logs`. Each writes a unit that runs `<node> <installed familiar.js> serve` with absolute paths, and keeps the content in a pure function so tests can check it without touching the system.

- **Linux:** the systemd user unit from today's `install-service.ts`, plus `loginctl enable-linger $USER` so it runs with nobody logged in, which is what a VPS needs. Logs: `journalctl --user -u familiar`.
- **macOS:** a LaunchAgent in `~/Library/LaunchAgents` with `RunAtLoad` and `KeepAlive`, logging to a file in the data directory. A LaunchAgent runs only while its user is logged in, so setup says to turn on automatic login for a headless Mac mini.
- **Windows:** a Scheduled Task at logon that restarts on failure, created with `schtasks`. If creating it is refused, fall back to a shortcut in the user's Startup folder, as OpenClaw does. Logs to a file in the data directory.

`familiar update` installs the latest release's tarball and restarts the service. `familiar uninstall` removes the service and the tailnet publication, and leaves the data directory, saying where it is.

Done when the unit-content tests pass and setup, a reboot, `update` and `uninstall` work on Linux and on a VPS; then on macOS; then on Windows.

## 5. The install scripts

`install.sh` (Linux, macOS, WSL) and `install.ps1` (Windows) at the repo root:

1. Install Node 24 if `node` is missing or older, from nodejs.org's official binaries into the user's home, with no `sudo`.
2. `npm i -g` the latest release's `familiar.tgz`.
3. Run `familiar`, passing the terminal through so sign-in can prompt. `curl … | sh` leaves stdin as the script, so read prompts from `/dev/tty`.

Done when each script takes a fresh machine of its kind to a working URL.

## 6. Export and import

`src/snapshot.ts` owns both.

**`familiar export <file>`** (or `-` for stdout):

1. Write a consistent snapshot of `familiar.sqlite` with SQLite's `VACUUM INTO`, through `node:sqlite` directly, read-only. This is safe while the daemon runs: SQLite allows other readers alongside the write-ahead log, and it doesn't open Pi storage, so it doesn't break the one-owner rule. Copying the files by hand can catch a write halfway.
2. Leave `auth.json` and `device-id` out. The login's refresh token changes on every refresh, so two machines sharing one would break each other's sign-in; signing in again with the device code takes seconds. Say that the file holds everything the owner has told Familiar and should be kept private.
3. Then ask whether to stop this Familiar so only the new copy runs, defaulting to yes; skip the question with `--keep-running`. Two copies of one Familiar running at once diverge for good, and the data directory's lock can't see across machines.

**`familiar import <file>`** (or `-` for stdin):

1. Check that the file is a SQLite database with Pi's tables, without opening it as Pi storage.
2. Refuse when the data directory already has a conversation, unless given `--replace`, which renames the old file to `familiar.sqlite.replaced-<time>` first.
3. Stop the service if it runs, put the file in place, start it again.

Durable tasks travel inside the file, so anything that fell due in transit (nightly upkeep and schedules) runs when the new machine starts. Find out how the installed pi-durable treats a file written by a newer version of itself, and make import say "update Familiar first" in that case rather than fail obscurely.

Tests, with temporary directories:

- Exporting a Familiar on SQLite storage while it's open, after the faux model has replied and saved a fact, gives a file a new Familiar opens with the same transcript and memory.
- Export never contains `auth.json` or `device-id` content.
- Import refuses an existing conversation without `--replace`, and with it keeps the old file aside.
- Import rejects a file that isn't a Familiar export.

Done when the tests pass and `ssh <vps> familiar export - | familiar import -` moves a real install, after which the old one is stopped.

## 7. Documentation

Rewrite the README's "Use it" around the install command, setup, moving and updating, and move today's pnpm instructions under Developing.

## Out of scope

- **Built-in auth** (pairing codes or passkeys), and with it public access through Caddy or a Cloudflare Tunnel. `createHttpApi`'s `authenticate` hook is where it would go; Gatherbot needs the same.
- **Single executables** with Node built in (Node SEA). Worth it only if installing Node proves to be the obstacle.
- **Publishing to npm** for `npx`.
- **Importing into a Cloudflare Durable Object.** Node and Cloudflare share Pi's SQLite tables, so this would copy rows rather than convert a format; do it with Gatherbot.
- **Encrypting exports.**
