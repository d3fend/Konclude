const { chromium, firefox } = require("playwright");
const { spawn } = require("child_process");
const path = require("path");

const port = Number(process.env.PORT || 8000);
const baseUrl = `http://localhost:${port}`;
const serverScript = path.resolve(__dirname, "..", "scripts", "serve_coop_coep.js");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServer(url) {
  for (let i = 0; i < 40; i += 1) {
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

async function runBrowser(browserType, label, modes, datasets) {
  console.log(`launching ${label}`);
  const browser = await browserType.launch();
  const page = await browser.newPage();
  const pageTimeout = Number(process.env.E2E_TIMEOUT_MS || 180000);
  page.setDefaultTimeout(pageTimeout);
  const consoleMode = String(process.env.E2E_CONSOLE || "all").toLowerCase();
  const logConsole = consoleMode !== "0" && consoleMode !== "none";
  const logErrorsOnly = consoleMode === "errors" || consoleMode === "error";
  if (logConsole) {
    page.on("console", (msg) => {
      if (logErrorsOnly && msg.type() !== "error") {
        return;
      }
      console.log(`[${label}] ${msg.type()}: ${msg.text()}`);
    });
  }
  page.on("pageerror", (err) => {
    console.error(`[${label}] pageerror: ${err.message}`);
  });

  for (const dataset of datasets) {
    const datasetParam = dataset ? `&dataset=${encodeURIComponent(dataset)}` : "";
    for (const mode of modes) {
      const debugParam = process.env.DEBUG_WORKER === "1" ? "&debug=1" : "";
      const timeoutParam = process.env.TIMEOUT_MS ? `&timeoutMs=${encodeURIComponent(process.env.TIMEOUT_MS)}` : "";
      const profileParam = process.env.PROFILE ? `&profile=${encodeURIComponent(process.env.PROFILE)}` : "";
      const workersParam = process.env.WORKERS ? `&workers=${encodeURIComponent(process.env.WORKERS)}` : "";
      let mainParam = "";
      if (process.env.MAIN_THREAD === "1") {
        mainParam = "&main=1";
      } else if (process.env.MAIN_THREAD === "0") {
        mainParam = "&main=0";
      }
      const onlyParam = process.env.ONLY ? `&only=${encodeURIComponent(process.env.ONLY)}` : "";
      const parallelParam = process.env.PARALLEL ? `&parallel=${encodeURIComponent(process.env.PARALLEL)}` : "";
      const url = `${baseUrl}/web/index.html?mode=${mode}${debugParam}${datasetParam}${timeoutParam}${profileParam}${workersParam}${parallelParam}${mainParam}${onlyParam}`;
      console.log(`${label} ${mode} (${dataset || "default"}): loading`);

      await page.goto(url, { waitUntil: "load" });
      console.log(`${label} ${mode} (${dataset || "default"}): waiting for result`);

      let waitTimeout = pageTimeout;
      try {
        await page.waitForFunction(
          () => Number.isFinite(window.__koncludeRuntimeTimeoutMs) && window.__koncludeRuntimeTimeoutMs > 0,
          { timeout: 10000 }
        );
        const runtimeTimeoutMs = await page.evaluate(() => window.__koncludeRuntimeTimeoutMs);
        if (Number.isFinite(runtimeTimeoutMs) && runtimeTimeoutMs > 0) {
          waitTimeout = Math.max(waitTimeout, runtimeTimeoutMs + 60000);
          page.setDefaultTimeout(waitTimeout);
        }
      } catch {
        // ignore runtime timeout lookup
      }

      await page.waitForFunction(
        () => window.__koncludeResult && window.__koncludeResult.done,
        { timeout: waitTimeout }
      );

      const result = await page.evaluate(() => window.__koncludeResult);
      if (!result || !result.ok) {
        await browser.close();
        throw new Error(`${label} ${mode} failed: ${JSON.stringify(result)}`);
      }
      if (result.consistency && result.consistency.consistent !== true) {
        await browser.close();
        throw new Error(`${label} ${mode} consistency failed: ${JSON.stringify(result.consistency)}`);
      }
      if (mode === "mt" && !result.crossOriginIsolated) {
        await browser.close();
        throw new Error(`${label} ${mode} not crossOriginIsolated`);
      }

      console.log(`${label} ${mode} (${dataset || "default"}) ok`);
    }
  }

  await browser.close();
}

async function main() {
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

  const browsersEnv = (process.env.BROWSERS || "chromium,firefox")
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  const modesEnv = (process.env.MODES || "mt")
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  if (modesEnv.some((mode) => mode !== "mt")) {
    throw new Error(`Unsupported mode(s) in MODES: ${modesEnv.join(",")}`);
  }
  const slowDatasets = ["roberts-family-full-D"];
  const defaultDatasets = ["sample", "galen", "lubm-univ-bench"];
  if (process.env.INCLUDE_SLOW === "1") {
    defaultDatasets.push(...slowDatasets);
  }
  const datasetsEnv = (process.env.DATASETS || process.env.DATASET || defaultDatasets.join(","))
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);

  if (browsersEnv.includes("chromium")) {
    await runBrowser(chromium, "chromium", modesEnv, datasetsEnv);
  }
  if (browsersEnv.includes("firefox")) {
    await runBrowser(firefox, "firefox", modesEnv, datasetsEnv);
  }

  cleanup();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
