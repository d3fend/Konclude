const statusEl = document.getElementById("status");
const modeEl = document.getElementById("mode");
const outputEl = document.getElementById("output");

const params = new URLSearchParams(window.location.search);
const forcedMode = params.get("mode");
const debug = params.get("debug") === "1";
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

async function runInWorker(selectedMode) {
  if (!canUseThreads) {
    finalize(false, -1, "", "SharedArrayBuffer not available (missing COOP/COEP)");
    return;
  }

  setStatus(`running ${selectedMode} in worker`);
  console.log("spawning worker", selectedMode);
  const worker = new Worker(new URL("./konclude_worker.js", import.meta.url));

  worker.onmessage = (event) => {
    const { ok, code, output, error } = event.data || {};
    console.log("worker message", { ok, code, error });
    finalize(ok, code, output || "", error);
    worker.terminate();
  };

  worker.onerror = (err) => {
    console.error("worker error", err);
    finalize(false, -1, "", err?.message || "worker error");
    worker.terminate();
  };

  console.log("posting work to worker");
  worker.postMessage({ mode: selectedMode, owlXml: OWL_XML, debug });
}

setStatus("starting");
if (forcedMode && forcedMode !== "mt") {
  finalize(false, -1, "", "only mt mode is supported");
} else if (!canUseThreads) {
  finalize(false, -1, "", "SharedArrayBuffer not available (missing COOP/COEP)");
} else {
  runInWorker(mode).catch((err) => finalize(false, -1, "", err?.message || "worker failure"));
}
