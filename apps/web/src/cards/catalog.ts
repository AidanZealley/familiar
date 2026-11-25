// The blocks Familiars make cards from, and what a shown card keeps. The
// daemon imports this file to offer show_card, so it must stay React-free:
// only `gencn` imports, no `@/` aliases.
import {
  Badge,
  Button,
  Card,
  Grid,
  Heading,
  Image,
  Select,
  Separator,
  Slider,
  Stack,
  Stat,
  Switch,
  Text,
  createCatalog,
  type Spec,
} from 'gencn'

/** Every block the web app has installed; `blocks.ts` pairs each with its view. */
export const catalog = createCatalog([
  Card,
  Stack,
  Grid,
  Separator,
  Heading,
  Text,
  Image,
  Stat,
  Badge,
  Switch,
  Slider,
  Select,
  Button,
])

/** The tool a Familiar shows a card with. */
export const SHOW_CARD = 'show_card'

/** A shown card's details: its spec as checked, which the web app draws. */
export type CardDetails = { spec: Spec }
