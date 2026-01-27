const statusEl = document.getElementById("status");
const modeEl = document.getElementById("mode");
const outputEl = document.getElementById("output");
const datasetEl = document.getElementById("dataset");
const datasetVersionEl = document.getElementById("datasetVersion");
const datasetSizeEl = document.getElementById("datasetSize");

const params = new URLSearchParams(window.location.search);
const forcedMode = params.get("mode");
const datasetParam = params.get("dataset") || "sample";
const onlyParam = params.get("only");
const debug = params.get("debug") === "1";
const profileParam = params.get("profile");
const workersParam = params.get("workers");
const parallelParam = params.get("parallel");
const mainParam = params.get("main");
const useMainThread = mainParam === null ? true : mainParam === "1";
const sharedArrayBufferAvailable = typeof SharedArrayBuffer !== "undefined";
const canUseThreads = window.crossOriginIsolated && sharedArrayBufferAvailable;
const hardwareConcurrency = Number.isFinite(navigator?.hardwareConcurrency)
  ? navigator.hardwareConcurrency
  : null;
const mode = "mt";
const timeoutParam = params.has("timeoutMs") ? Number(params.get("timeoutMs")) : NaN;
let timeoutMs = Number.isFinite(timeoutParam) ? timeoutParam : null;
window.__koncludeRuntimeTimeoutMs = Number.isFinite(timeoutMs) ? timeoutMs : null;

modeEl.textContent = mode;
datasetEl.textContent = datasetParam;
console.log("konclude wasm smoke test starting", {
  mode,
  canUseThreads,
  dataset: datasetParam,
  hardwareConcurrency,
});

const OWL_XML = `<?xml version="1.0"?>
<Ontology xmlns="http://www.w3.org/2002/07/owl#"
    xml:base="http://example.com/konclude-test"
    xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
    xmlns:owl="http://www.w3.org/2002/07/owl#"
    xmlns:xml="http://www.w3.org/XML/1998/namespace"
    xmlns:xsd="http://www.w3.org/2001/XMLSchema#"
    xmlns:rdfs="http://www.w3.org/2000/01/rdf-schema#"
    ontologyIRI="http://example.com/konclude-test">
  <Declaration><Class IRI="#A"/></Declaration>
  <Declaration><Class IRI="#B"/></Declaration>
  <Declaration><Class IRI="#C"/></Declaration>
  <SubClassOf><Class IRI="#A"/><Class IRI="#B"/></SubClassOf>
  <SubClassOf><Class IRI="#B"/><Class IRI="#C"/></SubClassOf>
</Ontology>`;

const DATASETS = {
  sample: {
    label: "sample",
    type: "inline",
    owlXml: OWL_XML,
  },
  d3fend: {
    label: "d3fend-tbox",
    type: "fetch",
    url: new URL("./ontologies/d3fend.tbox.owl.xml", import.meta.url).toString(),
    metaUrl: new URL("./ontologies/d3fend.tbox.meta.json", import.meta.url).toString(),
  },
  "d3fend-full": {
    label: "d3fend-full",
    type: "fetch",
    url: new URL("./ontologies/d3fend.owl.xml", import.meta.url).toString(),
    metaUrl: new URL("./ontologies/d3fend.meta.json", import.meta.url).toString(),
  },
};

window.__koncludeResult = {
  done: false,
  ok: false,
  mode,
  dataset: { name: datasetParam, version: null },
  profile: null,
  crossOriginIsolated: window.crossOriginIsolated,
  runtime: {
    canUseThreads,
    crossOriginIsolated: window.crossOriginIsolated,
    sharedArrayBuffer: sharedArrayBufferAvailable,
    hardwareConcurrency,
  },
  config: null,
  classification: null,
  realization: null,
  consistency: null,
  output: "",
  error: null,
};

function setStatus(message) {
  statusEl.textContent = message;
  console.log("status:", message);
}

