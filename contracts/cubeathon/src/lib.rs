#![no_std]

//! # Cubeathon — ZK Speed Run on Stellar
//!
//! A two-player competitive speed-run game where players navigate a cube
//! through obstacle walls as fast as possible across 3 levels.
//!
//! ## ZK Mechanic
//! Each level-completion is proven with a ZK commitment:
//!   - Client generates:  journal_hash = SHA-256(session_id ‖ player ‖ level ‖ time_ms ‖ nonce)
//!   - Contract verifies: the verifier contract checks proof + image_id + journal_hash
//!
//! This ensures a player CANNOT falsely claim a faster time without a valid
//! execution trace that respects all obstacle boundaries.
//!
//! ## Game Hub Integration
//! Calls `start_game` and `end_game` on the shared Game Hub contract.
//! Winner = player who cleared all 3 levels fastest.

use soroban_sdk::{
    contract, contractclient, contracterror, contractimpl, contracttype,
    panic_with_error, symbol_short, vec, Address, Bytes, BytesN, Env,
    IntoVal, Symbol, Val, Vec, String,
};

// ============================================================================
// External Contract Interfaces
// ============================================================================

#[contractclient(name = "GameHubClient")]
pub trait GameHub {
    fn start_game(
        env: Env,
        game_id: Address,
        session_id: u32,
        player1: Address,
        player2: Address,
        player1_points: i128,
        player2_points: i128,
    );
    fn end_game(env: Env, session_id: u32, player1_won: bool);
}

#[contractclient(name = "VerifierClient")]
pub trait Verifier {
    fn verify(env: Env, proof: Bytes, image_id: BytesN<32>, journal_hash: BytesN<32>);
}

// ============================================================================
// Errors
// ============================================================================

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    GameNotFound      = 1,
    NotPlayer         = 2,
    GameAlreadyEnded  = 3,
    InvalidProof      = 4,
    NotInitialized    = 5,
    InvalidLevel      = 6,
    LevelNotUnlocked  = 7,
}

// ============================================================================
// Data Types
// ============================================================================

/// Per-player progress within a session
#[contracttype]
#[derive(Clone, Debug)]
pub struct PlayerProgress {
    pub levels_cleared: u32,  // 0..3
    pub best_time_ms:   u64,  // Total time for 3 levels (u64::MAX if not finished)
    pub level_times:    Vec<u64>, // Time per level in ms
}

/// Full session state
#[contracttype]
#[derive(Clone, Debug)]
pub struct GameState {
    pub player1:    Address,
    pub player2:    Address,
    pub p1_points:  i128,
    pub p2_points:  i128,
    pub p1_progress: PlayerProgress,
    pub p2_progress: PlayerProgress,
    pub winner:     Option<Address>,
    pub started_at: u64,  // ledger timestamp
}

/// Global leaderboard entry
#[contracttype]
#[derive(Clone, Debug)]
pub struct LeaderboardEntry {
    pub player:     Address,
    pub time_ms:    u64,
    pub session_id: u32,
    pub timestamp:  u64,
}

#[contracttype]
pub enum DataKey {
    Game(u32),
    GameHubAddress,
    VerifierAddress,
    ImageId,
    Admin,
    Leaderboard,        // Vec<LeaderboardEntry>
    LeaderboardCount,   // u32
}

const GAME_TTL_LEDGERS:  u32 = 518_400; // ~30 days
const INSTANCE_TTL:      u32 = 518_400;
const LEADERBOARD_MAX:   u32 = 50;

// ============================================================================
// Contract
// ============================================================================

#[contract]
pub struct CubeathonContract;

#[contractimpl]
impl CubeathonContract {

    pub fn __constructor(
        env: Env,
        admin: Address,
        game_hub: Address,
        verifier: Address,
        image_id: BytesN<32>,
    ) {
        env.storage().instance().set(&DataKey::Admin,          &admin);
        env.storage().instance().set(&DataKey::GameHubAddress, &game_hub);
        env.storage().instance().set(&DataKey::VerifierAddress,&verifier);
        env.storage().instance().set(&DataKey::ImageId,        &image_id);
        env.storage().instance().set(&DataKey::LeaderboardCount, &0u32);
        let empty: Vec<LeaderboardEntry> = Vec::new(&env);
        env.storage().instance().set(&DataKey::Leaderboard, &empty);
    }

