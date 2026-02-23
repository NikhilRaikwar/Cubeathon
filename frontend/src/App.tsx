import { useState, useCallback, useEffect, memo } from 'react';
import { CubeathonGame } from './games/cubeathon/CubeathonGame';
import studioLogo from './assets/logo.svg';
import { useWallet } from './hooks/useWallet';
import { cubeathonService } from './services/cubeathonService';
import { devWalletService, DevWalletService } from './services/devWalletService';
import './App.css';

// ── Stable memoized header
interface AppHeaderProps {
  page: 'home' | 'games' | 'docs';
  publicKey: string | null;
  isConnected: boolean;
  isConnecting: boolean;
  currentPlayer: 1 | 2;
  walletError: string | null;
  isDevModeAvailable: boolean;
  onNavigate: (p: 'home' | 'games' | 'docs') => void;
  onSwitchPlayer: () => void;
  onConnect: () => void;
}

const AppHeader = memo(function AppHeader({
  page, publicKey, isConnected, isConnecting, currentPlayer, walletError,
  isDevModeAvailable, onNavigate, onSwitchPlayer, onConnect,
}: AppHeaderProps) {
  const shortAddr = (a: string) => a ? `${a.slice(0, 8)}...${a.slice(-4)}` : '—';
  return (
    <header className="studio-header">
      <div className="brand">
        <div className="brand-heading">
          <img className="brand-logo" src={studioLogo} alt="Stellar Game Studio logo" />
          <div className="brand-copy">
            <div className="brand-title">Stellar Game Studio</div>
            <div className="brand-subtitle-row">
              <p className="brand-subtitle">A DEVELOPER TOOLKIT FOR BUILDING WEB3 GAMES ON STELLAR</p>
              <span className="brand-version">v0.1.2</span>
            </div>
          </div>
        </div>
        <nav className="header-nav">
          <button type="button" className={`header-link ${page === 'home' ? 'active' : ''}`}
            onClick={() => onNavigate('home')}>Studio</button>
          <button type="button" className={`header-link ${page === 'games' ? 'active' : ''}`}
            onClick={() => onNavigate('games')}>Games Library</button>
          <button type="button" className={`header-link ${page === 'docs' ? 'active' : ''}`}
            onClick={() => onNavigate('docs')}>Documentation</button>
        </nav>
      </div>
      <div className="header-actions">
        <div className="network-pill">Testnet</div>
        <div className="wallet-switcher">
          <div className="wallet-info">
            {!isConnected ? (
              <div className="wallet-status connecting">
                <span className="status-indicator" />
                <span style={{ fontSize: '.8rem', color: 'var(--color-ink-muted)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  {isConnecting ? 'Connecting…' : walletError || 'Not connected'}
                  {!isConnecting && !isDevModeAvailable && (
                    <button onClick={onConnect} className="tiny-connect-btn">Connect Wallet</button>
                  )}
                </span>
              </div>
            ) : (
              <div className="wallet-status connected">
                <span className="status-indicator" />
                <div className="wallet-details">
                  <div className="wallet-label">{isDevModeAvailable && currentPlayer ? `Connected Player ${currentPlayer}` : 'Connected'}</div>
                  <div className="wallet-address">{shortAddr(publicKey ?? '')}</div>
                </div>
                {isDevModeAvailable && (
                  <button className="switch-button" onClick={onSwitchPlayer}>
                    Switch to Player {currentPlayer === 1 ? 2 : 1}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
});

const createSessionId = () => (Math.floor(Math.random() * 0xffffffff) >>> 0) || 1;
type AppPage = 'home' | 'games' | 'docs';
type CreateMode = 'create' | 'import' | 'load';

export default function App() {
  const {
    publicKey, isConnected, isConnecting,
    currentPlayer,
    connect,
    connectDev,
    switchPlayer,
    getContractSigner, quickstartAvailable,
    isDevModeAvailable,
    error: walletError,
  } = useWallet();

  const [page, setPage] = useState<AppPage>('games');
  const [gameActive, setGameActive] = useState(false);
  const [sessionId, setSessionId] = useState(createSessionId);

  // Create-mode form state
  const [createMode, setCreateMode] = useState<CreateMode>('create');
  const [player1Address, setPlayer1Address] = useState(publicKey || '');
  const [player1Points, setPlayer1Points] = useState('0.1');

  // Auth entry export (Player 1 → Player 2)
  const [exportedXDR, setExportedXDR] = useState<string | null>(null);
  const [xdrCopied, setXdrCopied] = useState(false);

  // Import-mode state (Player 2)
  const [importXDR, setImportXDR] = useState('');
  const [importP2Points, setImportP2Points] = useState('0.1');
  const [importParsed, setImportParsed] = useState<{ sessionId: number; player1: string; player1Points: string } | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  // Load-mode
  const [loadSessionId, setLoadSessionId] = useState('');

  // Transaction status
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Active game context
  const [activeGame, setActiveGame] = useState<{
    sessionId: number;
    player1: string;
    player2: string;
    player1Points: bigint;
    player2Points: bigint;
  } | null>(null);

  const shortAddr = (a: string) => a ? `${a.slice(0, 8)}...${a.slice(-4)}` : '—';

  useEffect(() => {
    if (publicKey) setPlayer1Address(publicKey);
  }, [publicKey]);

  const parsePoints = (s: string): bigint | null => {
    try {
      const cleaned = s.replace(/[^\d.]/g, '');
      if (!cleaned || cleaned === '.') return null;
      const [w = '0', f = ''] = cleaned.split('.');
      return BigInt(w + f.padEnd(7, '0').slice(0, 7));
    } catch { return null; }
  };

  const handlePrepare = useCallback(async () => {
    const freshSession = createSessionId();
    setSessionId(freshSession);
    setError(null); setSuccess(null);
    if (!isConnected || !publicKey) {
      setError('Wallet not connected. Please connect your wallet first.');
      return;
    }
    const p1Points = parsePoints(player1Points);
    if (!p1Points || p1Points <= 0n) { setError('Enter a valid points amount.'); return; }

    // Placeholder P2 for simulation
    let simulationP2 = 'GDO5KFBDKWAGPP3MC72BGBGMBA3UKYKLRTUUYX3AJLCGRVE2LDSEBDK7';
    if (simulationP2 === publicKey) {
      simulationP2 = 'GBD2IS3IQCZV565EMUF6TP74LQ5GFHJDH3GF3YTCF34XHLS7BMK6JATX';
    }

    try {
      setLoading(true);
      const signer = getContractSigner();
      const xdr = await cubeathonService.prepareStartGame(
        freshSession, player1Address, simulationP2, p1Points, p1Points, signer
      );
      setExportedXDR(xdr);
      setSuccess('Auth entry ready! Copy the XDR below and send it to Player 2.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Prepare failed.');
    } finally {
      setLoading(false);
    }
  }, [isConnected, publicKey, player1Address, player1Points, sessionId, getContractSigner]);

  const handleQuickstart = useCallback(async () => {
    const freshSession = createSessionId();
    setSessionId(freshSession);
    setError(null); setSuccess(null);
    if (!quickstartAvailable) {
      setError('Quickstart requires dev wallets (VITE_DEV_* secrets).');
      return;
    }
    try {
      setLoading(true);
      console.warn(`[Cubeathon] Quickstart starting Session: ${freshSession}`);
      await devWalletService.initPlayer(1);
      const p1Addr = devWalletService.getPublicKey();
      const p1Signer = devWalletService.getSigner();
      await devWalletService.initPlayer(2);
      const p2Addr = devWalletService.getPublicKey();
      const p2Signer = devWalletService.getSigner();
      const points = parsePoints('0.1') ?? 1000000n;

      console.info(`[Cubeathon] Creating on-chain session...`);

      const ensureFunded = async (addr: string) => {
        try {
          const rpc = import.meta.env.VITE_SOROBAN_RPC_URL;
          // Use horizon to check account existence
          const horizon = rpc.includes('lightsail') ? 'https://horizon-testnet.stellar.org' : rpc.replace('rpc', 'horizon');
          const resp = await fetch(`${horizon}/accounts/${addr}`);
          if (resp.status === 404) {
            console.log(`[DevWallet] Funding account ${addr} via Friendbot...`);
            await fetch(`https://friendbot.stellar.org/?addr=${addr}`);
            await new Promise(r => setTimeout(r, 5000));
          }
        } catch (e) { console.warn(`Funding check failed`, e); }
      };
      await ensureFunded(p1Addr);
      await ensureFunded(p2Addr);

      const p1XDR = await cubeathonService.prepareStartGame(
        freshSession, p1Addr, p2Addr, points, points, p1Signer
      );
      await cubeathonService.importAndStartGame(p1XDR, p2Addr, points, p2Signer);

      await connectDev(1);
      setActiveGame({
        sessionId: freshSession,
        player1: p1Addr,
        player2: p2Addr,
        player1Points: points,
        player2Points: points,
      });
      setSuccess(`Quickstart complete! Session ${freshSession} initialized on-chain.`);
      setGameActive(true);
    } catch (err) {
      console.error('[Cubeathon] Quickstart FAILED:', err);
      setError(err instanceof Error ? err.message : 'Quickstart failed');
    } finally {
      setLoading(false);
    }
  }, [quickstartAvailable, connectDev]);

  const handleImport = useCallback(async () => {
    setError(null); setSuccess(null);
    if (!importXDR.trim()) { setError('Paste the auth entry XDR from Player 1.'); return; }
    if (!isConnected || !publicKey) { setError('Connect wallet first.'); return; }
    const p2Points = parsePoints(importP2Points);
    if (!p2Points || p2Points <= 0n) { setError('Enter valid Player 2 points.'); return; }
    try {
      setLoading(true);
      const parsed = cubeathonService.parseAuthEntry(importXDR.trim());
      if (parsed.player1 === publicKey) {
        throw new Error('You cannot import your own auth entry (you are Player 1).');
      }
      setImportParsed({
        sessionId: parsed.sessionId,
        player1: parsed.player1,
        player1Points: (Number(parsed.player1Points) / 1e7).toFixed(2),
      });
      const signer = getContractSigner();
      await cubeathonService.importAndStartGame(importXDR.trim(), publicKey, p2Points, signer);
      setActiveGame({
        sessionId: parsed.sessionId,
        player1: parsed.player1,
        player2: publicKey,
        player1Points: parsed.player1Points,
        player2Points: p2Points,
      });
      setSuccess('Game created on-chain! Starting game…');
      setGameActive(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setLoading(false);
    }
  }, [importXDR, importP2Points, isConnected, publicKey, getContractSigner]);

  const handleLoad = useCallback(async () => {
    setError(null);
    const sid = parseInt(loadSessionId, 10);
    if (isNaN(sid) || sid <= 0) { setError('Enter a valid session ID.'); return; }
    try {
      setLoading(true);
      const game = await cubeathonService.getGame(sid);
      if (!game) { setError('Game not found on-chain.'); return; }
      setActiveGame({
        sessionId: sid,
        player1: game.player1,
        player2: game.player2,
        player1Points: game.p1_points,
        player2Points: game.p2_points,
      });
      setSuccess('Game found! Loading…');
      setGameActive(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Load failed');
    } finally {
      setLoading(false);
    }
  }, [loadSessionId]);

  const navigate = useCallback((p: 'home' | 'games' | 'docs') => {
    setPage(p); setGameActive(false);
  }, []);

  if (gameActive) {
    return (
      <div className="studio">
        <div className="studio-background" aria-hidden="true">
          <div className="studio-orb orb-1" /><div className="studio-orb orb-2" />
          <div className="studio-orb orb-3" /><div className="studio-grid" />
        </div>
        <AppHeader
          page={page}
          onNavigate={navigate}
          publicKey={publicKey}
          isConnected={isConnected}
          isConnecting={isConnecting}
          currentPlayer={currentPlayer as 1 | 2}
          walletError={walletError}
          isDevModeAvailable={isDevModeAvailable}
          onSwitchPlayer={() => switchPlayer(currentPlayer === 1 ? 2 : 1)}
          onConnect={() => connect()}
        />
        <main className="studio-main">
          <CubeathonGame
            key={`${publicKey}-${activeGame?.sessionId ?? sessionId}`}
            userAddress={publicKey ?? ''}
            sessionId={activeGame?.sessionId ?? sessionId}
            player1={activeGame?.player1 ?? player1Address}
            player2={activeGame?.player2 ?? ''}
            availablePoints={activeGame?.player1 === publicKey ? activeGame.player1Points : activeGame?.player2Points ?? 10000000n}
            isOnChain={!!activeGame}
            onBack={() => setGameActive(false)}
            onStandingsRefresh={() => { }}
            onGameComplete={(w) => {
              const jackpot = (activeGame?.player1Points ?? 0n) + (activeGame?.player2Points ?? 0n);
              const prize = (Number(jackpot) / 1e7).toFixed(2);
              setSuccess(`🏁 Session Finalized! Winner: ${shortAddr(w)} survived longer and took the ${prize} Points jackpot!`);
              setGameActive(false);
            }}
          />
        </main>
        <footer className="studio-footer">
          <span className="footer-meta">Built with ♥️ for Stellar game developers</span>
        </footer>
      </div>
    );
  }

  if (page === 'home') {
    return (
      <div className="studio">
        <div className="studio-background" aria-hidden="true">
          <div className="studio-orb orb-1" /><div className="studio-orb orb-2" />
          <div className="studio-orb orb-3" /><div className="studio-grid" />
        </div>
        <AppHeader
          page={page}
          onNavigate={navigate}
          publicKey={publicKey}
          isConnected={isConnected}
          isConnecting={isConnecting}
          currentPlayer={currentPlayer as 1 | 2}
          walletError={walletError}
          isDevModeAvailable={isDevModeAvailable}
          onSwitchPlayer={() => switchPlayer(currentPlayer === 1 ? 2 : 1)}
          onConnect={() => connect()}
        />
        <main className="studio-main">
          <div className="card" style={{ maxWidth: 640, margin: '0 auto' }}>
            <h2 style={{ fontFamily: 'var(--font-serif)', marginBottom: '1rem' }}>Welcome to the Studio</h2>
            <p style={{ color: 'var(--color-ink-muted)', lineHeight: 1.7, marginBottom: '1.5rem' }}>
              Stellar Game Studio is a developer toolkit for building on-chain games on Stellar.
              Fork a game, deploy your contract, and play in minutes.
            </p>
            <button className="button primary" onClick={() => setPage('games')}>Open Games Library →</button>
          </div>
        </main>
        <footer className="studio-footer"><span className="footer-meta">Built with ♥️ for Stellar game developers</span></footer>
      </div>
    );
  }

  if (page === 'docs') {
    return (
      <div className="studio">
        <div className="studio-background" aria-hidden="true">
          <div className="studio-orb orb-1" /><div className="studio-orb orb-2" />
          <div className="studio-orb orb-3" /><div className="studio-grid" />
        </div>
        <AppHeader
          page={page}
          onNavigate={navigate}
          publicKey={publicKey}
          isConnected={isConnected}
          isConnecting={isConnecting}
          currentPlayer={currentPlayer as 1 | 2}
          walletError={walletError}
          isDevModeAvailable={isDevModeAvailable}
          onSwitchPlayer={() => switchPlayer(currentPlayer === 1 ? 2 : 1)}
          onConnect={() => connect()}
        />
        <main className="studio-main">
          <div className="card" style={{ maxWidth: 720, margin: '0 auto' }}>
            <h2 style={{ fontFamily: 'var(--font-serif)', marginBottom: '1rem' }}>Documentation</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', fontSize: '.9rem', lineHeight: 1.7 }}>
              <div className="notice"><strong>Setup</strong><br />Add secrets to <code>.env</code>:<br /><code>VITE_DEV_PLAYER1_SECRET=S...</code><br /><code>VITE_DEV_PLAYER2_SECRET=S...</code><br /><code>VITE_CUBEATHON_CONTRACT_ID=C...</code></div>
              <div className="notice"><strong>Two-Player Flow</strong><br />1. Player 1: <em>Create &amp; Export</em> → copies signed XDR.<br />2. Player 2: <em>Import Auth Entry</em> → pastes XDR → joins, submits tx on-chain.<br />3. Both play; survival times are ZK-proven and the best survivor takes the jackpot.</div>
              <div className="notice"><strong>Game Hub</strong><br /><code style={{ wordBreak: 'break-all' }}>CB4VZAT2U3UC6XFK3N23SKRF2NDCMP3QHJYMCHHFMZO7MRQO6DQ2EMYG</code></div>
            </div>
          </div>
        </main>
        <footer className="studio-footer"><span className="footer-meta">Built with ♥️ for Stellar game developers</span></footer>
      </div>
    );
  }

  const tabGrad: Record<CreateMode, string> = {
    create: 'linear-gradient(135deg,#a855f7,#ec4899)',
    import: 'linear-gradient(135deg,#3b82f6,#06b6d4)',
    load: 'linear-gradient(135deg,#10b981,#059669)',
  };

  return (
    <div className="studio">
      <div className="studio-background" aria-hidden="true">
        <div className="studio-orb orb-1" /><div className="studio-orb orb-2" />
        <div className="studio-orb orb-3" /><div className="studio-grid" />
      </div>
      <AppHeader
        page={page}
        onNavigate={navigate}
        publicKey={publicKey}
        isConnected={isConnected}
        isConnecting={isConnecting}
        currentPlayer={currentPlayer as 1 | 2}
        walletError={walletError}
        isDevModeAvailable={isDevModeAvailable}
        onSwitchPlayer={() => switchPlayer(currentPlayer === 1 ? 2 : 1)}
        onConnect={() => connect()}
      />
      <main className="studio-main">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h2 style={{ fontFamily: 'var(--font-serif)', fontSize: 'clamp(1.6rem,3vw,2.4rem)', margin: 0, background: 'linear-gradient(135deg,#a855f7,#ec4899)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', display: 'inline-flex', gap: 10 }}>
              Cubeathon ⬛
            </h2>
            <p style={{ color: 'var(--color-ink-muted)', fontWeight: 600, fontSize: '.9rem', margin: '4px 0 0' }}>
              Survive the obstacles at increasing speed! Highest survival time wins the jackpot.
            </p>
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: '.72rem', color: 'var(--color-ink-muted)', margin: '3px 0 0' }}>
              Session ID: {sessionId}
            </p>
          </div>
          <button onClick={() => setPage('home')} style={{ background: 'linear-gradient(135deg,#e5e7eb,#d1d5db)', border: '1px solid #9ca3af', color: '#374151', padding: '9px 18px', borderRadius: 10, fontWeight: 700, fontSize: '.82rem', cursor: 'pointer', whiteSpace: 'nowrap' }}>
            ← Back to Games
          </button>
        </div>
        {error && <div className="notice error" style={{ marginBottom: 16 }}>⚠️ {error}</div>}
        {success && <div className="notice success" style={{ marginBottom: 16 }}>✅ {success}</div>}
        <div className="card" style={{ padding: '2rem' }}>
          <div style={{ display: 'flex', gap: 8, background: '#f3f4f6', borderRadius: 14, padding: 6, marginBottom: '1.5rem' }}>
            {(['create', 'import', 'load'] as CreateMode[]).map((m) => (
              <button key={m} onClick={() => { setCreateMode(m); setError(null); setSuccess(null); setExportedXDR(null); }} style={{
                flex: 1, padding: '10px 8px', borderRadius: 10,
                fontWeight: 700, fontSize: '.78rem', cursor: 'pointer',
                border: createMode === m ? '1px solid rgba(0,0,0,.1)' : '1px solid transparent',
                background: createMode === m ? tabGrad[m] : 'white',
                color: createMode === m ? 'white' : '#6b7280',
                boxShadow: createMode === m ? '0 4px 12px rgba(0,0,0,.15)' : 'none',
                transition: 'all .2s ease',
              }}>
                {m === 'create' ? 'Create & Export' : m === 'import' ? 'Import Auth Entry' : 'Load Existing Game'}
              </button>
            ))}
          </div>

          <div style={{ background: 'linear-gradient(135deg,#fefce8,#fef3c7)', border: '2px solid #fde68a', borderRadius: 14, padding: '14px 18px', marginBottom: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
            <div>
              <p style={{ fontWeight: 800, fontSize: '.83rem', color: '#78350f', marginBottom: 2 }}>⚡ Quickstart (Dev)</p>
              <p style={{ fontSize: '.72rem', fontWeight: 600, color: '#92400e' }}>
                Creates and signs for both dev wallets in one click. Works only in the Games Library.
              </p>
            </div>
            <button onClick={handleQuickstart} disabled={loading || !quickstartAvailable} style={{ background: loading || !quickstartAvailable ? '#d1d5db' : 'linear-gradient(135deg,#f59e0b,#d97706)', color: loading || !quickstartAvailable ? '#9ca3af' : 'white', border: 'none', borderRadius: 12, padding: '10px 22px', fontWeight: 800, fontSize: '.78rem', cursor: loading || !quickstartAvailable ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap' }}>
              {loading ? 'Working…' : '⚡ Quickstart Game'}
            </button>
          </div>
          {createMode === 'create' && !exportedXDR && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <div>
                <label style={lbl}>Your Address (Player 1)</label>
                <input type="text" value={player1Address} onChange={e => setPlayer1Address(e.target.value.trim())} placeholder="G..." style={inp} />
                <p style={hint}>Pre-filled from connected wallet.</p>
              </div>
              <div>
                <label style={lbl}>Your Points</label>
                <input type="text" value={player1Points} onChange={e => setPlayer1Points(e.target.value)} placeholder="0.1" style={inp} />
                <p style={hint}>Available: 100.00 Points</p>
              </div>
              <div style={infoBox}>
                <p style={{ fontSize: '.72rem', fontWeight: 600, color: '#1e40af' }}>
                  ℹ️ Player 2 will specify their own address and points when they import your auth entry. You only need to prepare and export your signature.
                </p>
              </div>
              <p style={hint}>Session ID: {sessionId}</p>
              <button onClick={handlePrepare} disabled={loading || !isConnected} style={{ ...bigBtn('linear-gradient(135deg,#a855f7,#ec4899)') }}>
                {loading ? 'Preparing…' : 'Prepare & Export Auth Entry'}
              </button>
            </div>
          )}
          {createMode === 'create' && exportedXDR && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <p style={{ fontWeight: 700, fontSize: '.88rem' }}>✅ Auth entry signed! Send this to Player 2:</p>
              <textarea readOnly value={exportedXDR} rows={6} style={{ ...inp, fontFamily: 'var(--font-mono)', fontSize: '.65rem', resize: 'vertical' }} />
              <div style={{ display: 'flex', gap: 10 }}>
                <button onClick={() => { navigator.clipboard.writeText(exportedXDR); setXdrCopied(true); setTimeout(() => setXdrCopied(false), 2000); }} style={{ ...bigBtn('linear-gradient(135deg,#a855f7,#ec4899)'), flex: 1 }}>
                  {xdrCopied ? '✅ Copied!' : '📋 Copy Auth Entry XDR'}
                </button>
                <button onClick={() => setExportedXDR(null)} style={{ padding: '12px 20px', border: '1px solid #d1d5db', borderRadius: 12, background: 'white', cursor: 'pointer', fontWeight: 700 }}>
                  Reset
                </button>
              </div>
              <div style={infoBox}>
                <p style={{ fontSize: '.72rem', color: '#1e40af', fontWeight: 600 }}>
                  ⏳ Waiting for Player 2 to import and submit… Once they do, start the game below.
                </p>
              </div>
              <button onClick={() => setGameActive(true)} style={{ ...bigBtn('linear-gradient(135deg,#10b981,#059669)') }}>▶ Enter Game (Player 1)</button>
            </div>
          )}
          {createMode === 'import' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <div>
                <label style={lbl}>Auth Entry XDR (from Player 1)</label>
                <textarea value={importXDR} onChange={e => { setImportXDR(e.target.value); setImportError(null); setImportParsed(null); try { if (e.target.value.trim()) setImportParsed((() => { const p = cubeathonService.parseAuthEntry(e.target.value.trim()); return { sessionId: p.sessionId, player1: p.player1, player1Points: (Number(p.player1Points) / 1e7).toFixed(2) }; })()); } catch { setImportError('Invalid XDR. Paste the exact string from Player 1.'); } }} placeholder="Paste XDR auth entry here…" rows={5} style={{ ...inp, fontFamily: 'var(--font-mono)', fontSize: '.65rem', resize: 'vertical' }} />
                {importError && <p style={{ fontSize: '.72rem', color: '#ef4444', fontWeight: 600, marginTop: 4 }}>{importError}</p>}
              </div>
              {importParsed && (
                <div style={infoBox}>
                  <p style={{ fontSize: '.72rem', fontWeight: 700, color: '#1e40af', marginBottom: 4 }}>✅ Auth entry parsed:</p>
                  <p style={{ fontSize: '.72rem', color: '#1e40af' }}>Player 1: <code>{importParsed.player1.slice(0, 10)}…</code></p>
                  <p style={{ fontSize: '.72rem', color: '#1e40af' }}>Session: <code>{importParsed.sessionId}</code> · Points: <code>{importParsed.player1Points}</code></p>
                </div>
              )}
              <div>
                <label style={lbl}>Your Points (Player 2)</label>
                <input type="text" value={importP2Points} onChange={e => setImportP2Points(e.target.value)} placeholder="0.1" style={inp} />
              </div>
              <button onClick={handleImport} disabled={loading || !isConnected || !!importError || !importXDR.trim()} style={{ ...bigBtn('linear-gradient(135deg,#3b82f6,#06b6d4)') }}>
                {loading ? 'Submitting to Stellar…' : 'Import & Join Game'}
              </button>
            </div>
          )}
          {createMode === 'load' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <div>
                <label style={lbl}>Session ID</label>
                <input type="text" value={loadSessionId} onChange={e => setLoadSessionId(e.target.value)} placeholder={String(sessionId)} style={inp} />
              </div>
              <button onClick={handleLoad} disabled={loading || !isConnected} style={{ ...bigBtn('linear-gradient(135deg,#10b981,#059669)') }}>
                {loading ? 'Loading…' : 'Load Game →'}
              </button>
            </div>
          )}
        </div>
      </main>
      <footer className="studio-footer"><span className="footer-meta">Built with ♥️ for Stellar game developers</span></footer>
    </div>
  );
}

const lbl: React.CSSProperties = { display: 'block', fontWeight: 700, fontSize: '.82rem', color: '#374151', marginBottom: 6 };
const inp: React.CSSProperties = { width: '100%', padding: '12px 16px', border: '2px solid #e5e7eb', borderRadius: 12, fontSize: '.85rem', outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit', background: 'white' };
const hint: React.CSSProperties = { fontSize: '.72rem', color: '#6b7280', fontWeight: 600, marginTop: 4 };
const infoBox: React.CSSProperties = { background: 'linear-gradient(135deg,#eff6ff,#dbeafe)', border: '2px solid #bfdbfe', borderRadius: 12, padding: '10px 14px' };
const bigBtn = (bg: string): React.CSSProperties => ({
  width: '100%', padding: 14, background: bg, color: 'white', border: 'none',
  borderRadius: 14, fontWeight: 800, fontSize: '.95rem', cursor: 'pointer',
  boxShadow: '0 8px 24px rgba(0,0,0,.15)', letterSpacing: '.02em',
});
