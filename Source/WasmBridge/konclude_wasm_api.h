#pragma once

#include <cstddef>

#ifdef __EMSCRIPTEN__
#include <emscripten/emscripten.h>
#define KONCLUDE_WASM_EXPORT EMSCRIPTEN_KEEPALIVE
#else
#define KONCLUDE_WASM_EXPORT
#endif

#ifdef __cplusplus
extern "C" {
#endif

// Runs an arbitrary Konclude command line (argv[0] is ignored but required).
KONCLUDE_WASM_EXPORT int konclude_run_command(int argc, const char** argv);

// Convenience wrappers for file-based classification/realisation.
KONCLUDE_WASM_EXPORT int konclude_classify_files(const char* input_path, const char* output_path);
KONCLUDE_WASM_EXPORT int konclude_realise_files(const char* input_path, const char* output_path);
KONCLUDE_WASM_EXPORT int konclude_realize_files(const char* input_path, const char* output_path);

// Convenience wrappers for in-memory OWL 2 XML payloads.
KONCLUDE_WASM_EXPORT int konclude_classify_owl2xml(const char* data, size_t len, char** output, size_t* out_len);
KONCLUDE_WASM_EXPORT int konclude_realise_owl2xml(const char* data, size_t len, char** output, size_t* out_len);
KONCLUDE_WASM_EXPORT int konclude_realize_owl2xml(const char* data, size_t len, char** output, size_t* out_len);

#ifdef __EMSCRIPTEN__
// Async job API (required for WebAssembly/JS usage).
KONCLUDE_WASM_EXPORT int konclude_submit_job(const char* command, const char* input_path, const char* output_path);
KONCLUDE_WASM_EXPORT int konclude_submit_classify_files(const char* input_path, const char* output_path);
KONCLUDE_WASM_EXPORT int konclude_submit_realise_files(const char* input_path, const char* output_path);
KONCLUDE_WASM_EXPORT int konclude_submit_realize_files(const char* input_path, const char* output_path);
KONCLUDE_WASM_EXPORT int konclude_job_status(int job_id);
KONCLUDE_WASM_EXPORT int konclude_job_exit_code(int job_id);
KONCLUDE_WASM_EXPORT void konclude_job_free(int job_id);
KONCLUDE_WASM_EXPORT void konclude_tick(int max_ms);
// Optional configuration overrides (persist across jobs until reset).
KONCLUDE_WASM_EXPORT int konclude_set_config(const char* key, const char* value);
KONCLUDE_WASM_EXPORT int konclude_reset_config_overrides();
#endif

// Free buffers returned by *_owl2xml.
KONCLUDE_WASM_EXPORT void konclude_free(void* ptr);

// Optional shutdown hook (logger shutdown, etc).
KONCLUDE_WASM_EXPORT void konclude_shutdown();

#ifdef __cplusplus
}
#endif
