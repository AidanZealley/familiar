# Developing Familiar

For a source checkout:

```sh
pnpm install
pnpm sign-in
pnpm service:install
```

`pnpm service:install` builds the UI and installs the platform service. Rerun it to deploy source changes. On Linux, `pnpm service:logs` follows the systemd journal; the CLI's `logs` command works on all supported platforms.

Only one daemon may own the data directory; a second one refuses to start.

- **UI work:** `pnpm dev:web` runs Vite on `:5173` (LAN and tailnet) against the running service.
- **Daemon or core work:** `systemctl --user stop familiar`, then `pnpm dev` runs both with reloading. Start the service again when done.

Both use your real conversation and memory. For UI work that shouldn't, use the demo:

```sh
pnpm dev:demo
```

It runs a demo daemon on `:4318` and Vite on `:5174` (LAN and tailnet), alongside the service. The demo's model is scripted and needs no sign-in, and its conversation lives in memory, so every restart starts fresh; it never opens the data directory. It starts with sample memory, a year of facts, history and episodes about Rowan from the memory eval, so the Memory pages have something to show. Its two scripted models answer alike, so the model picker has a choice. A word in your message picks what it does:

| Word      | Familiar                                                                                    |
| --------- | ------------------------------------------------------------------------------------------- |
| (none)    | Replies with headings, lists, a table and code                                              |
| `tool`    | Pauses, streams expandable demo reasoning, calls `current_time`, pauses again, then replies |
| `memory`  | Calls `recall` for the morning drink, then replies with what it found                       |
| `remind`  | Schedules a reminder for the next minute, which then notifies                               |
| `key`     | Checks that a pretend service received the demo key without returning it                    |
| `mcp`     | Finds an MCP `echo` tool through tool search and calls it                                   |
| `slow`    | Writes a long reply, to try Stop and queued messages                                        |
| `compact` | Fills the context until Pi compacts it (the overflow error is expected)                     |
| `error`   | Fails partway with an error message                                                         |

The demo lives in `apps/daemon/src/demo/`: `main.ts` starts it, `model.ts` routes scripted responses, and `scenarios/` owns each feature's demonstration. The Connections page starts with pretend MCP servers in every state: connected, needing a token, failed, and a local command that exits after 20 seconds. Bearer servers accept `demo-token` and refuse anything else. Any other `*.demo.invalid` URL, or any command, serves an `echo` tool, so adding `http://echo.demo.invalid/mcp` from the page and saying `mcp` in chat tries a new server end to end. Nothing reaches the network or starts a process.

New scenarios belong beside the existing ones and are registered explicitly in `model.ts`; startup should stay wiring only. Only model responses and external services are faked. Memory, schedules, Connections and conversation storage use the real implementation, with in-memory data that disappears on restart.

## Cloudflare

`pnpm test:cloudflare` runs the development Worker in workerd. [Familiar on Cloudflare](cloudflare.md) covers the adapter, the Worker and deploying it.

## Release packaging

```sh
pnpm bundle          # Build apps/daemon/dist/familiar.tgz
pnpm test:release    # Install and verify it outside the repo, using temporary data
```

The package includes the CLI, web UI and HTML conversion worker. Piscina is its only runtime package dependency. Local builds use version `0.0.0`; set `RELEASE_VERSION` to build a specific version. Pushing a `v*` tag runs the checks and publishes the tarball as a GitHub Release asset. The release also includes `install.sh` and `install.ps1`, which download the package and hand setup to the CLI.

### npm packages

The libraries in `packages/` are published to npm under the `@familiar-ai` scope:

```sh
pnpm build:packages  # Compile each package's src into dist, with type declarations
pnpm test:packages   # Pack, install outside the repo, import in Node and type-check
```

In the workspace, each package's `exports` point at `src/*.ts`. The `publishConfig.exports` in each package point at `dist`; pnpm swaps them in when packing, along with real versions for `workspace:` and `catalog:`. Pi, Chord, Hono, the MCP client and `@familiar-ai/core` are peer dependencies, because hosts share their types and objects with Familiar, and a second copy would break both. The packages carry version `0.0.0`. A `v*` tag sets every package to the tag's version, checks them, and publishes them through npm trusted publishing, after the GitHub Release.

CLI management code and its tests live under `apps/daemon/src/cli/`, separate from daemon serving and the portable core. Shared paths, settings, credentials and Windows directory permissions belong to the Node host.

