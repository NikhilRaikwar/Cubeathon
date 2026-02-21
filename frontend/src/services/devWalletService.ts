/**
 * Dev Wallet Service – identical pattern to sgs_frontend/src/services/devWalletService.ts
 * Uses VITE_DEV_PLAYER1_SECRET / VITE_DEV_PLAYER2_SECRET from .env
 */
import { Buffer } from 'buffer';
import { Keypair, TransactionBuilder, hash } from '@stellar/stellar-sdk';
import type { ContractSigner } from '../types/signer';
import type { WalletError } from '@stellar/stellar-sdk/contract';

class DevWalletService {
  private currentPlayer: 1 | 2 | null = null;
  private keypairs: Record<string, Keypair> = {};

  static isDevModeAvailable(): boolean {
    return !!(
      import.meta.env.VITE_DEV_PLAYER1_SECRET &&
      import.meta.env.VITE_DEV_PLAYER2_SECRET
    );
  }

  static isPlayerAvailable(playerNumber: 1 | 2): boolean {
    const secret =
      playerNumber === 1
        ? import.meta.env.VITE_DEV_PLAYER1_SECRET
        : import.meta.env.VITE_DEV_PLAYER2_SECRET;
    return !!secret && secret !== 'NOT_AVAILABLE';
  }

  async initPlayer(playerNumber: 1 | 2): Promise<void> {
    const key = `player${playerNumber}`;
    const secret =
      playerNumber === 1
        ? import.meta.env.VITE_DEV_PLAYER1_SECRET
        : import.meta.env.VITE_DEV_PLAYER2_SECRET;

    if (!secret || secret === 'NOT_AVAILABLE') {
      throw new Error(
        `Player ${playerNumber} secret not available. Add VITE_DEV_PLAYER${playerNumber}_SECRET to .env`
      );
    }
    const kp = Keypair.fromSecret(secret);
    this.keypairs[key] = kp;
    this.currentPlayer = playerNumber;
    console.log(`[DevWallet] Player ${playerNumber}: ${kp.publicKey()}`);
  }

  getPublicKey(): string {
    if (!this.currentPlayer) throw new Error('No player initialized');
    const kp = this.keypairs[`player${this.currentPlayer}`];
    if (!kp) throw new Error(`Player ${this.currentPlayer} not initialized`);
    return kp.publicKey();
  }

  getCurrentPlayer(): 1 | 2 | null {
    return this.currentPlayer;
  }

  async switchPlayer(playerNumber: 1 | 2): Promise<void> {
    await this.initPlayer(playerNumber);
  }

  disconnect(): void {
    this.currentPlayer = null;
    this.keypairs = {};
  }

  getSigner(): ContractSigner {
    const key = this.currentPlayer ? `player${this.currentPlayer}` : null;
    if (!key || !this.keypairs[key]) throw new Error('No player initialized');

    const kp = this.keypairs[key];
    const publicKey = kp.publicKey();
    const toWalletError = (msg: string): WalletError => ({ message: msg, code: -1 });

    return {
      signTransaction: async (txXdr: string, opts?: any) => {
        try {
          if (!opts?.networkPassphrase) throw new Error('Missing networkPassphrase');
          const tx = TransactionBuilder.fromXDR(txXdr, opts.networkPassphrase);
          tx.sign(kp);
          return { signedTxXdr: tx.toXDR(), signerAddress: publicKey };
        } catch (err) {
          return {
            signedTxXdr: txXdr,
            signerAddress: publicKey,
            error: toWalletError(err instanceof Error ? err.message : 'Sign failed'),
          };
        }
      },

      signAuthEntry: async (preimageXdr: string, _opts?: any) => {
        try {
          const preimageBytes = Buffer.from(preimageXdr, 'base64');
          const payload = hash(preimageBytes);
          const sig = kp.sign(payload);
          return { signedAuthEntry: Buffer.from(sig).toString('base64'), signerAddress: publicKey };
        } catch (err) {
          return {
            signedAuthEntry: preimageXdr,
            signerAddress: publicKey,
            error: toWalletError(err instanceof Error ? err.message : 'Auth sign failed'),
          };
        }
      },
    };
  }
}

export const devWalletService = new DevWalletService();
export { DevWalletService };
