const { chromium } = require("playwright");
const { spawn } = require("child_process");
const path = require("path");

const port = Number(process.env.PORT || 8000);
const baseUrl = `http://localhost:${port}`;
const serverScript = path.resolve(__dirname, "..", "scripts", "serve_repo_coop_coep.js");

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

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
  process.on("exit", cleanup);

  await waitForServer(`${baseUrl}/wasm/web/owl2-conformance.html`);

  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.setDefaultTimeout(Number(process.env.E2E_TIMEOUT_MS || 300000));

  await page.goto(`${baseUrl}/wasm/web/owl2-conformance.html`, { waitUntil: "load" });
  await page.waitForFunction(() => window.__owl2ConformanceResult && window.__owl2ConformanceResult.done, {
    timeout: Number(process.env.E2E_TIMEOUT_MS || 300000),
  });

  const result = await page.evaluate(() => window.__owl2ConformanceResult);
  await browser.close();
  cleanup();

  if (!result || !result.ok) {
    throw new Error(`OWL2 conformance failed: ${JSON.stringify(result)}`);
  }
  console.log("OWL2 conformance ok");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
