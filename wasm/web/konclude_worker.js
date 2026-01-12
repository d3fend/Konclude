self.onmessage = async (event) => {
  const owlXml = event.data && event.data.owlXml ? event.data.owlXml : "";
  const mode = event.data && event.data.mode ? event.data.mode : "mt";
  const debug = Boolean(event.data && event.data.debug);
  const totalMemory =
    event.data && Number.isFinite(event.data.totalMemory) ? event.data.totalMemory : null;
  if (!owlXml) {
    self.postMessage({ ok: false, code: -1, output: "", error: "missing owlXml" });
    return;
  }
  if (mode !== "mt") {
    self.postMessage({ ok: false, code: -1, output: "", error: "only mt mode is supported" });
    return;
  }

  try {
    const distDir = "mt";
    const scriptName = "konclude_mt.js";
    const baseUrl = new URL(`../dist/${distDir}/`, self.location.href);

    if (debug && typeof Worker === "function") {
      const OriginalWorker = Worker;
      self.Worker = function KoncludeWrappedWorker(url, options) {
        console.log("[konclude] spawning pthread worker", url);
        const worker = new OriginalWorker(url, options);
        worker.addEventListener("error", (err) => {
          console.error("[konclude] pthread worker error", err);
        });
        worker.addEventListener("messageerror", (err) => {
          console.error("[konclude] pthread worker message error", err);
        });
        return worker;
      };
      self.Worker.prototype = OriginalWorker.prototype;
    }

    console.log("worker loading module", {
      mode,
      baseUrl: baseUrl.toString(),
      workerType: typeof Worker,
      sharedArrayBuffer: typeof SharedArrayBuffer,
      crossOriginIsolated: self.crossOriginIsolated,
      hardwareConcurrency: self.navigator ? self.navigator.hardwareConcurrency : undefined,
    });
    importScripts(new URL(scriptName, baseUrl).toString());

    let abortReject = null;
    let moduleInit = null;
    let runtimeReady = false;
    const moduleOptions = {
      noInitialRun: true,
      locateFile: (path) => new URL(path, baseUrl).toString(),
      mainScriptUrlOrBlob: new URL(scriptName, baseUrl).toString(),
      print: (...args) => console.log("[konclude]", ...args),
      printErr: (...args) => console.error("[konclude]", ...args),
      onAbort: (reason) => {
        console.error("[konclude] abort", reason);
        if (abortReject) {
          abortReject(new Error(String(reason)));
        }
      },
      onRuntimeInitialized: () => {
        runtimeReady = true;
        console.log("[konclude] runtime initialized");
      },
      monitorRunDependencies: (left) => console.log("[konclude] run dependencies", left),
    };

    if (totalMemory) {
      moduleOptions.TOTAL_MEMORY = totalMemory;
    }

    moduleInit = self.createKoncludeModule(moduleOptions);
    const moduleObject = moduleInit;

    console.log("worker module init returned", { hasThen: typeof moduleInit?.then === "function" });
    setTimeout(() => {
      console.log("worker module init status", {
        calledRun: moduleInit?.calledRun,
        ready: moduleInit?.ready,
        noExitRuntime: moduleInit?.noExitRuntime,
        runtimeReady,
      });
    }, 5000);

    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error("konclude module init timeout")), 120000);
    });
    const waitForRuntime = new Promise((resolve) => {
      const checkReady = () => {
        if (runtimeReady || moduleInit?.calledRun) {
          resolve({ module: moduleObject });
          return;
        }
        setTimeout(checkReady, 10);
      };
      checkReady();
    });
    const moduleInitPromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("konclude module init timeout"));
      }, 120000);

      if (moduleInit && typeof moduleInit.then === "function") {
        abortReject = reject;
        moduleInit.then((readyModule) => {
          clearTimeout(timeout);
          abortReject = null;
          resolve({ module: readyModule });
        });
      } else {
        clearTimeout(timeout);
        resolve({ module: moduleObject });
      }
    });
    const { module: moduleResolved } = await Promise.race([
      moduleInitPromise,
      waitForRuntime,
      timeoutPromise,
    ]);

    console.log("worker module ready");
    const submitClassify = moduleResolved.cwrap("konclude_submit_classify_files", "number", ["string", "string"]);
    const jobStatus = moduleResolved.cwrap("konclude_job_status", "number", ["number"]);
    const jobExitCode = moduleResolved.cwrap("konclude_job_exit_code", "number", ["number"]);
    const jobFree = moduleResolved.cwrap("konclude_job_free", null, ["number"]);
    const tick = moduleResolved.cwrap("konclude_tick", null, ["number"]);
    const inPath = "in.owl.xml";
    const outPath = "out.owl.xml";

    moduleResolved.FS.writeFile(inPath, owlXml);
    console.log("worker submitting classify job");
    const jobId = submitClassify(inPath, outPath);
    if (jobId <= 0) {
      self.postMessage({ ok: false, code: -1, output: "", error: "failed to submit job" });
      return;
    }

    let status = 0;
    const start = Date.now();
    let pollCount = 0;
    while (status === 0) {
      tick(5);
      status = jobStatus(jobId);
      if (status === 0) {
        if ((pollCount++ % 50) === 0) {
          console.log("worker job status", { status });
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
      console.warn("worker failed to read output", readErr);
    }
    jobFree(jobId);

    const ok = status === 1 && code === 0 && output.includes("Ontology");
    const error = ok ? null : "konclude classify failed";

    self.postMessage({ ok, code, output, error });
  } catch (err) {
    console.error("worker failure", err);
    self.postMessage({ ok: false, code: -1, output: "", error: err?.message || "worker failure" });
  }
};
