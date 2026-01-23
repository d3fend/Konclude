/*
 * Konclude WebAssembly C API bridge.
 */

#include "konclude_wasm_api.h"

#include <cstdlib>
#include <cstring>
#include <atomic>
#include <deque>
#include <exception>
#include <memory>
#include <unordered_map>

#include <QCoreApplication>
#include <QByteArray>
#include <QDir>
#include <QEvent>
#include <QEventLoop>
#include <QFile>
#include <QFileInfo>
#include <QHash>
#include <QMap>
#include <QMutex>
#include <QMutexLocker>
#include <QTemporaryFile>
#include <QThread>
#include <QStringList>

#include "Config/CConfiguration.h"
#include "Config/CConfigData.h"
#include "Utilities/CSingletonProvider.hpp"

#ifdef __EMSCRIPTEN__
#ifdef __EMSCRIPTEN_PTHREADS__
#include <emscripten/threading.h>
#endif
#endif
#include "CKoncludeInfo.h"
#include "Logger/CLogger.h"
#include "Control/Loader/CCommandLineLoader.h"
#include "Control/Loader/CDefaultLoaderFactory.h"
#include "Control/Loader/CDefaultReasonerLoader.h"
#include "Control/Loader/CCLIClassClassificationBatchProcessingLoader.h"
#include "Control/Loader/CCLIConsistencyBatchProcessingLoader.h"
#include "Control/Loader/CCLIRealizationBatchProcessingLoader.h"
#include "Control/Interface/CommandLine/CCommandLinePreparationTranslatorSelector.h"
#include "Control/Command/CReasonerConfigurationGroup.h"
#include "WasmBridge/konclude_wasm_runtime.h"

using namespace Konclude;
using namespace Konclude::Logger;
using namespace Konclude::Control::Loader;
using namespace Konclude::Control::Interface::CommandLine;

namespace {

#ifdef __EMSCRIPTEN__
	static std::atomic<int> gWasmProcessingDone{0};
	static bool gWasmThreadsChecked = false;
	static bool gWasmThreadsEnabled = false;
	extern "C" void konclude_wasm_notify_processing_complete() {
		gWasmProcessingDone.store(1, std::memory_order_release);
	}
	extern "C" void konclude_wasm_reset_processing_complete() {
		gWasmProcessingDone.store(0, std::memory_order_release);
	}
	extern "C" int konclude_wasm_is_processing_complete() {
		return gWasmProcessingDone.load(std::memory_order_acquire) ? 1 : 0;
	}

	static void ensureWasmThreadingState() {
#if defined(__EMSCRIPTEN_PTHREADS__)
		// Re-evaluate threading availability to avoid caching a false value too early.
		gWasmThreadsEnabled = emscripten_has_threading_support();
		gWasmThreadsChecked = true;
#else
		gWasmThreadsEnabled = false;
		gWasmThreadsChecked = true;
#endif
	}

	extern "C" int konclude_wasm_threads_enabled() {
		ensureWasmThreadingState();
		return gWasmThreadsEnabled ? 1 : 0;
	}

	std::atomic<int> gWasmAllowQuit{0};
	std::atomic<int> gWasmQuitSeen{0};

	class CWasmQuitFilter : public QObject {
		public:
			CWasmQuitFilter(QObject* parent = nullptr) : QObject(parent) {}

		protected:
			bool eventFilter(QObject* watched, QEvent* event) override {
				if (event && event->type() == QEvent::Quit) {
					if (!gWasmAllowQuit.load(std::memory_order_acquire)) {
						gWasmQuitSeen.store(1, std::memory_order_release);
						return true;
					}
				}
				return QObject::eventFilter(watched, event);
			}
	};

	CWasmQuitFilter* gWasmQuitFilter = nullptr;

	int runJobBlocking(const char* command, const char* inputPath, const char* outputPath);
#endif

	QCoreApplication* ensureApp() {
		static QCoreApplication* app = nullptr;
		if (!app) {
			static int argc = 1;
			static char arg0[] = "konclude";
			static char* argv[] = { arg0, nullptr };
			app = new QCoreApplication(argc, argv);
		}
#ifdef __EMSCRIPTEN__
		if (app && !gWasmQuitFilter) {
			gWasmQuitFilter = new CWasmQuitFilter(app);
			app->installEventFilter(gWasmQuitFilter);
		}
		QDir::setCurrent("/");
#endif
		return app;
	}

