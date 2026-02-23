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
        throw new Error(
            "VITE_CUBEATHON_CONTRACT_ID is not set in .env. " +
            "Run: bun run deploy  (or set it manually after deploying the contract)"
        );
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
        throw new Error(`Submit error: ${(resp as any).errorResult?.toXDR?.() ?? resp.status}`);
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

function scValToProgress(v: xdr.ScVal): PlayerProgress {
    const raw = scValToNative(v) as any;
    return {
        max_time_ms: BigInt(raw.max_time_ms ?? 0),
    };
}

function scValToGameState(v: xdr.ScVal): GameState {
    const raw = scValToNative(v) as any;
    return {
        player1: raw.player1?.toString?.() ?? "",
        player2: raw.player2?.toString?.() ?? "",
        p1_points: BigInt(raw.p1_points ?? 0),
        p2_points: BigInt(raw.p2_points ?? 0),
        p1_progress: scValToProgress(xdr.ScVal.fromXDR((raw.p1_progress as any).toXDR?.() ?? "", "raw")),
        p2_progress: scValToProgress(xdr.ScVal.fromXDR((raw.p2_progress as any).toXDR?.() ?? "", "raw")),
        winner: raw.winner ? raw.winner.toString() : null,
        started_at: BigInt(raw.started_at ?? 0),
    };
}

