
message("Updating Konclude version from Git Revision.")

# Create our custom gitbuild target.
win32:gitbuild.commands = $${PWD}/WinGitBuildScript.bat
else:gitbuild.commands = $${PWD}/UnixGitBuildScript.sh
QMAKE_EXTRA_TARGETS += gitbuild

PRE_TARGETDEPS = gitbuild

message("Preparing Konclude WebAssembly build.")
TEMPLATE = app
isEmpty(KONCLUDE_WASM_TARGET) {
	TARGET = KoncludeWasm
} else {
	TARGET = $$KONCLUDE_WASM_TARGET
}
isEmpty(KONCLUDE_WASM_DESTDIR) {
	DESTDIR = $$PWD/wasm/dist
} else {
	DESTDIR = $$KONCLUDE_WASM_DESTDIR
}
QT += xml network concurrent
CONFIG += release console warn_off c++11
DEFINES += QT_XML_LIB QT_NETWORK_LIB KONCLUDE_FORCE_ALL_DEBUG_DEACTIVATED KONCLUDE_COMPILE_WASM_INTERFACE
INCLUDEPATH += ./generatedfiles \
    ./GeneratedFiles/Release \
    ./Source \
	.
DEPENDPATH += .
MOC_DIR += ./GeneratedFiles/release
OBJECTS_DIR += release
UI_DIR += ./GeneratedFiles
RCC_DIR += ./GeneratedFiles

SOURCES += ./Source/WasmBridge/konclude_wasm_api.cpp
HEADERS += ./Source/WasmBridge/konclude_wasm_api.h

#Include file(s)
exists(wasm/Konclude_wasm.pri) {
	include(wasm/Konclude_wasm.pri)
} else {
	include(Konclude.pri)
}
include(wasm/konclude_wasm_flags.pri)