	int runCommandInternal(int argc, const char** argv) {
		if (argc <= 0 || !argv) {
			return -1;
		}

#ifdef __EMSCRIPTEN__
		(void)argc;
		(void)argv;
		return -1;
#endif

		ensureApp();
		CLogger::getInstance();

		CLoaderFactory* loaderFactory = new CDefaultLoaderFactory();
		QStringList arguments = CCommandLineLoader::getEncodedArguments(argc, const_cast<char**>(argv));

		CCommandLinePreparationTranslatorSelector transSelector(loaderFactory);
		arguments = transSelector.translateArguments(arguments);

		CCommandLineLoader* cmdLineLoader = new CCommandLineLoader(arguments, false);
		cmdLineLoader->init(loaderFactory);
		cmdLineLoader->load();

		int exitCode = QCoreApplication::exec();

		cmdLineLoader->exit();
		delete cmdLineLoader;
		delete loaderFactory;
		return exitCode;
	}

	int runSimpleCommand(const char* command, const char* inputPath, const char* outputPath) {
		if (!command || !inputPath || !outputPath) {
			return -1;
		}

		QByteArray cmdUtf8(command);
		QByteArray inUtf8(inputPath);
		QByteArray outUtf8(outputPath);

		const char* argv[] = {
			"Konclude",
			cmdUtf8.constData(),
			"-i",
			inUtf8.constData(),
			"-o",
			outUtf8.constData()
		};
		return runCommandInternal(6, argv);
	}

	int runCommandWithInputBuffer(const char* command, const char* data, size_t len, char** output, size_t* outLen) {
		if (!command || !data || !output || !outLen) {
			return -1;
		}

		QTemporaryFile inputFile(QDir::tempPath() + "/konclude_input_XXXXXX.owl.xml");
		if (!inputFile.open()) {
			return -2;
		}
		if (inputFile.write(data, static_cast<qint64>(len)) < 0) {
			return -3;
		}
		inputFile.flush();
		inputFile.close();

		QTemporaryFile outputFile(QDir::tempPath() + "/konclude_output_XXXXXX.owl.xml");
		if (!outputFile.open()) {
			return -4;
		}
		const QString outPath = outputFile.fileName();
		outputFile.close();

		const QByteArray inPathUtf8 = inputFile.fileName().toUtf8();
		const QByteArray outPathUtf8 = outPath.toUtf8();

		const char* argv[] = {
			"Konclude",
			command,
			"-i",
			inPathUtf8.constData(),
			"-o",
			outPathUtf8.constData()
		};

#ifdef __EMSCRIPTEN__
		int exitCode = runJobBlocking(command, inPathUtf8.constData(), outPathUtf8.constData());
#else
		int exitCode = runCommandInternal(6, argv);
#endif

		QFile outFile(outPath);
		if (!outFile.open(QIODevice::ReadOnly)) {
			return -5;
		}
		const QByteArray outBytes = outFile.readAll();
		outFile.close();

		char* buffer = static_cast<char*>(std::malloc(static_cast<size_t>(outBytes.size()) + 1));
		if (!buffer) {
			return -6;
		}
		std::memcpy(buffer, outBytes.constData(), static_cast<size_t>(outBytes.size()));
		buffer[outBytes.size()] = '\0';

		*output = buffer;
		*outLen = static_cast<size_t>(outBytes.size());
		return exitCode;
	}

#ifdef __EMSCRIPTEN__
	struct CWasmJob {
		int id = 0;
		QString command;
		QString inputPath;
		QString outputPath;
		int exitCode = -999;
		bool done = false;
		bool error = false;
		bool quitSeen = false;
		int outputCheckCount = 0;
		CCLIBatchProcessingLoader* cliLoader = nullptr;
	};

	class CWasmJobManager {
		public:
			static CWasmJobManager& instance() {
				static CWasmJobManager manager;
				return manager;
			}

			bool setConfigOverride(const QString& key, const QString& value) {
				if (key.isEmpty()) {
					return false;
				}
				QMutexLocker locker(&mConfigMutex);
				mConfigOverrides.insert(key, value);
				if (mConfiguration) {
					CConfigData* confData = mConfiguration->createAndSetConfig(key);
					if (confData) {
						confData->readFromString(value);
					}
				}
				return true;
			}

			bool removeConfigOverride(const QString& key) {
				if (key.isEmpty()) {
					return false;
				}
				QMutexLocker locker(&mConfigMutex);
				return mConfigOverrides.remove(key) > 0;
			}

			void clearConfigOverrides() {
				QMutexLocker locker(&mConfigMutex);
				mConfigOverrides.clear();
			}

