# Easy install

Anyone should be able to run Familiar on a machine they own (a Linux box, a Mac mini, a VPS or a Windows PC) with one command, and move it to another machine later without losing anything. Release packages, guided setup and installers now support Linux, macOS and Windows. The remaining work is portable moves and safer updates, plus the native verification noted below.

The goal, from nothing:

```sh
curl -fsSL https://github.com/AidanZealley/familiar/releases/latest/download/install.sh | sh
```

It installs what's missing, signs in with ChatGPT, starts Familiar as a service and prints the URLs to open. Moving it:

```sh
ssh vps familiar export - | familiar import -
```

Known decisions:

- **One `familiar` command** replaces the pnpm scripts for people who aren't developing Familiar: `familiar` (setup, the default), `serve`, `sign-in`, `export`, `import`, `update`, `logs`, `uninstall`. Setup is idempotent, so running it again repairs an install. The pnpm scripts stay for development and call the same code.
- **Distributed through GitHub Releases, not the npm registry.** The name `familiar` is taken on npm, and the install script installs Node anyway, so a registry adds an account without making anything simpler. CI builds a package tarball for each version tag and attaches it to the release; `npm i -g <release URL>` installs it. Publishing to npm as well, for `npx`, can come later. This needs the repo (or at least its releases) public on GitHub.
- **The published app is bundled.** Node won't strip types from files inside `node_modules`, so development's run-unbuilt convention cannot be the release format. Bundle the application with Rolldown and ship the built web UI beside it. Web fetch now also runs `page-worker.ts`: ship a JavaScript worker entry and ensure the daemon resolves it correctly in the installed package. Keep Piscina as a runtime dependency so its own worker assets resolve normally; its optional native scheduling helper is not required for correctness. Storage uses Node's built-in `node:sqlite`.
- **Sign-in is ChatGPT's subscription login**, the Codex OAuth pi-ai already uses. OpenAI supports subscription OAuth in external tools; OpenClaw relies on it the same way. The pinned pi-ai 1.4.0 offers browser login with a pasted callback URL, but no device-code flow. Desktop setup opens the browser; headless setup prints the link and explains how to paste the final redirect URL. The web UI signs in the same way from any device, without a restart (`core/account`).
- **Remote access is Tailscale or nothing.** The daemon has no auth of its own: the network is the auth ([architecture rules](../architecture.md#rules)), so it only ever listens on `127.0.0.1`. Setup publishes it with `tailscale serve` when Tailscale is installed, which also gives the HTTPS the home-screen app and push need. Setup never binds a public address. Built-in auth is out of scope.
- **A move uses a versioned backup.** Conversation, memory and durable tasks live in SQLite; chosen settings live beside it. Export includes both, while provider login and machine-specific state stay behind. Stop the source before the final snapshot for a move (step 6).

Keep each milestone in its own commit. Guided setup and Linux service management are one milestone because setup installs the service. Finish service support on Linux, macOS and Windows before the install scripts. Linux and VPS support remains available while the other hosts are added.

Implemented: the CLI, release packaging, guided setup, platform service adapters, and shell/PowerShell installers. CI passes on all three platforms. Real macOS testing covers setup, sign-in, repeat setup, crash recovery, rename, Tailscale publishing, uninstall and reinstall.

Remaining work, in order:

1. Verify installation from published release assets. Real Windows lifecycle testing is deferred; Linux/VPS reboot checks and macOS update/login-at-boot checks remain pending.
2. Versioned export/import with consistent snapshots and safe replacement.
3. Strengthened update using that backup support, compatibility checks, migrations and recovery.

## Implementation boundaries

Keep command parsing in `apps/daemon/src/cli.ts`, with command handlers, interactive setup, sign-in, tailnet management and platform service code under `apps/daemon/src/cli/`. Keep tests beside those files. Package construction and installed-package verification stay under `apps/daemon/scripts/`.

Paths, saved settings, private directory permissions and model credentials are shared Node-host responsibilities and stay outside the CLI directory. Serving the assistant uses those directly and must not import CLI management code. Core and client packages do not depend on installation, OS services, filesystem paths or CLI state. Add a core change only when an explicit assistant capability requires it.

The daemon is still one runtime behind one stable CLI entry. Do not create a second daemon or a second configuration owner for installed packages. Preserve the old `main.ts` service entry as a compatibility boundary until existing installations no longer need it.

## 1. The `familiar` command

All of it lives in `apps/daemon`. Give each responsibility one owner:

- `src/cli.ts`: the `familiar` entry point. Parses the subcommand and calls one function; holds no logic of its own.
- `src/paths.ts`: where things live on this platform, the only place that decides. Data directory: `$FAMILIAR_DATA_DIR`, else `$XDG_DATA_HOME/familiar` or `~/.local/share/familiar` on Linux, `~/Library/Application Support/Familiar` on macOS, `%LOCALAPPDATA%\Familiar` on Windows. Keep an existing installation in its earlier XDG location on macOS or Windows unless the owner explicitly sets `FAMILIAR_DATA_DIR`. The web UI directory is relative to the running code, so it works both unbuilt in the repo and bundled.
- `src/settings.ts`: reads `settings.json` in the data directory (name, owner, model, port), which setup writes only for explicit choices. Defaults remain in code so they can change with later releases. Environment variables override it, so the demo, the eval and development keep working unchanged. This replaces `config.ts`'s environment-only settings, which the service never sees.

`main.ts` becomes `familiar serve`; `sign-in.ts` becomes `familiar sign-in`.

Done when `node apps/daemon/src/cli.ts serve` runs the daemon, the pnpm scripts call the CLI, and every existing test passes.

Step 1 is implemented. The CLI dispatches commands; `familiar` without a subcommand now starts guided setup. Existing service units can still run `main.ts`. Tests cover settings, platform paths and CLI startup with temporary SQLite storage.

## 2. The release package

1. A `bundle` script in `apps/daemon` that builds the web UI, bundles `src/cli.ts` with Rolldown into `dist/familiar.js` and `src/page-worker.ts` into `dist/page-worker.js` (Node target, `node:*` and Piscina external), and copies the web build to `dist/web/`. Resolve the page worker correctly in both source and installed builds.
2. A package manifest for the bundle with `"bin": { "familiar": "familiar.js" }`, `"engines": { "node": ">=24.19" }`, and Piscina as a pinned runtime dependency. Include both application entries and the web assets, then `npm pack` it.
3. A GitHub Actions workflow: on a `v*` tag, run the hand-off checks, bundle, pack, and attach `familiar.tgz` to the release. Use the repository's GitHub remote for release assets.

Done when `npm i -g ./familiar.tgz` on a machine with only Node gives a working `familiar serve` that serves the UI and can convert an HTML page through its worker.

Step 2 is implemented. `pnpm bundle` writes `apps/daemon/dist/familiar.tgz`, using `RELEASE_VERSION` or `0.0.0` for a local build. `pnpm test:release` installs that tarball into a temporary global prefix outside the workspace, then checks the CLI, HTTP API, web assets, HTML conversion worker and lazy ChatGPT sign-in module. A `v*` tag runs the checks and attaches the tested tarball to a GitHub Release.

## 3. Setup

`familiar` with no subcommand. Each step checks before it acts, so a second run changes nothing that's already right:

1. **Settings.** On first run, ask for the assistant's name (default `Familiar`) and write `settings.json`.
2. **Sign in**, unless Pi's `checkAuth` reports a saved OAuth login. This check does not refresh tokens, so the running daemon remains their only writer. The pinned Pi version only supports browser login: open the URL on a desktop, or explain how to open it on another device and paste the final redirect URL over SSH or without a display. An expired token is refreshed by the daemon when needed; use `familiar sign-in` or the web UI to replace a rejected login.
3. **Install the service** (step 4).
4. **Publish** on the tailnet if `tailscale` is installed and logged in: `tailscale serve --bg --https=10000 http://127.0.0.1:<port>`, skipped when `tailscale serve status` already shows it. On Linux this needs `tailscale set --operator=$USER` once; when it fails for that reason, print the one `sudo` command to run and continue. Find the CLI on macOS inside `/Applications/Tailscale.app` when it isn't on `PATH`.
5. **Print the URLs**: local always, the tailnet HTTPS address when published, otherwise one line on installing Tailscale to reach it from other devices.

Done when setup on a fresh Linux machine ends with a working URL, and a second run reports everything as already done.

## 4. Services

`src/cli/service/` owns "run at boot". `index.ts` picks the implementation for `process.platform`; each one offers the same `install`, `uninstall`, `restart`, `isRunning` and `logs`. Each writes a unit that runs `<node> <installed familiar.js> serve` with absolute paths, and keeps the content in a pure function so tests can check it without touching the system.

- **Linux:** the systemd user unit from today's `install-service.ts`, plus `loginctl enable-linger $USER` so it runs with nobody logged in, which is what a VPS needs. Logs: `journalctl --user -u familiar`.
- **macOS:** a LaunchAgent in `~/Library/LaunchAgents` with `RunAtLoad` and `KeepAlive`, logging to a file in the data directory. A LaunchAgent runs only while its user is logged in, so setup says to turn on automatic login for a headless Mac mini.
- **Windows:** a Scheduled Task at logon that restarts on failure, created with `schtasks`. If creating it is refused, fall back to a shortcut in the user's Startup folder, as OpenClaw does. Logs to a file in the data directory.

`familiar update` installs the latest release's tarball and restarts the service. `familiar uninstall` removes the service and the tailnet publication, and leaves the data directory, saying where it is.

Done when the unit-content tests pass and setup, a reboot, `update` and `uninstall` work on Linux and on a VPS; then on macOS; then on Windows.

Guided setup and Linux service management are implemented. Default `familiar` saves settings, reuses or obtains a ChatGPT login, installs the service and prints local and tailnet URLs. `status`, `rename`, `logs`, `update` and `uninstall` use the same service owner. `status` reads the saved name, matching service state and existing URLs without changing them. `rename [name]` saves only the name and restarts a running matching service; without a name it prompts. Sign-in and updates pause this installation's running service and resume it even on failure. Setup saves the chosen name and explicit overrides, leaving model, owner and port defaults in code. Repeat setup preserves settings and an already-running service; changed settings restart it. Setup waits for the local API before printing its URLs. The unit has been validated with systemd, and packaged setup is tested with temporary storage and fake system commands. A real reboot/VPS check is still pending. macOS and Windows service adapters are implemented; native lifecycle and reboot verification is still pending.

The platform adapters now cover macOS LaunchAgents, Windows Scheduled Tasks and the Startup fallback. The remaining platform milestone is native lifecycle verification. Each must cover installation, status, restart, temporary suspension for sign-in/update, logs and removal. Check platform command execution, paths with spaces and user sessions on native hosts before calling support verified. Windows also needs a safe way to invoke npm's `.cmd` launcher. The installer then delegates setup to these implementations instead of reimplementing service management.

Platform details:

- A macOS LaunchAgent uses the logged-in GUI user domain. Unloading it pauses KeepAlive during sign-in and updates; loading it resumes the same instance. Its definition keeps Node, the CLI, data directory, working directory and log path explicit.
- Windows uses a per-user SID task name and an interactive logon principal without elevation. Node is a console program, so the task and the Startup shortcut run `wscript.exe` with a small `.vbs` script that starts the Node launcher with no window, waits and passes its exit code back. Without it, Windows opens a console window, and closing it stops Familiar. The Node launcher owns stdout/stderr files and forwards the daemon exit code for task restart-on-failure. Microsoft is retiring VBScript; if it is disabled, replace the `.vbs` wrapper (a tray app or `conhost.exe --headless` are candidates). Stopping disables scheduled restart before terminating that launcher's process tree, including child MCP processes. The Startup shortcut fallback reports that it lacks automatic crash recovery.
- Native subprocess arguments, paths with spaces and non-ASCII characters require platform verification. npm execution uses cross-spawn rather than interpolating `.cmd` arguments into a shell. The host protects Windows data with owner ACLs, since POSIX mode bits do not enforce Windows privacy.
- `.github/workflows/cli-platforms.yml` runs targeted tests and package checks on all three OSes. Native validation parses launchd plists and creates an in-memory Windows task definition without registering it. Service lifecycle tests mock system commands; a real login/reboot exercise remains separate and must use disposable storage and service entries. The workflow has passed on all three platforms. Real macOS setup, crash recovery, rename restart, Tailscale publishing and removal have been checked; update and login-at-boot remain pending. Real Windows lifecycle testing is deferred.

## 5. The install scripts

`install.sh` (Linux, macOS, WSL) and `install.ps1` (Windows) at the repo root:

1. Install Node 24 if `node` is missing or older, from nodejs.org's official binaries into the user's home, with no `sudo`. Use a fixed directory rather than one named by version: service definitions record Node's absolute path.
2. Install the latest release's `familiar.tgz` into a prefix the user owns, so nothing needs `sudo` and the service never runs root-owned files. npm's default global prefix is often root-owned (`/usr/local` on many Macs), so `install.sh` passes `npm i -g --prefix ~/.local`, giving `~/.local/bin/familiar`, and adds `~/.local/bin` to the shell profile's `PATH` when it is missing. Windows' default prefix, `%APPDATA%\npm`, is already per-user and on `PATH`. `familiar update` reinstalls into the prefix it was installed from.
3. Run `familiar`, passing the terminal through so sign-in can prompt. `curl … | sh` leaves stdin as the script, so read prompts from `/dev/tty`.

Done when each script takes a fresh machine of its kind to a working URL.

The scripts are implemented at the repo root and attached to each release beside `familiar.tgz`. They reuse Node 24.19 or newer, otherwise download Node 24.19.0 x64/arm64 from nodejs.org and verify it against the published SHA-256 list. The managed runtime uses a fixed path, `~/.local/share/familiar-node` or `%APPDATA%\npm`. Windows keeps the managed Node beside the npm command shims so they use it even when an older system Node takes precedence on PATH. Each script saves PATH for new terminals and runs the installed command; the shell script reads setup input from `/dev/tty`. Without a terminal it prints how to finish setup.

`FAMILIAR_VERSION` selects `latest` or a `v`-prefixed release tag. `FAMILIAR_NO_SETUP=1` installs without starting setup. End-to-end installation from the public release URLs remains to be checked on a real machine. Automated installer checks use fake downloads and temporary homes; native PowerShell coverage runs in Windows CI. Keep service and data management in the CLI.

## 6. Export and import

`src/cli/snapshot.ts` owns the backup format and snapshot operations. Use the same operations for export/import and update recovery.

An export is one versioned archive containing a manifest, a consistent `familiar.sqlite` snapshot and explicit portable settings such as name, owner and chosen model. Define its exact encoding before implementing it, using an existing archive implementation. The manifest records backup format, application version and storage/document versions needed for compatibility checks.

Exclude ChatGPT credentials, installation ID, provider tokens, locks, service definitions, executable launchers, ports and Web Push registrations. Explain which plugin credentials must be entered again on the destination. Imported MCP declarations remain visible, but machine-specific local commands require review before any startup that could execute them. An export contains private conversation and may contain secrets the owner entered into chat or command arguments.

**`familiar export <file>`**, or `-` for stdout:

1. Explain that this is a move by default and confirm stopping the source. Stop it before taking the final consistent snapshot so no later messages or tasks are left behind.
2. Use SQLite's snapshot interface or `VACUUM INTO` to create the database copy, rather than copying a live main file without its write-ahead log. Open SQLite directly, without opening another Pi storage owner.
3. Finish and validate the archive before reporting success. A failed export leaves the original data intact and offers to resume a source stopped for the move.
4. Leave the source stopped after a successful move. An explicit `--keep-running` backup mode may snapshot a running instance; explain that starting both copies creates diverging assistants.

**`familiar import <file>`**, or `-` for stdin:

1. Validate the archive and compatibility before changing the destination. Reject unsafe paths and unsupported newer formats with actionable instructions. Inspect the pinned Pi version's actual checks instead of assuming a newer database is safe to open.
2. Require explicit replacement when an existing destination conversation is present, show what will be replaced and retain a recovery copy. Setup may already have created a new conversation, so guide the owner through this case.
3. Show saved stdio MCP commands and arguments and obtain acceptance before startup. Missing executables need reconfiguration. Sign in separately on the destination; keep the destination's machine-specific service/network settings.
4. Stop the destination, install the validated snapshot and portable settings, then start it. On failure preserve both the old destination and the imported backup, and report recovery steps.

File transfer is separate. A USB drive, shared folder or `scp` moves the same archive. Optional SSH streaming uses stdout only for backup bytes, stderr for progress and a terminal for prompts, so piping cannot mix messages into the archive. Do not build a file-transfer service.

Durable tasks travel with the database. Document how overdue upkeep and schedules resume, and keep the source stopped to prevent duplicate work.

Done when temporary-directory tests and a real move verify transcript, facts, episodes and schedules survive; settings retain explicit choices; secrets and machine state stay behind; invalid/newer files are refused before mutation; replacement is recoverable; and failed export/import does not destroy either copy. Test every supported source/destination OS pair before claiming portable moves verified.

## 7. Strengthened update

The existing `familiar update` downloads the latest tagged GitHub Release and resumes the service. The following safeguards are required before treating upgrades as generally safe. Pushing source commits alone does not publish an update.

1. Resolve the target version and its Node, backup, storage and memory-document compatibility requirements before replacing the installation. Refuse unsupported upgrades or downgrades without opening incompatible data. Missing or unsupported memory formats must produce a clear error, never an empty replacement memory.
2. Pause the matching running instance and create a consistent recovery backup through step 6. Retain the previous application version alongside its matching backup. Backup failure aborts the upgrade before replacing code or data.
3. Install the target package and run explicit, ordered migrations. Use Pi's migration interfaces for its schema and Familiar-owned migrations for its document changes. Preserve transcript, memory, episodes and schedules. Default changes must not become accidental user overrides.
4. Validate the new instance and local API before reporting success. Apply required service-definition changes without silently repeating interactive login or changing network publication. Preserve the owner's prior running/stopped state.
5. On failure provide recovery to the previous application plus its matching data. Do not run old code against a database already migrated to an unsupported format. Preserve any post-upgrade data before recovery; never silently discard messages written after the backup.

Done when saved fixtures from supported older releases upgrade with their data readable, incompatible newer fixtures are refused, and failures during download, backup, migration and startup leave a usable recovery path. Test update on Linux, macOS and Windows. A passing fresh-install test does not establish upgrade compatibility.

## 8. Documentation

The README is a short introduction with install commands for all three platforms. [Usage](../usage.md) owns setup, commands and settings; [development](../development.md) owns source builds and packaging; [architecture](../architecture.md) owns the layout and rules. Update the usage guide when export/import and safer updates are implemented.

## Out of scope

- **Built-in auth** (pairing codes or passkeys), and with it public access through Caddy or a Cloudflare Tunnel. `createHttpApi`'s `authenticate` hook is where it would go; Gatherbot needs the same.
- **Single executables** with Node built in (Node SEA). Worth it only if installing Node proves to be the obstacle.
- **Publishing to npm** for `npx`.
- **Importing into a Cloudflare Durable Object.** Node and Cloudflare share Pi's SQLite tables, so this would copy rows rather than convert a format; do it with Gatherbot.
- **Encrypting exports.**
