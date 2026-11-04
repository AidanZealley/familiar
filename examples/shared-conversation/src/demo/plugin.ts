import {
  definePlugin,
  defineTool,
  Type,
  type Author,
  type Invoker,
} from '@familiar-ai/core'

const result = (text: string, going: Author[], isError = false) => ({
  output: [{ type: 'text' as const, text }],
  details: { going },
  ...(isError && { isError }),
})

/** The person a call runs for, if it runs for one. */
const personOf = (invoker: Invoker) =>
  invoker.kind === 'person' ? invoker.author : undefined

/**
 * Two tools that act for the person who asked. Neither takes a name: both read
 * `api.invoker`, which Familiar resolves from the message that started the
 * run, so it is whoever the host signed that message in as.
 */
export const guestListPlugin = () => {
  // The host's data for this page: who's coming, by stable ID.
  const going = new Map<string, Author>()
  const names = () => [...going.values()].map((author) => author.name)

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
          execute: async (_args, { invoker }) => {
            const author = personOf(invoker)
            return author
              ? result(
                  `You're signed in as ${author.name} (ID "${author.id}").`,
                  [...going.values()],
                )
              : result('Nobody asked.', [], true)
          },
        }),
        defineTool({
          name: 'count_me_in',
          description: 'Adds the person asking to the guest list.',
          parameters: Type.Object({}),
          execute: async (_args, { invoker }) => {
            const author = personOf(invoker)
            if (!author) {
              return result(
                'Nobody asked, so there is no one to add.',
                [],
                true,
              )
            }
            const already = going.has(author.id)
            going.set(author.id, author)
            return result(
              `${already ? `${author.name} was already counted in` : `Counted ${author.name} in`}. Going: ${names().join(', ')}.`,
              [...going.values()],
            )
          },
        }),
      ],
    }),
  })
}
