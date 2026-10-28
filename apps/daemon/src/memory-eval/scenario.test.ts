import { expect, test } from 'vitest'
import { categories, memoryScenario, rowanV3 } from './scenario.ts'

const textDays = rowanV3.days.filter((day) => day.text)
const groundTruth = textDays.map((day) => day.text).join('\n')
const normalise = (text: string) => text.toLowerCase().replace(/\s+/g, ' ')

test('v3 preserves v2 and has ten uniquely identified questions per category', () => {
  expect(memoryScenario.id).toBe('rowan-90-days-v2')
  expect(rowanV3.id).toBe('rowan-v3')
  expect(rowanV3.questions).toHaveLength(50)
  expect(new Set(rowanV3.questions.map((question) => question.id)).size).toBe(
    50,
  )
  for (const category of categories) {
    expect(
      rowanV3.questions.filter((question) => question.category === category),
    ).toHaveLength(10)
  }
})

test('v3 spans a year with consecutive dates and an affordable text budget', () => {
  expect(rowanV3.days.length).toBeGreaterThanOrEqual(365)
  expect(textDays.length).toBeGreaterThanOrEqual(50)
  expect(textDays.length).toBeLessThanOrEqual(70)
  expect(
    textDays.reduce((total, day) => total + day.text!.length, 0),
  ).toBeLessThan(60_000)
  for (const [index, day] of rowanV3.days.entries()) {
    const date = Date.parse(`${day.date}T00:00:00Z`)
    expect(new Date(date).toISOString().slice(0, 10)).toBe(day.date)
    if (index > 0) {
      expect(
        date - Date.parse(`${rowanV3.days[index - 1].date}T00:00:00Z`),
      ).toBe(86_400_000)
    }
  }
})

test('v3 has distinct durable detail well beyond the fact cap', () => {
  // The second paragraph records lasting specifications and preferences. Count
  // it without the plot, repeated chatter, or the closing request for brevity.
  const details = textDays
    .filter((day) => day.date <= rowanV3.testedFactsThrough!)
    .map((day) => day.text!.split('\n')[1])
  expect(details).toHaveLength(52)
  expect(new Set(details).size).toBe(details.length)
  expect(details.join('\n').length).toBeGreaterThan(18_000)
})

test('v3 leaves substantial fact-free chatter after the last tested day', () => {
  const cutoff = rowanV3.days.find(
    (day) => day.date === rowanV3.testedFactsThrough,
  )
  expect(cutoff?.text).toBeTruthy()
  const tail = textDays.filter((day) => day.date > rowanV3.testedFactsThrough!)
  expect(tail).toHaveLength(10)
  expect(tail.map((day) => day.text).join('\n').length).toBeGreaterThan(10_000)
  expect(rowanV3.testedPhrases!.length).toBeGreaterThan(30)
  for (const phrase of rowanV3.testedPhrases!) {
    expect(normalise(groundTruth), phrase).toContain(normalise(phrase))
    for (const day of tail) {
      expect(normalise(day.text!), `${day.date}: ${phrase}`).not.toContain(
        normalise(phrase),
      )
    }
  }
})

test.each(rowanV3.questions)(
  '$id has explicit evidence for every required item',
  (question) => {
    expect(question.required.length).toBeGreaterThan(0)
    const testedText = normalise(
      textDays
        .filter((day) => day.date <= rowanV3.testedFactsThrough!)
        .map((day) => day.text)
        .join('\n'),
    )
    // Required items are short verbatim phrases from the prose, so this checks
    // their grounding directly without adding evidence fields to shared types.
    // A "Says …" item describes the answer, for things Rowan never mentioned,
    // so it has no evidence to find.
    for (const required of question.required) {
      expect(required.trim()).not.toBe('')
      if (required.startsWith('Says ')) {
        expect(question.category, question.id).toBe('unknown')
        continue
      }
      expect(testedText, `${question.id}: ${required}`).toContain(
        normalise(required),
      )
    }
  },
)

test('v3 asks about some things Rowan never mentioned at all', () => {
  // Explicit "not agreed yet" facts test remembering a negative; these test
  // saying "I don't know" when nothing was ever said.
  const neverSaid = rowanV3.questions.filter((question) =>
    question.required.some((required) => required.startsWith('Says ')),
  )
  expect(neverSaid.length).toBeGreaterThanOrEqual(4)
  for (const term of ['supervisor', 'salary', 'rain-cancellation']) {
    expect(normalise(groundTruth), term).not.toContain(term)
  }
})
