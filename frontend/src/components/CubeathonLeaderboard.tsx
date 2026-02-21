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
import { cubeathonService, type LeaderboardEntry } from "../services/cubeathonService";

interface LeaderboardProps {
    sessionId: number;
    player1?: string;
    player2?: string;
    onClose: () => void;
}

const MS = (ms: bigint | number) => (Number(ms) / 1000).toFixed(2) + "s";
const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const medal = (i: number) => i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `#${i + 1}`;

export function CubeathonLeaderboard({
    sessionId, player1, player2, onClose
}: LeaderboardProps) {
    const [hallOfFame, setHallOfFame] = useState<LeaderboardEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

    const refresh = useCallback(async () => {
        setLoading(true);
        try {
            const lb = await cubeathonService.getLeaderboard();
            setHallOfFame(lb);
            setLastRefresh(new Date());
        } catch (e) {
            console.warn("[Leaderboard]", e);
        } finally {
            setLoading(false);
        }
    }, [sessionId]);

    useEffect(() => { refresh(); }, [refresh]);

    return (
        <div
            style={{
                position: "fixed", inset: 0, background: "rgba(2,6,23,0.85)",
                backdropFilter: "blur(12px)", display: "flex", alignItems: "center",
                justifyContent: "center", zIndex: 2000, padding: 16,
            }}
            onClick={onClose}
        >
            <div
                style={{
                    background: "white", borderRadius: 32, padding: "2.5rem",
                    width: "100%", maxWidth: 540, maxHeight: "85vh", overflowY: "auto",
                    boxShadow: "0 30px 100px rgba(0,0,0,0.5)",
                }}
                onClick={e => e.stopPropagation()}
            >
                {/* Header */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
                    <div>
                        <h3 style={{ fontSize: "1.6rem", fontWeight: 900, margin: 0, color: "#0f172a", letterSpacing: "-0.02em" }}>
                            Survival Records 🏆
                        </h3>
                        <p style={{ fontSize: ".7rem", color: "#64748b", fontWeight: 700, margin: "4px 0 0", textTransform: "uppercase", letterSpacing: ".1em" }}>
                            Session {sessionId}{lastRefresh ? ` · UPDATED ${lastRefresh.toLocaleTimeString()}` : ""}
                        </p>
                    </div>
                    <div style={{ display: "flex", gap: 10 }}>
                        <button
                            onClick={refresh}
                            disabled={loading}
                            style={{ background: "#f1f5f9", border: "none", borderRadius: 12, padding: "8px 16px", fontWeight: 800, fontSize: ".75rem", cursor: "pointer", color: "#475569" }}
                        >
                            {loading ? "⟳" : "↻"}
                        </button>
                        <button
                            onClick={onClose}
                            style={{ background: "#f1f5f9", border: "none", borderRadius: 12, padding: "8px 14px", fontWeight: 800, fontSize: ".9rem", cursor: "pointer", color: "#475569" }}
                        >✕</button>
                    </div>
                </div>

                {/* Global Hall of Fame (All Time) */}
                <div>
                    <p style={{ fontSize: '.75rem', fontWeight: 800, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '.12em', marginBottom: '0.75rem' }}>
                        Global Hall of Fame
                    </p>
                    {loading ? <LoadingRow /> : hallOfFame.length === 0 ? (
                        <EmptyState icon="🏜️" title="No records yet" subtitle="Survive the obstacles to appear here!" />
                    ) : (
                        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                            {hallOfFame.map((entry, i) => (
                                <div
                                    key={`${entry.player}-${i}`}
                                    style={{
                                        display: "flex", alignItems: "center", gap: 12,
                                        padding: "14px 18px", borderRadius: 16,
                                        background: i === 0 ? "linear-gradient(90deg,#fffbeb,#fef3c7)" : i < 3 ? "#f8fafc" : "white",
                                        border: `1px solid ${i === 0 ? "#fde68a" : "#f1f5f9"}`,
                                    }}
                                >
                                    <span style={{ fontWeight: 900, fontSize: "1.2rem", minWidth: 32, color: i === 0 ? "#d97706" : "#94a3b8" }}>
                                        {medal(i)}
                                    </span>
                                    <div style={{ flex: 1 }}>
                                        <code style={{ fontWeight: 800, fontSize: ".9rem", color: "#334155" }}>
                                            {shortAddr(entry.player)}
                                        </code>
                                        <p style={{ fontSize: ".6rem", color: "#94a3b8", fontWeight: 700 }}>SESSION #{entry.session_id}</p>
                                    </div>
                                    <div style={{ textAlign: "right", fontWeight: 900, fontSize: "1.1rem", color: "#0f172a" }}>
                                        {MS(entry.time_ms)}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                <p style={{ textAlign: "center", color: "#cbd5e1", fontSize: ".65rem", fontWeight: 700, marginTop: "2rem", textTransform: "uppercase", letterSpacing: ".08em" }}>
                    Verified by ZK Protocol · Stellar Testnet
                </p>
            </div>
        </div>
    );
}

function LoadingRow() {
    return (
        <div style={{ display: "flex", gap: 10, flexDirection: "column" }}>
            {[1, 2, 3].map(i => (
                <div key={i} style={{ height: 60, borderRadius: 16, background: "linear-gradient(90deg,#f1f5f9 25%,#e2e8f0 50%,#f1f5f9 75%)", backgroundSize: "200% 100%", animation: "shimmer 1.4s infinite" }} />
            ))}
            <style>{`@keyframes shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }`}</style>
        </div>
    );
}

function EmptyState({ icon, title, subtitle }: { icon: string; title: string; subtitle: string }) {
    return (
        <div style={{ textAlign: "center", padding: "3rem 1rem", color: "#cbd5e1" }}>
            <div style={{ fontSize: "3rem", marginBottom: 16 }}>{icon}</div>
            <p style={{ fontWeight: 800, fontSize: "1rem", color: "#64748b", marginBottom: 6 }}>{title}</p>
            <p style={{ fontSize: ".85rem" }}>{subtitle}</p>
        </div>
    );
}
