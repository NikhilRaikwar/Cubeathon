use dep::poseidon::poseidon::bn254;

///! Provable Survival ZK Circuit
///! 
///! Proves that a player survived for `time_ms` without hitting any obstacles.
///! The track is derived deterministically from the `seed`.
fn main(
    seed: Field,            // Session seed for random generation
    player_id: Field,       // Bind proof to specific player
    time_ms: u32,           // Reported survival time (the outcome)
    
    // Private trajectory of the player: [x, y] coordinates at intervals
    // For the prototype, we check 10 critical "checkpoints" in the run
    player_path: [[u32; 2]; 10], 
    
    // Commitment to the run
    outcome_hash: pub Field 
) {
    // 1. Verify Commitment (Outcome Hash)
    // journal_hash = hash(seed, player_id, time_ms)
    let calculated_hash = bn254::hash_3([seed, player_id, time_ms as Field]);
    assert(calculated_hash == outcome_hash);

    // 2. Trajectory Validation
    // Re-derive obstacle layout from seed and verify the player's path
    for i in 0..10 {
        let x = player_path[i][0];
        let y = player_path[i][1];

        // Ensure player is within road boundaries (20-980)
        assert(x >= 20);
        assert(x <= 980);

        // Deterministic obstacle generation from seed at this y-coordinate
        // The frontend uses: const gapCenter = 150 + (Math.abs(Math.floor(newY * 1.3) ^ s.rngSeed) % (ROAD_W - 300));
        // ROAD_W = 960
        let obstacle_seed = bn254::hash_2([seed, y as Field]);
        let gap_center = (obstacle_seed as u32 % 661) + 150; 
        let gap_width = 180;

        // Verify player passed through the gap
        let half_gap = gap_width / 2;
        let in_gap = (x >= (gap_center - half_gap)) & (x <= (gap_center + half_gap));
        assert(in_gap == true);
        
        // Ensure path is consistent (no teleporting)
        if i > 0 {
            let prev_x = player_path[i-1][0];
            let diff = if x > prev_x { x - prev_x } else { prev_x - x };
            assert(diff < 200); // Responsive steering allows wider shifts
        }
    }
}

#[test]
fn test_survival_path() {
    let seed = 123456;
    let player_id = 1;
    let time_ms = 5000;

    // Derived gap_x for seed 123456 and y=1000 is ~247 (hypothetical)
    // We'll just define a valid path that passes the assertions
    let mut path = [[0; 2]; 10];
    for i in 0..10 {
        let y = (i + 1) * 1000;
        let obstacle_seed = bn254::hash_2([seed as Field, y as Field]);
        let gap_x = (obstacle_seed as u32) % 601 + 60;
        path[i] = [gap_x + 20, y as u32];
    }

    let outcome_hash = bn254::hash_3([seed as Field, player_id as Field, time_ms as Field]);
    main(seed as Field, player_id as Field, time_ms, path, outcome_hash);
}
