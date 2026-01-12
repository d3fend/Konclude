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

async function runBrowser(browserType, label, modes) {
  console.log(`launching ${label}`);
  const browser = await browserType.launch();
  const page = await browser.newPage();
  page.setDefaultTimeout(180000);
  page.on("console", (msg) => {
    console.log(`[${label}] ${msg.type()}: ${msg.text()}`);
  });
  page.on("pageerror", (err) => {
    console.error(`[${label}] pageerror: ${err.message}`);
  });

  for (const mode of modes) {
    const debugParam = process.env.DEBUG_WORKER === "1" ? "&debug=1" : "";
    const url = `${baseUrl}/web/index.html?mode=${mode}${debugParam}`;
    console.log(`${label} ${mode}: loading`);

    await page.goto(url, { waitUntil: "load" });
    console.log(`${label} ${mode}: waiting for result`);

    await page.waitForFunction(
      () => window.__koncludeResult && window.__koncludeResult.done,
      { timeout: 180000 }
    );

    const result = await page.evaluate(() => window.__koncludeResult);
    if (!result || !result.ok) {
      await browser.close();
      throw new Error(`${label} ${mode} failed: ${JSON.stringify(result)}`);
    }
    if (mode === "mt" && !result.crossOriginIsolated) {
      await browser.close();
      throw new Error(`${label} ${mode} not crossOriginIsolated`);
    }

    console.log(`${label} ${mode} ok`);
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

  if (browsersEnv.includes("chromium")) {
    await runBrowser(chromium, "chromium", modesEnv);
  }
  if (browsersEnv.includes("firefox")) {
    await runBrowser(firefox, "firefox", modesEnv);
  }

  cleanup();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