function formatResult(result) {
  const lines = [];
  if (result.dataset) {
    const versionText = result.dataset.version ? ` (${result.dataset.version})` : "";
    const label = result.dataset.label || result.dataset.name;
    lines.push(`dataset: ${label}${versionText}`);
  }
  if (result.profile) {
    lines.push(`profile: ${result.profile}`);
  }
  if (result.runtime) {
    const hwText =
      Number.isFinite(result.runtime.hardwareConcurrency) && result.runtime.hardwareConcurrency > 0
        ? result.runtime.hardwareConcurrency
        : "n/a";
    lines.push(
      `runtime: threads=${result.runtime.canUseThreads ? "enabled" : "disabled"} crossOriginIsolated=${Boolean(
        result.runtime.crossOriginIsolated
      )} sharedArrayBuffer=${Boolean(result.runtime.sharedArrayBuffer)} hw=${hwText}`
    );
  }
  if (result.config) {
    const workersText = Number.isFinite(result.config.workers) ? result.config.workers : "default";
    const parallelText = Number.isFinite(result.config.parallel) ? result.config.parallel : "default";
    const precomputeText = Number.isFinite(result.config.precomputeParallel)
      ? result.config.precomputeParallel
      : "default";
    const batchText = Number.isFinite(result.config.precomputeBatch) ? result.config.precomputeBatch : "default";
    const poolText = Number.isFinite(result.config.threadPoolMax) ? result.config.threadPoolMax : "default";
    lines.push(
      `config: workers=${workersText} parallel=${parallelText} precompute=${precomputeText} batch=${batchText} threadPoolMax=${poolText}`
    );
  }
  if (result.classification) {
    const sizeText = Number.isFinite(result.classification.outputSize)
      ? `${result.classification.outputSize} bytes`
      : "n/a";
    lines.push(
      `classification: status=${result.classification.status} code=${result.classification.code} time=${result.classification.elapsedMs}ms size=${sizeText}`
    );
    const snippet = result.classification.outputSnippet || result.classification.output;
    if (snippet) {
      lines.push("-- classify output snippet --");
      lines.push(snippet);
    }
  }
  if (result.realization) {
    const sizeText = Number.isFinite(result.realization.outputSize)
      ? `${result.realization.outputSize} bytes`
      : "n/a";
    lines.push(
      `realization: status=${result.realization.status} code=${result.realization.code} time=${result.realization.elapsedMs}ms size=${sizeText}`
    );
    const snippet = result.realization.outputSnippet || result.realization.output;
    if (snippet) {
      lines.push("-- realization output snippet --");
      lines.push(snippet);
    }
  }
  if (result.consistency) {
    const consistentText = result.consistency.consistent ? "true" : "false";
    const sourceText = result.consistency.source ? ` source=${result.consistency.source}` : "";
    lines.push(
      `consistency: status=${result.consistency.status} code=${result.consistency.code} time=${result.consistency.elapsedMs}ms result=${consistentText}${sourceText}`
    );
    if (result.consistency.output) {
      lines.push("-- consistency output --");
      lines.push(result.consistency.output.trim());
    }
  }
  if (result.error) {
    lines.push("-- error --");
    lines.push(String(result.error));
  }
  return lines.join("\n");
}

function finalize(result) {
  const summary = formatResult(result);
  const runtime = result.runtime
    ? { ...window.__koncludeResult.runtime, ...result.runtime }
    : window.__koncludeResult.runtime;
  window.__koncludeResult = {
    done: true,
    ok: Boolean(result.ok),
    mode,
    dataset: result.dataset || { name: datasetParam, version: null },
    profile: result.profile || null,
    crossOriginIsolated: window.crossOriginIsolated,
    runtime,
    config: result.config || null,
    classification: result.classification || null,
    realization: result.realization || null,
    consistency: result.consistency || null,
    output: summary,
    error: result.error || null,
  };
  statusEl.textContent = result.ok ? "ok" : "error";
  outputEl.textContent = summary || String(result.error || "");
  console.log("finalize", { ok: result.ok, error: result.error });
}

function selectProfile(dataset) {
  if (profileParam && profileParam !== "auto") {
    return profileParam;
  }
  if (dataset?.meta?.profile) {
    return dataset.meta.profile;
  }
  if (dataset && dataset.sizeBytes > 2 * 1024 * 1024) {
    return "large";
  }
  return "default";
}

