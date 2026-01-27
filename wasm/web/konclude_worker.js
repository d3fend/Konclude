self.onmessage = async (event) => {
  const payload = event.data || {};
  const owlXml = payload.owlXml || "";
  const mode = payload.mode || "mt";
  const debug = Boolean(payload.debug);
  const only = payload.only || "";
  const preferBlocking = payload.blocking === true || payload.blocking === "1";
  const profile = payload.profile || "default";
  const workersParam = payload.workers || "";
  const parallelParam = payload.parallel || "";
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

  const parallelOverrideRaw = Number.parseInt(parallelParam || "", 10);
  const parallelOverride = Number.isFinite(parallelOverrideRaw) && parallelOverrideRaw > 0 ? parallelOverrideRaw : null;

  function applyParallelOverride(overrides, parallelOverrideValue) {
    const parallel = Number.parseInt(String(parallelOverrideValue), 10);
    if (!Number.isFinite(parallel) || parallel <= 0) {
      return;
    }
    const parallelCount = Math.max(1, parallel);
    overrides["Konclude.Calculation.Classification.MaximumParallelSubsumptionCalculationCount"] = String(parallelCount);
    overrides["Konclude.Calculation.Classification.OptimizedKPSetClassSubsumptionClassifier.MaximumParallelSatisfiableCalculationCount"] =
      String(parallelCount);
    overrides["Konclude.Calculation.Classification.OptimizedKPSetClassSubsumptionClassifier.MultipliedUnitsParallelSatisfiableCalculationCount"] =
      "1";
    overrides["Konclude.Calculation.Classification.OptimizedSubClassSubsumptionClassifier.MaximumParallelSatisfiableCalculationCount"] =
      String(parallelCount);
    overrides["Konclude.Calculation.Classification.OptimizedSubClassSubsumptionClassifier.MultipliedUnitsParallelSatisfiableCalculationCount"] =
      "1";
    overrides["Konclude.Calculation.Precomputation.TotalPrecomputor.MaximumParallelCalculationCount"] = String(parallelCount);
    overrides["Konclude.Calculation.Precomputation.TotalPrecomputor.MultipliedUnitsParallelCalculationCount"] = "1";
    overrides["Konclude.Calculation.Precomputation.TotalPrecomputor.MaximumBatchJobCreationCount"] = String(parallelCount);
  }

  function resolveProfileDefaults(profileName, datasetInfo) {
    if (profileName !== "d3fend" && profileName !== "large") {
      return {};
    }
    const sizeBytes = Number.isFinite(datasetInfo?.sizeBytes) ? datasetInfo.sizeBytes : 0;
    const isFull =
      datasetInfo?.name === "d3fend-full" ||
      datasetInfo?.label === "d3fend-full" ||
      sizeBytes > 6 * 1024 * 1024;
    const hw = Number.isFinite(self.navigator?.hardwareConcurrency) && self.navigator.hardwareConcurrency > 0
      ? self.navigator.hardwareConcurrency
      : null;
    const workerCap = isFull ? 8 : 16;
    const workers = hw ? Math.min(workerCap, hw) : workerCap;
    return { workers, parallel: 2 };
  }

  function resolveWorkersOverride(workersOverride, defaults) {
    const parsed = Number.parseInt(workersOverride || "", 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
    if (Number.isFinite(defaults.workers) && defaults.workers > 0) {
      return defaults.workers;
    }
    return null;
  }

  function resolveParallelOverride(parallelOverrideValue, defaults) {
    if (Number.isFinite(parallelOverrideValue) && parallelOverrideValue > 0) {
      return parallelOverrideValue;
    }
    if (Number.isFinite(defaults.parallel) && defaults.parallel > 0) {
      return defaults.parallel;
    }
    return null;
  }

  function applyLoggingDefaults(overrides) {
    if (debug) {
      return;
    }
    overrides["Konclude.Logging.MinLoggingLevel"] = "60";
    overrides["Konclude.Logging.MaxLogMessageCount"] = "2000";
  }

  function applyWorkerOverride(overrides, workersOverride) {
    const workers = Number.parseInt(workersOverride || "", 10);
    if (Number.isFinite(workers) && workers > 0) {
      const maxCores = Number.isFinite(self.navigator?.hardwareConcurrency)
        ? self.navigator.hardwareConcurrency
        : null;
      const cappedWorkers = maxCores ? Math.min(workers, maxCores) : workers;
      if (cappedWorkers !== workers) {
        console.warn("capping workers to", cappedWorkers);
      }
      overrides["Konclude.Calculation.ProcessorCount"] = String(cappedWorkers);
      overrides["Konclude.Calculation.WorkerCount"] = String(cappedWorkers);
    }
  }

  function buildOverrides(workersOverride, parallelOverrideValue, profileName, datasetInfo) {
    const defaults = resolveProfileDefaults(profileName, datasetInfo);
    const overrides = {};
    const resolvedWorkers = resolveWorkersOverride(workersOverride, defaults);
    if (resolvedWorkers) {
      applyWorkerOverride(overrides, resolvedWorkers);
    }
    const resolvedParallel = resolveParallelOverride(parallelOverrideValue, defaults);
    if (resolvedParallel) {
      applyParallelOverride(overrides, resolvedParallel);
    }
    applyLoggingDefaults(overrides);
    return overrides;
  }

  function applyWasmOverrides(moduleResolved, overrides) {
    if (!moduleResolved || typeof moduleResolved.cwrap !== "function") {
      return;
    }
    let setConfig = null;
    let resetConfig = null;
    try {
      setConfig = moduleResolved.cwrap("konclude_set_config", "number", ["string", "string"]);
      resetConfig = moduleResolved.cwrap("konclude_reset_config_overrides", "number", []);
    } catch (err) {
      console.warn("konclude config overrides not available", err);
      return;
    }
    if (!setConfig || !resetConfig) {
      return;
    }
    resetConfig();
    for (const [key, value] of Object.entries(overrides || {})) {
      setConfig(key, String(value));
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
        if (debug) {
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
    if (debug && exceptionState.typePtr && !exceptionState.mangled) {
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
    const safeCwrap = (name, ret, args) => {
      try {
        return moduleResolved.cwrap(name, ret, args);
      } catch (err) {
        return null;
      }
    };
    const classifyFiles = preferBlocking
      ? safeCwrap("konclude_classify_files", "number", ["string", "string"])
      : null;
    const consistencyFiles = preferBlocking
      ? safeCwrap("konclude_consistency_files", "number", ["string", "string"])
      : null;
    const realiseFiles = preferBlocking ? safeCwrap("konclude_realise_files", "number", ["string", "string"]) : null;
    const realizeFiles = preferBlocking ? safeCwrap("konclude_realize_files", "number", ["string", "string"]) : null;

    const overrides = buildOverrides(workersParam, parallelOverride, profile, dataset);
    if (debug) {
      console.log("[konclude] worker applying profile", { profile, overrides });
    }
    applyWasmOverrides(moduleResolved, overrides);

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

    const runBlockingCommand = (label, fn, outputPath, readBytes) => {
      const start = Date.now();
      const code = fn(inPath, outputPath);
      const status = code === 0 ? 1 : -1;
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

    if (only !== "consistency" && only !== "realization" && only !== "realisation") {
      console.log("worker submitting classify job");
      if (classifyFiles) {
        classify = runBlockingCommand("classification", classifyFiles, classifyOutputPath, 2048);
      } else {
        classify = await runJob("classification", classifyOutputPath, 2048);
      }
      console.log("worker classify done", classify);
    }

    if (only !== "classification" && only !== "realization" && only !== "realisation") {
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
        if (consistencyFiles) {
          consistency = runBlockingCommand("consistency", consistencyFiles, "consistency.txt", 256);
        } else {
          consistency = await runJob("consistency", "consistency.txt", 256);
        }
        console.log("worker consistency done", consistency);
        consistent = consistency.output.trim().toLowerCase() === "true";
      }
    }

    let realization = null;
    if (only === "realization" || only === "realisation") {
      console.log("worker submitting realization job");
      const realizeFn = realizeFiles || realiseFiles;
      if (!realizeFn) {
        throw new Error("realization not available in wasm module");
      }
      realization = runBlockingCommand("realization", realizeFn, "realize.owl.xml", 2048);
      console.log("worker realization done", realization);
    }

    const classifyOk = !classify || (classify.status === 1 && classify.code === 0);
    const consistencyOk =
      !consistency || (consistency.status === 1 && consistency.code === 0 && consistent);
    const realizationOk = !realization || (realization.status === 1 && realization.code === 0);
    const ok = classifyOk && consistencyOk && realizationOk;
    const error = ok ? null : "konclude job failed";
    const consistencyPayload = consistency ? { ...consistency, consistent } : null;

    self.postMessage({
      ok,
      profile,
      dataset,
      classification: classify,
      realization,
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
    self.postMessage({ ok: false, profile, error: err?.message || String(err) || "worker failure" });
  }
};