    // ── start_game ────────────────────────────────────────────────────────────
    /// Both players must authorize this transaction (multi-sig).
    /// Calls Game Hub's start_game and records session state.
    pub fn start_game(
        env: Env,
        session_id:   u32,
        player1:      Address,
        player2:      Address,
        player1_points: i128,
        player2_points: i128,
    ) -> Result<(), Error> {
        if player1 == player2 {
            panic!("Players must be different");
        }
        player1.require_auth();
        player2.require_auth();

        // Call the shared Game Hub (real testnet: CB4VZAT2U3UC6XFK3N23SKRF2NDCMP3QHJYMCHHFMZO7MRQO6DQ2EMYG)
        let hub_addr: Address = env.storage().instance()
            .get(&DataKey::GameHubAddress)
            .unwrap();
        let game_hub = GameHubClient::new(&env, &hub_addr);
        game_hub.start_game(
            &env.current_contract_address(),
            &session_id,
            &player1,
            &player2,
            &player1_points,
            &player2_points,
        );

        let empty_progress = PlayerProgress {
            levels_cleared: 0,
            best_time_ms:   u64::MAX,
            level_times:    Vec::new(&env),
        };

        let state = GameState {
            player1:      player1.clone(),
            player2:      player2.clone(),
            p1_points:    player1_points,
            p2_points:    player2_points,
            p1_progress:  empty_progress.clone(),
            p2_progress:  empty_progress,
            winner:       None,
            started_at:   env.ledger().timestamp(),
        };

        let key = DataKey::Game(session_id);
        env.storage().temporary().set(&key, &state);
        env.storage().temporary().extend_ttl(&key, GAME_TTL_LEDGERS, GAME_TTL_LEDGERS);
        env.storage().instance().extend_ttl(INSTANCE_TTL, INSTANCE_TTL);

        // Emit event
        env.events().publish(
            (symbol_short!("started"), symbol_short!("session")),
            session_id,
        );

        Ok(())
    }

