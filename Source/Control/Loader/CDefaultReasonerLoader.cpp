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

#include "CDefaultReasonerLoader.h"

#ifdef __EMSCRIPTEN__
#include <cstdio>
#include "WasmBridge/konclude_wasm_runtime.h"
#endif
#include "Control/Command/CCommandExecutedBlocker.h"


namespace Konclude {

	namespace Control {

		namespace Loader {


			CDefaultReasonerLoader::CDefaultReasonerLoader() {
			}



			CDefaultReasonerLoader::~CDefaultReasonerLoader() {
			}


			CLoader *CDefaultReasonerLoader::init(CLoaderFactory *loaderFactory, CConfiguration *config) {

				reasonerCommander = new CCommanderManagerThread();

				configuration = config;

				CConfigurationGroup *group = configuration->getConfigurationGroup();
				CConfigData *data = configuration->createConfig("Konclude.Execution.CommanderManager");

				CCommanderManagerConfigType *rCConfig = dynamic_cast<CCommanderManagerConfigType *>(data->getConfigType());
				if (rCConfig) {
					rCConfig->setCommanderManager(reasonerCommander);
				}


				group->setConfigDefaultData(group->getConfigIndex("Konclude.Execution.CommanderManager"),data);

				return this;
			}





			CLoader *CDefaultReasonerLoader::load() {

				CInitializeConfigurationCommand* initConfigCommand = new CInitializeConfigurationCommand(configuration);
				reasonerCommander->realizeCommand(initConfigCommand);

				CInitializeReasonerCommand* initReasonerCommand = new CInitializeReasonerCommand(new CDefaultCommanderInitializationFactory());
				reasonerCommander->realizeCommand(initReasonerCommand);

#ifdef __EMSCRIPTEN__
				if (konclude_wasm_threads_enabled()) {
					CCommandExecutedBlocker blocker;
					blocker.waitExecutedCommand(initConfigCommand);
					blocker.waitExecutedCommand(initReasonerCommand);
				}
#endif

				return this;
			}

			CLoader *CDefaultReasonerLoader::exit() {
				delete reasonerCommander;
				return this;
			}



		}; // end namespace Loader

	}; // end namespace Control

}; // end namespace Konclude