function resolveTimeoutMs(dataset) {
  if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
    return timeoutMs;
  }
  if (dataset?.meta?.timeout_ms) {
    return dataset.meta.timeout_ms;
  }
  if (dataset?.sizeBytes && dataset.sizeBytes > 2 * 1024 * 1024) {
    return 300000;
  }
  return 120000;
}

const parallelOverrideRaw = Number.parseInt(parallelParam || "", 10);
const parallelOverride = Number.isFinite(parallelOverrideRaw) && parallelOverrideRaw > 0 ? parallelOverrideRaw : null;

function applyParallelOverride(overrides, parallelOverrideValue) {
  const parallel = Number.parseInt(String(parallelOverrideValue), 10);
  if (!Number.isFinite(parallel) || parallel <= 0) {
    return;
  }
  const parallelCount = Math.max(1, parallel);
  overrides["Konclude.Calculation.Classification.MaximumParallelSubsumptionCalculationCount"] = String(parallelCount);
  overrides["Konclude.Calculation.Classification.OptimizedKPSetClassSubsumptionClassifier.MaximumParallelSatisfiableCalculationCount"] =
    String(parallelCount);
  overrides["Konclude.Calculation.Classification.OptimizedKPSetClassSubsumptionClassifier.MultipliedUnitsParallelSatisfiableCalculationCount"] =
    "1";
  overrides["Konclude.Calculation.Classification.OptimizedSubClassSubsumptionClassifier.MaximumParallelSatisfiableCalculationCount"] =
    String(parallelCount);
  overrides["Konclude.Calculation.Classification.OptimizedSubClassSubsumptionClassifier.MultipliedUnitsParallelSatisfiableCalculationCount"] =
    "1";
  overrides["Konclude.Calculation.Precomputation.TotalPrecomputor.MaximumParallelCalculationCount"] = String(parallelCount);
  overrides["Konclude.Calculation.Precomputation.TotalPrecomputor.MultipliedUnitsParallelCalculationCount"] = "1";
  overrides["Konclude.Calculation.Precomputation.TotalPrecomputor.MaximumBatchJobCreationCount"] = String(parallelCount);
}

function resolveProfileDefaults(profile, dataset) {
  if (profile !== "d3fend" && profile !== "large") {
    return {};
  }
  const sizeBytes = Number.isFinite(dataset?.sizeBytes) ? dataset.sizeBytes : 0;
  const isFull =
    dataset?.name === "d3fend-full" ||
    dataset?.label === "d3fend-full" ||
    sizeBytes > 6 * 1024 * 1024;
  const hw = Number.isFinite(hardwareConcurrency) && hardwareConcurrency > 0 ? hardwareConcurrency : null;
  const workerCap = isFull ? 8 : 16;
  const workers = hw ? Math.min(workerCap, hw) : workerCap;
  return { workers, parallel: 2 };
}

function resolveWorkersOverride(workersOverride, defaults) {
  const parsed = Number.parseInt(workersOverride || "", 10);
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }
  if (Number.isFinite(defaults.workers) && defaults.workers > 0) {
    return defaults.workers;
  }
  return null;
}

function resolveParallelOverride(parallelOverrideValue, defaults) {
  if (Number.isFinite(parallelOverrideValue) && parallelOverrideValue > 0) {
    return parallelOverrideValue;
  }
  if (Number.isFinite(defaults.parallel) && defaults.parallel > 0) {
    return defaults.parallel;
  }
  return null;
}

function applyLoggingDefaults(overrides) {
  if (debug) {
    return;
  }
  overrides["Konclude.Logging.MinLoggingLevel"] = "60";
  overrides["Konclude.Logging.MaxLogMessageCount"] = "2000";
}

