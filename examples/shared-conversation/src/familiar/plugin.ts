import { definePlugin, defineTool, Type, type Author } from '@familiar-ai/core'

const result = (text: string, isError = false) => ({
  output: [{ type: 'text' as const, text }],
  ...(isError && { isError }),
})

/**
 * Two tools that act for the person who asked. Neither takes a name: both read
 * `api.author`, which Familiar resolves from the message that started the
 * run, so it is whoever the host signed that message in as.
 */
export const guestListPlugin = () => {
  // The host's data for this page: who's coming, by stable ID.
  const going = new Map<string, Author>()

  return definePlugin({
    name: 'guest-list',
    title: 'Guest list',
    extension: () => ({
      tools: [
        defineTool({
          name: 'who_am_i',
          description: 'Says who the host signed the person asking in as.',
          parameters: Type.Object({}),
          replay: 'safe',
          execute: async (_args, { author }) =>
            author
              ? result(
                  `You're signed in as ${author.name} (ID "${author.id}").`,
                )
              : result('Nobody asked.', true),
        }),
        defineTool({
          name: 'count_me_in',
          description: 'Adds the person asking to the guest list.',
          parameters: Type.Object({}),
          execute: async (_args, { author }) => {
            if (!author) {
              return result('Nobody asked, so there is no one to add.', true)
            }
            going.set(author.id, author)
            const names = [...going.values()].map(({ name }) => name)
            return result(
              `Counted ${author.name} in. Going: ${names.join(', ')}.`,
            )
          },
        }),
      ],
    }),
  })
}
