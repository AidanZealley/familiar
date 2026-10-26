export const categories = [
  'old-facts',
  'changed-facts',
  'multi-session',
  'time',
  'unknown',
] as const

export type Category = (typeof categories)[number]
export type Question = {
  id: string
  category: Category
  text: string
  expected: string
}
export type Scenario = {
  id: string
  days: { date: string; text?: string }[]
  questions: Question[]
}

const sessions = [
  [
    0,
    "I'm Rowan. I live in Leeds and work as a lab technician at Northbank Ceramics. I drink coffee every morning. My retired greyhound Pip came home in 2019; his racing name was Silver Comet. My brother Ellis restored my green steel bicycle, Bracken, for my thirtieth birthday in 2021. My partner Saffron has a hazelnut allergy. Those are just bits about my life, no action needed.",
  ],
  [
    7,
    "I'm planning an accessible garden for my mum, June. She uses a wheelchair and can only reach beds up to 60 cm high. The garden gate is 82 cm wide. I haven't chosen a builder yet. My exhibition model, Tidal Rooms, is still just sketches.",
  ],
  [
    14,
    "For Mum's garden, Fenwick Gardens quoted £1,800 with 55 cm beds; Moss & Clay quoted £1,600 with 75 cm beds. Both quotes include installation. I'll decide later. Tidal Rooms will use porcelain tiles and a small water pump; I have booked the community kiln for 3 March.",
  ],
  [
    21,
    "A third quote for Mum's garden arrived: Alder Yard, £2,100 with 50 cm beds. None of these builders can change their quoted bed heights. The hard budget is £2,000 including installation. I'd rather keep the beds accessible than save a few pounds. I am still living in Leeds.",
  ],
  [
    28,
    "Today, 2 February, I've moved from Leeds to York. I kept the same job for now. My regular library volunteer shift is Saturday, 10 am to noon, at Wren Street Library. I mend damaged book covers there. This is a standing commitment.",
  ],
  [
    35,
    'Today, 9 February, I started as an exhibition fabricator at Lantern Museum, leaving Northbank Ceramics. I take the bus to work. My Tuesday evening pottery class runs at 7 pm; the museum rota says I finish at 6 pm on Tuesdays. The journey from the museum to the pottery studio takes 25 minutes.',
  ],
  [
    49,
    "I've stopped drinking coffee. From today, 23 February, my usual morning drink is peppermint tea. I'm packing Tidal Rooms for its kiln slot next week. The porcelain tiles are still damp, so they are on the drying rack.",
  ],
  [
    56,
    "It's 2 March. This week is all about finishing Tidal Rooms for the Riverside makers' exhibition on 8 March. I glazed its porcelain tiles today and will fire them tomorrow in the community kiln. The water pump is tested. I'm nervous about transporting the model in one piece.",
  ],
  [
    63,
    "It's 9 March. Tidal Rooms survived the journey and I showed it yesterday at the Riverside makers' exhibition. Visitors liked the ripples. I'm spending this week repairing library books, then putting the model into storage. The exhibition is over.",
  ],
  [
    70,
    "It's 16 March. The spring project is now a birdwatching hide with my neighbour Noor. We're sketching its removable roof. We haven't chosen a site, budget or completion date. I am still at Lantern Museum and living in York.",
  ],
  [
    77,
    "It's 23 March. Noor and I made a cardboard mock-up of the hide's roof. I liked how easily it lifted off. The hide is for watching birds, not photography. I spent Saturday morning on my usual library shift and took Pip for a walk afterwards.",
  ],
  [
    89,
    "It's 4 April. A quiet weekend in York: I tidied the workshop and made peppermint tea. The bird hide is still at the mock-up stage. No new decisions today. Please keep your reply short, as with the earlier diary entries.",
  ],
] as const

// Minor but lasting details compete with the early facts; passing chatter also
// fills the working context. Neither repeats a tested fact or hints at a question.
const projects = [
  'linocut printing',
  'bookbinding',
  'seed saving',
  'watercolour painting',
  'wood carving',
  'basket weaving',
  'model railways',
  'screen printing',
  'leather repairs',
  'paper marbling',
  'candle making',
  'stained glass',
]
const supplies = [
  [
    'paper',
    'acid-free sheets in A4 and A3 sizes, kept flat between two boards',
  ],
  [
    'tools',
    'a small brass ruler and a cork-backed cutting mat on the workbench',
  ],
  [
    'storage',
    'clear stackable boxes with handwritten labels on the short ends',
  ],
  ['lighting', 'a warm desk lamp with a wide shade to avoid sharp shadows'],
  [
    'cleaning',
    'reusable cotton cloths washed separately from the kitchen towels',
  ],
  [
    'notes',
    'a hardback squared notebook with numbered pages and a blue elastic',
  ],
  [
    'suppliers',
    'the independent craft shop near the station rather than online shops',
  ],
  [
    'safety',
    'a washable apron and a pair of close-fitting gloves in the top drawer',
  ],
]
const chatter = [
  'The toast was a bit dark this morning. I watched the rain collect on the windowsill while the kettle boiled.',
  'At lunchtime I walked around the block twice. There was a delivery van blocking the pavement and somebody had dropped a red glove.',
  'I spent ten minutes looking for a pencil that was already behind my ear. The radio kept cutting out whenever I stood near the shelf.',
  'The clouds cleared for a while in the afternoon. I opened the window, then closed it when the room got cold.',
  'Dinner was leftovers with some extra vegetables. I washed up, put a load of towels on and watched an unremarkable quiz show.',
  'A neighbour waved from across the road. I swept up some dust and found three loose buttons under the chair.',
].join(' ')

