# Familiar agent guide

Edit this file only when explicitly instructed to do so.

## Conventions

- Prefer `type` over `interface`. Name prop types `ComponentNameProps`.
- Web components use `components/<kebab-name>/<PascalName>.tsx`, an `index.ts` re-export, `types.ts` for props, and children under `components/`. One component per file, named `export const`.
- Never edit `apps/web/src/components/ui/`; shadcn owns it. Style with `className`. The UI uses Base UI, so use `render`, not `asChild`.
