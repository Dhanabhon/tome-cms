# Contributing to TomeCMS

Thank you for looking. TomeCMS is maintained by one person, so a small, focused change with
its tests is the easiest kind to accept.

Until 1.0.0 is released, TomeCMS is in a feature freeze: only fixes are merged. Ideas for
features are still welcome as issues, and they will be looked at after 1.0.0.

## Before you start

- For anything bigger than a small fix, open an issue first and say what you want to change
  and why. That saves you writing code that goes a different way from the plan.
- Found a vulnerability? Do not open an issue; see [SECURITY.md](SECURITY.md).
- Designs and implementation plans live in [`docs/specs`](docs/specs) and
  [`docs/plans`](docs/plans). They explain why things are the way they are.

## Setting up

Follow [Developing TomeCMS](README.md#developing-tomecms) in the README. It covers local setup
on macOS and on Windows, the project layout, writing a theme and writing a plugin.

## How the code is kept

- **Two languages.** The admin's words live in `src/lib/admin-i18n.ts` and the public site's
  in `src/lib/i18n.ts`. Every string is written in both English and Thai. In the admin's file
  the Thai copy is typed as the English one, so a missing key fails the type check.
- **One set of design tokens.** Colours, spacing, radii and type come from
  `src/styles/installer-tokens.css` only. `DESIGN.md` describes them, and `npm run check`
  fails when the two drift apart.
- **Plugins describe; the core draws.** A plugin returns data, and nothing a plugin returns
  is written into a page as markup. See [Writing a plugin](README.md#writing-a-plugin).
- **Migrations are append-only.** A schema change is a new numbered file in
  `src/server/db/migrations`, registered in `src/server/db/migrator.ts` and in
  `src/server/db/reset-tables.ts`. A migration that has shipped is never edited.
- **Follow what is there.** Match the naming, comments and structure of the code around your
  change, and do not reformat code you are not changing.

## Tests

Write the test first and watch it fail, then make it pass. A fix comes with the test that
would have caught the bug.

```sh
npm run check        # astro check, the design-token check and the scripts' self-tests
npm run test:unit
node scripts/test-foundation.mjs tests/integration/<file>.test.ts
npm run test:e2e -- tests/e2e/<file>.spec.ts
```

Integration and end-to-end tests stand up their own disposable PostgreSQL and SeaweedFS under
Docker Compose, and remove them afterwards. Browser tests run on both Playwright projects,
desktop and phone. [Tests and checks](README.md#tests-and-checks) in the README has the
details.

## Commits and pull requests

- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/):
  `type(scope): what changed`, with `feat`, `fix`, `refactor`, `docs`, `test`, `chore`,
  `perf` or `ci`. The body says why.
- Keep one concern per pull request, and fill in the template. It asks what you changed, why,
  and what you ran.
- For a change people can see, add screenshots in the light and dark themes, and at a phone
  width.
- Never commit credentials, `.env` files, database dumps or backups.

## License

TomeCMS is released under the [MIT License](LICENSE). By contributing, you agree that your
contribution is released under it too.
