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
  /** Detect assistant echoes too: model replies use wall-clock timestamps. */
  testedPhrases?: string[]
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
  testedPhrases: [
    'Pip',
    'Silver Comet',
    'Ellis',
    'Bracken',
    'Saffron',
    'hazelnut',
    'Leeds',
    'York',
    'Northbank',
    'Lantern Museum',
    'peppermint',
    'coffee',
    'Fenwick',
    'Moss & Clay',
    'Alder Yard',
    'June',
    'garden',
    'pottery',
    'library',
    'Tidal Rooms',
    'Riverside',
    'kiln',
    'bird',
    'Noor',
  ],
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
      required: ['2 February', 'York'],
      optional: ['2026', 'From Leeds'],
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
      required: ['9 February'],
      optional: ['2026', 'Exhibition fabricator'],
    },
    {
      id: 'drink-date',
      category: 'time',
      text: 'When did I switch my usual morning drink?',
      required: ['23 February'],
      optional: ['2026', 'From coffee to peppermint tea'],
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
      id: 'unknown-garden-start',
      category: 'unknown',
      text: "What installation start date did I agree with a builder for Mum's garden?",
      required: [
        'No installation start date was agreed',
        'Garden builders had only provided quotes; no builder was chosen',
      ],
      optional: [],
    },
    {
      id: 'unknown-library-supervisor',
      category: 'unknown',
      text: 'Who supervises my regular library volunteer shift?',
      required: [
        'No supervisor was named',
        'The shift is at Wren Street Library on Saturdays from 10 am to noon',
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

// A year of independent details, including superseded values and short episodes.
// Keep these as dated prose: neither the replay nor the judge needs a second
// representation of the evidence, and required answers can be checked against it.
const v3Sessions = [
  [
    '2025-01-06',
    `I'm Rowan. I live at 18 Beech Terrace in Leeds, paying £725 monthly rent. I work as a lab technician at Northbank Ceramics, testing glaze samples on an Orton ST-1 dilatometer. My usual morning drink is coffee made in a copper three-cup moka pot. My partner is Saffron; we keep separate homes.
My retired greyhound Pip came home in 2019; his racing name was Silver Comet. His waterproof coat is size 66 cm, from Fell Houndwear. His vet is Dr Celia Moss at Quarry Veterinary Practice. His food is Arden Grange sensitive ocean white fish, 240 g per evening. My brother Ellis restored my green steel bicycle Bracken for my thirtieth birthday in 2021. Bracken takes 700 x 32C tyres and its frame is a 54 cm Reynolds 531.`,
  ],
  [
    '2025-01-13',
    `Mum, June, wants an accessible garden. Her wheelchair needs at least 84 cm clear gate width, and her maximum comfortable bed height is 60 cm. Her garden budget is £2,000 including installation. No installer has been chosen. No installation start date has been agreed.
June lives at 7 Orchard Close in Harrogate. Her folding chair is a Sunrise Quickie Life R, with a 42 cm seat. Her neighbour Marta Bell holds the spare front-door key. June's favourite cut flowers are apricot snapdragons; she grows them in a 90 cm trough. She wants an eastern path of compacted gravel, a 150 cm turning circle and a lever-operated outside tap. Her gardening gloves are Showa 310 in size small.`,
  ],
  [
    '2025-01-20',
    `Fenwick Gardens quoted £1,850 including installation for 58 cm beds and an 88 cm clear gate. Moss & Clay quoted £1,620 including installation for 72 cm beds and a 90 cm clear gate. The bed heights and gate widths in these quotes cannot be changed. I put the papers aside and mended a pocket. Inside my old sewing tin I found Aunt Lorna's silver thimble, engraved with the initials E.W.; she left it to me in 2017.
My sewing machine is a Janome HD2200. I use size 90 denim needles for canvas, Gutermann Mara 100 navy thread for repairs and a 12 mm seam allowance for tool rolls. The machine's bobbins are class 15 plastic. My cutting mat is an Olfa A2 and the rotary cutter takes 45 mm blades. I keep pattern weights in a blue biscuit tin.`,
  ],
  [
    '2025-01-27',
    `Alder Yard's garden quote is £2,180 including installation for 55 cm beds and an 86 cm clear gate; those dimensions cannot be changed either. Fenwick Gardens remains a quote, not a booking. I am building an exhibition model called Tidal Rooms, using porcelain tiles and a recirculating water pump. My exhibition transport box has an internal length of 62 cm and an internal width of 44 cm.
My porcelain is Audrey Blackman body, fired to 1,220 degrees Celsius. The model's pump is a 12 V Eden 104 with a 6 mm outlet. I use platinum silicone tubing with a 4 mm bore. The pump's supply is a Mean Well GST25A12. The model rests on a 9 mm birch plywood base. Its tiles use a satin celadon glaze recipe labelled C-17 in my notebook. My kiln shelf wash is a 50:50 mix of alumina and kaolin.`,
  ],
  [
    '2025-02-03',
    `Today, 3 February 2025, I moved from Leeds to York, to Flat 2, 9 Foss Lane. The new rent is £860 a month. I still work at Northbank Ceramics. My regular library shift is now Saturday 10 am to noon at Wren Street Library, repairing book covers.
The York flat's kitchen recess is 57 cm wide and 61 cm deep. The living-room curtain rail is 184 cm long. The landlord is Ruth Venn, and repairs go to Foss Lettings reference FL-209. My electricity tariff is Bramble Fixed 12, at 24.8 p per kWh. The stopcock is behind the bottom kitchen drawer. The hallway takes a runner no wider than 68 cm. My desk is an oak Ercol 449 with a 96 cm top.`,
  ],
  [
    '2025-02-10',
    `Today, 10 February 2025, I left Northbank Ceramics and started as an exhibition fabricator at Lantern Museum. My museum contact is workshop manager Ivo Chen. I take the number 14 bus to work, with a monthly pass costing £64. On Tuesdays my shift ends at 6 pm. The museum-to-pottery journey takes 25 minutes.
My museum locker is B-17. My required safety shoes are size 8 Cofra New Reno. I use a Trend Airshield Pro for dusty fabrication, with replacement filters THP2. The workshop's sheet stock is stored vertically in rack D. My personal combination square is a 150 mm Moore & Wright. My marking knife is a right-handed Narex with a 12 mm blade. I use a yellow Stanley FatMax 5 m tape.`,
  ],
  [
    '2025-02-17',
    `My Tuesday pottery class starts at 7 pm at Kiln House. The class is taught by Asha Mistry; it costs £18 per session. Saffron has a hazelnut allergy and avoids hazelnut oil as well as whole nuts. Her birthday is 14 July. She likes dark chocolate with orange peel.
At pottery I use a Dolan 510 trimming tool, a red Mudtools rib and a size 6 Hake brush. My throwing bat is 30 cm plaster. I reclaim scraps in a 10 litre lidded bucket and wedge on a canvas-covered board. My usual bowls start with 650 g of clay. I sign their undersides with a small stamped fern. My apron is waxed indigo cotton, with a cross-back strap.`,
  ],
  [
    '2025-02-24',
    `From today, 24 February 2025, peppermint tea replaces coffee as my usual morning drink. The moka pot goes in the cupboard. I booked the community kiln for 4 March 2025 to fire Tidal Rooms' porcelain tiles. The model is for the Riverside makers exhibition on 9 March 2025.
My peppermint is loose-leaf Blackthorn Mint, 2 g brewed for six minutes. My tea mug is a 320 ml Denby Greenwich. For packed lunches I use a 750 ml steel Black+Blum box. My kitchen scale is a Salter 1036, and my bread tin is a 900 g Mermaid hard-anodised tin. I buy Shipton Mill number 4 white flour and keep it in a 5 litre glass jar. My oven thermometer hangs on the middle shelf.`,
  ],
  [
    '2025-03-03',
    `This week, 3 to 9 March 2025, is Tidal Rooms week. I glazed the tiles today; the kiln booking is tomorrow. The exhibition model measures 60 cm long by 42 cm wide including its handles. I cut a foam cradle, checked the pump and printed a display label headed Borrowed Water. I need the transport box for this finished model.
For fragile models I use 25 mm Plastazote LD45 foam, cut with a serrated bread knife. My reusable tie-downs are 20 mm red webbing with cam buckles. The display lettering is 18 point Gill Sans on warm-white card. I photograph finished work against a Lastolite smoke-grey backdrop. My camera is a used Fujifilm X-T20 with a 35 mm f/2 lens. The tripod quick-release plate is an Arca 38 mm.`,
  ],
  [
    '2025-03-10',
    `I showed Tidal Rooms at the Riverside makers exhibition on 9 March 2025. The kiln firing on 4 March 2025 succeeded. The exhibition is over; the model is now stored in the museum's dry cupboard. This week, 10 to 16 March 2025, I am repairing the library's flood-damaged atlases, starting with the 1968 Bartholomew world atlas. I carried the packing foam home in the rain.
For atlas repairs I use Japanese tengujo tissue at 9 gsm, wheat starch paste strained through muslin and a 22 mm flat goat-hair brush. My blotting paper is 300 gsm unbuffered cotton. I press repairs between 6 mm acrylic boards with brass weights. Spine labels use Zanders Zeta linen paper. I record repairs in a burgundy Leuchtturm A5 ledger. My book cloth is dark green Arbelave buckram.`,
  ],
  [
    '2025-03-17',
    `Today, 17 March 2025, Noor and I started sketching a birdwatching hide called Reed Shelter. It has a removable roof. It is for watching birds, not photography; no photographer has been hired or named. No site has been chosen. The roof's removable panel must weigh no more than 8 kg because Noor will lift it alone.
Noor's full name is Noor Rahman. She lends me a Bahco Laplander folding saw with a 190 mm blade. Our sketch scale is 1:20. We plan to use untreated larch boards 18 mm thick and stainless A2 screws. I prefer torx T20 heads outdoors. My drill is a Makita DDF484 with 3 Ah batteries. The portable workbench is a folding Wolfcraft Master 200. I keep exterior fasteners in amber-lidded Sortimo boxes.`,
  ],
  [
    '2025-03-24',
    `For Reed Shelter we now have a roof-panel supplier, Moor Timber. Its larch panel is 7.4 kg and costs £96. Canal Boards offers a cedar panel at 8.6 kg for £82. Neither supplier will alter its panel. I wrote the two quotes in the notebook and then cleared crumbs off the table. No hide site has been chosen yet.
My binoculars are Opticron Discovery 8x42, with a 17.8 mm eye relief. I use a neoprene OpTech harness, not the supplied neck strap. My bird guide is the second edition of Collins Bird Guide with a green cloth cover. I record sightings in pencil on Rite in the Rain number 135 paper. My flask is a 500 ml Klean Kanteen in brushed steel. I keep a laminated BTO bird-code card inside the guide.`,
  ],
  [
    '2025-03-31',
    `I am still at Lantern Museum. The museum installed a new Tuesday rota today, 31 March 2025: I finish at 6:40 pm instead of 6 pm. The pottery journey is unchanged. Reed Shelter remains a sketch, with the roof quotes filed. I bought a secondhand record player and spent the evening adjusting its feet.
The record player is a Dual CS 505-2 with an Ortofon OM10 cartridge. Tracking force is 1.5 g. My amplifier is a NAD 3020i and the speakers are Wharfedale Diamond 9.1. I use QED 79 strand speaker cable. My cleaning fluid is L'Art du Son diluted 1:50. Records go in 12 inch Nagaoka antistatic sleeves. The turntable sits on a 43 cm maple isolation shelf. My preferred brush has carbon-fibre bristles.`,
  ],
  [
    '2025-04-07',
    `Reed Shelter is paused from today, 7 April 2025, because the landowner has not granted permission. No site has been chosen and no completion date has been agreed. My current making project is a portable shadow theatre called Paper Moon. Its screen is 80 cm wide and 55 cm high. I need it to pack flat for train journeys. I need a carrying case with an internal width of at least 82 cm. My carrying-case budget is £90.
For Paper Moon I use 180 gsm black Canford card, 2 mm brass puppet rods and M3 wing nuts at the frame joints. The screen cloth is unbleached cotton lawn. The hinges are 25 mm piano-hinge offcuts. My cutting knife is an NT A-300GR with 30 degree blades. I use a 7 W warm-white LED backlight and a 12 V barrel connector with centre-positive polarity. My scenery palette is indigo, ochre and chalk white.`,
  ],
  [
    '2025-04-14',
    `The library has changed my standing shift from Saturdays to Wednesday 5 pm to 7 pm, effective 14 April 2025. It is still at Wren Street Library. A Paper Moon lighting test made the thin puppet rods disappear as intended.
My local case supplier gives three fixed options: Ash Cases, 84 cm internal width at £74; Bell Trunks, 79 cm at £59; and Crateworks, 86 cm at £112. My overnight bag is a 28 litre Millican Smith in slate. I use Eagle Creek small packing cubes, a 1.8 m braided USB-C lead and a Mu folding mains plug. My travel towel is a 60 by 120 cm linen waffle towel.`,
  ],
  [
    '2025-04-21',
    `Saffron and I ended our romantic relationship on 21 April 2025. We remain friends and will still share our allotment. Neither of us moved home because of the breakup. Our allotment is plot 26B at Willow Bank; the annual plot rent is £48. We split that rent equally.
The plot's shed key has a triangular purple tag. Our water butt holds 210 litres. We grow Charlotte first-early potatoes, Boltardy beetroot and White Lisbon spring onions. I sow climbing beans in 9 cm square pots. Our compost bays are each 90 cm wide. I use a Sneeboer hand fork with a 14 cm handle. The bean frame is made from eight 2.4 m hazel poles. The shared plot notebook has a mustard-yellow cover.`,
  ],
  [
    '2025-04-28',
    `Paper Moon's first public performance was on 26 April 2025 at Cinder Hall, for an audience of 34. Today, 28 April 2025, I dismantled the screen and put the theatre in storage. I am making a field-recording kit next, rather than planning another performance. I washed a stack of mugs after the packing session.
My recorder is a Zoom H1n and my windscreen is a Rycote Mini Windjammer. I record WAV at 48 kHz and 24 bit. My headphones are closed-back Sony MDR-7506. The recorder takes rechargeable AAA Eneloop cells. My audio card is a 32 GB SanDisk Extreme microSD. My file naming format is date, location, then take number. I carry the recorder in a Lowepro Tahoe CS 20 pouch. My desk audio interface is a Focusrite Scarlett Solo third generation.`,
  ],
  [
    '2025-05-05',
    `I started a sound project called Canal Voices today, 5 May 2025. It documents lock gates and boat engines, not interviews. The plan is to record at dawn twice a month. The proposed release is a six-track download; no release date has been agreed. I want headphones that fit inside my 21 cm wide equipment drawer.
My archive drive is a 2 TB Samsung T7 Shield in blue. I keep a second copy on a 4 TB Toshiba Canvio Basics at Ellis's house. Project folders use year-month prefixes. I edit sound in Reaper with a 128 sample buffer. My reference listening level is 70 dBA. I use a K&M 210/9 microphone stand with a 3/8 inch adapter. My desk cable ties are reusable 15 cm Velcro One-Wrap in violet.`,
  ],
  [
    '2025-05-12',
    `From 12 May 2025 my usual morning drink is rooibos, replacing peppermint tea. I prefer the Cedar Cup loose-leaf blend, 3 g for five minutes. My Canal Voices drawer search found three headphone cases: Larch Audio is 20 cm wide at £38, Beacon Sound is 23 cm at £29, and Quiet Kit is 19 cm at £61. I can spend at most £45 on this case. These are exterior widths.
My coffee grinder, now used only for visitors, is a Wilfa Svart on setting 18. I use Hario number 02 paper filters for guests. My kettle is a 1 litre Dualit Lite in cream. The kitchen timer is a magnetic red TFA Puck. I buy oat milk from Minor Figures in 1 litre cartons. My insulated bottle is a 600 ml Laken Futura in teal. I keep tea in square 125 g tins with cork labels.`,
  ],
  [
    '2025-05-19',
    `I need an archive shelf for the Canal Voices drives. Its maximum depth is 27 cm and its load rating must be at least 18 kg. I am still renting the York flat. I took Pip to the park and replaced a loose shoelace. On the way home I collected my repaired watch; the repairer is Inez Cole at Second Hand Time, and she fitted a 19 mm oxblood leather strap.
My watch is a hand-wound Timex Marlin from 1967. My alarm clock is a Braun BC02 in grey. I keep spare LR44 cells in a small white pillbox. My spectacle frames are Cubitts Herbrand in peat. The reading lamp is a brass Anglepoise Original 1227 with a 470 lumen bulb. My bedside shelf is 22 cm deep. I use a linen-covered hot-water bottle with a 1.5 litre capacity. My notebook pen takes Schmidt P8126 blue refills.`,
  ],
  [
    '2025-05-26',
    `The shelf quotes arrived. Rowanwood offers a 25 cm deep shelf rated for 20 kg at £68. Flint Joinery offers 30 cm depth and a 25 kg rating at £63. Alder Shelving offers 26 cm depth and a 15 kg rating at £54. These dimensions and load ratings are fixed. I have not ordered any shelf. Canal Voices has two dawn recordings so far.
My archive labels use 12 mm Brother TZe-231 tape. I store spare drives in antistatic bags with silica sachets. My socket tester is a Martindale BZ101. My solder is lead-free 0.7 mm Multicore SAC305. I solder audio plugs at 350 degrees Celsius. My multimeter is a Brymen BM235. I use Neutrik NYS231BG plugs for mini-jack repairs. My electronics mat is a 60 by 40 cm blue silicone mat.`,
  ],
  [
    '2025-06-02',
    `Today, 2 June 2025, I moved from York to Sheffield, to 41 Rivelin Street. Rent is £910 monthly. I kept the Lantern Museum job temporarily, working in blocks with overnight stays. My Sheffield landlord is Dev Patel. My new tenancy reference is RV-618. I closed the York electricity account at a final meter reading of 8,463 kWh.
The Sheffield front door is 81 cm clear when open. The workshop alcove is 126 cm wide. My worktop stands 92 cm high. The boiler is a Worcester Greenstar 30i. My heating programmer is a Honeywell ST9400C. The fuse board is in the cupboard below the stairs. My broadband plan is MoorNet Fibre 150, £29 monthly. I use a TP-Link Archer AX55 router with a 3 m Cat6 cable. The recycling collection is fortnightly.`,
  ],
  [
    '2025-06-09',
    `I need a new archive-paper supplier with acid-free A3 sheets in packs of 25. My budget is £24 per pack including delivery. Quarry Paper offers acid-free A3, 25 sheets, delivered for £22. Fern Mill offers acid-free A4, 25 sheets, delivered for £18. I wrote the prices down but ordered nothing. I spent the afternoon sorting a drawer of old maps.
My map cabinet is a five-drawer Bisley A1 in goose grey. The drawer liners are 120 gsm unbuffered paper. I use cotton gloves only for photographs and clean dry hands for paper. My polyester sleeves are Secol 75 micron. My ruler is a 60 cm stainless Helix with a cork back. I flatten rolled maps around a 75 mm archival tube. My paste strainer is a nylon 100 mesh sieve. My document weights are 250 g glass rectangles.`,
  ],
  [
    '2025-06-16',
    `Today, 16 June 2025, I left Lantern Museum and joined Westfold Archive as a preventive conservation assistant. My manager is Ada Finch. My regular commute is now a 22 minute walk, replacing the museum bus. My new work week is Monday to Thursday, 8:30 am to 4:30 pm. The archive induction covered humidity sensors and pest traps.
My archive badge number is WF-083. My preferred sensor is a Testo 174H. I record relative humidity as whole percentages and temperature to one decimal place. I use a 55 percent RH upper warning threshold for the textile store. The trap map uses bay labels A1 through F8. My inspection torch is a Ledlenser P4R. My inspection mirror has a 30 mm head. I carry a white Pelican 1010 case for sensor cables.`,
  ],
  [
    '2025-06-23',
    `The third archive-paper quote is Bracken Press: acid-free A3, 25 sheets, delivered for £27. None of the three paper suppliers will change size or pack count at these prices. My field kit needs a rechargeable light with at least six hours of runtime. I set a £50 ceiling. Canal Voices continues alongside the new job.
My field-kit pencil is a Pentel GraphGear 500 with 0.7 mm 2B lead. I carry a 15 cm transparent Linex rule and a Silva Ranger compass. My rain jacket is a Rab Downpour in deep ink, size medium. My field boots are Altberg Fremington in size 8.5. The boot wax is Leder-Gris brown. My first-aid pouch is a red Ortlieb size small. The emergency blanket is a reusable SOL heavy-duty sheet. My kit inventory is written on waterproof yellow card.`,
  ],
  [
    '2025-06-30',
    `Three fixed field-light options: Hare Lamp lasts seven hours and costs £46; Plover Light lasts four hours and costs £32; and Stoat Beam lasts eight hours and costs £65. I have not bought one. I spent the evening washing window glass. Canal Voices now has lock-gate recordings from three separate dawn visits.
My window squeegee is a 25 cm Ettore brass channel. My household cleaner is unscented Bio-D concentrate, diluted 1:40. I use separate yellow cloths for kitchen surfaces and green cloths for glass. My vacuum is a Numatic Henry HVR160 with HepaFlo bags. My laundry detergent is Ecover Zero powder, 50 ml per full wash. My ironing board is a 110 by 35 cm Brabantia. The clothes airer is a three-tier Lakeland Dry:Soon. My shoe rack is 74 cm wide.`,
  ],
  [
    '2025-07-07',
    `Today, 7 July 2025, Canal Voices moved from recording to editing. All six tracks have been recorded. I am trimming engine noise and building the sequence. Reed Shelter is still paused for permission. For a small listening event I need a venue with step-free access and capacity for at least 28 people; the hire budget is £120.
My edit keyboard is a Keychron K2 with brown switches. I use a Kensington Orbit trackball and an LG 24QP500 monitor. My monitor arm is an Ergotron LX in white. My desk chair is a secondhand Orangebox Do with a mesh back. My footrest is a 10 cm cork block. My editing breaks follow 45 minutes working and 10 minutes away from the screen. My sound-level meter is a Benetech GM1356. My monitor brightness is set to 110 cd per square metre.`,
  ],
  [
    '2025-07-14',
    `The listening venues have fixed offers: Willow Room, step-free, capacity 30, £110; Copper Loft, stairs only, capacity 40, £95; and Mill Studio, step-free, capacity 35, £145. No venue has been booked. I posted Saffron a birthday card. She is still my friend and allotment co-holder.
My card paper is 250 gsm Munken Pure. I print with a Canon Pixma iP8750 using CLI-551 inks. My envelope size for cards is C6, in kraft brown. Postage stamps stay in the top right desk drawer. My address stamp uses violet Trodat 7011 ink. I draw with a Faber-Castell Pitt fine pen in sepia. My birthday notebook is an undated red Paperblanks book. My paper trimmer is a Dahle 507 with a 320 mm cutting length.`,
  ],
  [
    '2025-07-21',
    `The library transfer is arranged. From 21 July 2025 my regular volunteer shift is Sunday 2 pm to 4 pm at Bell Street Library in Sheffield. This replaces Wednesday evenings at Wren Street Library. I still repair books. A volunteer asked about a weekly Sunday walk from 3 pm to 5 pm; I haven't accepted it.
At Bell Street I use Klucel G in ethanol for consolidating powdery leather. My leather dressing brush has 18 mm hog bristles. The book cradle opens to 110 degrees. My bone folder is 16 cm long with a pointed end. My repair scissors are Kai 5100, 10 cm overall. I keep new scalpel blades in a screw-top sharps jar. My corner jig cuts a 3 mm clearance. I use a 25 cm polished agate burnisher on repaired labels.`,
  ],
  [
    '2025-07-28',
    `Today, 28 July 2025, I released Canal Voices as a six-track download on my own website. The final track is called Low Gate at Dawn and lasts 4 minutes 18 seconds. No listening event has been booked. I am switching my spare-time work to a folding map cabinet called Folded Atlas. The first sketches use a concertina door.
My website domain is rowanmakes.example. I use the font Atkinson Hyperlegible for project notes. My standard download artwork is 1,600 pixels square. My licensing choice for Canal Voices is Creative Commons BY-NC 4.0. The audio masters are 48 kHz, 24 bit WAV; public downloads are FLAC. My project thumbnails use an off-white background, hex F2EFE6. My caption style is sentence case. My credit line is Sound and construction by Rowan Hale.`,
  ],
  [
    '2025-08-04',
    `From 4 August 2025, decaffeinated Assam replaces rooibos as my usual morning drink. I use Birch Tea's broken orange pekoe, 2.5 g brewed for four minutes. I need a Folded Atlas hinge that can hold at least 12 kg, with a leaf no wider than 16 mm so it fits the rebate. The hinge budget is £35 for the set.
For cabinet work I prefer 12 mm Baltic birch plywood and 4 mm ash edging. My glue is Titebond Original, clamped for 45 minutes at room temperature. My block plane is a Veritas low-angle model with a 25 degree bevel. My smoothing plane is a Record number 4. I sharpen on Shapton 1,000 and 5,000 grit stones. My square cabinet knobs are 24 mm beech. I finish interiors with two coats of Osmo Polyx Raw 3044.`,
  ],
  [
    '2025-08-11',
    `The fixed hinge offers are Finch Hardware, 14 kg rating, 15 mm leaf, £32 per set; Kite Fittings, 10 kg, 14 mm leaf, £24; and Heron Ironwork, 16 kg, 18 mm leaf, £33. None will alter these sizes. I have not ordered hinges. Ellis visited and measured the workshop doorway before we ate soup.
Ellis lives at 32 Cedar Avenue in Derby. He works as a railway signalling designer at Trent Signalworks. His birthday is 8 November. He drinks lapsang souchong without milk. His preferred bread is seeded rye. His cat is Mica, a tortoiseshell adopted in 2020. His touring bicycle is a blue Spa Wayfarer with 36-spoke wheels. His workshop vice is a red Record number 3. He keeps my backup drive in his upstairs study's locked oak cabinet.`,
  ],
  [
    '2025-08-18',
    `I got the roof-panel drawings out again. Moor Timber's quoted larch panel is still available. Reed Shelter has not restarted; the landowner still hasn't granted permission. Noor has agreed to check our drawings but is away until September. I measured my Folded Atlas prototype and wrote the dimensions in the margin.
The prototype is 72 cm wide, 48 cm deep and 88 cm tall. Its six drawers each have a 58 by 36 cm interior. Drawer stops are 8 mm brass pins. My cabinet back is 6 mm poplar ply. My assembly clamps are 600 mm Bessey K-body REVOs. The door pull is a 90 mm leather loop in chestnut. The cabinet feet are 35 mm cork cylinders. My drawing notebook uses 5 mm dot-grid paper, with scale notes in green pencil.`,
  ],
  [
    '2025-08-25',
    `Folded Atlas has reached the prototype stage. I want a delivery trolley that is at most 50 cm wide and rated for at least 80 kg. My budget is £100. I am keeping the Sheffield house and the archive job. A quiet evening involved finding a missing screw under a chair.
For moving cabinets I use blankets made from recycled wool at 350 gsm. My corner guards are 50 mm moulded rubber. My ratchet straps are 25 mm wide with a 400 daN rating. I use a pair of aluminium loading ramps 150 cm long. My workshop floor pads are 60 cm square EVA tiles. My folding step stool is a two-step Hailo L40. The cabinet delivery toolkit lives in a 16 inch Stanley metal-latch toolbox. My trolley tie-down hooks must have sprung gates.`,
  ],
  [
    '2025-09-01',
    `Three trolley quotes came in: Otter Handling is 48 cm wide, rated 90 kg, £94; Badger Goods is 54 cm wide, rated 120 kg, £88; and Vole Tools is 46 cm wide, rated 70 kg, £76. These specifications are fixed. I have not bought a trolley. This autumn's main project is Folded Atlas, with a six-drawer cabinet prototype.
My calendar is a wall-mounted A3 planner. I mark archive work in blue, volunteering in purple and workshop time in green. My pencil eraser is a Tombow Mono Zero round 2.3 mm. I use removable 18 mm coloured dots for deadlines. My desk filing trays are Leitz Plus in petrol blue. My receipts go into monthly DL envelopes. My receipt scanner is a Brother DS-640 at 300 dpi. My household budget sheet uses pounds rounded to the nearest penny.`,
  ],
  [
    '2025-09-08',
    `This week, 8 to 14 September 2025, I tested Folded Atlas's drawer stops, delivered the prototype to Cinder Hall for a trial, and patched the library's railway timetables. The cabinet's concertina door jammed in the hall's humid side room. The cabinet is not ready for sale. I need replacement drawer lining that is acid-free and no thicker than 1.5 mm.
My railway timetable collection covers the Midland route from 1932 to 1964. I store loose tickets in 60 by 90 mm Secol pockets. My oldest ticket is a 1948 Derby to Matlock day return. The collection came from Grandad Felix in 2012. My catalogue prefix is RH-MID. My magnifier is a 6x Peak linen tester with a 25 mm base. My map bookmarks are strips of unbleached cotton tape. I keep the catalogue in a green A4 ring binder.`,
  ],
  [
    '2025-09-15',
    `From today, 15 September 2025, my commute is a bicycle ride, replacing the 22 minute walk. I ride Bracken along the Rivelin path and allow 14 minutes. My pannier is an Ortlieb Back-Roller Classic in petrol blue. Folded Atlas's replacement lining offers are Sedge Board, acid-free, 1.2 mm, £16; Reed Sheets, acid-free, 2 mm, £12; and Rush Stock, not acid-free, 1 mm, £9. I have no price ceiling for this lining.
Bracken's rear rack is a Tubus Logo Evo rated for 26 kg. Its dynamo light is a Busch & Muller IQ-X at 100 lux. The rear light is a Secula Plus on the mudguard. My lock is an Abus Granit XPlus 540, 230 mm shackle. I carry a Lezyne Pocket Drive pump and two Park Tool GP-2 patch kits. Chain lubricant is Fenwicks all-conditions oil. The saddle is a Brooks B17 in honey leather.`,
  ],
  [
    '2025-09-22',
    `Today, 22 September 2025, I cancelled Folded Atlas as a product because the concertina door kept swelling. I am keeping the prototype for my own maps. No customer bought it. I am starting a winter project called Night Orchard, a set of illuminated seed-pod sculptures. I spent the rest of the afternoon sweeping the workshop.
Night Orchard uses 0.8 mm brass sheet, 3 mm copper stems and translucent mulberry paper. The solder joints use a citric-acid pickle at 10 percent concentration. My jeweller's saw is a Vallorbe frame with a 75 mm throat. I use size 2/0 piercing blades. My bench pin is a V-slot beech block 18 cm long. The paper adhesive is methyl cellulose at 3 percent. My shaping stake is a 40 mm steel mushroom. I texture brass with a polished ball-peen hammer.`,
  ],
  [
    '2025-09-29',
    `I put Night Orchard's first three seed pods on the shelf. Each needs a low-voltage lamp. I want a driver at 12 V DC with a capacity of at least 24 W, and my spending limit is £30. Reed Shelter is still paused. I watched a dull programme while cleaning brass filings out of a tray.
My soldering station is a Hakko FX-888D with a T18-D16 tip. My fume extractor is a Kotto bench unit with activated-carbon filters. The brass patina is liver of sulphur gel diluted in warm water. I neutralise it with bicarbonate solution and seal it with Renaissance microcrystalline wax. My metal shears are straight-cut Bessey D15A. I use 400 grit wet-and-dry paper before patination. My eye protection is Bolle Tracker clear goggles. My bench tray is a 40 by 30 cm enamel dish.`,
  ],
  [
    '2025-10-06',
    `Today, 6 October 2025, Westfold Archive changed my role to collections environment coordinator. I am still employed there, reporting to Ada Finch. My commute remains the bicycle ride. My work hours are now Monday to Friday, 9 am to 5 pm. The job involves monthly climate reports for four stores.
My report template uses the title Store climate review. I export readings as CSV with ISO dates and a semicolon delimiter. My chart interval is 30 minutes. Store one holds textiles, store two paper, store three photographs and store four mixed objects. My escalation contact for leaks is facilities officer Tomas Reed. His radio call sign is Facilities Two. I keep emergency absorbent rolls in cupboard E4. My work notebook is a Rhodia number 16 dot pad.`,
  ],
  [
    '2025-10-13',
    `Night Orchard's fixed driver offers: Wren Power is 12 V DC, 30 W, £28; Swift Electrics is 24 V DC, 36 W, £24; and Martin Supplies is 12 V DC, 18 W, £21. I have not bought a driver. The seed pods are for the Winter Lantern Walk on 13 December 2025. I need the driver for these lamps, not for Tidal Rooms.
The lantern route starts at Birch Gate and ends at the old bandstand. My display location is marker L7 beside the chestnut stump. My hanging wire is 0.5 mm stainless steel. Each pod's diffuser is a 7 cm mulberry-paper sphere. I use 2,700 K LED strips with 60 LEDs per metre. My quick connectors are Wago 221 two-port levers. The cable is 0.5 square mm silicone twin wire. My connector enclosure is an IP65 Hammond 1554C.`,
  ],
  [
    '2025-10-20',
    `Today, 20 October 2025, I restarted Reed Shelter after the landowner gave permission. Noor and I chose the north edge of Mere Fen as its site. We will use Moor Timber's larch roof panel. The budget is £640, but no completion date has been agreed. I can work on this alongside Night Orchard.
The landowner is Anika Lowe. Site access is through a 95 cm kissing gate. The agreed hide footprint is 180 by 140 cm. We will use six ground screws, each 550 mm long. The viewing slot's lower edge is 105 cm above the floor. My folding site stool is a Walkstool Comfort 55. We must carry off all offcuts. The site plan is filed as MF-RS-04. The permission covers a removable structure only, with no concrete foundations.`,
  ],
  [
    '2025-10-27',
    `I now need a roof sealant compatible with larch and rated for outdoor use below freezing. The roof remains removable. Noor carried the drawings while I checked the site measurements. At home I made soup. In the kitchen drawer, the handwritten lentil-soup recipe is on a postcard from Uncle Basil, dated 2008; its unusual spice is ground fenugreek, half a teaspoon for four portions.
My soup pot is a 4.2 litre Le Creuset casserole in volcanic orange. I use a 20 cm Victorinox chef's knife and a 38 by 28 cm maple chopping board. My lentils are red split Masoor from East End. My stock powder is Marigold reduced salt. The spice jars are 100 ml amber glass. My mortar is a 14 cm granite one. My hand blender is a Braun MultiQuick 5 with a stainless shaft. I freeze soup in 500 ml rectangular boxes.`,
  ],
  [
    '2025-11-03',
    `Today, 3 November 2025, I moved within Sheffield, from Rivelin Street to 6 Kelham Court. Rent is £980 monthly. I kept the archive job and my bicycle commute. The new workshop is 3.2 m long and 2.4 m wide. The landlord is Nessa Wood. The old Sheffield tenancy is closed.
My new tenancy reference is KC-442. The workshop's door opening is 78 cm clear. The ceiling hook safe working load is 15 kg. My heating is controlled by a Drayton Digistat plus. The stopcock is under the utility sink. My curtains need a 205 cm drop. The desk wall can take a shelf up to 116 cm wide. The hallway light takes a B22 bulb. My household insurance is with Penn Mutual under plan Home Craft; its contents limit is £32,000.`,
  ],
  [
    '2025-11-10',
    `The sealant offers are fixed: Tarn Seal is larch-compatible and rated to minus 10 degrees Celsius; Moss Seal is larch-compatible but rated only above 5 degrees Celsius; Bank Seal is rated to minus 15 degrees Celsius but unsuitable for larch. I have not chosen a sealant. Reed Shelter's frame is cut, but the hide is not finished.
My winter gloves are waterproof Sealskinz All Weather in size medium. My head torch is a Petzl Actik Core at 450 lumens. My reflective vest is an orange Portwest C470. I carry a 700 ml Stanley Adventure flask. My site lunch bag is a 6 litre Carhartt cooler. I use a folding Tajima G-Saw with a 240 mm blade for crosscuts. My kneeling pad is a 35 mm thick Burgon & Ball memory-foam pad. My site notebook clips to a 23 by 32 cm aluminium clipboard.`,
  ],
  [
    '2025-11-17',
    `From 17 November 2025 my usual morning drink is roasted barley tea, replacing decaffeinated Assam. I buy Hoshino mugicha bags and brew one in 400 ml water for seven minutes. The archive work and library shift are unchanged. I finished wiring the seventh Night Orchard seed pod.
My bedroom duvet is wool, rated 10.5 tog. The sheets are undyed linen from LinenMe in king size. My pillow is a medium-support Soak & Sleep wool pillow. I use a 17 litre MeacoDry ABC dehumidifier in the workshop. Its humidity target is 50 percent. My indoor thermometer is a TFA Dostmann digital unit. My door draught excluder is a 76 cm wool sausage in moss green. My slippers are Glerups felt boots in charcoal. I use a 30 minute wind-down timer before sleep.`,
  ],
  [
    '2025-11-24',
    `Night Orchard is ready for an outdoor test. There are nine illuminated seed pods on three branching stands. Each stand is 145 cm high. I need a carrier for the stands with an internal length of at least 150 cm. The maximum packed weight is 16 kg because I will carry it alone.
My stand carrier is a custom canvas sleeve, with 18 oz olive duck fabric and 50 mm cotton handles. I reinforce its ends with 3 mm felt. My fabric scissors are Fiskars Amplify 24 cm. The seam thread is Coats Dabond V69 in olive. My leather needle is size 110/18. I use nickel-plated 15 mm press studs. The carrier's care label says brush clean only. My fabric supplier is Merchant & Mills. I keep spare studs in a square clear Really Useful box.`,
  ],
  [
    '2025-12-01',
    `This week, 1 to 7 December 2025, I tested Night Orchard outdoors in drizzle, replaced a cracked diffuser on pod seven and made route cards for the Winter Lantern Walk. Reed Shelter is still unfinished; we have cut the frame but not installed it. No completion date has been agreed for the hide.
My route cards are A6 waterproof Polyart at 170 gsm. They show a 1:2,500 route map. My outdoor labels are written with a Staedtler Lumocolor permanent F pen. My spare diffusers travel in a 1.2 litre Lock & Lock box. I use silicone caps on exposed cable ends. My outdoor extension lead is 15 m H07RN-F with an RCD plug. My tool light is a Bosch GLI 12V-330. My emergency repair tape is clear Gorilla Crystal Clear, 48 mm wide.`,
  ],
  [
    '2025-12-08',
    `Night Orchard's carrier measures 154 cm internally and weighs 14.6 kg when packed. That includes the stands and all nine pods. The Winter Lantern Walk remains scheduled for 13 December 2025. The organiser is Petra Singh, and the assembly point is Birch Gate at 4 pm.
My event boots are insulated Muck Arctic Sport in size 8. I carry a black 20 litre Ortlieb dry bag. My event check-in sheet uses numbered boxes 1 to 9. My spare LED fuses are 2 A glass, 5 by 20 mm. My portable battery is a 12 V 7 Ah Yuasa NP7-12. My battery connectors are insulated 6.3 mm spades. My safety labels are yellow with black lettering. The carrier hangs from two 40 mm steel garage hooks at home.`,
  ],
  [
    '2025-12-15',
    `Night Orchard was displayed at the Winter Lantern Walk on 13 December 2025. All nine pods worked. Today, 15 December 2025, I packed it away. This week, 15 to 21 December 2025, I am repairing a split bellows on Ellis's concertina and cataloguing winter photographs. Reed Shelter is unfinished, with no agreed completion date.
Ellis's concertina is a 30-button Lachenal Anglo in C/G, serial 18462. The split is in the third bellows fold on the left. My bellows leather is 0.4 mm goatskin. I use hide glue warmed to 60 degrees Celsius. The concertina's case is lined with wine-red velvet. Its shoulder strap is 18 mm black leather. The repair notes are in a cream A6 notebook. I photograph each fold with a 10 cm scale bar. My storage tissue for instruments is unbuffered and acid-free.`,
  ],
  [
    '2025-12-22',
    `I repaired the concertina bellows and returned it to Ellis today, 22 December 2025. He played a tune while I washed up. My next project is a seed-library cabinet for Bell Street Library, called Seed Ledger. It is only a proposal. No timber species has been chosen, no funding has been awarded and no installation date has been agreed.
The library's proposed cabinet recess is 104 cm wide and 39 cm deep. Seed packets should fit slots at least 11 cm tall. The librarian handling proposals is Mae Osei. My proposal reference is BSL-SL-07. I want large-print drawer labels in 20 point type. My seed envelopes are 70 by 100 mm glassine. I use a Pelikan 4001 brilliant-black ink for packet dates. The proposed cabinet must be freestanding, because the library cannot drill its wall. My drawing scale is 1:10.`,
  ],
  [
    '2025-12-29',
    `Seed Ledger is still only a proposal, with no timber species chosen, no funding awarded and no installation date agreed. Reed Shelter is unfinished. My job is collections environment coordinator at Westfold Archive, and I live at Kelham Court. I spent today putting tools back rather than starting anything new.
My winter reading copy of The Peregrine is the 2017 NYRB edition with an introduction by Robert Macfarlane. My library card sleeve is purple Tyvek. I use an amber 30 minute sand timer for reading. My book stand is a 34 cm bamboo folding stand. My winter scarf is a handwoven grey herringbone from weaver Lena Shaw in Hebden Bridge. My mending basket is a 28 cm oval willow basket. I keep wool scraps in a cotton bag labelled Short lengths. My wool needle is a blunt size 16 tapestry needle. My reading glasses case is cork with a green lining.`,
  ],
] as const

const v3Chatter =
  'The kettle rattled, a spoon fell behind the counter and the washing took ages to dry. I swept up, reheated leftovers and listened to an unremarkable radio discussion. A brief reply is fine.'

export const rowanV3: Scenario = {
  id: 'rowan-v3',
  testedFactsThrough: '2025-12-29',
  testedPhrases: [
    'Silver Comet',
    'E.W.',
    'Lorna',
    'Inez',
    'fenugreek',
    'Beech Terrace',
    'Foss Lane',
    'Rivelin',
    'Kelham',
    'Northbank',
    'Lantern Museum',
    'Westfold',
    'peppermint',
    'rooibos',
    'Assam',
    'barley',
    'Wren Street',
    'Bell Street',
    'Saffron',
    'Tidal Rooms',
    'Paper Moon',
    'Canal Voices',
    'Folded Atlas',
    'Night Orchard',
    'Reed Shelter',
    'Seed Ledger',
    'Lachenal',
    'Fenwick',
    'Moor Timber',
    'Ash Cases',
    'Larch Audio',
    'Rowanwood',
    'Quarry Paper',
    'Hare Lamp',
    'Willow Room',
    'Finch Hardware',
    'Otter Handling',
    'Sedge Board',
    'Wren Power',
    'Tarn Seal',
    'Petra',
  ],
  // Empty dates still advance upkeep. Ten substantial, fact-free sessions at
  // the end exceed the working budget without introducing more tested facts.
  days: Array.from({ length: 400 }, (_, day) => {
    const date = new Date(Date.UTC(2025, 0, 6 + day)).toISOString().slice(0, 10)
    const session = v3Sessions.find(([at]) => at === date)
    const filler = [360, 364, 368, 372, 376, 380, 384, 388, 392, 396].includes(
      day,
    )
    return {
      date,
      ...(session
        ? { text: `${session[1]}\n${v3Chatter}` }
        : filler
          ? {
              text: `A quiet diary entry for ${date}. ${chatter} ${v3Chatter} ${v3Chatter}`,
            }
          : {}),
    }
  }),
  questions: [
    {
      id: 'v3-pip-coat',
      category: 'old-facts',
      text: 'What size waterproof coat does Pip wear, and who makes it?',
      required: ['66 cm', 'Fell Houndwear'],
      optional: ['Pip is a retired greyhound'],
    },
    {
      id: 'v3-bracken-frame',
      category: 'old-facts',
      text: 'What is the frame size and tubing of Bracken, the bicycle Ellis restored?',
      required: ['54 cm Reynolds 531'],
      optional: ['Green steel bicycle', 'Thirtieth birthday in 2021'],
    },
    {
      id: 'v3-thimble',
      category: 'old-facts',
      text: "Which initials are engraved on Aunt Lorna's thimble, and when did she leave it to me?",
      required: ['E.W.', '2017'],
      optional: ['Silver thimble in the old sewing tin'],
    },
    {
      id: 'v3-watch-repair',
      category: 'old-facts',
      text: 'Who repaired my watch, at which shop, and what width and colour strap did she fit?',
      required: [
        'Inez Cole',
        'Second Hand Time',
        '19 mm oxblood leather strap',
      ],
      optional: ['Timex Marlin from 1967'],
    },
    {
      id: 'v3-soup-postcard',
      category: 'old-facts',
      text: 'Who sent the lentil-soup recipe postcard, what year is on it, and how much of its unusual spice is used for four portions?',
      required: ['Uncle Basil', '2008', 'ground fenugreek, half a teaspoon'],
      optional: ['Kept in the kitchen drawer'],
    },
    {
      id: 'v3-atlas-provenance',
      category: 'old-facts',
      text: 'Who gave me my railway timetable collection, in which year, and what is its catalogue prefix?',
      required: ['Grandad Felix in 2012', 'RH-MID'],
      optional: ['Midland route, 1932 to 1964'],
    },
    {
      id: 'v3-backup-location',
      category: 'old-facts',
      text: 'What model and capacity is my off-site backup drive, and where exactly does Ellis keep it?',
      required: [
        '4 TB Toshiba Canvio Basics',
        "upstairs study's locked oak cabinet",
      ],
      optional: ["At Ellis's house in Derby"],
    },
    {
      id: 'v3-concertina',
      category: 'old-facts',
      text: "What is Ellis's concertina model, key arrangement and serial number, and which bellows fold was split?",
      required: [
        '30-button Lachenal Anglo in C/G',
        '18462',
        'third bellows fold on the left',
      ],
      optional: ['Repaired and returned on 22 December 2025'],
    },
    {
      id: 'v3-york-recess',
      category: 'old-facts',
      text: 'How wide and deep was the kitchen recess in my York flat?',
      required: ['57 cm wide and 61 cm deep'],
      optional: ['Flat 2, 9 Foss Lane'],
    },
    {
      id: 'v3-canal-track',
      category: 'old-facts',
      text: 'What is the final track on Canal Voices called, and how long is it?',
      required: ['Low Gate at Dawn', '4 minutes 18 seconds'],
      optional: ['Six-track download'],
    },
    {
      id: 'v3-before-york',
      category: 'changed-facts',
      text: 'Before York, what was my home address and monthly rent?',
      required: ['18 Beech Terrace in Leeds', '£725'],
      optional: ['Moved to York on 3 February 2025'],
    },
    {
      id: 'v3-between-york-kelham',
      category: 'changed-facts',
      text: 'Which address did I live at between Foss Lane and Kelham Court, and what was the monthly rent there?',
      required: ['41 Rivelin Street', '£910'],
      optional: ['Sheffield', 'Moved there 2 June 2025'],
    },
    {
      id: 'v3-before-lantern',
      category: 'changed-facts',
      text: 'What was my job title and employer before I joined Lantern Museum, and which instrument did I use for glaze samples?',
      required: [
        'lab technician at Northbank Ceramics',
        'Orton ST-1 dilatometer',
      ],
      optional: ['Left on 10 February 2025'],
    },
    {
      id: 'v3-first-archive-role',
      category: 'changed-facts',
      text: 'What was my first title at Westfold Archive, before collections environment coordinator, and who was my manager?',
      required: ['preventive conservation assistant', 'Ada Finch'],
      optional: ['Started 16 June 2025', 'Promoted 6 October 2025'],
    },
    {
      id: 'v3-drink-chain',
      category: 'changed-facts',
      text: 'What were the three morning drinks between coffee and roasted barley tea, in order?',
      required: ['peppermint tea', 'rooibos', 'decaffeinated Assam'],
      optional: ['24 February, 12 May and 4 August 2025 respectively'],
    },
    {
      id: 'v3-coffee-equipment',
      category: 'changed-facts',
      text: 'Before peppermint tea, how did I make my usual morning coffee? Give the pot material and capacity.',
      required: ['copper three-cup moka pot'],
      optional: ['Coffee was replaced on 24 February 2025'],
    },
    {
      id: 'v3-library-chain',
      category: 'changed-facts',
      text: 'Before Bell Street Library, what were my two standing Wren Street Library shifts, in chronological order?',
      required: ['Saturday 10 am to noon', 'Wednesday 5 pm to 7 pm'],
      optional: ['Changed 14 April 2025', 'Bell Street began 21 July 2025'],
    },
    {
      id: 'v3-commute-chain',
      category: 'changed-facts',
      text: 'Before the Rivelin path cycle ride, what were my museum and initial archive commutes? Include the bus number and walking time.',
      required: ['number 14 bus', '22 minute walk'],
      optional: ['Cycle commute began 15 September 2025'],
    },
    {
      id: 'v3-saffron-status',
      category: 'changed-facts',
      text: 'How did my relationship with Saffron change in April 2025, and what did we keep sharing?',
      required: [
        'ended our romantic relationship on 21 April 2025',
        'remain friends',
        'share our allotment',
      ],
      optional: ['Plot 26B at Willow Bank', 'Separate homes throughout'],
    },
    {
      id: 'v3-folded-status',
      category: 'changed-facts',
      text: 'What happened to Folded Atlas after the trial at Cinder Hall? Why did its status change, and what happened to the prototype?',
      required: [
        'cancelled Folded Atlas as a product',
        'concertina door kept swelling',
        'keeping the prototype for my own maps',
      ],
      optional: ['22 September 2025', 'No customer bought it'],
    },
    {
      id: 'v3-garden-fit',
      category: 'multi-session',
      text: "Which garden quote fits June's bed-height limit, gate-width requirement and budget? Explain why each other quote fails.",
      required: [
        'Fenwick Gardens',
        '£1,850',
        '58 cm beds',
        '88 cm clear gate',
        'Moss & Clay',
        '72 cm beds',
        'Alder Yard',
        '£2,180',
      ],
      optional: [
        '60 cm',
        '84 cm',
        '£2,000',
        'All quotes include installation',
        'No installer chosen',
      ],
    },
    {
      id: 'v3-roof-fit',
      category: 'multi-session',
      text: 'Which quoted roof panel can Noor lift within the limit we set for Reed Shelter, and what does it cost? Why does the other one fail?',
      required: ['Moor Timber', '7.4 kg', '£96', 'Canal Boards', '8.6 kg'],
      optional: ['8 kg', 'Larch versus cedar'],
    },
    {
      id: 'v3-theatre-case',
      category: 'multi-session',
      text: "Which carrying case satisfies Paper Moon's width requirement and my budget, and why do the other two fail?",
      required: [
        'Ash Cases',
        '84 cm',
        '£74',
        'Bell Trunks',
        '79 cm',
        'Crateworks',
        '£112',
      ],
      optional: ['82 cm', '£90', 'Fixed internal widths'],
    },
    {
      id: 'v3-audio-case',
      category: 'multi-session',
      text: 'Which quoted headphone case fits the Canal Voices drawer and my spending limit? Explain the two rejected options.',
      required: [
        'Larch Audio',
        '20 cm',
        '£38',
        'Beacon Sound',
        '23 cm',
        'Quiet Kit',
        '£61',
      ],
      optional: ['21 cm', '£45', 'Exterior case widths'],
    },
    {
      id: 'v3-drive-shelf',
      category: 'multi-session',
      text: 'Which archive-drive shelf meets both my depth and load requirements, and why do the other two fail?',
      required: [
        'Rowanwood',
        '25 cm',
        '20 kg',
        'Flint Joinery',
        '30 cm',
        'Alder Shelving',
        '15 kg',
      ],
      optional: ['27 cm', '18 kg', '£68', 'No order placed'],
    },
    {
      id: 'v3-archive-paper',
      category: 'multi-session',
      text: 'Which paper supplier meets my archive-paper specification and delivered-price budget? Explain why the other suppliers fail.',
      required: [
        'Quarry Paper',
        'acid-free A3',
        '25 sheets',
        '£22',
        'Fern Mill',
        'A4',
        'Bracken Press',
        '£27',
      ],
      optional: ['£24', 'No paper ordered'],
    },
    {
      id: 'v3-field-light',
      category: 'multi-session',
      text: 'Which field light meets my runtime and budget requirements? Explain why the other two fail.',
      required: [
        'Hare Lamp',
        'seven hours',
        '£46',
        'Plover Light',
        'four hours',
        'Stoat Beam',
        '£65',
      ],
      optional: ['six hours', '£50', 'No purchase made'],
    },
    {
      id: 'v3-listening-venue',
      category: 'multi-session',
      text: 'Which listening-event venue meets my access, capacity and hire-budget needs? Explain why the others fail.',
      required: [
        'Willow Room',
        'step-free',
        'capacity 30',
        '£110',
        'Copper Loft',
        'stairs only',
        'Mill Studio',
        '£145',
      ],
      optional: ['28 people', '£120', 'No venue booked'],
    },
    {
      id: 'v3-cabinet-hinge',
      category: 'multi-session',
      text: 'Which Folded Atlas hinge set met my load, rebate and price constraints, and why did the alternatives fail?',
      required: [
        'Finch Hardware',
        '14 kg',
        '15 mm',
        '£32',
        'Kite Fittings',
        '10 kg',
        'Heron Ironwork',
        '18 mm',
      ],
      optional: ['12 kg', '16 mm', '£35', 'Hinges were not ordered'],
    },
    {
      id: 'v3-lamp-driver',
      category: 'multi-session',
      text: 'Which Night Orchard driver matches my voltage, capacity and budget? Explain why the other two fail.',
      required: [
        'Wren Power',
        '12 V DC',
        '30 W',
        '£28',
        'Swift Electrics',
        '24 V DC',
        'Martin Supplies',
        '18 W',
      ],
      optional: ['24 W', '£30', 'No driver bought as of the quotes'],
    },
    {
      id: 'v3-march-week',
      category: 'time',
      text: 'What was I working on in the week of 3 to 9 March 2025? Give the project, the kiln date and the exhibition date.',
      required: ['Tidal Rooms', '4 March 2025', '9 March 2025'],
      optional: ['Glazed tiles', 'Borrowed Water display label'],
    },
    {
      id: 'v3-following-week',
      category: 'time',
      text: 'What occupied me in the week immediately after the Riverside makers exhibition, and which atlas did I start with?',
      required: [
        "repairing the library's flood-damaged atlases",
        '1968 Bartholomew world atlas',
        '10 to 16 March 2025',
      ],
      optional: ['Tidal Rooms had gone into storage'],
    },
    {
      id: 'v3-autumn',
      category: 'time',
      text: 'What were my main making projects in September and October 2025, and what caused the transition between them?',
      required: [
        'Folded Atlas',
        'cancelled Folded Atlas as a product',
        'concertina door kept swelling',
        '22 September 2025',
        'Night Orchard',
      ],
      optional: ['Cabinet trial at Cinder Hall', 'Seed-pod sculptures'],
    },
    {
      id: 'v3-september-week',
      category: 'time',
      text: 'What happened in the week of 8 to 14 September 2025? Include both the cabinet trial and the library work.',
      required: [
        "tested Folded Atlas's drawer stops",
        'Cinder Hall',
        'concertina door jammed',
        "patched the library's railway timetables",
      ],
      optional: ['Humid side room'],
    },
    {
      id: 'v3-hide-pause',
      category: 'time',
      text: 'When did Reed Shelter pause and restart in 2025, and what changed to let it restart?',
      required: [
        '7 April 2025',
        '20 October 2025',
        'landowner gave permission',
      ],
      optional: ['North edge of Mere Fen'],
    },
    {
      id: 'v3-job-move-order',
      category: 'time',
      text: 'Did I move to Sheffield before or after starting at Westfold Archive? Give both dates and my first archive title.',
      required: [
        '2 June 2025',
        '16 June 2025',
        'preventive conservation assistant',
      ],
      optional: ['Move came first'],
    },
    {
      id: 'v3-canal-phases',
      category: 'time',
      text: 'Give the 2025 dates when Canal Voices started, moved to editing and was released, in order.',
      required: ['5 May 2025', '7 July 2025', '28 July 2025'],
      optional: ['Dawn recordings', 'Six-track download'],
    },
    {
      id: 'v3-theatre-window',
      category: 'time',
      text: 'When did Paper Moon become my current project, when was its first public performance, and when did I put it in storage?',
      required: ['7 April 2025', '26 April 2025', '28 April 2025'],
      optional: ['Cinder Hall', 'Audience of 34'],
    },
    {
      id: 'v3-two-december-weeks',
      category: 'time',
      text: 'How did my work in the week of 1 to 7 December 2025 differ from the week of 15 to 21 December 2025?',
      required: [
        'tested Night Orchard outdoors in drizzle',
        'replaced a cracked diffuser on pod seven',
        "repairing a split bellows on Ellis's concertina",
        'cataloguing winter photographs',
      ],
      optional: ['Lantern event was between these weeks, on 13 December'],
    },
    {
      id: 'v3-move-promotion-order',
      category: 'time',
      text: 'Put these 2025 events in order with dates: becoming collections environment coordinator, restarting Reed Shelter, and moving to Kelham Court.',
      required: ['6 October 2025', '20 October 2025', '3 November 2025'],
      optional: ['Promotion, hide restart, then move'],
    },
    {
      id: 'v3-unknown-installer',
      category: 'unknown',
      text: "Who did I book to install June's garden, and what start date did we agree?",
      required: [
        'No installer has been chosen',
        'No installation start date has been agreed',
        'Fenwick Gardens remains a quote, not a booking',
      ],
      optional: ['Fenwick fits the stated limits'],
    },
    {
      id: 'v3-unknown-supervisor',
      category: 'unknown',
      text: 'What was the name of the supervisor of my Saturday shift at Wren Street Library?',
      required: [
        'Says no supervisor was ever mentioned',
        'Saturday 10 am to noon',
        'Wren Street Library',
      ],
      optional: ['I repaired book covers'],
    },
    {
      id: 'v3-unknown-salary',
      category: 'unknown',
      text: 'What annual salary did I agree for the collections environment coordinator role?',
      required: [
        'Says no salary was ever mentioned',
        'collections environment coordinator',
        'Westfold Archive',
      ],
      optional: ['Ada Finch is the manager'],
    },
    {
      id: 'v3-unknown-partner',
      category: 'unknown',
      text: 'Who became my new romantic partner after Saffron?',
      required: [
        'Says no new partner was ever mentioned',
        'remain friends',
        'share our allotment',
      ],
      optional: [
        'Relationship ended on 21 April 2025',
        'Noor is a project collaborator',
      ],
    },
    {
      id: 'v3-unknown-customer',
      category: 'unknown',
      text: 'Who bought the Folded Atlas cabinet after its Cinder Hall trial?',
      required: [
        'No customer bought it',
        'keeping the prototype for my own maps',
      ],
      optional: ['Cancelled as a product because the door swelled'],
    },
    {
      id: 'v3-unknown-listening-booking',
      category: 'unknown',
      text: 'Which venue did I book for the Canal Voices listening event?',
      required: [
        'No venue has been booked',
        'Willow Room',
        'step-free',
        'capacity 30',
        '£110',
      ],
      optional: ['Suitable quote does not establish a booking'],
    },
    {
      id: 'v3-unknown-hide-date',
      category: 'unknown',
      text: 'On what agreed completion date will Reed Shelter be finished?',
      required: [
        'No completion date has been agreed',
        'Reed Shelter is unfinished',
      ],
      optional: ['Restarted with permission on 20 October 2025'],
    },
    {
      id: 'v3-unknown-rain-policy',
      category: 'unknown',
      text: 'What rain-cancellation threshold did Petra set for the Winter Lantern Walk?',
      required: [
        'Says no rain-cancellation threshold was ever mentioned',
        'Petra Singh',
        '13 December 2025',
      ],
      optional: ['The event went ahead and all nine pods worked'],
    },
    {
      id: 'v3-unknown-seed-timber',
      category: 'unknown',
      text: 'Which timber species did Mae and I choose for Seed Ledger?',
      required: [
        'No timber species has been chosen',
        'Seed Ledger',
        'only a proposal',
      ],
      optional: ['Mae Osei handles proposals', 'Cabinet must be freestanding'],
    },
    {
      id: 'v3-unknown-seed-grant',
      category: 'unknown',
      text: 'How much funding was awarded to Seed Ledger, and when is its installation booked?',
      required: [
        'no funding has been awarded',
        'no installation date has been agreed',
        'Seed Ledger',
      ],
      optional: ['Proposal reference BSL-SL-07', '104 cm wide recess is known'],
    },
  ],
}

/** Every scenario a saved result may name, so old results can be graded again. */
export const scenarios = [memoryScenario, rowanV3]
