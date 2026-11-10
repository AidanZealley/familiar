# Node server example

One Familiar in a Node process, with its own sign-in and UI. It's built from the same pieces as the installable daemon, without the daemon's opinions: no web tools, no network-as-auth and no installer.

```sh
cp .env.example .env    # then fill it in
pnpm install
pnpm --filter @familiar-example/node-server dev       # the server, on :4320
pnpm --filter @familiar-example/node-server dev:web   # the UI, on Vite's port
```

For production, `pnpm build` writes the UI to `dist/web`, and `pnpm start` serves it with the API.

It needs an [OpenRouter](https://openrouter.ai) API key for the model. To try the GitHub tool, paste a fine-grained GitHub token under Connections, then ask Familiar what's assigned to you.

## How it fits together

- `src/server.ts` opens the workspace, makes its one Familiar on the first run, and serves it with Hono: `/auth` for signing in, `/api` for Familiar's HTTP API, and the built UI. Storage is SQLite in `data/`, which `lockDataDir` keeps to one process.
- `src/auth.ts` signs one owner in with a password and keeps them signed in with a signed, HTTP-only cookie. A browser sends that cookie with requests from any site, so `server.ts` puts Hono's `csrf()` in front of everything.
- `src/access.ts` lists the API operations the owner may use. Anything Familiar adds later is refused until it's added there.
- `src/plugins/github.ts` is a plugin: one plain Pi tool and a declared GitHub token. Familiar sends the token only with `GET https://api.github.com/issues`. The tool never sees it.
- `src/config.ts` reads `.env` and refuses to start without what it needs. Set `FAMILIAR_ORIGIN` to the `https://` address people use, so session cookies are only sent over HTTPS even when a proxy forwards plain HTTP.
- `web/` is a small UI on `@familiar-ai/client`: sign in, chat in your DM with the Familiar and set the plugin's token.

Tools reach the network through Familiar's default `fetch`, which on Node refuses private addresses. The server passes no `fetch` of its own.

## Not covered

- Sign-in attempts aren't rate-limited. Put that in front of `/auth/sign-in`, or behind a proxy that does, before exposing the server to the internet.
- Signing out clears this browser's cookie. To sign every browser out, change `FAMILIAR_SESSION_SECRET`.
- One person. For several, give `authenticate` your real users and narrow `allow` per person. See [Serve the API](https://aidanzealley.github.io/familiar/build/serve-the-api/).
