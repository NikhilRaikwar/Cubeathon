#![no_std]

use soroban_sdk::{contract, contractimpl, Bytes, BytesN, Env};

#[contract]
pub struct ZKVerifier;

#[contractimpl]
impl ZKVerifier {
    pub fn verify(_env: Env, _proof: Bytes, _image_id: BytesN<32>, _journal_hash: BytesN<32>) {
        // Mock verifier always succeeds.
        // In a real scenario, this would call the WASM verification logic.
    }
}
