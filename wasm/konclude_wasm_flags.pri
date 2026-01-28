message("Configuring Konclude WebAssembly flags.")

# Optimization
QMAKE_CFLAGS_RELEASE += -O3 -DNDEBUG
QMAKE_CXXFLAGS_RELEASE += -O3 -DNDEBUG
isEmpty(KONCLUDE_WASM_LINK_O3) { KONCLUDE_WASM_LINK_O3 = 0 }
!equals(KONCLUDE_WASM_LINK_O3, 0) {
	QMAKE_LFLAGS_RELEASE += -O3
}

# Optional link-time optimization (enable via KONCLUDE_WASM_LTO=1).
isEmpty(KONCLUDE_WASM_LTO) { KONCLUDE_WASM_LTO = 0 }
!equals(KONCLUDE_WASM_LTO, 0) {
	QMAKE_CFLAGS_RELEASE += -flto
	QMAKE_CXXFLAGS_RELEASE += -flto
	QMAKE_LFLAGS_RELEASE += -flto
}

# Optional SIMD (enable via KONCLUDE_WASM_SIMD=1).
isEmpty(KONCLUDE_WASM_SIMD) { KONCLUDE_WASM_SIMD = 1 }
!equals(KONCLUDE_WASM_SIMD, 0) {
	QMAKE_CFLAGS += -msimd128
	QMAKE_CXXFLAGS += -msimd128
}

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
}

# Prefer native WebAssembly exceptions when available (requires recent emsdk).
isEmpty(KONCLUDE_WASM_WASM_EXCEPTIONS) { KONCLUDE_WASM_WASM_EXCEPTIONS = 0 }
!equals(KONCLUDE_WASM_WASM_EXCEPTIONS, 0) {
	QMAKE_CFLAGS += -fwasm-exceptions
	QMAKE_CXXFLAGS += -fwasm-exceptions
	QMAKE_LFLAGS += -fwasm-exceptions
}
equals(KONCLUDE_WASM_WASM_EXCEPTIONS, 0) {
	!equals(KONCLUDE_WASM_EXCEPTIONS, 0) {
		QMAKE_LFLAGS += -fexceptions
		QMAKE_LFLAGS += -s DISABLE_EXCEPTION_CATCHING=0
	}
}

# Module packaging
QMAKE_LFLAGS += -s MODULARIZE=1
QMAKE_LFLAGS += -s EXPORT_NAME=createKoncludeModule
QMAKE_LFLAGS += -s ENVIRONMENT=web,worker

# Enable setjmp/longjmp support needed by Qt/CLI paths.
# When wasm exceptions are enabled, Emscripten requires SUPPORT_LONGJMP=wasm.
isEmpty(KONCLUDE_WASM_LONGJMP) {
	equals(KONCLUDE_WASM_WASM_EXCEPTIONS, 0) {
		KONCLUDE_WASM_LONGJMP = emscripten
	} else {
		KONCLUDE_WASM_LONGJMP = wasm
	}
}
equals(KONCLUDE_WASM_LONGJMP, wasm) {
	!equals(KONCLUDE_WASM_WASM_EXCEPTIONS, 0) {
		QMAKE_CFLAGS += -s SUPPORT_LONGJMP=wasm
		QMAKE_CXXFLAGS += -s SUPPORT_LONGJMP=wasm
		QMAKE_LFLAGS += -s SUPPORT_LONGJMP=wasm
	} else {
		QMAKE_LFLAGS += -s SUPPORT_LONGJMP=emscripten
	}
} else {
	QMAKE_LFLAGS += -s SUPPORT_LONGJMP=emscripten
}

# Runtime helpers and exports
QMAKE_LFLAGS += -s EXPORTED_RUNTIME_METHODS=['ccall','cwrap','FS']
QMAKE_LFLAGS += -s EXPORTED_FUNCTIONS=['_konclude_run_command','_konclude_classify_files','_konclude_consistency_files','_konclude_realise_files','_konclude_realize_files','_konclude_classify_owl2xml','_konclude_consistency_owl2xml','_konclude_realise_owl2xml','_konclude_realize_owl2xml','_konclude_submit_job','_konclude_submit_classify_files','_konclude_submit_realise_files','_konclude_submit_realize_files','_konclude_job_status','_konclude_job_exit_code','_konclude_job_free','_konclude_tick','_konclude_set_config','_konclude_reset_config_overrides','_konclude_free','_konclude_shutdown']

# Allow the wasm function table to grow to avoid indirect call OOBs under heavy multithreading.
isEmpty(KONCLUDE_WASM_TABLE_GROWTH) { KONCLUDE_WASM_TABLE_GROWTH = 0 }
!equals(KONCLUDE_WASM_TABLE_GROWTH, 0) {
	QMAKE_LFLAGS += -s ALLOW_TABLE_GROWTH=1
}

# Allow function pointer casts for complex C++ callback paths.
isEmpty(KONCLUDE_WASM_FP_CASTS) { KONCLUDE_WASM_FP_CASTS = 0 }
!equals(KONCLUDE_WASM_FP_CASTS, 0) {
	QMAKE_LFLAGS += -s EMULATE_FUNCTION_POINTER_CASTS=1
}

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

# Threads (required; WASM build is MT-only).
QMAKE_CFLAGS += -pthread
QMAKE_CXXFLAGS += -pthread
QMAKE_LFLAGS += -pthread -s USE_PTHREADS=1

# Optional allocator override (emscripten MALLOC).
!isEmpty(KONCLUDE_WASM_MALLOC) {
	QMAKE_LFLAGS += -s MALLOC=$$KONCLUDE_WASM_MALLOC
}

contains(KONCLUDE_WASM_RESERVE_POLICY, ^[0-9]+$) {
	DEFINES += KONCLUDE_WASM_RESERVE_POLICY=$$KONCLUDE_WASM_RESERVE_POLICY
}

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
