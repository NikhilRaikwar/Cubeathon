/**
 * CubeathonService – simplified for high-reliability hackathon prototype.
 */
import {
    Contract,
    TransactionBuilder,
    BASE_FEE,
    xdr,
    Address,
    nativeToScVal,
    scValToNative,
} from "@stellar/stellar-sdk";
import { rpc as StellarRpc } from "@stellar/stellar-sdk";
import { Buffer } from "buffer";
import {
    CUBEATHON_CONTRACT_ID,
    NETWORK_PASSPHRASE,
    RPC_URL,
} from "../utils/constants";
import type { ContractSigner } from "../types/signer";

const makeServer = () => new StellarRpc.Server(RPC_URL);

export interface LeaderboardEntry {
    session_id: number;
    player: string;
    time_ms: bigint;
}

export interface GameState {
    player1: string;
    player2: string;
    p1_points: bigint;
    p2_points: bigint;
    p1_progress: { max_time_ms: bigint };
    p2_progress: { max_time_ms: bigint };
    winner: string | null;
}

export class CubeathonService {
    /**
     * Start a game session. 
     * In the simplified contract, only the submitter (player2) needs to sign.
     */
    async startGame(
        sessionId: number,
        player1: string,
        player2: string,
        p1Points: bigint,
        p2Points: bigint,
        signer: ContractSigner,
    ): Promise<void> {
        const s = makeServer();
        const account = await s.getAccount(player2);
        const contract = new Contract(CUBEATHON_CONTRACT_ID);

        const args = [
            nativeToScVal(sessionId, { type: "u32" }),
            nativeToScVal(player1, { type: "address" }),
            nativeToScVal(player2, { type: "address" }),
            nativeToScVal(p1Points, { type: "i128" }),
            nativeToScVal(p2Points, { type: "i128" }),
        ];

        const tx = new TransactionBuilder(account, {
            fee: (600000).toString(), // High fee for fast testnet inclusion
            networkPassphrase: NETWORK_PASSPHRASE
        })
            .addOperation(contract.call("start_game", ...args))
            .setTimeout(60).build();

        const sim = await s.simulateTransaction(tx);
        if (StellarRpc.Api.isSimulationError(sim)) {
            console.error("[Cubeathon] Simulation failed:", sim.error);
            throw new Error(`Simulation failed: ${sim.error}`);
        }

        const assembled = StellarRpc.assembleTransaction(tx, sim).build();
        const { signedTxXdr, error } = await signer.signTransaction!(assembled.toXDR(), {
            networkPassphrase: NETWORK_PASSPHRASE,
            address: player2
        });

        if (error) throw new Error(error.message);

        const resp = await s.sendTransaction(TransactionBuilder.fromXDR(signedTxXdr, NETWORK_PASSPHRASE));
        if (resp.status === "ERROR") {
            console.error("[Cubeathon] startGame FAILED:", resp);
            throw new Error(`Start game failed: ${resp.status}`);
        }

        // Poll for completion
        let retries = 0;
        while (retries < 30) {
            await new Promise(r => setTimeout(r, 2000));
            try {
                const t = await s.getTransaction(resp.hash);
                if (t.status === "SUCCESS") return;
                if (t.status === "FAILED") {
                    console.error("[Cubeathon] Transaction hash FAILED on-chain:", resp.hash);
                    throw new Error("Contract execution failed on-chain.");
                }
            } catch (e: any) {
                if (e.message?.includes("not found")) {
                    retries++;
                    continue;
                }
                throw e;
            }
            retries++;
        }
        throw new Error("Transaction timed out.");
    }

    async getGame(sessionId: number): Promise<GameState | null> {
        try {
            const s = makeServer();
            const source = import.meta.env.VITE_DEV_PLAYER1_ADDRESS || "GBD2IS3IQCZV565EMUF6TP74LQ5GFHJDH3GF3YTCF34XHLS7BMK6JATX";
            const account = await s.getAccount(source);
            const contract = new Contract(CUBEATHON_CONTRACT_ID);
            const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: NETWORK_PASSPHRASE })
                .addOperation(contract.call("get_game", nativeToScVal(sessionId, { type: "u32" })))
                .setTimeout(30).build();

            const sim = await s.simulateTransaction(tx);
            if (StellarRpc.Api.isSimulationError(sim)) return null;

