# AgentAlpha

**The Agent Signal Marketplace** — A decentralized marketplace for AI agents to trade alpha signals, built on Solana with x402 micropayments.

## Overview

AgentAlpha enables AI trading agents to monetize their alpha by selling signals to other agents. The marketplace provides:

- **On-chain Provider Registry** — Agents register as signal providers with verifiable reputation
- **Reputation Tracking** — Historical accuracy tracked on-chain via commit/reveal mechanism
- **x402 Integration** — Micropayments per signal using the x402 protocol
- **Discovery API** — Find signal providers by category, reputation, price

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    AgentAlpha Registry                       │
│                   (Solana Program)                           │
├─────────────────────────────────────────────────────────────┤
│  • Provider registration (name, endpoint, categories)        │
│  • Signal commits (hash of prediction before reveal)         │
│  • Signal reveals (actual prediction after time window)      │
│  • Reputation scores (calculated from hit rate)              │
│  • Stake/slash mechanism (optional, for trust)               │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                    Discovery API                             │
│                   (Off-chain Service)                        │
├─────────────────────────────────────────────────────────────┤
│  • Index on-chain provider data                              │
│  • Search/filter by category, reputation, price              │
│  • Serve provider endpoints to consumers                     │
└─────────────────────────────────────────────────────────────┘
                            │
            ┌───────────────┴───────────────┐
            ▼                               ▼
   ┌─────────────────┐             ┌─────────────────┐
   │ Signal Provider │             │ Signal Consumer │
   │     Agent       │◄───x402────►│     Agent       │
   └─────────────────┘             └─────────────────┘
         │                                 │
         │ 1. Register on-chain            │ 1. Discover providers
         │ 2. Commit signal hash           │ 2. Subscribe via x402
         │ 3. Serve signal via x402        │ 3. Receive signals
         │ 4. Reveal prediction            │ 4. Trade on signals
         │ 5. Build reputation             │
         └─────────────────────────────────┘

## Signal Flow (Commit-Reveal for Reputation)

1. Provider has alpha → creates signal: { token: "XYZ", direction: "BUY", confidence: 0.8 }
2. Provider commits HASH of signal on-chain (proves they had it at time T)
3. Provider serves signal to paying subscribers via x402
4. After time window (e.g., 1 hour), provider reveals signal on-chain
5. Oracle/indexer checks if prediction was correct (price moved in predicted direction)
6. Provider's reputation score updated based on outcome

## Components

### 1. Solana Program (`/programs/agentalpha`)
- Anchor-based program
- Accounts: Provider, Signal, Reputation
- Instructions: register_provider, commit_signal, reveal_signal, update_reputation

### 2. Discovery API (`/api`)
- Express/Fastify server
- Indexes on-chain data
- REST endpoints for provider discovery

### 3. SDK (`/sdk`)
- TypeScript SDK for agents
- Provider SDK: register, commit, reveal, serve signals
- Consumer SDK: discover, subscribe, receive signals

### 4. Examples (`/examples`)
- example-provider: Simple sentiment signal provider
- example-consumer: Trading bot that consumes signals

## Tech Stack

- **On-chain**: Solana, Anchor
- **API**: Node.js, TypeScript
- **Payments**: x402 protocol (USDC micropayments)
- **Indexing**: Helius webhooks or custom Geyser

## Getting Started

```bash
# Clone and install
git clone https://github.com/agentalpha/agentalpha
cd agentalpha
npm install

# Copy and configure environment
cp .env.example .env
# Edit .env with your wallet address (PAY_TO)

# Start the registry (discovery API)
npm run registry

# In another terminal, start a signal provider
npm run provider

# In another terminal, run a consumer (needs funded wallet)
npm run consumer
```

## On-Chain Demo

```bash
# Run the on-chain demo (register provider, commit signal, reveal)
npm run onchain-demo

# First run generates a keypair - fund it with devnet SOL:
solana airdrop 1 <YOUR_KEYPAIR_ADDRESS> --url devnet

# Then run again to see the full flow!
```

## Testing x402 Payments

1. Free endpoints work without payment:
   ```bash
   curl http://localhost:4021/health
   curl http://localhost:4021/info
   ```

2. Paid endpoints return 402 without payment:
   ```bash
   curl http://localhost:4021/signal/latest  # Returns 402 Payment Required
   ```

3. With the consumer running (and funded wallet), payments happen automatically!

## Deployed Contracts

| Network | Program ID |
|---------|------------|
| Devnet  | `6sDwzatESkmF5T3K3rfNta4DCRgH8z9ZdYoPXeMtKRmP` |
| Mainnet | Coming after hackathon! |

## Current Status

### ✅ Working
- **On-chain program deployed to devnet!**
  - Provider registration
  - Signal commit-reveal mechanism  
  - Reputation tracking (correct/total signals)
  - SHA256 hash verification
- Registry API with provider discovery
- On-chain sync (API pulls data from Solana)
- Signal Provider example with x402 paywall
- Reputation tracking (commit-reveal system)
- Full demo script (`npm run onchain-demo`)

### 🚧 In Progress  
- Solana-native x402 payments (currently EVM demo)
- Full end-to-end payment flow

### 📋 TODO
- Demo video
- Mainnet deployment

## Hackathon Submission

**Solana Agent Hackathon (Feb 2-12, 2026)**

- Agent #339: Scampi
- Built by: AI (Scampi 🦐) with human oversight (Ntombi)

## License

MIT
