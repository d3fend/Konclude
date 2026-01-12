# Konclude WebAssembly (Qt 5.15, no Redland)

This directory contains a reproducible, Dockerized build of a Konclude WebAssembly module with a small C API for browser/JS usage. The WASM build intentionally omits Redland (no RDF parsing or OWLLINK use) and targets OWL 2 XML/Functional inputs.

## Pinned Versions (Single Source of Truth)
All version pins live in `wasm/versions.env`:
- `EMSDK_VERSION`
- `QT_VERSION`
- `QT_SRC_URL`
- `QT_SRC_DIR`
Qt 5.15 is validated against emsdk 1.39.8 (newer emsdk releases can break the build).
The Docker build applies small patches to Qt 5.15.2 to ensure `<limits>` is available in the Emscripten toolchain:
- `wasm/patches/qt-5.15.2-emscripten-qfloat16.patch`
- `wasm/patches/qt-5.15.2-emscripten-qglobal-limits.patch`
The wasm build also generates `wasm/Konclude_wasm.pri` to normalize path separators for Qt's moc on Unix/wasm.

Update those values to change toolchain versions. The Docker build and local scripts read this file.

## Outputs
After building, artifacts land in:
- `wasm/dist/mt/` (multi-threaded, requires COOP/COEP)
- `wasm/dist/build-info.json`

The MT output directory contains `konclude_*.js`, `konclude_*.wasm`, and a `*.worker.js`.

## Docker Build (Recommended, Reproducible)
This uses a pinned emsdk and builds Qt 5.15 for WebAssembly inside the container.

```bash
./wasm/scripts/docker_build.sh
```

The script builds the Docker image, then copies `/out` into `wasm/dist/`.

### Build Args (Optional Overrides)
```bash
IMAGE_TAG=konclude-wasm-build:qt5.15 \
  EMSDK_VERSION=1.39.8 \
  QT_VERSION=5.15.2 \
  ./wasm/scripts/docker_build.sh
```

## Local Build (If You Already Have Qt WASM)
You must have:
- emsdk installed and activated
- Qt 5.15 WebAssembly kit built/installed

Set these environment variables:
```bash
export EMSDK_DIR=/opt/emsdk
export QT_WASM_DIR=/opt/qt-wasm
```

Then build MT:
```bash
./wasm/scripts/build_wasm_all.sh
```

## JS Usage (Bundler-Agnostic)
The build exports a modularized factory named `createKoncludeModule` (global function) and the C API in `Source/WasmBridge/konclude_wasm_api.*`. Emscripten 1.39.x does not emit ES modules, so load the JS glue via a `<script>` tag and use the global.

Example:
```js
import { createKoncludeApi } from "./konclude_wasm_api.js";

// Ensure konclude_mt.js is loaded (e.g. via <script src="..."></script>)
const createKoncludeModule = window.createKoncludeModule;

const api = await createKoncludeApi(createKoncludeModule, {
  locateFile: (path) => new URL(`./${path}`, import.meta.url).toString(),
});

const { output } = await api.classifyOwl2XmlString(owlXmlString);
```

### File-based async API (preferred for large inputs)
Write to Emscripten FS, call `konclude_submit_classify_files`/`konclude_submit_realize_files`, poll with
`konclude_job_status` (call `konclude_tick` while polling), then read the output file.

## Threads & COOP/COEP
The MT build uses pthreads and requires:
```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```
Serve over HTTPS or `localhost` and run the module in a Web Worker for best responsiveness.

## Browser Smoke Test (Reproducible)
Build the artifacts and serve them with COOP/COEP headers:
```bash
./wasm/scripts/docker_build.sh
node ./wasm/scripts/serve_coop_coep.js
```
Then open:
- `http://localhost:8000/web/index.html?mode=mt` (requires COOP/COEP + SharedArrayBuffer)

## E2E Browser Tests (Playwright)
```bash
cd wasm/tests
npm install
npx playwright install chromium firefox
npm test
```

## Notes
- This build omits Redland and does **not** target OWLLINK.
- The single-threaded (ST) build is not supported; the WASM API is MT-only.
- The synchronous C API (`konclude_classify_files`, `konclude_realize_files`) is not supported in WASM; use the async job API instead.
- Memory sizing is pinned in `wasm/konclude_wasm_flags.pri` and can be overridden via qmake variables (`KONCLUDE_WASM_TOTAL_MEMORY`).

## Debugging (WIP)
If the browser smoke test submits a job but `konclude_job_status` stays `0`:
- Rebuild the wasm artifacts and check the browser console for `[konclude wasm]` logs.
- You should see loader progress like:
  - `CommandLineLoader threadStarted, loaders=...`
  - `CCLIBatchProcessingLoader load, request=... response=...`
  - `createClassificationTestingCommands request=... response=...`
Missing lines indicate where the pipeline is stalling.
