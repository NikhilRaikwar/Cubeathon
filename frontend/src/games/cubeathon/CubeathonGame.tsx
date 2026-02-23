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
const CUBE_SCREEN_Y = CANVAS_H - 80;

const WALL_H = 36;
const GAP_W = 140;
const WALL_GAP_PADDING = 14;

const INITIAL_SPEED = 8.0;
const SPEED_SCALE_RATE = 0.52;
const SPAWN_DISTANCE = 600;
const INITIAL_WALLS = 20;
const TRACK_LENGTH = 20000;   // longer run = more addictive
const FINISH_CLEAR_ZONE = 2500; // no obstacles in last stretch
const FRICTION = 0.85;
const STEER_ACCEL = 1.45;
const MAX_STEER_VEL = 22;

const HORIZON_Y = 120;
const FOV = 350;

interface Wall { worldY: number; gapX: number; size: number; }

// localStorage keys for player progress persistence
const storageKey = (sid: number, addr: string, prop: string) =>
    `cubeathon:${sid}:${addr.slice(0, 8)}:${prop}`;

interface LevelRecord {
    level: number;
    timeMs: number;
}

export type Difficulty = 'easy' | 'normal' | 'hard';

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
export function CubeathonGame({
    userAddress, sessionId, player1, player2, availablePoints,
    onBack, onStandingsRefresh, onGameComplete
}: CubeathonGameProps) {
    const { getContractSigner } = useWallet();
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const rafRef = useRef<number>(0);

    const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
    const [showLeaderboard, setShowLeaderboard] = useState(false);
    const [difficulty, setDifficulty] = useState<Difficulty>('normal');
    const difficultyRef = useRef<Difficulty>('normal'); // readable inside rAF loop without stale closure

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
        highScoreMs: 0,
        countdownN: 3,
        countdownTs: 0,
        rngSeed: sessionId,
        lastTime: 0,
    });

    const [phase, setPhase] = useState<typeof g.current.phase>('idle');
    const [levelTime, setLevelTime] = useState(0);

    const isPlayer1 = userAddress === player1;
    const isResume = false; // Endless mode always starts fresh for now
    const resumeLevel = 1;

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

            // Draw 'size' number of ADJACENT cubes (chipki hui boundaries)
            for (let i = 0; i < wall.size; i++) {
                const bx = pBase.x + (i * w); // No spacing between blocks in a cluster

                if (bx + w < 0 || bx > CANVAS_W) continue;

                ctx.fillStyle = '#ef4444';
                ctx.shadowBlur = 10; ctx.shadowColor = '#ef4444';
                ctx.fillRect(bx, pBase.y - h, w, h);
                ctx.shadowBlur = 0;

                // Details for each cube
                ctx.strokeStyle = '#000000'; ctx.lineWidth = 1;
                ctx.strokeRect(bx, pBase.y - h, w, h);
                ctx.fillStyle = 'rgba(255,255,255,0.2)';
                ctx.fillRect(bx, pBase.y - h, w, 4 * pBase.scale);
            }
        }

        // ── Cube (Neon Cyan Player) – original square with glow
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

        // ── Live Timer (drawn on canvas top-right during play)
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
        console.warn(
            `[Cubeathon] submitting score | session:${sessionId} player:${userAddress} time:${timeMs}ms`
        );
        try {
            const runner = await getContractSigner();
            await cubeathonService.submitScore(sessionId, userAddress, BigInt(Math.floor(timeMs)), runner);
            console.info('[Cubeathon] score submitted ✓');
            refreshLeaderboard();
        } catch (err) {
            console.error('[Cubeathon] Score submission FAILED:', err);
        }
    }, [getContractSigner, sessionId, userAddress, refreshLeaderboard]);

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

        // ── Framerate independence logic
        const dt = s.lastTime > 0 ? (now - s.lastTime) / 16.67 : 1;
        s.lastTime = now;

        // ── PLAYING
        s.levelTime = now - s.levelStartTs;
        setLevelTime(s.levelTime);

        const elapsedS = s.levelTime / 1000;

        // ─── Per-difficulty physics (read from ref so loop never stales) ───
        const diff = difficultyRef.current;
        let baseStartSpd: number;
        let scaleRate: number;
        let steerAccel: number;
        let maxSteerVel: number;

        if (diff === 'easy') {
            baseStartSpd = 7.0;
            scaleRate = 0.30;
            steerAccel = 1.4;
            maxSteerVel = 18;
        } else if (diff === 'hard') {
            // High: 0.5× faster than previous 20 → 28
            baseStartSpd = 28.0;
            scaleRate = 1.10;
            steerAccel = 2.4;
            maxSteerVel = 34;
        } else {
            // Medium: 0.5× faster than previous 12 → 17
            baseStartSpd = 17.0;
            scaleRate = 0.70;
            steerAccel = 1.8;
            maxSteerVel = 26;
        }

        const currentBaseSpd = baseStartSpd + (Math.floor(elapsedS / 10) * scaleRate);
        const spd = currentBaseSpd * dt;

        // Inertia-based steering (per-difficulty)
        if (s.moveLeft) s.cubeVelX -= steerAccel * dt;
        if (s.moveRight) s.cubeVelX += steerAccel * dt;

        // Clamp velocity
        if (s.cubeVelX > maxSteerVel) s.cubeVelX = maxSteerVel;
        if (s.cubeVelX < -maxSteerVel) s.cubeVelX = -maxSteerVel;

        s.cubeVelX *= Math.pow(FRICTION, dt);
        s.cubeX += s.cubeVelX * dt;

        // Boundaries (Lethal)
        if (s.cubeX < 0 || s.cubeX > ROAD_W - CUBE_W) {
            s.phase = 'dead';
            setPhase('dead');
            submitFinalScore(s.levelTime);
            draw(); return;
        }

        s.cameraY += spd;

        // Win Condition
        if (s.cameraY >= TRACK_LENGTH) {
            s.cameraY = TRACK_LENGTH;
            s.phase = 'done';
            setPhase('done');
            submitFinalScore(s.levelTime);
            draw(); return;
        }

        // Obstacle Spawning – 4 rotating patterns, difficulty-aware gaps & spacing
        const diff2 = difficultyRef.current;
        // Easy: wider gaps + closer walls, Medium: medium, High: tight gaps but longer between walls
        const spawnGap = diff2 === 'easy' ? 180 : diff2 === 'hard' ? 130 : 150;
        const spawnDist = diff2 === 'easy' ? 550 : diff2 === 'hard' ? 700 : 620;

        while (s.lastSpawnY > -s.cameraY - 3000 && s.lastSpawnY > -TRACK_LENGTH + 800) {
            const newY = s.lastSpawnY - spawnDist;

            // Clear zone before finish line (especially important for High mode)
            if (-newY >= TRACK_LENGTH - FINISH_CLEAR_ZONE) {
                s.lastSpawnY = newY;
                continue;
            }

            // Rotate between 4 patterns every ~5 walls for addictive variability
            const wallIdx = Math.floor(Math.abs(newY) / spawnDist);
            const pattern = wallIdx % 4;
            const rng = Math.abs(Math.floor(newY * 1.3) ^ s.rngSeed);
            let gapCenter: number;

            if (pattern === 1) {
                // Zigzag: sharp alternating sides
                gapCenter = wallIdx % 2 === 0
                    ? 140 + (rng % Math.floor(ROAD_W / 4))
                    : ROAD_W - 140 - (rng % Math.floor(ROAD_W / 4));
            } else if (pattern === 2) {
                // Tight center: forces player toward middle
                gapCenter = ROAD_W / 2 + ((rng % 90) - 45);
            } else if (pattern === 3) {
                // Wide drift: obstacle cluster drifts across track
                gapCenter = 200 + (rng % (ROAD_W - 400));
            } else {
                // Standard random
                gapCenter = 150 + (rng % (ROAD_W - 300));
            }

            gapCenter = Math.max(spawnGap / 2 + 30, Math.min(ROAD_W - spawnGap / 2 - 30, gapCenter));

            const leftSize2 = Math.max(1, Math.floor((gapCenter - spawnGap / 2) / CUBE_W));
            s.walls.push({ worldY: newY, gapX: 0, size: leftSize2 });
            const rightStart2 = gapCenter + spawnGap / 2;
            const rightSize2 = Math.max(1, Math.floor((ROAD_W - rightStart2) / CUBE_W));
            s.walls.push({ worldY: newY, gapX: rightStart2, size: rightSize2 });
            s.lastSpawnY = newY;
        }

        // Cleanup
        if (s.walls.length > 0 && s.walls[0].worldY > -s.cameraY + 500) {
            s.walls.shift();
        }

        // Collision Check
        const cL = s.cubeX, cR = s.cubeX + CUBE_W;
        for (const wall of s.walls) {
            // Check if cube is at the same Z height as wall
            const wallZ = -wall.worldY;
            const dist = wallZ - s.cameraY;
            if (dist < -50 || dist > 20) continue; // Collision window

            // Wall cluster span
            const bL = wall.gapX;
            const bR = wall.gapX + (wall.size * CUBE_W);

            const hit = !(cR < bL || cL > bR);

            if (hit) {
                s.phase = 'dead';
                setPhase('dead');
                submitFinalScore(s.levelTime);
                draw(); return;
            }
        }

        draw();
        rafRef.current = requestAnimationFrame(gameLoop);
    }, [draw, submitFinalScore]);

    const prepareGame = useCallback(() => {
        g.current.phase = 'picking';
        setPhase('picking');
    }, []);

    const startGame = useCallback((selectedDifficulty: Difficulty) => {
        setDifficulty(selectedDifficulty);
        difficultyRef.current = selectedDifficulty; // sync ref immediately

        // Gap width & spawn spacing per difficulty
        const gapWidth = selectedDifficulty === 'easy' ? 200 : selectedDifficulty === 'hard' ? 280 : 220;
        const spawnSpacing = selectedDifficulty === 'easy' ? 550 : selectedDifficulty === 'hard' ? 750 : 620;

        const s = g.current;
        s.phase = 'countdown';
        s.countdownN = 3;
        s.countdownTs = performance.now();
        s.cameraY = 0;
        s.lastSpawnY = 0;
        s.lastTime = 0;
        s.walls = [];
        s.cubeX = (ROAD_W - CUBE_W) / 2;
        s.levelTime = 0;

        // 🎲 Randomize seed every attempt to prevent memorization
        s.rngSeed = Math.floor(Math.random() * 2147483647);

        // Initial walls sequence
        for (let i = 0; i < INITIAL_WALLS; i++) {
            const y = -(800 + i * spawnSpacing);
            const gapCenter = 200 + (Math.abs(Math.floor(y * 1.3) ^ s.rngSeed) % (ROAD_W - 400));
            const leftSize = Math.max(1, Math.floor((gapCenter - gapWidth / 2) / CUBE_W));
            s.walls.push({ worldY: y, gapX: 0, size: leftSize });
            const rightStart = gapCenter + gapWidth / 2;
            const rightSize = Math.max(1, Math.floor((ROAD_W - rightStart) / CUBE_W));
            s.walls.push({ worldY: y, gapX: rightStart, size: rightSize });
            s.lastSpawnY = y;
        }

        setPhase('countdown');
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        rafRef.current = requestAnimationFrame(gameLoop);
    }, [gameLoop]);

    const retryLevel = () => {
        prepareGame();
    };

    // ─── KEYBOARD ─────────────────────────────────────────
    useEffect(() => {
        const dn = (e: KeyboardEvent) => {
            if (e.key === 'ArrowLeft' || e.key === 'a') g.current.moveLeft = true;
            if (e.key === 'ArrowRight' || e.key === 'd') g.current.moveRight = true;
            if (e.key === 'ArrowUp' || e.key === 'w') g.current.moveUp = true;
            if (e.key === ' ') {
                e.preventDefault();
                const p = g.current.phase;
                if (p === 'dead') retryLevel();
                else if (p === 'idle') prepareGame();
            }
        };
        const up = (e: KeyboardEvent) => {
            if (e.key === 'ArrowLeft' || e.key === 'a') g.current.moveLeft = false;
            if (e.key === 'ArrowRight' || e.key === 'd') g.current.moveRight = false;
            if (e.key === 'ArrowUp' || e.key === 'w') g.current.moveUp = false;
        };
        window.addEventListener('keydown', dn);
        window.addEventListener('keyup', up);
        return () => { window.removeEventListener('keydown', dn); window.removeEventListener('keyup', up); };
    }, [startGame, retryLevel]);

    useEffect(() => { draw(); }, [draw]);
    useEffect(() => () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); }, []);

    const totalSecs = (levelTime / 1000).toFixed(2);

    return (
        <div style={{ maxWidth: 980, margin: '0 auto', padding: '1rem' }}>
            {/* ─── GAME CARD */}
            <div style={{
                background: 'white', borderRadius: 24, padding: '2rem',
                boxShadow: '0 20px 60px rgba(0,0,0,0.07)', border: '1px solid #f1f5f9'
            }}>
                {/* Header */}
                <div style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.2rem',
                    padding: '0 0.5rem'
                }}>
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                        <h2 style={{ fontSize: '1.8rem', fontWeight: 900, color: '#0f172a', margin: '0 0 6px', letterSpacing: '-0.02em', display: 'flex', alignItems: 'center', gap: 10 }}>
                            <span style={{ fontSize: '2rem' }}>⬛</span> CUBEATHON
                        </h2>

                        <p style={{ margin: 0, color: '#64748b', fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                            SPEED RUN · TIME TRIAL
                        </p>
                    </div>

                    <div style={{ display: 'flex', gap: 8 }}>
                        <button onClick={() => setShowLeaderboard(v => !v)} style={{
                            background: '#0f172a', color: 'white', border: 'none',
                            padding: '0.6rem 1.4rem', borderRadius: 12, fontWeight: 700,
                            fontSize: '0.75rem', cursor: 'pointer', boxShadow: '0 4px 12px rgba(15,23,42,0.2)'
                        }}>🏆 GLOBAL RANKINGS</button>
                        <button onClick={onBack} style={{
                            background: '#f1f5f9', color: '#475569', border: 'none',
                            padding: '0.6rem 1.2rem', borderRadius: 12, fontWeight: 700,
                            fontSize: '0.75rem', cursor: 'pointer'
                        }}>← EXIT</button>
                    </div>
                </div>

                {/* Key hints removed for cleaner UI */}

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
                                Navigate your cube through neon obstacles.<br />
                                Use <strong style={{ color: '#22d3ee' }}>A / D</strong> to steer through the gaps.<br />
                                <strong style={{ color: '#fca5a5' }}>Don't touch the red walls or go out of bounds!</strong><br />
                            </p>
                            <button onClick={prepareGame} style={{
                                background: 'linear-gradient(135deg,#06b6d4,#0891b2)',
                                color: 'white', border: 'none', padding: '14px 52px',
                                borderRadius: 16, fontWeight: 900, fontSize: '1.05rem',
                                cursor: 'pointer', letterSpacing: '0.08em',
                                boxShadow: '0 12px 32px rgba(6,182,212,0.45)'
                            }}>
                                ▶  START RUN
                            </button>
                        </div>
                    )}

                    {/* PICKING overlay */}
                    {phase === 'picking' && (
                        <div style={{
                            position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
                            alignItems: 'center', justifyContent: 'center',
                            background: 'rgba(2,10,34,0.92)', backdropFilter: 'blur(8px)', borderRadius: 18,
                            padding: '2rem'
                        }}>
                            <h3 style={{ color: 'white', fontSize: '1.8rem', fontWeight: 900, marginBottom: '2rem', letterSpacing: '0.05em' }}>
                                SELECT SPEED
                            </h3>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 16, width: '100%', maxWidth: 280 }}>
                                <button onClick={() => startGame('easy')} style={{
                                    background: 'linear-gradient(135deg,#10b981,#059669)',
                                    color: 'white', border: 'none', padding: '16px', borderRadius: 14,
                                    fontWeight: 900, fontSize: '0.95rem', cursor: 'pointer', transition: 'transform 0.2s'
                                }}>
                                    EASY MODE
                                </button>
                                <button onClick={() => startGame('normal')} style={{
                                    background: 'linear-gradient(135deg,#3b82f6,#2563eb)',
                                    color: 'white', border: 'none', padding: '16px', borderRadius: 14,
                                    fontWeight: 900, fontSize: '0.95rem', cursor: 'pointer', transition: 'transform 0.2s'
                                }}>
                                    MEDIUM MODE
                                </button>
                                <button onClick={() => startGame('hard')} style={{
                                    background: 'linear-gradient(135deg,#ef4444,#dc2626)',
                                    color: 'white', border: 'none', padding: '16px', borderRadius: 14,
                                    fontWeight: 900, fontSize: '0.95rem', cursor: 'pointer', transition: 'transform 0.2s'
                                }}>
                                    HIGH SPEED MODE
                                </button>

                                <button onClick={() => setPhase('idle')} style={{
                                    background: 'transparent', color: '#94a3b8', border: '1px solid #334155',
                                    padding: '10px', borderRadius: 12, fontWeight: 700, fontSize: '0.75rem', marginTop: 12, cursor: 'pointer'
                                }}>
                                    ← BACK
                                </button>
                            </div>
                        </div>
                    )}

                    {/* DONE / WIN overlay */}
                    {phase === 'done' && (
                        <div style={{
                            position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
                            alignItems: 'center', justifyContent: 'center',
                            background: 'rgba(2,16,10,0.92)', backdropFilter: 'blur(12px)', borderRadius: 18,
                            animation: 'celebrateIn 0.5s ease-out'
                        }}>
                            <div style={{ fontSize: '5rem', marginBottom: 12, filter: 'drop-shadow(0 0 20px #4ade80)' }}>🏆</div>
                            <h3 style={{
                                color: '#4ade80', fontSize: '3rem', fontWeight: 900, margin: '0 0 8px',
                                letterSpacing: '0.1em', textShadow: '0 0 30px rgba(74,222,128,0.6)'
                            }}>MISSION ACCOMPLISHED</h3>
                            <div style={{
                                background: 'rgba(74,222,128,0.1)', padding: '16px 32px', borderRadius: 20,
                                border: '1px solid rgba(74,222,128,0.3)', marginBottom: 32, textAlign: 'center'
                            }}>
                                <p style={{ color: '#bbf7d0', fontWeight: 800, margin: 0, fontSize: '1.4rem' }}>
                                    {(g.current.levelTime / 1000).toFixed(2)}s FINISH TIME
                                </p>
                                <p style={{ color: '#4ade80', fontWeight: 700, margin: '6px 0 0', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                                    GOAL REACHED · 100% SURVIVAL
                                </p>
                            </div>
                            <div style={{ display: 'flex', gap: 16 }}>
                                <button onClick={prepareGame} style={{
                                    background: 'linear-gradient(135deg, #4ade80, #16a34a)', color: 'white', border: 'none',
                                    padding: '16px 48px', borderRadius: 16, fontWeight: 900,
                                    fontSize: '1.2rem', cursor: 'pointer',
                                    boxShadow: '0 12px 30px rgba(74,222,128,0.4)',
                                    letterSpacing: '0.05em'
                                }}>PLAY AGAIN</button>
                                <button onClick={() => { g.current.phase = 'idle'; setPhase('idle'); }} style={{
                                    background: '#1e293b', color: '#94a3b8', border: 'none',
                                    padding: '16px 32px', borderRadius: 16, fontWeight: 800, cursor: 'pointer'
                                }}>Main Menu</button>
                            </div>
                            <div style={{ marginTop: 24, display: 'flex', gap: 10 }}>
                                <span style={{ color: '#4ade80', fontSize: '1.5rem', animation: 'bounce 2s infinite' }}>⭐</span>
                                <span style={{ color: '#4ade80', fontSize: '1.5rem', animation: 'bounce 2s infinite 0.2s' }}>⭐</span>
                                <span style={{ color: '#4ade80', fontSize: '1.5rem', animation: 'bounce 2s infinite 0.4s' }}>⭐</span>
                            </div>
                        </div>
                    )}

                    {/* DEAD overlay */}
                    {phase === 'dead' && (
                        <div style={{
                            position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
                            alignItems: 'center', justifyContent: 'center',
                            background: 'rgba(15,0,0,0.82)', backdropFilter: 'blur(10px)', borderRadius: 18
                        }}>
                            <div style={{ fontSize: '4.5rem', marginBottom: 12 }}>💥</div>
                            <h3 style={{ color: '#f87171', fontSize: '2.4rem', fontWeight: 900, margin: '0 0 8px', letterSpacing: '-0.02em' }}>CRASHED!</h3>
                            <div style={{
                                background: 'rgba(239,68,68,0.15)', padding: '12px 24px', borderRadius: 16,
                                border: '1px solid rgba(239,68,68,0.3)', marginBottom: 28, textAlign: 'center'
                            }}>
                                <p style={{ color: '#fca5a5', fontWeight: 800, margin: 0, fontSize: '1.2rem' }}>
                                    {(g.current.levelTime / 1000).toFixed(2)}s SURVIVED
                                </p>
                                <p style={{ color: '#ef4444', fontWeight: 700, margin: '4px 0 0', fontSize: '0.75rem', textTransform: 'uppercase' }}>
                                    DISTANCE: {(g.current.cameraY / 100).toFixed(0)}m
                                </p>
                            </div>
                            <div style={{ display: 'flex', gap: 12 }}>
                                <button onClick={retryLevel} style={{
                                    background: 'linear-gradient(135deg, #ef4444, #dc2626)', color: 'white', border: 'none',
                                    padding: '14px 40px', borderRadius: 16, fontWeight: 900,
                                    fontSize: '1.1rem', cursor: 'pointer',
                                    boxShadow: '0 10px 25px rgba(239,68,68,0.4)'
                                }}>RETRY RUN</button>
                                <button onClick={() => { g.current.phase = 'idle'; setPhase('idle'); }} style={{
                                    background: '#1e293b', color: '#94a3b8', border: 'none',
                                    padding: '14px 30px', borderRadius: 16, fontWeight: 800, cursor: 'pointer'
                                }}>Menu</button>
                            </div>
                            <p style={{ color: '#6366f1', fontSize: '0.75rem', fontWeight: 700, marginTop: 24, letterSpacing: '0.05em' }}>
                                SPACEBAR = QUICK RETRY
                            </p>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div style={{
                    marginTop: '1.5rem', paddingTop: '1.25rem', borderTop: '1px solid #f1f5f9',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    fontSize: '0.65rem', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.1em'
                }}>
                    <span style={{ display: 'flex', alignItems: 'center' }}>
                        <span style={{
                            width: 6, height: 6, background: '#10b981', borderRadius: '50%',
                            marginRight: 8, boxShadow: '0 0 10px #10b981'
                        }} />
                        ZK VERIFIER ACTIVE · STELLAR TESTNET
                    </span>
                    <span>© 2026 STELLAR GAME STUDIO</span>
                </div>
            </div>

            {/* ─── LEADERBOARD MODAL ─── */}
            {
                showLeaderboard && (
                    <CubeathonLeaderboard
                        sessionId={sessionId}
                        player1={player1}
                        player2={player2}
                        onClose={() => setShowLeaderboard(false)}
                    />
                )
            }
        </div >
    );
}

const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
