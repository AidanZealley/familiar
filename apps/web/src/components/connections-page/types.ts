/** The active form and, for edits, the connection it belongs to. */
export type DrawerState =
  { type: 'add' } | { type: 'edit'; id: string; error?: string }