export const memoryScenario: Scenario = {
  id: 'rowan-90-days-v1',
  days: Array.from({ length: 90 }, (_, day) => {
    const date = new Date(Date.UTC(2026, 0, 5 + day)).toISOString().slice(0, 10)
    const session = sessions.findIndex(([offset]) => offset === day)
    return {
      date,
      ...(session < 0
        ? {}
        : {
            text: [
              sessions[session][1],
              `Some standing preferences for my ${projects[session]} hobby:`,
              ...supplies.map(
                ([item, preference]) =>
                  `For ${projects[session]} ${item}, I use ${preference}.`,
              ),
              `Otherwise it was an ordinary day. ${chatter}`,
              'No tasks to carry out. A brief acknowledgement is plenty.',
            ].join('\n'),
          }),
    }
  }),
  questions: [
    {
      id: 'pip-name',
      category: 'old-facts',
      text: "What was Pip's racing name?",
      expected: 'Silver Comet.',
    },
    {
      id: 'bicycle',
      category: 'old-facts',
      text: 'Who restored Bracken for me, and for which birthday?',
      expected:
        "Rowan's brother Ellis restored the bicycle for Rowan's thirtieth birthday in 2021.",
    },
    {
      id: 'allergy',
      category: 'old-facts',
      text: 'Which ingredient must I avoid when baking for Saffron?',
      expected: 'Hazelnuts, because Saffron is allergic to them.',
    },
    {
      id: 'home',
      category: 'changed-facts',
      text: 'Which city do I live in now, and which did I move from?',
      expected: 'Currently York, previously Leeds.',
    },
    {
      id: 'job',
      category: 'changed-facts',
      text: 'What is my current job and employer?',
      expected:
        'Exhibition fabricator at Lantern Museum, no longer a lab technician at Northbank Ceramics.',
    },
    {
      id: 'drink',
      category: 'changed-facts',
      text: 'What is my usual morning drink now?',
      expected: 'Peppermint tea, replacing coffee.',
    },
    {
      id: 'garden',
      category: 'multi-session',
      text: "Which of the three garden quotes meets both Mum's access needs and my budget? Explain why the other two fail.",
      expected:
        'Fenwick Gardens: £1,800 and 55 cm beds meet the £2,000 budget and maximum 60 cm height. Moss & Clay has inaccessible 75 cm beds. Alder Yard costs £2,100, over budget.',
    },
    {
      id: 'pottery',
      category: 'multi-session',
      text: 'Can I get from work to my Tuesday pottery class on time? How much time would I have to spare?',
      expected:
        'Yes. Work ends at 6 pm, travel takes 25 minutes, arrival is 6:25 pm for a 7 pm class, leaving 35 minutes.',
    },
    {
      id: 'library',
      category: 'multi-session',
      text: 'Could I do a regular Saturday 11 am to 1 pm walk with Pip without moving any standing commitment? Explain.',
      expected:
        'No. The Saturday library volunteer shift runs 10 am to noon, overlapping the first hour of the proposed walk.',
    },
    {
      id: 'early-march',
      category: 'time',
      text: 'What project was I preparing in early March, and for which event?',
      expected:
        "Tidal Rooms, a porcelain-tile model with a water pump, for the Riverside makers' exhibition on 8 March. Glazed 2 March, kiln 3 March. The project and event are required; materials and preparation dates are optional.",
    },
    {
      id: 'move-date',
      category: 'time',
      text: 'On which date did I move to my current city?',
      expected: '2 February 2026, the move to York.',
    },
    {
      id: 'march-order',
      category: 'time',
      text: 'Did I start planning the bird hide before or after showing Tidal Rooms? Give the dates I told you.',
      expected:
        'After. Tidal Rooms was exhibited on 8 March; the bird hide was first being sketched on 16 March, with a cardboard roof mock-up on 23 March. The 8 and 16 March dates are required.',
    },
    {
      id: 'unknown-school',
      category: 'unknown',
      text: 'What was the name of my primary school?',
      expected:
        'Unknown. Rowan never supplied a primary school. Explicitly say you do not know or were not told; do not guess a school.',
    },
    {
      id: 'unknown-cat',
      category: 'unknown',
      text: "What is my cat's name?",
      expected:
        'Unknown. No cat or cat name was ever mentioned. Say you do not know or were not told, and do not invent a cat.',
    },
    {
      id: 'unknown-hide',
      category: 'unknown',
      text: 'What exact date have Noor and I committed to finishing the bird hide?',
      expected:
        'No completion date was chosen or supplied. Explicitly say there is no known committed date, without inventing one.',
    },
  ],
}