function applyWorkerOverride(overrides, workersOverride) {
  const workers = Number.parseInt(workersOverride || "", 10);
  if (Number.isFinite(workers) && workers > 0) {
    const maxCores = Number.isFinite(hardwareConcurrency) ? hardwareConcurrency : null;
    const cappedWorkers = maxCores ? Math.min(workers, maxCores) : workers;
    if (cappedWorkers !== workers) {
      console.warn("capping workers to", cappedWorkers);
    }
    overrides["Konclude.Calculation.ProcessorCount"] = String(cappedWorkers);
    overrides["Konclude.Calculation.WorkerCount"] = String(cappedWorkers);
  }
}

function buildOverrides(workersOverride, parallelOverrideValue, profile, dataset) {
  const defaults = resolveProfileDefaults(profile, dataset);
  const overrides = {};
  const resolvedWorkers = resolveWorkersOverride(workersOverride, defaults);
  if (resolvedWorkers) {
    applyWorkerOverride(overrides, resolvedWorkers);
  }
  const resolvedParallel = resolveParallelOverride(parallelOverrideValue, defaults);
  if (resolvedParallel) {
    applyParallelOverride(overrides, resolvedParallel);
  }
  applyLoggingDefaults(overrides);
  return overrides;
}

function summarizeOverrides(profile, overrides) {
  const getNumber = (key) => {
    if (!overrides || !(key in overrides)) {
      return null;
    }
    const value = Number.parseInt(String(overrides[key]), 10);
    return Number.isFinite(value) ? value : null;
  };
  const config = {
    profile,
    workers:
      getNumber("Konclude.Calculation.ProcessorCount") ??
      getNumber("Konclude.Calculation.WorkerCount"),
    parallel: getNumber("Konclude.Calculation.Classification.MaximumParallelSubsumptionCalculationCount"),
    precomputeParallel: getNumber("Konclude.Calculation.Precomputation.TotalPrecomputor.MaximumParallelCalculationCount"),
    precomputeBatch: getNumber("Konclude.Calculation.Precomputation.TotalPrecomputor.MaximumBatchJobCreationCount"),
    threadPoolMax: getNumber("Konclude.Calculation.ThreadPoolMaxCount"),
  };
  return config;
}

function applyWasmOverrides(moduleResolved, overrides) {
  if (!overrides || !moduleResolved || typeof moduleResolved.cwrap !== "function") {
    return;
  }
  let setConfig = null;
  let resetConfig = null;
  try {
    setConfig = moduleResolved.cwrap("konclude_set_config", "number", ["string", "string"]);
    resetConfig = moduleResolved.cwrap("konclude_reset_config_overrides", "number", []);
  } catch (err) {
    console.warn("konclude config overrides not available", err);
    return;
  }
  if (!setConfig || !resetConfig) {
    return;
  }
  resetConfig();
  for (const [key, value] of Object.entries(overrides)) {
    setConfig(key, String(value));
  }
}

function applyProfileOverrides(moduleResolved, dataset) {
  const profile = selectProfile(dataset);
  const overrides = buildOverrides(workersParam, parallelOverride, profile, dataset);
  if (debug) {
    console.log("[konclude] applying profile", { profile, overrides });
  }
  applyWasmOverrides(moduleResolved, overrides);
  return { profile, overrides, config: summarizeOverrides(profile, overrides) };
}

function loadScript(url) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = url;
    script.onload = () => resolve();
    script.onerror = (err) => reject(err);
    document.head.appendChild(script);
  });
}

async function loadDataset(name) {
  const dataset = DATASETS[name];
  if (!dataset) {
    throw new Error(`unknown dataset: ${name}`);
  }

  let owlXml = dataset.owlXml;
  if (!owlXml) {
    const res = await fetch(dataset.url);
    if (!res.ok) {
      throw new Error(`failed to fetch dataset ${name}: ${res.status}`);
    }
    owlXml = await res.text();
  }

  let meta = null;
  if (dataset.metaUrl) {
    try {
      const metaRes = await fetch(dataset.metaUrl);
      if (metaRes.ok) {
        meta = await metaRes.json();
      }
    } catch (err) {
      console.warn("failed to load dataset metadata", err);
    }
  }

  return {
    name,
    label: dataset.label || name,
    owlXml,
    meta,
    sizeBytes: owlXml.length,
  };
}

