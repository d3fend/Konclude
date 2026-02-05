const { chromium } = require("playwright");
const { spawn, spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..", "..");
const casesFile = path.join(repoRoot, "Tests", "owl2-test-cases", "approved", "ofn", "cases.txt");
const koncludePath = path.join(repoRoot, "Release", "Konclude");
const serverScript = path.join(repoRoot, "wasm", "scripts", "serve_repo_coop_coep.js");
const nativeTmpDir = path.join(repoRoot, "Tests", "owl2-test-cases", "approved", "ofn", "tmp-native-compare");
const port = Number(process.env.PORT || 8000);
const baseUrl = `http://localhost:${port}`;

const requestedCaseLimit = Number(process.env.CASE_LIMIT || 0);
const startIdx = Number(process.env.START_IDX || 0);
const minTimeoutMs = Number(process.env.MIN_TIMEOUT_MS || 1200);
const maxTimeoutMs = Number(process.env.MAX_TIMEOUT_MS || 12000);
const deltaFactor = Number(process.env.DELTA_FACTOR || 50);
const stopOnTimeout = process.env.STOP_ON_TIMEOUT !== "0";
const timeoutRetryCount = Number(process.env.WASM_TIMEOUT_RETRY_COUNT || 1);
const headless = process.env.HEADLESS !== "0";
const recycleWasmPerCase = process.env.RECYCLE_WASM_PER_CASE !== "0";
const pageRecycleIntervalRaw = Number(process.env.WASM_PAGE_RECYCLE_INTERVAL || (recycleWasmPerCase ? 1 : 0));
const pageRecycleInterval = Number.isFinite(pageRecycleIntervalRaw) && pageRecycleIntervalRaw > 0
  ? Math.floor(pageRecycleIntervalRaw)
  : 0;
const iriMappingFile = process.env.OFN_IRI_MAPPING_FILE
  || path.join(repoRoot, "Tests", "owl2-test-cases", "approved", "ofn", "iri-mapping.txt");
const useNativeIriMapping = process.env.NATIVE_USE_IRI_MAPPING !== "0";
const useWasmIriMapping = process.env.WASM_USE_IRI_MAPPING !== "0";
const wasmIriMappingPath = process.env.WASM_IRI_MAPPING_PATH || "/tmp/ofn-iri-mapping.txt";

function parseCases(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const [expectStr, input, id] = line.split("\t");
      return {
        expect: expectStr === "true",
        input,
        id: id || input,
      };
    });
}

function parseIriMappings(filePath) {
  if (!fs.existsSync(filePath)) {
    return [];
  }
  const raw = fs.readFileSync(filePath, "utf8");
  const mappings = [];
  for (const rawLine of raw.split(/\r?\n/)) {
    let line = rawLine;
    const commentPos = line.indexOf("#");
    if (commentPos >= 0) {
      line = line.slice(0, commentPos);
    }
    line = line.trim();
    if (!line) {
      continue;
    }
    let iri = "";
    let file = "";
    const eqPos = line.indexOf("=");
    if (eqPos >= 0) {
      iri = line.slice(0, eqPos).trim();
      file = line.slice(eqPos + 1).trim();
    } else {
      const parts = line.split(/\s+/).filter(Boolean);
      if (parts.length >= 2) {
        iri = parts[0];
        file = parts.slice(1).join(" ");
      }
    }
    if (!iri || !file) {
      continue;
    }
    mappings.push({ iri, file });
  }
  return mappings;
}