The CLI platforms workflow has passed on Linux, macOS and Windows. It validates native plist/task definitions without registering services, and checks installed packages using temporary storage. Linux lifecycle tests use fake system commands. Installer tests use temporary homes and fake downloads.

On a real Mac, setup, sign-in, repeat setup, crash recovery, rename restart, Tailscale publishing, uninstall and reinstall have been checked. macOS update and login-at-boot, all real Windows lifecycle checks, and installation from public release URLs remain pending.

## Memory evaluation

Three evals measure memory. The rot test and the unfiled test are quick and need no model; the replay is the real thing and takes hours.

```sh
pnpm eval:recall
```

The rot test asks exchange search alone `rowan-v3`'s questions, with no model: each day of the scenario becomes one exchange, then 1, 5 and 10 years of deterministic filler conversation (ten exchanges a day mentioning the same people and projects) are added after it. At each padding level it checks whether each required answer string appears in a scenario exchange among the top 5 and top 10 results, skipping the few required strings that appear nowhere in the scenario. It prints recall@5 and recall@10 by category and padding level, with index build time and median and maximum search times, and writes them to `eval/results/recall-<date>-<git-describe>.json`. It runs in seconds, so run it after any change to search or ranking; the scores should stay flat as padding grows.

```sh
pnpm eval:unfiled
```

The unfiled test measures what automatic recall shows of conversation that compaction took out of the model's view and upkeep hasn't filed yet. A scripted model replays `rowan-v3` in a 4,000-token budget with upkeep held off, so everything compacted stays unfiled, then each question is sent to a fresh copy of the replay and its recall note is checked for the required strings. It isolates retrieval: a year of unfiled conversation competes, where normally only the hours since the last 04:00 pass would, but facts and episodes are empty, so it can't show what giving exchanges part of the note costs them. It prints, by category, how many required strings the note contained, how many were still verbatim in the request, and how many only the note had, with the note's size, and writes them to `eval/results/unfiled-<date>-<git-describe>.json`. Unknown questions are scored only on their supporting details; whether the model then says it doesn't know needs the replay. It runs in seconds, so run it after any change to automatic recall.

The replay plays the scenario through a real model. Sign in once with a separate ChatGPT login file, then run it:

```sh
FAMILIAR_DATA_DIR=~/.local/share/familiar-eval pnpm sign-in
pnpm eval:memory
```

The eval creates a fresh Familiar in SQLite storage retained under its eval run directory. It replays `rowan-v3`, about a year of Rowan's life with far more lasting detail than core memory holds; its clock advances through 400 days and waits for each 04:00 memory upkeep pass. A 4,000-token context budget compacts old conversation so the questions exercise memory and history search. After replay it closes Familiar and asks each question in a fresh copy of the same SQLite file, three at a time. It asks 50 questions, 10 each about old details, earlier values of facts that changed, reasoning across sessions, periods of time, and things Rowan never said or hasn't decided. A judge model, pinned to `gpt-6.1-sol` (override with `FAMILIAR_JUDGE_MODEL`) so changing the model under test doesn't also change the grading, checks each answer against its required facts and checks any other claim against the scenario's full text. Expect about three hours with `gpt-6.1-sol`, mostly replay, depending on model latency and retries. The command prints scores by category and tokens spent on replay, answers and judging, and writes those totals, per-question tokens, the final memory and its character count, compaction count, daily upkeep outcomes, answer tool calls, full answers and verdicts to `eval/results/<date>-<git-describe>.json`. Dirty runs include `-dirty` in the filename. It reads and refreshes only the eval login in `~/.local/share/familiar-eval/auth.json`; it does not open your usual Familiar data directory.

The replay is kept in `~/.local/share/familiar-eval/runs/<time>-<commit>/`. If a run stops partway, for example at a ChatGPT usage limit, continue it from the day after the last one it sent:

```sh
pnpm eval:memory --resume ~/.local/share/familiar-eval/runs/<run>
```

A day whose reply failed stays in the conversation unanswered, and the result's `resumedFrom` records where the run continued.

After changing the judge, grade a saved run again instead of replaying it. This takes about a minute and writes `<result>.rejudged.json` beside the original:

```sh
pnpm eval:memory:rejudge eval/results/<file>.json
```
