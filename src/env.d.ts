/// <reference types="astro/client" />

import type { BetterAuthSession, BetterAuthUser } from './server/auth/session';

declare global {
  namespace App {
    interface Locals {
      session: BetterAuthSession | null;
      user: BetterAuthUser | null;
    }
  }
}

export {};
