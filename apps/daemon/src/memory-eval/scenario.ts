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
  required: string[]
  optional: string[]
}
export type Scenario = {
  id: string
  days: { date: string; text?: string }[]
  /** Last session with tested facts; replay must compact it out of verbatim context. */
  testedFactsThrough?: string
  questions: Question[]
}

const sessions = [
  [
    0,
    "I'm Rowan. I live in Leeds and work as a lab technician at Northbank Ceramics. I drink coffee every morning. My retired greyhound Pip came home in 2019; his racing name was Silver Comet. My brother Ellis restored my green steel bicycle, Bracken, for my thirtieth birthday in 2021. My partner Saffron has a hazelnut allergy. Those are a few bits about my life.",
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
    "It's 16 March. The spring project is now a birdwatching hide with my neighbour Noor. We're sketching its removable roof. The hide is for watching birds, not photography. We haven't chosen a site, budget or completion date. I am still at Lantern Museum and living in York.",
  ],
  [
    77,
    'I sorted the workshop shelves and sharpened a few blunt pencils. The afternoon was quiet.',
  ],
  [
    89,
    'I tidied the workshop and repaired a loose drawer handle. The radio played quietly while I worked. A brief reply is fine.',
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
const supplyDetails = [
  ['Ryman A4 cartridge pad', '12 sheets', 'King Street stationer'],
  ['Fabriano A3 ivory sheets', '20 sheets', 'Moor Lane paper shop'],
  ['Sutton seed envelopes', 'size 3', 'Market Row garden shop'],
  ['Arches cold press pad', 'A5', 'Bridge Street art shop'],
  ['Pfeil palm gouge', '6 mm', 'Mill Road tool shop'],
  ['Willow cane bundle', '4 mm', 'Canal craft shop'],
  ['Peco flex track', '1 metre', 'Station Road model shop'],
  ['Speedball mesh screen', '25 cm', 'North Street print shop'],
  ['John James leather needles', 'size 2', 'Tanner Lane haberdashery'],
  ['Talens marbling ink', '30 ml', 'Quay art shop'],
  ['Kerawax soy flakes', '2 kg', 'Mill Yard candle shop'],
  ['Wissmach amber glass', '15 cm', 'Glasshouse supplies'],
] as const
// Each row adds eight concrete preferences for a different hobby. They cannot
// be collapsed into one shared shopping or storage preference without losing facts.
const details = [
  [
    'Japanese kozo transfer paper',
    'oil-based black Caligo ink',
    'a 100 mm rubber brayer',
    'a V-shaped lino gouge',
    'a bench hook clamped on the left',
    'newsprint drying racks',
    'vegetable oil for plate cleaning',
    'an edition size of twelve',
  ],
  [
    'waxed linen thread',
    'a bone folder',
    'a curved sewing needle',
    'greyboard covers',
    'red buckram spines',
    'wheat starch paste',
    'a lying press',
    'French link stitching',
  ],
  [
    'brown paper packets',
    'silica gel in the seed tin',
    'a kitchen sieve for chaff',
    'pencil harvest dates',
    'runner beans dried on trays',
    'tomato seeds fermented in jars',
    'a north-facing cupboard',
    'germination checks in February',
  ],
  [
    'a size 10 sable mop',
    'ultramarine shadows',
    'raw sienna washes',
    'a porcelain mixing palette',
    'low-tack masking tape',
    'two water jars',
    'a folding plein-air stool',
    'a landscape sketchbook',
  ],
  [
    'limewood blanks',
    'a straight detail knife',
    'a leather sharpening strop',
    'green honing compound',
    'a thumb guard',
    'a carvers screw vice',
    'beeswax polish',
    'spoon patterns drawn in pencil',
  ],
  [
    'buff willow uprights',
    'a round bodkin',
    'a cast iron rapping iron',
    'a soaking trough outdoors',
    'a three-rod wale border',
    'oval shopping basket forms',
    'secateurs with orange handles',
    'a weighted wooden base',
  ],
  [
    'OO gauge wagons',
    'cork track underlay',
    'a DCC controller',
    'code 75 rail joiners',
    'fine grey ballast',
    'a static grass applicator',
    'a soldering iron at 320 degrees',
    'a removable hill section',
  ],
  [
    'water-based textile ink',
    'a 70 durometer squeegee',
    'photo emulsion stencils',
    'a hinged printing board',
    'cotton tote bag blanks',
    'a heat press at 160 degrees',
    'registration marks in blue',
    'a dark cupboard for coated screens',
  ],
  [
    'saddle soap',
    'tan polyester thread',
    'a diamond stitching awl',
    'a wooden stitching pony',
    'brass rivets',
    'a skiving knife',
    'gum tragacanth edge finish',
    'round leather patches',
  ],
  [
    'carrageenan size',
    'alum-treated paper',
    'a steel rake comb',
    'ox gall dispersant',
    'a shallow enamel tray',
    'a peacock pattern',
    'a bamboo stylus',
    'a clothesline for drying sheets',
  ],
  [
    'wooden wicks',
    'amber glass jars',
    'cedar fragrance oil',
    'a digital probe thermometer',
    'a double boiler',
    'a 65 degree pouring temperature',
    'seven days of curing',
    'unbleached cotton warning labels',
  ],
  [
    'copper foil edging',
    'lead-free solder',
    'a pistol-grip glass cutter',
    'running pliers',
    'a diamond grinder',
    'black patina',
    'a cork assembly board',
    'zinc came frames',
  ],
] as const
const detailFor = (session: number, detail: string) =>
  `For ${projects[session]}, my standing choice is ${detail}.`
const chatter = [
  'The toast was a bit dark this morning. I watched the rain collect on the windowsill while the kettle boiled.',
  'At lunchtime I walked around the block twice. There was a delivery van blocking the pavement and somebody had dropped a red glove.',
  'I spent ten minutes looking for a pencil that was already behind my ear. The radio kept cutting out whenever I stood near the shelf.',
  'The clouds cleared for a while in the afternoon. I opened the window, then closed it when the room got cold.',
  'Dinner was leftovers with some extra vegetables. I washed up, put a load of towels on and watched an unremarkable quiz show.',
  'A neighbour waved from across the road. I swept up some dust and found three loose buttons under the chair.',
].join(' ')

export const memoryScenario: Scenario = {
  id: 'rowan-90-days-v2',
  testedFactsThrough: '2026-03-16',
  days: Array.from({ length: 90 }, (_, day) => {
    const date = new Date(Date.UTC(2026, 0, 5 + day)).toISOString().slice(0, 10)
    const session = sessions.findIndex(([offset]) => offset === day)
    // Several full, fact-free sessions separate the last tested facts from
    // questions, exceeding the 4,000-token budget rather than relying on age.
    const filler = [72, 74, 80, 83, 86, 88].includes(day)
    return {
      date,
      ...(session < 0
        ? filler
          ? { text: `A quiet diary entry for ${date}. ${chatter} ${chatter}` }
          : {}
        : {
            text: [
              sessions[session][1],
              `Some standing preferences for my ${projects[session]} hobby:`,
              detailFor(
                session,
                `${supplyDetails[session][0]} in ${supplyDetails[session][1]} from ${supplyDetails[session][2]}`,
              ),
              ...details[session].map((detail) => detailFor(session, detail)),
              `Otherwise it was an ordinary day. ${chatter}`,
              'A brief reply is fine.',
            ].join('\n'),
          }),
    }
  }),
  questions: [
    {
      id: 'pip-name',
      category: 'old-facts',
      text: "What was Pip's racing name?",
      required: ['Silver Comet'],
      optional: ['Pip is a retired greyhound'],
    },
    {
      id: 'bicycle',
      category: 'old-facts',
      text: 'Who restored Bracken for me, and for which birthday?',
      required: ['Brother Ellis', 'thirtieth birthday'],
      optional: ['2021', 'Bracken is a bicycle'],
    },
    {
      id: 'allergy',
      category: 'old-facts',
      text: 'Which ingredient must I avoid when baking for Saffron?',
      required: ['Hazelnuts', 'Saffron is allergic'],
      optional: [],
    },
    {
      id: 'pip-year',
      category: 'old-facts',
      text: 'In what year did Pip come home?',
      required: ['2019'],
      optional: ['Pip is a retired greyhound'],
    },
    {
      id: 'bracken-material',
      category: 'old-facts',
      text: 'What colour and material is Bracken?',
      required: ['Green', 'Steel'],
      optional: ['Bicycle'],
    },
    {
      id: 'home',
      category: 'changed-facts',
      text: 'Which city do I live in now, and which did I move from?',
      required: ['Currently York', 'Previously Leeds'],
      optional: ['Moved 2 February 2026'],
    },
    {
      id: 'job',
      category: 'changed-facts',
      text: 'What is my current job and employer?',
      required: ['Exhibition fabricator', 'Lantern Museum'],
      optional: ['Previously a lab technician at Northbank Ceramics'],
    },
    {
      id: 'drink',
      category: 'changed-facts',
      text: 'What is my usual morning drink now?',
      required: ['Peppermint tea'],
      optional: ['Previously coffee'],
    },
    {
      id: 'previous-job',
      category: 'changed-facts',
      text: 'Which job did I leave when I joined Lantern Museum?',
      required: ['Lab technician', 'Northbank Ceramics'],
      optional: ['Started at Lantern Museum on 9 February'],
    },
    {
      id: 'previous-drink',
      category: 'changed-facts',
      text: 'What morning drink did I replace with peppermint tea?',
      required: ['Coffee'],
      optional: ['Changed on 23 February'],
    },
    {
      id: 'garden',
      category: 'multi-session',
      text: "Which of the three garden quotes meets both Mum's access needs and my budget? Explain why the other two fail.",
      required: [
        'Fenwick Gardens at £1,800 with 55 cm beds meets the £2,000 budget and 60 cm reach limit',
        'Moss & Clay beds are too high at 75 cm',
        'Alder Yard is over budget at £2,100',
      ],
      optional: ['All prices include installation'],
    },
    {
      id: 'pottery',
      category: 'multi-session',
      text: 'Can I get from work to my Tuesday pottery class on time? How much time would I have to spare?',
      required: ['Yes', '35 minutes to spare'],
      optional: [
        'Work ends at 6 pm',
        'Travel takes 25 minutes',
        'Class starts at 7 pm',
      ],
    },
    {
      id: 'library',
      category: 'multi-session',
      text: 'Could I do a regular Saturday 11 am to 1 pm walk with Pip without moving any standing commitment? Explain.',
      required: ['No', 'Library shift overlaps from 11 am to noon'],
      optional: ['Shift is 10 am to noon at Wren Street Library'],
    },
    {
      id: 'garden-access',
      category: 'multi-session',
      text: 'Would the cheapest garden quote work for Mum, given her reach limit?',
      required: [
        'No',
        'Moss & Clay is cheapest at £1,600',
        'Its 75 cm beds exceed her 60 cm reach limit',
      ],
      optional: ['She uses a wheelchair'],
    },
    {
      id: 'kiln-plan',
      category: 'multi-session',
      text: 'Why did I need the community kiln on 3 March for Tidal Rooms?',
      required: [
        'To fire the porcelain tiles',
        'For the Riverside makers exhibition on 8 March',
      ],
      optional: ['Tiles were glazed on 2 March'],
    },
    {
      id: 'early-march',
      category: 'time',
      text: 'What project was I preparing in early March, and for which event?',
      required: ['Tidal Rooms', 'Riverside makers exhibition'],
      optional: ['8 March', 'Porcelain tiles', 'Water pump'],
    },
    {
      id: 'move-date',
      category: 'time',
      text: 'On which date did I move to my current city?',
      required: ['2 February 2026', 'York'],
      optional: ['From Leeds'],
    },
    {
      id: 'march-order',
      category: 'time',
      text: 'Did I start planning the bird hide before or after showing Tidal Rooms? Give the dates I told you.',
      required: [
        'After',
        'Tidal Rooms exhibited 8 March',
        'Bird hide being sketched 16 March',
      ],
      optional: [],
    },
    {
      id: 'job-date',
      category: 'time',
      text: 'When did I start at Lantern Museum?',
      required: ['9 February 2026'],
      optional: ['Exhibition fabricator'],
    },
    {
      id: 'drink-date',
      category: 'time',
      text: 'When did I switch my usual morning drink?',
      required: ['23 February 2026'],
      optional: ['From coffee to peppermint tea'],
    },
    {
      id: 'unknown-builder',
      category: 'unknown',
      text: "Which builder did I choose for Mum's garden, and why?",
      required: [
        'No builder has been chosen',
        'Fenwick Gardens was the only quoted option within both the budget and reach limit',
      ],
      optional: [
        'Moss & Clay beds were too high',
        'Alder Yard was over budget',
      ],
    },
    {
      id: 'unknown-site',
      category: 'unknown',
      text: 'Where exactly did Noor and I decide to put the bird hide?',
      required: [
        'No site was chosen',
        'The hide was still being sketched with Noor',
      ],
      optional: ['Removable roof'],
    },
    {
      id: 'unknown-budget',
      category: 'unknown',
      text: 'What budget did Noor and I settle on for the bird hide?',
      required: [
        'No budget was set',
        'The bird hide was still at the planning or sketching stage',
      ],
      optional: [],
    },
    {
      id: 'unknown-finish',
      category: 'unknown',
      text: 'What exact completion date did Noor and I commit to for the bird hide?',
      required: [
        'No completion date was chosen',
        'The bird hide was still being planned with Noor',
      ],
      optional: [],
    },
    {
      id: 'unknown-photographer',
      category: 'unknown',
      text: 'Which photographer did we hire for the bird hide?',
      required: [
        'No photographer was hired or named',
        'The hide is for watching birds, not photography',
      ],
      optional: ['Planning it with Noor'],
    },
  ],
}
