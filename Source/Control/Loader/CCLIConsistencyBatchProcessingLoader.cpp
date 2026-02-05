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

#include "CCLIConsistencyBatchProcessingLoader.h"
#include "Control/Command/Instructions/CReleaseKnowledgeBaseCommand.h"


namespace Konclude {

	namespace Control {

		namespace Loader {


			CCLIConsistencyBatchProcessingLoader::CCLIConsistencyBatchProcessingLoader() {
			}



			CCLIConsistencyBatchProcessingLoader::~CCLIConsistencyBatchProcessingLoader() {
			}


			
			
			void CCLIConsistencyBatchProcessingLoader::createTestingCommands() {
				createConsistencyTestingCommands();
			}


			void CCLIConsistencyBatchProcessingLoader::createConsistencyTestingCommands() {
				logOutputMessage(QString("Starting consistency checking for '%1'.").arg(mRequestFileString));
				mTrivialOnly = CConfigDataReader::readConfigBoolean(mLoaderConfig, "Konclude.CLI.TrivialConsistencyOnly", false);
				if (mTrivialOnly) {
					logOutputNotice("Trivial-only consistency mode enabled (skipping full consistency test).");
				}
				mDetailedConsistencyAttemptCount = 0;
				mDetailedConsistencyMaxAttempts = CConfigDataReader::readConfigInteger(mLoaderConfig, "Konclude.CLI.DetailedConsistencyMaxAttempts", 2);
				if (mDetailedConsistencyMaxAttempts < 1) {
					mDetailedConsistencyMaxAttempts = 1;
				}
				mTestKB = QString("http://konclude.com/test/kb");
				mReleaseScheduled = false;
				mConsistencyFailureLogged = false;
				mFallbackSatisfiableScheduled = false;
				CCreateKnowledgeBaseCommand* createKBCommand = new CCreateKnowledgeBaseCommand(mTestKB);
				QStringList ontoIRIList;
				ontoIRIList.append(mRequestFileString);
				//CLoadKnowledgeBaseOWLXMLOntologyCommand* loadKBCommand = new CLoadKnowledgeBaseOWLXMLOntologyCommand(mTestKB,ontoIRIList);
				CLoadKnowledgeBaseOWLAutoOntologyCommand* loadKBCommand = new CLoadKnowledgeBaseOWLAutoOntologyCommand(mTestKB,ontoIRIList);
				if (!getOntologyIRIMapping().isEmpty()) {
					loadKBCommand->setOntologieIRIMappings(getOntologyIRIMapping());
				}
				mConsistencyKBCommand = nullptr;
				mTriviallyConsistencyKBCommand = new CIsTriviallyConsistentQueryCommand(mTestKB);
				addProcessingCommand(createKBCommand);
				addProcessingCommand(loadKBCommand);
				addProcessingCommand(mTriviallyConsistencyKBCommand,false,"",true,mResponseFileString);
				processNextCommand();
			}


			CIsConsistentQueryCommand* CCLIConsistencyBatchProcessingLoader::createDetailedConsistencyCommand() {
				CIsConsistentQueryCommand* consistencyCommand = new CIsConsistentQueryCommand(mTestKB);
				mConsistencyKBCommand = consistencyCommand;
				++mDetailedConsistencyAttemptCount;
				return consistencyCommand;
			}


			CProcessClassNameSatisfiableQueryCommand* CCLIConsistencyBatchProcessingLoader::createConsistencyFallbackSatisfiableCommand() {
				const QString thingClassName = QString("http://www.w3.org/2002/07/owl#Thing");
				CProcessClassNameSatisfiableQueryCommand* satisfiableCommand = new CProcessClassNameSatisfiableQueryCommand(mTestKB, thingClassName);
				mConsistencyFallbackSatisfiableCommand = satisfiableCommand;
				mFallbackSatisfiableScheduled = true;
				return satisfiableCommand;
			}


