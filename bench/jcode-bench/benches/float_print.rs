// Benchmark: baseline vs candidate for float-print.
// Uses criterion for stable median ns/op.

use criterion::{black_box, criterion_group, criterion_main, Criterion};
#[path = "../tasks/float-print/baseline.rs"]
mod baseline;
#[path = "../tasks/float-print/candidate.rs"]
mod candidate;

fn bench_baseline(c: &mut Criterion) {
    c.bench_function("float_print/baseline", |b| {
        b.iter(|| {
            // Sweep a small deterministic slice — every 4096th bit.
            let mut s = String::with_capacity(32);
            for bits in (0u32..=u32::MAX).step_by(4096) {
                s.clear();
                let f = f32::from_bits(bits);
                let out = baseline::baseline_f32_to_string(f);
                black_box(out);
            }
        })
    });
}

fn bench_candidate(c: &mut Criterion) {
    c.bench_function("float_print/candidate", |b| {
        b.iter(|| {
            let mut s = String::with_capacity(32);
            for bits in (0u32..=u32::MAX).step_by(4096) {
                s.clear();
                let f = f32::from_bits(bits);
                candidate::candidate_f32_to_string(f, &mut s);
                black_box(&s);
            }
        })
    });
}

criterion_group!(benches, bench_baseline, bench_candidate);
criterion_main!(benches);