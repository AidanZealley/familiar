import {
  localMinute,
  type CapabilitiesChange,
  type ModelRef,
} from '@familiar-ai/core'
import { localDay } from '@familiar-ai/core/diagnostics'
import { DEMO_TIME_ZONE } from '../scenarios/scenario.ts'
import {
  fail,
  handOff,
  mcp,
  quiet,
  say,
  schedule,
  use,
  type Reply,
} from './script.ts'

/**
 * Rowan's household, as the demo opens it: four Familiars, their DMs and
 * named rooms, and a few days of conversation, written as data. Each message
 * says how each Familiar it reaches replies; the seed (seed.ts) plays it
 * all through the workspace's API, in time order, on a clock started days
 * ago, so everything is dated as written here.
 */

export type FamiliarSeed = {
  name: string
  /** Starts with its name: the scripted model recognises it by its persona. */
  persona: string
  /** A portrait number; without one, the portrait its ID derives. */
  avatar?: string
  capabilities: CapabilitiesChange
  model?: ModelRef
}

/** Something the person says, and how each Familiar it reaches replies. */
export type Said = {
  say: string
  /** By Familiar name. Mentions are any `@Name` of a Familiar in the room. */
  replies: Record<string, Reply>
}

/** Something that happens in a room at a time, in ms since the epoch. */
export type Moment = { at: number } & (
  | Said
  /** A host's note: context for the room's Familiars, which no one answers. */
  | { note: string }
  /** The person pauses a Familiar's schedule, by its prompt. */
  | { pause: { familiar: string; prompt: string } }
  | { archive: true }
)

export type RoomSeed = (
  { dm: string } | { name: string; familiars: string[]; lead?: string }
) & {
  history: Moment[]
  /** Read up to its end; otherwise what came after the person's last message is unread. */
  read?: boolean
  /**
   * Said once the seed is done, at the real time, and left running. The
   * first room with one is said first and starts answering; the rest wait.
   */
  live?: Said
}

export type Story = {
  /** What the person calls themselves. */
  owner: string
  /** The first is the workspace's first Familiar, which the daemon creates. */
  familiars: FamiliarSeed[]
  /** The tools a new Familiar gets. */
  defaults: CapabilitiesChange
  rooms: RoomSeed[]
}

/** How long Spool watches the print it's asked about once the demo starts. */
export const WATCH_MINUTES = 10