// simpler approach – just cast the native result
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

    // ── Read: get_game ─────────────────────────────────────────────────────────

    async getGame(sessionId: number): Promise<GameState | null> {
        try {
            const simSource =
                import.meta.env.VITE_DEV_PLAYER1_ADDRESS ||
                "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";
            const { sim } = await buildAndSimulate(
                "get_game",
                [nativeToScVal(sessionId, { type: "u32" })],
                simSource,
            );
            const retval = (sim as any).result?.retval ?? (sim as any).returnValue;
            if (!retval) return null;
            const native = scValToNative(retval);
            if (!native) return null;
            return nativeToGameState(native);
        } catch (err) {
            console.warn("[CubeathonService.getGame]", err);
            return null;
        }
    }

    // ── Read: get_leaderboard ──────────────────────────────────────────────────

    async getLeaderboard(): Promise<LeaderboardEntry[]> {
        try {
            const simSource =
                import.meta.env.VITE_DEV_PLAYER1_ADDRESS ||
                "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";
            const { sim } = await buildAndSimulate("get_leaderboard", [], simSource);
            const retval = (sim as any).result?.retval ?? (sim as any).returnValue;
            if (!retval) return [];
            const native = scValToNative(retval);
            if (!Array.isArray(native)) return [];
            return native.map(nativeToLeaderboardEntry);
        } catch (err) {
            console.warn("[CubeathonService.getLeaderboard]", err);
            return [];
        }
    }

    // ── Write: start_game – Step 1 (Player 1 signs + exports auth XDR) ─────────

    async prepareStartGame(
        sessionId: number,
        player1: string,
        player2: string,
        player1Points: bigint,
        player2Points: bigint,
        player1Signer: ContractSigner,
        ttlMinutes = MULTI_SIG_AUTH_TTL_MINUTES,
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
            player2, // source = player2 so simulation can build auth entries for both
        );

        if (!(sim as any).result?.auth?.length) {
            throw new Error(
                "No auth entries returned from simulation. " +
                "This usually means the contract ID is wrong or the Game Hub is not reachable."
            );
        }

        let p1Entry: xdr.SorobanAuthorizationEntry | null = null;
        for (const entry of (sim as any).result.auth as xdr.SorobanAuthorizationEntry[]) {
            try {
                if (entry.credentials().switch().name !== "sorobanCredentialsAddress") continue;
                const addr = Address.fromScAddress(entry.credentials().address().address()).toString();
                if (addr === player1) { p1Entry = entry; break; }
            } catch { continue; }
        }
        if (!p1Entry) throw new Error(`No auth entry found for Player 1 (${player1.slice(0, 8)}…)`);

        const validUntil = await calculateValidUntilLedger(RPC_URL, ttlMinutes);
        if (!player1Signer.signAuthEntry) throw new Error("signAuthEntry not available on signer");

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

    // ── Write: start_game – Step 2 (Player 2 injects P1 auth + submits tx) ─────

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

        // 1. Build the base transaction
        const baseTx = new TransactionBuilder(account, {
            fee: "200000",
            networkPassphrase: NETWORK_PASSPHRASE,
        }).addOperation(contract.call("start_game", ...args)).setTimeout(30).build();

        // 2. Initial simulation to get the placeholders
        let sim = await s.simulateTransaction(baseTx);
        if (StellarRpc.Api.isSimulationError(sim)) {
            throw new Error(`Simulation error: ${sim.error}`);
        }

        const auth: xdr.SorobanAuthorizationEntry[] = (sim as any).result?.auth ?? [];
        const p1Signed = xdr.SorobanAuthorizationEntry.fromXDR(player1AuthXDR, "base64");
        const p1AddrKey = Address.fromScAddress(p1Signed.credentials().address().address()).toString();

        // Use a much longer TTL to prevent expiration during network lag
        const validUntil = await calculateValidUntilLedger(RPC_URL, 30); // 30 mins

        // 3. Populate auth entries with signatures
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

        // 4. Update the simulation result with BOTH signed authorizations
        // This is CRITICAL: assembleTransaction uses the sim's result to build the final footprint
        const simWithAuths = {
            ...sim,
            result: {
                ...(sim as any).result,
                auth: auth
            }
        };

        // 5. Refresh account sequence and ASSEMBLE
        const freshAccount = await s.getAccount(player2);
        const finalTx = new TransactionBuilder(freshAccount, {
            fee: "200000",
            networkPassphrase: NETWORK_PASSPHRASE,
        }).addOperation(contract.call("start_game", ...args)).setTimeout(30).build();

        // assembleTransaction merges the footprint and auth into the final transaction
        const assembled = StellarRpc.assembleTransaction(finalTx, simWithAuths as any).build();

        // 6. Sign and Submit
        if (!player2Signer.signTransaction) throw new Error("signTransaction not available");
        const { signedTxXdr, error } = await player2Signer.signTransaction(
            assembled.toXDR(),
            { networkPassphrase: NETWORK_PASSPHRASE, address: player2 }
        );
        if (error) throw new Error(error.message);

        let resp = await s.sendTransaction(
            TransactionBuilder.fromXDR(signedTxXdr, NETWORK_PASSPHRASE)
        );
        if (resp.status === "ERROR") {
            let errXdr = (resp as any).errorResultXdr || (resp as any).errorResult?.toXDR?.();
            if (errXdr instanceof Uint8Array) errXdr = Buffer.from(errXdr).toString("base64");
            console.error("[Cubeathon] sendTransaction ERROR:", resp, "XDR:", errXdr);
            throw new Error(`Tx error: ${errXdr || "unknown status: ERROR"}`);
        }

        let finalResp: any = resp;
        let retries = 0;
        while (finalResp.status === "PENDING" || (finalResp.status === "NOT_FOUND" && retries < 15)) {
            await new Promise((r) => setTimeout(r, 2000));
            try {
                finalResp = await s.getTransaction(resp.hash);
            } catch (err: any) {
                if (err.message?.includes("NOT_FOUND")) {
                    finalResp = { status: "NOT_FOUND", hash: resp.hash };
                } else { throw err; }
            }
            if (finalResp.status === "NOT_FOUND") retries++;
        }

        if (finalResp.status !== "SUCCESS") {
            console.error(`[Cubeathon] Transaction FAILED. Status: ${finalResp.status}`, finalResp);
            const meta = finalResp.resultMetaXdr;
            if (meta) {
                console.error(`[Cubeathon] Failure resultMetaXdr (Base64):`, meta);
                console.warn("[Cubeathon] Decode at https://lab.stellar.org/#xdr-viewer?type=TransactionMeta&network=testnet");
            }
            throw new Error(`Session initialization failed: ${finalResp.status}`);
        }
    }

    // ── Write: submit_score ────────────────────────────────────────────────────

    async submitScore(
        sessionId: number,
        player: string,
        timeMs: bigint,
        signer: ContractSigner,
        proof?: Uint8Array,
        journalHash?: Uint8Array,
    ): Promise<boolean> {
        const proofBytes = proof ?? new Uint8Array(0);
        const hashBytes = journalHash ?? new Uint8Array(32);

        return await assembleSignSend(
            "submit_score",
            [
                nativeToScVal(sessionId, { type: "u32" }),
                nativeToScVal(player, { type: "address" }),
                nativeToScVal(timeMs, { type: "u64" }),
                xdr.ScVal.scvBytes(Buffer.from(proofBytes)),
                xdr.ScVal.scvBytes(Buffer.from(hashBytes)),
            ],
            player,
            signer,
        ) as boolean;
    }

    // ── Write: end_session ───────────────────────────────────────────────────

    async endSession(
        sessionId: number,
        adminAddress: string,
        adminSigner: ContractSigner,
    ): Promise<string> {
        return await assembleSignSend(
            "end_session",
            [nativeToScVal(sessionId, { type: "u32" })],
            adminAddress,
            adminSigner,
        ) as string;
    }

    // ── Utility: parse auth entry XDR → game params ─────────────────────────────

    parseAuthEntry(xdrBase64: string): {
        sessionId: number;
        player1: string;
        player1Points: bigint;
    } {
        const entry = xdr.SorobanAuthorizationEntry.fromXDR(xdrBase64, "base64");
        const creds = entry.credentials();
        if (creds.switch().name !== "sorobanCredentialsAddress") {
            throw new Error(`Unsupported credential type: ${creds.switch().name}`);
        }
        const player1 = Address.fromScAddress(creds.address().address()).toString();
        const fn = entry.rootInvocation().function().contractFn();
        const fnName = fn.functionName().toString();
        if (fnName !== "start_game") {
            throw new Error(`Expected "start_game" in auth entry, got "${fnName}"`);
        }
        const args = fn.args();
        return {
            sessionId: args[0].u32(),
            player1,
            player1Points: args[3].i128() ? (() => {
                const hi = args[3].i128().hi().toBigInt() << 64n;
                const lo = args[3].i128().lo().toBigInt();
                return hi | lo;
            })() : 0n,
        };
    }
}

export const cubeathonService = new CubeathonService();
