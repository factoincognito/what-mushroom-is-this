## Node/TypeScript Code Standards

- **Node.js 24 LTS** — use modern ES2022+ features
- **TypeScript strict mode** — no `any`, no implicit returns, no unchecked array access
- **Biome** for linting and formatting — `npx biome ci --error-on-warnings .` is the check that is clean before a push (Process P-11 § 5 (2))
- **Biome warnings fail CI** — Biome 2 reports several recommended rules (for example `useConst`, `noNonNullAssertion`, unused variables and imports) as warnings, so CI runs `biome ci --error-on-warnings`. `noExplicitAny` is set to error in `biome.json`, so `any` fails even without the flag.
- **Global types are listed** — TypeScript 6 no longer loads every installed `@types` package, so `tsconfig.json` lists them in `types` (`jest` by default). Add any you install, e.g. `node` after `npm install -D @types/node`.
- **Jest + ts-jest** for testing — the line coverage gate of Process P-11 § 5 (2), enforced in CI
- **Test first** — write the failing test in `src/*.test.ts` and run it red before the code; `build` fails a pull request that changes `src/` without changing a test (§ 30 of the Rules, `rules/RULES.md`).
- **No hardcoded values**: Process P-11 § 5 (2).
- **Error handling** — always type-narrow errors; never `catch (e: any)`
- **Imports** — relative imports within the project; no barrel files unless justified

### First-time setup

CI installs with `npm ci`, which fails unless a `package-lock.json` is committed. On a new project, run this once and commit the lockfile:

```bash
npm install
git add package-lock.json
```

### Running the project

```bash
# Install dependencies
npm ci

# Run tests
npx jest --coverage

# Type check
npm run typecheck

# Lint and format check
npx biome ci --error-on-warnings .

# Format (auto-fix)
npx biome format --write .

# Build
npx tsc
```

### Test-first check in CI

After the checkout, the first step of `build` is
`.github/scripts/require-test-change.sh`. It fails a pull request that
changes code without changing a test. Code is
everything under `src/`. Tests are `src/*.test.ts`, `src/*.spec.ts` and
files in `__tests__/` folders under `src/`. Config (`package.json`,
`tsconfig.json`, `biome.json`, `ci.yml`) is not code for this check; the
other CI steps still run on it.

To run the check locally, give it the base to compare with (the same line
exits 2 outside CI without it):

```bash
git fetch origin && TEST_FIRST_BASE=origin/main bash .github/scripts/require-test-change.sh --code 'src/*' --test 'src/*.test.ts' 'src/*.spec.ts' 'src/*__tests__/*'
```

A change no test can check carries a `Test-exempt: <reason>` commit
trailer; the failing check prints the exact command. The check sees file
names only: whether a test exercises the code is for review.

### Pre-commit equivalent

Node projects use Biome's CI command in the CI pipeline rather than pre-commit hooks. Optionally add `lint-staged` + `husky` for local pre-commit enforcement — not included by default.
