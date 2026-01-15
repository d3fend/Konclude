self.onmessage = async (event) => {
  const payload = event.data || {};
  const owlXml = payload.owlXml || "";
  const mode = payload.mode || "mt";
  const debug = Boolean(payload.debug);
  const only = payload.only || "";
  const totalMemory = Number.isFinite(payload.totalMemory) ? payload.totalMemory : null;
  const timeoutMs = Number.isFinite(payload.timeoutMs) ? payload.timeoutMs : 120000;
  const dataset = payload.dataset || null;
  const exceptionState = { typePtr: null, mangled: null };
  const textDecoder = new TextDecoder("utf-8");

  function readCString(heapU8, ptr, maxBytes = 512) {
    if (!ptr || !heapU8) return "";
    let end = ptr;
    const max = Math.min(heapU8.length, ptr + maxBytes);
    while (end < max && heapU8[end] !== 0) {
      end += 1;
    }
    // TextDecoder does not accept views backed by SharedArrayBuffer in some browsers.
    const copy = heapU8.slice(ptr, end);
    return textDecoder.decode(copy);
  }

  if (!owlXml) {
    self.postMessage({ ok: false, error: "missing owlXml" });
    return;
  }
  if (mode !== "mt") {
    self.postMessage({ ok: false, error: "only mt mode is supported" });
    return;
  }

  function readFileSnippet(moduleResolved, path, maxBytes) {
    let stream = null;
    try {
      stream = moduleResolved.FS.open(path, "r");
      const buffer = new Uint8Array(maxBytes);
      const bytesRead = moduleResolved.FS.read(stream, buffer, 0, maxBytes, 0);
      const decoder = new TextDecoder("utf-8");
      return decoder.decode(buffer.slice(0, bytesRead));
    } catch (err) {
      console.warn("failed to read output snippet", err);
      return "";
    } finally {
      if (stream) {
        try {
          moduleResolved.FS.close(stream);
        } catch {
          // ignore
        }
      }
    }
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
    let moduleRef = null;
    let runtimeReadyResolve = null;
    const runtimeReadyPromise = new Promise((resolve) => {
      runtimeReadyResolve = resolve;
    });
    const moduleOptions = {
      noInitialRun: true,
      noExitRuntime: true,
      locateFile: (path) => new URL(path, baseUrl).toString(),
      mainScriptUrlOrBlob: new URL(scriptName, baseUrl).toString(),
      print: (...args) => {
        if (!debug && typeof args[0] === "string" && args[0].includes("[konclude wasm]")) {
          return;
        }
        console.log("[konclude]", ...args);
      },
      printErr: (...args) => {
        if (!debug && typeof args[0] === "string" && args[0].includes("[konclude wasm]")) {
          return;
        }
        const msg = typeof args[0] === "string" ? args[0] : "";
        const match = msg.match(/Compiled code throwing an exception, (\d+),(\d+),(\d+)/);
        if (match) {
          const typePtr = Number(match[2]);
          exceptionState.typePtr = Number.isFinite(typePtr) ? typePtr : null;
          if (moduleRef && exceptionState.typePtr) {
            const namePtr = moduleRef.HEAPU32[(exceptionState.typePtr + 4) >> 2];
            exceptionState.mangled = readCString(moduleRef.HEAPU8, namePtr);
            console.log("[konclude] exception type", {
              ptr: Number(match[1]),
              typePtr: exceptionState.typePtr,
              mangled: exceptionState.mangled,
            });
          }
        }
        console.log("[konclude]", ...args);
      },
      onAbort: (reason) => {
      console.error("[konclude] abort", reason);
        if (abortReject) {
          abortReject(new Error(String(reason)));
        }
      },
      onRuntimeInitialized: () => {
        runtimeReady = true;
        console.log("[konclude] runtime initialized");
        if (runtimeReadyResolve) {
          runtimeReadyResolve({ module: moduleInit });
          runtimeReadyResolve = null;
        }
      },
      monitorRunDependencies: (left) => console.log("[konclude] run dependencies", left),
    };

    if (totalMemory) {
      moduleOptions.TOTAL_MEMORY = totalMemory;
    }

    moduleInit = self.createKoncludeModule(moduleOptions);

    console.log("worker module init returned", {
      hasThen: typeof moduleInit?.then === "function",
      hasCwrap: typeof moduleInit?.cwrap === "function",
      hasFS: Boolean(moduleInit?.FS),
    });
    setTimeout(() => {
      console.log("worker module init status", {
        calledRun: moduleInit?.calledRun,
        ready: moduleInit?.ready,
        runtimeReady,
      });
    }, 5000);

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

    const isUsableModule = (mod) => mod && typeof mod.cwrap === "function";
    const moduleInitPromise =
      moduleInit && typeof moduleInit.then === "function"
        ? new Promise((resolve, reject) => {
            abortReject = reject;
            moduleInit.then(resolve, reject);
          })
        : Promise.resolve(moduleInit);

    console.log("worker awaiting module readiness");
    const moduleResolvedResult = await withTimeout(
      Promise.race([moduleInitPromise, runtimeReadyPromise]),
      "konclude module init timeout"
    );
    const moduleResolved =
      moduleResolvedResult && moduleResolvedResult.module ? moduleResolvedResult.module : moduleResolvedResult;
    abortReject = null;

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

    console.log("worker module ready");
    moduleRef = isUsableModule(moduleResolved) ? moduleResolved : moduleInit;
    if (exceptionState.typePtr && !exceptionState.mangled) {
      const namePtr = moduleResolved.HEAPU32[(exceptionState.typePtr + 4) >> 2];
      exceptionState.mangled = readCString(moduleResolved.HEAPU8, namePtr);
      console.log("[konclude] exception type", {
        typePtr: exceptionState.typePtr,
        mangled: exceptionState.mangled,
      });
    }
    const submitJob = moduleResolved.cwrap("konclude_submit_job", "number", ["string", "string", "string"]);
    const jobStatus = moduleResolved.cwrap("konclude_job_status", "number", ["number"]);
    const jobExitCode = moduleResolved.cwrap("konclude_job_exit_code", "number", ["number"]);
    const jobFree = moduleResolved.cwrap("konclude_job_free", null, ["number"]);
    const tick = moduleResolved.cwrap("konclude_tick", null, ["number"]);
    const consistencySidecarFor = (classifyPath) => `${classifyPath}.consistency.txt`;

    const inPath = "in.owl.xml";
    moduleResolved.FS.writeFile(inPath, owlXml);

    const readConsistencySidecar = (sidecarPath) => {
      try {
        const stat = moduleResolved.FS.stat(sidecarPath);
        if (!stat || stat.size <= 0) {
          return null;
        }
        const output = readFileSnippet(moduleResolved, sidecarPath, 256);
        const normalized = output.trim().toLowerCase();
        const consistent = normalized === "true";
        return {
          status: 1,
          code: 0,
          output,
          outputSize: stat.size,
          elapsedMs: 0,
          consistent,
          source: "classification",
        };
      } catch {
        return null;
      }
    };

    const runJob = async (command, outputPath, readBytes) => {
      const jobId = submitJob(command, inPath, outputPath);
      if (jobId <= 0) {
        throw new Error(`failed to submit ${command} job`);
      }

      let status = 0;
      const start = Date.now();
      let pollCount = 0;
      while (status === 0) {
        try {
          tick(5);
        } catch (err) {
          throw new Error(`tick failed: ${err}`);
        }
        try {
          status = jobStatus(jobId);
        } catch (err) {
          throw new Error(`jobStatus failed: ${err}`);
        }
        if (status === 0) {
          if ((pollCount++ % 50) === 0) {
            let size = null;
            try {
              size = moduleResolved.FS.stat(outputPath).size;
            } catch {
              size = null;
            }
            console.log("worker job status", { command, status, size });
          }
          if (Date.now() - start > timeoutMs) {
            jobFree(jobId);
            throw new Error(`konclude ${command} job timeout`);
          }
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
      }

      let code = null;
      try {
        code = jobExitCode(jobId);
      } catch (err) {
        throw new Error(`jobExitCode failed: ${err}`);
      }
      let output = "";
      let outputSize = null;
      try {
        outputSize = moduleResolved.FS.stat(outputPath).size;
        if (readBytes && outputSize > 0) {
          output = readFileSnippet(moduleResolved, outputPath, readBytes);
        }
      } catch (readErr) {
        console.warn("worker failed to read output", readErr);
      }

      jobFree(jobId);

      return {
        status,
        code,
        output,
        outputSize,
        elapsedMs: Date.now() - start,
      };
    };

    let classify = null;
    let consistency = null;
    let consistent = null;
    const classifyOutputPath = "classify.owl.xml";

    if (only !== "consistency") {
      console.log("worker submitting classify job");
      classify = await runJob("classification", classifyOutputPath, 2048);
      console.log("worker classify done", classify);
    }

    if (only !== "classification") {
      if (classify) {
        const sidecarPath = consistencySidecarFor(classifyOutputPath);
        consistency = readConsistencySidecar(sidecarPath);
        if (consistency) {
          console.log("worker consistency from classification", {
            path: sidecarPath,
            outputSize: consistency.outputSize,
          });
          consistent = consistency.consistent;
        }
      }
      if (!consistency) {
        console.log("worker submitting consistency job");
        consistency = await runJob("consistency", "consistency.txt", 256);
        console.log("worker consistency done", consistency);
        consistent = consistency.output.trim().toLowerCase() === "true";
      }
    }

    const classifyOk = !classify || (classify.status === 1 && classify.code === 0);
    const consistencyOk =
      !consistency || (consistency.status === 1 && consistency.code === 0 && consistent);
    const ok = classifyOk && consistencyOk;
    const error = ok ? null : "konclude classify/consistency failed";
    const consistencyPayload = consistency ? { ...consistency, consistent } : null;

    self.postMessage({
      ok,
      dataset,
      classification: classify,
      consistency: consistencyPayload,
      error,
    });
  } catch (err) {
    const details = {
      name: err?.name,
      message: err?.message,
      stack: err?.stack,
      type: typeof err,
    };
    console.error("worker failure", err, details);
    self.postMessage({ ok: false, error: err?.message || String(err) || "worker failure" });
  }
};
