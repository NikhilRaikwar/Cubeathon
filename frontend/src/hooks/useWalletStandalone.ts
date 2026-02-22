import { useCallback, useEffect } from 'react';
import {
  StellarWalletsKit,
  allowAllModules,
  FREIGHTER_ID,
} from '@creit.tech/stellar-wallets-kit';
import { useWalletStore } from '../store/walletSlice';
import { NETWORK, NETWORK_PASSPHRASE } from '../utils/constants';
import type { ContractSigner } from '../types/signer';
import type { WalletError } from '@stellar/stellar-sdk/contract';

const SELECTED_WALLET_KEY = 'stellar_wallet_id';

let kit: StellarWalletsKit | null = null;

function getKit(): StellarWalletsKit {
  if (!kit) {
    kit = new StellarWalletsKit({
      modules: allowAllModules(),
      network: NETWORK_PASSPHRASE as any,
      selectedWalletId: localStorage.getItem(SELECTED_WALLET_KEY) ?? FREIGHTER_ID,
    });
  }
  return kit;
}

function toWalletError(error?: { message: string; code: number }): WalletError | undefined {
  if (!error) return undefined;
  return { message: error.message, code: error.code };
}

export function useWalletStandalone() {
  const {
    publicKey,
    walletId,
    walletType,
    isConnected,
    isConnecting,
    network,
    networkPassphrase,
    error,
    currentPlayer,
    setWallet,
    setConnecting,
    setNetwork,
    setError,
    disconnect: storeDisconnect,
  } = useWalletStore();

  const isWalletAvailable = typeof window !== 'undefined';

  const connect = useCallback(async () => {
    if (typeof window === 'undefined') {
      setError('Wallet connection is only available in the browser.');
      return;
    }
    try {
      setConnecting(true);
      setError(null);
      const k = getKit();
      await k.openModal({
        onWalletSelected: async (option) => {
          try {
            localStorage.setItem(SELECTED_WALLET_KEY, option.id);
            k.setWallet(option.id);
            const { address } = await k.getAddress();
            setWallet(address, option.id, 'wallet');
            setNetwork(NETWORK, NETWORK_PASSPHRASE);
          } catch (e) {
            console.error(e);
          }
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to connect wallet';
      setError(message);
      throw err;
    } finally {
      setConnecting(false);
    }
  }, [setWallet, setConnecting, setError, setNetwork]);

  const refresh = useCallback(async () => {
    try {
      if (typeof window === 'undefined') return;
      const savedWalletId = localStorage.getItem(SELECTED_WALLET_KEY);
      if (!savedWalletId) return;
      const k = getKit();
      const { address } = await k.getAddress();
      if (address) {
        setWallet(address, savedWalletId, 'wallet');
        setNetwork(NETWORK, NETWORK_PASSPHRASE);
      }
    } catch {
      // ignore refresh failures
    }
  }, [setWallet, setNetwork]);

  const disconnect = useCallback(() => {
    localStorage.removeItem(SELECTED_WALLET_KEY);
    storeDisconnect();
  }, [storeDisconnect]);

  const connectDev = useCallback(async (_playerNumber?: 1 | 2) => {
    setError('Dev wallets are not available in standalone mode.');
    throw new Error('Dev wallets are not available in standalone mode.');
  }, [setError]);

  const switchPlayer = useCallback(async (_playerNumber?: 1 | 2) => {
    setError('Dev wallets are not available in standalone mode.');
    throw new Error('Dev wallets are not available in standalone mode.');
  }, [setError]);

  const isDevModeAvailable = useCallback(() => false, []);
  const isDevPlayerAvailable = useCallback(() => false, []);
  const getCurrentDevPlayer = useCallback(() => null, []);
  const quickstartAvailable = false;

  const getContractSigner = useCallback((): ContractSigner => {
    if (!isConnected || !publicKey) {
      throw new Error('Wallet not connected');
    }

    return {
      signTransaction: async (
        xdr: string,
        opts?: { networkPassphrase?: string; address?: string; submit?: boolean; submitUrl?: string }
      ) => {
        try {
          const k = getKit();
          const result = await k.signTransaction(xdr, {
            networkPassphrase: opts?.networkPassphrase || networkPassphrase || NETWORK_PASSPHRASE,
            address: opts?.address || publicKey,
          });
          return {
            signedTxXdr: (result as any).signedTxXdr || xdr,
            signerAddress: (result as any).signerAddress || publicKey,
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Failed to sign transaction';
          return {
            signedTxXdr: xdr,
            signerAddress: publicKey,
            error: toWalletError({ message, code: -1 }),
          };
        }
      },

      signAuthEntry: async (authEntry: string, opts?: { networkPassphrase?: string; address?: string }) => {
        try {
          const k = getKit();
          const result = await k.signAuthEntry(authEntry, {
            networkPassphrase: opts?.networkPassphrase || networkPassphrase || NETWORK_PASSPHRASE,
            address: opts?.address || publicKey,
          });
          return {
            signedAuthEntry: (result as any).signedAuthEntry || authEntry,
            signerAddress: (result as any).signerAddress || publicKey,
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Failed to sign auth entry';
          return {
            signedAuthEntry: authEntry,
            signerAddress: publicKey,
            error: toWalletError({ message, code: -1 }),
          };
        }
      },
    };
  }, [isConnected, publicKey, networkPassphrase]);

  useEffect(() => {
    refresh().catch(() => undefined);
  }, [refresh]);

  return {
    publicKey,
    walletId,
    walletType,
    isConnected,
    isConnecting,
    network,
    networkPassphrase,
    error,
    isWalletAvailable,
    currentPlayer: currentPlayer as 1 | 2 | null,
    connect,
    refresh,
    disconnect,
    getContractSigner,
    connectDev,
    switchPlayer,
    isDevModeAvailable: isDevModeAvailable(),
    isDevPlayerAvailable: isDevPlayerAvailable(),
    getCurrentDevPlayer: getCurrentDevPlayer(),
    quickstartAvailable,
  };
}