			int setConfigOverrideUtf8(const char* key, const char* value) {
				if (!key || std::strlen(key) == 0) {
					return -1;
				}
				const QString qKey = QString::fromUtf8(key);
				if (!value) {
					removeConfigOverride(qKey);
					return 0;
				}
				return setConfigOverride(qKey, QString::fromUtf8(value)) ? 0 : -1;
			}

			int resetConfigOverrides() {
				clearConfigOverrides();
				return 0;
			}

			int submitJob(const char* command, const char* inputPath, const char* outputPath) {
				if (!command || !inputPath || !outputPath) {
					return -1;
				}
				CWasmJob* job = new CWasmJob();
				job->id = ++mNextJobId;
				job->command = QString::fromUtf8(command);
				job->inputPath = QString::fromUtf8(inputPath);
				job->outputPath = QString::fromUtf8(outputPath);
				mJobs[job->id] = std::unique_ptr<CWasmJob>(job);
				mQueue.push_back(job->id);
				if (mActiveJobId == 0) {
					startNextJob();
				}
				return job->id;
			}

			int jobStatus(int id) const {
				auto it = mJobs.find(id);
				if (it == mJobs.end()) {
					return -2;
				}
				const CWasmJob* job = it->second.get();
				if (!job->done) {
					return 0;
				}
				return job->error ? -1 : 1;
			}

			int jobExitCode(int id) const {
				auto it = mJobs.find(id);
				if (it == mJobs.end()) {
					return -2;
				}
				const CWasmJob* job = it->second.get();
				if (!job->done) {
					return -999;
				}
				return job->exitCode;
			}

			void freeJob(int id) {
				if (id == mActiveJobId) {
					return;
				}
				for (auto it = mQueue.begin(); it != mQueue.end(); ) {
					if (*it == id) {
						it = mQueue.erase(it);
					} else {
						++it;
					}
				}
				mJobs.erase(id);
			}

			void tick(int maxMs) {
				QCoreApplication* app = ensureApp();
				if (app) {
					QCoreApplication::processEvents(QEventLoop::AllEvents, maxMs);
				}
				if (mActiveJobId == 0 && gWasmQuitSeen.load(std::memory_order_acquire)) {
					gWasmQuitSeen.store(0, std::memory_order_release);
				}
				if (mActiveJobId != 0) {
					auto it = mJobs.find(mActiveJobId);
					if (it != mJobs.end()) {
						CWasmJob* job = it->second.get();
						if (konclude_wasm_is_processing_complete()) {
							konclude_wasm_reset_processing_complete();
							finishJob(job);
						} else if (gWasmQuitSeen.load(std::memory_order_acquire)) {
							job->quitSeen = true;
							gWasmQuitSeen.store(0, std::memory_order_release);
							finishJob(job);
						}
					} else if (gWasmQuitSeen.load(std::memory_order_acquire)) {
						gWasmQuitSeen.store(0, std::memory_order_release);
						mActiveJobId = 0;
					}
				}
				if (mActiveJobId == 0 && !mQueue.empty()) {
					startNextJob();
				}
			}

		private:
			CWasmJobManager() = default;

