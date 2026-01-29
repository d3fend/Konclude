import { createKoncludeApi } from "../js/konclude_wasm_api.js";

const statusEl = document.getElementById("status");
const setStatus = (msg) => {
  if (statusEl) statusEl.textContent = msg;
  console.log(msg);
};

async function run() {
  const casesUrl = "/Tests/owl2-test-cases/approved/ofn/cases.txt";
  const casesRes = await fetch(casesUrl);
  if (!casesRes.ok) {
    throw new Error(`Failed to load cases.txt: ${casesRes.status}`);
  }
  const raw = await casesRes.text();
  const cases = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const parts = line.split("\t");
      return {
        expect: parts[0] === "true",
        input: parts[1],
        id: parts[2] || parts[1],
      };
    });

  const expectedUrl = "/Tests/owl2-test-cases/expected-failures.txt";
  const expectedRes = await fetch(expectedUrl);
  const expected = new Set();
  if (expectedRes.ok) {
    const expectedRaw = await expectedRes.text();
    expectedRaw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .forEach((line) => expected.add(line));
  }

  const createKoncludeModule = window.createKoncludeModule;
  if (!createKoncludeModule) {
    throw new Error("createKoncludeModule not found; konclude_mt.js failed to load");
  }

  const api = await createKoncludeApi(createKoncludeModule, {
    locateFile: (p) => new URL(`../dist/mt/${p}`, import.meta.url).toString(),
  });

  const { module } = api;
  let failures = [];
  let xfail = 0;
  let xpass = 0;

  for (let i = 0; i < cases.length; i += 1) {
    const testCase = cases[i];
    const inputRes = await fetch(`/${testCase.input}`);
    if (!inputRes.ok) {
      failures.push({ id: testCase.id, reason: `missing input ${testCase.input}` });
      continue;
    }
    const text = await inputRes.text();

    const inPath = `/tmp/in-${i}.ofn`;
    const outPath = `/tmp/out-${i}.txt`;
    module.FS.writeFile(inPath, text);
    const jobId = api.submitJob("consistency", inPath, outPath);
    if (jobId <= 0) {
      failures.push({ id: testCase.id, reason: "job submit failed" });
      continue;
    }
    try {
      await api.waitForJob(jobId, { timeoutMs: 180000 });
      const output = module.FS.readFile(outPath, { encoding: "utf8" }).trim().toLowerCase();
      const ok = output === "true";
      if (ok !== testCase.expect) {
      if (expected.has(testCase.id)) {
        xfail += 1;
      } else {
        failures.push({ id: testCase.id, reason: `expected ${testCase.expect} got ${ok}` });
      }
    } else if (expected.has(testCase.id)) {
      xpass += 1;
      failures.push({ id: testCase.id, reason: "unexpected pass (expected failure)" });
    }
    } finally {
      api.module.FS.unlink(inPath);
      api.module.FS.unlink(outPath);
      api.module.cwrap("konclude_job_free", null, ["number"])(jobId);
    }

    if (i % 10 === 0) {
      setStatus(`Processed ${i + 1} / ${cases.length}`);
    }
  }

  if (failures.length) {
    window.__owl2ConformanceResult = { ok: false, done: true, failures, xfail, xpass };
    setStatus(`FAIL: ${failures.length} failures (XFAIL=${xfail} XPASS=${xpass})`);
    return;
  }
  window.__owl2ConformanceResult = { ok: true, done: true, xfail, xpass };
  setStatus(`OK: ${cases.length} cases (XFAIL=${xfail} XPASS=${xpass})`);
}

run().catch((err) => {
  console.error(err);
  window.__owl2ConformanceResult = { ok: false, done: true, error: err.message };
  setStatus(`ERROR: ${err.message}`);
});
