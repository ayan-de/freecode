use criterion::{black_box, criterion_group, criterion_main, Criterion};
#[path = "../tasks/utf16-transcode/baseline.rs"]
mod baseline;
#[path = "../tasks/utf16-transcode/candidate.rs"]
mod candidate;

fn make_payload() -> Vec<u16> {
    // Mix of ASCII (1 unit) and supplementary planes (2 units).
    let mut v = Vec::with_capacity(8192);
    for i in 0..4096 {
        match i % 5 {
            0 => v.push(0x0041 + (i as u16 % 26)),       // ASCII
            1 => v.push(0x00E9),                          // é
            2 => {
                v.push(0xD83D); v.push(0xDE00);            // 😀
            }
            3 => v.push(0x4E2D),                          // 中
            _ => {
                v.push(0xD83E); v.push(0xDD80);            // 🦀
            }
        }
    }
    v
}

fn bench_baseline(c: &mut Criterion) {
    let payload = make_payload();
    c.bench_function("utf16_transcode/baseline", |b| {
        b.iter(|| {
            let out = baseline::baseline_utf16_to_utf8(black_box(&payload)).unwrap();
            black_box(out);
        })
    });
}

fn bench_candidate(c: &mut Criterion) {
    let payload = make_payload();
    c.bench_function("utf16_transcode/candidate", |b| {
        b.iter(|| {
            let mut out = Vec::with_capacity(payload.len() * 3);
            candidate::candidate_utf16_to_utf8(black_box(&payload), &mut out).unwrap();
            black_box(out);
        })
    });
}

criterion_group!(benches, bench_baseline, bench_candidate);
criterion_main!(benches);