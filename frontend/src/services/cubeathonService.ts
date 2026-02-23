/**
 * CubeathonService – full Stellar integration using raw Stellar SDK.
 * Contract functions: start_game, submit_level, get_game, get_leaderboard
 */
import {
    Contract,
    TransactionBuilder,
    BASE_FEE,
    xdr,
    Address,
    authorizeEntry,
    nativeToScVal,
    scValToNative,
} from "@stellar/stellar-sdk";
import { rpc as StellarRpc } from "@stellar/stellar-sdk";
import { Buffer } from "buffer";
import {
    CUBEATHON_CONTRACT_ID,
    NETWORK_PASSPHRASE,
    RPC_URL,
    MULTI_SIG_AUTH_TTL_MINUTES,
    DEFAULT_AUTH_TTL_MINUTES,
} from "../utils/constants";
import { calculateValidUntilLedger } from "../utils/ledgerUtils";
import type { ContractSigner } from "../types/signer";

// ── On-chain types (mirroring the Rust contract) ─────────────────────────────

export interface PlayerProgress {
    max_time_ms: bigint;    // Longest survival time in milliseconds
}

export interface GameState {
    player1: string;
    player2: string;
    p1_points: bigint;
    p2_points: bigint;
    p1_progress: PlayerProgress;
    p2_progress: PlayerProgress;
    winner: string | null;
    started_at: bigint;
}

export interface LeaderboardEntry {
    player: string;
    time_ms: bigint;    // survival time in ms
    session_id: number;
    timestamp: bigint;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const makeServer = () => new StellarRpc.Server(RPC_URL);

async function buildAndSimulate(
    method: string,
    args: xdr.ScVal[],
    sourceAddress: string,
    contractId: string = CUBEATHON_CONTRACT_ID,
) {
    if (!contractId) {
        throw new Error("VITE_CUBEATHON_CONTRACT_ID is not set in .env.");
    }
    const s = makeServer();
    const account = await s.getAccount(sourceAddress);
    const contract = new Contract(contractId);
    const tx = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: NETWORK_PASSPHRASE,
    })
        .addOperation(contract.call(method, ...args))
        .setTimeout(30)
        .build();

    const sim = await s.simulateTransaction(tx);
    if (StellarRpc.Api.isSimulationError(sim)) {
        throw new Error(`Simulation error in "${method}": ${(sim as any).error}`);
    }
    return { tx, sim, server: s };
}

async function assembleSignSend(
    method: string,
    args: xdr.ScVal[],
    signerAddress: string,
    signer: ContractSigner,
    contractId: string = CUBEATHON_CONTRACT_ID,
) {
    const { tx, sim, server: s } = await buildAndSimulate(method, args, signerAddress, contractId);
    const assembled = StellarRpc.assembleTransaction(tx, sim).build();

    if (!signer.signTransaction) throw new Error("signTransaction not available");
    const { signedTxXdr, error } = await signer.signTransaction(
        assembled.toXDR(),
        { networkPassphrase: NETWORK_PASSPHRASE, address: signerAddress }
    );
    if (error) throw new Error(error.message);

    let resp = await s.sendTransaction(
        TransactionBuilder.fromXDR(signedTxXdr, NETWORK_PASSPHRASE)
    );
    if (resp.status === "ERROR") {
        throw new Error(`Submit error: ${resp.status}`);
    }
    while (resp.status === "PENDING") {
        await new Promise((r) => setTimeout(r, 2000));
        resp = await s.getTransaction(resp.hash) as any;
    }
    if ((resp as any).status === "SUCCESS") {
        const rv = (resp as any).returnValue;
        return rv ? scValToNative(rv) : null;
    }
    throw new Error(`Transaction failed with status: ${(resp as any).status}`);
}

// ── ScVal → JS helpers ───────────────────────────────────────────────────────

function nativeToGameState(raw: any): GameState {
    const toProgress = (p: any): PlayerProgress => ({
        max_time_ms: BigInt(p?.max_time_ms ?? 0),
    });
    return {
        player1: String(raw?.player1 ?? ""),
        player2: String(raw?.player2 ?? ""),
        p1_points: BigInt(raw?.p1_points ?? 0),
        p2_points: BigInt(raw?.p2_points ?? 0),
        p1_progress: toProgress(raw?.p1_progress),
        p2_progress: toProgress(raw?.p2_progress),
        winner: raw?.winner ? String(raw.winner) : null,
        started_at: BigInt(raw?.started_at ?? 0),
    };
}

function nativeToLeaderboardEntry(raw: any): LeaderboardEntry {
    return {
        player: String(raw?.player ?? ""),
        time_ms: BigInt(raw?.time_ms ?? 0),
        session_id: Number(raw?.session_id ?? 0),
        timestamp: BigInt(raw?.timestamp ?? 0),
    };
}

