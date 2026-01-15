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

#include "CJobCalculatedSatisfiableCallbackEvent.h"

#ifdef __EMSCRIPTEN__
#include <QCoreApplication>
#include <QThread>
#include "WasmBridge/konclude_wasm_runtime.h"
#endif


namespace Konclude {

	namespace Reasoner {

		namespace Kernel {

			namespace Manager {

				namespace Events {


					CJobCalculatedSatisfiableCallbackEvent::CJobCalculatedSatisfiableCallbackEvent(CThread *receiverThread, CJobSatisfiableCallbackContextData *context) 
							: CCustomEvent(EVENTTYPE), CCallbackData(context) {

						recThread = receiverThread;
					}


					CJobCalculatedSatisfiableCallbackEvent::~CJobCalculatedSatisfiableCallbackEvent() {
					}


					void CJobCalculatedSatisfiableCallbackEvent::doCallback() {
						if (!recThread) {
							return;
						}
#ifdef __EMSCRIPTEN__
						QThread* receiverThread = recThread->thread();
						bool directDispatch = (receiverThread && receiverThread == QThread::currentThread());
#if defined(KONCLUDE_COMPILE_WASM_INTERFACE)
						if (!konclude_wasm_threads_enabled() && (!recThread->isThreadRunning() || !receiverThread)) {
							directDispatch = true;
						}
#endif
						if (directDispatch) {
							QCoreApplication::sendEvent(recThread, this);
							delete this;
							return;
						}
#endif
						recThread->postEvent(this);
					}



				}; // end namespace Events

			}; // end namespace Manager

		}; // end namespace Kernel

	}; // end namespace Reasoner

}; // end namespace Konclude
