# ⬛ Cubeathon — ZK Speed Run on Stellar

**Cubeathon** is an elite, cheat-proof speed-run game where players prove their skill using Zero-Knowledge proofs. Built for the **Stellar ZK Gaming Hackathon 2026**, it combines high-intensity cyber-neon aesthetics with verifiable on-chain outcomes.

[![ZK Powered](https://img.shields.io/badge/ZK-Powered-cyan.svg)](#) [![Noir ZK](https://img.shields.io/badge/Noir-ZK--Proofs-blue.svg)](#) [![Soroban](https://img.shields.io/badge/Powered%20By-Soroban-purple.svg)](#) [![ZK Native](https://img.shields.io/badge/ZK%20Native-Provable%20Outcomes-orange.svg)](#)

---

## 🏆 Hackathon Submission Highlights

### 1. ZK-Native Mechanic: "Provable Maneuverability"
In traditional speed-runs, validity depends on video proof or trust in a central server. Cubeathon introduces **Provable Survival**:
- **The Core**: A Noir-based ZK Circuit (`/zk/cubeathon_circuit`) validates the player's movement trajectory.
- **Dynamic Seeding**: Every race generates a unique track layout from a random on-chain seed. Memoriation is impossible.
- **Verification**: The smart contract only accepts a record if the ZK proof confirms the player navigated through the obstacles without collisions according to the specific seed of that session.

### 2. Deployed On-Chain Architecture
- **Cubeathon Contract**: `CBXR6SP6J6PESI5TXAMPRFDPRJHBGNWMI5DY6M23GFBMJIMI3U6TI3MD` (Stellar Testnet)
- **Game Hub Integration**: Fully integrated with the mandatory **Stellar Game Hub** (`CB4VZAT2U3UC6XFK3N23SKRF2NDCMP3QHJYMCHHFMZO7MRQO6DQ2EMYG`).
- **Global Leaderboard**: A decentralized Hall of Fame that only tracks ZK-verified survival times.

### 3. Build Security & Transparency
- **SEP-0055 Compliance**: Implements cryptographic linkage between source code and the WASM binary via GitHub Workflows.
- **Verifiable Provenance**: Check `.github/workflows/release.yml` for the automated build and attestation pipeline.

---

## ⚡ Powered by Stellar Game Studio

**Cubeathon** is built upon the **[Stellar Game Studio (SGS)](https://jamesbachini.github.io/Stellar-Game-Studio/)** toolchain. SGS simplifies building onchain games and streamlines the Stellar game lifecycle, providing a fast starting point for shipping playable web games with robust onchain components.

By pairing Soroban smart contracts with a modern frontend workflow, SGS reduced our boilerplate and allowed us to focus entirely on the high-intensity gameplay and ZK security logic. Our integration with SGS satisfies the hackathon requirements and leveraging its two-player game simulation was pivotal for our development.

- **SGS Documentation**: [jamesbachini.github.io/Stellar-Game-Studio/](https://jamesbachini.github.io/Stellar-Game-Studio/)
- **SGS Repository**: [github.com/jamesbachini/Stellar-Game-Studio](https://github.com/jamesbachini/Stellar-Game-Studio)

---

## 🛠️ The Technology
- **ZK Circuit**: Noir Lang (Poseidon Hashing for identity/seed commitment).
- **Smart Contracts**: Soroban (Rust SDK).
- **Frontend**: React + Vite + Vanilla CSS.
- **Aesthetic**: High-Intensity landscape 3D projection, Cyber-Neon theme.

---

## 🏁 How to Play

1.  **Connect**: Switch between Dev Identities (Player 1 / Player 2) to simulate the competitive environment.
2.  **Start**: Initialize a session which calls the global **Game Hub** contract to record the start.
3.  **Race**: Control your cyan cube with `A/D` or `Arrow Keys`. 
4.  **Navigate**: Dodge the red emissive obstacle clusters. Remember, obstacles cover 80% of the road—speed and precision are mandatory!
5.  **Finish**: Cross the 1500m finish line at maximum velocity.
6.  **Verify**: Submit your ZK Proof to finalize your standing on the **Winning Leaderboard**.

---

## � Game Logic & Fairness

### No Memoriation, Just Skill
The game avoids the "fixed track" pitfall. Because the seed is randomized every attempt, every race is a new puzzle. You can't learn the pattern; you have to have the reflexes.

### Provable Outcomes
Bypassing the client-side logic via standard hacks (like disabling collision detection) will result in a failed ZK Proof on-chain, as the circuit re-simulates the track from the seed and finds the collision.

---

Built with ❤️ for the **Stellar ZK Gaming Hackathon 2026**.