			bool startJob(CWasmJob* job) {
				if (!job) {
					return false;
				}

#ifdef __EMSCRIPTEN__
				konclude_wasm_reset_processing_complete();
#endif
				ensureApp();
				CLogger::getInstance();

#ifdef __EMSCRIPTEN__
				QDir::setCurrent("/");
#endif
				QFileInfo inputInfo(job->inputPath);
				job->inputPath = inputInfo.absoluteFilePath();
				inputInfo.setFile(job->inputPath);

				QFileInfo outputInfo(job->outputPath);
				job->outputPath = outputInfo.absoluteFilePath();
				outputInfo.setFile(job->outputPath);

				if (!inputInfo.exists() || !inputInfo.isFile()) {
					LOG(ERROR,"::Konclude::Wasm",QString("Input file not found: %1 (cwd: %2)").arg(job->inputPath).arg(QDir::currentPath()),0);
					return false;
				}

				if (!outputInfo.absolutePath().isEmpty()) {
					QDir().mkpath(outputInfo.absolutePath());
				}

				if (!mConfiguration) {
					CConfigurationGroup* reasonerConfigGroup = CSingletonProvider<CReasonerConfigurationGroup>::getInstance()->getReferencedConfigurationGroup();
					mConfiguration = new CConfiguration(reasonerConfigGroup);
				}

				const QString commandLower = job->command.toLower();
				const bool isConsistency = (commandLower == "consistency" || commandLower == "cons");
				const bool allowFullCompletionGraph = isConsistency && inputInfo.size() > 0 && inputInfo.size() <= (5 * 1024 * 1024);
				const bool cacheEnabled = false;

				auto setConfigValue = [&](const QString& name, const QString& value) {
					CConfigData* confData = mConfiguration->createAndSetConfig(name);
					if (confData) {
						confData->readFromString(value);
					}
				};

				setConfigValue("Konclude.Calculation.BlockingThreadPoolThreadsCount", "0");
#if defined(__EMSCRIPTEN_PTHREADS__)
				const bool wasmThreadsEnabled = konclude_wasm_threads_enabled() != 0;
				cint64 detectedCores = 0;
#ifdef __EMSCRIPTEN_PTHREADS__
				detectedCores = emscripten_num_logical_cores();
#endif
				if (!wasmThreadsEnabled) {
					detectedCores = 1;
				}
				if (detectedCores <= 0) {
					detectedCores = QThread::idealThreadCount();
				}
				if (detectedCores <= 0) {
					detectedCores = 1;
				}
				cint64 threadOverhead = 0;
#ifdef KONCLUDE_WASM_PTHREAD_OVERHEAD
				threadOverhead = KONCLUDE_WASM_PTHREAD_OVERHEAD;
#endif
				if (threadOverhead < 0) {
					threadOverhead = 0;
				}
				cint64 poolCount = detectedCores + threadOverhead;
				if (poolCount < detectedCores) {
					poolCount = detectedCores;
				}
#ifdef KONCLUDE_WASM_PTHREAD_POOL
#if KONCLUDE_WASM_PTHREAD_POOL > 0
				poolCount = KONCLUDE_WASM_PTHREAD_POOL;
				if (poolCount < 1) {
					poolCount = 1;
				}
#endif
#endif
				bool useAllThreads = true;
				const bool enableUnsatCache = cacheEnabled;
				const bool enableSatExpCache = cacheEnabled;
				const bool enableReuseCompGraphCache = cacheEnabled;
				const bool enableSatNodeExpCache = cacheEnabled;
				const bool enableCompConsCache = cacheEnabled;
				bool enableBackendCache = true;
				{
					QMutexLocker locker(&mConfigMutex);
					auto it = mConfigOverrides.constFind("Konclude.Calculation.Optimization.IndividualsBackendCacheLoading");
					if (it != mConfigOverrides.constEnd()) {
						const QString value = it.value().trimmed().toLower();
						if (value == "false" || value == "0") {
							enableBackendCache = false;
						} else if (value == "true" || value == "1") {
							enableBackendCache = true;
						}
					}
				}
				const bool enableOccStatsCache = false;
				const cint64 cacheThreadReserve =
						(enableUnsatCache ? 1 : 0) +
						(enableSatExpCache ? 1 : 0) +
						(enableReuseCompGraphCache ? 1 : 0) +
						(enableSatNodeExpCache ? 1 : 0) +
						(enableCompConsCache ? 1 : 0) +
						(enableBackendCache ? 1 : 0) +
						(enableOccStatsCache ? 1 : 0);
				// Reserve threads for manager/precompute/classifier/etc. in addition to caches.
				const cint64 baseThreadReserve = threadOverhead > 0 ? qMin<cint64>(10, threadOverhead) : 0;
				const cint64 safetyThreadReserve = threadOverhead > 0 ? qMax<cint64>(2, threadOverhead / 8) : 0;
				cint64 procCount = detectedCores;
#ifdef KONCLUDE_WASM_PROCESSOR_COUNT
#if KONCLUDE_WASM_PROCESSOR_COUNT > 0
				useAllThreads = false;
				procCount = KONCLUDE_WASM_PROCESSOR_COUNT;
#endif
#endif
				if (procCount <= 0) {
					procCount = 1;
				}
				{
					QMutexLocker locker(&mConfigMutex);
					auto it = mConfigOverrides.constFind("Konclude.Calculation.ProcessorCount");
					if (it == mConfigOverrides.constEnd()) {
						it = mConfigOverrides.constFind("Konclude.Calculation.WorkerCount");
					}
					if (it != mConfigOverrides.constEnd()) {
						bool ok = false;
						const cint64 overrideProc = it.value().toLongLong(&ok);
						if (ok && overrideProc > 0) {
							useAllThreads = false;
							procCount = overrideProc;
						}
					}
				}
				const cint64 reserveCount = cacheThreadReserve + baseThreadReserve + safetyThreadReserve;
				cint64 maxProc = poolCount - reserveCount;
				if (maxProc < 1) {
					maxProc = 1;
				}
				const bool procCountReduced = procCount > maxProc;
				if (procCountReduced) {
					procCount = maxProc;
				}
				cint64 threadPoolMax = poolCount - reserveCount - procCount;
				if (threadPoolMax < 0) {
					threadPoolMax = 0;
				}
#ifdef __EMSCRIPTEN__
				if (procCountReduced) {
					LOG(INFO, "::Konclude::Wasm",
							QString("Thread reserve=%1 reduces procCount to %2 (pool=%3)")
									.arg(reserveCount + threadPoolMax)
									.arg(procCount)
									.arg(poolCount),
							0);
				}
#endif
				if (!wasmThreadsEnabled) {
					procCount = 1;
					threadPoolMax = 0;
					useAllThreads = false;
				}
				const QString procCountString = QString::number(procCount);
				setConfigValue("Konclude.Calculation.ProcessorCount", procCountString);
				setConfigValue("Konclude.Calculation.WorkerCount", procCountString);
				setConfigValue("Konclude.Calculation.AdaptThreadPoolSizeProcessorCount", threadPoolMax > 0 ? "false" : "true");
				setConfigValue("Konclude.Calculation.ThreadPoolMaxCount", QString::number(threadPoolMax));
#ifdef __EMSCRIPTEN__
				LOG(INFO, "::Konclude::Wasm",
						QString("Thread config cmd=%1 detectedCores=%2 overhead=%3 pool=%4 proc=%5 reserve=%6 poolMax=%7 useAll=%8 threadsEnabled=%9")
								.arg(job->command)
								.arg(detectedCores)
								.arg(threadOverhead)
								.arg(poolCount)
								.arg(procCount)
								.arg(cacheThreadReserve + baseThreadReserve + safetyThreadReserve + threadPoolMax)
								.arg(threadPoolMax)
								.arg(useAllThreads ? "true" : "false")
								.arg(wasmThreadsEnabled ? "true" : "false"),
						0);
#endif
#else
				setConfigValue("Konclude.Calculation.ProcessorCount", "1");
				setConfigValue("Konclude.Calculation.WorkerCount", "1");
				setConfigValue("Konclude.Calculation.AdaptThreadPoolSizeProcessorCount", "false");
#endif
				setConfigValue("Konclude.CLI.RequestFile", job->inputPath);
				setConfigValue("Konclude.CLI.ResponseFile", job->outputPath);
				setConfigValue("Konclude.CLI.CloseAfterProcessedRequest", "true");
				setConfigValue("Konclude.CLI.BlockUntilProcessedRequest", "false");
				if (commandLower == "classification") {
					const QString consistencyPath = job->outputPath + ".consistency.txt";
					setConfigValue("Konclude.CLI.ConsistencyResponseFile", consistencyPath);
				} else {
					setConfigValue("Konclude.CLI.ConsistencyResponseFile", "");
				}
				auto setConfigBool = [&](const QString& name, bool value) {
					setConfigValue(name, value ? "true" : "false");
				};
				setConfigBool("Konclude.Calculation.Optimization.UnsatisfiableCacheRetrieval", cacheEnabled);
				setConfigBool("Konclude.Calculation.Optimization.UnsatisfiableCacheSingleLevelWriting", cacheEnabled);
				setConfigBool("Konclude.Calculation.Optimization.UnsatisfiableCacheTestingConceptWriting", cacheEnabled);
				setConfigBool("Konclude.Calculation.Optimization.SatisfiableCacheRetrieval", cacheEnabled);
				setConfigBool("Konclude.Calculation.Optimization.SatisfiableCacheSingleLevelWriting", cacheEnabled);
				setConfigBool("Konclude.Calculation.Optimization.SatisfiableExpansionCacheRetrieval", cacheEnabled);
				setConfigBool("Konclude.Calculation.Optimization.SatisfiableExpansionCacheWriting", cacheEnabled);
				setConfigBool("Konclude.Calculation.Optimization.SatisfiableExpansionCacheConceptExpansion", cacheEnabled);
				setConfigBool("Konclude.Calculation.Optimization.SatisfiableExpansionCacheSatisfiableBlocking", cacheEnabled);
				setConfigBool("Konclude.Calculation.Optimization.CompletionGraphCaching", cacheEnabled);
				setConfigBool("Konclude.Calculation.Optimization.SaturationExpansionSatisfiabilityCacheWriting", cacheEnabled);
				setConfigBool("Konclude.Calculation.Optimization.SaturationUnsatisfiabilityCacheWriting", cacheEnabled);
				setConfigBool("Konclude.Calculation.Optimization.ComputedTypesCaching", cacheEnabled);
				setConfigBool("Konclude.Calculation.Optimization.IndividualsBackendCacheLoading", enableBackendCache);
				setConfigBool("Konclude.Calculation.Optimization.OccurrenceStatisticsCollecting", false);
				// Enable preprocessing to avoid slow on-demand computation in large runs.
				if (!isConsistency) {
					setConfigValue("Konclude.Calculation.Preprocessing.OntologyPrecomputation", "true");
					setConfigValue("Konclude.Calculation.Preprocessing.CheckingOntologyConsistency", "true");
					setConfigValue("Konclude.Calculation.Preprocessing.CoreConceptCyclesPrecomputation", "true");
					setConfigValue("Konclude.Calculation.Preprocessing.CoreConceptCyclesExtraction", "true");
					// Drop triples data after indexing to reduce memory for large ontologies.
					setConfigValue("Konclude.Calculation.Preprocessing.TripleEncodedAssertionsIndexing.DeleteTriplesDataAfterIndexing", "true");
				} else {
					// Keep ontology precomputation enabled; avoid full completion graphs for memory safety.
					setConfigValue("Konclude.Calculation.Preprocessing.OntologyPrecomputation", "true");
					setConfigValue("Konclude.Calculation.Preprocessing.CheckingOntologyConsistency", "true");
					setConfigValue("Konclude.Calculation.Preprocessing.CoreConceptCyclesPrecomputation", "true");
					setConfigValue("Konclude.Calculation.Preprocessing.CoreConceptCyclesExtraction", "true");
					// Avoid full completion graph construction in memory-constrained wasm runs unless the input is small.
					setConfigValue("Konclude.Calculation.Precomputation.ForceFullCompletionGraphConstruction", "false");
					setConfigValue("Konclude.Calculation.Precomputation.ConditionalFullCompletionGraphConstruction", allowFullCompletionGraph ? "true" : "false");
					// Drop triples data after indexing to save memory.
					setConfigValue("Konclude.Calculation.Preprocessing.TripleEncodedAssertionsIndexing.DeleteTriplesDataAfterIndexing", "true");
				}
				// Reduce memory spikes in WASM by shrinking allocation growth.
				setConfigValue("Konclude.Calculation.Memory.IncreaseAllocationSize", "67108864");
				// Keep backend cache aligned with overrides before applying them.
				setConfigValue("Konclude.Calculation.Optimization.IndividualsBackendCacheLoading", enableBackendCache ? "true" : "false");
				// Cache-heavy optimizations: keep them enabled in WASM for better performance.
				const QString cacheFlag = cacheEnabled ? "true" : "false";
				setConfigValue("Konclude.Calculation.Optimization.OccurrenceStatisticsCollecting", "false");
				setConfigValue("Konclude.Calculation.Optimization.ComputedTypesCaching", cacheFlag);
				setConfigValue("Konclude.Calculation.Optimization.SaturationExpansionSatisfiabilityCacheWriting", cacheFlag);
				setConfigValue("Konclude.Calculation.Optimization.SaturationUnsatisfiabilityCacheWriting", cacheFlag);
				setConfigValue("Konclude.Calculation.Optimization.UnsatisfiableCacheRetrieval", cacheFlag);
				setConfigValue("Konclude.Calculation.Optimization.SatisfiableCacheRetrieval", cacheFlag);
				setConfigValue("Konclude.Calculation.Optimization.UnsatisfiableCacheSingleLevelWriting", cacheFlag);
				setConfigValue("Konclude.Calculation.Optimization.UnsatisfiableCacheTestingConceptWriting", cacheFlag);
				setConfigValue("Konclude.Calculation.Optimization.SatisfiableCacheSingleLevelWriting", cacheFlag);
				setConfigValue("Konclude.Calculation.Optimization.SatisfiableExpansionCacheRetrieval", cacheFlag);
				setConfigValue("Konclude.Calculation.Optimization.SatisfiableExpansionCacheConceptExpansion", cacheFlag);
				setConfigValue("Konclude.Calculation.Optimization.SatisfiableExpansionCacheSatisfiableBlocking", cacheFlag);
				setConfigValue("Konclude.Calculation.Optimization.SatisfiableExpansionCacheWriting", cacheFlag);
				setConfigValue("Konclude.Calculation.Optimization.CompletionGraphCaching", cacheFlag);
				setConfigValue("Konclude.Calculation.Optimization.CompletionGraphReuseCachingRetrieval", cacheFlag);
				setConfigValue("Konclude.Calculation.Optimization.CompletionGraphDeterministicReuse", cacheFlag);
				setConfigValue("Konclude.Calculation.Optimization.CompletionGraphNonDeterministicReuse", cacheFlag);
				setConfigValue("Konclude.Calculation.Optimization.SignatureSaving", cacheFlag);
				setConfigValue("Konclude.Calculation.Optimization.SignatureMirroringBlocking", cacheFlag);
				// Scale parallel subsumption for classification runs to available workers.
#if defined(__EMSCRIPTEN_PTHREADS__)
				if (commandLower == "classification") {
					setConfigValue("Konclude.Calculation.Classification.MaximumParallelSubsumptionCalculationCount", procCountString);
				} else {
					setConfigValue("Konclude.Calculation.Classification.MaximumParallelSubsumptionCalculationCount", "1");
				}
#else
				setConfigValue("Konclude.Calculation.Classification.MaximumParallelSubsumptionCalculationCount", "1");
#endif
				{
					QMutexLocker locker(&mConfigMutex);
					for (auto it = mConfigOverrides.constBegin(); it != mConfigOverrides.constEnd(); ++it) {
						setConfigValue(it.key(), it.value());
					}
				}

				if (!mReasonerLoader) {
					mReasonerLoader = new CDefaultReasonerLoader();
					mReasonerLoader->init(nullptr, mConfiguration);
					mReasonerLoader->load();
				}
				if (commandLower == "classification") {
					job->cliLoader = new CCLIClassClassificationBatchProcessingLoader();
				} else if (commandLower == "consistency" || commandLower == "cons") {
					job->cliLoader = new CCLIConsistencyBatchProcessingLoader();
				} else if (commandLower == "realisation" || commandLower == "realization") {
					job->cliLoader = new CCLIRealizationBatchProcessingLoader();
				} else {
					return false;
				}

				job->cliLoader->init(nullptr, mConfiguration);
				job->cliLoader->load();
				job->done = false;
				job->error = false;
				job->exitCode = -999;
				mActiveJobId = job->id;
				return true;
			}

