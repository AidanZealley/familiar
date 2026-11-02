# Typed host client example

A compile-checked example of a frontend typed from the Familiar routes its host mounts. It is a library integration fixture, not a running demo or server.

`host.ts` composes conversation and memory routes plus a conversation stream. `api.ts` exports only types. `frontend.ts` creates the typed client and React bindings; `frontend.typecheck.ts` checks rejected API shapes. The constant author is sample attribution, not authentication.

From the repository root:

```sh
pnpm --filter @familiar-example/host typecheck
pnpm test:packages
```

The package check also compiles the frontend against packed packages outside the workspace. Read the [typed host guide](../../docs/typed-host-client.md) for mounting, declaration publishing and limits.
