import { z } from 'zod';

/*
 * Named api.ts and not client.ts on purpose: a plugin's client.ts is the module the public
 * site loads into readers' browsers (see ../clients.ts), and this one holds a key.
 */

const ENDPOINT = 'https://api.typesafe.ai/v1/systemone';
/** Long enough for a judgement, short enough that the drawer never looks stuck. */
const TIMEOUT_MS = 8_000;

/**
 * The statuses that mean "try again": the two the service documents, and 503, which it was
 * measured returning in bursts -- the same request failing, then answering eight times in a
 * row a minute later.
 */
const RETRYABLE = new Set([429, 503, 529]);
/** Backing off, as the service asks, rather than asking again at once. */
const BACKOFF_MS = [400, 1_200] as const;

/** One yes-or-no judgement, answered with a probability. */
export interface Noul {
  criteria?: { false: string; true: string };
  instructions: string;
}

const noulAnswers = z.object({
  answers: z.record(z.string(), z.object({ noul: z.number().min(0).max(1) }).loose()),
}).loose();

const choiceAnswer = z.object({
  answers: z.object({
    pick: z.object({ choice: z.string(), confidence: z.number().min(0).max(1) }).loose(),
  }).loose(),
}).loose();

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

/**
 * One request, or null when it could not be answered.
 *
 * Null covers a refusal, a timeout and a malformed answer alike, because to the caller they
 * are the same thing -- no judgement this time -- and none of them is a judgement that the
 * answer is no. The status is logged; the body never is: it comes from a service holding
 * the owner's key.
 */
async function request(key: string, state: unknown, questions: Record<string, unknown>): Promise<unknown | null> {
  if (!Object.keys(questions).length) return null;
  const deadline = AbortSignal.timeout(TIMEOUT_MS);
  try {
    const response = await withRetry(() => fetch(ENDPOINT, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ state, model: 'jev-latest', questions }),
      signal: deadline,
    }));
    if (!response.ok) {
      console.error(`TypeSafe refused the request with ${response.status}`);
      return null;
    }
    return await response.json();
  } catch {
    console.error('TypeSafe could not be reached');
    return null;
  }
}

/** Every yes-or-no question at once, answered in parallel; probabilities by question id. */
export async function ask(
  key: string,
  state: unknown,
  questions: Readonly<Record<string, Noul>>,
): Promise<Record<string, number> | null> {
  const payload = await request(key, state, Object.fromEntries(
    Object.entries(questions).map(([id, noul]) => [id, { type: 'noul', ...noul }]),
  ));
  if (payload === null) return null;
  const parsed = noulAnswers.safeParse(payload);
  if (!parsed.success) {
    console.error('TypeSafe answered in a shape its documentation does not describe');
    return null;
  }
  return Object.fromEntries(Object.entries(parsed.data.answers).map(([id, answer]) => [id, answer.noul]));
}

/**
 * One of a set of options. The options are the keys of `criteria` and the answer is one of
 * those keys as given -- which is what lets a caller offer the owner's own passages and get
 * one back unaltered.
 */
export async function choose(
  key: string,
  state: unknown,
  instructions: string,
  criteria: Readonly<Record<string, string | null>>,
): Promise<{ choice: string; confidence: number } | null> {
  const payload = await request(key, state, { pick: { type: 'choice', instructions, criteria } });
  if (payload === null) return null;
  const parsed = choiceAnswer.safeParse(payload);
  if (!parsed.success) {
    console.error('TypeSafe answered in a shape its documentation does not describe');
    return null;
  }
  return { choice: parsed.data.answers.pick.choice, confidence: parsed.data.answers.pick.confidence };
}
