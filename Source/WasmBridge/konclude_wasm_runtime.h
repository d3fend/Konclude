/*
 * Konclude WebAssembly runtime hooks.
 */

#ifndef KONCLUDE_WASM_RUNTIME_H
#define KONCLUDE_WASM_RUNTIME_H

#ifdef __EMSCRIPTEN__
extern "C" void konclude_wasm_notify_processing_complete();
extern "C" void konclude_wasm_reset_processing_complete();
extern "C" int konclude_wasm_is_processing_complete();
extern "C" int konclude_wasm_threads_enabled();
#endif

#endif // KONCLUDE_WASM_RUNTIME_H
