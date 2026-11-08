## Web App Code Standards (static, single-file)

Everything in the Node/TypeScript standards applies, plus the web rules below.

- **Node.js 24 LTS** — use modern ES2022+ features
- **TypeScript strict mode** — `noImplicitReturns` and `noUncheckedIndexedAccess` are on, so an unchecked `items[0]` or a missing return path fails `npm run typecheck`. No `any`.
- **Biome** for linting and formatting — `npx biome ci --error-on-warnings .` is the check that is clean before a push (Process P-11 § 5 (2))
- **Biome warnings fail CI** — Biome 2 reports several recommended rules (for example `useConst`, `noNonNullAssertion`, unused variables and imports) as warnings, so CI runs `biome ci --error-on-warnings`. `noExplicitAny` is set to error in `biome.json`, so `any` fails even without the flag.
- **Global types are listed** — TypeScript 6 no longer loads every installed `@types` package, so `tsconfig.json` lists them in `types` (`jest` by default). Add any you install, e.g. `node` after `npm install -D @types/node`.
- **Jest + ts-jest** for unit tests — the line coverage gate of Process P-11 § 5 (2), enforced in CI
- **Playwright** for browser tests — they run against the built file, not the dev server
- **Test first** — write the failing test (`src/*.test.ts`, or a browser test in `e2e/`) and run it red before the code; `build` fails a pull request that changes `src/` or `index.html` without changing a test (§ 30 of the Rules, `rules/RULES.md`).
- **No hardcoded values**: Process P-11 § 5 (2).
- **Error handling** — always type-narrow errors; never `catch (e: any)`
- **Imports** — relative imports within the project; no barrel files unless justified

### Web rules

- **One self-contained file.** `npm run build` produces `dist/index.html` with all script and style inlined. No CDN scripts, web fonts, images or other external requests. The browser test fails if the page requests anything besides its own document.
- **Logic in pure modules, wiring in `src/main.ts`.** Calculations and other logic live in `src/*.ts` modules that do not touch the DOM; test them with Jest. `src/main.ts` only wires that logic to the page. It is excluded from the coverage gate and is covered by the Playwright tests.
- **Phone first.** Design for 375px width first. The page must not scroll sideways at 375px or at 1280px.
- **Light and dark.** Support `prefers-color-scheme`. Every browser test runs in both.
- **Clean console.** Any console error or uncaught error fails the browser tests.
- **Inline favicon.** `index.html` declares `<link rel="icon" href="data:," />` so real browsers do not request `/favicon.ico`, which the site has no file for and would answer with a 404. The browser tests cannot catch a missing line: headless Chromium does not request a favicon, so keep it in place by convention.
- **File names.** Unit tests are `src/*.test.ts`. Browser tests are `e2e/*.e2e.ts`. Jest ignores `e2e/`, Playwright only runs `*.e2e.ts`.

### Project layout

Root files come straight from the pack (`package.json`, `tsconfig.json`, `biome.json`, `vite.config.mts`, `playwright.config.ts`, `index.html`). The pack's `starter/` folder mirrors the project: copy `starter/src/` to `src/` and `starter/e2e/` to `e2e/`. The starter example (`src/example.ts` and its test) keeps CI green on day one; replace it with real code.

### First-time setup

CI installs with `npm ci`, which fails unless a `package-lock.json` is committed. On a new project, run this once and commit the lockfile:

```bash
npm install
npx playwright install chromium
git add package-lock.json
```

### Running the project

```bash
# Install dependencies
npm ci

# Develop with live reload
npm run dev

# Unit tests with coverage
npx jest --coverage

# Type check
npm run typecheck

# Lint and format check
npx biome ci --error-on-warnings .

# Format (auto-fix)
npx biome format --write .

# Build the single file (dist/index.html)
npm run build

# Build, then run the browser tests (phone and desktop, light and dark)
npm run test:e2e

# Everything CI runs, in order
npm run ci
```

### Test-first check in CI

After the checkout, the first step of `build` is
`.github/scripts/require-test-change.sh`. It fails a pull request that
changes code without changing a test. Code is
everything under `src/` (including `style.css` and `vite-env.d.ts`) and
`index.html`. Tests are `src/*.test.ts`, `src/*.spec.ts`, files in
`__tests__/` folders under `src/`, and everything under `e2e/`. Config
(`package.json`, `tsconfig.json`, `biome.json`, `vite.config.mts`,
`ci.yml`) is not code for this check; the other CI steps still run on
it.

To run the check locally, give it the base to compare with (the same line
exits 2 outside CI without it):

```bash
git fetch origin && TEST_FIRST_BASE=origin/main bash .github/scripts/require-test-change.sh --code 'src/*' 'index.html' --test 'src/*.test.ts' 'src/*.spec.ts' 'src/*__tests__/*' 'e2e/*'
```

A change no test can check carries a `Test-exempt: <reason>` commit
trailer; the failing check prints the exact command. The check sees file
names only: whether a test exercises the code is for review.

### Deploying (Cloudflare)

Optional: skip it if the page is served some other way. `deploy.yml` (copy to `.github/workflows/deploy.yml`) builds on every push to `main` and uploads `dist/` to Cloudflare as the static assets of a Worker, configured in `wrangler.jsonc` (copy to the project root and set `name`). There is no Worker script; Cloudflare serves the file as is.

The workflow does not re-run the tests. That is only safe when `main` requires CI to pass before a merge (a branch protection setting in GitHub); turn that on before adding this workflow.

One-off setup, done by the repo owner:

1. In Cloudflare, create an API token from the **Edit Cloudflare Workers** template.
2. In GitHub, add two repository secrets: `CLOUDFLARE_API_TOKEN` (the token) and `CLOUDFLARE_ACCOUNT_ID` (shown in the Cloudflare dashboard).
3. For your own domain (it must be a zone in the same Cloudflare account), uncomment `routes` in `wrangler.jsonc` and enter it (Cloudflare calls this a Workers Custom Domain).

Verified so far: `wrangler deploy --dry-run` (Wrangler 4.145.0) accepts `wrangler.jsonc`, with and without `routes`, and reads the built `dist/index.html`. Not verified: a real deploy, which needs the secrets above.

### Pre-commit equivalent

Web projects use Biome's CI command in the CI pipeline rather than pre-commit hooks. Optionally add `lint-staged` + `husky` for local pre-commit enforcement — not included by default.
