/**
 * Application constants – mirrors sgs_frontend/src/utils/constants.ts
 */

export const RPC_URL =
  import.meta.env.VITE_SOROBAN_RPC_URL || 'https://soroban-testnet.stellar.org';
export const NETWORK_PASSPHRASE =
  import.meta.env.VITE_NETWORK_PASSPHRASE || 'Test SDF Network ; September 2015';
export const NETWORK = RPC_URL.includes('testnet') ? 'testnet' : 'mainnet';

// Cubeathon contract – set VITE_CUBEATHON_CONTRACT_ID in .env after deployment
export const CUBEATHON_CONTRACT_ID =
  import.meta.env.VITE_CUBEATHON_CONTRACT_ID || '';

// Game Hub (hackathon requirement)
export const GAME_HUB_CONTRACT_ID =
  import.meta.env.VITE_GAME_HUB_CONTRACT_ID ||
  'CB4VZAT2U3UC6XFK3N23SKRF2NDCMP3QHJYMCHHFMZO7MRQO6DQ2EMYG';

// Dev wallets
export const DEV_PLAYER1_ADDRESS = import.meta.env.VITE_DEV_PLAYER1_ADDRESS || '';
export const DEV_PLAYER2_ADDRESS = import.meta.env.VITE_DEV_PLAYER2_ADDRESS || '';

// Transaction defaults
export const DEFAULT_METHOD_OPTIONS = { timeoutInSeconds: 30 };
export const DEFAULT_AUTH_TTL_MINUTES = 5;
export const MULTI_SIG_AUTH_TTL_MINUTES = 60;
