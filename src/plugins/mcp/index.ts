import type { Plugin, SignInVerdict, SignInWidget } from '../contract';

export { manifest } from './plugin';

/** Nothing to add to the sign-in: the core serves MCP, and this plugin is only its switch. */
export function signInWidget(): SignInWidget | null {
  return null;
}

export async function verifySignIn(): Promise<SignInVerdict> {
  return { outcome: 'passed', detail: 'MCP does not guard the sign-in' };
}

const plugin: Plugin = { signInWidget, verifySignIn };
export default plugin;
