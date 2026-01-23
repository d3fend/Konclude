message("Configuring Konclude WebAssembly flags.")

# Optimization
QMAKE_CFLAGS_RELEASE += -O3 -DNDEBUG
QMAKE_CXXFLAGS_RELEASE += -O3 -DNDEBUG

# Optional debug helpers (enable via KONCLUDE_WASM_DEBUG=1).
isEmpty(KONCLUDE_WASM_DEBUG) { KONCLUDE_WASM_DEBUG = 0 }
!equals(KONCLUDE_WASM_DEBUG, 0) {
	QMAKE_CFLAGS += -g3
	QMAKE_CXXFLAGS += -g3
	QMAKE_LFLAGS += -g3 --profiling-funcs -s ASSERTIONS=2 -s DEMANGLE_SUPPORT=1 -s EXCEPTION_DEBUG=1
}

# Optional diagnostics (SAFE_HEAP/STACK_OVERFLOW_CHECK). Heavy; enable via KONCLUDE_WASM_DIAGNOSTICS=1.
isEmpty(KONCLUDE_WASM_DIAGNOSTICS) { KONCLUDE_WASM_DIAGNOSTICS = 0 }
!equals(KONCLUDE_WASM_DIAGNOSTICS, 0) {
	QMAKE_LFLAGS += -s SAFE_HEAP=1 -s STACK_OVERFLOW_CHECK=2 -s ASSERTIONS=2
}

# Exception support (needed for large/complex ontologies in WASM).
isEmpty(KONCLUDE_WASM_EXCEPTIONS) { KONCLUDE_WASM_EXCEPTIONS = 1 }
!equals(KONCLUDE_WASM_EXCEPTIONS, 0) {
	QMAKE_CFLAGS += -fexceptions
	QMAKE_CXXFLAGS += -fexceptions
	QMAKE_LFLAGS += -s DISABLE_EXCEPTION_CATCHING=0
}

# Module packaging
QMAKE_LFLAGS += -s MODULARIZE=1
QMAKE_LFLAGS += -s EXPORT_NAME=createKoncludeModule
QMAKE_LFLAGS += -s ENVIRONMENT=web,worker

# Runtime helpers and exports
QMAKE_LFLAGS += -s EXPORTED_RUNTIME_METHODS=['ccall','cwrap','FS']
QMAKE_LFLAGS += -s EXPORTED_FUNCTIONS=['_konclude_run_command','_konclude_classify_files','_konclude_consistency_files','_konclude_realise_files','_konclude_realize_files','_konclude_classify_owl2xml','_konclude_consistency_owl2xml','_konclude_realise_owl2xml','_konclude_realize_owl2xml','_konclude_submit_job','_konclude_submit_classify_files','_konclude_submit_realise_files','_konclude_submit_realize_files','_konclude_job_status','_konclude_job_exit_code','_konclude_job_free','_konclude_tick','_konclude_set_config','_konclude_reset_config_overrides','_konclude_free','_konclude_shutdown']

# Allow function pointer casts for complex C++ callback paths.
QMAKE_LFLAGS += -s EMULATE_FUNCTION_POINTER_CASTS=1

# File system support (needed for temp files and any explicit FS usage).
QMAKE_LFLAGS += -s FORCE_FILESYSTEM=1

# Keep runtime alive for multiple calls.
QMAKE_LFLAGS += -s EXIT_RUNTIME=0

# Stack size (override via qmake vars if needed).
isEmpty(KONCLUDE_WASM_STACK_SIZE) { KONCLUDE_WASM_STACK_SIZE = 67108864 }  # 64MB
QMAKE_LFLAGS += -s TOTAL_STACK=$$KONCLUDE_WASM_STACK_SIZE

# Memory configuration (override via qmake vars).
isEmpty(KONCLUDE_WASM_TOTAL_MEMORY) { KONCLUDE_WASM_TOTAL_MEMORY = 1610612736 }  # 1.5GB
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

	# Pthread stack size (override via qmake vars if needed).
	isEmpty(KONCLUDE_WASM_PTHREAD_STACK_SIZE) { KONCLUDE_WASM_PTHREAD_STACK_SIZE = 8388608 }  # 8MB
	QMAKE_LFLAGS += -s DEFAULT_PTHREAD_STACK_SIZE=$$KONCLUDE_WASM_PTHREAD_STACK_SIZE

	isEmpty(KONCLUDE_WASM_PTHREAD_OVERHEAD) { KONCLUDE_WASM_PTHREAD_OVERHEAD = 0 }
	DEFINES += KONCLUDE_WASM_PTHREAD_OVERHEAD=$$KONCLUDE_WASM_PTHREAD_OVERHEAD

	isEmpty(KONCLUDE_WASM_PTHREAD_POOL) { KONCLUDE_WASM_PTHREAD_POOL = auto }

	equals(KONCLUDE_WASM_PTHREAD_POOL, auto) {
		KONCLUDE_WASM_POOL_VALUE = navigator.hardwareConcurrency
		!equals(KONCLUDE_WASM_PTHREAD_OVERHEAD, 0) {
			KONCLUDE_WASM_POOL_VALUE = navigator.hardwareConcurrency+$$KONCLUDE_WASM_PTHREAD_OVERHEAD
		}
	} else {
		KONCLUDE_WASM_POOL_VALUE = $$KONCLUDE_WASM_PTHREAD_POOL
	}

	# Let Qt's wasm feature inject thread flags using our desired pool size.
	QMAKE_WASM_PTHREAD_POOL_SIZE = $$KONCLUDE_WASM_POOL_VALUE
	# Explicitly set the Emscripten pthread pool size to avoid defaults.
	QMAKE_LFLAGS += -s PTHREAD_POOL_SIZE=$$KONCLUDE_WASM_POOL_VALUE
	contains(KONCLUDE_WASM_PTHREAD_POOL, ^[0-9]+$) {
		DEFINES += KONCLUDE_WASM_PTHREAD_POOL=$$KONCLUDE_WASM_PTHREAD_POOL
	}

	isEmpty(KONCLUDE_WASM_PROCESSOR_COUNT) { KONCLUDE_WASM_PROCESSOR_COUNT = "" }
	contains(KONCLUDE_WASM_PROCESSOR_COUNT, ^[0-9]+$) {
		DEFINES += KONCLUDE_WASM_PROCESSOR_COUNT=$$KONCLUDE_WASM_PROCESSOR_COUNT
	}

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
