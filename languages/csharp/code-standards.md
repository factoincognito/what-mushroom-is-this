## C# Code Standards

- **.NET 10 SDK** (the long-term support release). `global.json` asks for SDK `10.0.100` with `rollForward: latestPatch`: any 10.0.1xx SDK from 10.0.100 up builds the project, the newest one installed is used, and CI installs the newest 10.0.1xx that `actions/setup-dotnet` offers. Use a 10.0.1xx SDK locally too. A newer feature band (10.0.2xx) is not used until `global.json` says so.
- **C# with nullable reference types** (`Nullable` is `enable` for every project, in `Directory.Build.props`). Mark what may be null with `?`; a possible null where none is allowed (for example `CS8600`, `CS8602`) fails the build.
- **Every warning is an error** (`TreatWarningsAsErrors`): a compiler warning, an analyzer warning or a code style warning fails `dotnet build` and CI.
- **Analyzers:** the .NET 10 recommended rule set (`AnalysisLevel` `10.0-recommended`), fixed to 10.0 so a newer SDK does not add rules by itself. Raise it on purpose, in its own change. This fixes the quality rules (`CA`) only: the code style rules (`IDE`) and the formatter come with the SDK, so a newer 10.0.1xx patch can in rare cases report something the one before did not.
- **`dotnet format`** for formatting and code style, from `.editorconfig`: four spaces, LF line endings, file-scoped namespaces (`namespace Example;`), braces on every `if`, `else`, `for`, `foreach`, `while` and `using`, no unused `using` directives, private members or parameters, `System` usings first. `dotnet format --verify-no-changes` is the format check that is clean before a push (Process P-11 § 5 (2)). The build checks the same rules (`EnforceCodeStyleInBuild`), except the order of the usings and the line endings, which only `dotnet format` checks.
- **XML doc comments** (`///`) on every public type and member in `src/`: a public member without one is `CS1591`, an error. Explain intent, not mechanics. Test projects do not need them.
- **xUnit v3** for testing, on Microsoft.Testing.Platform (`global.json`, `"test"`), with **coverlet** measuring it: the line coverage gate of Process P-11 § 5 (2) over the code under `src/`, all of it counted together, enforced in CI. The test projects themselves are not counted. coverlet measures only the assemblies a test project loads, so `tests/Example.Tests/Example.Tests.csproj` references every project under `src/` with one glob (`../../src/**/*.csproj`): a new project there is counted at once, at 0% until it has tests. Keep that glob; a further test project that references only some projects adds no gap, as long as this one stays.
- **Test first** — write the failing test in `tests/` and run it red before the code; `build` fails a pull request that changes `src/` without changing a test (§ 30 of the Rules, `rules/RULES.md`).
- **No hardcoded values**: Process P-11 § 5 (2).
- **Package versions in one place.** `Directory.Packages.props` (central package management) pins every package exactly; a project file names a package without a version. Add one with `dotnet add <project> package <name> --version <x.y.z>`, which writes the version there.

### Project layout

| Path | What it is |
|---|---|
| `Project.slnx` | The solution: every project, so that `dotnet restore`, `format`, `build` and `test` in the project root reach all of them |
| `global.json` | The SDK feature band and the test runner |
| `Directory.Build.props` | The settings every project shares: `net10.0`, nullable, warnings as errors, the analyzers, XML docs |
| `Directory.Packages.props` | Every package version |
| `.editorconfig` | Formatting and code style |
| `src/Example/` | A class library |
| `src/Example.App/` | A console app that uses the library. `Program.Main` hands its work to `Program.Run`, which takes the output writer, so tests can call it |
| `tests/Example.Tests/` | The xUnit v3 test project, for both |

`Example` is a starter: rename the projects, folders and namespaces to the project's own (and the paths in `Project.slnx` with them), and replace the starter code and its tests. A new project goes under `src/` (a test project under `tests/`), and into the solution: `dotnet sln add src/<Name>/<Name>.csproj`. The test project's glob picks it up, so its code needs tests before the gate passes.

### First-time setup

Install the .NET 10 SDK: https://dotnet.microsoft.com/download/dotnet/10.0. Check it with `dotnet --version` in the project root, which prints the SDK `global.json` picks; it must be 10.0.1xx.

There is no lockfile. `Directory.Packages.props` pins every direct dependency exactly; their own dependencies are not pinned, so two restores on different days can differ below the top level. If the project needs fully repeatable restores, turn on NuGet's lockfile (`RestorePackagesWithLockFile`) and commit the `packages.lock.json` files.

Once per clone:

```bash
dotnet restore
```

### Running the project

```bash
# Everything CI runs, in order
dotnet restore
dotnet format --verify-no-changes --no-restore
dotnet build --no-restore
dotnet test --no-build --coverlet --coverlet-threshold 80 --coverlet-threshold-type line --coverlet-threshold-stat total

# Fix formatting and code style
dotnet format

# Run the console app
dotnet run --project src/Example.App -- Ada
```

When coverage is under 80%, `dotnet test` fails with `exit code: 14` (Microsoft.Testing.Platform's code for a coverage threshold that failed), without the numbers. To see them, run the test project itself:

```bash
dotnet run --project tests/Example.Tests -- --coverlet --coverlet-threshold 80 --coverlet-threshold-type line --coverlet-threshold-stat total
```

It prints the line, branch and method coverage of each assembly and of the total, and which threshold failed. The reports (`coverage.*.json` and Cobertura XML) are written to the test project's `bin/.../TestResults/`.

### Test-first check in CI

After the checkout, the first step of `build` is
`.github/scripts/require-test-change.sh`. It fails a pull request that
changes code without changing a test. Code is everything under `src/`
except the project files (`src/*.csproj`). Tests are everything under
`tests/`: test classes, helpers and the test projects' own `.csproj`
files. Config (`global.json`, `Directory.Build.props`,
`Directory.Packages.props`, `.editorconfig`, `Project.slnx`, the project
files, `ci.yml`) is not code for this check; the other CI steps still run
on it.

To run the check locally, give it the base to compare with (the same line
exits 2 outside CI without it):

```bash
git fetch origin && TEST_FIRST_BASE=origin/main bash .github/scripts/require-test-change.sh --code 'src/*' --test 'tests/*' --ignore 'src/*.csproj'
```

A change no test can check carries a `Test-exempt: <reason>` commit
trailer; the failing check prints the exact command. The check sees file
names only: whether a test exercises the code is for review.
