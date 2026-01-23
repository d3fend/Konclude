# Konclude WebAssembly (Qt 5.15, no Redland)

This directory builds a Konclude WebAssembly module for browser/JS usage. The WASM build omits Redland and focuses on OWL 2 XML/Functional inputs. The demo and default build target the multi-threaded (MT/pthreads) runtime and require COOP/COEP headers; a single-thread (ST) build script exists but is not wired into the web demo.

## Current Status (2026-01-23)
- **Main-thread runner (default) works** for `DATASET=sample` and D3FEND in Chromium.
- **Worker runner (`main=0`) is disabled in the demo** and falls back to the main thread; running the module
  directly inside a dedicated worker still hangs after query dispatch (job status remains `0`).
- E2E tests default to the main-thread runner to keep CI stable.
- **ST build is optional** (`KONCLUDE_WASM_BUILD_ST=1`), but the web demo/tests only load MT artifacts.

## Quick Start
```bash
./wasm/scripts/docker_build.sh
node ./wasm/scripts/serve_coop_coep.js
```

Open:
- `http://localhost:8000/web/index.html?mode=mt` (defaults to main thread)
- add `&debug=1` to log worker/pthread setup
- add `&main=0` to request the worker runner (falls back to main thread today)
- add `&only=classification|consistency|realization` to run a single task

## Outputs
Build artifacts land in:
- `wasm/dist/mt/` (MT build, requires COOP/COEP)
- `wasm/dist/st/` (ST build, only if `KONCLUDE_WASM_BUILD_ST=1`)
- `wasm/dist/build-info.json`

The MT directory contains `konclude_*.js`, `konclude_*.wasm`, and a `*.worker.js`.

## Toolchain Pins (Single Source of Truth)
Pinned versions live in `wasm/versions.env`:
- `EMSDK_VERSION`
- `QT_VERSION`
- `QT_SRC_URL`
- `QT_SRC_DIR`

Qt 5.15.2 is validated against emsdk 1.39.8; newer emsdk releases can break this build. The Docker build applies:
- `wasm/patches/qt-5.15.2-emscripten-qfloat16.patch`
- `wasm/patches/qt-5.15.2-emscripten-qglobal-limits.patch`

The build also generates `wasm/Konclude_wasm.pri` to normalize path separators for Qt's moc on wasm.

## Docker Build (Recommended)
```bash
./wasm/scripts/docker_build.sh
```

Optional overrides:
```bash
IMAGE_TAG=konclude-wasm-build:qt5.15 \
  EMSDK_VERSION=1.39.8 \
  QT_VERSION=5.15.2 \
  ./wasm/scripts/docker_build.sh
```

To also build the (unsupported) ST artifact:
```bash
KONCLUDE_WASM_BUILD_ST=1 ./wasm/scripts/docker_build.sh
```

## Local Build (If You Already Have Qt WASM)
Requirements:
- emsdk installed and activated
- Qt 5.15 WebAssembly kit built/installed

```bash
export EMSDK_DIR=/opt/emsdk
export QT_WASM_DIR=/opt/qt-wasm
./wasm/scripts/build_wasm_all.sh
```

Build ST as well (not used by the demo):
```bash
KONCLUDE_WASM_BUILD_ST=1 ./wasm/scripts/build_wasm_all.sh
```

## Runtime Model and API
- The web demo/tests load the MT build and require COOP/COEP headers:
  - `Cross-Origin-Opener-Policy: same-origin`
  - `Cross-Origin-Embedder-Policy: require-corp`
- An ST build is optional (`KONCLUDE_WASM_BUILD_ST=1`), but it is not wired into the demo; you must load `wasm/dist/st/` yourself and bypass the `crossOriginIsolated` guard in `wasm/web/app.js`.
- The WASM runtime keeps a single reasoner/configuration instance and runs jobs sequentially.
- Use the async job API (`konclude_submit_*`, `konclude_job_status`, `konclude_tick`, `konclude_job_free`) from JS.
- The synchronous C API (`konclude_classify_files`, `konclude_consistency_files`, `konclude_realise_files`,
  `konclude_realize_files`) exists in WASM, but it blocks the calling thread; prefer the async API in browsers.

Minimal file-based flow:
```js
const submit = Module.cwrap("konclude_submit_classify_files", "number", ["string", "string"]);
const status = Module.cwrap("konclude_job_status", "number", ["number"]);
const tick = Module.cwrap("konclude_tick", null, ["number"]);

Module.FS.writeFile("in.owl.xml", owlXml);
const id = submit("in.owl.xml", "out.owl.xml");
while (status(id) === 0) tick(5);
const output = Module.FS.readFile("out.owl.xml", { encoding: "utf8" });
```

## JS Usage (Bundler-Agnostic)
Emscripten 1.39.x emits a global factory named `createKoncludeModule`. Load `konclude_mt.js` via `<script>` and then call the API. Helper bindings live in `wasm/js/konclude_wasm_api.js`.

```js
import { createKoncludeApi } from "../js/konclude_wasm_api.js";
const createKoncludeModule = window.createKoncludeModule;

const api = await createKoncludeApi(createKoncludeModule, {
  locateFile: (path) => new URL(`./${path}`, import.meta.url).toString(),
});

const { output } = await api.classifyOwl2XmlString(owlXmlString);
```