			void startNextJob() {
				if (mQueue.empty()) {
					return;
				}
				const int id = mQueue.front();
				mQueue.pop_front();
				auto it = mJobs.find(id);
				if (it == mJobs.end()) {
					return;
				}
				if (!startJob(it->second.get())) {
					it->second->done = true;
					it->second->error = true;
					it->second->exitCode = -1;
					mActiveJobId = 0;
				}
			}

			void finishJob(CWasmJob* job) {
				if (!job) {
					return;
				}

				const bool ok = isOutputReady(job);

				if (job->cliLoader) {
					job->cliLoader->exit();
					delete job->cliLoader;
					job->cliLoader = nullptr;
				}
				// Keep the reasoner/config alive in WASM to avoid teardown hangs between jobs.
				job->done = true;
				job->error = !ok;
				job->exitCode = ok ? 0 : -1;
				mActiveJobId = 0;
			}

			bool isOutputReady(const CWasmJob* job) const {
				if (!job) {
					return false;
				}
				QFileInfo outInfo(job->outputPath);
				const bool ready = outInfo.exists() && outInfo.isFile() && outInfo.size() > 0;
				return ready;
			}

		private:
			int mNextJobId = 0;
			int mActiveJobId = 0;
			CConfiguration* mConfiguration = nullptr;
			CDefaultReasonerLoader* mReasonerLoader = nullptr;
			QMap<QString, QString> mConfigOverrides;
			QMutex mConfigMutex;
			std::deque<int> mQueue;
			std::unordered_map<int, std::unique_ptr<CWasmJob>> mJobs;
	};

