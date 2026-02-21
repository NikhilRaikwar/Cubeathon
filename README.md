# ⬛ Cubeathon — ZK Speed Run on Stellar

**Cubeathon** is a competitive speed-run game where players prove their skill through Zero-Knowledge proofs. Built for the Stellar ZK Gaming Hackathon using the **Stellar Game Studio** toolchain.

## 🏆 Hackathon Submission Highlights

### 1. ZK-Powered Mechanic: "Provable Speed-Run"
In traditional speed-runs, you have to "trust" the player's video. In Cubeathon, the **Trust is built-in**.
- **Circuit**: Written in **Noir** (located in `/zk/cubeathon_circuit`).
- **Function**: Validates that the player's cube stayed within road boundaries and passed through generated gaps for every wall. 
- **Verifiable Outcome**: The contract only accepts `submit_level` if the on-chain ZK verifier confirms the path's validity.

### 2. Deployed On-chain Component
- **Contract Address**: `CDCOFNIL6DSQVCUVR2DUQ345WL6OG3A6GJZHFQB3YASJES37THHYCTAV`
- **Game Hub Integration**: Fully integrated with the required Game Hub (`CB4VZAT2U3UC6XFK3N23SKRF2NDCMP3QHJYMCHHFMZO7MRQO6DQ2EMYG`). 
- **Workflow**:
    - `start_game`: Locks player stakes and initializes the on-chain session.
    - `end_game`: Distributes the jackpot to the fastest verified finisher.

### 3. Contract Build Verification (SEP-0055)
This repository includes a `.github/workflows/release.yml` which implements **SEP-0055**. This provides a cryptographic link between this source code and the WASM binary deployed on Stellar, ensuring transparency for judges and players.

## 🛠️ Tech Stack
- **Smart Contracts**: Soroban (Rust SDK)
- **ZK Circuit**: Noir Lang
- **Frontend**: React + Vite + Stellar SDK (Raw RPC integration)
- **Toolchain**: Stellar Game Studio (SGS)

## 💰 The Jackpot Mechanism

Cubeathon isn't just a race; it's a competitive staking game.

1.  **Staking**: When a session is created via `start_game`, both players commit a set amount of points (the **Stakes**).
2.  **The Jackpot**: These stakes are pooled together to form the **Session Jackpot**. You can see the live jackpot amount in the game header.
3.  **The Race**: Players clearance 3 levels of increasing difficulty. Every level completion is verified by a **ZK Proof** on-chain to ensure the times are legitimate.
4.  **The Payout**: Once a player completes Level 3, the contract compares the total verified times. The player with the **fastest cumulative time** is declared the winner and claims the **entire Jackpot**.

## 🎮 Gameplay Flow
1. **Connect Wallet**: Use the built-in identity switcher to simulate two players.
2. **Start Session**: Create a new session which triggers the `start_game` multi-sig transaction.
3. **Race**: Navigate the cube using `Arrow Keys` or `WASD`.
4. **Instant Updates**: Your split times appear instantly on the leaderboard thanks to **Optimistic UI** logic.
5. **Win**: Clear 3 levels to submit your final proof and claim the jackpot!

## 📥 Setup & Submission
- **Repository**: This folder contains the full source for the contracts, ZK circuits, and frontend.
- **Verification**: The included GitHub Action (`.github/workflows/release.yml`) implements **SEP-0055** for on-chain build verification.

---
Built for the **Stellar ZK Gaming Hackathon 2026**.
