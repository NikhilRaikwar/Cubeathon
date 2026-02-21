import { Buffer } from "buffer";
import { Address } from "@stellar/stellar-sdk";
import {
  AssembledTransaction,
  Client as ContractClient,
  ClientOptions as ContractClientOptions,
  MethodOptions,
  Result,
  Spec as ContractSpec,
} from "@stellar/stellar-sdk/contract";
import type {
  u32,
  i32,
  u64,
  i64,
  u128,
  i128,
  u256,
  i256,
  Option,
  Timepoint,
  Duration,
} from "@stellar/stellar-sdk/contract";
export * from "@stellar/stellar-sdk";
export * as contract from "@stellar/stellar-sdk/contract";
export * as rpc from "@stellar/stellar-sdk/rpc";

if (typeof window !== "undefined") {
  //@ts-ignore Buffer exists
  window.Buffer = window.Buffer || Buffer;
}


export const networks = {
  testnet: {
    networkPassphrase: "Test SDF Network ; September 2015",
    contractId: "CDCOFNIL6DSQVCUVR2DUQ345WL6OG3A6GJZHFQB3YASJES37THHYCTAV",
  }
} as const

export const Errors = {
  1: {message:"GameNotFound"},
  2: {message:"NotPlayer"},
  3: {message:"GameAlreadyEnded"},
  4: {message:"InvalidProof"},
  5: {message:"NotInitialized"},
  6: {message:"InvalidLevel"},
  7: {message:"LevelNotUnlocked"}
}


/**
 * Per-player progress within a session
 */
export interface PlayerProgress {
  best_time_ms: u64;
  level_times: Array<u64>;
  levels_cleared: u32;
}


/**
 * Full session state
 */
export interface GameState {
  p1_points: i128;
  p1_progress: PlayerProgress;
  p2_points: i128;
  p2_progress: PlayerProgress;
  player1: string;
  player2: string;
  started_at: u64;
  winner: Option<string>;
}


/**
 * Global leaderboard entry
 */
export interface LeaderboardEntry {
  player: string;
  session_id: u32;
  time_ms: u64;
  timestamp: u64;
}

export type DataKey = {tag: "Game", values: readonly [u32]} | {tag: "GameHubAddress", values: void} | {tag: "VerifierAddress", values: void} | {tag: "ImageId", values: void} | {tag: "Admin", values: void} | {tag: "Leaderboard", values: void} | {tag: "LeaderboardCount", values: void};