function buildWasmIriMappingConfig() {
  if (!useWasmIriMapping) {
    return {
      iriMappingPath: "",
      iriMappingText: "",
      iriMappingEntries: [],
    };
  }

  const mappings = parseIriMappings(iriMappingFile);
  const entries = [];
  const mappingLines = [];
  const mappingDir = path.dirname(iriMappingFile);

  for (const mapping of mappings) {
    let absolutePath = mapping.file;
    if (!path.isAbsolute(absolutePath)) {
      const repoRootResolved = path.resolve(repoRoot, absolutePath);
      const mappingDirResolved = path.resolve(mappingDir, absolutePath);
      if (fs.existsSync(repoRootResolved)) {
        absolutePath = repoRootResolved;
      } else {
        absolutePath = mappingDirResolved;
      }
    }
    if (!fs.existsSync(absolutePath)) {
      continue;
    }
    const repoRelative = path.relative(repoRoot, absolutePath).split(path.sep).join("/");
    const wasmFilePath = repoRelative.startsWith("..")
      ? `/tmp/ofn-imports/${path.basename(absolutePath)}`
      : `/${repoRelative}`;
    entries.push({
      path: wasmFilePath,
      content: fs.readFileSync(absolutePath, "utf8"),
    });
    mappingLines.push(`${mapping.iri}=${wasmFilePath}`);
  }

  return {
    iriMappingPath: mappingLines.length ? wasmIriMappingPath : "",
    iriMappingText: mappingLines.length ? `${mappingLines.join("\n")}\n` : "",
    iriMappingEntries: entries,
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServer(url) {
  for (let i = 0; i < 120; i += 1) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // ignore
    }
    await sleep(250);
  }
  throw new Error(`Server not responding at ${url}`);
}

function runNative(caseDef, idx) {
  const outPath = path.join(nativeTmpDir, `out-${idx}.txt`);
  const args = ["consistency", "-i", path.join(repoRoot, caseDef.input), "-o", outPath];
  if (useNativeIriMapping && fs.existsSync(iriMappingFile)) {
    args.push("-m", iriMappingFile);
  }
  const start = process.hrtime.bigint();
  const result = spawnSync(koncludePath, args, {
    cwd: repoRoot,
    encoding: "utf8",
  });
  const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;

  if (result.status !== 0) {
    return {
      ok: false,
      elapsedMs,
      error: `native exit=${result.status}`,
      stderr: (result.stderr || "").trim(),
    };
  }
  if (!fs.existsSync(outPath)) {
    return {
      ok: false,
      elapsedMs,
      error: "native output missing",
    };
  }

  const output = fs.readFileSync(outPath, "utf8").trim().toLowerCase();
  const value = output === "true" ? true : output === "false" ? false : null;
  return {
    ok: value !== null,
    elapsedMs,
    value,
    raw: output,
  };
}

