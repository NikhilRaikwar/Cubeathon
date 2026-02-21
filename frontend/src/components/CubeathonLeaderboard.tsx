/**
 * Cubeathon Leaderboard
 *
 * Shows:
 *  - "Hall of Fame" tab: players who completed ALL 3 levels (from on-chain)
 *      - Every run is shown separately (so a player appears twice if they
 *        finished in 10s and later in 9s – both entries shown)
 *  - Level 1 / Level 2 / Level 3 tabs: pulled from the current game state
 *      Local level times (in-progress) shown while waiting for tx confirmation.
 */
import { useState, useEffect, useCallback } from "react";
import { cubeathonService, type LeaderboardEntry, type GameState } from "../services/cubeathonService";

interface LeaderboardProps {
    sessionId: number;
    player1?: string;
    player2?: string;
    /** Local level times to show immediately (optimistic UI) */
    localLevelTimes?: { player: string; level: number; timeMs: number }[];
    onClose: () => void;
}

type Tab = "hall" | "lvl1" | "lvl2" | "lvl3";

const MS = (ms: bigint | number) => (Number(ms) / 1000).toFixed(2) + "s";
const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const medal = (i: number) => i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `#${i + 1}`;

const TAB_LABELS: Record<Tab, string> = {
    hall: "🏆 All Finishers",
    lvl1: "Level 1",
    lvl2: "Level 2",
    lvl3: "Level 3",
};

