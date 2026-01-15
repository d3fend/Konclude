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
const mainParam = params.get("main");
const useMainThread = mainParam === null ? true : mainParam === "1";
const canUseThreads = window.crossOriginIsolated && typeof SharedArrayBuffer !== "undefined";
const mode = "mt";
const timeoutParam = params.has("timeoutMs") ? Number(params.get("timeoutMs")) : NaN;
const defaultTimeoutMs = datasetParam === "d3fend" ? 300000 : 120000;
const timeoutMs = Number.isFinite(timeoutParam) ? timeoutParam : defaultTimeoutMs;

modeEl.textContent = mode;
datasetEl.textContent = datasetParam;
console.log("konclude wasm smoke test starting", { mode, canUseThreads, dataset: datasetParam });

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
  crossOriginIsolated: window.crossOriginIsolated,
  classification: null,
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
  if (result.classification) {
    const sizeText = Number.isFinite(result.classification.outputSize)
      ? `${result.classification.outputSize} bytes`
      : "n/a";
    lines.push(
      `classification: status=${result.classification.status} code=${result.classification.code} time=${result.classification.elapsedMs}ms size=${sizeText}`
    );
    if (result.classification.outputSnippet) {
      lines.push("-- classify output snippet --");
      lines.push(result.classification.outputSnippet);
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
  window.__koncludeResult = {
    done: true,
    ok: Boolean(result.ok),
    mode,
    dataset: result.dataset || { name: datasetParam, version: null },
    crossOriginIsolated: window.crossOriginIsolated,
    classification: result.classification || null,
    consistency: result.consistency || null,
    output: summary,
    error: result.error || null,
  };
  statusEl.textContent = result.ok ? "ok" : "error";
  outputEl.textContent = summary || String(result.error || "");
  console.log("finalize", { ok: result.ok, error: result.error });
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
  setStatus("running mt on main thread");
  if (debug) {
    console.log("[konclude] runOnMainThread module ready");
  }

  const inPath = "in.owl.xml";
  moduleResolved.FS.writeFile(inPath, dataset.owlXml);

  const runJob = createJobRunner(moduleResolved);
  const classifyOutputPath = "classify.owl.xml";
  let classify = null;
  let consistency = null;
  let consistent = null;

  if (onlyParam !== "consistency") {
    if (debug) {
      console.log("[konclude] runOnMainThread submitting classification");
    }
    classify = await runJob("classification", inPath, classifyOutputPath, {
      timeoutMs,
      readBytes: 2048,
    });
  }

  if (onlyParam !== "classification") {
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

  const classifyOk = !classify || (classify.status === 1 && classify.code === 0);
  const consistencyOk =
    !consistency || (consistency.status === 1 && consistency.code === 0 && consistent);
  const ok = classifyOk && consistencyOk;
  const consistencyPayload = consistency ? { ...consistency, consistent } : null;

  finalize({
    ok,
    dataset: { name: dataset.name, label: dataset.label, version: dataset.meta?.version || null },
    classification: classify,
    consistency: consistencyPayload,
    error: ok ? null : "konclude classify/consistency failed",
  });
}

async function runInWorker(dataset) {
  if (!canUseThreads) {
    finalize({ ok: false, error: "SharedArrayBuffer not available (missing COOP/COEP)" });
    return;
  }
  if (typeof Worker !== "function") {
    finalize({ ok: false, error: "Worker not available" });
    return;
  }

  setStatus("running mt in worker");

  const workerUrl = new URL("./konclude_worker.js", import.meta.url);
  const worker = new Worker(workerUrl);
  const workerTimeout = Math.max(timeoutMs + 60000, 180000);
  const timeout = setTimeout(() => {
    worker.terminate();
    finalize({ ok: false, error: "worker timeout" });
  }, workerTimeout);

  worker.onmessage = (event) => {
    clearTimeout(timeout);
    const data = event.data || {};
    finalize({
      ok: Boolean(data.ok),
      dataset:
        data.dataset || { name: dataset.name, label: dataset.label, version: dataset.meta?.version || null },
      classification: data.classification || null,
      consistency: data.consistency || null,
      error: data.error || null,
    });
    worker.terminate();
  };

  worker.onerror = (err) => {
    clearTimeout(timeout);
    worker.terminate();
    finalize({ ok: false, error: err?.message || "worker failure" });
  };

  worker.postMessage({
    owlXml: dataset.owlXml,
    mode,
    debug,
    timeoutMs,
    only: onlyParam,
    dataset: { name: dataset.name, label: dataset.label, version: dataset.meta?.version || null },
  });
}

async function main() {
  setStatus("loading dataset");
  const dataset = await loadDataset(datasetParam);
  datasetEl.textContent = dataset.label || dataset.name;
  datasetVersionEl.textContent = dataset.meta?.version || "n/a";
  datasetSizeEl.textContent = `${dataset.sizeBytes} bytes`;

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
