# Familiar web app

The React chat, Memory, Schedules and Connections UI shipped by the daemon. Vite builds it; TanStack Router owns navigation. It depends on [@familiar-ai/client](../../packages/client/README.md), not core runtime code.

State has two owners, both in [`src/lib/familiar.ts`](src/lib/familiar.ts). The client store owns everything the event stream sends. TanStack Query owns what the app fetches instead, such as connections, and each command's progress and failure; a command run with `mutationKey: ['connections']` refreshes the `['connections']` query when it succeeds.

From the repository root, run `pnpm dev` for a scripted assistant with disposable storage. The UI listens on port 5174 and proxies `/api` to the demo on 4318; so does a bare `vite` in this package. Vite accepts LAN and tailnet connections. Run `pnpm build` to build the installed UI.

`pnpm dev:live` instead serves the UI on 5173 and proxies to the owner's running daemon on 4317. Use it only when you intend to read and change the real conversation.

Components use the folder conventions in [AGENTS.md](../../AGENTS.md). `src/components/ui/` belongs to shadcn; compose and style those components rather than editing generated files. The UI uses Base UI's `render` prop.
