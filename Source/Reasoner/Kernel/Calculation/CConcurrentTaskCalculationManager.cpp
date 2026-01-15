/*
 *		Copyright (C) 2013-2015, 2019 by the Konclude Developer Team.
 *
 *		This file is part of the reasoning system Konclude.
 *		For details and support, see <http://konclude.com/>.
 *
 *		Konclude is free software: you can redistribute it and/or modify
 *		it under the terms of version 3 of the GNU Lesser General Public
 *		License (LGPLv3) as published by the Free Software Foundation.
 *
 *		Konclude is distributed in the hope that it will be useful,
 *		but WITHOUT ANY WARRANTY; without even the implied warranty of
 *		MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 *		GNU (Lesser) General Public License for more details.
 *
 *		You should have received a copy of the GNU (Lesser) General Public
 *		License along with Konclude. If not, see <http://www.gnu.org/licenses/>.
 *
 */

#include "CConcurrentTaskCalculationManager.h"

#ifdef __EMSCRIPTEN__
#include "Reasoner/Query/CApproximatedSaturationCalculationJob.h"
#endif

namespace Konclude {

	namespace Reasoner {

		namespace Kernel {

			namespace Calculation {


				CConcurrentTaskCalculationManager::CConcurrentTaskCalculationManager(CWatchDog *watchDog) {
					calcContext = nullptr;
					mTaskCalcEn = nullptr;
					mGenTaskHandleContext = nullptr;
					mTemMemMan = nullptr;
				}

				CCalculationManager *CConcurrentTaskCalculationManager::calculateTask(CSatisfiableCalculationTask* task) {
					if (mTaskCalcEn) {
						CTaskEventCommunicator::postSendTaskScheduleEvent(mTaskCalcEn->getSchedulerTaskProcessorUnit()->getEventHandler(),task,mTemMemMan);
					}
					return this;
				}

				CCalculationManager *CConcurrentTaskCalculationManager::calculateJob(CCalculationJob* job, CCallbackData* callbackData) {
#ifdef __EMSCRIPTEN__
					if (!mTaskCalcEn) {
						LOG(ERROR, "::Konclude::Wasm", QString("Calculation manager missing task environment."), this);
						return this;
					}
#endif
					CSatisfiableCalculationTaskFromCalculationJobGenerator gen(mGenTaskHandleContext);
					CSatisfiableCalculationTask* task = gen.createSatisfiableCalculationTask(job,callbackData);
					if (task) {
#ifdef __EMSCRIPTEN__
						static int sCalcJobLogCount = 0;
						if (sCalcJobLogCount < 3) {
							++sCalcJobLogCount;
							QString jobType = QStringLiteral("calculation");
							if (dynamic_cast<CApproximatedSaturationCalculationJob*>(job)) {
								jobType = QStringLiteral("approx-saturation");
							} else if (dynamic_cast<CSatisfiableCalculationJob*>(job)) {
								jobType = QStringLiteral("satisfiable");
							}
							LOG(INFO, "::Konclude::Wasm",
									QString("Scheduling %1 calculation task.").arg(jobType),
									this);
						}
#endif
						calculateTask(task);
#ifdef __EMSCRIPTEN__
					} else {
						QString jobType = QStringLiteral("calculation");
						if (dynamic_cast<CApproximatedSaturationCalculationJob*>(job)) {
							jobType = QStringLiteral("approx-saturation");
						} else if (dynamic_cast<CSatisfiableCalculationJob*>(job)) {
							jobType = QStringLiteral("satisfiable");
						}
						LOG(ERROR, "::Konclude::Wasm", QString("Calculation task generator returned null (%1).").arg(jobType), this);
#endif
					}
					return this;
				}

				CCalculationManager* CConcurrentTaskCalculationManager::calculateJobs(const QList< QPair<CCalculationJob*,CCallbackData*> >& jobCallbackList) {
					CSatisfiableCalculationTask* taskLinker = nullptr;
					CSatisfiableCalculationTaskFromCalculationJobGenerator gen(mGenTaskHandleContext);
					for (QList< QPair<CCalculationJob*,CCallbackData*> >::const_iterator it = jobCallbackList.constBegin(), itEnd = jobCallbackList.constEnd(); it != itEnd; ++it) {
						QPair<CCalculationJob*,CCallbackData*> jobCallbackPair(*it);
						CCalculationJob* job(jobCallbackPair.first);
						CCallbackData* callbackData(jobCallbackPair.second);
						CSatisfiableCalculationTask* task = gen.createSatisfiableCalculationTask(job,callbackData);
						if (task) {
							taskLinker = (CSatisfiableCalculationTask*)task->append(taskLinker);
						}
					}
					if (taskLinker) {
						calculateTask(taskLinker);
					}
					return this;
				}

				CCalculationManager *CConcurrentTaskCalculationManager::initializeManager(CCalculationEnvironmentFactory *contextFactory, CConfigurationProvider *configurationProvider) {
					CConfigurationBase *config = 0;
					calcContext = contextFactory->createCalculationContext(configurationProvider);
					mTaskCalcEn = dynamic_cast<CConcurrentTaskCalculationEnvironment*>(calcContext);
					mGenTaskHandleContext = new CGeneratorTaskHandleContextBase();
					mTemMemMan = mGenTaskHandleContext->getTaskHandleMemoryAllocationManager();
					return this;
				}

