const { chromium } = require("playwright");
const { spawn } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..", "..");
const testsDir = path.join(repoRoot, "Tests");
const koncludePath = path.join(repoRoot, "Release", "Konclude");
const outputDir = path.join(__dirname, "perf-out");
const nativeOutDir = path.join(outputDir, "native");
const wasmOutDir = path.join(outputDir, "wasm");
const serverScript = path.resolve(repoRoot, "wasm", "scripts", "serve_coop_coep.js");
const compareScript = path.resolve(__dirname, "compare_owl_outputs.py");

const port = Number(process.env.PORT || 8000);
const baseUrl = `http://localhost:${port}`;
const timeoutMs = Number(process.env.TIMEOUT_MS || 600000);
const readBytesParam = process.env.WASM_READ_BYTES || "all";
const browsersHeadless = process.env.HEADLESS !== "0";
const nativeStdio = process.env.NATIVE_STDIO || "inherit";
const browserLog = process.env.BROWSER_LOG === "1";

const TASK_DEFS = {
  classification: {
    label: "classification",
    nativeCmd: "classification",
    wasmOnly: "classification",
    outputExt: ".owl.xml",
    type: "xml",
    compareClosure: true,
  },
  realization: {
    label: "realization",
    nativeCmd: "realization",
    wasmOnly: "realization",
    outputExt: ".owl.xml",
    type: "xml",
    compareClosure: false,
  },
  consistency: {
    label: "consistency",
    nativeCmd: "consistency",
    wasmOnly: "consistency",
    outputExt: ".txt",
    type: "text",
  },
};

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServer(url) {
  for (let i = 0; i < 60; i += 1) {
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

function listTestOntologies() {
  const entries = fs.readdirSync(testsDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".owl.xml"))
    .map((entry) => entry.name)
    .sort()
    .map((file) => {
      const name = file.replace(/\.owl\.xml$/, "");
      return {
        name,
        file,
        path: path.join(testsDir, file),
      };
    });
}

function parseThreadList() {
  const threadsEnv = process.env.THREADS || "1,2";
  const values = threadsEnv
    .split(",")
    .map((value) => Number.parseInt(value.trim(), 10))
    .filter((value) => Number.isFinite(value) && value > 0);
  const maxThreads = Number(process.env.MAX_THREADS || os.cpus().length || 1);
  return Array.from(new Set(values)).filter((value) => value <= maxThreads).sort((a, b) => a - b);
}

function parseTaskList() {
  const tasksEnv = process.env.TASKS || "classification";
  const tasks = tasksEnv
    .split(",")
    .map((task) => task.trim())
    .filter(Boolean);
  const unknown = tasks.filter((task) => !TASK_DEFS[task]);
  if (unknown.length) {
    throw new Error(`Unknown task(s): ${unknown.join(", ")}. Supported: ${Object.keys(TASK_DEFS).join(", ")}`);
  }
  return tasks.length ? tasks : ["classification"];
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function normalizeXml(text) {
  return text.replace(/>\s+</g, "><").trim();
}

function normalizeText(text) {
  return text.trim().toLowerCase();
}

async function runProcess(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, options);
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) {
        resolve(code);
      } else {
        reject(new Error(`${command} exited with code ${code}`));
      }
    });
  });
}

async function runNative(ontology, threads, task) {
  const def = TASK_DEFS[task];
  const outPath = path.join(nativeOutDir, `${ontology.name}.${task}.t${threads}${def.outputExt}`);
  const args = [def.nativeCmd, "-w", String(threads), "-i", ontology.path, "-o", outPath];
  const start = process.hrtime.bigint();
  await runProcess(koncludePath, args, { stdio: nativeStdio });
  const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
  const data = fs.readFileSync(outPath);
  const text = data.toString("utf8");
  const normalized = def.type === "xml" ? normalizeXml(text) : normalizeText(text);
  return {
    outputPath: outPath,
    outputSize: data.length,
    hash: sha256(data),
    normalizedHash: sha256(Buffer.from(normalized, "utf8")),
    normalizedValue: normalized,
    elapsedMs,
  };
}

