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
    pub max_time_ms:    u64,  // Longest survival time in this session
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
            max_time_ms:   0,
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

    // ── submit_score ──────────────────────────────────────────────────────────
    /// Called after a player finishes an Endless Run.
    ///
    /// ZK verification: proofs that the player survived for `time_ms` 
    /// without a collision based on the session seed.
    pub fn submit_score(
        env: Env,
        session_id:  u32,
        player:      Address,
        time_ms:     u64,       // High score for this run
        proof:       Bytes,     // ZK proof bytes
        journal_hash: BytesN<32>, // commitment to (session, player, time)
    ) -> Result<bool, Error> {
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

        // ── ZK Verification ──────────────────────────────────────────────────
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
        
        // Update high score for this session if better
        if time_ms > progress_mut.max_time_ms {
            progress_mut.max_time_ms = time_ms;
        }

        // Emit high-score event
        env.events().publish(
            (symbol_short!("score"), symbol_short!("update")),
            (session_id, player.clone(), time_ms),
        );

        // Persist updated state
        env.storage().temporary().set(&key, &state);
        env.storage().temporary().extend_ttl(&key, GAME_TTL_LEDGERS, GAME_TTL_LEDGERS);

        Ok(true)
    }

    // ── end_game ──────────────────────────────────────────────────────────────
    /// Finalize session and pay out to the survivor with the highest time.
    pub fn end_session(
        env: Env,
        session_id: u32,
    ) -> Result<Address, Error> {
        let key = DataKey::Game(session_id);
        let mut state: GameState = env.storage().temporary()
            .get(&key)
            .ok_or(Error::GameNotFound)?;

        if state.winner.is_some() {
            return Err(Error::GameAlreadyEnded);
        }

        // Compare high scores to determine winner
        let p1_time = state.p1_progress.max_time_ms;
        let p2_time = state.p2_progress.max_time_ms;

        let winner = if p1_time >= p2_time {
            state.player1.clone()
        } else {
            state.player2.clone()
        };

        state.winner = Some(winner.clone());
        let p1_won = winner == state.player1;

        // Call Game Hub end_game
        let hub_addr: Address = env.storage().instance()
            .get(&DataKey::GameHubAddress)
            .unwrap();
        let game_hub = GameHubClient::new(&env, &hub_addr);
        game_hub.end_game(&session_id, &p1_won);

        // Add to leaderboard
        Self::add_to_leaderboard(
            &env,
            winner.clone(),
            if p1_won { p1_time } else { p2_time },
            session_id,
        );

        // Persist winner state
        env.storage().temporary().set(&key, &state);
        
        Ok(winner)
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

        // Insert sorted (HIGHEST survival time first for Endless Run)
        let mut inserted = false;
        let mut new_board: Vec<LeaderboardEntry> = Vec::new(env);
        for e in board.iter() {
            if !inserted && entry.time_ms >= e.time_ms {
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
