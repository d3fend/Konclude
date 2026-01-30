# Repository Guidelines

## Project Structure & Module Organization
- `Source/` holds the C++/Qt reasoning engine; the WASM C API lives in `Source/WasmBridge/`.
- `Configs/` contains XML configuration profiles like `default-config.xml` and `querying-config.xml`.
- `Tests/` provides sample ontologies/requests (`*.owl.xml`, `*-request.xml`, `*.sparql`) used for manual regression.
- `External/` contains vendored dependencies; avoid editing unless updating third-party code.
- `Scripts/` has platform launchers (`Konclude`, `Konclude.sh`, `Konclude.bat`).
- `wasm/` is the reproducible Qt 5.15 WebAssembly build (Docker, scripts, JS glue in `wasm/js/`, demo in `wasm/web/`, tests in `wasm/tests/`).
- Build files: `Konclude.pro` (full), `KoncludeWithoutRedland.pro`, `KoncludeLIB.pro`, `KoncludeWasm.pro`. Native outputs default to `Release/`; wasm outputs land in `wasm/dist/`.

## Build, Test, and Development Commands
- Native (with Redland): `qmake -o Makefile Konclude.pro && make`
- Native (without Redland): `qmake -o Makefile KoncludeWithoutRedland.pro && make`
- Library build: `qmake -o Makefile KoncludeLIB.pro && make` (outputs to `Release/`)
- Run CLI: `./Release/Konclude -h` or `./Release/Konclude classification -i Tests/roberts-family-full-D.owl.xml -o out.owl.xml`
- WASM (reproducible): `./wasm/scripts/docker_build.sh` (pins toolchains via `wasm/versions.env`)
- WASM smoke test: `node ./wasm/scripts/serve_coop_coep.js` then open `http://localhost:8000/web/index.html?mode=mt`
- WASM E2E: `cd wasm/tests && npm ci && npx playwright install --with-deps chromium firefox && npm test`

## Coding Style & Naming Conventions
Follow existing `Source/` style: tabs for indentation, braces on the next line, and `C`-prefixed class names (e.g., `CLogger`). File names mirror classes (`CLogger.h/.cpp`). There is no enforced formatter; match nearby code and keep Qt includes above project includes.

## Testing Guidelines
There is no unit test framework. Add small, descriptive fixtures under `Tests/` when behavior changes. WASM browser tests live in `wasm/tests/` and are run via Playwright (`npm test`).
Before committing, run OWL2 conformance tests after all other tests and update coverage/expected-failures as needed:
- Linux/macOS: `Tests/owl2-test-cases/scripts/run_ofn_tests.sh Release/Konclude`
- Windows: `powershell -File Tests\\owl2-test-cases\\scripts\\run_ofn_tests.ps1 -Konclude Release\\Konclude.exe`
- Keep `Tests/owl2-test-cases/coverage.md` and `Tests/owl2-test-cases/expected-failures.txt` current with the latest results.

## Commit & Pull Request Guidelines
Recent commits use short, lower-case subjects (e.g., “add wasm bridge…”, “fixed crash…”). Keep commit messages concise and scoped. PRs should include a summary, the exact test commands run, and note any changes to toolchain pins in `wasm/versions.env` or runtime configs in `Configs/`.

## Configuration & Runtime Notes
Runtime behavior is driven by `Configs/*.xml` and the `-c <file>` flag. Redland/RDF support is optional; the WASM build omits Redland and expects OWL 2 XML/Functional inputs. Multi-threaded WASM requires COOP/COEP headers (see `wasm/README.md`).

## Agent Notes (Optional)
Avoid mass reformatting. Prefer targeted edits and avoid touching `External/` unless strictly necessary.
