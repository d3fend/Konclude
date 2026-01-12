// Minimal, bundler-agnostic JS helper for the Konclude wasm module (MT-only).
// Usage:
//   import createKoncludeModule from './konclude_mt.js';
//   const api = await createKoncludeApi(createKoncludeModule, { locateFile });
//
export async function createKoncludeApi(createKoncludeModule, options = {}) {
  const module = await createKoncludeModule({
    noInitialRun: true,
    ...options,
  });

  const submitClassifyFiles = module.cwrap("konclude_submit_classify_files", "number", ["string", "string"]);
  const submitRealizeFiles = module.cwrap("konclude_submit_realize_files", "number", ["string", "string"]);
  const submitRealiseFiles = module.cwrap("konclude_submit_realise_files", "number", ["string", "string"]);
  const jobStatus = module.cwrap("konclude_job_status", "number", ["number"]);
  const jobExitCode = module.cwrap("konclude_job_exit_code", "number", ["number"]);
  const jobFree = module.cwrap("konclude_job_free", null, ["number"]);
  const tick = module.cwrap("konclude_tick", null, ["number"]);

  async function waitForJob(jobId, { intervalMs = 10, timeoutMs = 120000, tickMs = 5 } = {}) {
    const started = Date.now();
    let status = 0;
    while (status === 0) {
      tick(tickMs);
      status = jobStatus(jobId);
      if (status === 0) {
        if (Date.now() - started > timeoutMs) {
          throw new Error("Konclude job timeout");
        }
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
      }
    }
    const code = jobExitCode(jobId);
    return { status, code };
  }

  async function classifyOwl2XmlString(owlXml, inPath = "/tmp/in.owl.xml", outPath = "/tmp/out.owl.xml") {
    module.FS.writeFile(inPath, owlXml);
    const jobId = submitClassifyFiles(inPath, outPath);
    if (jobId <= 0) {
      throw new Error("Failed to submit classify job");
    }
    try {
      const { status, code } = await waitForJob(jobId);
      let output = "";
      try {
        output = module.FS.readFile(outPath, { encoding: "utf8" });
      } catch (readErr) {
        console.warn("Konclude output read failed", readErr);
      }
      return { status, code, output };
    } finally {
      jobFree(jobId);
    }
  }

  async function realizeOwl2XmlString(owlXml, inPath = "/tmp/in.owl.xml", outPath = "/tmp/out.owl.xml") {
    module.FS.writeFile(inPath, owlXml);
    const jobId = submitRealizeFiles(inPath, outPath);
    if (jobId <= 0) {
      throw new Error("Failed to submit realize job");
    }
    try {
      const { status, code } = await waitForJob(jobId);
      let output = "";
      try {
        output = module.FS.readFile(outPath, { encoding: "utf8" });
      } catch (readErr) {
        console.warn("Konclude output read failed", readErr);
      }
      return { status, code, output };
    } finally {
      jobFree(jobId);
    }
  }

  return {
    module,
    submitClassifyFiles,
    submitRealizeFiles,
    submitRealiseFiles,
    waitForJob,
    classifyOwl2XmlString,
    realizeOwl2XmlString,
  };
}