export function CubeathonLeaderboard({
    sessionId, player1, player2, localLevelTimes = [], onClose
}: LeaderboardProps) {
    const [tab, setTab] = useState<Tab>("hall");
    const [hallOfFame, setHallOfFame] = useState<LeaderboardEntry[]>([]);
    const [gameState, setGameState] = useState<GameState | null>(null);
    const [loading, setLoading] = useState(true);
    const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

    const refresh = useCallback(async () => {
        setLoading(true);
        try {
            const [lb, gs] = await Promise.all([
                cubeathonService.getLeaderboard(),
                cubeathonService.getGame(sessionId),
            ]);
            setHallOfFame(lb);
            setGameState(gs);
            setLastRefresh(new Date());
        } catch (e) {
            console.warn("[Leaderboard]", e);
        } finally {
            setLoading(false);
        }
    }, [sessionId]);

    useEffect(() => { refresh(); }, [refresh]);

    // ── Per-level rows from on-chain game state ──────────────────────────────
    interface LevelRow { player: string; timeMs: number; source: "chain" | "local" }

    function getLevelRows(level: number): LevelRow[] {
        const rows: LevelRow[] = [];

        const addFromProgress = (player: string, times: bigint[]) => {
            const idx = level - 1;
            if (times.length > idx) {
                rows.push({ player, timeMs: Number(times[idx]), source: "chain" });
            }
        };

        if (gameState) {
            addFromProgress(gameState.player1, gameState.p1_progress.level_times);
            addFromProgress(gameState.player2, gameState.p2_progress.level_times);
        }

        // Local optimistic entries (not yet confirmed on-chain)
        for (const lt of localLevelTimes) {
            if (lt.level === level && !rows.find(r => r.player === lt.player)) {
                rows.push({ player: lt.player, timeMs: lt.timeMs, source: "local" });
            }
        }

        return rows.sort((a, b) => a.timeMs - b.timeMs);
    }

    // ── Render ───────────────────────────────────────────────────────────────
    return (
        <div
            style={{
                position: "fixed", inset: 0, background: "rgba(2,6,23,0.82)",
                backdropFilter: "blur(8px)", display: "flex", alignItems: "center",
                justifyContent: "center", zIndex: 2000, padding: 16,
            }}
            onClick={onClose}
        >
            <div
                style={{
                    background: "white", borderRadius: 28, padding: "2rem",
                    width: "100%", maxWidth: 560, maxHeight: "88vh", overflowY: "auto",
                    boxShadow: "0 40px 80px rgba(0,0,0,0.35)",
                }}
                onClick={e => e.stopPropagation()}
            >
                {/* Header */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.25rem" }}>
                    <div>
                        <h3 style={{ fontSize: "1.4rem", fontWeight: 900, margin: 0, color: "#0f172a" }}>
                            Cubeathon Leaderboard ⬛
                        </h3>
                        <p style={{ fontSize: ".65rem", color: "#94a3b8", fontWeight: 700, margin: "3px 0 0", textTransform: "uppercase", letterSpacing: ".08em" }}>
                            Session {sessionId}{lastRefresh ? ` · Updated ${lastRefresh.toLocaleTimeString()}` : ""}
                        </p>
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                        <button
                            onClick={refresh}
                            disabled={loading}
                            style={{ background: "#f1f5f9", border: "none", borderRadius: 10, padding: "6px 14px", fontWeight: 700, fontSize: ".72rem", cursor: "pointer", color: "#475569" }}
                        >
                            {loading ? "⟳" : "↻ Refresh"}
                        </button>
                        <button
                            onClick={onClose}
                            style={{ background: "#f1f5f9", border: "none", borderRadius: 10, padding: "6px 12px", fontWeight: 700, fontSize: ".85rem", cursor: "pointer", color: "#475569" }}
                        >✕</button>
                    </div>
                </div>

                {/* Tab switcher */}
                <div style={{ display: "flex", gap: 6, background: "#f1f5f9", borderRadius: 14, padding: 5, marginBottom: "1.25rem" }}>
                    {(["hall", "lvl1", "lvl2", "lvl3"] as Tab[]).map(t => (
                        <button
                            key={t}
                            onClick={() => setTab(t)}
                            style={{
                                flex: 1, padding: "9px 4px", borderRadius: 10, border: "none", cursor: "pointer",
                                fontWeight: 800, fontSize: ".7rem",
                                background: tab === t ? (t === "hall" ? "linear-gradient(135deg,#f59e0b,#d97706)" : `linear-gradient(135deg,${t === "lvl1" ? "#6366f1,#8b5cf6" : t === "lvl2" ? "#06b6d4,#0284c7" : "#10b981,#059669"})`) : "white",
                                color: tab === t ? "white" : "#6b7280",
                                boxShadow: tab === t ? "0 4px 12px rgba(0,0,0,.15)" : "none",
                                transition: "all .2s",
                            }}
                        >
                            {TAB_LABELS[t]}
                        </button>
                    ))}
                </div>

                {/* ── Hall of Fame (all 3-level finishers, every run) ── */}
                {tab === "hall" && (
                    <div>
                        <div style={{ background: "linear-gradient(135deg,#fffbeb,#fef3c7)", border: "2px solid #fde68a", borderRadius: 14, padding: "10px 14px", marginBottom: "1rem" }}>
                            <p style={{ fontSize: ".72rem", fontWeight: 700, color: "#78350f" }}>
                                🏁 Every completed run is listed. Players appear multiple times if they finished more than once — best overall time highlighted in gold.
                            </p>
                        </div>

                        {loading && <LoadingRow />}

                        {!loading && hallOfFame.length === 0 && (
                            <EmptyState
                                icon="🏜️"
                                title="No finishers yet"
                                subtitle="Complete all 3 levels to appear here!"
                            />
                        )}

                        {!loading && hallOfFame.length > 0 && (
                            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                                {hallOfFame.map((entry, i) => (
                                    <div
                                        key={`${entry.player}-${entry.session_id}-${i}`}
                                        style={{
                                            display: "flex", alignItems: "center", gap: 12,
                                            padding: "12px 16px", borderRadius: 14,
                                            background: i === 0 ? "linear-gradient(90deg,#fffbeb,#fef3c7)" : i < 3 ? "#f8fafc" : "transparent",
                                            border: `1px solid ${i === 0 ? "#fde68a" : "#f1f5f9"}`,
                                        }}
                                    >
                                        <span style={{ fontWeight: 900, fontSize: "1.1rem", minWidth: 28, color: i === 0 ? "#d97706" : "#94a3b8" }}>
                                            {medal(i)}
                                        </span>
                                        <div style={{ flex: 1 }}>
                                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                                <code style={{ fontWeight: 700, fontSize: ".8rem", color: "#334155" }}>
                                                    {shortAddr(entry.player)}
                                                </code>
                                                {(entry.player === player1 || entry.player === player2) && (
                                                    <span style={{ fontSize: ".6rem", fontWeight: 800, background: "#ede9fe", color: "#7c3aed", padding: "1px 7px", borderRadius: 99 }}>
                                                        {entry.player === player1 ? "P1" : "P2"}
                                                    </span>
                                                )}
                                            </div>
                                            <p style={{ fontSize: ".62rem", color: "#94a3b8", fontWeight: 600, margin: "2px 0 0" }}>
                                                Session #{entry.session_id}
                                            </p>
                                        </div>
                                        <div style={{ textAlign: "right" }}>
                                            <div style={{ fontWeight: 900, fontSize: "1.15rem", color: i === 0 ? "#d97706" : "#0f172a" }}>
                                                {MS(entry.time_ms)}
                                            </div>
                                            <div style={{ fontSize: ".6rem", color: "#94a3b8", fontWeight: 700 }}>total time</div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {/* ── Level tabs ── */}
                {(tab === "lvl1" || tab === "lvl2" || tab === "lvl3") && (() => {
                    const lvl = parseInt(tab.replace("lvl", ""), 10);
                    const rows = getLevelRows(lvl);
                    const colors: Record<number, string> = { 1: "#6366f1", 2: "#0284c7", 3: "#059669" };
                    const col = colors[lvl];

                    return (
                        <div>
                            <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 14, padding: "10px 14px", marginBottom: "1rem" }}>
                                <p style={{ fontSize: ".72rem", fontWeight: 700, color: "#475569" }}>
                                    ⏱️ Level {lvl} completion times for this session. Both players' times shown — fastest highlighted.
                                    {rows.some(r => r.source === "local") && " ✦ Local times shown while awaiting on-chain confirmation."}
                                </p>
                            </div>

                            {loading && <LoadingRow />}

                            {!loading && rows.length === 0 && (
                                <EmptyState
                                    icon={lvl === 1 ? "🎮" : lvl === 2 ? "🚀" : "⚡"}
                                    title={`No Level ${lvl} times yet`}
                                    subtitle="Clear this level to see times here"
                                />
                            )}

                            {!loading && rows.length > 0 && (
                                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                                    {rows.map((row, i) => (
                                        <div
                                            key={`${row.player}-${i}`}
                                            style={{
                                                display: "flex", alignItems: "center", gap: 12,
                                                padding: "12px 16px", borderRadius: 14,
                                                background: i === 0 ? `${col}11` : "transparent",
                                                border: `1px solid ${i === 0 ? `${col}33` : "#f1f5f9"}`,
                                            }}
                                        >
                                            <span style={{ fontWeight: 900, fontSize: "1rem", minWidth: 28, color: i === 0 ? col : "#94a3b8" }}>
                                                {medal(i)}
                                            </span>
                                            <div style={{ flex: 1 }}>
                                                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                                    <code style={{ fontWeight: 700, fontSize: ".8rem", color: "#334155" }}>
                                                        {shortAddr(row.player)}
                                                    </code>
                                                    {(row.player === player1 || row.player === player2) && (
                                                        <span style={{ fontSize: ".6rem", fontWeight: 800, background: "#ede9fe", color: "#7c3aed", padding: "1px 7px", borderRadius: 99 }}>
                                                            {row.player === player1 ? "P1" : "P2"}
                                                        </span>
                                                    )}
                                                    {row.source === "local" && (
                                                        <span style={{ fontSize: ".58rem", fontWeight: 700, background: "#fef3c7", color: "#92400e", padding: "1px 6px", borderRadius: 99 }}>
                                                            local
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                            <div style={{ fontWeight: 900, fontSize: "1.1rem", color: i === 0 ? col : "#0f172a" }}>
                                                {(row.timeMs / 1000).toFixed(2)}s
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}

                            {/* Split-time breakdown from game state */}
                            {!loading && gameState && (
                                <div style={{ marginTop: "1rem", padding: "1rem", background: "#f8fafc", borderRadius: 14, border: "1px solid #e2e8f0" }}>
                                    <p style={{ fontSize: ".65rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: ".1em", color: "#64748b", marginBottom: 8 }}>
                                        Full split breakdown (this session)
                                    </p>
                                    <SplitTable gameState={gameState} player1={player1} player2={player2} highlightLevel={lvl} />
                                </div>
                            )}
                        </div>
                    );
                })()}

                {/* Footer */}
                <p style={{ textAlign: "center", color: "#94a3b8", fontSize: ".62rem", fontWeight: 700, marginTop: "1.5rem", textTransform: "uppercase", letterSpacing: ".1em" }}>
                    On-chain · Stellar Testnet · Sorted by fastest time
                </p>
            </div>
        </div>
    );
}

// ── Subcomponents ────────────────────────────────────────────────────────────

function LoadingRow() {
    return (
        <div style={{ display: "flex", gap: 8, flexDirection: "column" }}>
            {[1, 2, 3].map(i => (
                <div key={i} style={{ height: 56, borderRadius: 14, background: "linear-gradient(90deg,#f1f5f9 25%,#e2e8f0 50%,#f1f5f9 75%)", backgroundSize: "200% 100%", animation: "shimmer 1.4s infinite" }} />
            ))}
            <style>{`@keyframes shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }`}</style>
        </div>
    );
}

function EmptyState({ icon, title, subtitle }: { icon: string; title: string; subtitle: string }) {
    return (
        <div style={{ textAlign: "center", padding: "2.5rem 1rem", color: "#94a3b8" }}>
            <div style={{ fontSize: "2.5rem", marginBottom: 10 }}>{icon}</div>
            <p style={{ fontWeight: 800, fontSize: ".9rem", color: "#475569", marginBottom: 4 }}>{title}</p>
            <p style={{ fontSize: ".75rem" }}>{subtitle}</p>
        </div>
    );
}

function SplitTable({
    gameState, player1, player2, highlightLevel,
}: {
    gameState: GameState;
    player1?: string;
    player2?: string;
    highlightLevel: number;
}) {
    const levels = [1, 2, 3];
    const players = [
        { addr: gameState.player1, times: gameState.p1_progress.level_times, label: player1 === gameState.player1 ? "You (P1)" : "Player 1" },
        { addr: gameState.player2, times: gameState.p2_progress.level_times, label: player2 === gameState.player2 ? "You (P2)" : "Player 2" },
    ];

    return (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".75rem" }}>
            <thead>
                <tr>
                    <th style={{ textAlign: "left", padding: "4px 8px", color: "#64748b", fontWeight: 700 }}>Level</th>
                    {players.map(p => (
                        <th key={p.addr} style={{ textAlign: "right", padding: "4px 8px", color: "#64748b", fontWeight: 700 }}>
                            {p.label}<br />
                            <code style={{ fontSize: ".58rem", fontWeight: 400 }}>{p.addr.slice(0, 6)}…</code>
                        </th>
                    ))}
                </tr>
            </thead>
            <tbody>
                {levels.map(lvl => (
                    <tr key={lvl} style={{ background: lvl === highlightLevel ? "rgba(99,102,241,.06)" : "transparent" }}>
                        <td style={{ padding: "5px 8px", fontWeight: 800, color: lvl === highlightLevel ? "#6366f1" : "#334155" }}>
                            {lvl === highlightLevel ? `▶ Lvl ${lvl}` : `Lvl ${lvl}`}
                        </td>
                        {players.map(p => {
                            const t = p.times[lvl - 1];
                            return (
                                <td key={p.addr} style={{ textAlign: "right", padding: "5px 8px", fontWeight: t !== undefined ? 800 : 400, color: t !== undefined ? "#0f172a" : "#cbd5e1" }}>
                                    {t !== undefined ? (Number(t) / 1000).toFixed(2) + "s" : "—"}
                                </td>
                            );
                        })}
                    </tr>
                ))}
                {/* Total row */}
                <tr style={{ borderTop: "1px dashed #e2e8f0" }}>
                    <td style={{ padding: "6px 8px", fontWeight: 900, color: "#0f172a" }}>Total</td>
                    {players.map(p => {
                        const done = p.times.length === 3;
                        const total = done ? p.times.reduce((a, b) => a + b, 0n) : null;
                        return (
                            <td key={p.addr} style={{ textAlign: "right", padding: "6px 8px", fontWeight: 900, color: done ? "#059669" : "#cbd5e1" }}>
                                {total !== null ? (Number(total) / 1000).toFixed(2) + "s" : "—"}
                            </td>
                        );
                    })}
                </tr>
            </tbody>
        </table>
    );
}
