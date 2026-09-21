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
 * Asks every question at once and hands back the probabilities by id.
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
  const key = getServerEnv().TYPESAFE_API_KEY;
  if (!key || !Object.keys(questions).length) return null;

  try {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        state,
        model: 'jev-latest',
        questions: Object.fromEntries(
          Object.entries(questions).map(([id, noul]) => [id, { type: 'noul', ...noul }]),
        ),
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      // The status, never the body: a refusal from a service holding our key is not
      // something to write into a log the owner reads.
      console.error(`Judgement request refused with ${response.status}`);
      return null;
    }
    const parsed = answersSchema.safeParse(await response.json());
    if (!parsed.success) {
      console.error('Judgement answers did not have the documented shape');
      return null;
    }
    return Object.fromEntries(
      Object.entries(parsed.data.answers).map(([id, answer]) => [id, answer.noul]),
    );
  } catch {
    console.error('Judgement request could not be completed');
    return null;
  }
}
