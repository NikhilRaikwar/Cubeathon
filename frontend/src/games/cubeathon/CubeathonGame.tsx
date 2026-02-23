import { useState, useEffect, useRef, useCallback } from 'react';
import { cubeathonService } from '../../services/cubeathonService';
import { useWallet } from '../../hooks/useWallet';
import { CubeathonLeaderboard } from '../../components/CubeathonLeaderboard';
import type { LeaderboardEntry } from '../../services/cubeathonService';

// ─────────────────────────────────────────────────────────
// GAME CONSTANTS
// ─────────────────────────────────────────────────────────
const CANVAS_W = 1000;
const CANVAS_H = 580;

const ROAD_LEFT = 20;
const ROAD_RIGHT = 980;
const ROAD_W = ROAD_RIGHT - ROAD_LEFT;

const CUBE_W = 52;
const CUBE_H = 52;

const INITIAL_SPEED = 8.0;
const SPEED_SCALE_RATE = 0.52;
const SPAWN_DISTANCE = 600;
const INITIAL_WALLS = 20;
const TRACK_LENGTH = 20000;
const FINISH_CLEAR_ZONE = 700;  // only ~1 obstacle gap before finish line
const FRICTION = 0.85;
const STEER_ACCEL = 1.45;
const MAX_STEER_VEL = 22;

const HORIZON_Y = 120;
const FOV = 350;

interface Wall { worldY: number; gapX: number; size: number; }

export type Difficulty = 'easy' | 'normal' | 'hard';

export interface CubeathonGameProps {
    userAddress: string;
    sessionId: number;
    player1: string;
    player2: string;
    availablePoints: bigint;
    isOnChain?: boolean;   // true if a real on-chain session was started
    onBack: () => void;
    onStandingsRefresh: () => void;
    onGameComplete: (winnerAddr: string) => void;
}


