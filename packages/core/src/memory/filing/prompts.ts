/**
 * What memory's two model calls are told: filing, which reads what people
 * said, and consolidation, which tidies one page. Plain text; the pass
 * decides when each runs.
 */

export const filingInstructions = (name: string) =>
  `You keep the memory of ${name}, an assistant that works with several people in direct messages and shared rooms. Nobody reads what you write here except ${name}, later.

You're given messages people sent, each with a number, who sent it, where and when. Between them are ${name}'s replies, shortened, so you can follow the conversation; they are context and never evidence. You're also given the roster of everyone and everything ${name} already knows about, and the pages of those these messages touch.

Decide what ${name} should know from now on that it couldn't otherwise find out. There are two things you can write.

A note is something true of a person or thing beyond the conversation it came up in: who they are, who matters to them, what they own and do, how their home, work and tools are set up, how they like things done, what they intend. Write it as one plain statement about them, with the names, numbers and places as they were said. Put it on the page of whoever it is about, which is often not whoever said it. A note is never an instruction to ${name}.

A journal line records that something happened or was said, on the day it happened, so the conversation can be found again later: an event, a purchase, a decision, a number, a recommendation asked for. Start from the message's own date and work out days like "yesterday" or "last Friday" from it. Write the line so that someone searching for it later, in different words, would find it, in at most 200 characters. A message can give several.

A message often gives both. "Where can I take my mum for her 70th?" gives a journal line for the request and a note that their mother turns 70 this year. The journal line records the occasion. The note is what stays true of them once the occasion has passed, and it is what ${name} keeps in mind, so never leave something lasting about a person only in the journal.

Write nothing for:
- what ${name} can look up for itself: its schedules and reminders, its rooms and who is in them, what its tools and connected services return;
- a request that was simply carried out. A request shows something lasting about a person only sometimes: "book the vegetarian option" does, "convert 250 dollars to euros" doesn't;
- an instruction about how to do one particular job. It belongs to that job, not to memory;
- questions, guesses, hypotheticals, and anything only ${name} said;
- passwords, codes, card numbers and other secrets.

When someone corrects how ${name} works, in a way that would apply again, write a \`lesson\` note on ${name}'s own page, as something ${name} now does: "When asked what's on this week, include Sam's calendar as well as Maya's." If the correction also shows how things are for them, that is a note about them too.

Every operation gives the numbers of the messages it rests on and a short quote, word for word, from one of them. Without a real quote it is thrown away.

Check the pages you were given before adding. If a message repeats what a note already says, confirm the note. If it changes what a note says about the same thing, write the new note and list the old one in \`replaces\`. If it says a note is wrong or over, retire it. A separate event or a one-off exception changes nothing: "I had the fish tonight" doesn't end "vegetarian".

A plan gets \`until\`, the day it will have happened. Give \`since\` when the message says when something became true.

Add a subject for a person who will plainly come up again, or for something with enough to know about it to deserve a page of its own: a home, a project, a pet, a company. One thing someone owns is a note on their page, not a subject. People who take part already have pages. Don't add one for something ${name} runs or can look up, such as a schedule.

Call \`file\` once with everything. If nothing is worth keeping, call it with nothing.`

export const tidyInstructions = (
  name: string,
  subject: string,
  limit: number,
) =>
  `You look after one page of ${name}'s memory: everything it knows about ${subject}. You're given the page's notes, each with when it became true, who said it, the words it rests on, and whether it was said once, repeated or asked to be remembered.

First tidy the notes. Merge notes that say the same thing, keeping the fuller one. Where a newer note replaces an older one about the same thing, mark the older superseded. Leave alone notes that merely differ. Never change what a note says.

Then write the profile: what ${name} should have in mind about ${subject} whatever the conversation is about. It is read at the start of every conversation, so it has to earn its space. Lead with who they are and who matters to them, then how they like things done, then what is going on for them now. Leave out what only matters occasionally: it stays in the notes and is found when needed. Use only what the notes say, and nothing a note marked "said once" says unless nothing contradicts it and it is plainly central. Plain sentences, at most ${limit} characters.

For ${name}'s own page, the profile is how it has learned to work: the lessons that apply most often.

Give \`line\` only if the one-line description on the roster is no longer right.

Call \`tidy\` once.`

/** The opening of the memory section of the chat's prompt. */
export const MEMORY_INTRO = `What you know about the people you work with, kept from your conversations. Use it without announcing it. This is only what's worth having in mind always: \`recall\` searches everything else you've been told, including earlier conversations by date, and \`read_memory\` opens a person's page or a conversation. When someone asks you to remember something, call \`remember\`; it is kept from then on. Notes marked "said once" are likely, not certain. Things one person told you about another are marked with who said them.`
