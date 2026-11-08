## Python Code Standards

- **Python 3.14** — CI uses the latest 3.14 release that `actions/setup-python` offers. Use the same minor version locally.
- **Virtual environment** — always work in `.venv`; never install into the system Python
- **Ruff** for linting and formatting (`line-length = 100`) — `ruff check .` and `ruff format --check .` are the checks that are clean before a push (Process P-11 § 5 (2))
- **Ruff rules that fail CI** (set in `pyproject.toml`): pycodestyle (`E`, `W`), pyflakes (`F`), import order (`I`), bugbear (`B`), modern syntax for the target Python (`UP`), pathlib instead of `os.path` and `open()` (`PTH`), and docstrings on public classes, methods and functions (`D101`–`D103`; not required in `src/tests/`)
- **Type hints everywhere** — mypy runs in `strict` mode over `src/`, tests included, so an unannotated function or a type error fails CI
- **Docstrings** on public functions and classes — explain intent, not mechanics
- **Exception chaining** — inside `except`, always `raise XxxError(...) from exc` (Ruff `B904` enforces it)
- **Cross-platform paths** — `pathlib.Path` for all file paths, never string concatenation (Ruff `PTH` enforces it)
- **pytest** for testing — the line coverage gate of Process P-11 § 5 (2) over `src/`, enforced in CI; `src/tests/` itself is not counted
- **Test first** — write the failing test in `src/tests/` and run it red before the code; `build` fails a pull request that changes `src/` without changing a test (§ 30 of the Rules, `rules/RULES.md`).
- **No hardcoded values**: Process P-11 § 5 (2).
- **Run as a module, from the project root** — `python -m src.<module>.main`, never `python src/<module>/main.py`. Run as a script, `from src.<module> import ...` fails with `ModuleNotFoundError: No module named 'src'`, on every OS.

### Project layout

Code lives in packages under `src/` (`src/<module>/`, each with an `__init__.py`). Tests live in `src/tests/` as `test_*.py` and import the code as `from src.<module>.<file> import ...`. The pack's `starter/src/` holds `src/__init__.py`, `src/tests/__init__.py` and a placeholder test that keeps CI green on day one; delete the placeholder when you write your first real test.

### First-time setup

There is no lockfile. `requirements.txt` (runtime) and `requirements-dev.txt` (tools) pin every direct dependency exactly; their own dependencies are not pinned, so two installs on different days can differ below the top level. If the project needs fully repeatable installs, add a lock tool (for example pip-tools or uv) and commit its lockfile.

Once per clone:

```bash
python3.14 -m venv .venv        # macOS / Linux
py -3.14 -m venv .venv           # Windows
source .venv/bin/activate        # macOS / Linux
.venv\Scripts\activate           # Windows
pip install -r requirements.txt -r requirements-dev.txt
pre-commit install
```

`pre-commit install` makes every `git commit` run Ruff on the staged files first. The hook's Ruff version (`rev` in `.pre-commit-config.yaml`) must equal the `ruff==` pin in `requirements-dev.txt`; update both together.

### Running the project

```bash
# Activate the environment (every new terminal)
source .venv/bin/activate        # macOS / Linux
.venv\Scripts\activate           # Windows

# Everything CI runs, in order
ruff check .
ruff format --check .
mypy
pytest --cov=src --cov-fail-under=80

# Format and auto-fix
ruff format .
ruff check --fix .

# Coverage with the missing lines listed
pytest --cov=src --cov-report=term-missing

# Run the application (always from the project root)
python -m src.<module>.main
```

### Test-first check in CI

After the checkout, the first step of `build` is
`.github/scripts/require-test-change.sh`. It fails a pull request that
changes code without changing a test. Code is
everything under `src/`. Tests are everything under `src/tests/`
(`test_*.py`, `conftest.py` and helpers there). Config (`pyproject.toml`,
the requirements files, `ci.yml`) is not code for this check; the other
CI steps still run on it.

To run the check locally, give it the base to compare with (the same line
exits 2 outside CI without it):

```bash
git fetch origin && TEST_FIRST_BASE=origin/main bash .github/scripts/require-test-change.sh --code 'src/*' --test 'src/tests/*'
```

A change no test can check carries a `Test-exempt: <reason>` commit
trailer; the failing check prints the exact command. The check sees file
names only: whether a test exercises the code is for review.

### Known gotcha: `MagicMock(spec=...)` inside `patch`

Building a `MagicMock(spec=socket.socket)` inside a `with patch("socket.socket"):` block raises `InvalidSpecError: Cannot spec a Mock object`, because by then `socket.socket` is itself a mock. Build the mock first, then patch:

```python
mock_sock = MagicMock(spec=socket.socket)  # before the patch
with patch("socket.socket", return_value=mock_sock):
    ...
```

This is not specific to Python 3.14: it was checked on 3.11 and 3.14 and fails the same way on both. The cause is general: any class that is patched before it is used as a `spec` fails the same way.