async function initWasmPage(page, wasmRunConfig) {
  await page.route("**/wasm/web/owl2-conformance.js", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/javascript; charset=utf-8",
      body: "// disabled by ofn_native_wasm_perf_compare.js\n",
    });
  });

  await page.goto(`${baseUrl}/wasm/web/owl2-conformance.html`, { waitUntil: "load" });

  await page.evaluate(async ({
    reservePolicy,
    wasmProcCount,
    wasmWorkerCount,
    threadPoolReserve,
    recyclePerCase,
    iriMappingPath,
    iriMappingText,
    iriMappingEntries,
  }) => {
    const ensureParentDirs = (moduleFs, filePath) => {
      const slashPos = filePath.lastIndexOf("/");
      if (slashPos <= 0) {
        return;
      }
      const dirPath = filePath.slice(0, slashPos);
      if (!dirPath) {
        return;
      }
      if (typeof moduleFs.mkdirTree === "function") {
        try {
          moduleFs.mkdirTree(dirPath);
          return;
        } catch {
          // fall through to manual directory creation
        }
      }
      let current = "";
      for (const part of dirPath.split("/").filter(Boolean)) {
        current += `/${part}`;
        try {
          moduleFs.mkdir(current);
        } catch {
          // ignore already-existing directories
        }
      }
    };
    const applyWasmConfig = (api, cfg) => {
      if (cfg.reservePolicy) {
        api.setConfig("Konclude.Wasm.ThreadReservePolicy", cfg.reservePolicy);
      }
      if (cfg.wasmProcCount) {
        api.setConfig("Konclude.Wasm.ProcessorCount", cfg.wasmProcCount);
      }
      if (cfg.wasmWorkerCount) {
        api.setConfig("Konclude.Calculation.WorkerCount", cfg.wasmWorkerCount);
      }
      if (cfg.threadPoolReserve) {
        api.setConfig("Konclude.Calculation.BlockingThreadPoolReservationCount", cfg.threadPoolReserve);
      }
      if (cfg.iriMappingPath && cfg.iriMappingText) {
        for (const entry of cfg.iriMappingEntries || []) {
          ensureParentDirs(api.module.FS, entry.path);
          api.module.FS.writeFile(entry.path, entry.content);
        }
        ensureParentDirs(api.module.FS, cfg.iriMappingPath);
        api.module.FS.writeFile(cfg.iriMappingPath, cfg.iriMappingText);
        api.setConfig("Konclude.CLI.OntologyIRIMappingFile", cfg.iriMappingPath);
      }
      api.setConfig("Konclude.CLI.DetailedConsistencyMaxAttempts", "1");
    };
    window.__tmpPerfConfig = {
      reservePolicy,
      wasmProcCount,
      wasmWorkerCount,
      threadPoolReserve,
      iriMappingPath,
      iriMappingText,
      iriMappingEntries,
    };
    window.__tmpPerfApplyConfig = applyWasmConfig;
    if (recyclePerCase) {
      window.__tmpPerfApi = null;
      return;
    }
    if (!window.createKoncludeModule) {
      throw new Error("createKoncludeModule not available");
    }
    const apiModule = await import("/wasm/js/konclude_wasm_api.js");
    window.__tmpPerfApi = await apiModule.createKoncludeApi(window.createKoncludeModule, {
      locateFile: (p) => `${window.location.origin}/wasm/dist/mt/${p}`,
      print: (...args) => console.log("[wasm-print]", ...args),
      printErr: (...args) => console.error("[wasm-err]", ...args),
    });
    applyWasmConfig(window.__tmpPerfApi, window.__tmpPerfConfig);
  }, {
    ...wasmRunConfig,
    recyclePerCase: recycleWasmPerCase,
  });
}

async function runWasmCase(page, caseDef, idx, timeoutMs) {
  const inputPath = path.join(repoRoot, caseDef.input);
  const inputText = fs.readFileSync(inputPath, "utf8");
  return page.evaluate(
    async ({ inputTextArg, idxArg, timeoutMsArg, recycleArg }) => {
      const ensureApi = async () => {
        if (!recycleArg && window.__tmpPerfApi) {
          return window.__tmpPerfApi;
        }
        if (!window.createKoncludeModule) {
          throw new Error("createKoncludeModule not available");
        }
        const apiModule = await import("/wasm/js/konclude_wasm_api.js");
        const api = await apiModule.createKoncludeApi(window.createKoncludeModule, {
          locateFile: (p) => `${window.location.origin}/wasm/dist/mt/${p}`,
          print: (...args) => console.log("[wasm-print]", ...args),
          printErr: (...args) => console.error("[wasm-err]", ...args),
        });
        const cfg = window.__tmpPerfConfig || {};
        if (typeof window.__tmpPerfApplyConfig === "function") {
          window.__tmpPerfApplyConfig(api, cfg);
        }
        if (!recycleArg) {
          window.__tmpPerfApi = api;
        }
        return api;
      };
      const api = await ensureApi();

      const inPath = `/tmp/ofn-in-${idxArg}.ofn`;
      const outPath = `/tmp/ofn-out-${idxArg}.txt`;
      const heapBytesBefore = api.module.HEAP8?.buffer?.byteLength || 0;
      api.module.FS.writeFile(inPath, inputTextArg);
      const jobId = api.submitJob("consistency", inPath, outPath);
      if (jobId <= 0) {
        return {
          ok: false,
          error: "submit failed",
          elapsedMs: 0,
          timeoutMs: timeoutMsArg,
          heapBytesBefore,
          heapBytesAfter: api.module.HEAP8?.buffer?.byteLength || heapBytesBefore,
        };
      }

      const start = performance.now();
      try {
        const wait = await api.waitForJob(jobId, {
          timeoutMs: timeoutMsArg,
          intervalMs: 10,
          tickMs: 5,
        });
        let raw = "";
        try {
          raw = api.module.FS.readFile(outPath, { encoding: "utf8" }).trim().toLowerCase();
        } catch {
          raw = "";
        }
        const value = raw === "true" ? true : raw === "false" ? false : null;
        return {
          ok: wait.status === 1 && wait.code === 0 && value !== null,
          status: wait.status,
          code: wait.code,
          raw,
          value,
          elapsedMs: Math.round(performance.now() - start),
          timeoutMs: timeoutMsArg,
          heapBytesBefore,
          heapBytesAfter: api.module.HEAP8?.buffer?.byteLength || heapBytesBefore,
        };
      } catch (err) {
        return {
          ok: false,
          timeout: true,
          error: String(err),
          elapsedMs: Math.round(performance.now() - start),
          timeoutMs: timeoutMsArg,
          heapBytesBefore,
          heapBytesAfter: api.module.HEAP8?.buffer?.byteLength || heapBytesBefore,
        };
      } finally {
        try {
          api.module.FS.unlink(inPath);
        } catch {}
        try {
          api.module.FS.unlink(outPath);
        } catch {}
        api.jobFree(jobId);
        if (recycleArg && api.dispose) {
          try {
            api.dispose();
          } catch {}
        }
      }
    },
    { inputTextArg: inputText, idxArg: idx, timeoutMsArg: timeoutMs, recycleArg: recycleWasmPerCase }
  );
}

