import type { contract } from '@stellar/stellar-sdk';

export type ContractSigner = Pick<
  contract.ClientOptions,
  'signTransaction' | 'signAuthEntry'
>;