	int runJobBlocking(const char* command, const char* inputPath, const char* outputPath) {
		if (!command || !inputPath || !outputPath) {
			return -1;
		}
		int jobId = CWasmJobManager::instance().submitJob(command, inputPath, outputPath);
		if (jobId < 0) {
			return -1;
		}
		while (true) {
			CWasmJobManager::instance().tick(25);
			const int status = CWasmJobManager::instance().jobStatus(jobId);
			if (status == 1) {
				const int exitCode = CWasmJobManager::instance().jobExitCode(jobId);
				CWasmJobManager::instance().freeJob(jobId);
				return exitCode;
			}
			if (status < 0) {
				CWasmJobManager::instance().freeJob(jobId);
				return -1;
			}
		}
	}
#endif

} // namespace

int konclude_run_command(int argc, const char** argv) {
#ifdef __EMSCRIPTEN__
	(void)argc;
	(void)argv;
	return -1;
#else
	return runCommandInternal(argc, argv);
#endif
}

int konclude_classify_files(const char* input_path, const char* output_path) {
#ifdef __EMSCRIPTEN__
	return runJobBlocking("classification", input_path, output_path);
#else
	return runSimpleCommand("classification", input_path, output_path);
#endif
}

int konclude_consistency_files(const char* input_path, const char* output_path) {
#ifdef __EMSCRIPTEN__
	return runJobBlocking("consistency", input_path, output_path);
#else
	return runSimpleCommand("consistency", input_path, output_path);
#endif
}

