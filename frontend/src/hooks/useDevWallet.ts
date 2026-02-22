import { useCallback, useEffect, useRef } from 'react';
import { useWalletStore } from '../store/walletSlice';
import { devWalletService, DevWalletService } from '../services/devWalletService';
import { NETWORK_PASSPHRASE } from '../utils/constants';
import type { ContractSigner } from '../types/signer';

export function useDevWallet() {
  const {
    publicKey, walletType, isConnected, isConnecting, error,
    currentPlayer,
    setWallet, setConnecting, setError, disconnect: storeDisconnect,
  } = useWalletStore();

  const connectDev = useCallback(async (playerNumber: 1 | 2) => {
    try {
      setConnecting(true);
      setError(null);
      await devWalletService.initPlayer(playerNumber);
      const address = devWalletService.getPublicKey();
      setWallet(address, 'dev', 'dev', playerNumber);
      return address;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to connect';
      setError(msg);
      throw err;
    } finally {
      setConnecting(false);
    }
  }, [setConnecting, setError, setWallet]);

  // Auto-connect Player 1 once on mount
  const autoConnectDone = useRef(false);
  useEffect(() => {
    if (autoConnectDone.current) return;
    if (isConnected) { autoConnectDone.current = true; return; }
    if (!DevWalletService.isDevModeAvailable()) return;
    autoConnectDone.current = true;
    connectDev(1).catch(console.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const switchPlayer = useCallback(async (playerNumber: 1 | 2) => {
    try {
      setConnecting(true);
      setError(null);
      await devWalletService.switchPlayer(playerNumber);
      const address = devWalletService.getPublicKey();
      setWallet(address, 'dev', 'dev', playerNumber);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Switch failed';
      setError(msg);
      throw err;
    } finally {
      setConnecting(false);
    }
  }, [setConnecting, setError, setWallet]);

  const disconnect = useCallback(async () => {
    if (walletType === 'dev') devWalletService.disconnect();
    storeDisconnect();
  }, [walletType, storeDisconnect]);

  const getContractSigner = useCallback((): ContractSigner => {
    if (!isConnected || !publicKey) throw new Error('Wallet not connected');
    if (walletType === 'dev') return devWalletService.getSigner();
    throw new Error('Only dev wallet signing is supported');
  }, [isConnected, publicKey, walletType]);

  return {
    publicKey,
    walletType,
    isConnected,
    isConnecting,
    error,
    currentPlayer: currentPlayer as 1 | 2,
    networkPassphrase: NETWORK_PASSPHRASE,
    connectDev,
    switchPlayer,
    disconnect,
    getContractSigner,
    isDevModeAvailable: DevWalletService.isDevModeAvailable(),
    quickstartAvailable:
      walletType === 'dev' &&
      DevWalletService.isPlayerAvailable(1) &&
      DevWalletService.isPlayerAvailable(2),
    connect: async () => { }, // Not needed for dev wallet
    refresh: async () => { }, // Not needed for dev wallet
  };
}
