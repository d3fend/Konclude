const statusEl = document.getElementById("status");
const modeEl = document.getElementById("mode");
const outputEl = document.getElementById("output");

const params = new URLSearchParams(window.location.search);
const forcedMode = params.get("mode");
const debug = params.get("debug") === "1";
const useMainThread = params.get("main") === "1";
const canUseThreads = window.crossOriginIsolated && typeof SharedArrayBuffer !== "undefined";
const mode = "mt";

modeEl.textContent = mode;
console.log("konclude wasm smoke test starting", { mode, canUseThreads });

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

window.__koncludeResult = {
  done: false,
  ok: false,
  mode,
  crossOriginIsolated: window.crossOriginIsolated,
  code: null,
  output: "",
  error: null,
};

function setStatus(message) {
  statusEl.textContent = message;
  console.log("status:", message);
}

function finalize(ok, code, output, error) {
  const trimmedOutput = output ? output.slice(0, 4000) : "";
  window.__koncludeResult = {
    done: true,
    ok: Boolean(ok),
    mode,
    crossOriginIsolated: window.crossOriginIsolated,
    code,
    output: trimmedOutput,
    error: error || null,
  };
  statusEl.textContent = ok ? "ok" : "error";
  outputEl.textContent = trimmedOutput || String(error || "");
  console.log("finalize", { ok, code, error });
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

async function initModule() {
  const baseUrl = new URL("../dist/mt/", import.meta.url);
  const scriptUrl = new URL("konclude_mt.js", baseUrl).toString();

  await loadScript(scriptUrl);
  if (typeof window.createKoncludeModule !== "function") {
    throw new Error("createKoncludeModule not found; ensure konclude_mt.js loaded");
  }

  let runtimeReady = false;
  const moduleOptions = {
    noInitialRun: true,
    locateFile: (path) => new URL(path, baseUrl).toString(),
    mainScriptUrlOrBlob: scriptUrl,
    print: (...args) => console.log("[konclude]", ...args),
    printErr: (...args) => console.error("[konclude]", ...args),
    onRuntimeInitialized: () => {
      runtimeReady = true;
      console.log("[konclude] runtime initialized");
    },
    monitorRunDependencies: (left) => console.log("[konclude] run dependencies", left),
  };

  const moduleInit = window.createKoncludeModule(moduleOptions);

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
      moduleResolved = await withTimeout(
        new Promise((resolve, reject) => {
          moduleInit.then(resolve, reject);
        }),
        "konclude module init timeout"
      );
    }
  }

  if (!runtimeReady && !moduleResolved?.calledRun) {
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
  }

  return moduleResolved;
}

async function runClassify(moduleResolved, owlXml) {
  const submitClassify = moduleResolved.cwrap("konclude_submit_classify_files", "number", ["string", "string"]);
  const jobStatus = moduleResolved.cwrap("konclude_job_status", "number", ["number"]);
  const jobExitCode = moduleResolved.cwrap("konclude_job_exit_code", "number", ["number"]);
  const jobFree = moduleResolved.cwrap("konclude_job_free", null, ["number"]);
  const tick = moduleResolved.cwrap("konclude_tick", null, ["number"]);

  const inPath = "in.owl.xml";
  const outPath = "out.owl.xml";
  moduleResolved.FS.writeFile(inPath, owlXml);

  const jobId = submitClassify(inPath, outPath);
  if (jobId <= 0) {
    throw new Error("failed to submit job");
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
          size = moduleResolved.FS.stat(outPath).size;
        } catch {
          size = null;
        }
        console.log("job status", { status, size });
      }
      if (Date.now() - start > 120000) {
        jobFree(jobId);
        throw new Error("konclude job timeout");
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  const code = jobExitCode(jobId);
  let output = "";
  try {
    output = moduleResolved.FS.readFile(outPath, { encoding: "utf8" });
  } catch (readErr) {
    console.warn("failed to read output", readErr);
  }
  jobFree(jobId);

  return { status, code, output };
}

async function runOnMainThread() {
  if (!canUseThreads) {
    finalize(false, -1, "", "SharedArrayBuffer not available (missing COOP/COEP)");
    return;
  }

  setStatus("loading module");
  const moduleResolved = await initModule();
  setStatus("running mt on main thread");

  const { status, code, output } = await runClassify(moduleResolved, OWL_XML);
  const ok = status === 1 && code === 0 && output.includes("Ontology");
  finalize(ok, code, output, ok ? null : "konclude classify failed");
}

async function runInWorker() {
  if (!canUseThreads) {
    finalize(false, -1, "", "SharedArrayBuffer not available (missing COOP/COEP)");
    return;
  }
  if (typeof Worker !== "function") {
    finalize(false, -1, "", "Worker not available");
    return;
  }

  setStatus("running mt in worker");

  const workerUrl = new URL("./konclude_worker.js", import.meta.url);
  const worker = new Worker(workerUrl);
  const timeout = setTimeout(() => {
    worker.terminate();
    finalize(false, -1, "", "worker timeout");
  }, 180000);

  worker.onmessage = (event) => {
    clearTimeout(timeout);
    const data = event.data || {};
    finalize(data.ok, data.code ?? -1, data.output || "", data.error || null);
    worker.terminate();
  };

  worker.onerror = (err) => {
    clearTimeout(timeout);
    worker.terminate();
    finalize(false, -1, "", err?.message || "worker failure");
  };

  worker.postMessage({ owlXml: OWL_XML, mode, debug });
}

setStatus("starting");
if (forcedMode && forcedMode !== "mt") {
  finalize(false, -1, "", "only mt mode is supported");
} else if (!canUseThreads) {
  finalize(false, -1, "", "SharedArrayBuffer not available (missing COOP/COEP)");
} else if (useMainThread) {
  runOnMainThread().catch((err) => finalize(false, -1, "", err?.message || "main thread failure"));
} else {
  runInWorker().catch((err) => finalize(false, -1, "", err?.message || "worker failure"));
}
