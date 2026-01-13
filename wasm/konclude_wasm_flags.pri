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
QMAKE_WASM_TOTAL_MEMORY = $$KONCLUDE_WASM_TOTAL_MEMORY

# Threads (optional; enable by setting KONCLUDE_WASM_THREADS=1).
KONCLUDE_WASM_USE_THREADS = 0
equals(KONCLUDE_WASM_THREADS, 1) | equals(KONCLUDE_WASM_THREADS, true) | equals(KONCLUDE_WASM_THREADS, TRUE) {
	KONCLUDE_WASM_USE_THREADS = 1
}

equals(KONCLUDE_WASM_USE_THREADS, 1) {
	QMAKE_CFLAGS += -pthread
	QMAKE_CXXFLAGS += -pthread
	QMAKE_LFLAGS += -pthread -s USE_PTHREADS=1

	isEmpty(KONCLUDE_WASM_PTHREAD_POOL) {
		KONCLUDE_WASM_POOL_VALUE = 8
	} else {
		KONCLUDE_WASM_POOL_VALUE = $$KONCLUDE_WASM_PTHREAD_POOL
	}

	# Let Qt's wasm feature inject thread flags using our desired pool size.
	QMAKE_WASM_PTHREAD_POOL_SIZE = $$KONCLUDE_WASM_POOL_VALUE
	# Explicitly set the Emscripten pthread pool size to avoid defaults.
	QMAKE_LFLAGS += -s PTHREAD_POOL_SIZE=$$KONCLUDE_WASM_POOL_VALUE
	DEFINES += KONCLUDE_WASM_PTHREAD_POOL=$$KONCLUDE_WASM_POOL_VALUE

	isEmpty(KONCLUDE_WASM_PROCESSOR_COUNT) {
		KONCLUDE_WASM_PROCESSOR_COUNT = $$KONCLUDE_WASM_POOL_VALUE
	}
	DEFINES += KONCLUDE_WASM_PROCESSOR_COUNT=$$KONCLUDE_WASM_PROCESSOR_COUNT

	isEmpty(KONCLUDE_WASM_PTHREAD_STRICT) {
		KONCLUDE_WASM_PTHREAD_STRICT = 0
	}
	!equals(KONCLUDE_WASM_PTHREAD_STRICT, 0) {
		QMAKE_LFLAGS += -s PTHREAD_POOL_SIZE_STRICT=$$KONCLUDE_WASM_PTHREAD_STRICT
	}
}
!equals(KONCLUDE_WASM_USE_THREADS, 1) {
	DEFINES += KONCLUDE_WASM_PTHREAD_POOL=1
	DEFINES += KONCLUDE_WASM_PROCESSOR_COUNT=1
}