int konclude_realise_files(const char* input_path, const char* output_path) {
#ifdef __EMSCRIPTEN__
	return runJobBlocking("realisation", input_path, output_path);
#else
	return runSimpleCommand("realisation", input_path, output_path);
#endif
}

int konclude_realize_files(const char* input_path, const char* output_path) {
#ifdef __EMSCRIPTEN__
	return runJobBlocking("realisation", input_path, output_path);
#else
	return runSimpleCommand("realisation", input_path, output_path);
#endif
}

int konclude_classify_owl2xml(const char* data, size_t len, char** output, size_t* out_len) {
#ifdef __EMSCRIPTEN__
	return runCommandWithInputBuffer("classification", data, len, output, out_len);
#else
	return runCommandWithInputBuffer("classification", data, len, output, out_len);
#endif
}

int konclude_consistency_owl2xml(const char* data, size_t len, char** output, size_t* out_len) {
#ifdef __EMSCRIPTEN__
	return runCommandWithInputBuffer("consistency", data, len, output, out_len);
#else
	return runCommandWithInputBuffer("consistency", data, len, output, out_len);
#endif
}

int konclude_realise_owl2xml(const char* data, size_t len, char** output, size_t* out_len) {
#ifdef __EMSCRIPTEN__
	return runCommandWithInputBuffer("realisation", data, len, output, out_len);
#else
	return runCommandWithInputBuffer("realisation", data, len, output, out_len);
#endif
}

