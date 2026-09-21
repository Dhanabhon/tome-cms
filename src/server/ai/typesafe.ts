import { z } from 'zod';

import { getServerEnv } from '../env';

const ENDPOINT = 'https://api.typesafe.ai/v1/systemone';
/** Long enough for a judgement, short enough that the drawer never looks stuck. */
const TIMEOUT_MS = 8_000;

/**
 * One yes-or-no judgement, asked of a model that answers with a probability.
 *
 * `instructions` is the question. `criteria` says what a yes and a no look like, which is
 * worth writing whenever the question alone could be read two ways.
 */
export interface Noul {
  criteria?: { false: string; true: string };
  instructions: string;
}

const answersSchema = z.object({
  answers: z.record(z.string(), z.object({ noul: z.number().min(0).max(1) }).loose()),
}).loose();

/** Present only when the owner has given this installation a key. */
export function hasJudgement(): boolean {
  return Boolean(getServerEnv().TYPESAFE_API_KEY);
}

/**
 * The statuses that mean "try again": the two the service documents, and 503, which it was
 * measured returning in bursts -- the same request failing, then answering eight times in a
 * row a minute later.
 */
const RETRYABLE = new Set([429, 503, 529]);
/** Backing off, as the service asks, rather than asking again at once. */
const BACKOFF_MS = [400, 1_200] as const;

/**
 * Sends, and sends again after a pause while the answer is "try again".
 *
 * Every attempt shares the caller's one deadline, so a retry spends what is left of the
 * time the owner is already waiting rather than starting the wait over.
 */
export async function withRetry(
  send: () => Promise<Response>,
  pause: (milliseconds: number) => Promise<void> = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
): Promise<Response> {
  let response = await send();
  for (const delay of BACKOFF_MS) {
    if (!RETRYABLE.has(response.status)) return response;
    // A little jitter, so two drawers asking at once do not ask again at once.
    await pause(delay + Math.floor(Math.random() * 200));
    response = await send();
  }
  return response;
}

async function request(state: unknown, questions: Record<string, unknown>): Promise<unknown | null> {
  const key = getServerEnv().TYPESAFE_API_KEY;
  if (!key || !Object.keys(questions).length) return null;
  const deadline = AbortSignal.timeout(TIMEOUT_MS);
  try {
    const response = await withRetry(() => fetch(ENDPOINT, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ state, model: 'jev-latest', questions }),
      signal: deadline,
    }));
    if (!response.ok) {
      // The status, never the body: a refusal from a service holding our key is not
      // something to write into a log the owner reads.
      console.error(`Judgement request refused with ${response.status}`);
      return null;
    }
    return await response.json();
  } catch {
    console.error('Judgement request could not be completed');
    return null;
  }
}

/**
 * Asks every yes-or-no question at once and hands back the probabilities by id.
 *
 * Independent questions over the same state go in one request: they are answered in
 * parallel, so a second question costs tokens rather than time.
 *
 * Returns null rather than throwing when there is no key, when the service refuses, or
 * when it takes too long. Nothing here decides anything on its own -- these answers are
 * shown to the owner as suggestions, and a site whose suggestions are briefly unavailable
 * is a site that works.
 */
export async function ask(
  state: unknown,
  questions: Readonly<Record<string, Noul>>,
): Promise<Record<string, number> | null> {
  const payload = await request(state, Object.fromEntries(
    Object.entries(questions).map(([id, noul]) => [id, { type: 'noul', ...noul }]),
  ));
  if (payload === null) return null;
  const parsed = answersSchema.safeParse(payload);
  if (!parsed.success) {
    console.error('Judgement answers did not have the documented shape');
    return null;
  }
  return Object.fromEntries(Object.entries(parsed.data.answers).map(([id, answer]) => [id, answer.noul]));
}

const choiceSchema = z.object({
  answers: z.object({
    pick: z.object({ choice: z.string(), confidence: z.number().min(0).max(1) }).loose(),
  }).loose(),
}).loose();

/**
 * Picks one of a set of options, and says how settled the pick is.
 *
 * The options are the keys of `criteria`, and the answer is one of those keys, returned as
 * given -- which is what lets a caller offer passages of the owner's own text and get one
 * of them back unaltered.
 */
export async function choose(
  state: unknown,
  instructions: string,
  criteria: Readonly<Record<string, string | null>>,
): Promise<{ choice: string; confidence: number } | null> {
  const payload = await request(state, { pick: { type: 'choice', instructions, criteria } });
  if (payload === null) return null;
  const parsed = choiceSchema.safeParse(payload);
  if (!parsed.success) {
    console.error('Judgement answers did not have the documented shape');
    return null;
  }
  return { choice: parsed.data.answers.pick.choice, confidence: parsed.data.answers.pick.confidence };
}
