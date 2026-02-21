/**
 * Configuration loaded from environment variables
 * These are set by the setup script after deployment
 */

export const config = {
  rpcUrl: import.meta.env.VITE_SOROBAN_RPC_URL || 'https://soroban-testnet.stellar.org',
  networkPassphrase: import.meta.env.VITE_NETWORK_PASSPHRASE || 'Test SDF Network ; September 2015',
  contractIds: {
    'cubeathon': import.meta.env.VITE_CUBEATHON_CONTRACT_ID || '',
    'mock-game-hub': import.meta.env.VITE_MOCK_GAME_HUB_CONTRACT_ID || ''
  },

  // Backwards-compatible aliases for built-in games
  mockGameHubId: import.meta.env.VITE_MOCK_GAME_HUB_CONTRACT_ID || '',
  numberGuessId: import.meta.env.VITE_NUMBER_GUESS_CONTRACT_ID || '',

  devPlayer1Address: import.meta.env.VITE_DEV_PLAYER1_ADDRESS || '',
  devPlayer2Address: import.meta.env.VITE_DEV_PLAYER2_ADDRESS || '',
};
