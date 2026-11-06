# Familiar agent guide

Edit this file only when explicitly instructed to do so.

## Conventions

- Prefer `type` over `interface`. Name prop types `ComponentNameProps`.
- Web components use `components/<kebab-name>/<PascalName>.tsx`, an `index.ts` re-export, `types.ts` for props, and children under `components/`. One component per file, named `export const`.
- shadcn owns `apps/web/src/components/ui/`. Style its components with `className` or wrap them. If a change seems to need an edit inside it, ask Aidan before making it. The UI uses Base UI, so use `render`, not `asChild`.
