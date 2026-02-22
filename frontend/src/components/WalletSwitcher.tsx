import { useEffect, useRef } from 'react';
import { useWallet } from '../hooks/useWallet';
import './WalletSwitcher.css';

export function WalletSwitcher() {
  const {
    publicKey,
    isConnected,
    isConnecting,
    walletType,
    error,
    connect,
    connectDev,
    switchPlayer,
    currentPlayer,
    isDevModeAvailable,
  } = useWallet();

  const hasAttemptedConnection = useRef(false);

  // Auto-connect to Player 1 on mount — only if dev mode is available
  useEffect(() => {
    if (!isConnected && !isConnecting && !hasAttemptedConnection.current && isDevModeAvailable) {
      hasAttemptedConnection.current = true;
      connectDev(1).catch(console.error);
    }
  }, [isConnected, isConnecting, connectDev, isDevModeAvailable]);

  const handleSwitch = async () => {
    if (walletType !== 'dev') return;
    const nextPlayer = currentPlayer === 1 ? 2 : 1;
    try {
      await switchPlayer(nextPlayer);
    } catch (err) {
      console.error('Failed to switch player:', err);
    }
  };

  // --- Standalone / Vercel mode: show Connect Wallet button ---
  if (!isDevModeAvailable && !isConnected) {
    return (
      <div className="wallet-switcher">
        {error && (
          <div className="wallet-error">
            <div className="error-title">Connection Failed</div>
            <div className="error-message">{error}</div>
          </div>
        )}
        <button
          className="connect-wallet-button"
          onClick={() => connect()}
          disabled={isConnecting}
          style={{
            background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
            color: 'white',
            border: 'none',
            borderRadius: '10px',
            padding: '8px 16px',
            fontWeight: 700,
            fontSize: '0.8rem',
            cursor: isConnecting ? 'not-allowed' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          {isConnecting ? '⟳ Connecting...' : '🔗 Connect Wallet'}
        </button>
      </div>
    );
  }

  // --- Dev mode: not connected yet (auto-connecting) ---
  if (!isConnected) {
    return (
      <div className="wallet-switcher">
        {error ? (
          <div className="wallet-error">
            <div className="error-title">Connection Failed</div>
            <div className="error-message">{error}</div>
          </div>
        ) : (
          <div className="wallet-status connecting">
            <span className="status-indicator"></span>
            <span className="status-text">Connecting...</span>
          </div>
        )}
      </div>
    );
  }

  // --- Connected ---
  return (
    <div className="wallet-switcher">
      {error && (
        <div className="wallet-error">
          {error}
        </div>
      )}

      <div className="wallet-info">
        <div className="wallet-status connected">
          <span className="status-indicator"></span>
          <div className="wallet-details">
            <div className="wallet-label">
              {walletType === 'dev' ? `Player ${currentPlayer}` : 'Connected'}
            </div>
            <div className="wallet-address">
              {publicKey ? `${publicKey.slice(0, 8)}...${publicKey.slice(-4)}` : ''}
            </div>
          </div>
          {walletType === 'dev' && (
            <button
              onClick={handleSwitch}
              className="switch-button"
              disabled={isConnecting}
            >
              Switch to Player {currentPlayer === 1 ? 2 : 1}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