// ── Service class ────────────────────────────────────────────────────────────

export class CubeathonService {

    async getGame(sessionId: number): Promise<GameState | null> {
        try {
            const simSource = import.meta.env.VITE_DEV_PLAYER1_ADDRESS || "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";
            const { sim } = await buildAndSimulate(
                "get_game",
                [nativeToScVal(sessionId, { type: "u32" })],
                simSource,
            );
            const retval = (sim as any).result?.retval ?? (sim as any).returnValue;
            if (!retval) return null;
            const native = scValToNative(retval);
            return native ? nativeToGameState(native) : null;
        } catch (err) {
            console.warn("[CubeathonService.getGame]", err);
            return null;
        }
    }

    async getLeaderboard(): Promise<LeaderboardEntry[]> {
        try {
            const simSource = import.meta.env.VITE_DEV_PLAYER1_ADDRESS || "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";
            const { sim } = await buildAndSimulate("get_leaderboard", [], simSource);
            const retval = (sim as any).result?.retval ?? (sim as any).returnValue;
            if (!retval) return [];
            const native = scValToNative(retval);
            return Array.isArray(native) ? native.map(nativeToLeaderboardEntry) : [];
        } catch (err) {
            console.warn("[CubeathonService.getLeaderboard]", err);
            return [];
        }
    }

    async prepareStartGame(
        sessionId: number,
        player1: string,
        player2: string,
        player1Points: bigint,
        player2Points: bigint,
        player1Signer: ContractSigner,
    ): Promise<string> {
        const { sim } = await buildAndSimulate(
            "start_game",
            [
                nativeToScVal(sessionId, { type: "u32" }),
                nativeToScVal(player1, { type: "address" }),
                nativeToScVal(player2, { type: "address" }),
                nativeToScVal(player1Points, { type: "i128" }),
                nativeToScVal(player2Points, { type: "i128" }),
            ],
            player2,
        );

        if (!(sim as any).result?.auth?.length) throw new Error("No auth entries returned.");

        let p1Entry: xdr.SorobanAuthorizationEntry | null = null;
        for (const entry of (sim as any).result.auth as xdr.SorobanAuthorizationEntry[]) {
            try {
                if (entry.credentials().switch().name !== "sorobanCredentialsAddress") continue;
                const addr = Address.fromScAddress(entry.credentials().address().address()).toString();
                if (addr === player1) { p1Entry = entry; break; }
            } catch { continue; }
        }
        if (!p1Entry) throw new Error("No auth entry found for Player 1");

        const validUntil = await calculateValidUntilLedger(RPC_URL, MULTI_SIG_AUTH_TTL_MINUTES);
        const signed = await authorizeEntry(
            p1Entry,
            async (preimage) => {
                const res = await player1Signer.signAuthEntry!(preimage.toXDR("base64"), {
                    networkPassphrase: NETWORK_PASSPHRASE,
                    address: player1,
                });
                if (res.error) throw new Error(res.error.message);
                return Buffer.from(res.signedAuthEntry, "base64");
            },
            validUntil,
            NETWORK_PASSPHRASE,
        );
        return signed.toXDR("base64");
    }

