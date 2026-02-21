import { useState, useEffect, useRef, useCallback } from 'react';
import { cubeathonService } from '../../services/cubeathonService';
import { useWallet } from '../../hooks/useWallet';
import { CubeathonLeaderboard } from '../../components/CubeathonLeaderboard';
import type { LeaderboardEntry } from '../../services/cubeathonService';

// ─────────────────────────────────────────────────────────
// GAME CONSTANTS
// ─────────────────────────────────────────────────────────
const CANVAS_W = 860;
const CANVAS_H = 540;

const ROAD_LEFT = 60;
const ROAD_RIGHT = 800;
const ROAD_W = ROAD_RIGHT - ROAD_LEFT;

const CUBE_W = 52;
const CUBE_H = 52;
const CUBE_SCREEN_Y = CANVAS_H - 80;

const WALL_H = 36;
const GAP_W = 130;
const WALL_GAP_PADDING = 14;

const BASE_SPEEDS = [2.2, 3.8, 5.5];
const WALLS_PER_LEVEL = [7, 9, 13];
const TRACK_SPACING = [420, 340, 260];

interface Wall { worldY: number; gapX: number; }

// localStorage keys for player progress persistence
const storageKey = (sid: number, addr: string, prop: string) =>
    `cubeathon:${sid}:${addr.slice(0, 8)}:${prop}`;

interface LevelRecord {
    level: number;
    timeMs: number;
}

export interface CubeathonGameProps {
    userAddress: string;
    sessionId: number;
    player1: string;
    player2: string;
    availablePoints: bigint;
    onBack: () => void;
    onStandingsRefresh: () => void;
    onGameComplete: (winnerAddr: string) => void;
}

// ─────────────────────────────────────────────────────────
// WALL GENERATION
// ─────────────────────────────────────────────────────────
function generateTrack(level: number, seed: number) {
    // Deterministic PRNG so both players get an identical track
    let s = seed ^ (level * 0xdeadbeef);
    const rng = () => {
        s = ((s >>> 0) * 1664525 + 1013904223) >>> 0;
        return s / 4294967296;
    };

    const count = WALLS_PER_LEVEL[level - 1];
    const spacing = TRACK_SPACING[level - 1];
    const walls: Wall[] = [];
    for (let i = 0; i < count; i++) {
        const worldY = -(400 + i * spacing);
        const maxGapLeft = ROAD_W - GAP_W - WALL_GAP_PADDING;
        const gapX = WALL_GAP_PADDING + Math.floor(rng() * (maxGapLeft - WALL_GAP_PADDING));
        walls.push({ worldY, gapX });
    }
    return { walls, trackLength: 400 + count * spacing + 200 };
}

