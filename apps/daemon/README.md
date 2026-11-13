# Familiar daemon

The installable Familiar: core and its Node building blocks, plus opinions. It adds the web search and fetch tools, the owner's own plugins from the data directory, ChatGPT sign-in, Web Push, CLI setup and services. It serves core's HTTP API and the built web UI. [examples/node-server](../../examples/node-server/) is built from the same pieces without those opinions.

User guides, including commands, settings and notifications, are under [Use Familiar](https://aidanzealley.github.io/familiar/use/install/) (publishes once GitHub Pages deployment is enabled).

## Installed assistant

Run the [installer](../../README.md#install), then open the URL it prints. Run `familiar --help` for commands.

The daemon listens on `127.0.0.1:4317` and authenticates every request as its owner, with the stable author ID `owner`. Setup publishes a private HTTPS URL when Tailscale is available. There is no separate app login: anyone with access can use the conversation, change credentials and install MCP tools, and local MCP commands run as the daemon's user. Keep the endpoint private.

The owner's plugins are `.ts` and `.js` files in `plugins/` in the data directory, loaded at start by [src/plugins.ts](src/plugins.ts). A file that fails to load is skipped and logged. [Extend your Familiar](https://aidanzealley.github.io/familiar/use/extend/) is the guide.

Settings live in `settings.json` in the data directory (`~/.local/share/familiar` on Linux, `~/Library/Application Support/Familiar` on macOS, `%LOCALAPPDATA%\Familiar` on Windows). `FAMILIAR_NAME`, `FAMILIAR_OWNER`, `FAMILIAR_PORT`, `FAMILIAR_MODEL`, `FAMILIAR_HOST` and `FAMILIAR_DATA_DIR` override them. Model choices live in [src/config.ts](src/config.ts).

## Development

From the repository root:

```sh
pnpm install
pnpm dev
```

This starts the scripted daemon on port 4318 and the UI on 5174 with disposable in-memory data. It opens on Rowan's household, a few days in: four Familiars, their DMs and rooms, memory, schedules and connections, with Spool still busy watching a print. The household is written as data in [src/demo/household/story.ts](src/demo/household/story.ts), each message with the replies it gets; add to it there. Anything the story doesn't script falls back to the scenarios: try `tool`, `memory`, `remind`, `key`, `mcp`, `slow`, `compact` or `error` in Juniper's DM, which has the demo plugin. Only the model and external services are simulated. Add scenarios under `src/demo/scenarios/` and register them in `src/demo/model.ts`.

`pnpm start` serves the real assistant; `pnpm sign-in` changes its saved provider login. In this package, `pnpm dev:live` starts a real daemon too. Use these only when you intend to work with that installation. Never run a second daemon over its storage. Leave the running service, port 4317 and its data untouched during ordinary development.

Memory's evals live in [src/memory-eval](src/memory-eval/) and save their results under `eval/results`. Everything here that names a model signs in through the eval's own ChatGPT login in `~/.local/share/familiar-eval/auth.json`, made with `FAMILIAR_DATA_DIR=~/.local/share/familiar-eval pnpm sign-in`, never the daemon's own. They never touch the live daemon or its data.

Without a model, deterministic and free:

- `pnpm eval:recall` and `pnpm eval:unfiled` check retrieval against a scripted year of conversation: the search alone with years of filler added, and what automatic recall shows of conversation compacted out of view with nothing filed.
- `pnpm eval:longmem-retrieval` asks whether memory's search puts a question's evidence in its top 5 and top 10 exchanges, on [LongMemEval](https://arxiv.org/abs/2410.10813) (Wu et al., 2024; the cleaned `longmemeval_s_cleaned` release, 500 questions each over about 50 sessions). Each question's whole haystack is written into a fresh workspace's Familiar conversation, then searched by the one function `openMemorySearch` in [longmem-retrieval.ts](src/memory-eval/longmem-retrieval.ts): question in, ranked exchanges out, as automatic recall ranks them. Journal lines are keys on their exchanges, but they exist only once a model has filed the history, so without a model this measures the index over exchanges alone. When memory searches differently, that function is the one place to change. It reports recall by answer session and by labelled answer turn, as _any_ (some evidence in the top k) and _all_ (every piece), per question type. `--set dev|holdout|milestone|full` (default `full`) and `--small-haystack` work as for `eval:longmem`.
- `pnpm eval:memory-speed` generates a ten-year store (about 100,000 exchanges, 200 pages with 2,000 notes, 11,000 journal lines) and times the first search after a restart, which loads every page and month and reads the transcript into the index, a warm search, automatic recall, and the memory section of the prompt. It also counts the documents warm searches read, which should be none.

With models:

- `pnpm eval:longmem` answers LongMemEval questions through a real workspace and has them judged. A question's history is written straight into the conversation as entries carrying their original dates, so any session, however it starts or ends, can be used and all 500 questions can run. Memory then files the whole history on the memory model as a backlog, each message dated from its own time, and consolidates it that night, as it would after the Familiar had been away; the question is asked in the same DM at its date, and LongMemEval's own judge prompts ([longmem-judge.ts](src/memory-eval/longmem-judge.ts), copied from its `evaluate_qa.py` with attribution) grade the reply. The conversation is marked compacted but for its latest turns, as it would be after a year of chat, so the reply model has memory and not the haystack.
  - `--set dev|holdout|milestone|full` picks the questions: `dev` is about 40, stratified by type including unanswerable ones; `holdout` is 80 more, disjoint, for questions nobody studies; `milestone` is both; `full` is all 500. The lists are fixed, seeded and committed in [eval/longmem-sets.json](../../eval/longmem-sets.json). Haystacks are full by default; `--small-haystack` keeps the evidence sessions and 10 fillers.
  - `--memory-model` (default `openai/gpt-6-luna`) files, `--model` (default `openai/gpt-6.1-sol`) replies, and `--judge` judges (default the reply model; `openai/gpt-4o-2024-08-06`, the model the published scores use, goes through `OPENAI_API_KEY`, or a key saved in `~/.local/share/familiar-eval/openai-api-key`). All three are recorded in the result, with tokens for each stage: filing, reply and judge.
  - Each question's filing, reply and verdict are saved as they finish in `~/.local/share/familiar-eval/longmem/<set>-<haystack>/`. Run the same command again and what is saved is skipped. A run refuses to mix results from a different model, set, haystack or code (a hash of Familiar's sources and the eval's stages): `--fresh` starts it again, `--run <name>` keeps both. A filing cut short is discarded and redone, since it is kept only once whole.
  - A rate or usage limit from the provider stops the run cleanly: it prints what finished, what is left and the command to continue, and exits 2. A limit is never counted as a wrong answer; the question it cut short has no verdict and runs again. `--wait` sleeps until the limit lifts (the provider's own reset time when the error gives one, else a back-off of up to an hour) and carries on.
  - Before committing, it measures the first 3 questions and prints the projected tokens for the rest, stopping if the run would pass `--max-tokens`. `--projection-only` stops there.
- `pnpm eval:memory-scenarios` plays ten short scripted scenarios of what LongMemEval can't see, in [scenarios.ts](src/memory-eval/scenarios.ts): a schedule that must not reach the prompt, a one-off request that must not be kept, a job's instruction that must not leak into an unrelated reply, two people's preferences in one room, a remark about someone else attributed correctly, a DM found in a room with where it came from, a correction that replaces, and a web page saying "remember that…". Each runs in a real workspace with real filing and consolidation and is graded only on behaviour: the reply, the memory section the model was shown and what recall showed it, by strings kept beside the scenario. Nothing internal (pages, notes, document shapes) is read, so the scenarios survive any change of memory's shape. `--only <id>` runs one.

Baseline on `main`'s memory, 2026-11-13, no model. Retrieval recall on all 500 questions with full haystacks, by answer session (the labelled answer turns are stricter, in the result file), as any@5, any@10, all@5, all@10:

1. single-session-user (64): 98%, 100%, 98%, 100%.
2. single-session-assistant (56): 100%, 100%, 100%, 100%.
3. single-session-preference (30): 70%, 87%, 70%, 87%.
4. multi-session (121): 98%, 98%, 60%, 78%.
5. knowledge-update (72): 100%, 100%, 92%, 97%.
6. temporal-reasoning (127): 93%, 97%, 71%, 81%.
7. unanswerable (30): 93%, 97%, 60%, 73%.
8. all 500: 95%, 98%, 77%, 87%. By labelled answer turn: 86%, 94%, 64%, 78%.

Speed of a ten-year store (98,549 exchanges, 2,000 facts, 4,292 episodes, 97 MB): the first search after a restart takes 4.2 s, which is the exchange index rebuilt from the whole transcript. A warm exchange search takes a median 54 ms (at most 355 ms). Automatic recall, which also searches facts and episodes, takes a median 14.5 s warm and 17.9 s on the first message after a restart. Almost all of that is searching the facts and episodes through the documents' proxies: the same search over plain copies takes 0.64 s. The memory section of the prompt renders in 3 ms. Timings vary by about a third between runs.

The model-backed evals' tests use scripted models and no network. LongMemEval is MIT licensed. The Hugging Face dataset card (`xiaowu0162/longmemeval-cleaned`) declares `license: mit`, and the code repository (`xiaowu0162/LongMemEval`) has `LICENSE`: "MIT License, Copyright (c) 2024 Di Wu". The release is downloaded once (277 MB, checked against its published SHA-256) into `~/.local/share/familiar-eval/longmemeval/` and never committed.

`pnpm bundle` creates the installable tarball; `pnpm test:release` verifies it using temporary storage. Both run from the repository root. The [release workflow](../../.github/workflows/release.yml) publishes tagged releases.

Start reading at `src/cli.ts`, the entry, then `src/daemon.ts`, which assembles the host, `src/serve.ts`, `src/config.ts` and `src/web/`, the web plugin. Platform setup is under `src/cli/`. Portable assistant capabilities belong in [core](../../packages/core/README.md), not this host.
