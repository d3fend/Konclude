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

#include "CPreconditionSynchronizer.h"

#include <QCoreApplication>
#ifdef __EMSCRIPTEN__
#include <QThread>
#endif

namespace Konclude {

	namespace Control {

		namespace Command {


			CPreconditionSynchronizer::CPreconditionSynchronizer(CCommandDelegater *commandDelegater) : CThread("CommandPreconditionSynchronizer") {
				delegater = commandDelegater;
#if !defined(KONCLUDE_COMPILE_WASM_INTERFACE)
				startThread();
#endif
			}


			CPreconditionSynchronizer::~CPreconditionSynchronizer() {
			}


			CCommandDelegater *CPreconditionSynchronizer::delegateCommand(CCommand *command) {
#ifdef __EMSCRIPTEN__
				if (!isThreadRunning() || thread() == QThread::currentThread()) {
					CCommandPreconditionChangeEvent* event = new CCommandPreconditionChangeEvent(0, command);
					QCoreApplication::sendEvent(this, event);
					delete event;
				} else {
					postEvent(new CCommandPreconditionChangeEvent(0, command));
				}
#else
				postEvent(new CCommandPreconditionChangeEvent(0,command));
#endif
				return this;
			}


			bool CPreconditionSynchronizer::processCustomsEvents(QEvent::Type type, CCustomEvent *event) {
				if (!CThread::processCustomsEvents(type,event)) {
					if (type == EVENTCOMMANDPRECONDITIONCHANGE) {
						CCommandPreconditionChangeEvent *commandEvent = (CCommandPreconditionChangeEvent *)event;
						if (commandEvent) {
							CCommand *command = commandEvent->getCommand();
							if (command) {
								CPreconditionCommand *preComm = dynamic_cast<CPreconditionCommand *>(command);
								if (preComm) {
									bool processable = false;
									if (preComm->isProcessable()) {
										processable = true;
									}
									if (processable) {
										delegater->delegateCommand(command);
									} else {
										bool connCallback = false;
										CLinker<CCommandPrecondition *> *preIt = preComm->getCommandPreconditionLinker();
										while (preIt) {
											CCommandPrecondition *pre = preIt->getData();											
											if (pre && !pre->isPreconditionFullfilled()) {
												pre->addFullfilledCallback(new CCommandPreconditionChangeEvent(this,preComm));
												connCallback = true;
												break;
											}
											preIt = (CLinker<CCommandPrecondition *> *)preIt->getNext();
										}
										if (!connCallback) {
											LOG(ERROR,"::Konclude::Command::PreconditionSynchronizer",logTr("Unprocessable commands which are not depending on their preconditions are not supported."),this);
											delegater->delegateCommand(command);
										}
									}
								} else {
									delegater->delegateCommand(command);
								}
							}
						}
						return true;
					}
				} else {
					return true;
				}
				return false;			
			}



		}; // end namespace Command

	}; // end namespace Control

}; // end namespace Konclude