// ─────────────────────────────────────────────────────────
export function CubeathonGame({
    userAddress, sessionId, player1, player2,
    isOnChain = false,
    onBack, onStandingsRefresh
}: CubeathonGameProps) {
    const { getContractSigner } = useWallet();
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const rafRef = useRef<number>(0);

    const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
    const [showLeaderboard, setShowLeaderboard] = useState(false);
    const [difficulty, setDifficulty] = useState<Difficulty>('normal');
    const difficultyRef = useRef<Difficulty>('normal');

    const [zkProof, setZkProof] = useState<{ hash: string; timeMs: number } | null>(null);
    const [finishing, setFinishing] = useState(false);
    const [finalized, setFinalized] = useState(false);

    // All mutable game state in a ref
    const g = useRef({
        phase: 'idle' as 'idle' | 'picking' | 'countdown' | 'playing' | 'dead' | 'done',
        cameraY: 0,
        cubeX: (ROAD_W - CUBE_W) / 2,
        cubeVelX: 0,
        moveLeft: false,
        moveRight: false,
        moveUp: false,
        walls: [] as Wall[],
        lastSpawnY: 0,
        levelStartTs: 0,
        levelTime: 0,
        countdownN: 3,
        countdownTs: 0,
        rngSeed: sessionId,
        lastTime: 0,
    });

    const [phase, setPhase] = useState<typeof g.current.phase>('idle');
    const [levelTime, setLevelTime] = useState(0);

    const refreshLeaderboard = useCallback(async () => {
        const board = await cubeathonService.getLeaderboard();
        setLeaderboard(board);
    }, []);

    useEffect(() => { refreshLeaderboard(); }, [refreshLeaderboard]);

    // ─── DRAW ─────────────────────────────────────────────
    const draw = useCallback(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d')!;
        const s = g.current;

        ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
        ctx.fillStyle = '#0f172a'; // Deep Navy
        ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

        // helper for 3D projection
        const project = (wx: number, wy: number) => {
            const worldZ = -wy;
            const dist = worldZ - s.cameraY + 50;
            if (dist < 1) return null;

            const scale = FOV / (FOV + dist);
            const x = CANVAS_W / 2 + (wx - ROAD_W / 2) * scale;
            const y = HORIZON_Y + (CANVAS_H - HORIZON_Y - 50) * scale;
            return { x, y, scale };
        };

        // ── Road (Full View Cyber Grid)
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

        const pL_road = project(-100, -s.cameraY);
        const pR_road = project(ROAD_W + 100, -s.cameraY);
        const pL_horiz = project(-100, -s.cameraY - 4500);
        const pR_horiz = project(ROAD_W + 100, -s.cameraY - 4500);

        if (pL_road && pR_road && pL_horiz && pR_horiz) {
            ctx.fillStyle = '#111033';
            ctx.beginPath();
            ctx.moveTo(pL_road.x, pL_road.y); ctx.lineTo(pR_road.x, pR_road.y);
            ctx.lineTo(pR_horiz.x, pR_horiz.y); ctx.lineTo(pL_horiz.x, pL_horiz.y);
            ctx.fill();
        }

        // Cyber Grid (Full Width)
        ctx.strokeStyle = '#312e81';
        ctx.lineWidth = 1;
        const gridSpacing = 400;
        const gridBaseZ = Math.floor(s.cameraY / gridSpacing) * gridSpacing;
        for (let i = 0; i < 18; i++) {
            const pL = project(-100, -(gridBaseZ + i * gridSpacing));
            const pR = project(ROAD_W + 100, -(gridBaseZ + i * gridSpacing));
            if (pL && pR && pL.y > HORIZON_Y) {
                ctx.beginPath(); ctx.moveTo(pL.x, pL.y); ctx.lineTo(pR.x, pR.y); ctx.stroke();
            }
        }

        // Boundaries (Neon Edges - Full Screen Focus)
        const drawEdge = (wx: number) => {
            const pStart = project(wx, -s.cameraY);
            const pEnd = project(wx, -s.cameraY - 4500);
            if (pStart && pEnd) {
                ctx.strokeStyle = '#6366f1'; ctx.lineWidth = 6;
                ctx.shadowBlur = 20; ctx.shadowColor = '#6366f1';
                ctx.beginPath(); ctx.moveTo(pStart.x, pStart.y); ctx.lineTo(pEnd.x, pEnd.y); ctx.stroke();
                ctx.shadowBlur = 0;
            }
        };
        drawEdge(0); drawEdge(ROAD_W);

        // ── Finish Line (Gold/Green Neon)
        const pF1 = project(0, -TRACK_LENGTH);
        const pF2 = project(ROAD_W, -TRACK_LENGTH);
        if (pF1 && pF2 && pF1.y > HORIZON_Y) {
            ctx.fillStyle = '#4ade80';
            ctx.shadowBlur = 20; ctx.shadowColor = '#4ade80';
            ctx.beginPath();
            ctx.moveTo(pF1.x, pF1.y); ctx.lineTo(pF2.x, pF2.y);
            ctx.lineTo(pF2.x + 10, pF2.y - 12 * pF2.scale); ctx.lineTo(pF1.x - 10, pF1.y - 12 * pF1.scale);
            ctx.fill();
            ctx.font = `bold ${40 * pF1.scale}px monospace`;
            ctx.textAlign = 'center';
            ctx.fillText("FINISH", CANVAS_W / 2, pF1.y - 30 * pF1.scale);
            ctx.textAlign = 'left';
            ctx.shadowBlur = 0;
        }

        // ── Obstacles (Solid Cube Clusters)
        const sortedWalls = [...s.walls].sort((a, b) => b.worldY - a.worldY);
        for (const wall of sortedWalls) {
            const pBase = project(wall.gapX, wall.worldY);
            if (!pBase || pBase.y <= HORIZON_Y || pBase.y > CANVAS_H + 500) continue;

            const w = CUBE_W * pBase.scale;
            const h = CUBE_H * pBase.scale;

            for (let i = 0; i < wall.size; i++) {
                const bx = pBase.x + (i * w);
                if (bx + w < 0 || bx > CANVAS_W) continue;
                ctx.fillStyle = '#ef4444';
                ctx.shadowBlur = 10; ctx.shadowColor = '#ef4444';
                ctx.fillRect(bx, pBase.y - h, w, h);
                ctx.shadowBlur = 0;
                ctx.strokeStyle = '#000000'; ctx.lineWidth = 1;
                ctx.strokeRect(bx, pBase.y - h, w, h);
            }
        }

        // ── Cube (Neon Cyan Player)
        const pCube = project(s.cubeX, -s.cameraY + 5);
        if (pCube) {
            const cw = CUBE_W * pCube.scale;
            const ch = CUBE_H * pCube.scale;
            ctx.shadowBlur = 20; ctx.shadowColor = '#22d3ee';
            ctx.fillStyle = '#22d3ee';
            ctx.fillRect(pCube.x, pCube.y - ch, cw, ch);
            ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2;
            ctx.strokeRect(pCube.x, pCube.y - ch, cw, ch);
            ctx.shadowBlur = 0;
        }

        // ── Live Timer
        if (s.phase === 'playing' || s.phase === 'countdown') {
            const elapsed = s.phase === 'playing' ? (performance.now() - s.levelStartTs) : 0;
            const secs = (elapsed / 1000).toFixed(2);
            ctx.font = 'bold 22px monospace';
            ctx.textAlign = 'right';
            ctx.fillStyle = 'rgba(34,211,238,0.95)';
            ctx.shadowBlur = 10; ctx.shadowColor = '#22d3ee';
            ctx.fillText(`⏱ ${secs}s`, CANVAS_W - 20, 36);
            ctx.shadowBlur = 0;
            ctx.textAlign = 'left';
        }

        // ── Overlays
        if (s.phase === 'countdown') {
            ctx.fillStyle = 'rgba(0,0,0,0.6)';
            ctx.fillRect(ROAD_LEFT, 0, ROAD_W, CANVAS_H);
            ctx.fillStyle = '#22d3ee'; ctx.font = 'bold 80px monospace'; ctx.textAlign = 'center';
            ctx.fillText(s.countdownN > 0 ? String(s.countdownN) : 'GO!', CANVAS_W / 2, CANVAS_H / 2 + 30);
            ctx.textAlign = 'left';
        }
    }, []);

    // ─── GAME LOGIC ────────────────────────────────────────
    const submitFinalScore = useCallback(async (timeMs: number) => {
        const raw = `${sessionId}:${userAddress}:${Math.floor(timeMs)}`;
        const encoder = new TextEncoder();
        const data = encoder.encode(raw);
        const hashBytes = new Uint8Array(32);
        for (let i = 0; i < data.length; i++) {
            hashBytes[i % 32] ^= data[i] + i;
        }
        const hashHex = Array.from(hashBytes).map(b => b.toString(16).padStart(2, '0')).join('');
        setZkProof({ hash: hashHex, timeMs });

        if (!isOnChain) return;

        try {
            const runner = await getContractSigner();
            await cubeathonService.submitScore(
                sessionId, userAddress, BigInt(Math.floor(timeMs)), runner, new Uint8Array(0), hashBytes
            );
            refreshLeaderboard();
        } catch (err) {
            console.error('[Cubeathon] Score submission FAILED:', err);
        }
    }, [getContractSigner, sessionId, userAddress, refreshLeaderboard, isOnChain]);

    const handleFinalize = async () => {
        if (!isOnChain) { setPhase('idle'); return; }
        try {
            setFinishing(true);
            const runner = await getContractSigner();
            await cubeathonService.endSession(sessionId, userAddress, runner);
            setFinalized(true);
            refreshLeaderboard();
            onStandingsRefresh();
        } catch (err) {
            console.error("[Cubeathon] Finalize failed:", err);
        } finally {
            setFinishing(false);
        }
    };

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
            if (elapsed >= 3500) {
                s.phase = 'playing';
                s.levelStartTs = now;
                setPhase('playing');
            }
            draw();
            rafRef.current = requestAnimationFrame(gameLoop);
            return;
        }

        const dt = s.lastTime > 0 ? (now - s.lastTime) / 16.67 : 1;
        s.lastTime = now;

        s.levelTime = now - s.levelStartTs;
        setLevelTime(s.levelTime);

        const diff = difficultyRef.current;
        let baseStartSpd = diff === 'easy' ? 7.0 : diff === 'hard' ? 28.0 : 17.0;
        let scaleRate = diff === 'easy' ? 0.30 : diff === 'hard' ? 1.10 : 0.70;
        let steerAccel = diff === 'easy' ? 1.4 : diff === 'hard' ? 2.4 : 1.8;
        let maxSteerVel = diff === 'easy' ? 18 : diff === 'hard' ? 34 : 26;

        const currentBaseSpd = baseStartSpd + (Math.floor(s.levelTime / 10000) * scaleRate);
        const spd = currentBaseSpd * dt;

        if (s.moveLeft) s.cubeVelX -= steerAccel * dt;
        if (s.moveRight) s.cubeVelX += steerAccel * dt;
        s.cubeVelX *= Math.pow(FRICTION, dt);
        if (s.cubeVelX > maxSteerVel) s.cubeVelX = maxSteerVel;
        if (s.cubeVelX < -maxSteerVel) s.cubeVelX = -maxSteerVel;
        s.cubeX += s.cubeVelX * dt;

        if (s.cubeX < 0 || s.cubeX > ROAD_W - CUBE_W) {
            s.phase = 'dead'; setPhase('dead'); draw(); return;
        }

        s.cameraY += spd;
        if (s.cameraY >= TRACK_LENGTH) {
            s.cameraY = TRACK_LENGTH;
            s.phase = 'done'; setPhase('done');
            submitFinalScore(s.levelTime);
            draw(); return;
        }

        const spawnGap = diff === 'easy' ? 180 : diff === 'hard' ? 130 : 150;
        const spawnDist = diff === 'easy' ? 550 : diff === 'hard' ? 700 : 620;

        while (s.lastSpawnY > -s.cameraY - 3000 && s.lastSpawnY > -TRACK_LENGTH + 800) {
            const newY = s.lastSpawnY - spawnDist;
            if (-newY >= TRACK_LENGTH - FINISH_CLEAR_ZONE) { s.lastSpawnY = newY; continue; }

            const wallIdx = Math.floor(Math.abs(newY) / spawnDist);
            const rng = Math.abs(Math.floor(newY * 1.3) ^ s.rngSeed);
            let gapCenter = 150 + (rng % (ROAD_W - 300));
            gapCenter = Math.max(spawnGap / 2 + 30, Math.min(ROAD_W - spawnGap / 2 - 30, gapCenter));

            const leftSize = Math.max(1, Math.floor((gapCenter - spawnGap / 2) / CUBE_W));
            s.walls.push({ worldY: newY, gapX: 0, size: leftSize });
            const rightStart = gapCenter + spawnGap / 2;
            const rightSize = Math.max(1, Math.floor((ROAD_W - rightStart) / CUBE_W));
            s.walls.push({ worldY: newY, gapX: rightStart, size: rightSize });
            s.lastSpawnY = newY;
        }

        const cL = s.cubeX, cR = s.cubeX + CUBE_W;
        for (const wall of s.walls) {
            const wallZ = -wall.worldY;
            const dist = wallZ - s.cameraY;
            if (dist < -50 || dist > 20) continue;
            const bL = wall.gapX, bR = wall.gapX + (wall.size * CUBE_W);
            if (!(cR < bL || cL > bR)) {
                s.phase = 'dead'; setPhase('dead'); draw(); return;
            }
        }

        draw();
        rafRef.current = requestAnimationFrame(gameLoop);
    }, [draw, submitFinalScore]);

    const prepareGame = useCallback(() => {
        g.current.phase = 'picking'; setPhase('picking');
    }, []);

    const startGame = useCallback((selectedDifficulty: Difficulty) => {
        setDifficulty(selectedDifficulty);
        difficultyRef.current = selectedDifficulty;
        const s = g.current;
        s.phase = 'countdown';
        s.countdownN = 3;
        s.countdownTs = performance.now();
        s.cameraY = 0; s.lastSpawnY = 0; s.lastTime = 0;
        s.walls = []; s.cubeX = (ROAD_W - CUBE_W) / 2;
        s.levelTime = 0;
        s.rngSeed = Math.floor(Math.random() * 2147483647);
        setPhase('countdown');
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        rafRef.current = requestAnimationFrame(gameLoop);
    }, [gameLoop]);

    useEffect(() => {
        const dn = (e: KeyboardEvent) => {
            const key = e.key.toLowerCase();
            if (key === 'arrowleft' || key === 'a') g.current.moveLeft = true;
            if (key === 'arrowright' || key === 'd') g.current.moveRight = true;
            if (e.key === ' ') {
                e.preventDefault();
                if (g.current.phase === 'dead') prepareGame();
                else if (g.current.phase === 'idle') prepareGame();
            }
        };
        const up = (e: KeyboardEvent) => {
            const key = e.key.toLowerCase();
            if (key === 'arrowleft' || key === 'a') g.current.moveLeft = false;
            if (key === 'arrowright' || key === 'd') g.current.moveRight = false;
        };
        window.addEventListener('keydown', dn);
        window.addEventListener('keyup', up);
        return () => { window.removeEventListener('keydown', dn); window.removeEventListener('keyup', up); };
    }, [prepareGame]);

    useEffect(() => { draw(); }, [draw]);

    return (
        <div style={{ maxWidth: 980, margin: '0 auto', padding: '1rem' }}>
            <div style={{ background: 'white', borderRadius: 24, padding: '2rem', boxShadow: '0 20px 60px rgba(0,0,0,0.07)', border: '1px solid #f1f5f9' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.2rem' }}>
                    <div>
                        <h2 style={{ fontSize: '1.8rem', fontWeight: 900, color: '#0f172a', margin: 0 }}>⬛ CUBEATHON</h2>
                        <p style={{ margin: 0, color: '#64748b', fontSize: '0.75rem', fontWeight: 600 }}>SPEED RUN · TIME TRIAL</p>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                        <button onClick={() => setShowLeaderboard(true)} style={{ background: '#0f172a', color: 'white', border: 'none', padding: '0.6rem 1.4rem', borderRadius: 12, fontWeight: 700, cursor: 'pointer' }}>🏆 RANKINGS</button>
                        <button onClick={onBack} style={{ background: '#f1f5f9', color: '#475569', border: 'none', padding: '0.6rem 1.2rem', borderRadius: 12, fontWeight: 700, cursor: 'pointer' }}>← EXIT</button>
                    </div>
                </div>

                <div style={{ position: 'relative', borderRadius: 18, overflow: 'hidden' }}>
                    <canvas ref={canvasRef} width={CANVAS_W} height={CANVAS_H} style={{ display: 'block', width: '100%', background: '#0f172a' }} />

                    {phase === 'idle' && (
                        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'rgba(2,6,23,0.88)' }}>
                            <div style={{ fontSize: '4rem', marginBottom: 8 }}>⬛</div>
                            <h3 style={{ color: '#22d3ee', fontSize: '1.8rem', fontWeight: 900 }}>CUBEATHON</h3>
                            <button onClick={prepareGame} style={{ background: 'linear-gradient(135deg,#06b6d4,#0891b2)', color: 'white', border: 'none', padding: '14px 40px', borderRadius: 16, fontWeight: 900, cursor: 'pointer', marginTop: 20 }}>▶ START RUN</button>
                        </div>
                    )}

                    {phase === 'picking' && (
                        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'rgba(2,10,34,0.92)' }}>
                            <h3 style={{ color: 'white', marginBottom: '2rem' }}>SELECT DIFFICULTY</h3>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: 240 }}>
                                <button onClick={() => startGame('easy')} style={{ background: '#10b981', color: 'white', padding: 14, borderRadius: 12, border: 'none', fontWeight: 800 }}>EASY</button>
                                <button onClick={() => startGame('normal')} style={{ background: '#3b82f6', color: 'white', padding: 14, borderRadius: 12, border: 'none', fontWeight: 800 }}>NORMAL</button>
                                <button onClick={() => startGame('hard')} style={{ background: '#ef4444', color: 'white', padding: 14, borderRadius: 12, border: 'none', fontWeight: 800 }}>HARD</button>
                            </div>
                        </div>
                    )}

                    {phase === 'done' && (
                        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'rgba(2,16,10,0.92)' }}>
                            <h3 style={{ color: '#4ade80', fontSize: '2.5rem', fontWeight: 900 }}>FINISHED!</h3>
                            <p style={{ color: 'white', fontSize: '1.5rem' }}>{(levelTime / 1000).toFixed(2)}s</p>
                            <div style={{ marginTop: 20, display: 'flex', gap: 12 }}>
                                {!finalized ? (
                                    <button onClick={handleFinalize} disabled={finishing} style={{ background: '#fbbf24', padding: '14px 40px', borderRadius: 12, fontWeight: 900 }}>{finishing ? '...' : 'FINALIZE 🏛️'}</button>
                                ) : (
                                    <button onClick={prepareGame} style={{ background: '#4ade80', padding: '14px 40px', borderRadius: 12, fontWeight: 900 }}>RETRY</button>
                                )}
                                <button onClick={() => setPhase('idle')} style={{ background: '#1e293b', color: 'white', padding: '14px 30px', borderRadius: 12 }}>MENU</button>
                            </div>
                        </div>
                    )}

                    {phase === 'dead' && (
                        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'rgba(15,0,0,0.85)' }}>
                            <h3 style={{ color: '#ef4444', fontSize: '2.5rem' }}>CRASHED</h3>
                            <p style={{ color: 'white' }}>DISTANCE: {(g.current.cameraY / 100).toFixed(0)}m</p>
                            <div style={{ marginTop: 20, display: 'flex', gap: 12 }}>
                                <button onClick={prepareGame} style={{ background: '#ef4444', color: 'white', padding: '14px 40px', borderRadius: 12 }}>RETRY</button>
                                <button onClick={() => setPhase('idle')} style={{ background: '#1e293b', color: 'white', padding: '14px 30px', borderRadius: 12 }}>MENU</button>
                            </div>
                        </div>
                    )}
                </div>

                {zkProof && (
                    <div style={{ marginTop: 20, padding: 16, background: '#0f172a', borderRadius: 16, color: '#818cf8', fontSize: '0.7rem' }}>
                        <p style={{ margin: 0 }}>🔐 ZK COMMITMENT: 0x{zkProof.hash}</p>
                    </div>
                )}
            </div>

            {showLeaderboard && (
                <CubeathonLeaderboard
                    sessionId={sessionId} player1={player1} player2={player2}
                    onClose={() => setShowLeaderboard(false)}
                />
            )}
        </div>
    );
}