## D3FEND Ontology Datasets
The demo includes pre-converted D3FEND OWL 2 XML files under `wasm/web/ontologies/`:
- `d3fend.tbox.owl.xml` (TBox only; individuals removed)
- `d3fend.owl.xml` (full ontology)

Update to the latest MITRE D3FEND release:
```bash
./wasm/scripts/update_d3fend_owlxml.sh
```
This refreshes the `d3fend*.owl.xml` files and their `d3fend*.meta.json` metadata (version, release date, hashes, retrieval time).

## Thread Pool Sizing
The WASM heap is set by `KONCLUDE_WASM_TOTAL_MEMORY` (default: `2GB` in `wasm/versions.env`) to keep
large ontologies like D3FEND stable with multiple workers.
The pthread pool size is set by `KONCLUDE_WASM_PTHREAD_POOL` (default: `16` from `wasm/versions.env`).
Set it to `auto` to size the pool at runtime from `navigator.hardwareConcurrency`; the pool can be expanded
by `KONCLUDE_WASM_PTHREAD_OVERHEAD` (default: `0` in `wasm/versions.env`).
Pthread stack size defaults to `KONCLUDE_WASM_PTHREAD_STACK_SIZE=16777216` (16MB) and can be overridden at build time.

Internal worker count defaults to all detected cores; override with `KONCLUDE_WASM_PROCESSOR_COUNT`
if you need to cap concurrency. For debugging, set `KONCLUDE_WASM_PTHREAD_STRICT=2` to fail fast
if the pool is too small.

## E2E Browser Tests (Playwright)
```bash
cd wasm/tests
npm ci
npx playwright install --with-deps chromium firefox
BROWSERS=chromium,firefox node e2e.js
```

The E2E runner **defaults to main-thread execution** (stable).
Request worker mode (falls back to the main thread in the demo):
```bash
MAIN_THREAD=0 BROWSERS=chromium node e2e.js
```

## WASM Runtime Profiles (Large Ontologies)
The web demo does not apply dataset-specific caps by default. The WASM bridge now sizes the
internal worker counts and QtConcurrent pool from the available pthread pool, then sets
classification and precomputation parallelism to match. Use `workers=` and `parallel=` if you
need to override those defaults for a specific workload.

Override via URL params:
- `profile=default|large|d3fend` (default: `auto`)
- `workers=<N>` to force Konclude worker/processor counts
- `parallel=<N>` to override classification/precomputation parallelism (defaults to the active worker count)

Example (explicitly pin 16 workers):
```
http://localhost:8000/web/index.html?mode=mt&dataset=d3fend&profile=d3fend&workers=16
```

D3FEND E2E examples:
```bash
DATASET=d3fend BROWSERS=chromium node e2e.js
DATASET=d3fend-full TIMEOUT_MS=300000 BROWSERS=chromium node e2e.js
# Aggressive parallelism (can increase CPU use but may need longer timeouts):
PARALLEL=2 DATASET=d3fend PROFILE=d3fend WORKERS=16 BROWSERS=chromium node e2e.js
```

With the default 2GB heap and worker-aligned parallelism, D3FEND classification is stable
through 16 workers (thread pool size). A 3GB heap build crashes in Chromium for D3FEND, so 2GB is
currently the practical max. To go beyond 16 workers, rebuild with a larger thread pool
(`KONCLUDE_WASM_PTHREAD_POOL`) and validate memory limits in your target browsers. Use `parallel=<N>`
to raise or cap parallelism if you see memory pressure. In local tests, `parallel=2` is stable, while
`parallel=3` can exceed the default timeout (tune `timeoutMs`/`TIMEOUT_MS` accordingly).

The WASM bridge also exposes runtime config overrides:
- `konclude_set_config(key, value)`
- `konclude_reset_config_overrides()`

These apply Konclude config keys before each job is started (persisting until reset).

## Troubleshooting
- `crossOriginIsolated` is `false`: COOP/COEP headers are missing.
- Jobs stuck at status `0`: ensure you call `konclude_tick` while polling and that the output file path is correct.
- Worker runner hangs (`main=0`): the demo falls back to the main-thread runner; direct worker execution is still under investigation.
- ST build won’t run in the demo without edits: `wasm/web/app.js` enforces `crossOriginIsolated` and loads `wasm/dist/mt/` only.

## Handoff Notes for Another Agent
- Main-thread runner is stable and used by default.
- Worker runner (`main=0`) hangs after query dispatch (job status remains `0`); the demo now falls back to main thread.
- Key wasm runtime flow lives in `Source/WasmBridge/konclude_wasm_api.cpp` and `wasm/web/*` (notably `wasm/web/konclude_worker.js`).
- Debug logging was added around requirement expansion and processing in
  `Source/Reasoner/Kernel/Manager/CReasonerManagerThread.cpp` to pinpoint stalls.
- If investigating worker hangs, reproduce with:
  ```bash
  MAIN_THREAD=0 DATASET=sample BROWSERS=chromium node wasm/tests/e2e.js
  ```
  Compare logs to the main-thread runner to isolate where events stop flowing.