				CCalculationEnviroment *CConcurrentTaskCalculationManager::getCalculationContext() {
					return calcContext;
				}


				QString CConcurrentTaskCalculationManager::getCalculationErrorString(cint64 errorCode) {
					switch (errorCode) {
						case 1: {
							return QString("Nominal couldn't be resolved.");
						}
						case 2: {
							return QString("Memory allocation failed / out of memory / memory allocation limit reached.");
						}
						case 3: {
							return QString("Unknow fatal error.");
						}
					}
					return QString("Unknown error.");
				}


				QHash<QString,cint64>* CConcurrentTaskCalculationManager::getCalculationStatistics() {
					QHash<QString,cint64>* statHash = new QHash<QString,cint64>();
					CConcurrentTaskCalculationEnvironment* conTaskEnv = dynamic_cast<CConcurrentTaskCalculationEnvironment*>(calcContext);
					if (conTaskEnv) {
						statHash->insert(QString("calculation-computing-time"),conTaskEnv->getCalculationComputionTime());
						statHash->insert(QString("calculation-blocking-time"),conTaskEnv->getCalculationBlockingTime());
						statHash->insert(QString("calculation-memory-consumption"),conTaskEnv->getCalculationMemoryConsumption());
						statHash->insert(QString("calculation-memory-reservation"),conTaskEnv->getCalculationMemoryReserved());

						statHash->insert(QString("calculation-tasks-processed-count"),conTaskEnv->getCalculationStatisticTasksProcessedCount());
						statHash->insert(QString("calculation-tasks-created-count"),conTaskEnv->getCalculationStatisticTasksCreatedCount());
						statHash->insert(QString("calculation-tasks-added-count"),conTaskEnv->getCalculationStatisticTasksAddedCount());
						statHash->insert(QString("calculation-tasks-updated-count"),conTaskEnv->getCalculationStatisticTasksUpdatedCount());
						statHash->insert(QString("calculation-tasks-completed-count"),conTaskEnv->getCalculationStatisticTasksCompletedCount());
						statHash->insert(QString("calculation-tasks-requested-count"),conTaskEnv->getCalculationStatisticTasksRequestedCount());
						statHash->insert(QString("calculation-threads-blocking-count"),conTaskEnv->getCalculationStatisticThreadsBlockedCount());
						statHash->insert(QString("calculation-threads-events-processed-count"),conTaskEnv->getCalculationStatisticEventsProcessedCount());
					}
					return statHash;
				}

				QHash<QString,cint64>* CConcurrentTaskCalculationManager::getUpdatedCalculationStatistics(QHash<QString,cint64>* stat) {
					QHash<QString,cint64>* statHash = new QHash<QString,cint64>();
					CConcurrentTaskCalculationEnvironment* conTaskEnv = dynamic_cast<CConcurrentTaskCalculationEnvironment*>(calcContext);
					if (conTaskEnv && stat) {
						statHash->insert(QString("calculation-computing-time"),conTaskEnv->getCalculationComputionTime() - stat->value("calculation-computing-time",0));
						statHash->insert(QString("calculation-blocking-time"),conTaskEnv->getCalculationBlockingTime() - stat->value("calculation-blocking-time",0));
						statHash->insert(QString("calculation-memory-consumption"),conTaskEnv->getCalculationMemoryConsumption());
						statHash->insert(QString("calculation-memory-reservation"),conTaskEnv->getCalculationMemoryReserved());
					
						statHash->insert(QString("calculation-tasks-processed-count"),conTaskEnv->getCalculationStatisticTasksProcessedCount() - stat->value("calculation-tasks-processed-count",0));
						statHash->insert(QString("calculation-tasks-created-count"),conTaskEnv->getCalculationStatisticTasksCreatedCount() - stat->value("calculation-tasks-created-count",0));
						statHash->insert(QString("calculation-tasks-added-count"),conTaskEnv->getCalculationStatisticTasksAddedCount() - stat->value("calculation-tasks-added-count",0));
						statHash->insert(QString("calculation-tasks-updated-count"),conTaskEnv->getCalculationStatisticTasksUpdatedCount() - stat->value("calculation-tasks-updated-count",0));
						statHash->insert(QString("calculation-tasks-completed-count"),conTaskEnv->getCalculationStatisticTasksCompletedCount() - stat->value("calculation-tasks-completed-count",0));
						statHash->insert(QString("calculation-tasks-requested-count"),conTaskEnv->getCalculationStatisticTasksRequestedCount() - stat->value("calculation-tasks-requested-count",0));
						statHash->insert(QString("calculation-threads-blocking-count"),conTaskEnv->getCalculationStatisticThreadsBlockedCount() - stat->value("calculation-threads-blocking-count",0));
						statHash->insert(QString("calculation-threads-events-processed-count"),conTaskEnv->getCalculationStatisticEventsProcessedCount() - stat->value("calculation-threads-events-processed-count",0));
					}
					return statHash;
				}

				double CConcurrentTaskCalculationManager::getCalculationApproximatedRemainingTasksCount() {					
					CConcurrentTaskCalculationEnvironment* conTaskEnv = dynamic_cast<CConcurrentTaskCalculationEnvironment*>(calcContext);
					if (conTaskEnv) {
						return conTaskEnv->getCalculationApproximatedRemainingTasksCount();
					}
					return 0.;
				}


			}; // end namespace Calculation

		}; // end namespace Kernel

	}; // end namespace Reasoner

}; // end namespace Konclude
