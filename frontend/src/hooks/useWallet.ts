import { useDevWallet } from './useDevWallet';
import { useWalletStandalone } from './useWalletStandalone';
import { DevWalletService } from '../services/devWalletService';

/**
 * A composite hook that automatically delegates to useDevWallet in local development
 * (when VITE_DEV_* secrets are present) and useWalletStandalone otherwise (like on Vercel).
 */
export function useWallet() {
    const isDevModeAvailable = DevWalletService.isDevModeAvailable();

    // Rules of hooks: both hooks must be called unconditionally on every render
    const devWallet = useDevWallet();
    const standaloneWallet = useWalletStandalone();

    if (isDevModeAvailable) {
        return devWallet;
    }

    // Not in dev mode, provide the standard wallet experience
    return standaloneWallet;
}
