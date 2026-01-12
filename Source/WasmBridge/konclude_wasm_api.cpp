/*
 * Konclude WebAssembly C API bridge.
 */

#include "konclude_wasm_api.h"

#include <cstdlib>
#include <cstring>
#include <deque>
#include <memory>
#include <unordered_map>

#include <QCoreApplication>
#include <QByteArray>
#include <QDir>
#include <QEvent>
#include <QEventLoop>
#include <QFile>
#include <QFileInfo>
#include <QTemporaryFile>
#include <QStringList>

#ifdef __EMSCRIPTEN__
#include <cstdio>
#endif
#include "CKoncludeInfo.h"
#include "Logger/CLogger.h"
#include "Control/Loader/CCommandLineLoader.h"
#include "Control/Loader/CDefaultLoaderFactory.h"
#include "Control/Interface/CommandLine/CCommandLinePreparationTranslatorSelector.h"

using namespace Konclude;
using namespace Konclude::Logger;
using namespace Konclude::Control::Loader;
using namespace Konclude::Control::Interface::CommandLine;

namespace {

#ifdef __EMSCRIPTEN__
	bool gWasmAllowQuit = false;
	bool gWasmQuitSeen = false;

	class CWasmQuitFilter : public QObject {
		public:
			CWasmQuitFilter(QObject* parent = nullptr) : QObject(parent) {}

		protected:
			bool eventFilter(QObject* watched, QEvent* event) override {
				if (event && event->type() == QEvent::Quit) {
					if (!gWasmAllowQuit) {
						gWasmQuitSeen = true;
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
		CCommandLineLoader* cmdLineLoader = nullptr;
		CLoaderFactory* loaderFactory = nullptr;
	};

	class CWasmJobManager {
		public:
			static CWasmJobManager& instance() {
				static CWasmJobManager manager;
				return manager;
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
				if (mActiveJobId == 0 && gWasmQuitSeen) {
					gWasmQuitSeen = false;
				}
				if (mActiveJobId != 0) {
					auto it = mJobs.find(mActiveJobId);
					if (it != mJobs.end()) {
						CWasmJob* job = it->second.get();
						if (gWasmQuitSeen) {
							job->quitSeen = true;
							gWasmQuitSeen = false;
							finishJob(job);
						} else if (isOutputReady(job)) {
							finishJob(job);
						}
					} else if (gWasmQuitSeen) {
						gWasmQuitSeen = false;
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

				ensureApp();
				CLogger::getInstance();

				QFileInfo inputInfo(job->inputPath);
				if (!inputInfo.exists() || !inputInfo.isFile()) {
					LOG(ERROR,"::Konclude::Wasm",QString("Input file not found: %1 (cwd: %2)").arg(job->inputPath).arg(QDir::currentPath()),0);
					return false;
				}

				QFileInfo outputInfo(job->outputPath);
				if (!outputInfo.absolutePath().isEmpty()) {
					QDir().mkpath(outputInfo.absolutePath());
				}

				job->loaderFactory = new CDefaultLoaderFactory();

				QString loaderName;
				const QString commandLower = job->command.toLower();
				if (commandLower == "classification") {
					loaderName = QString("CLIClassClassificationBatchProcessingLoader");
				} else if (commandLower == "realisation" || commandLower == "realization") {
					loaderName = QString("CLIRealizationBatchProcessingLoader");
				} else {
					delete job->loaderFactory;
					job->loaderFactory = nullptr;
					return false;
				}

				QStringList arguments;
				arguments << "-ConfigurableCoutLogObserverLoader"
						<< "-LoggerConfigurationLoader"
						<< "-DefaultReasonerLoader"
						<< QString("-%1").arg(loaderName)
						<< QString("+Konclude.CLI.RequestFile=%1").arg(job->inputPath)
						<< QString("+Konclude.CLI.ResponseFile=%1").arg(job->outputPath)
						<< "+Konclude.CLI.CloseAfterProcessedRequest=true"
						<< "+Konclude.CLI.BlockUntilProcessedRequest=true";

				job->cmdLineLoader = new CCommandLineLoader(arguments, false);
				job->cmdLineLoader->init(job->loaderFactory);
				job->cmdLineLoader->load();
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

				if (job->cmdLineLoader) {
					job->cmdLineLoader->exit();
					delete job->cmdLineLoader;
					job->cmdLineLoader = nullptr;
				}
				if (job->loaderFactory) {
					delete job->loaderFactory;
					job->loaderFactory = nullptr;
				}

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
				return outInfo.exists() && outInfo.isFile() && outInfo.size() > 0;
			}

		private:
			int mNextJobId = 0;
			int mActiveJobId = 0;
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
	std::fprintf(stderr, "[konclude] classify_files start '%s' -> '%s'\n",
			input_path ? input_path : "(null)",
			output_path ? output_path : "(null)");
	return runJobBlocking("classification", input_path, output_path);
#else
	return runSimpleCommand("classification", input_path, output_path);
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
	CWasmJobManager::instance().tick(max_ms);
}
#endif

void konclude_free(void* ptr) {
	if (ptr) {
		std::free(ptr);
	}
}

void konclude_shutdown() {
#ifdef __EMSCRIPTEN__
	gWasmAllowQuit = true;
#endif
	CLogger* logger = CLogger::getInstance();
	if (logger) {
		logger->shutdownLogger();
	}
}