int konclude_realize_owl2xml(const char* data, size_t len, char** output, size_t* out_len) {
#ifdef __EMSCRIPTEN__
	return runCommandWithInputBuffer("realisation", data, len, output, out_len);
#else
	return runCommandWithInputBuffer("realisation", data, len, output, out_len);
#endif
}

#ifdef __EMSCRIPTEN__
int konclude_submit_job(const char* command, const char* input_path, const char* output_path) {
	return CWasmJobManager::instance().submitJob(command, input_path, output_path);
}

int konclude_submit_classify_files(const char* input_path, const char* output_path) {
	return CWasmJobManager::instance().submitJob("classification", input_path, output_path);
}

int konclude_submit_realise_files(const char* input_path, const char* output_path) {
	return CWasmJobManager::instance().submitJob("realisation", input_path, output_path);
}

int konclude_submit_realize_files(const char* input_path, const char* output_path) {
	return CWasmJobManager::instance().submitJob("realisation", input_path, output_path);
}

int konclude_job_status(int job_id) {
	return CWasmJobManager::instance().jobStatus(job_id);
}

int konclude_job_exit_code(int job_id) {
	return CWasmJobManager::instance().jobExitCode(job_id);
}

void konclude_job_free(int job_id) {
	CWasmJobManager::instance().freeJob(job_id);
}

void konclude_tick(int max_ms) {
#ifdef __EMSCRIPTEN__
	try {
		CWasmJobManager::instance().tick(max_ms);
	} catch (const std::exception& ex) {
		LOG(ERROR,"::Konclude::Wasm",QString("Tick exception: %1").arg(QString::fromUtf8(ex.what())),0);
		konclude_wasm_notify_processing_complete();
	} catch (...) {
		LOG(ERROR,"::Konclude::Wasm",QString("Tick exception: unknown"),0);
		konclude_wasm_notify_processing_complete();
	}
#else
	CWasmJobManager::instance().tick(max_ms);
#endif
}

int konclude_set_config(const char* key, const char* value) {
	return CWasmJobManager::instance().setConfigOverrideUtf8(key, value);
}

int konclude_reset_config_overrides() {
	return CWasmJobManager::instance().resetConfigOverrides();
}
#endif

void konclude_free(void* ptr) {
	if (ptr) {
		std::free(ptr);
	}
}

void konclude_shutdown() {
#ifdef __EMSCRIPTEN__
		gWasmAllowQuit.store(1, std::memory_order_release);
#endif
	CLogger* logger = CLogger::getInstance();
	if (logger) {
		logger->shutdownLogger();
	}
}
