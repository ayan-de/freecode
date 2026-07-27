// Correctness-gate entry point for float-print.
// Compiles tasks/float-print/tests.rs (which pulls in baseline.rs + candidate.rs
// via relative #[path]) so `cargo test --test float_print` actually runs it.
#[path = "../tasks/float-print/tests.rs"]
mod float_print;
