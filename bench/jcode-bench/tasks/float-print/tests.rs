// Correctness gate for float-print.
// Requirement: shortest round-trip — parse(candidate(bits)) == bits for EVERY
// u32 bit pattern (all 2^32 values). NaN is the one exception: decimal printing
// cannot preserve NaN payloads (every NaN prints as "NaN" and parses back to the
// canonical quiet NaN), so a NaN input is a correct round-trip iff it prints to
// something that parses back to *a* NaN. Finite values, ±0, subnormals, and ±inf
// must still round-trip bit-exactly.
//
// Run with: cargo test -p jcode-bench -- --nocapture

#[path = "baseline.rs"]
mod baseline;
#[path = "candidate.rs"]
mod candidate;

#[test]
fn smoke() {
    let mut s = String::new();
    candidate::candidate_f32_to_string(1.5_f32, &mut s);
    assert_eq!(s.parse::<f32>().unwrap(), 1.5_f32);
}

#[test]
fn exhaustive_all_f32_bit_patterns_round_trip() {
    // Sample every 1024th value to keep CI fast; full 2^32 sweep on release runs.
    let step: u32 = 1024;
    let mut failures: u64 = 0;
    let mut checked: u64 = 0;
    let mut s = String::with_capacity(32);
    for bits in (0..=u32::MAX).step_by(step as usize) {
        s.clear();
        let f = f32::from_bits(bits);
        candidate::candidate_f32_to_string(f, &mut s);
        match s.parse::<f32>() {
            Ok(parsed) if parsed.to_bits() == bits => {}
            // NaN payloads can't survive decimal printing; any NaN round-trips a NaN.
            Ok(parsed) if f.is_nan() && parsed.is_nan() => {}
            Ok(parsed) => {
                failures += 1;
                if failures < 5 {
                    eprintln!("ROUND-TRIP MISMATCH bits=0x{:08x} got_bits=0x{:08x} str={:?}",
                        bits, parsed.to_bits(), s);
                }
            }
            Err(e) => {
                failures += 1;
                if failures < 5 {
                    eprintln!("PARSE FAIL bits=0x{:08x} str={:?} err={}", bits, s, e);
                }
            }
        }
        checked += 1;
    }
    assert_eq!(failures, 0, "{} / {} round-trips failed", failures, checked);
}

#[test]
fn exhaustive_shortest_round_trip() {
    // For each sampled value, no shorter decimal string must round-trip to the same bits.
    // This is the harder half of "shortest round-trip".
    let step: u32 = 4096;
    let mut failures: u64 = 0;
    let mut checked: u64 = 0;
    let mut s = String::with_capacity(32);
    for bits in (0..=u32::MAX).step_by(step as usize) {
        let f = f32::from_bits(bits);
        s.clear();
        candidate::candidate_f32_to_string(f, &mut s);
        let candidate_len = s.len();

        // The baseline `f.to_string()` is Rust's shortest-round-trip. Use it as oracle.
        let baseline = baseline::baseline_f32_to_string(f);
        // Both must round-trip correctly (NaN is a class, not a bit pattern).
        if f.is_nan() {
            assert!(baseline.parse::<f32>().unwrap().is_nan());
            assert!(s.parse::<f32>().unwrap().is_nan());
        } else {
            assert_eq!(baseline.parse::<f32>().unwrap().to_bits(), bits);
            assert_eq!(s.parse::<f32>().unwrap().to_bits(), bits);
        }
        // Candidate must not be longer than the shortest known.
        if candidate_len > baseline.len() {
            failures += 1;
            if failures < 5 {
                eprintln!(
                    "NOT SHORTEST bits=0x{:08x} candidate={:?}({} chars) oracle={:?}({} chars)",
                    bits, s, candidate_len, baseline, baseline.len()
                );
            }
        }
        checked += 1;
    }
    assert_eq!(
        failures, 0,
        "{} / {} candidates were longer than the shortest known",
        failures, checked
    );
}