async function initModule() {
  const baseUrl = new URL("../dist/mt/", import.meta.url);
  const scriptUrl = new URL("konclude_mt.js", baseUrl).toString();

  if (debug) {
    console.log("[konclude] initModule starting", { scriptUrl });
  }
  await loadScript(scriptUrl);
  if (typeof window.createKoncludeModule !== "function") {
    throw new Error("createKoncludeModule not found; ensure konclude_mt.js loaded");
  }

  let runtimeReady = false;
  let moduleRef = null;
  const exceptionState = { typePtr: null, mangled: null };
  const textDecoder = new TextDecoder("utf-8");
  const readCString = (heapU8, ptr, maxBytes = 512) => {
    if (!ptr || !heapU8) return "";
    let end = ptr;
    const max = Math.min(heapU8.length, ptr + maxBytes);
    while (end < max && heapU8[end] !== 0) {
      end += 1;
    }
    // TextDecoder does not accept views backed by SharedArrayBuffer in some browsers.
    const copy = heapU8.slice(ptr, end);
    return textDecoder.decode(copy);
  };
  const moduleOptions = {
    noInitialRun: true,
    noExitRuntime: true,
    locateFile: (path) => new URL(path, baseUrl).toString(),
    mainScriptUrlOrBlob: scriptUrl,
    print: (...args) => {
      if (!debug && typeof args[0] === "string" && args[0].includes("[konclude wasm]")) {
        return;
      }
      console.log("[konclude]", ...args);
    },
    printErr: (...args) => {
      if (!debug && typeof args[0] === "string" && args[0].includes("[konclude wasm]")) {
        return;
      }
      if (debug) {
        const msg = typeof args[0] === "string" ? args[0] : "";
        const match = msg.match(/Compiled code throwing an exception, (\d+),(\d+),(\d+)/);
        if (match) {
          const typePtr = Number(match[2]);
          exceptionState.typePtr = Number.isFinite(typePtr) ? typePtr : null;
          if (moduleRef && exceptionState.typePtr) {
            const namePtr = moduleRef.HEAPU32[(exceptionState.typePtr + 4) >> 2];
            exceptionState.mangled = readCString(moduleRef.HEAPU8, namePtr);
            console.log("[konclude] exception type", {
              ptr: Number(match[1]),
              typePtr: exceptionState.typePtr,
              mangled: exceptionState.mangled,
            });
          }
        }
      }
      console.log("[konclude]", ...args);
    },
    onRuntimeInitialized: () => {
      runtimeReady = true;
      console.log("[konclude] runtime initialized");
    },
    monitorRunDependencies: (left) => console.log("[konclude] run dependencies", left),
  };

  const moduleInit = window.createKoncludeModule(moduleOptions);
  if (debug) {
    console.log("[konclude] initModule createKoncludeModule returned", {
      hasThen: typeof moduleInit?.then === "function",
      hasCwrap: typeof moduleInit?.cwrap === "function",
    });
  }

  const withTimeout = (promise, label) =>
    new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(label)), 120000);
      Promise.resolve(promise)
        .then((value) => {
          clearTimeout(timeout);
          resolve(value);
        })
        .catch((err) => {
          clearTimeout(timeout);
          reject(err);
        });
    });

  let moduleResolved = moduleInit;
  if (!moduleResolved || typeof moduleResolved.cwrap !== "function") {
    if (moduleInit && typeof moduleInit.then === "function") {
      if (debug) {
        console.log("[konclude] initModule awaiting module promise");
      }
      moduleResolved = await withTimeout(
        new Promise((resolve, reject) => {
          moduleInit.then(resolve, reject);
        }),
        "konclude module init timeout"
      );
      if (debug) {
        console.log("[konclude] initModule module promise resolved");
      }
    }
  }

  if (!runtimeReady && !moduleResolved?.calledRun) {
    if (debug) {
      console.log("[konclude] initModule waiting for runtime");
    }
    await withTimeout(
      new Promise((resolve) => {
        const checkReady = () => {
          if (runtimeReady || moduleResolved?.calledRun) {
            resolve();
            return;
          }
          setTimeout(checkReady, 10);
        };
        checkReady();
      }),
      "konclude module runtime timeout"
    );
    if (debug) {
      console.log("[konclude] initModule runtime ready");
    }
  }

  if (moduleResolved && typeof moduleResolved.then === "function") {
    try {
      moduleResolved.then = undefined;
    } catch (err) {
      if (debug) {
        console.warn("[konclude] initModule unable to clear thenable", err);
      }
    }
  }

  if (debug) {
    console.log("[konclude] initModule ready");
  }
  moduleRef = moduleResolved;
  if (debug && exceptionState.typePtr && !exceptionState.mangled && moduleRef?.HEAPU8) {
    const namePtr = moduleRef.HEAPU32[(exceptionState.typePtr + 4) >> 2];
    exceptionState.mangled = readCString(moduleRef.HEAPU8, namePtr);
    console.log("[konclude] exception type", {
      typePtr: exceptionState.typePtr,
      mangled: exceptionState.mangled,
    });
  }
  return moduleResolved;
}

