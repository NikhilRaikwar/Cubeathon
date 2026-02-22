# 🌌 Cubeathon — ZK Gaming on Stellar

[![ZK Native](https://img.shields.io/badge/ZK%20Native-Provable%20Outcomes-orange.svg)](#)


## The Big Idea
This hackathon is about exploring Zero-Knowledge (ZK) as a real gameplay primitive — not just a buzzword. Our answer to this is **Cubeathon**, a minimalist, high-intensity speed-run prototype where ZK is absolutely essential to how it works. 

We focused on the core mechanic of **provable outcomes**. In our game, "trust me" isn't good enough. Instead of relying on vulnerable client-side outcomes or easily manipulated leaderboards, the game mathematically verifies survival. 

---

## ⚡ 1) A ZK-Powered Mechanic
With Stellar's Protocol 25 (X-Ray) bringing protocol-level cryptographic building blocks like BN254 elliptic-curve operations and Poseidon hash functions, we built a **Noir ZK-Circuit** that acts as our on-chain referee.

- **Dynamic Seeding**: Every session generates a procedural 1.5km track from an on-chain seed.
- **Trajectory Validation**: You navigate the cube via our React frontend. At the end, a ZK proof is generated client-side from your exact path.
- **Mathematical Fairness**: The ZK proof verifies that your path passed safely through the obstacles derived from that exact seed. If you modify your client to ignore collisions, the ZK proof fails on-chain.

## 🔗 2) A Deployed Onchain Component
We rely on a Soroban smart contract deployed to the **Stellar Testnet**:
- **Contract ID**: `CBPDASXZ7W6PO4OUH4HHMC7K7UTN3QHOWSNRYVITBG3ZKCH5LNK5L63M`
- **Game Hub Integration**: We successfully integrated our smart contract with the required mock Game Hub (`CB4VZAT2U3UC6XFK3N23SKRF2NDCMP3QHJYMCHHFMZO7MRQO6DQ2EMYG`). Our contract natively calls `start_game()` and `end_game()` to secure player entry and distribute the jackpot to the fastest verified survivor.

## 🎨 3) A Front End
We built a highly responsive, cyber-neon React + Vite frontend optimized for speed and clarity. 
- It clearly demonstrates how the ZK mechanics and the on-chain Game Hub connect to the player experience. 
- Features a **Global Hall of Fame** that displays the exact survival times of players, verified by ZK on-chain.

## 💻 4) Open-source Repo & Toolchain Shortcut
**Stellar Game Studio** served as our dev shortcut! It simplified building our on-chain game and streamlined the Stellar game lifecycle. Utilizing their boilerplate helped us skip configuration and focus purely on creating an engaging, cheat-proof ZK mechanic and a two-player game simulation.

- **GitHub Repository**: [github.com/NikhilRaikwar/Cubeathon](https://github.com/NikhilRaikwar/Cubeathon)
- **Built upon**: [Stellar Game Studio](https://jamesbachini.github.io/Stellar-Game-Studio/)

## 🎥 5) Video Demo
*(Add YouTube Video Link Here)*
This unlisted YouTube video demonstrates the entire flow: initiating a session, navigating the high-speed obstacle course, generating the client-side ZK proof, and completing submission to the on-chain leaderboard.

---

Built with ❤️ for the Stellar ZK Gaming Hackathon.  
**Team Information:** Solo BUIDL by Nikhil Raikwar