			void CCLIConsistencyBatchProcessingLoader::writeCommandOutput(const QString& outputFileName, CCommand* processedCommand) {
				bool outputWritten = false;
				bool requiresDetailedConsistencyChecking = true;
				const bool processedDetailedConsistencyCommand = processedCommand && processedCommand == mConsistencyKBCommand;
				const bool processedFallbackSatisfiableCommand = processedCommand && processedCommand == mConsistencyFallbackSatisfiableCommand;
				CKnowledgeBaseQueryCommand* kbQueryCommand = dynamic_cast<CKnowledgeBaseQueryCommand*>(processedCommand);
				if (kbQueryCommand) {
					CQuery* query = kbQueryCommand->getCalculateQueryCommand()->getQuery();
					if (query) {
						CQueryResult* queryResult = query->getQueryResult();
						if (queryResult) {
							CBooleanQueryResult* boolQueryResult = dynamic_cast<CBooleanQueryResult*>(queryResult);
							if (boolQueryResult) {
								bool writeOutput = false;
								if (mTrivialOnly && processedCommand == mTriviallyConsistencyKBCommand) {
									writeOutput = true;
									requiresDetailedConsistencyChecking = false;
								}
								if (processedFallbackSatisfiableCommand) {
									requiresDetailedConsistencyChecking = false;
									writeOutput = true;
									if (boolQueryResult->getResult() == true) {
										logOutputMessage(QString("Ontology '%1' is consistent.").arg(mRequestFileString));
									} else {
										logOutputMessage(QString("Ontology '%1' is inconsistent.").arg(mRequestFileString));
									}
								} else if (boolQueryResult->getResult() == true) {
									requiresDetailedConsistencyChecking = false;
									writeOutput = true;
									logOutputMessage(QString("Ontology '%1' is consistent.").arg(mRequestFileString));
								} else {
									if (processedCommand == mConsistencyKBCommand) {
										requiresDetailedConsistencyChecking = false;
										writeOutput = true;
										logOutputMessage(QString("Ontology '%1' is inconsistent.").arg(mRequestFileString));
									}
								}

								if (writeOutput) {
									outputWritten = true;
									if (!outputFileName.isEmpty()) {
										forcedPathCreated(outputFileName);
										QFile outputFile(outputFileName);
										if (outputFile.open(QIODevice::WriteOnly)) {
											QString outputData;
											if (boolQueryResult->getResult() == true) {
												outputData = QString("true\n");
											} else {
												outputData = QString("false\n");
											}
											outputFile.write(outputData.toUtf8());
											outputFile.close();
										} else {
											logOutputError(QString("Failed writing output to file '%1'.").arg(outputFileName));
										}
									}
								}
							}
						}
					}
				}
				if (requiresDetailedConsistencyChecking) {
					if (mDetailedConsistencyAttemptCount < mDetailedConsistencyMaxAttempts) {
						addProcessingCommand(createDetailedConsistencyCommand(),false,"",true,mResponseFileString);
						if (processedDetailedConsistencyCommand) {
							logOutputNotice(QString("Detailed consistency check returned no boolean result, retrying with a fresh command (%1/%2).")
								.arg(mDetailedConsistencyAttemptCount)
								.arg(mDetailedConsistencyMaxAttempts));
						} else {
							logOutputNotice(QString("Scheduling detailed consistency check (%1/%2).")
								.arg(mDetailedConsistencyAttemptCount)
								.arg(mDetailedConsistencyMaxAttempts));
						}
					} else {
						if (!mFallbackSatisfiableScheduled) {
							addProcessingCommand(createConsistencyFallbackSatisfiableCommand(),false,"",true,mResponseFileString);
							logOutputNotice("Detailed consistency checks did not return a boolean result, trying OWL Thing satisfiability fallback.");
						} else {
							mConsistencyFailureLogged = true;
							logOutputError(QString("Detailed consistency checking failed after %1 attempts.")
								.arg(mDetailedConsistencyAttemptCount));
							requiresDetailedConsistencyChecking = false;
						}
					}
				} else if (!mReleaseScheduled && !mTestKB.isEmpty()) {
					mReleaseScheduled = true;
					addProcessingCommand(new CReleaseKnowledgeBaseCommand(mTestKB));
				} else if (!outputWritten && !mConsistencyFailureLogged) {
					logOutputError("Consistency checking failed.");
				}
			}



		}; // end namespace Loader

	}; // end namespace Control

}; // end namespace Konclude
