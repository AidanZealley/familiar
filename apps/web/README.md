# Familiar web app

The React UI shipped by the daemon: a sidebar of Familiars and rooms, the open conversation, and settings dialogs for each Familiar, each room and the app. Vite builds it; TanStack Router owns navigation. It depends on [@familiar-ai/client](../../packages/client/README.md), not core runtime code.

State has three owners. The client's stores own everything the event streams send: the workspace's for the app's lifetime, and a room's or a Familiar's while something on screen shows it (`useStream` in [`src/lib/streams.ts`](src/lib/streams.ts) opens each once and shares it). The sidebar opens no room's stream: the workspace's carries every room's latest entry, unread count and turns in progress, so its rows, and each conversation's header, read those, and an open conversation marks itself read while the page is visible ([`src/components/chat/read.ts`](src/components/chat/read.ts)). TanStack Query owns what the app fetches instead, such as connections, and each command's progress and failure; a command run with `mutationKey: ['connections']` refreshes the `['connections']` query when it succeeds. The URL owns where you are: the open conversation in the path, and the open dialog and its category in the search, so Back closes a dialog and a link can open one ([`src/lib/dialogs.ts`](src/lib/dialogs.ts)).

From the repository root, run `pnpm dev` for a scripted assistant with disposable storage. The UI listens on port 5174 and proxies `/api` to the demo on 4318; so does a bare `vite` in this package. Vite accepts LAN and tailnet connections. Run `pnpm build` to build the installed UI.

`pnpm dev:live` instead serves the UI on 5173 and proxies to the owner's running daemon on 4317. Use it only when you intend to read and change the real conversation.

## Familiars' portraits

Each Familiar has a pixel portrait: one of the 64×32 two-frame PNG strips in `public/avatars/`, named `000.png` to `111.png` ([`src/lib/avatars.ts`](src/lib/avatars.ts)). Its Profile settings choose one, stored as the Familiar's `avatar` (the strip's number, such as `042`); without a choice, Automatic picks one from its ID. The art isn't licensed for the repository yet, so the folder is gitignored and a portrait whose file is missing shows the Familiar's initial on its colour instead. To see the art locally, copy the strips into `public/avatars/` from the design prototype (`.design/redesign/public/avatars/` in the redesign worktree); the build copies whatever is there.

Components use the folder conventions in [AGENTS.md](../../AGENTS.md). `src/components/ui/` belongs to shadcn; compose and style those components rather than editing generated files. The UI uses Base UI's `render` prop.
