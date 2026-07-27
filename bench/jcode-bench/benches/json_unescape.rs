use criterion::{black_box, criterion_group, criterion_main, Criterion};
#[path = "../tasks/json-unescape/baseline.rs"]
mod baseline;
#[path = "../tasks/json-unescape/candidate.rs"]
mod candidate;

fn make_payload(len: usize) -> Vec<u8> {
    // A mix of plain ASCII and \uXXXX escapes — stresses both paths.
    let mut v = Vec::with_capacity(len * 2);
    for i in 0..len {
        match i % 7 {
            0..=3 => v.push(b'a' + (i as u8 % 26)),
            5 => v.extend_from_slice(b"\\n"),
            6 => v.extend_from_slice(b"\\u00E9"), // é
            _ => v.extend_from_slice(b"\\t"),
        }
    }
    v
}

fn bench_baseline(c: &mut Criterion) {
    let payload = make_payload(4096);
    c.bench_function("json_unescape/baseline", |b| {
        b.iter(|| {
            let out = baseline::baseline_json_unescape(black_box(&payload)).unwrap();
            black_box(out);
        })
    });
}

fn bench_candidate(c: &mut Criterion) {
    let payload = make_payload(4096);
    c.bench_function("json_unescape/candidate", |b| {
        b.iter(|| {
            let mut out = Vec::with_capacity(payload.len());
            candidate::candidate_json_unescape(black_box(&payload), &mut out).unwrap();
            black_box(out);
        })
    });
}

criterion_group!(benches, bench_baseline, bench_candidate);
criterion_main!(benches);