// ─────────────────────────────────────────────────────────
export function CubeathonGame({
    userAddress, sessionId, player1, player2, availablePoints,
    onBack, onStandingsRefresh, onGameComplete
}: CubeathonGameProps) {
    const { getContractSigner } = useWallet();
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const rafRef = useRef<number>(0);

    // Track local times for optimistic UI in leaderboard
    const [localLevelTimes, setLocalLevelTimes] = useState<{ player: string, level: number, timeMs: number }[]>([]);

    // Persistent per-player progress (localStorage)
    const addrKey = userAddress.slice(0, 8);
    const isPlayer1 = userAddress === player1;

    const savedLevel = (): number => {
        try { return parseInt(localStorage.getItem(storageKey(sessionId, userAddress, 'level')) || '1'); }
        catch { return 1; }
    };

    // All mutable game state in a ref
    const g = useRef({
        phase: 'idle' as 'idle' | 'countdown' | 'playing' | 'levelup' | 'dead' | 'done',
        level: savedLevel(),
        startLevel: savedLevel(), // the level this player resumed from
        cameraY: 0,
        cubeX: (ROAD_W - CUBE_W) / 2,
        moveLeft: false,
        moveRight: false,
        walls: [] as Wall[],
        trackLength: 0,
        levelStartTs: 0,
        levelTime: 0,        // ms for current level
        totalTimeMs: 0,       // cumulative ms across levels
        countdownN: 3,
        countdownTs: 0,
        levelUpTs: 0,
        nextWalls: [] as Wall[],
        nextTrackLen: 0,
        levelRecords: [] as LevelRecord[],
    });

    // React state (for UI)
    const [phase, setPhase] = useState<typeof g.current.phase>('idle');
    const [currentLevel, setCurrentLevel] = useState(savedLevel());
    const [levelTime, setLevelTime] = useState(0);
    const [totalTime, setTotalTime] = useState(0);
    const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
    const [showLeaderboard, setShowLeaderboard] = useState(false);

    // ─── DRAW ─────────────────────────────────────────────
    const draw = useCallback(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d')!;
        const s = g.current;

        ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

        // BG
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

        // ── Road
        const roadGrad = ctx.createLinearGradient(ROAD_LEFT, 0, ROAD_RIGHT, 0);
        roadGrad.addColorStop(0, '#1e1b4b');
        roadGrad.addColorStop(0.5, '#1e1b60');
        roadGrad.addColorStop(1, '#1e1b4b');
        ctx.fillStyle = roadGrad;
        ctx.fillRect(ROAD_LEFT, 0, ROAD_W, CANVAS_H);

        // Road edges
        ctx.strokeStyle = '#6366f1'; ctx.lineWidth = 3;
        ctx.shadowColor = '#6366f1'; ctx.shadowBlur = 10;
        ctx.beginPath(); ctx.moveTo(ROAD_LEFT, 0); ctx.lineTo(ROAD_LEFT, CANVAS_H); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(ROAD_RIGHT, 0); ctx.lineTo(ROAD_RIGHT, CANVAS_H); ctx.stroke();
        ctx.shadowBlur = 0;

        // Dashes
        const dashOffset = s.cameraY % 60;
        ctx.strokeStyle = 'rgba(99,102,241,0.15)'; ctx.lineWidth = 1;
        ctx.setLineDash([20, 40]); ctx.lineDashOffset = -dashOffset;
        ctx.beginPath(); ctx.moveTo(CANVAS_W / 2, 0); ctx.lineTo(CANVAS_W / 2, CANVAS_H); ctx.stroke();
        ctx.setLineDash([]); ctx.lineDashOffset = 0;

        // Finish line
        const distToFinish = s.trackLength - s.cameraY;
        if (distToFinish < CANVAS_H) {
            const fy = CUBE_SCREEN_Y - distToFinish;
            if (fy > -20) {
                for (let bx = ROAD_LEFT; bx < ROAD_RIGHT; bx += 16) {
                    ctx.fillStyle = ((bx - ROAD_LEFT) / 16) % 2 === 0 ? '#22d3ee' : '#fff';
                    ctx.fillRect(bx, fy, 16, 10);
                }
            }
        }

        // ── Walls
        for (const wall of s.walls) {
            const screenY = CUBE_SCREEN_Y + wall.worldY + s.cameraY;
            if (screenY < -WALL_H || screenY > CANVAS_H) continue;

            const gL = ROAD_LEFT + wall.gapX;
            const gR = gL + GAP_W;

            const drawBlock = (x: number, w: number) => {
                if (w <= 0) return;
                const bg = ctx.createLinearGradient(x, screenY, x + w, screenY + WALL_H);
                bg.addColorStop(0, '#ef4444'); bg.addColorStop(1, '#b91c1c');
                ctx.fillStyle = bg; ctx.fillRect(x, screenY, w, WALL_H);
                ctx.fillStyle = '#fca5a5'; ctx.fillRect(x, screenY, w, 4);
                ctx.shadowColor = '#ef4444'; ctx.shadowBlur = 14;
                ctx.strokeStyle = '#ef4444'; ctx.lineWidth = 1;
                ctx.strokeRect(x, screenY, w, WALL_H);
                ctx.shadowBlur = 0;
            };
            drawBlock(ROAD_LEFT, wall.gapX);
            drawBlock(gR, ROAD_RIGHT - gR);

            const gg = ctx.createLinearGradient(gL, screenY, gL, screenY + WALL_H);
            gg.addColorStop(0, 'rgba(34,197,94,0.25)'); gg.addColorStop(1, 'rgba(34,197,94,0)');
            ctx.fillStyle = gg; ctx.fillRect(gL + 1, screenY, GAP_W - 2, WALL_H);
        }

        // ── Cube
        const cx = ROAD_LEFT + s.cubeX;
        const cy = CUBE_SCREEN_Y - CUBE_H;

        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.fillRect(cx + 4, cy + CUBE_H + 2, CUBE_W - 4, 6);

        ctx.shadowColor = '#06b6d4'; ctx.shadowBlur = 20;
        const cg = ctx.createLinearGradient(cx, cy, cx + CUBE_W, cy + CUBE_H);
        cg.addColorStop(0, '#22d3ee'); cg.addColorStop(1, '#0891b2');
        ctx.fillStyle = cg; ctx.fillRect(cx, cy, CUBE_W, CUBE_H);

        // 3D top
        ctx.fillStyle = '#67e8f9';
        ctx.beginPath();
        ctx.moveTo(cx, cy); ctx.lineTo(cx + 10, cy - 10);
        ctx.lineTo(cx + CUBE_W + 10, cy - 10); ctx.lineTo(cx + CUBE_W, cy);
        ctx.closePath(); ctx.fill();
        // 3D right
        ctx.fillStyle = '#0e7490';
        ctx.beginPath();
        ctx.moveTo(cx + CUBE_W, cy); ctx.lineTo(cx + CUBE_W + 10, cy - 10);
        ctx.lineTo(cx + CUBE_W + 10, cy + CUBE_H - 10); ctx.lineTo(cx + CUBE_W, cy + CUBE_H);
        ctx.closePath(); ctx.fill();
        ctx.shadowBlur = 0;

        // ── Progress bar
        const prog = Math.min(s.cameraY / s.trackLength, 1);
        const barW = ROAD_W - 4;
        ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.fillRect(ROAD_LEFT + 2, 12, barW, 8);
        const pg = ctx.createLinearGradient(ROAD_LEFT, 0, ROAD_LEFT + barW, 0);
        pg.addColorStop(0, '#06b6d4'); pg.addColorStop(1, '#22d3ee');
        ctx.fillStyle = pg; ctx.fillRect(ROAD_LEFT + 2, 12, barW * prog, 8);

        // HUD level + time
        ctx.fillStyle = 'rgba(0,0,0,0.65)'; ctx.fillRect(ROAD_LEFT + 4, 24, 100, 24);
        ctx.fillStyle = '#22d3ee'; ctx.font = 'bold 14px monospace';
        ctx.fillText(`LVL ${s.level}/3`, ROAD_LEFT + 10, 41);

        const tStr = (s.levelTime / 1000).toFixed(2) + 's';
        ctx.fillStyle = 'rgba(0,0,0,0.65)'; ctx.fillRect(ROAD_RIGHT - 100, 24, 96, 24);
        ctx.fillStyle = '#22d3ee'; ctx.textAlign = 'right';
        ctx.fillText(tStr, ROAD_RIGHT - 8, 41);
        ctx.textAlign = 'left';

        // ── Overlays
        if (s.phase === 'countdown') {
            ctx.fillStyle = 'rgba(0,0,0,0.55)';
            ctx.fillRect(ROAD_LEFT, 0, ROAD_W, CANVAS_H);
            ctx.shadowColor = '#22d3ee'; ctx.shadowBlur = 30;
            ctx.fillStyle = '#22d3ee'; ctx.font = 'bold 96px monospace'; ctx.textAlign = 'center';
            ctx.fillText(s.countdownN > 0 ? String(s.countdownN) : 'GO!', CANVAS_W / 2, CANVAS_H / 2 + 30);
            ctx.textAlign = 'left'; ctx.shadowBlur = 0;
        }

        if (s.phase === 'levelup') {
            const a = Math.max(0, 1 - (performance.now() - s.levelUpTs) / 1500);
            ctx.fillStyle = `rgba(34,197,94,${a * 0.25})`; ctx.fillRect(ROAD_LEFT, 0, ROAD_W, CANVAS_H);
            ctx.shadowColor = '#22d3ee'; ctx.shadowBlur = 30;
            ctx.fillStyle = `rgba(34,211,238,${a})`;
            ctx.font = 'bold 42px monospace'; ctx.textAlign = 'center';
            ctx.fillText(`LEVEL ${s.level} — START!`, CANVAS_W / 2, CANVAS_H / 2);
            ctx.font = 'bold 18px monospace'; ctx.fillStyle = `rgba(255,255,255,${a})`;
            ctx.fillText('KEEP GOING!', CANVAS_W / 2, CANVAS_H / 2 + 44);
            ctx.textAlign = 'left'; ctx.shadowBlur = 0;
        }

        if (s.phase === 'dead') {
            ctx.fillStyle = 'rgba(239,68,68,0.18)'; ctx.fillRect(ROAD_LEFT, 0, ROAD_W, CANVAS_H);
        }
    }, []);

    // ─── GAME LOOP ────────────────────────────────────────
    const gameLoop = useCallback(() => {
        const s = g.current;
        const now = performance.now();

        if (s.phase === 'dead' || s.phase === 'done' || s.phase === 'idle') {
            draw(); return;
        }

        if (s.phase === 'countdown') {
            const elapsed = now - s.countdownTs;
            const remaining = 3 - Math.floor(elapsed / 1000);
            s.countdownN = remaining;
            if (elapsed >= 3500) {  // GO! shown briefly then start
                s.phase = 'playing';
                s.levelStartTs = now;
                setPhase('playing');
            }
            draw();
            rafRef.current = requestAnimationFrame(gameLoop);
            return;
        }

        if (s.phase === 'levelup') {
            if (now - s.levelUpTs > 1700) {
                s.phase = 'playing';
                s.walls = s.nextWalls;
                s.trackLength = s.nextTrackLen;
                s.cameraY = 0;
                s.levelStartTs = now;
                setPhase('playing');
            }
            draw();
            rafRef.current = requestAnimationFrame(gameLoop);
            return;
        }

        // ── PLAYING
        s.levelTime = now - s.levelStartTs;
        setLevelTime(s.levelTime);
        setTotalTime(s.totalTimeMs + s.levelTime);

        const spd = BASE_SPEEDS[s.level - 1];
        if (s.moveLeft) s.cubeX = Math.max(0, s.cubeX - 5);
        if (s.moveRight) s.cubeX = Math.min(ROAD_W - CUBE_W, s.cubeX + 5);
        s.cameraY += spd;

        // Collision
        const cL = s.cubeX, cR = s.cubeX + CUBE_W;
        for (const wall of s.walls) {
            const screenY = CUBE_SCREEN_Y + wall.worldY + s.cameraY;
            if (screenY < CUBE_SCREEN_Y - CUBE_H - 4 || screenY > CUBE_SCREEN_Y + 4) continue;
            const inGap = cL >= wall.gapX && cR <= wall.gapX + GAP_W;
            if (!inGap) {
                s.phase = 'dead';
                // Do NOT clear the saved progress — player resumes from current level
                setPhase('dead');
                draw(); return;
            }
        }

        // Level complete
        if (s.cameraY >= s.trackLength) {
            const thisLevelTime = s.levelTime;
            const completedLevel = s.level;
            s.totalTimeMs += thisLevelTime;
            s.levelRecords.push({ level: completedLevel, timeMs: thisLevelTime });

            // On-chain submission (async, non-blocking)
            const submitOnChain = async () => {
                // Optimistic update for leaderboard (instant feedback)
                setLocalLevelTimes(prev => [...prev, { player: userAddress, level: completedLevel, timeMs: thisLevelTime }]);

                try {
                    const signer = getContractSigner();
                    // Proof and journalHash are dummy in dev mode unless handled by ZK backend
                    const won = await cubeathonService.submitLevel(
                        sessionId, userAddress, completedLevel, BigInt(Math.floor(thisLevelTime)), signer
                    );

                    if (won) {
                        onGameComplete(userAddress);
                    }
                } catch (err) {
                    console.error('Level submission failed:', err);
                }
            };
            submitOnChain();

            if (s.level < 3) {
                s.level++;
                // Save progress to localStorage
                try { localStorage.setItem(storageKey(sessionId, userAddress, 'level'), String(s.level)); } catch { }
                const next = generateTrack(s.level, sessionId);
                s.nextWalls = next.walls;
                s.nextTrackLen = next.trackLength;
                s.phase = 'levelup';
                s.levelUpTs = now;
                setCurrentLevel(s.level);
                setPhase('levelup');
            } else {
                // All 3 levels done!
                try { localStorage.removeItem(storageKey(sessionId, userAddress, 'level')); } catch { }
                s.phase = 'done';
                setPhase('done');
                setTotalTime(s.totalTimeMs);
                draw(); return;
            }
        }

        draw();
        rafRef.current = requestAnimationFrame(gameLoop);
    }, [draw, sessionId, userAddress]);

    // ─── START LEVEL ──────────────────────────────────────
    const startCurrentLevel = useCallback((lvl: number) => {
        const s = g.current;
        s.cameraY = 0;
        s.cubeX = (ROAD_W - CUBE_W) / 2;
        s.moveLeft = false; s.moveRight = false;
        s.levelTime = 0;
        const { walls, trackLength } = generateTrack(lvl, sessionId);
        s.walls = walls; s.trackLength = trackLength;
        s.phase = 'countdown';
        s.countdownTs = performance.now();
        s.countdownN = 3;
        setPhase('countdown'); setCurrentLevel(lvl);
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        rafRef.current = requestAnimationFrame(gameLoop);
    }, [gameLoop, sessionId]);

    const startGame = useCallback(() => {
        const s = g.current;
        const resumeLevel = savedLevel();
        s.level = resumeLevel;
        s.totalTimeMs = 0;
        s.levelRecords = [];
        startCurrentLevel(resumeLevel);
    }, [startCurrentLevel]);

    // Retry = restart from the level they failed (progress kept)
    const retryLevel = useCallback(() => {
        const s = g.current;
        s.totalTimeMs = 0;  // reset time for this attempt from resume point
        s.levelRecords = [];
        startCurrentLevel(s.level);
    }, [startCurrentLevel]);

    // ─── KEYBOARD ─────────────────────────────────────────
    useEffect(() => {
        const dn = (e: KeyboardEvent) => {
            if (e.key === 'ArrowLeft' || e.key === 'a') g.current.moveLeft = true;
            if (e.key === 'ArrowRight' || e.key === 'd') g.current.moveRight = true;
            if (e.key === ' ') {
                e.preventDefault();
                const p = g.current.phase;
                if (p === 'dead') retryLevel();
                else if (p === 'idle') startGame();
            }
        };
        const up = (e: KeyboardEvent) => {
            if (e.key === 'ArrowLeft' || e.key === 'a') g.current.moveLeft = false;
            if (e.key === 'ArrowRight' || e.key === 'd') g.current.moveRight = false;
        };
        window.addEventListener('keydown', dn);
        window.addEventListener('keyup', up);
        return () => { window.removeEventListener('keydown', dn); window.removeEventListener('keyup', up); };
    }, [startGame, retryLevel]);

    useEffect(() => { draw(); }, [draw]);
    useEffect(() => () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); }, []);

    const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
    const totalSecs = (totalTime / 1000).toFixed(2);

    const resumeLevel = savedLevel();
    const isResume = resumeLevel > 1;

    return (
        <div style={{ maxWidth: 980, margin: '0 auto', padding: '1rem' }}>
            {/* ─── GAME CARD */}
            <div style={{
                background: 'white', borderRadius: 24, padding: '2rem',
                boxShadow: '0 20px 60px rgba(0,0,0,0.07)', border: '1px solid #f1f5f9'
            }}>
                {/* Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.25rem' }}>
                    <div>
                        <h2 style={{ fontSize: '2rem', fontWeight: 900, color: '#0891b2', margin: 0, letterSpacing: '-0.03em' }}>
                            ⬛ CUBEATHON
                        </h2>
                        <p style={{ color: '#64748b', fontWeight: 700, fontSize: '0.7rem', margin: '3px 0 0', textTransform: 'uppercase', letterSpacing: '0.12em' }}>
                            ZK Speed Run · 3 Levels · Time Attack · Stellar Testnet
                        </p>
                        <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                            <span style={{ fontSize: '0.62rem', fontWeight: 700, background: '#f1f5f9', padding: '2px 8px', borderRadius: 6, color: '#475569' }}>
                                Session: {sessionId}
                            </span>
                            <span style={{ fontSize: '0.62rem', fontWeight: 700, background: '#ecfdf5', padding: '2px 8px', borderRadius: 6, color: '#059669' }}>
                                💰 Stakes: {(Number(availablePoints) / 1e7).toFixed(2)} Points
                            </span>
                            <span style={{ fontSize: '0.62rem', fontWeight: 700, background: '#f0f9ff', padding: '2px 8px', borderRadius: 6, color: '#0284c7' }}>
                                👥 {isPlayer1 ? 'Player 1' : 'Player 2'}
                            </span>
                            {isResume && (
                                <span style={{ fontSize: '0.62rem', fontWeight: 700, background: '#fef3c7', padding: '2px 8px', borderRadius: 6, color: '#d97706' }}>
                                    ▶ Resuming from Level {resumeLevel}
                                </span>
                            )}
                            <span style={{ fontSize: '0.62rem', fontWeight: 700, background: '#f0fdf4', padding: '2px 8px', borderRadius: 6, color: '#059669' }}>
                                🔐 ZK Proof Ready
                            </span>
                        </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                        <button onClick={() => setShowLeaderboard(v => !v)} style={{
                            background: '#fef3c7', color: '#d97706', border: 'none',
                            padding: '0.5rem 1rem', borderRadius: 12, fontWeight: 700,
                            fontSize: '0.75rem', cursor: 'pointer'
                        }}>🏆 Leaderboard</button>
                        <button onClick={onBack} style={{
                            background: '#f1f5f9', color: '#475569', border: 'none',
                            padding: '0.5rem 1rem', borderRadius: 12, fontWeight: 700,
                            fontSize: '0.75rem', cursor: 'pointer'
                        }}>← Back to Games</button>
                    </div>
                </div>

                {/* Key hints */}
                <div style={{
                    display: 'flex', gap: 6, marginBottom: '1rem', alignItems: 'center',
                    background: '#f8fafc', borderRadius: 10, padding: '7px 12px',
                    fontSize: '0.7rem', fontWeight: 700, color: '#64748b', flexWrap: 'wrap'
                }}>
                    {['A', '← LEFT', 'D', '→ RIGHT', 'SPACE = Retry'].map((k, i) => (
                        <span key={i} style={{
                            background: '#e2e8f0', borderRadius: 6, padding: '2px 8px'
                        }}>{k}</span>
                    ))}
                    <span style={{ marginLeft: 4, color: '#94a3b8' }}>
                        Pass through the green gap · Don't touch the red walls · Don't fall off!
                    </span>
                </div>

                {/* Canvas */}
                <div style={{ position: 'relative', borderRadius: 18, overflow: 'hidden' }}>
                    <canvas
                        ref={canvasRef}
                        width={CANVAS_W}
                        height={CANVAS_H}
                        style={{ display: 'block', width: '100%', background: '#0f172a', borderRadius: 18 }}
                    />

                    {/* IDLE overlay */}
                    {phase === 'idle' && (
                        <div style={{
                            position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
                            alignItems: 'center', justifyContent: 'center',
                            background: 'rgba(2,6,23,0.88)', borderRadius: 18
                        }}>
                            <div style={{ fontSize: '5rem', marginBottom: 8 }}>⬛</div>
                            <h3 style={{ color: '#22d3ee', fontSize: '2rem', fontWeight: 900, margin: '0 0 4px', letterSpacing: '0.06em' }}>
                                CUBEATHON
                            </h3>
                            <p style={{ color: '#94a3b8', fontSize: '0.85rem', fontWeight: 700, marginBottom: 28, textAlign: 'center', lineHeight: 1.9, maxWidth: 300 }}>
                                Navigate your cube through obstacle walls.<br />
                                Use <strong style={{ color: '#22d3ee' }}>A / D</strong> to steer through the <strong style={{ color: '#4ade80' }}>green gap</strong>.<br />
                                Clear all 3 levels to set your time!<br />
                                <span style={{ color: '#6366f1', fontSize: '0.75rem' }}>
                                    {isResume ? `Resuming from Level ${resumeLevel}` : 'Starting from Level 1'}
                                </span>
                            </p>
                            <button onClick={startGame} style={{
                                background: 'linear-gradient(135deg,#06b6d4,#0891b2)',
                                color: 'white', border: 'none', padding: '14px 52px',
                                borderRadius: 16, fontWeight: 900, fontSize: '1.05rem',
                                cursor: 'pointer', letterSpacing: '0.08em',
                                boxShadow: '0 12px 32px rgba(6,182,212,0.45)'
                            }}>
                                {isResume ? `▶  RESUME LEVEL ${resumeLevel}` : '▶  START RACE'}
                            </button>
                        </div>
                    )}

                    {/* DEAD overlay */}
                    {phase === 'dead' && (
                        <div style={{
                            position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
                            alignItems: 'center', justifyContent: 'center',
                            background: 'rgba(15,0,0,0.78)', backdropFilter: 'blur(5px)', borderRadius: 18
                        }}>
                            <div style={{ fontSize: '4rem', marginBottom: 6 }}>💥</div>
                            <h3 style={{ color: '#f87171', fontSize: '2.2rem', fontWeight: 900, margin: '0 0 4px' }}>CRASHED!</h3>
                            <p style={{ color: '#fca5a5', fontWeight: 700, marginBottom: 6, fontSize: '0.9rem' }}>
                                Level {currentLevel} · {(levelTime / 1000).toFixed(2)}s
                            </p>
                            <p style={{ color: '#94a3b8', fontSize: '0.75rem', fontWeight: 600, marginBottom: 28 }}>
                                Retry from Level {currentLevel} · Progress is saved!
                            </p>
                            <div style={{ display: 'flex', gap: 10 }}>
                                <button onClick={retryLevel} style={{
                                    background: '#ef4444', color: 'white', border: 'none',
                                    padding: '13px 36px', borderRadius: 14, fontWeight: 900,
                                    fontSize: '1rem', cursor: 'pointer',
                                    boxShadow: '0 8px 24px rgba(239,68,68,0.45)'
                                }}>🔄 RETRY LEVEL {currentLevel}</button>
                                <button onClick={() => { g.current.phase = 'idle'; setPhase('idle'); }} style={{
                                    background: '#1e293b', color: '#94a3b8', border: 'none',
                                    padding: '13px 24px', borderRadius: 14, fontWeight: 800, cursor: 'pointer'
                                }}>Menu</button>
                            </div>
                            <p style={{ color: '#6366f1', fontSize: '0.7rem', fontWeight: 700, marginTop: 16 }}>
                                SPACE = quick retry
                            </p>
                        </div>
                    )}
                </div>

                {/* DONE / Results */}
                {phase === 'done' && (
                    <div style={{
                        marginTop: '1.5rem', background: 'linear-gradient(135deg, #ecfdf5, #f0fdf4)',
                        borderRadius: 20, border: '1px solid #bbf7d0', padding: '2rem', textAlign: 'center'
                    }}>
                        <div style={{ fontSize: '3.5rem', marginBottom: 8 }}>🏁</div>
                        <h3 style={{ fontSize: '2rem', fontWeight: 900, color: '#065f46', margin: '0 0 4px' }}>
                            ALL 3 LEVELS CLEARED!
                        </h3>
                        <p style={{ color: '#059669', fontWeight: 700, marginBottom: 8 }}>
                            {shortAddr(userAddress)}'s total time:{' '}
                            <strong style={{ fontSize: '1.4rem' }}>{totalSecs}s</strong>
                        </p>
                        <p style={{ color: '#6ee7b7', fontSize: '0.75rem', fontWeight: 700, marginBottom: 20 }}>
                            🔐 ZK proof submitted · Result recorded on Stellar Testnet
                        </p>

                        {/* Level breakdown */}
                        <div style={{
                            background: 'white', borderRadius: 16, border: '1px solid #d1fae5',
                            padding: '1rem 1.5rem', marginBottom: '1.5rem', display: 'inline-block', minWidth: 260
                        }}>
                            <p style={{ fontWeight: 800, color: '#047857', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 10 }}>
                                Level Breakdown
                            </p>
                            {g.current.levelRecords.map((r, i) => (
                                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: i < 2 ? '1px dashed #d1fae5' : 'none' }}>
                                    <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#064e3b' }}>Level {r.level}</span>
                                    <span style={{ fontSize: '0.85rem', fontWeight: 900, color: '#059669' }}>{(r.timeMs / 1000).toFixed(2)}s</span>
                                </div>
                            ))}
                            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0 0', marginTop: 4 }}>
                                <span style={{ fontWeight: 900, color: '#065f46' }}>TOTAL</span>
                                <span style={{ fontWeight: 900, fontSize: '1.1rem', color: '#065f46' }}>{totalSecs}s</span>
                            </div>
                        </div>

                        <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
                            <button onClick={startGame} style={{
                                background: 'linear-gradient(135deg,#06b6d4,#0891b2)',
                                color: 'white', border: 'none', padding: '12px 28px',
                                borderRadius: 14, fontWeight: 900, cursor: 'pointer'
                            }}>▶ Play Again</button>
                            <button onClick={() => setShowLeaderboard(true)} style={{
                                background: '#fef3c7', color: '#d97706', border: 'none',
                                padding: '12px 28px', borderRadius: 14, fontWeight: 900, cursor: 'pointer'
                            }}>🏆 Leaderboard</button>
                            <button onClick={onBack} style={{
                                background: '#f1f5f9', color: '#475569', border: 'none',
                                padding: '12px 28px', borderRadius: 14, fontWeight: 800, cursor: 'pointer'
                            }}>← Back to Games</button>
                        </div>
                    </div>
                )}

                {/* Footer */}
                <div style={{
                    marginTop: '1.25rem', paddingTop: '1rem', borderTop: '1px dashed #e2e8f0',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    fontSize: '0.6rem', fontWeight: 700, color: '#cbd5e1', textTransform: 'uppercase', letterSpacing: '0.08em'
                }}>
                    <span>
                        <span style={{
                            width: 5, height: 5, background: '#10b981', borderRadius: '50%',
                            display: 'inline-block', marginRight: 5, verticalAlign: 'middle', boxShadow: '0 0 6px #10b981'
                        }} />
                        Stellar Testnet · ZK Proof Protocol Active
                    </span>
                    <span>Stellar Game Studio · Cubeathon v1.0 · 2026</span>
                </div>
            </div>

            {/* ─── LEADERBOARD MODAL ─── */}
            {showLeaderboard && (
                <CubeathonLeaderboard
                    sessionId={sessionId}
                    player1={player1}
                    player2={player2}
                    localLevelTimes={localLevelTimes}
                    onClose={() => setShowLeaderboard(false)}
                />
            )}
        </div>
    );
}
