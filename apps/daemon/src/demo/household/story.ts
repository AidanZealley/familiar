import {
  localMinute,
  type Author,
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
 * named rooms, and three months of conversation, written as data: what
 * each Familiar's memory was filed from (see memory.ts), then the last few
 * days. Each message says how each Familiar it reaches replies; the seed
 * (seed.ts) plays it all through the workspace's API, in time order, on a
 * clock started months ago, so everything is dated as written here.
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

/** Rowan's ex, who shares the allotment and posts in its room. */
export const SAFFRON: Author = { id: 'saffron', name: 'Saffron' }

/** Something a person says, and how each Familiar it reaches replies. */
export type Said = {
  say: string
  /** Who says it, when it isn't the owner. */
  by?: Author
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
  { dm: string } | { name: string; familiars: string[] }
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

  const toolDemoPrompt =
    'Could you both check the time in London, and Juniper, check the forecast too?'
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
        avatar: '001',
        capabilities: {
          plugins: ['demo'],
          mcp: ['home-assistant', 'time', 'scratch', 'bench'],
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
            at: day(98, '08:40'),
            say: 'Some background for you: Pip is my retired greyhound. He raced as Silver Comet and he’s been with me since 2019.',
            replies: {
              Juniper: [
                say(
                  'Hello, Pip. I’ll keep his walks, meals and vet visits in mind.',
                ),
              ],
            },
          },
          {
            at: day(96, '19:20'),
            say: 'Pip’s new waterproof coat came from Fell Houndwear: size 66 cm fits him perfectly, so order that size again.',
            replies: {
              Juniper: [say('Noted: Fell Houndwear, 66 cm.')],
            },
          },
          {
            at: day(95, '21:00'),
            say: 'Saffron and I broke up in April, but we’re still good friends and we still share the allotment.',
            replies: {
              Juniper: [say('Thanks for telling me. I’ll keep that in mind.')],
            },
          },
          {
            at: day(90, '18:05'),
            say: 'Mum’s coming to stay this weekend. She lives at 7 Orchard Close in Harrogate, and she’s in a wheelchair now, so anywhere we go needs step-free access.',
            replies: {
              Juniper: [
                say(
                  'Lovely. I’ll check for step-free access wherever you plan to go.',
                ),
              ],
            },
          },
          {
            at: day(85, '20:30'),
            say: 'Dr Celia Moss at Quarry Veterinary Practice says Pip should have a joint supplement every morning from now on. Her surgery is open until 7 on weekdays.',
            replies: {
              Juniper: [
                say(
                  'Got it. Tell me when the supplement arrives and I’ll remind you each morning.',
                ),
              ],
            },
          },
          {
            at: day(80, '20:00'),
            say: 'Noor Rahman and I worked out the roof for the Reed Shelter hide: each panel has to weigh 8 kg or less so we can lift it up the ladder.',
            replies: {
              Juniper: [
                say('8 kg a panel at most. I’ll flag anything heavier.'),
              ],
            },
          },
          {
            at: day(72, '07:50'),
            say: 'I’ve gone off coffee. Roasted barley tea in the mornings from now on, so put that on the shopping list instead of beans.',
            replies: {
              Juniper: [
                say('Swapped: barley tea on the list, coffee beans off.'),
              ],
            },
          },
          {
            at: day(66, '21:15'),
            say: 'Ellis fixed the gears on Bracken today and drove it back up from Derby. My brother is the only person I trust with that bike.',
            replies: {
              Juniper: [say('Good to have Bracken back on the road.')],
            },
          },
          {
            at: day(52, '19:40'),
            say: 'Big news: I got Flat 5 at Kelham Court! Rent’s £940 a month and I get the keys in a fortnight.',
            replies: {
              Juniper: [say('Congratulations! I’ll start a move list.')],
            },
          },
          {
            at: day(38, '18:30'),
            say: 'Saffron’s coming for dinner on Friday. Remember she’s allergic to hazelnuts, and that includes hazelnut oil.',
            replies: {
              Juniper: [
                say(
                  'I’ll keep hazelnuts and hazelnut oil off Friday’s shopping.',
                ),
              ],
            },
          },
          {
            at: day(30, '12:10'),
            say: 'Reed Shelter is on hold: the landowner hasn’t given Noor and me permission to build the hide yet.',
            replies: {
              Juniper: [
                say(
                  'That’s a shame. I’ll leave it off your weekends until you hear back.',
                ),
              ],
            },
          },
          {
            at: day(24, '09:00'),
            say: 'Keep reminders to one short line, please. I read them on my watch.',
            replies: {
              Juniper: [say('One line it is.')],
            },
          },
          {
            at: day(17, '20:45'),
            say: 'Canal Voices update: all six tracks are recorded, lock gates and boat engines at dawn, but there’s no release date yet.',
            replies: {
              Juniper: [
                say('Six tracks done. That’s a lot of early mornings.'),
              ],
            },
          },
          {
            at: day(9, '17:30'),
            say: 'Pip had his teeth checked at Quarry today, and Dr Moss says he’s in great shape for a ten-year-old.',
            replies: {
              Juniper: [say('Good news. Well done, Pip.')],
            },
          },
          {
            at: day(6, '19:00'),
            say: 'Asha says Tuesday pottery at Kiln House moves to 7:30 from next week.',
            replies: {
              Juniper: [say('Tuesdays at 19:30 from next week, then.')],
            },
          },
          {
            // The demo's own message: each Familiar's memory, as the nights
            // would have filed it from everything above (see memory.ts).
            at: day(4, '20:00'),
            say: 'Demo: write what each of you remembers from the months before.',
            replies: {
              Juniper: [
                use('seed_memory'),
                say(
                  'Done. Each of us has a **Memory** page now: open a Familiar’s settings, then Memory.',
                ),
              ],
            },
          },
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
            at: day(88, '08:30'),
            say: 'Started at Westfold Archive today, as collections environment coordinator. My manager is Ada Finch.',
            replies: {
              Quill: [
                say('Congratulations. I’ll keep the archive inbox in order.'),
              ],
            },
          },
          {
            at: day(70, '17:45'),
            say: 'Inbox summaries: two lines, most urgent first, and nothing at weekends.',
            replies: {
              Quill: [say('Two lines, most urgent first, weekdays only.')],
            },
          },
          {
            at: day(46, '09:10'),
            say: 'Store B’s humidity logger now syncs its readings to the archive NAS every night. Ada wants Store B kept between 45 and 55% relative humidity.',
            replies: {
              Quill: [say('Noted: nightly sync to the NAS, 45 to 55% RH.')],
            },
          },
          {
            at: day(21, '14:00'),
            say: 'Ada has asked me to lead the condition survey: the map stores first, then the photographic store.',
            replies: {
              Quill: [
                say(
                  'Map stores, then photographic. I’ll keep its emails together.',
                ),
              ],
            },
          },
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
            at: day(92, '07:30'),
            say: 'Warn me whenever it’s due to go below zero at Willow Bank. The chard is always the first thing to go.',
            replies: {
              Moss: [
                say('I’ll watch the forecast and warn you before any frost.'),
              ],
            },
          },
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
                [
                  say(
                    'The Willow Bank society turns the troughs off on 30 November and back on in March. Fill the water butts before then.',
                  ),
                ],
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
            at: day(80, '18:00'),
            say: 'The printer lives in the box room, next to my bedroom, so keep anything noisy to the daytime.',
            replies: {
              Spool: [say('Daytime for anything noisy, then.')],
            },
          },
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

        read: true,
        history: [
          {
            at: day(75, '10:30'),
            by: SAFFRON,
            say: 'Hi all, Saffron here. Rowan and I still share plot 26B, so I’ll be in here too. The shed key lives under the water butt.',
            replies: {
              Moss: [
                say('Welcome, Saffron. Shed key under the water butt: noted.'),
              ],
            },
          },
          {
            at: day(58, '08:30'),
            by: SAFFRON,
            say: '@Juniper could you remind Rowan and me that the plot rent is £48, due on 1 December?',
            replies: {
              Juniper: [
                say('I’ll put it on Rowan’s list for the end of November.'),
              ],
            },
          },
          {
            at: day(44, '16:00'),
            say: 'Leeks, chard and purple sprouting broccoli are in for the winter. I’m saving borlotti seed again, in paper envelopes.',
            replies: {
              Moss: [
                say(
                  'A good winter line-up. Keep the envelopes somewhere cool and dry.',
                ),
              ],
            },
          },
          {
            at: day(20, '11:00'),
            by: SAFFRON,
            say: '@Moss I’ve sown broad beans in the end bed, so please nobody dig there until spring.',
            replies: {
              Moss: [
                say('The end bed stays off the digging list until spring.'),
              ],
            },
          },
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
            at: day(60, '20:10'),
            say: 'Swapped the brass nozzle for a 0.4 mm hardened steel one today. Print files are on the NAS under /prints from now on.',
            replies: {
              Spool: [
                say(
                  'Hardened steel it is: good for PETG and anything abrasive.',
                ),
              ],
              Juniper: quiet('Spool has this.'),
            },
          },
          {
            at: day(33, '19:30'),
            say: '@Spool the hallway coat hook you printed in PLA has snapped.',
            replies: {
              Spool: [
                say(
                  'PLA was the wrong choice for a hook under load. Let’s try something tougher next time.',
                ),
              ],
            },
          },
          {
            at: day(12, '21:00'),
            say: '@Spool the dryer manual says PETG needs 65 °C for four hours before you print with it.',
            replies: {
              Spool: [say('65 °C for four hours before every PETG print.')],
            },
          },
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
            at: day(50, '19:00'),
            say: '@Moss @Juniper Mum says her chair needs a gate at least 84 cm wide, and beds no higher than 60 cm so she can reach in.',
            replies: {
              Moss: [
                say(
                  'Then we plan around 84 cm and 60 cm. Raised beds at that height are easy to build.',
                ),
              ],
              Juniper: [say('I’ll check any quote against those two numbers.')],
            },
          },
          {
            at: day(26, '18:20'),
            say: '@Moss @Juniper we’re going with Fenwick Gardens: £1,850 for 58 cm beds and an 88 cm gate.',
            replies: {
              Moss: [say('Good choice: both clear June’s limits.')],
              Juniper: [say('Fenwick it is. I’ll keep their details handy.')],
            },
          },
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
        name: 'Live tool calls',
        familiars: ['Juniper', 'Quill'],
        read: true,
        history: [
          {
            at: minutesAgo(10),
            say: toolDemoPrompt,
            replies: {
              Juniper: [
                {
                  ...use('current_time', { timeZone: 'Europe/London' }),
                  pauseMs: 1000,
                },
                {
                  ...use('demo_forecast', { city: 'London' }),
                  pauseMs: 3000,
                },
                {
                  ...say(
                    '@[Quill], I checked the London clock too. The forecast says light rain and 9°C.',
                  ),
                  pauseMs: 6000,
                },
              ],
              Quill: [
                {
                  ...use('current_time', { timeZone: 'Europe/London' }),
                  pauseMs: 2000,
                },
                {
                  ...say('@[Juniper], I used the London clock for my check.'),
                  pauseMs: 6000,
                },
              ],
            },
          },
          {
            at: minutesAgo(9),
            note: `To replay the tool calls, send “${toolDemoPrompt}” again.`,
          },
        ],
      },
      {
        name: 'Kelham Court move',
        familiars: ['Juniper', 'Quill'],
        read: true,
        history: [
          {
            at: day(14, '10:00'),
            say: '@Juniper moving day! Rivelin Street is empty and we’re into Flat 5. Bins here: black bin on Tuesdays, blue every other Thursday.',
            replies: {
              Juniper: [
                say(
                  'Welcome home! Bins noted: black on Tuesdays, blue every other Thursday.',
                ),
              ],
            },
          },
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
