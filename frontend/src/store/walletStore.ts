import { create } from 'zustand';

interface WalletState {
    publicKey: string | null;
    walletType: 'dev' | null;
    isConnected: boolean;
    isConnecting: boolean;
    error: string | null;
    currentPlayer: 1 | 2;
    setWallet: (publicKey: string, walletType: 'dev', player: 1 | 2) => void;
    setConnecting: (v: boolean) => void;
    setError: (e: string | null) => void;
    disconnect: () => void;
}

export const useWalletStore = create<WalletState>((set) => ({
    publicKey: null,
    walletType: null,
    isConnected: false,
    isConnecting: false,
    error: null,
    currentPlayer: 1,
    setWallet: (publicKey, walletType, player) =>
        set({ publicKey, walletType, isConnected: true, currentPlayer: player, error: null }),
    setConnecting: (v) => set({ isConnecting: v }),
    setError: (e) => set({ error: e }),
    disconnect: () => set({ publicKey: null, walletType: null, isConnected: false }),
}));
