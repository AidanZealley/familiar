import type { JsonValue } from '@earendil-works/chord/json'
import type { JsonObject } from '@earendil-works/pi-durable'
import {
  argsProblem,
  defineTool,
  definePlugin,
  familiar,
  type ConnectionTool,
} from '@familiar-ai/core'
import {
  autoFix,
  checkRefresh,
  checkSpec,
  isExpression,
  refreshSchema,
  toolCalls,
  toolPrompt,
  type Spec,
} from 'gencn'
import { z } from 'zod'
// apps/web's own catalog (private workspace package), so the daemon offers
// exactly the blocks the web app can draw.
import { catalog, SHOW_CARD, type CardDetails } from '@familiar-ai/web/cards'

/** Blocks a person uses: each must do something, or it would mislead. */
const CONTROLS = ['Switch', 'Slider', 'Select', 'Button']

const description = `Show the person a small card in the conversation: a device's status, a few readings, a photo, or controls such as a light's switch and brightness. Use a card when seeing or changing a few things at once is easier than reading a reply.

Call show_card directly, never from a codemode script: only a direct call shows the card.

Controls run your MCP connection tools directly when the person uses them, without you: callTool's tool is the tool's full name, such as mcp__home__HassTurnOn (find tools with tool_search first). Bind each control's value to state with $bindState and pass it in args with $state. A refresh reads with a tool that only reads, such as one that gets the current state; it runs once now to check your extract against your state, and again whenever the card is on screen.

${toolPrompt(catalog)}`

// json-render's own schema has no `state`, `on`, `watch` or gencn's
// `refresh`: add them, so Pi's argument check lets them through.
const catalogSchema = catalog.jsonRender.jsonSchema() as {
  properties: {
    elements: { additionalProperties: { properties: object } }
  } & Record<string, object>
}
const element = catalogSchema.properties.elements.additionalProperties
const parameters = {
  ...catalogSchema,
  properties: {
    ...catalogSchema.properties,
    elements: {
      ...catalogSchema.properties.elements,
      additionalProperties: {
        ...element,
        properties: {
          ...element.properties,
          on: { type: 'object', description: 'Events bound to actions' },
          watch: {
            type: 'object',
            description: 'State paths bound to actions',
          },
        },
      },
    },
    state: { type: 'object', description: 'Data the card reads' },
    refresh: z.toJSONSchema(refreshSchema),
  },
}

/**
 * `args` with only its literal values, and `tool`'s parameters without
 * requiring the rest: expressions only have values when the event fires.
 */
function literalOnly(tool: ConnectionTool, args: JsonObject) {
  const dynamic = Object.keys(args).filter((key) => isExpression(args[key]))
  const schema = tool.parameters as { required?: string[] }
  return argsProblem(
    {
      name: tool.name,
      parameters: {
        ...schema,
        required: schema.required?.filter((key) => !dynamic.includes(key)),
      },
    },
    Object.fromEntries(
      Object.entries(args).filter(([key]) => !dynamic.includes(key)),
    ),
  )
}

/** What's wrong with `spec`'s controls and the tools they run, for the model. */
function toolProblems(spec: Spec, tools: readonly ConnectionTool[]) {
  const problems: string[] = []
  const byName = new Map(tools.map((tool) => [tool.name, tool]))
  for (const [key, el] of Object.entries(spec.elements)) {
    if (CONTROLS.includes(el.type) && !el.on) {
      problems.push(
        `- "${key}" (${el.type}) does nothing: bind its event to callTool.`,
      )
    }
  }
  for (const call of toolCalls(spec)) {
    const at = `"${call.element}" ${call.event}`
    for (const name of call.tools ?? []) {
      const tool = byName.get(name)
      if (!tool) {
        problems.push(
          `- ${at} runs ${name}, which isn't one of your MCP connection tools. Find them with tool_search.`,
        )
        continue
      }
      const args = call.args
      if (isExpression(args)) {
        continue
      }
      const problem =
        typeof args === 'object' && args !== null && !Array.isArray(args)
          ? literalOnly(tool, args as JsonObject)
          : 'args must be an object'
      if (problem) {
        problems.push(`- ${at} runs ${name} with wrong args: ${problem}`)
      }
    }
  }
  if (spec.refresh) {
    const tool = byName.get(spec.refresh.tool)
    if (!tool) {
      problems.push(
        `- refresh reads ${spec.refresh.tool}, which isn't one of your MCP connection tools.`,
      )
    } else if (tool.askBeforeRunning) {
      problems.push(
        `- refresh reads ${tool.name}, which the owner wants approved before each run, so it can't run without the person. Leave refresh out.`,
      )
    } else {
      const problem = argsProblem(tool, (spec.refresh.args ?? {}) as JsonObject)
      if (problem) {
        problems.push(
          `- refresh reads ${tool.name} with wrong args: ${problem}`,
        )
      }
    }
  }
  return problems.length
    ? ["The card's tools have errors:", ...problems].join('\n')
    : undefined
}

/** A nested call's output as the text a read hands back. */
const outputText = (output: JsonValue | undefined) =>
  typeof output === 'string'
    ? output
    : Array.isArray(output)
      ? output
          .flatMap((part) =>
            part && typeof part === 'object' && 'text' in part
              ? [String(part.text)]
              : [],
          )
          .join('\n')
      : JSON.stringify(output ?? '')

const showCard = defineTool({
  name: SHOW_CARD,
  description,
  parameters,
  replay: 'safe',
  // Only a direct call shows a card (the web app draws top-level show_card
  // calls), so codemode scripts aren't offered this tool.
  callers: ['model'],
  // A rejected spec goes back to the model with what to fix, so it can
  // call again in the same turn: the agent loop is the repair loop.
  execute: async (args, api, context) => {
    const fail = (text: string) => ({
      output: [{ type: 'text' as const, text }],
      isError: true,
    })
    // Pi has checked the arguments against `parameters`.
    const spec = autoFix(args as Spec)
    const problems =
      checkSpec(catalog, spec) ??
      toolProblems(spec, await familiar(context).connectionTools())
    if (problems) {
      return fail(problems)
    }
    if (spec.refresh) {
      const read = await api.executeTool(
        spec.refresh.tool,
        (spec.refresh.args ?? {}) as JsonObject,
        context,
        { key: 'refresh' },
      )
      if (read.isError) {
        const why = read.diagnostics.map((d) => d.message).join(' ')
        return fail(
          `The card's refresh read failed: ${outputText(read.structuredOutput) || why}`,
        )
      }
      const mismatch = checkRefresh(
        catalog,
        spec,
        outputText(read.structuredOutput),
      )
      if (mismatch) {
        return fail(mismatch)
      }
    }
    return {
      output: [{ type: 'text', text: 'The card is shown.' }],
      // A spec is JSON; its type just doesn't say so.
      details: { spec } satisfies CardDetails as unknown as JsonValue,
    }
  },
})

/**
 * Cards: `show_card`, on by default, toggled per Familiar. Turning it off
 * stops new cards only; shown ones keep working, since their controls run
 * through core's `tools.run` and `tools.read`, not this plugin.
 */
export const cardsPlugin = definePlugin({
  name: 'cards',
  title: 'Cards',
  tools: [showCard],
})
