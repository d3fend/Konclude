const { firefox } = require("playwright");
const { spawn } = require("child_process");
const path = require("path");

const port = Number(process.env.PORT || 8000);
const baseUrl = `http://localhost:${port}`;
const serverScript = path.resolve(__dirname, "..", "scripts", "serve_coop_coep.js");

const dataset = process.env.DATASET || "d3fend-full";
const workersList = (process.env.WORKERS || "1,2,4,8,16")
  .split(",")
  .map((value) => Number(value.trim()))
  .filter((value) => Number.isFinite(value) && value > 0);

const parallelMode = (process.env.PARALLEL_MODE || "workers").toLowerCase();
const timeoutMs = Number(process.env.TIMEOUT_MS || 300000);
const headless = process.env.HEADLESS !== "0";

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

async function run() {
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

  const browser = await firefox.launch({ headless });
  const page = await browser.newPage();
  page.setDefaultTimeout(timeoutMs + 60000);

  const results = [];

  for (const workers of workersList) {
    const parallel = parallelMode === "workers" ? workers : Number(parallelMode);
    const parallelParam = Number.isFinite(parallel) ? `&parallel=${parallel}` : "";
    const url = `${baseUrl}/web/index.html?mode=mt&dataset=${encodeURIComponent(
      dataset
    )}&workers=${workers}${parallelParam}&timeoutMs=${timeoutMs}`;

    console.log(`running dataset=${dataset} workers=${workers} parallel=${parallel} ...`);
    await page.goto(url, { waitUntil: "load" });

    await page.waitForFunction(
      () => window.__koncludeResult && window.__koncludeResult.done,
      { timeout: timeoutMs + 60000 }
    );

    const result = await page.evaluate(() => window.__koncludeResult);
    if (!result || !result.ok) {
      throw new Error(`failed run workers=${workers}: ${JSON.stringify(result)}`);
    }

    const elapsed = result.classification?.elapsedMs;
    results.push({ workers, parallel, elapsedMs: elapsed });
    console.log(`workers=${workers} parallel=${parallel} elapsedMs=${elapsed}`);
  }

  await browser.close();
  cleanup();

  console.log("\nsummary:");
  for (const row of results) {
    console.log(`workers=${row.workers} parallel=${row.parallel} elapsedMs=${row.elapsedMs}`);
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
