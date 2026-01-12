message("Configuring Konclude WebAssembly flags.")

# Optimization
QMAKE_CFLAGS_RELEASE += -O3 -DNDEBUG
QMAKE_CXXFLAGS_RELEASE += -O3 -DNDEBUG

# Module packaging
QMAKE_LFLAGS += -s MODULARIZE=1
QMAKE_LFLAGS += -s EXPORT_NAME=createKoncludeModule
QMAKE_LFLAGS += -s ENVIRONMENT=web,worker

# Runtime helpers and exports
QMAKE_LFLAGS += -s EXPORTED_RUNTIME_METHODS=['ccall','cwrap','FS']
QMAKE_LFLAGS += -s EXPORTED_FUNCTIONS=['_konclude_run_command','_konclude_classify_files','_konclude_realise_files','_konclude_realize_files','_konclude_classify_owl2xml','_konclude_realise_owl2xml','_konclude_realize_owl2xml','_konclude_submit_job','_konclude_submit_classify_files','_konclude_submit_realise_files','_konclude_submit_realize_files','_konclude_job_status','_konclude_job_exit_code','_konclude_job_free','_konclude_tick','_konclude_free','_konclude_shutdown']

# File system support (needed for temp files and any explicit FS usage).
QMAKE_LFLAGS += -s FORCE_FILESYSTEM=1

# Keep runtime alive for multiple calls.
QMAKE_LFLAGS += -s EXIT_RUNTIME=0

# Memory configuration (override via qmake vars).
isEmpty(KONCLUDE_WASM_TOTAL_MEMORY) { KONCLUDE_WASM_TOTAL_MEMORY = 536870912 }  # 512MB
isEmpty(KONCLUDE_WASM_ALLOW_MEMORY_GROWTH) { KONCLUDE_WASM_ALLOW_MEMORY_GROWTH = 0 }

QMAKE_LFLAGS += -s TOTAL_MEMORY=$$KONCLUDE_WASM_TOTAL_MEMORY
QMAKE_LFLAGS += -s ALLOW_MEMORY_GROWTH=$$KONCLUDE_WASM_ALLOW_MEMORY_GROWTH

# Threads (optional; enable by setting KONCLUDE_WASM_THREADS=1).
KONCLUDE_WASM_USE_THREADS = 0
equals(KONCLUDE_WASM_THREADS, 1) | equals(KONCLUDE_WASM_THREADS, true) | equals(KONCLUDE_WASM_THREADS, TRUE) {
	KONCLUDE_WASM_USE_THREADS = 1
}

equals(KONCLUDE_WASM_USE_THREADS, 1) {
	QMAKE_CFLAGS += -pthread
	QMAKE_CXXFLAGS += -pthread
	QMAKE_LFLAGS += -pthread -s USE_PTHREADS=1

	# Remove any default pool size injected by Qt mkspecs to avoid duplicate overrides.
	QMAKE_CFLAGS ~= s/-s PTHREAD_POOL_SIZE=[^ ]*//g
	QMAKE_CXXFLAGS ~= s/-s PTHREAD_POOL_SIZE=[^ ]*//g
	QMAKE_LFLAGS ~= s/-s PTHREAD_POOL_SIZE=[^ ]*//g

	isEmpty(KONCLUDE_WASM_PTHREAD_POOL) {
		KONCLUDE_WASM_POOL_VALUE = navigator.hardwareConcurrency
	} else {
		KONCLUDE_WASM_POOL_VALUE = $$KONCLUDE_WASM_PTHREAD_POOL
	}

	QMAKE_CFLAGS += -s PTHREAD_POOL_SIZE=$$KONCLUDE_WASM_POOL_VALUE
	QMAKE_CXXFLAGS += -s PTHREAD_POOL_SIZE=$$KONCLUDE_WASM_POOL_VALUE
	QMAKE_LFLAGS += -s PTHREAD_POOL_SIZE=$$KONCLUDE_WASM_POOL_VALUE
}