function readFileSnippet(moduleResolved, path, maxBytes) {
  let stream = null;
  try {
    stream = moduleResolved.FS.open(path, "r");
    const buffer = new Uint8Array(maxBytes);
    const bytesRead = moduleResolved.FS.read(stream, buffer, 0, maxBytes, 0);
    const decoder = new TextDecoder("utf-8");
    return decoder.decode(buffer.slice(0, bytesRead));
  } catch (err) {
    console.warn("failed to read output snippet", err);
    return "";
  } finally {
    if (stream) {
      try {
        moduleResolved.FS.close(stream);
      } catch {
        // ignore
      }
    }
  }
}

function createJobRunner(moduleResolved) {
  const submitJob = moduleResolved.cwrap("konclude_submit_job", "number", ["string", "string", "string"]);
  const jobStatus = moduleResolved.cwrap("konclude_job_status", "number", ["number"]);
  const jobExitCode = moduleResolved.cwrap("konclude_job_exit_code", "number", ["number"]);
  const jobFree = moduleResolved.cwrap("konclude_job_free", null, ["number"]);
  const tick = moduleResolved.cwrap("konclude_tick", null, ["number"]);

  return async function runJob(command, inputPath, outputPath, { timeoutMs: jobTimeoutMs, readBytes } = {}) {
    const jobId = submitJob(command, inputPath, outputPath);
    if (jobId <= 0) {
      throw new Error(`failed to submit ${command} job`);
    }
    if (debug) {
      console.log("[konclude] job submitted", { command, jobId, inputPath, outputPath });
    }

    let status = 0;
    const start = Date.now();
    let pollCount = 0;
    while (status === 0) {
      tick(5);
      status = jobStatus(jobId);
      if (status === 0) {
        if ((pollCount++ % 50) === 0) {
          let size = null;
          try {
            size = moduleResolved.FS.stat(outputPath).size;
          } catch {
            size = null;
          }
          console.log("job status", { command, status, size });
        }
        if (Date.now() - start > jobTimeoutMs) {
          jobFree(jobId);
          throw new Error(`konclude ${command} job timeout`);
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }

    const code = jobExitCode(jobId);
    let output = "";
    let outputSize = null;
    try {
      outputSize = moduleResolved.FS.stat(outputPath).size;
      if (readBytes && outputSize > 0) {
        output = readFileSnippet(moduleResolved, outputPath, readBytes);
      }
    } catch (readErr) {
      console.warn("failed to read output", readErr);
    }

    jobFree(jobId);

    return {
      status,
      code,
      output,
      outputSize,
      elapsedMs: Date.now() - start,
    };
  };
}

function consistencySidecarFor(classifyPath) {
  return `${classifyPath}.consistency.txt`;
}

function readConsistencySidecar(moduleResolved, sidecarPath) {
  try {
    const stat = moduleResolved.FS.stat(sidecarPath);
    if (!stat || stat.size <= 0) {
      return null;
    }
    const output = readFileSnippet(moduleResolved, sidecarPath, 256);
    const normalized = output.trim().toLowerCase();
    const consistent = normalized === "true";
    return {
      status: 1,
      code: 0,
      output,
      outputSize: stat.size,
      elapsedMs: 0,
      consistent,
      source: "classification",
    };
  } catch {
    return null;
  }
}

async function runOnMainThread(dataset) {
  if (!canUseThreads) {
    finalize({ ok: false, error: "SharedArrayBuffer not available (missing COOP/COEP)" });
    return;
  }

  setStatus("loading module");
  if (debug) {
    console.log("[konclude] runOnMainThread loading module");
  }
  const moduleResolved = await initModule();
  const profileInfo = applyProfileOverrides(moduleResolved, dataset);
  setStatus("running mt on main thread");
  if (debug) {
    console.log("[konclude] runOnMainThread module ready");
  }

  const inPath = "in.owl.xml";
  moduleResolved.FS.writeFile(inPath, dataset.owlXml);

  const runJob = createJobRunner(moduleResolved);
  const classifyOutputPath = "classify.owl.xml";
  let classify = null;
  let realization = null;
  let consistency = null;
  let consistent = null;

  if (onlyParam !== "consistency" && onlyParam !== "realization" && onlyParam !== "realisation") {
    if (debug) {
      console.log("[konclude] runOnMainThread submitting classification");
    }
    classify = await runJob("classification", inPath, classifyOutputPath, {
      timeoutMs,
      readBytes: 2048,
    });
  }

  if (onlyParam !== "classification" && onlyParam !== "realization" && onlyParam !== "realisation") {
    if (classify) {
      consistency = readConsistencySidecar(moduleResolved, consistencySidecarFor(classifyOutputPath));
      if (consistency) {
        consistent = consistency.consistent;
      }
    }
    if (!consistency) {
      consistency = await runJob("consistency", inPath, "consistency.txt", {
        timeoutMs,
        readBytes: 256,
      });
      consistent = consistency.output.trim().toLowerCase() === "true";
    }
  }

  if (onlyParam === "realization" || onlyParam === "realisation") {
    if (debug) {
      console.log("[konclude] runOnMainThread submitting realization");
    }
    realization = await runJob("realization", inPath, "realize.owl.xml", {
      timeoutMs,
      readBytes: 2048,
    });
  }

  const classifyOk = !classify || (classify.status === 1 && classify.code === 0);
  const realizationOk = !realization || (realization.status === 1 && realization.code === 0);
  const consistencyOk =
    !consistency || (consistency.status === 1 && consistency.code === 0 && consistent);
  const ok = classifyOk && consistencyOk && realizationOk;
  const consistencyPayload = consistency ? { ...consistency, consistent } : null;

  finalize({
    ok,
    dataset: { name: dataset.name, label: dataset.label, version: dataset.meta?.version || null },
    profile: profileInfo?.profile || null,
    config: profileInfo?.config || null,
    classification: classify,
    realization,
    consistency: consistencyPayload,
    error: ok ? null : "konclude job failed",
  });
}

async function runInWorker(dataset) {
  console.warn("worker runner is not reliable in Qt 5.15 wasm; falling back to main thread");
  setStatus("worker unsupported; running on main thread");
  await runOnMainThread(dataset);
}

async function main() {
  setStatus("loading dataset");
  const dataset = await loadDataset(datasetParam);
  datasetEl.textContent = dataset.label || dataset.name;
  datasetVersionEl.textContent = dataset.meta?.version || "n/a";
  datasetSizeEl.textContent = `${dataset.sizeBytes} bytes`;
  timeoutMs = resolveTimeoutMs(dataset);
  window.__koncludeRuntimeTimeoutMs = timeoutMs;

  setStatus("starting");
  if (forcedMode && forcedMode !== "mt") {
    finalize({ ok: false, error: "only mt mode is supported" });
  } else if (!canUseThreads) {
    finalize({ ok: false, error: "SharedArrayBuffer not available (missing COOP/COEP)" });
  } else if (useMainThread) {
    await runOnMainThread(dataset);
  } else {
    await runInWorker(dataset);
  }
}

main().catch((err) => finalize({ ok: false, error: err?.message || "startup failure" }));