function fmtMs(ms) {
  return Number.isFinite(ms) ? `${ms.toFixed(2)}ms` : "n/a";
}

async function createPerfPage(browser, wasmRunConfig) {
  const page = await browser.newPage();
  page.setDefaultTimeout(maxTimeoutMs + 60000);
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      console.log(`[browser-error] ${msg.text()}`);
    }
  });
  await initWasmPage(page, wasmRunConfig);
  return page;
}

async function main() {
  if (!fs.existsSync(koncludePath)) {
    throw new Error(`Missing native binary: ${koncludePath}`);
  }
  fs.mkdirSync(nativeTmpDir, { recursive: true });

  const allCases = parseCases(casesFile);
  const begin = Math.max(0, startIdx);
  const availableCount = Math.max(0, allCases.length - begin);
  const caseLimit =
    Number.isFinite(requestedCaseLimit) && requestedCaseLimit > 0
      ? Math.min(requestedCaseLimit, availableCount)
      : availableCount;
  const cases = allCases.slice(begin, begin + caseLimit);
  const wasmIriConfig = buildWasmIriMappingConfig();
  const wasmRunConfig = {
    reservePolicy: process.env.WASM_RESERVE_POLICY || "0",
    wasmProcCount: process.env.WASM_PROC_COUNT || "",
    wasmWorkerCount: process.env.WASM_WORKER_COUNT || "",
    threadPoolReserve: process.env.WASM_BLOCK_POOL_RESERVE || "",
    iriMappingPath: wasmIriConfig.iriMappingPath,
    iriMappingText: wasmIriConfig.iriMappingText,
    iriMappingEntries: wasmIriConfig.iriMappingEntries,
  };

  console.log(
    `OFN compare config: cases=${caseLimit} startIdx=${begin} recycleWasmPerCase=${recycleWasmPerCase} pageRecycleInterval=${pageRecycleInterval} deltaFactor=${deltaFactor} timeoutRetries=${timeoutRetryCount} nativeIriMapping=${useNativeIriMapping && fs.existsSync(iriMappingFile)} wasmIriMapping=${Boolean(wasmRunConfig.iriMappingPath)}`
  );

  const server = spawn(process.execPath, [serverScript], {
    env: { ...process.env, PORT: String(port) },
    stdio: "inherit",
  });
  const cleanup = () => {
    if (!server.killed) server.kill("SIGTERM");
  };
  process.on("exit", cleanup);
  process.on("SIGINT", () => {
    cleanup();
    process.exit(1);
  });

  await waitForServer(`${baseUrl}/wasm/web/owl2-conformance.html`);

  const browser = await chromium.launch({ headless });
  let page = await createPerfPage(browser, wasmRunConfig);

  const rows = [];
  let timeoutCount = 0;

  for (let i = 0; i < cases.length; i += 1) {
    if (pageRecycleInterval > 0 && i > 0 && i % pageRecycleInterval === 0) {
      await page.close();
      page = await createPerfPage(browser, wasmRunConfig);
    }

    const c = cases[i];
    const globalIdx = begin + i;
    const native = runNative(c, globalIdx);

    let wasmTimeout = minTimeoutMs;
    if (Number.isFinite(native.elapsedMs)) {
      wasmTimeout = Math.max(minTimeoutMs, Math.ceil(native.elapsedMs * deltaFactor));
    }
    wasmTimeout = Math.min(wasmTimeout, maxTimeoutMs);

    let wasm = await runWasmCase(page, c, globalIdx, wasmTimeout);
    let timeoutRetriesUsed = 0;
    while (wasm.timeout && timeoutRetriesUsed < timeoutRetryCount) {
      timeoutRetriesUsed += 1;
      console.log(
        `[retry ${timeoutRetriesUsed}/${timeoutRetryCount}]#${globalIdx} ${c.id} timed out, retrying in fresh page`
      );
      await page.close();
      page = await createPerfPage(browser, wasmRunConfig);
      wasm = await runWasmCase(page, c, globalIdx, wasmTimeout);
    }
    const ratio = native.elapsedMs > 0 ? wasm.elapsedMs / native.elapsedMs : null;

    const expected = c.expect;
    const nativeCorrect = native.ok && native.value === expected;
    const wasmCorrect = wasm.ok && wasm.value === expected;
    const matchesNative = native.ok === wasm.ok && (!native.ok || native.value === wasm.value);

    const row = {
      idx: globalIdx,
      id: c.id,
      expect: expected,
      nativeMs: native.elapsedMs,
      wasmMs: wasm.elapsedMs,
      timeoutMs: wasmTimeout,
      ratio,
      nativeCorrect,
      wasmCorrect,
      wasmTimeout: Boolean(wasm.timeout),
      wasmHeapBefore: wasm.heapBytesBefore || 0,
      wasmHeapAfter: wasm.heapBytesAfter || 0,
      nativeError: native.error || null,
      wasmError: wasm.error || null,
      matchesNative,
      timeoutRetriesUsed,
    };
    rows.push(row);

    const ratioText = ratio == null ? "n/a" : `${ratio.toFixed(1)}x`;
    console.log(
      `[${i + 1}/${cases.length}]#${globalIdx} ${c.id} native=${fmtMs(native.elapsedMs)} wasm=${fmtMs(wasm.elapsedMs)} ratio=${ratioText} timeout=${wasmTimeout}ms nativeOk=${nativeCorrect} wasmOk=${wasmCorrect} heap=${Math.round((wasm.heapBytesAfter || 0) / (1024 * 1024))}MB`
    );

    if (wasm.timeout) {
      timeoutCount += 1;
      if (stopOnTimeout) {
        console.log("Stopping early due to WASM timeout.");
        break;
      }
    }
  }

  await page.close();
  await browser.close();
  cleanup();

  const attempted = rows.length;
  const ratios = rows.filter((r) => Number.isFinite(r.ratio)).map((r) => r.ratio);
  const maxRatio = ratios.length ? Math.max(...ratios) : null;
  const wasmBad = rows.filter((r) => !r.wasmCorrect).length;
  const nativeBad = rows.filter((r) => !r.nativeCorrect).length;
  const divergedCount = rows.filter((r) => !r.matchesNative).length;

  const summary = {
    attempted,
    startIdx: begin,
    caseLimit,
    timeoutCount,
    nativeBad,
    wasmBad,
    divergedCount,
    maxRatio,
    deltaFactor,
    minTimeoutMs,
    maxTimeoutMs,
    rows,
  };

  console.log("OFN_PERF_SUMMARY", JSON.stringify(summary, null, 2));

  if (timeoutCount > 0 || divergedCount > 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