    async importAndStartGame(
        player1AuthXDR: string,
        player2: string,
        player2Points: bigint,
        player2Signer: ContractSigner,
    ): Promise<void> {
        const { sessionId, player1, player1Points } = this.parseAuthEntry(player1AuthXDR);
        const args = [
            nativeToScVal(sessionId, { type: "u32" }),
            nativeToScVal(player1, { type: "address" }),
            nativeToScVal(player2, { type: "address" }),
            nativeToScVal(player1Points, { type: "i128" }),
            nativeToScVal(player2Points, { type: "i128" }),
        ];

        const s = makeServer();
        const account = await s.getAccount(player2);
        const contract = new Contract(CUBEATHON_CONTRACT_ID);

        // 1. Initial simulation to get the P2 auth placeholder
        const baseTx = new TransactionBuilder(account, { fee: "200000", networkPassphrase: NETWORK_PASSPHRASE })
            .addOperation(contract.call("start_game", ...args)).setTimeout(30).build();

        const sim = await s.simulateTransaction(baseTx);
        if (StellarRpc.Api.isSimulationError(sim)) throw new Error(`Simulation failed: ${sim.error}`);

        const auth: xdr.SorobanAuthorizationEntry[] = (sim as any).result?.auth ?? [];
        const p1Signed = xdr.SorobanAuthorizationEntry.fromXDR(player1AuthXDR, "base64");
        const p1AddrKey = Address.fromScAddress(p1Signed.credentials().address().address()).toString();
        const validUntil = await calculateValidUntilLedger(RPC_URL, 60);

        for (let i = 0; i < auth.length; i++) {
            const creds = auth[i].credentials();
            if (creds.switch().name !== "sorobanCredentialsAddress") continue;
            const addr = Address.fromScAddress(creds.address().address()).toString();
            if (addr === p1AddrKey) {
                auth[i] = p1Signed;
            } else if (addr === player2) {
                auth[i] = await authorizeEntry(
                    auth[i],
                    async (preimage) => {
                        const res = await player2Signer.signAuthEntry!(preimage.toXDR("base64"), {
                            networkPassphrase: NETWORK_PASSPHRASE,
                            address: player2,
                        });
                        if (res.error) throw new Error(res.error.message);
                        return Buffer.from(res.signedAuthEntry, "base64");
                    },
                    validUntil,
                    NETWORK_PASSPHRASE,
                );
            }
        }

        // 2. Refresh Sequence & Re-build operation with embedded auth
        const freshAccount = await s.getAccount(player2);
        const finalOp = contract.call("start_game", ...args);
        (finalOp as any).auth = auth;

        const finalTx = new TransactionBuilder(freshAccount, { fee: "200000", networkPassphrase: NETWORK_PASSPHRASE })
            .addOperation(finalOp).setTimeout(30).build();

        // 3. Re-simulate with AUTH to get perfect footprint
        const finalSim = await s.simulateTransaction(finalTx);
        if (StellarRpc.Api.isSimulationError(finalSim)) {
            console.error("[Cubeathon] Final simulation failed:", finalSim);
            throw new Error(`Execution would fail on-chain: ${finalSim.error}`);
        }

        // 4. Assemble, Sign and Send
        const assembled = StellarRpc.assembleTransaction(finalTx, finalSim).build();
        if (!player2Signer.signTransaction) throw new Error("signTransaction missing");
        const { signedTxXdr, error } = await player2Signer.signTransaction(assembled.toXDR(), { networkPassphrase: NETWORK_PASSPHRASE, address: player2 });
        if (error) throw new Error(error.message);

        let resp = await s.sendTransaction(TransactionBuilder.fromXDR(signedTxXdr, NETWORK_PASSPHRASE));
        if (resp.status === "ERROR") {
            const errXdr = (resp as any).errorResultXdr || (resp as any).errorResult?.toXDR?.();
            const b64 = errXdr instanceof Uint8Array ? Buffer.from(errXdr).toString("base64") : (errXdr || "No XDR");
            console.error("[Cubeathon] sendTransaction ERROR:", resp, "XDR:", b64);
            throw new Error(`Tx Rejected: ${b64}`);
        }

        let finalResp: any = resp;
        let retries = 0;
        while (finalResp.status === "PENDING" || (finalResp.status === "NOT_FOUND" && retries < 15)) {
            await new Promise((r) => setTimeout(r, 2000));
            try {
                finalResp = await s.getTransaction(resp.hash);
            } catch (err: any) {
                if (err.message?.includes("NOT_FOUND")) { finalResp = { status: "NOT_FOUND", hash: resp.hash }; } else { throw err; }
            }
            if (finalResp.status === "NOT_FOUND") retries++;
        }

        if (finalResp.status !== "SUCCESS") {
            const meta = finalResp.resultMetaXdr;
            let b64 = "No Meta";
            if (meta) {
                try {
                    b64 = (typeof meta === 'string') ? meta : (meta.toXDR ? meta.toXDR("base64") : JSON.stringify(meta));
                } catch { b64 = "Unstringifiable Meta"; }
            }
            console.error(`[Cubeathon] Transaction FAILED (On-Chain). Status: ${finalResp.status}`, "Meta XDR:", b64);
            throw new Error(`On-chain error: ${finalResp.status}. Check console for Meta XDR.`);
        }
    }

    async submitScore(sessionId: number, player: string, timeMs: bigint, signer: ContractSigner, proof?: Uint8Array, journalHash?: Uint8Array): Promise<boolean> {
        const proofBytes = proof ?? new Uint8Array(0);
        const hashBytes = journalHash ?? new Uint8Array(32);
        return await assembleSignSend("submit_score", [nativeToScVal(sessionId, { type: "u32" }), nativeToScVal(player, { type: "address" }), nativeToScVal(timeMs, { type: "u64" }), xdr.ScVal.scvBytes(Buffer.from(proofBytes)), xdr.ScVal.scvBytes(Buffer.from(hashBytes))], player, signer) as boolean;
    }

    parseAuthEntry(xdrBase64: string) {
        const entry = xdr.SorobanAuthorizationEntry.fromXDR(xdrBase64, "base64");
        const creds = entry.credentials();
        const player1 = Address.fromScAddress(creds.address().address()).toString();
        const args = entry.rootInvocation().function().contractFn().args();
        return {
            sessionId: Number(scValToNative(args[0])),
            player1,
            player1Points: BigInt(scValToNative(args[3])),
        };
    }
}

export const cubeathonService = new CubeathonService();