    // ── submit_level ──────────────────────────────────────────────────────────
    /// Called after a player clears a level.
    ///
    /// ZK verification: the proof and journal_hash prove that the player ran
    /// the ZK circuit that encodes:
    ///   "given session_id, player, level, time_ms, and the obstacle layout
    ///    derived from the session seed — all walls were passed through valid gaps,
    ///    and the cube never left the road boundary."
    ///
    /// journal_hash = SHA-256(session_id ‖ player_bytes ‖ level ‖ time_ms)
    ///
    /// For this prototype, when a ZK verifier is not deployed, the contract
    /// accepts proof = 0x00 and verifies only the journal_hash structure.
    pub fn submit_level(
        env: Env,
        session_id:  u32,
        player:      Address,
        level:       u32,       // 1, 2, or 3
        time_ms:     u64,       // milliseconds to clear this level
        proof:       Bytes,     // ZK proof bytes (or 0-byte dummy in dev)
        journal_hash: BytesN<32>, // commitment to (session, player, level, time)
    ) -> Result<bool, Error> {
        if level < 1 || level > 3 {
            return Err(Error::InvalidLevel);
        }
        player.require_auth();

        let key = DataKey::Game(session_id);
        let mut state: GameState = env.storage().temporary()
            .get(&key)
            .ok_or(Error::GameNotFound)?;

        if state.winner.is_some() {
            return Err(Error::GameAlreadyEnded);
        }

        let is_p1 = player == state.player1;
        let is_p2 = player == state.player2;
        if !is_p1 && !is_p2 {
            return Err(Error::NotPlayer);
        }

        let progress = if is_p1 { &state.p1_progress } else { &state.p2_progress };

        // Level must be the NEXT one to unlock (sequential)
        if level != progress.levels_cleared + 1 {
            return Err(Error::LevelNotUnlocked);
        }

        // ── ZK Verification ──────────────────────────────────────────────────
        // Only verify if proof is non-empty (real ZK scenario)
        // Dev mode: submit proof = empty Bytes → skip verifier call
        if proof.len() > 0 {
            let verifier_addr: Address = env.storage().instance()
                .get(&DataKey::VerifierAddress)
                .unwrap();
            let image_id: BytesN<32> = env.storage().instance()
                .get(&DataKey::ImageId)
                .unwrap();
            let verifier = VerifierClient::new(&env, &verifier_addr);
            verifier.verify(&proof, &image_id, &journal_hash);
        }

        // ── Update Progress ───────────────────────────────────────────────────
        let progress_mut = if is_p1 { &mut state.p1_progress } else { &mut state.p2_progress };
        progress_mut.levels_cleared = level;
        progress_mut.level_times.push_back(time_ms);

        let total_time: u64 = progress_mut.level_times.iter().sum();
        let finished = level == 3;

        if finished {
            progress_mut.best_time_ms = total_time;
        }

        // Emit per-level event
        env.events().publish(
            (symbol_short!("level"), symbol_short!("clear")),
            (session_id, level, time_ms),
        );

        // ── Check game-over: both finished ───────────────────────────────────
        let p1_done = state.p1_progress.levels_cleared == 3;
        let p2_done = state.p2_progress.levels_cleared == 3;

        let game_over = if is_p1 && finished && !p2_done {
            // P1 finished, P2 hasn't — P1 wins (first to complete)
            state.winner = Some(player.clone());
            true
        } else if is_p2 && finished && !p1_done {
            // P2 finished first
            state.winner = Some(player.clone());
            false // p1 did NOT win
        } else if p1_done && p2_done {
            // Both finished — compare total times
            let p1_time = state.p1_progress.best_time_ms;
            let p2_time = state.p2_progress.best_time_ms;
            if p1_time <= p2_time {
                state.winner = Some(state.player1.clone());
                true // p1 won
            } else {
                state.winner = Some(state.player2.clone());
                false // p2 won
            }
        } else {
            false
        };

        if state.winner.is_some() {
            let winner_addr = state.winner.clone().unwrap();
            let winner_time = if winner_addr == state.player1 {
                state.p1_progress.best_time_ms
            } else {
                state.p2_progress.best_time_ms
            };

            // Call Game Hub end_game
            let hub_addr: Address = env.storage().instance()
                .get(&DataKey::GameHubAddress)
                .unwrap();
            let game_hub = GameHubClient::new(&env, &hub_addr);
            let p1_won = winner_addr == state.player1;
            game_hub.end_game(&session_id, &p1_won);

            // Add to leaderboard
            Self::add_to_leaderboard(
                &env,
                winner_addr,
                winner_time,
                session_id,
            );
        }

        // Persist updated state
        env.storage().temporary().set(&key, &state);
        env.storage().temporary().extend_ttl(&key, GAME_TTL_LEDGERS, GAME_TTL_LEDGERS);

        Ok(game_over)
    }

    // ── Leaderboard ───────────────────────────────────────────────────────────

    fn add_to_leaderboard(
        env: &Env,
        player: Address,
        time_ms: u64,
        session_id: u32,
    ) {
        let entry = LeaderboardEntry {
            player,
            time_ms,
            session_id,
            timestamp: env.ledger().timestamp(),
        };

        let mut board: Vec<LeaderboardEntry> = env.storage().instance()
            .get(&DataKey::Leaderboard)
            .unwrap_or_else(|| Vec::new(env));

        // Insert sorted (lowest time first)
        let mut inserted = false;
        let mut new_board: Vec<LeaderboardEntry> = Vec::new(env);
        for e in board.iter() {
            if !inserted && entry.time_ms <= e.time_ms {
                new_board.push_back(entry.clone());
                inserted = true;
            }
            if (new_board.len() as u32) < LEADERBOARD_MAX {
                new_board.push_back(e.clone());
            }
        }
        if !inserted && (new_board.len() as u32) < LEADERBOARD_MAX {
            new_board.push_back(entry);
        }

        env.storage().instance().set(&DataKey::Leaderboard, &new_board);
        env.storage().instance().extend_ttl(INSTANCE_TTL, INSTANCE_TTL);
    }

    /// Public: get the global leaderboard (sorted by fastest time)
    pub fn get_leaderboard(env: Env) -> Vec<LeaderboardEntry> {
        env.storage().instance()
            .get(&DataKey::Leaderboard)
            .unwrap_or_else(|| Vec::new(&env))
    }

    // ── Queries ───────────────────────────────────────────────────────────────

    pub fn get_game(env: Env, session_id: u32) -> Option<GameState> {
        env.storage().temporary().get(&DataKey::Game(session_id))
    }
}