export interface Client {
  /**
   * Construct and simulate a start_game transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Both players must authorize this transaction (multi-sig).
   * Calls Game Hub's start_game and records session state.
   */
  start_game: ({session_id, player1, player2, player1_points, player2_points}: {session_id: u32, player1: string, player2: string, player1_points: i128, player2_points: i128}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a submit_level transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Called after a player clears a level.
   * 
   * ZK verification: the proof and journal_hash prove that the player ran
   * the ZK circuit that encodes:
   * "given session_id, player, level, time_ms, and the obstacle layout
   * derived from the session seed — all walls were passed through valid gaps,
   * and the cube never left the road boundary."
   * 
   * journal_hash = SHA-256(session_id ‖ player_bytes ‖ level ‖ time_ms)
   * 
   * For this prototype, when a ZK verifier is not deployed, the contract
   * accepts proof = 0x00 and verifies only the journal_hash structure.
   */
  submit_level: ({session_id, player, level, time_ms, proof, journal_hash}: {session_id: u32, player: string, level: u32, time_ms: u64, proof: Buffer, journal_hash: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Result<boolean>>>

  /**
   * Construct and simulate a get_leaderboard transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Public: get the global leaderboard (sorted by fastest time)
   */
  get_leaderboard: (options?: MethodOptions) => Promise<AssembledTransaction<Array<LeaderboardEntry>>>

  /**
   * Construct and simulate a get_game transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_game: ({session_id}: {session_id: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Option<GameState>>>

}
export class Client extends ContractClient {
  static async deploy<T = Client>(
        /** Constructor/Initialization Args for the contract's `__constructor` method */
        {admin, game_hub, verifier, image_id}: {admin: string, game_hub: string, verifier: string, image_id: Buffer},
    /** Options for initializing a Client as well as for calling a method, with extras specific to deploying. */
    options: MethodOptions &
      Omit<ContractClientOptions, "contractId"> & {
        /** The hash of the Wasm blob, which must already be installed on-chain. */
        wasmHash: Buffer | string;
        /** Salt used to generate the contract's ID. Passed through to {@link Operation.createCustomContract}. Default: random. */
        salt?: Buffer | Uint8Array;
        /** The format used to decode `wasmHash`, if it's provided as a string. */
        format?: "hex" | "base64";
      }
  ): Promise<AssembledTransaction<T>> {
    return ContractClient.deploy({admin, game_hub, verifier, image_id}, options)
  }
  constructor(public readonly options: ContractClientOptions) {
    super(
      new ContractSpec([ "AAAABAAAAAAAAAAAAAAABUVycm9yAAAAAAAABwAAAAAAAAAMR2FtZU5vdEZvdW5kAAAAAQAAAAAAAAAJTm90UGxheWVyAAAAAAAAAgAAAAAAAAAQR2FtZUFscmVhZHlFbmRlZAAAAAMAAAAAAAAADEludmFsaWRQcm9vZgAAAAQAAAAAAAAADk5vdEluaXRpYWxpemVkAAAAAAAFAAAAAAAAAAxJbnZhbGlkTGV2ZWwAAAAGAAAAAAAAABBMZXZlbE5vdFVubG9ja2VkAAAABw==",
        "AAAAAQAAACRQZXItcGxheWVyIHByb2dyZXNzIHdpdGhpbiBhIHNlc3Npb24AAAAAAAAADlBsYXllclByb2dyZXNzAAAAAAADAAAAAAAAAAxiZXN0X3RpbWVfbXMAAAAGAAAAAAAAAAtsZXZlbF90aW1lcwAAAAPqAAAABgAAAAAAAAAObGV2ZWxzX2NsZWFyZWQAAAAAAAQ=",
        "AAAAAQAAABJGdWxsIHNlc3Npb24gc3RhdGUAAAAAAAAAAAAJR2FtZVN0YXRlAAAAAAAACAAAAAAAAAAJcDFfcG9pbnRzAAAAAAAACwAAAAAAAAALcDFfcHJvZ3Jlc3MAAAAH0AAAAA5QbGF5ZXJQcm9ncmVzcwAAAAAAAAAAAAlwMl9wb2ludHMAAAAAAAALAAAAAAAAAAtwMl9wcm9ncmVzcwAAAAfQAAAADlBsYXllclByb2dyZXNzAAAAAAAAAAAAB3BsYXllcjEAAAAAEwAAAAAAAAAHcGxheWVyMgAAAAATAAAAAAAAAApzdGFydGVkX2F0AAAAAAAGAAAAAAAAAAZ3aW5uZXIAAAAAA+gAAAAT",
        "AAAAAQAAABhHbG9iYWwgbGVhZGVyYm9hcmQgZW50cnkAAAAAAAAAEExlYWRlcmJvYXJkRW50cnkAAAAEAAAAAAAAAAZwbGF5ZXIAAAAAABMAAAAAAAAACnNlc3Npb25faWQAAAAAAAQAAAAAAAAAB3RpbWVfbXMAAAAABgAAAAAAAAAJdGltZXN0YW1wAAAAAAAABg==",
        "AAAAAgAAAAAAAAAAAAAAB0RhdGFLZXkAAAAABwAAAAEAAAAAAAAABEdhbWUAAAABAAAABAAAAAAAAAAAAAAADkdhbWVIdWJBZGRyZXNzAAAAAAAAAAAAAAAAAA9WZXJpZmllckFkZHJlc3MAAAAAAAAAAAAAAAAHSW1hZ2VJZAAAAAAAAAAAAAAAAAVBZG1pbgAAAAAAAAAAAAAAAAAAC0xlYWRlcmJvYXJkAAAAAAAAAAAAAAAAEExlYWRlcmJvYXJkQ291bnQ=",
        "AAAAAAAAAAAAAAANX19jb25zdHJ1Y3RvcgAAAAAAAAQAAAAAAAAABWFkbWluAAAAAAAAEwAAAAAAAAAIZ2FtZV9odWIAAAATAAAAAAAAAAh2ZXJpZmllcgAAABMAAAAAAAAACGltYWdlX2lkAAAD7gAAACAAAAAA",
        "AAAAAAAAAHBCb3RoIHBsYXllcnMgbXVzdCBhdXRob3JpemUgdGhpcyB0cmFuc2FjdGlvbiAobXVsdGktc2lnKS4KQ2FsbHMgR2FtZSBIdWIncyBzdGFydF9nYW1lIGFuZCByZWNvcmRzIHNlc3Npb24gc3RhdGUuAAAACnN0YXJ0X2dhbWUAAAAAAAUAAAAAAAAACnNlc3Npb25faWQAAAAAAAQAAAAAAAAAB3BsYXllcjEAAAAAEwAAAAAAAAAHcGxheWVyMgAAAAATAAAAAAAAAA5wbGF5ZXIxX3BvaW50cwAAAAAACwAAAAAAAAAOcGxheWVyMl9wb2ludHMAAAAAAAsAAAABAAAD6QAAAAIAAAAD",
        "AAAAAAAAAhhDYWxsZWQgYWZ0ZXIgYSBwbGF5ZXIgY2xlYXJzIGEgbGV2ZWwuCgpaSyB2ZXJpZmljYXRpb246IHRoZSBwcm9vZiBhbmQgam91cm5hbF9oYXNoIHByb3ZlIHRoYXQgdGhlIHBsYXllciByYW4KdGhlIFpLIGNpcmN1aXQgdGhhdCBlbmNvZGVzOgoiZ2l2ZW4gc2Vzc2lvbl9pZCwgcGxheWVyLCBsZXZlbCwgdGltZV9tcywgYW5kIHRoZSBvYnN0YWNsZSBsYXlvdXQKZGVyaXZlZCBmcm9tIHRoZSBzZXNzaW9uIHNlZWQg4oCUIGFsbCB3YWxscyB3ZXJlIHBhc3NlZCB0aHJvdWdoIHZhbGlkIGdhcHMsCmFuZCB0aGUgY3ViZSBuZXZlciBsZWZ0IHRoZSByb2FkIGJvdW5kYXJ5LiIKCmpvdXJuYWxfaGFzaCA9IFNIQS0yNTYoc2Vzc2lvbl9pZCDigJYgcGxheWVyX2J5dGVzIOKAliBsZXZlbCDigJYgdGltZV9tcykKCkZvciB0aGlzIHByb3RvdHlwZSwgd2hlbiBhIFpLIHZlcmlmaWVyIGlzIG5vdCBkZXBsb3llZCwgdGhlIGNvbnRyYWN0CmFjY2VwdHMgcHJvb2YgPSAweDAwIGFuZCB2ZXJpZmllcyBvbmx5IHRoZSBqb3VybmFsX2hhc2ggc3RydWN0dXJlLgAAAAxzdWJtaXRfbGV2ZWwAAAAGAAAAAAAAAApzZXNzaW9uX2lkAAAAAAAEAAAAAAAAAAZwbGF5ZXIAAAAAABMAAAAAAAAABWxldmVsAAAAAAAABAAAAAAAAAAHdGltZV9tcwAAAAAGAAAAAAAAAAVwcm9vZgAAAAAAAA4AAAAAAAAADGpvdXJuYWxfaGFzaAAAA+4AAAAgAAAAAQAAA+kAAAABAAAAAw==",
        "AAAAAAAAADtQdWJsaWM6IGdldCB0aGUgZ2xvYmFsIGxlYWRlcmJvYXJkIChzb3J0ZWQgYnkgZmFzdGVzdCB0aW1lKQAAAAAPZ2V0X2xlYWRlcmJvYXJkAAAAAAAAAAABAAAD6gAAB9AAAAAQTGVhZGVyYm9hcmRFbnRyeQ==",
        "AAAAAAAAAAAAAAAIZ2V0X2dhbWUAAAABAAAAAAAAAApzZXNzaW9uX2lkAAAAAAAEAAAAAQAAA+gAAAfQAAAACUdhbWVTdGF0ZQAAAA==" ]),
      options
    )
  }
  public readonly fromJSON = {
    start_game: this.txFromJSON<Result<void>>,
        submit_level: this.txFromJSON<Result<boolean>>,
        get_leaderboard: this.txFromJSON<Array<LeaderboardEntry>>,
        get_game: this.txFromJSON<Option<GameState>>
  }
}