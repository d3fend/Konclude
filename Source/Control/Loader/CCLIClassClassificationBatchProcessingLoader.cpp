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

#include "CCLIClassClassificationBatchProcessingLoader.h"
#include "Config/CConfigDataReader.h"
#include "Control/Command/Instructions/CIsConsistentQueryCommand.h"
#include "Control/Command/Instructions/CReleaseKnowledgeBaseCommand.h"

#ifdef __EMSCRIPTEN__
#include <cstdio>
#endif

namespace Konclude {

	namespace Control {

		namespace Loader {


			CCLIClassClassificationBatchProcessingLoader::CCLIClassClassificationBatchProcessingLoader() {
			}



			CCLIClassClassificationBatchProcessingLoader::~CCLIClassClassificationBatchProcessingLoader() {
			}


			
			
			void CCLIClassClassificationBatchProcessingLoader::createTestingCommands() {
				createClassificationTestingCommands();
			}


			void CCLIClassClassificationBatchProcessingLoader::createClassificationTestingCommands() {
				logOutputMessage(QString("Starting classification for '%1'.").arg(mRequestFileString));
				mConsistencyResponseFileString = CConfigDataReader::readConfigString(mLoaderConfig, "Konclude.CLI.ConsistencyResponseFile");
				if (!mConsistencyResponseFileString.isEmpty()) {
					logOutputNotice(QString("Consistency output will be written to '%1'.").arg(mConsistencyResponseFileString));
				}
				QString testKB = QString("http://konclude.com/test/kb");
				CCreateKnowledgeBaseCommand* createKBCommand = new CCreateKnowledgeBaseCommand(testKB);
				QStringList ontoIRIList;
				ontoIRIList.append(mRequestFileString);
				//CLoadKnowledgeBaseOWLXMLOntologyCommand* loadKBCommand = new CLoadKnowledgeBaseOWLXMLOntologyCommand(testKB,ontoIRIList);
				//CLoadKnowledgeBaseOWLFunctionalOntologyCommand* loadKBCommand = new CLoadKnowledgeBaseOWLFunctionalOntologyCommand(testKB,ontoIRIList);
				CLoadKnowledgeBaseOWLAutoOntologyCommand* loadKBCommand = new CLoadKnowledgeBaseOWLAutoOntologyCommand(testKB,ontoIRIList);
				CClassifyQueryCommand* classifyKBCommand = new CClassifyQueryCommand(testKB);
				addProcessingCommand(createKBCommand);
				addProcessingCommand(loadKBCommand);
				addProcessingCommand(classifyKBCommand);
				if (!mResponseFileString.isEmpty()) {
					CWriteCustomQueryCommand* writeHierarchyCommand = new CWriteCustomQueryCommand(testKB,CWriteQuery::WRITESUBCLASSHIERARCHY,new CWriteQueryFileOWL2XMLSerializer(mResponseFileString));
					addProcessingCommand(writeHierarchyCommand);
				}
				if (!mConsistencyResponseFileString.isEmpty()) {
					mConsistencyKBCommand = new CIsConsistentQueryCommand(testKB);
					addProcessingCommand(mConsistencyKBCommand,false,"",true,mConsistencyResponseFileString);
				}
				CReleaseKnowledgeBaseCommand* releaseKBCommand = new CReleaseKnowledgeBaseCommand(testKB);
				addProcessingCommand(releaseKBCommand);
				processNextCommand();
			}

			void CCLIClassClassificationBatchProcessingLoader::writeCommandOutput(const QString& outputFileName, CCommand* processedCommand) {
				if (!processedCommand || processedCommand != mConsistencyKBCommand) {
					return;
				}

				CKnowledgeBaseQueryCommand* kbQueryCommand = dynamic_cast<CKnowledgeBaseQueryCommand*>(processedCommand);
				if (!kbQueryCommand) {
					logOutputError("Consistency checking failed.");
					return;
				}
				CQuery* query = kbQueryCommand->getCalculateQueryCommand()->getQuery();
				if (!query) {
					logOutputError("Consistency checking failed.");
					return;
				}
				CQueryResult* queryResult = query->getQueryResult();
				if (!queryResult) {
					logOutputError("Consistency checking failed.");
					return;
				}
				CBooleanQueryResult* boolQueryResult = dynamic_cast<CBooleanQueryResult*>(queryResult);
				if (!boolQueryResult) {
					logOutputError("Consistency checking failed.");
					return;
				}

				logOutputMessage(QString("Ontology '%1' is %2.").arg(mRequestFileString).arg(boolQueryResult->getResult() ? "consistent" : "inconsistent"));
				if (outputFileName.isEmpty()) {
					return;
				}

				forcedPathCreated(outputFileName);
				QFile outputFile(outputFileName);
				if (outputFile.open(QIODevice::WriteOnly)) {
					const QString outputData = boolQueryResult->getResult() ? QString("true\n") : QString("false\n");
					outputFile.write(outputData.toUtf8());
					outputFile.close();
				} else {
					logOutputError(QString("Failed writing output to file '%1'.").arg(outputFileName));
				}
			}




		}; // end namespace Loader

	}; // end namespace Control

}; // end namespace Konclude
