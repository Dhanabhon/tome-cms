# A Plugin Is Something the Core Asked For

Date: 2026-09-20
Status: Awaiting owner review
Decided with the owner in conversation on 2026-09-20.

## Context

TomeCMS has no plugin concept. The owner wants one, and wants the first plugin to be
Cloudflare Turnstile on the admin sign-in page.

The sign-in it would sit in front of is a passkey ceremony, already rate limited at ten
attempts per fifteen minutes per address, keyed by an HMAC of the caller's IP. Turnstile is
not being added because that is failing. It is being added because the admin path is
reachable by anyone who finds it, and a bot that cannot answer a challenge never reaches the
ceremony at all.

It is also, on the evidence of the last day, the most dangerous thing we could put there.
Between 2026-09-19 and 2026-09-20 the owner was locked out of this installation three times
over, by a stale credential, by a refusal that named the wrong cause, and by the record of a
passkey refusing to let its own replacement be made. A widget that stands between the owner
and their site, depends on a third party being reachable, and is configured by hand, is a
fourth way to do the same thing. That risk shapes the design below more than anything else.

## Product Decisions

Settled with the owner, one question at a time:

- **A plugin may only do what the core asked for.** The core declares hook points; a plugin
  implements the ones it needs, in types the build checks. No routes, no database, no
  reaching into `src/server`.
- **Plugins live in the repository** and are switched on in the admin. Installing one at
  runtime is a later question; nothing here is shaped to prevent it.
- **Settings are stored in the database** and edited in the admin, because "the owner can
  choose to install a plugin" is not true of something that needs a `.env` file and a
  restart. A secret-typed setting is encrypted with `TOME_CMS_CONTEXT_SECRET` and is never
  sent back to the browser.
- **A failure to verify is not a failure to be a human.** A token Cloudflare rejects is a
  refusal. A Cloudflare that cannot be reached is not, and the attempt proceeds -- the rate
  limiter is still there, and it does not depend on anyone else being up.

Out of scope: installing or uploading a plugin at runtime, plugins on the public site,
plugin-supplied routes or admin screens, and any second plugin.

## The Design

### The contract

```
src/plugins/
├── contract.ts      the hooks the core declares, and the shape of a plugin
├── manifests.ts     id, name, description, settings schema -- no implementation
├── registry.ts      id -> () => import(...), and the enabled one
└── turnstile/
    ├── plugin.ts    the manifest
    ├── index.ts     the hooks
    └── verify.ts    the call to Cloudflare, and what its answers mean
```

Two hooks, which are the two things Turnstile needs and the two things any challenge widget
needs:

```ts
/** What to put in the sign-in form. Data, not markup: a plugin describes, the form renders. */
export interface SignInWidget {
  /** Rendered as <div class=…> with each dataset entry as a data-* attribute. */
  container: { className: string; dataset: Record<string, string> };
  /** Loaded once, async, before the widget is expected to appear. */
  script: string;
  /** The form field the widget writes its answer into. */
  tokenField: string;
}

export interface SignInVerdict {
  /** 'passed' lets the attempt through; 'refused' stops it; 'unavailable' also lets it
   *  through, and says so in the log, because the third party is not the gate. */
  outcome: 'passed' | 'refused' | 'unavailable';
}

export interface Plugin {
  signInWidget(settings: PluginSettings): SignInWidget | null;
  verifySignIn(input: { remoteIp: string | null; settings: PluginSettings; token: string | null }): Promise<SignInVerdict>;
}
```

A plugin returns a verdict; the **core decides what a verdict means**. That is deliberate:
"unavailable lets the attempt through" is a policy about this product's tolerance for being
locked out, and it should not be restated, or quietly disagreed with, by each plugin.

### Rendering the widget

The sign-in page resolves the enabled plugin on the server and passes the descriptor to
`PasskeySignIn` as ordinary props. The island renders the container and loads the script;
Turnstile writes its token into a hidden input inside the form it is in, and the submit
handler reads it from its own `FormData`. Nothing imports a plugin into the island, so no
plugin's code reaches a browser that is not using it -- the same rule the themes ended up at,
for the same reason.

### Storage

```sql
create table plugin_settings (
  id          text primary key,           -- the plugin's own id
  owner_id    uuid not null references "user"(id) on delete cascade,
  enabled     boolean not null default false,
  settings    jsonb not null default '{}',
  updated_at  timestamptz not null default now()
);
```

A settings schema per plugin drives a generic admin form:

```ts
settings: [
  { key: 'siteKey', kind: 'text', label: { en: 'Site key', th: 'Site key' }, required: true },
  { key: 'secretKey', kind: 'secret', label: { en: 'Secret key', th: 'Secret key' }, required: true },
]
```

A `secret` is encrypted at rest with AES-256-GCM under `TOME_CMS_CONTEXT_SECRET`, and the
admin is told only whether one is set. Replacing it is a write; reading it back is not
something the browser can do.

### Where the guard runs, and where it does not

The guard runs on `POST /api/auth/passkey/verify-authentication`, beside the rate limiter
that is already there, and **nowhere else**. Registration is untouched, which means the
recovery flow -- `npm run recovery:issue`, then a replacement passkey -- stays open with the
plugin on, misconfigured, or both. The escape hatch from a lock-out is the one that already
exists, and this design's job is to not close it.

`npm run plugin:disable <id>` turns a plugin off from a shell, for the case where the owner
is already outside and the admin is what they cannot reach.

## Rollout

Three layers, each shipped on its own:

1. **The contract, the table, and the admin screen.** Turnstile present, switched off,
   configurable. Nothing yet reads it at sign-in.
2. **The widget.** It appears on the sign-in form when the plugin is on and configured, and
   is not yet consulted.
3. **The guard, and the policy.** The attempt is verified; a refusal stops it; an unavailable
   Cloudflare does not. Plus `plugin:disable`.

Ordering the guard last is the point: at every step before it, the worst outcome is a widget
that does nothing.

## Verification

- `npm run check` and `npm run test:unit` at every layer.
- **Look at the built pages, not the build.** The theme work shipped a bug where every
  theme's stylesheet landed in one admin bundle and none on the public pages, because the
  checks read the whole build at once. For each layer: no plugin code in a bundle for a page
  that does not use it.
- Layer 3 is exercised against Cloudflare's own test keys, which have documented always-pass
  and always-fail values, and against a Cloudflare made unreachable, which must sign in.

## Risks

- **A challenge in front of the only way in.** Mitigated by the recovery path being out of
  scope for the guard, by unavailability being permissive, and by a shell command that turns
  it off. Not eliminated: an owner who enables it with a wrong secret key and no recovery
  codes still has to reach a terminal.
- **A secret in the database.** Encrypted at rest under a key that is already required to
  boot, which moves the problem rather than solving it: someone with the database and the
  environment has both. It is worth doing anyway, because database backups travel further
  than environments do.
- **Two hooks is a guess about what plugins need.** It is the smallest set that makes
  Turnstile work, chosen over a larger one because the second plugin is what will show which
  of them was wrong.
