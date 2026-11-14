import type { MutableModels } from '@earendil-works/pi-ai/models'
import { isAbstention, type Question } from './longmem-data.ts'

/**
 * LongMemEval's judge: the prompts it grades a model's answer with, one for
 * each kind of question, and how it reads the verdict.
 *
 * The prompts are copied from `get_anscheck_prompt` in
 * https://github.com/xiaowu0162/LongMemEval/blob/main/src/evaluation/evaluate_qa.py
 * (MIT License, Copyright (c) 2024 Di Wu), word for word. Its `{}` marks are
 * filled in order: the question, the correct answer or rubric or explanation,
 * then the model's response.
 */

const ANSWER =
  'I will give you a question, a correct answer, and a response from a model. Please answer yes if the response contains the correct answer. Otherwise, answer no. If the response is equivalent to the correct answer or contains all the intermediate steps to get the correct answer, you should also answer yes. If the response only contains a subset of the information required by the answer, answer no. \n\nQuestion: {}\n\nCorrect Answer: {}\n\nModel Response: {}\n\nIs the model response correct? Answer yes or no only.'

const TEMPORAL =
  "I will give you a question, a correct answer, and a response from a model. Please answer yes if the response contains the correct answer. Otherwise, answer no. If the response is equivalent to the correct answer or contains all the intermediate steps to get the correct answer, you should also answer yes. If the response only contains a subset of the information required by the answer, answer no. In addition, do not penalize off-by-one errors for the number of days. If the question asks for the number of days/weeks/months, etc., and the model makes off-by-one errors (e.g., predicting 19 days when the answer is 18), the model's response is still correct. \n\nQuestion: {}\n\nCorrect Answer: {}\n\nModel Response: {}\n\nIs the model response correct? Answer yes or no only."

const UPDATE =
  'I will give you a question, a correct answer, and a response from a model. Please answer yes if the response contains the correct answer. Otherwise, answer no. If the response contains some previous information along with an updated answer, the response should be considered as correct as long as the updated answer is the required answer.\n\nQuestion: {}\n\nCorrect Answer: {}\n\nModel Response: {}\n\nIs the model response correct? Answer yes or no only.'

const PREFERENCE =
  "I will give you a question, a rubric for desired personalized response, and a response from a model. Please answer yes if the response satisfies the desired response. Otherwise, answer no. The model does not need to reflect all the points in the rubric. The response is correct as long as it recalls and utilizes the user's personal information correctly.\n\nQuestion: {}\n\nRubric: {}\n\nModel Response: {}\n\nIs the model response correct? Answer yes or no only."

const ABSTENTION =
  'I will give you an unanswerable question, an explanation, and a response from a model. Please answer yes if the model correctly identifies the question as unanswerable. The model could say that the information is incomplete, or some other information is given but the asked information is not.\n\nQuestion: {}\n\nExplanation: {}\n\nModel Response: {}\n\nDoes the model correctly identify the question as unanswerable? Answer yes or no only.'

/** The prompt that grades `response` to `question`, by the question's type. */
export function judgePrompt(
  {
    id,
    type,
    question,
    answer,
  }: Pick<Question, 'id' | 'type' | 'question' | 'answer'>,
  response: string,
) {
  // The release marks unanswerable questions by ID, whatever their type.
  const template = isAbstention(id)
    ? ABSTENTION
    : type === 'temporal-reasoning'
      ? TEMPORAL
      : type === 'knowledge-update'
        ? UPDATE
        : type === 'single-session-preference'
          ? PREFERENCE
          : ANSWER
  const fill = [question, answer, response]
  return template.replace(/\{\}/g, () => fill.shift()!)
}

/**
 * Whether the judge said yes. The original counts any "yes" in the reply;
 * this takes a leading yes or no first, so a reply that explains itself
 * ("No, the response never says yes to…") can't read the wrong way.
 */
export function readVerdict(reply: string) {
  const lead = /^\W*(yes|no)\b/i.exec(reply)
  return lead ? lead[1].toLowerCase() === 'yes' : /\byes\b/i.test(reply)
}

/** The judge's verdict on `response`, and what it said. Throws if the call failed. */
export async function judge(
  models: MutableModels,
  model: { provider: string; modelId: string },
  question: Pick<Question, 'id' | 'type' | 'question' | 'answer'>,
  response: string,
) {
  const resolved = models.getModel(model.provider, model.modelId)
  if (!resolved) {
    throw new Error('The judge model is not available.')
  }
  const message = await models.completeSimple(
    resolved,
    {
      messages: [
        {
          role: 'user',
          content: judgePrompt(question, response),
          timestamp: Date.now(),
        },
      ],
    },
    // A reasoning model spends part of its tokens thinking and takes no temperature.
    resolved.reasoning
      ? { maxTokens: 1024, reasoning: 'low' }
      : { maxTokens: 16, temperature: 0 },
  )
  if (message.stopReason === 'error' || message.stopReason === 'aborted') {
    throw new Error(
      `The judge failed: ${message.errorMessage ?? message.stopReason}.`,
    )
  }
  const said = message.content
    .flatMap((part) => (part.type === 'text' ? [part.text] : []))
    .join('')
    .trim()
  return { correct: readVerdict(said), said }
}