function compareOutputs(nativePath, wasmPath) {
  if (!fs.existsSync(compareScript)) {
    return null;
  }
  try {
    const output = require("child_process")
      .execFileSync("python", [compareScript, nativePath, wasmPath], { encoding: "utf8" })
      .trim();
    if (!output) return null;
    return JSON.parse(output);
  } catch (err) {
    console.warn("compare_owl_outputs.py failed", err.message || err);
    return null;
  }
}

async function runWasm(page, dataset, threads, task) {
  const def = TASK_DEFS[task];
  const parallel = process.env.PARALLEL ? Number(process.env.PARALLEL) : threads;
  const params = new URLSearchParams({
    mode: "mt",
    dataset,
    workers: String(threads),
    parallel: String(parallel),
    timeoutMs: String(timeoutMs),
    readBytes: readBytesParam,
  });
  if (def?.wasmOnly) {
    params.set("only", def.wasmOnly);
  }
  const url = `${baseUrl}/web/index.html?${params.toString()}`;
  const startWall = Date.now();
  await page.goto(url, { waitUntil: "load" });

  await page.waitForFunction(
    () => window.__koncludeResult && window.__koncludeResult.done,
    { timeout: timeoutMs + 60000 }
  );

  const result = await page.evaluate(() => window.__koncludeResult);
  if (!result || !result.ok) {
    throw new Error(`WASM run failed for ${dataset} (threads=${threads}): ${JSON.stringify(result)}`);
  }
  const taskResult =
    task === "classification"
      ? result.classification
      : task === "realization"
        ? result.realization
        : result.consistency;
  if (!taskResult || taskResult.status !== 1 || taskResult.code !== 0) {
    throw new Error(`WASM ${task} failed for ${dataset} (threads=${threads}): ${JSON.stringify(taskResult)}`);
  }
  const output = taskResult.output || "";
  const elapsedMs = Number.isFinite(taskResult.elapsedMs) ? taskResult.elapsedMs : null;
  const wallMs = Date.now() - startWall;
  const normalized = def.type === "xml" ? normalizeXml(output) : normalizeText(output);
  return {
    output,
    outputSize: Number.isFinite(taskResult.outputSize)
      ? taskResult.outputSize
      : Buffer.byteLength(output, "utf8"),
    hash: sha256(Buffer.from(output, "utf8")),
    normalizedHash: sha256(Buffer.from(normalized, "utf8")),
    normalizedValue: normalized,
    elapsedMs,
    wallMs,
    runtime: result.runtime || null,
    consistent: taskResult.consistent ?? null,
  };
}

