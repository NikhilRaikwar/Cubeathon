import { rpc } from '@stellar/stellar-sdk';

export async function calculateValidUntilLedger(
  rpcUrl: string,
  ttlMinutes: number
): Promise<number> {
  const server = new rpc.Server(rpcUrl);
  const latestLedger = await server.getLatestLedger();
  const LEDGERS_PER_MINUTE = 12; // ~5 s/ledger
  return latestLedger.sequence + Math.ceil(ttlMinutes * LEDGERS_PER_MINUTE);
}
