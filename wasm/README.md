# Konclude WebAssembly (Qt 5.15, no Redland)

This directory builds a Konclude WebAssembly module for browser/JS usage. The WASM build omits Redland and focuses on OWL 2 XML/Functional inputs. The runtime is multi-threaded (MT) only and relies on COOP/COEP headers.

## Quick Start
```bash
./wasm/scripts/docker_build.sh
node ./wasm/scripts/serve_coop_coep.js
```

Open:
- `http://localhost:8000/web/index.html?mode=mt`
- add `&debug=1` to log worker/pthread setup
- add `&main=1` to run on the main thread (debug only)

## Outputs
Build artifacts land in:
- `wasm/dist/mt/` (MT build, requires COOP/COEP)
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

## Local Build (If You Already Have Qt WASM)
Requirements:
- emsdk installed and activated
- Qt 5.15 WebAssembly kit built/installed

```bash
export EMSDK_DIR=/opt/emsdk
export QT_WASM_DIR=/opt/qt-wasm
./wasm/scripts/build_wasm_all.sh
```

## Runtime Model and API
- MT only (no ST build supported).
- Requires COOP/COEP headers:
  - `Cross-Origin-Opener-Policy: same-origin`
  - `Cross-Origin-Embedder-Policy: require-corp`
- The WASM runtime keeps a single reasoner/configuration instance and runs jobs sequentially.
- Use the async job API (`konclude_submit_*`, `konclude_job_status`, `konclude_tick`, `konclude_job_free`).
- The synchronous C API (`konclude_classify_files`, `konclude_realize_files`) is not supported in WASM.

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
Emscripten 1.39.x emits a global factory named `createKoncludeModule`. Load `konclude_mt.js` via `<script>` and then call the API.

```js
import { createKoncludeApi } from "./konclude_wasm_api.js";
const createKoncludeModule = window.createKoncludeModule;

const api = await createKoncludeApi(createKoncludeModule, {
  locateFile: (path) => new URL(`./${path}`, import.meta.url).toString(),
});

const { output } = await api.classifyOwl2XmlString(owlXmlString);
```

## Thread Pool Sizing
The pthread pool size is set by `KONCLUDE_WASM_PTHREAD_POOL` (default: 24). For debugging, set
`KONCLUDE_WASM_PTHREAD_STRICT=2` to fail fast if the pool is too small.

## E2E Browser Tests (Playwright)
```bash
cd wasm/tests
npm ci
npx playwright install --with-deps chromium firefox
BROWSERS=chromium,firefox node e2e.js
```

CI runs the same test flow with Chromium by default.

## Notes
- No Redland (no OWLLINK/RDF parsing).
- Memory sizing is pinned in `wasm/konclude_wasm_flags.pri` and can be overridden with
  `KONCLUDE_WASM_TOTAL_MEMORY` or qmake variables.

## Troubleshooting
- `crossOriginIsolated` is `false`: COOP/COEP headers are missing.
- Jobs stuck at status `0`: ensure you call `konclude_tick` while polling and that the output file path is correct.
