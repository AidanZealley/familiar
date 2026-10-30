/** Which drawer is open. Editing applies to the selected connection. */
export type DrawerState = { type: 'add' } | { type: 'edit'; error?: string }
