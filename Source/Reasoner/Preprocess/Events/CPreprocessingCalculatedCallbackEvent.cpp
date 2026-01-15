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

#include "CPreprocessingCalculatedCallbackEvent.h"

#ifdef __EMSCRIPTEN__
#include <QCoreApplication>
#include <QThread>
#include "WasmBridge/konclude_wasm_runtime.h"
#endif

namespace Konclude {

	namespace Reasoner {

		namespace Preprocess {

			namespace Events {


				CPreprocessingCalculatedCallbackEvent::CPreprocessingCalculatedCallbackEvent(CThread *receiverThread, CSatisfiableCalculationJob *satCalcJob, CPreprocessingTestingItem* testingItem) 
							: CCustomEvent(EVENTTYPE),CJobSatisfiableCallbackContextData(satCalcJob) {
					mRecThread = receiverThread;
					mSatCalcJob = satCalcJob;
					mTestingItem = testingItem;
					setCallbackDataContext(this);
				}


				CPreprocessingCalculatedCallbackEvent::~CPreprocessingCalculatedCallbackEvent() {
					takeCallbackDataContext();
				}

				void CPreprocessingCalculatedCallbackEvent::doCallback() {
#ifdef __EMSCRIPTEN__
					QThread* receiverThread = mRecThread ? mRecThread->thread() : nullptr;
					bool directDispatch = (receiverThread && receiverThread == QThread::currentThread());
#if defined(KONCLUDE_COMPILE_WASM_INTERFACE)
					if (!konclude_wasm_threads_enabled() && mRecThread && (!mRecThread->isThreadRunning() || !receiverThread)) {
						directDispatch = true;
					}
#endif
					if (mRecThread && directDispatch) {
						QCoreApplication::sendEvent(mRecThread, this);
						delete this;
						return;
					}
#endif
					if (mRecThread) {
						mRecThread->postEvent(this);
					}
				}

				bool CPreprocessingCalculatedCallbackEvent::getTestResultSatisfiable() {
					return mSatisfiable;
				}

				CSatisfiableCalculationJob *CPreprocessingCalculatedCallbackEvent::getSatisfiableCalculationJob() {
					return mSatCalcJob;
				}

				CPreprocessingTestingItem* CPreprocessingCalculatedCallbackEvent::getTestingItem() {
					return mTestingItem;
				}


			}; // end namespace Events

		}; // end namespace Preprocess

	}; // end namespace Reasoner

}; // end namespace Konclude
