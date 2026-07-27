// Correctness-gate entry point for json-unescape.
// Compiles tasks/json-unescape/tests.rs (which pulls in baseline.rs + candidate.rs
// via relative #[path]) so `cargo test --test json_unescape` actually runs it.
#[path = "../tasks/json-unescape/tests.rs"]
mod json_unescape;