/** Rowan's household, dated back from `now`. */
export function household(now: number): Story {
  const minutesAgo = (minutes: number) => now - minutes * 60_000
  // A wall-clock time in the demo's zone, `daysAgo` days back.
  const day = (daysAgo: number, time: string) => {
    const date = new Date(`${localDay(now, DEMO_TIME_ZONE)}T${time}Z`)
    date.setUTCDate(date.getUTCDate() - daysAgo)
    // The zone's offset then, from how it reads that instant as UTC.
    const read = Date.parse(
      `${localMinute(date.getTime(), DEMO_TIME_ZONE).replace(' ', 'T')}Z`,
    )
    return date.getTime() - (read - date.getTime())
  }
  // The schedule tool's `YYYY-MM-DD HH:MM`.
  const minute = (at: number) => localMinute(at, DEMO_TIME_ZONE)

  const pipReminder = 'Remind Rowan to give Pip his joint supplement'
  const allotmentCheck =
    'Check the Willow Bank forecast and tell Rowan what needs doing at plot 26B'

  return {
    owner: 'Rowan',
    familiars: [
      {
        name: 'Juniper',
        persona:
          'You are Juniper, Rowan’s household Familiar: the flat at Kelham Court, Pip the greyhound, the heating, the shopping and the reminders. Warm, brief and practical.',
        capabilities: {
          plugins: ['demo'],
          mcp: ['home-assistant', 'time', 'scratch'],
        },
      },
      {
        name: 'Quill',
        persona:
          'You are Quill, who keeps Rowan’s work at Westfold Archive in order: the inbox, the condition survey and meetings with Ada. Crisp and precise, never chatty.',
        avatar: '016',
        capabilities: { plugins: [], mcp: ['notes', 'time', 'nas'] },
      },
      {
        name: 'Moss',
        persona:
          'You are Moss, Rowan’s gardener: allotment plot 26B with Saffron, and the new beds at Mum’s. Patient and seasonal, and fond of a good forecast.',
        avatar: '055',
        capabilities: { plugins: [], mcp: ['home-assistant', 'notes'] },
      },
      {
        name: 'Spool',
        persona:
          'You are Spool, who runs the 3D printer in the box room: what to print, in what, and whether it’s going well. Practical, and a little particular about tolerances.',
        avatar: '106',
        capabilities: { plugins: ['workshop'], mcp: ['printer', 'nas'] },
        model: { provider: 'faux', modelId: 'faux-2' },
      },
    ],
    defaults: { plugins: ['demo'], mcp: ['time'] },
    rooms: [
      {
        dm: 'Juniper',
        read: true,
        history: [
          {
            at: day(3, '08:15'),
            say: 'Every morning at 7:30, remind me to give Pip his joint supplement.',
            replies: {
              Juniper: [
                schedule(pipReminder, { repeat: '30 7 * * *' }, [
                  say(
                    'Morning! Pip’s joint supplement: one scoop in his breakfast.',
                  ),
                ]),
                say('Done: every day at 07:30, starting tomorrow.'),
              ],
            },
          },
          {
            at: day(2, '08:05'),
            say: 'Is the heating still on the winter schedule?',
            replies: {
              Juniper: [
                ...mcp('home-assistant', 'get_live_context'),
                say(
                  'Yes. The living room is at 19.5 °C, and the heating comes on at 06:30 and 17:00 on weekdays.',
                ),
              ],
            },
          },
          {
            at: day(2, '08:07'),
            say: 'Remind me at 6 tonight to book Pip’s booster.',
            replies: {
              Juniper: [
                schedule(
                  'Remind Rowan to book Pip’s booster at Quarry Veterinary Practice',
                  { at: minute(day(2, '18:00')) },
                  [
                    say(
                      'Time to book Pip’s booster at Quarry Veterinary Practice. Dr Moss’s surgery is open until 7.',
                    ),
                  ],
                ),
                say('I’ll remind you at 18:00.'),
              ],
            },
          },
          {
            at: day(1, '22:40'),
            say: 'Lock up and turn the hall light off, I’m off to bed.',
            replies: {
              Juniper: [
                ...mcp('home-assistant', 'lock', {
                  entity_id: 'lock.front_door',
                }),
                ...mcp('home-assistant', 'turn_off', {
                  entity_id: 'light.hall',
                }),
                say('Front door locked and the hall light’s off. Night!'),
              ],
            },
          },
          {
            at: minutesAgo(150),
            say: 'How wide did Mum say her garden gate needs to be?',
            replies: {
              Juniper: [
                use('recall', { query: 'June garden gate width' }),
                say(
                  'At least **84 cm**, for her wheelchair. Fenwick’s 88 cm gate clears it.',
                ),
              ],
            },
          },
        ],
      },
      {
        dm: 'Quill',
        history: [
          {
            at: day(2, '08:50'),
            say: 'Anything urgent in the archive inbox?',
            replies: {
              Quill: [
                ...mcp('notes', 'search_notes', { query: 'inbox urgent' }),
                say(
                  'Three things, most urgent first:\n\n1. Ada wants the condition survey plan by Friday.\n2. Store B’s humidity logger dropped offline overnight.\n3. The Quarry Paper order shipped; it arrives Thursday.',
                ),
              ],
            },
          },
          {
            at: day(2, '08:52'),
            say: 'Every weekday at 8:45, give me a two-line summary of the inbox.',
            replies: {
              Quill: [
                schedule(
                  'Summarise Rowan’s archive inbox in two lines, most urgent first',
                  { repeat: '45 8 * * 1-5' },
                  [
                    say(
                      '**Inbox:** Ada is waiting on the survey plan; facilities say the Store B logger is back.\nNothing else needs you before lunch.',
                    ),
                  ],
                ),
                say('Done: weekdays at 08:45.'),
              ],
            },
          },
          {
            at: day(1, '16:20'),
            say: 'Draft a reply to Ada: I’ll have the survey plan to her on Thursday.',
            replies: {
              Quill: [
                say(
                  'Here’s a draft:\n\n> Hi Ada,\n>\n> The condition survey plan will be with you on Thursday. I’m starting with the map stores, then the photographic store.\n>\n> Rowan',
                ),
              ],
            },
          },
        ],
      },
      {
        dm: 'Moss',
        history: [
          {
            at: day(3, '10:00'),
            say: 'Every Saturday at 8, check the forecast and tell me what needs doing at the plot.',
            replies: {
              Moss: [
                schedule(allotmentCheck, { repeat: '0 8 * * 6' }, [
                  ...mcp('home-assistant', 'get_weather'),
                  say(
                    'Dry and bright until the afternoon: a good morning to cut back the asparagus and mulch the rhubarb.',
                  ),
                ]),
                say('Every Saturday at 08:00, then.'),
              ],
            },
          },
          {
            at: day(1, '07:55'),
            say: 'Will it frost tonight? The chard’s still out.',
            replies: {
              Moss: [
                ...mcp('home-assistant', 'get_weather'),
                say(
                  'Yes, down to −2 °C around 4am. Fleece the chard before dark; the leeks will be fine.',
                ),
              ],
            },
          },
          {
            at: day(1, '09:10'),
            pause: { familiar: 'Moss', prompt: allotmentCheck },
          },
          {
            at: minutesAgo(40),
            say: 'When does the society turn the water troughs off for winter?',
            replies: {
              Moss: fail(
                'Let me look at the Willow Bank society’s notices',
                'The model provider rejected the request (400 Bad Request).',
              ),
            },
          },
        ],
      },
      {
        dm: 'Spool',
        read: true,
        history: [
          {
            at: day(3, '19:10'),
            say: 'Can you check on the printer?',
            replies: {
              Spool: [
                ...mcp('printer', 'printer_status'),
                say(
                  'I can’t reach the printer: its connection is waiting for a token. Add one under **Settings → Connections → printer** and I’ll check again.',
                ),
              ],
            },
          },
          {
            at: day(2, '20:15'),
            say: 'Remind me in two hours to take the PETG out of the dryer.',
            replies: {
              Spool: [
                schedule(
                  'Remind Rowan to take the PETG spool out of the filament dryer',
                  { at: minute(day(2, '22:15')) },
                  [
                    say(
                      'The PETG has had its four hours: take it out of the dryer and bag it with the desiccant.',
                    ),
                  ],
                ),
                say('I’ll remind you at 22:15.'),
              ],
            },
          },
          {
            at: day(1, '12:00'),
            say: 'What nozzle is on the printer at the moment?',
            replies: {
              Spool: [
                use('recall', { query: 'printer nozzle' }),
                say(
                  'A 0.4 mm hardened steel nozzle, since September. It’s fine for PETG and anything abrasive.',
                ),
              ],
            },
          },
        ],
        live: {
          say: 'Watch the first layers of the hallway hook and tell me if it starts to lift.',
          replies: {
            Spool: [
              use(
                'watch_print',
                { layer: 5 },
                'The first layers are where PETG lifts, at the corners. I’ll watch until layer five.',
              ),
              say(
                'Five layers down and flat, with no lifting at the corners. I’ll leave it running.',
              ),
            ],
          },
        },
      },
      {
        name: 'Allotment',
        familiars: ['Moss', 'Juniper', 'Spool'],
        lead: 'Moss',
        read: true,
        history: [
          {
            at: day(3, '09:30'),
            say: 'Saffron says the leeks are ready. Can we lift them on Saturday?',
            replies: {
              Moss: [
                ...mcp('home-assistant', 'get_weather'),
                say(
                  'Saturday’s dry until about 2pm, so go in the morning. Lift them with a fork rather than pulling, and leave the smallest to thicken up.',
                ),
              ],
            },
          },
          {
            at: day(1, '17:10'),
            say: '@Juniper can you add twine and a new hand fork to the shopping list?',
            replies: {
              Juniper: [say('Added garden twine and a hand fork.')],
            },
          },
        ],
        live: {
          say: '@Spool could you print 20 plant labels for the new beds?',
          replies: {
            Spool: [
              say(
                'Twenty labels, after the hook: 80 mm stakes in white PLA with the names embossed. Send me the list.',
              ),
            ],
          },
        },
      },
      {
        name: 'Workshop',
        familiars: ['Spool', 'Juniper'],
        read: true,
        history: [
          {
            at: day(2, '21:00'),
            say: 'The hallway coat hook snapped again. Can we print a stronger one?',
            replies: {
              Spool: [
                say(
                  'Yes. PLA creeps under a constant load; PETG won’t. Four walls, 40% gyroid infill, and print it on its side so the layers run along the hook, not across it.',
                ),
              ],
              Juniper: quiet('Spool has this.'),
            },
          },
          {
            at: day(2, '21:05'),
            say: '@Juniper add PETG to the shopping list, black if they have it.',
            replies: {
              Juniper: [say('Added a 1 kg spool of black PETG.')],
            },
          },
        ],
        live: {
          say: 'Once the hook’s done, what’s next in the print queue?',
          replies: {
            Spool: [
              say(
                'Next: the plant labels for the allotment, then a spare battery cover for the smoke alarm.',
              ),
            ],
            Juniper: quiet('Nothing to add.'),
          },
        },
      },
      {
        name: 'Mum’s garden',
        familiars: ['Moss', 'Juniper', 'Quill'],
        history: [
          {
            at: day(1, '18:30'),
            note: 'Fenwick Gardens confirmed a site visit at June’s on Thursday at 10:00.',
          },
          {
            at: day(1, '18:32'),
            say: 'Fenwick can come on Thursday. What do we still need to decide before they start?',
            replies: {
              Moss: [
                say(
                  'The beds and gate are settled: 58 cm beds sit under June’s 60 cm limit, and the 88 cm gate clears her chair. Still open: the path surface, and whether the beds get a seat along the edge.',
                ),
              ],
              Juniper: handOff(
                'Quill',
                'Can you find Fenwick’s quote email and check whether it includes the path?',
                [
                  ...mcp('notes', 'search_notes', { query: 'Fenwick quote' }),
                  say(
                    'Fenwick’s quote is £1,850 for the beds and gate only. The path is extra: they estimated £380 for resin-bound gravel.',
                  ),
                ],
                'I’ve asked Quill to check whether Fenwick’s quote covers the path.',
              ),
              Quill: quiet('Juniper handed me the part I can help with.'),
            },
          },
          {
            at: day(1, '18:45'),
            say: '@Quill please reply to Fenwick and confirm Thursday at 10.',
            replies: {
              Quill: [
                ...mcp('notes', 'create_note', {
                  title: 'Reply to Fenwick Gardens',
                }),
                say(
                  'Drafted in your notes, ready to send:\n\n> Thursday at 10:00 suits June. The side gate will be open. Thanks, Rowan',
                ),
              ],
            },
          },
          {
            at: minutesAgo(95),
            say: '@Moss @Juniper Mum asked if the beds can go in before her birthday in three weeks. Is that realistic?',
            replies: {
              Moss: [
                say(
                  'Realistic if Fenwick start within a fortnight: two days for the beds, one for the gate. Plant them up after; winter pansies and a rosemary would be in flower for her.',
                ),
              ],
              Juniper: [
                say(
                  'Worth asking Fenwick on Thursday. If they can’t, a card with a photo of the plan would still go down well.',
                ),
              ],
            },
          },
          {
            at: minutesAgo(70),
            note: 'Fenwick Gardens moved the site visit to 11:00.',
          },
        ],
      },
      {
        name: 'Kelham Court move',
        familiars: ['Juniper', 'Quill'],
        read: true,
        history: [
          {
            at: day(3, '11:00'),
            say: 'That’s the last box unpacked! Anything left on the move list?',
            replies: {
              Juniper: [
                say(
                  'Two things: the post redirect from Rivelin Street ends on the 30th, and the deposit from Rivelin Street hasn’t come back yet. Otherwise you’re moved in.',
                ),
              ],
              Quill: quiet('Nothing on the move list is work.'),
            },
          },
          { at: day(3, '11:20'), archive: true },
        ],
      },
    ],
  }
}
