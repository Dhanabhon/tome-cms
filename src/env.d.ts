/// <reference types="astro/client" />

import type { BetterAuthSession, BetterAuthUser } from './server/auth/session';
import type { SiteSettings } from './server/content/settings';
import type { PostLocale } from './types/cms';

declare global {
  namespace App {
    interface Locals {
      session: BetterAuthSession | null;
      user: BetterAuthUser | null;
      /** Set by the gate on a page it closed: which language to draw the maintenance page in. */
      maintenance?: { locale: PostLocale; settings: SiteSettings };
      /** Set by the gate when the signed-in owner is let through a closed site. */
      maintenanceOwner?: boolean;
    }
  }
}

export {};