            const retval = (sim as any).result?.retval ?? (sim as any).returnValue;
            return retval ? scValToNative(retval) as GameState : null;
        } catch (err) {
            console.warn("[Cubeathon] getGame error:", err);
            return null;
        }
    }

    async submitScore(
        sessionId: number,
        player: string,
        timeMs: bigint,
        signer: ContractSigner,
        proof?: Uint8Array,
        journalHash?: Uint8Array
    ): Promise<boolean> {
        const s = makeServer();
        const account = await s.getAccount(player);
        const contract = new Contract(CUBEATHON_CONTRACT_ID);

        // Use placeholder proof if none provided for testing
        const proofBytes = proof ? Buffer.from(proof) : Buffer.alloc(0);
        const journalBytes = journalHash ? Buffer.from(journalHash) : Buffer.alloc(32);

        const args = [
            nativeToScVal(sessionId, { type: "u32" }),
            nativeToScVal(player, { type: "address" }),
            nativeToScVal(timeMs, { type: "u64" }),
            xdr.ScVal.scvBytes(proofBytes),
            xdr.ScVal.scvBytes(journalBytes),
        ];

        const tx = new TransactionBuilder(account, { fee: (500000).toString(), networkPassphrase: NETWORK_PASSPHRASE })
            .addOperation(contract.call("submit_score", ...args))
            .setTimeout(60).build();

        const sim = await s.simulateTransaction(tx);
        const assembled = StellarRpc.assembleTransaction(tx, sim).build();
        const { signedTxXdr } = await signer.signTransaction!(assembled.toXDR(), {
            networkPassphrase: NETWORK_PASSPHRASE, address: player
        });

        const resp = await s.sendTransaction(TransactionBuilder.fromXDR(signedTxXdr, NETWORK_PASSPHRASE));
        if ((resp.status as any) !== "PENDING" && (resp.status as any) !== "SUCCESS") return false;

        let retries = 0;
        while (retries < 15) {
            await new Promise(r => setTimeout(r, 2000));
            const t = await s.getTransaction(resp.hash);
            if (t.status === "SUCCESS") return true;
            if (t.status === "FAILED") return false;
            retries++;
        }
        return false;
    }

    async endSession(sessionId: number, runner: string, signer: ContractSigner): Promise<string> {
        const s = makeServer();
        const account = await s.getAccount(runner);
        const contract = new Contract(CUBEATHON_CONTRACT_ID);

        const tx = new TransactionBuilder(account, {
            fee: (600000).toString(),
            networkPassphrase: NETWORK_PASSPHRASE
        })
            .addOperation(contract.call("end_session", nativeToScVal(sessionId, { type: "u32" })))
            .setTimeout(60).build();

        const sim = await s.simulateTransaction(tx);
        const assembled = StellarRpc.assembleTransaction(tx, sim).build();
        const { signedTxXdr } = await signer.signTransaction!(assembled.toXDR(), {
            networkPassphrase: NETWORK_PASSPHRASE, address: runner
        });

        const resp = await s.sendTransaction(TransactionBuilder.fromXDR(signedTxXdr, NETWORK_PASSPHRASE));
        if (resp.status === "ERROR") {
            console.error("[Cubeathon] endSession ERROR:", resp);
            throw new Error(`End session failed: ${resp.status}`);
        }

        let retries = 0;
        while (retries < 20) {
            await new Promise(r => setTimeout(r, 2000));
            const t = await s.getTransaction(resp.hash);
            if (t.status === "SUCCESS") {
                // Return winner address from result
                const meta = t.resultMetaXdr;
                return "Match finalized!";
            }
            retries++;
        }
        return "Transaction pending...";
    }

    async getLeaderboard() {
        try {
            const s = makeServer();
            const source = import.meta.env.VITE_DEV_PLAYER1_ADDRESS || "GBD2IS3IQCZV565EMUF6TP74LQ5GFHJDH3GF3YTCF34XHLS7BMK6JATX";
            const account = await s.getAccount(source);
            const contract = new Contract(CUBEATHON_CONTRACT_ID);
            const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: NETWORK_PASSPHRASE })
                .addOperation(contract.call("get_leaderboard"))
                .setTimeout(30).build();

            const sim = await s.simulateTransaction(tx);
            const retval = (sim as any).result?.retval ?? (sim as any).returnValue;
            return retval ? scValToNative(retval) : [];
        } catch {
            return [];
        }
    }

    // Keep parseAuthEntry for UI compatibility, even if used for simpler data transfer now
    parseAuthEntry(data: string) {
        try {
            // If it's the simplified JSON format
            const decoded = JSON.parse(Buffer.from(data, "base64").toString());
            return {
                sessionId: decoded.sessionId,
                player1: decoded.player1,
                player1Points: BigInt(decoded.p1Points || "1000000")
            };
        } catch {
            // Fallback to minimal identity
            return { sessionId: 0, player1: data, player1Points: 1000000n };
        }
    }

    /**
     * For manual P1 -> P2 flow: P1 just exports their address and points
     * since they don't need to authorize the transaction directly anymore.
     */
    async prepareStartGame(
        sessionId: number,
        player1: string,
        p1Points: bigint,
    ): Promise<string> {
        const data = { sessionId, player1, p1Points: p1Points.toString() };
        return Buffer.from(JSON.stringify(data)).toString("base64");
    }
}

export const cubeathonService = new CubeathonService();
