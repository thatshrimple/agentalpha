// Integration test for the oracle gate on record_outcome.
//
// Needs a local validator with the program deployed as *upgradeable* (so it has
// ProgramData) and the IDL from `anchor build` at target/idl/agentalpha.json:
//   anchor test            # or: ANCHOR_PROVIDER_URL=... ANCHOR_WALLET=... npx tsx --test tests/record-outcome.test.ts
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import anchor from '@coral-xyz/anchor';
import { Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram } from '@solana/web3.js';

const { AnchorProvider, Program, Wallet, BN } = anchor;
const BPF_UPGRADEABLE_LOADER = new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111');

const provider = AnchorProvider.env();
const idl = JSON.parse(readFileSync(new URL('../target/idl/agentalpha.json', import.meta.url), 'utf8'));
const admin = (provider.wallet as InstanceType<typeof Wallet>).payer;
const oracle = Keypair.generate();
const signalProvider = Keypair.generate();
const stranger = Keypair.generate();

const programFor = (kp: Keypair) =>
  new Program(idl, new AnchorProvider(provider.connection, new Wallet(kp), { commitment: 'confirmed' })) as any;
const program = programFor(admin);
const pid = program.programId as PublicKey;
const pda = (...seeds: Buffer[]) => PublicKey.findProgramAddressSync(seeds, pid)[0];
const oracleConfig = pda(Buffer.from('oracle-config'));
const programData = PublicKey.findProgramAddressSync([pid.toBuffer()], BPF_UPGRADEABLE_LOADER)[0];
const providerPda = pda(Buffer.from('provider'), signalProvider.publicKey.toBuffer());

const errorCode = (e: any) => e?.error?.errorCode?.code ?? String(e?.message ?? e);

async function revealedSignal(seed: number) {
  const fields = { token: 'SOL', direction: 0, entry: 10_000 + seed, tp: 12_000, sl: 9_000, tf: 24, conf: 80 };
  const preimage = `${fields.token}:${fields.direction}:${fields.entry}:${fields.tp}:${fields.sl}:${fields.tf}:${fields.conf}`;
  const hash = [...createHash('sha256').update(preimage).digest()];
  const signalCommit = pda(Buffer.from('signal'), providerPda.toBuffer(), Buffer.from(hash));
  const p = programFor(signalProvider);
  await p.methods.commitSignal(hash)
    .accounts({ signalCommit, provider: providerPda, authority: signalProvider.publicKey, systemProgram: SystemProgram.programId })
    .rpc();
  await p.methods
    .revealSignal(fields.token, fields.direction, new BN(fields.entry), new BN(fields.tp), new BN(fields.sl), fields.tf, fields.conf)
    .accounts({ signalCommit, provider: providerPda, authority: signalProvider.publicKey })
    .rpc();
  return signalCommit;
}

const recordOutcome = (signer: Keypair, signalCommit: PublicKey) =>
  programFor(signer).methods.recordOutcome(1, new BN(12_000), 2_000)
    .accounts({ signalCommit, provider: providerPda, oracleConfig, oracle: signer.publicKey })
    .rpc();

before(async () => {
  for (const kp of [oracle, signalProvider, stranger]) {
    const sig = await provider.connection.requestAirdrop(kp.publicKey, 2 * LAMPORTS_PER_SOL);
    await provider.connection.confirmTransaction(sig, 'confirmed');
  }
  await programFor(signalProvider).methods
    .registerProvider('test-provider', 'https://example.invalid', Buffer.from([1]), new BN(0))
    .accounts({ provider: providerPda, authority: signalProvider.publicKey, systemProgram: SystemProgram.programId })
    .rpc();
});

test('only the upgrade authority can create the oracle config', async () => {
  await assert.rejects(
    programFor(stranger).methods.initializeOracleConfig(stranger.publicKey)
      .accounts({ oracleConfig, authority: stranger.publicKey, program: pid, programData, systemProgram: SystemProgram.programId })
      .rpc(),
    (e: any) => errorCode(e) === 'UnauthorizedOracle',
  );
  await program.methods.initializeOracleConfig(oracle.publicKey)
    .accounts({ oracleConfig, authority: admin.publicKey, program: pid, programData, systemProgram: SystemProgram.programId })
    .rpc();
  const cfg = await program.account.oracleConfig.fetch(oracleConfig);
  assert.equal(cfg.oracle.toBase58(), oracle.publicKey.toBase58());
});

test('record_outcome rejects signers other than the configured oracle', async () => {
  const signalCommit = await revealedSignal(1);
  for (const signer of [stranger, signalProvider]) {
    await assert.rejects(recordOutcome(signer, signalCommit), (e: any) => errorCode(e) === 'UnauthorizedOracle');
  }
  const p = await program.account.provider.fetch(providerPda);
  assert.equal(p.totalSignals.toNumber(), 0);
  assert.equal((await program.account.signalCommit.fetch(signalCommit)).outcomeRecorded, false);
});

test('the configured oracle records the outcome and updates reputation', async () => {
  const signalCommit = await revealedSignal(2);
  await recordOutcome(oracle, signalCommit);
  const p = await program.account.provider.fetch(providerPda);
  assert.equal(p.totalSignals.toNumber(), 1);
  assert.equal(p.correctSignals.toNumber(), 1);
});

test('set_oracle rotates the key and is restricted to the config authority', async () => {
  const next = Keypair.generate();
  await assert.rejects(
    programFor(stranger).methods.setOracle(stranger.publicKey)
      .accounts({ oracleConfig, authority: stranger.publicKey }).rpc(),
    (e: any) => errorCode(e) === 'UnauthorizedOracle',
  );
  await program.methods.setOracle(next.publicKey).accounts({ oracleConfig, authority: admin.publicKey }).rpc();
  const signalCommit = await revealedSignal(3);
  await assert.rejects(recordOutcome(oracle, signalCommit), (e: any) => errorCode(e) === 'UnauthorizedOracle');
});
