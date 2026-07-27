// Correctness-gate entry point for utf16-transcode.
// Compiles tasks/utf16-transcode/tests.rs (which pulls in baseline.rs + candidate.rs
// via relative #[path]) so `cargo test --test utf16_transcode` actually runs it.
#[path = "../tasks/utf16-transcode/tests.rs"]
mod utf16_transcode;