async function main() {
  ensureDir(nativeOutDir);
  ensureDir(wasmOutDir);

  if (!fs.existsSync(koncludePath)) {
    throw new Error(`Konclude binary not found at ${koncludePath}`);
  }

  let ontologies = listTestOntologies();
  if (ontologies.length === 0) {
    throw new Error(`No .owl.xml files found under ${testsDir}`);
  }
  const datasetsFilter = (process.env.DATASETS || process.env.DATASET || "")
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  if (datasetsFilter.length > 0) {
    ontologies = ontologies.filter((onto) => datasetsFilter.includes(onto.name));
    if (ontologies.length === 0) {
      throw new Error(`No matching datasets found for filter: ${datasetsFilter.join(",")}`);
    }
  }

  const threadCounts = parseThreadList();
  if (threadCounts.length === 0) {
    throw new Error("No valid thread counts specified.");
  }
  const tasks = parseTaskList();

  const server = spawn(process.execPath, [serverScript], {
    env: { ...process.env, PORT: String(port) },
    stdio: "inherit",
  });

  const cleanup = () => {
    if (!server.killed) {
      server.kill("SIGTERM");
    }
  };
  process.on("exit", cleanup);
  process.on("SIGINT", () => {
    cleanup();
    process.exit(1);
  });

  await waitForServer(`${baseUrl}/web/index.html`);

  const browser = await chromium.launch({ headless: browsersHeadless });
  const page = await browser.newPage();
  page.setDefaultTimeout(timeoutMs + 60000);
  if (browserLog) {
    page.on("console", (msg) => {
      console.log(`[browser ${msg.type()}] ${msg.text()}`);
    });
    page.on("pageerror", (err) => {
      console.error("[browser pageerror]", err);
    });
    page.on("requestfailed", (req) => {
      console.warn("[browser requestfailed]", req.url(), req.failure());
    });
  }

  const results = [];
  try {
    for (const ontology of ontologies) {
      for (const threads of threadCounts) {
        for (const task of tasks) {
          const def = TASK_DEFS[task];
          console.log(`\n== ${ontology.name} ${task} threads=${threads} ==`);
          const nativeResult = await runNative(ontology, threads, task);
          const wasmResult = await runWasm(page, ontology.name, threads, task);

          const wasmOutPath = path.join(wasmOutDir, `${ontology.name}.${task}.t${threads}${def.outputExt}`);
          fs.writeFileSync(wasmOutPath, wasmResult.output, "utf8");

          let match = "mismatch";
          let equivalence = null;
          if (nativeResult.hash === wasmResult.hash) {
            match = "exact";
          } else if (nativeResult.normalizedHash === wasmResult.normalizedHash) {
            match = def.type === "xml" ? "normalized" : "normalized-text";
          }

          if (def.type === "xml") {
            equivalence = compareOutputs(nativeResult.outputPath, wasmOutPath);
            if (match === "mismatch" && equivalence) {
              if (equivalence.canonical_match) {
                match = "canonical";
              } else if (def.compareClosure && equivalence.closure_match) {
                match = "closure";
              }
            }
          }

          results.push({
            dataset: ontology.name,
            task,
            threads,
            nativeMs: nativeResult.elapsedMs,
            wasmMs: wasmResult.elapsedMs,
            wasmWallMs: wasmResult.wallMs,
            nativeHash: nativeResult.hash,
            wasmHash: wasmResult.hash,
            nativeNormalizedHash: nativeResult.normalizedHash,
            wasmNormalizedHash: wasmResult.normalizedHash,
            nativeOutputSize: nativeResult.outputSize,
            wasmOutputSize: wasmResult.outputSize,
            match,
            equivalence,
            wasmRuntime: wasmResult.runtime,
            nativeNormalizedValue: def.type === "text" ? nativeResult.normalizedValue : null,
            wasmNormalizedValue: def.type === "text" ? wasmResult.normalizedValue : null,
          });

          console.log(
            `native=${nativeResult.elapsedMs.toFixed(0)}ms wasm=${wasmResult.elapsedMs ?? "n/a"}ms wasmWall=${wasmResult.wallMs}ms match=${match}`
          );
        }
      }
    }
  } finally {
    await browser.close();
    cleanup();
  }

  const summaryPath = path.join(outputDir, "perf-summary.json");
  fs.writeFileSync(summaryPath, JSON.stringify({
    generatedAt: new Date().toISOString(),
    threadCounts,
    datasets: ontologies.map((o) => o.name),
    tasks,
    results,
  }, null, 2));

  console.log(`\nSummary written to ${summaryPath}`);

  const csvPath = path.join(outputDir, "perf-summary.csv");
  const csvHeader = [
    "dataset",
    "task",
    "threads",
    "native_ms",
    "wasm_ms",
    "wasm_wall_ms",
    "native_output_bytes",
    "wasm_output_bytes",
    "match",
    "canonical_match",
    "closure_match",
  ];
  const csvLines = [csvHeader.join(",")];
  for (const row of results) {
    const canonicalMatch = row.equivalence ? String(Boolean(row.equivalence.canonical_match)) : "";
    const closureMatch = row.equivalence ? String(Boolean(row.equivalence.closure_match)) : "";
    csvLines.push([
      row.dataset,
      row.task,
      row.threads,
      Math.round(row.nativeMs),
      row.wasmMs ?? "",
      row.wasmWallMs,
      row.nativeOutputSize,
      row.wasmOutputSize,
      row.match,
      canonicalMatch,
      closureMatch,
    ].join(","));
  }
  fs.writeFileSync(csvPath, `${csvLines.join("\n")}\n`, "utf8");
  console.log(`CSV written to ${csvPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
