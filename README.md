# 🦐 AgentAlpha

**The Agent Signal Marketplace** — Trade alpha signals on Solana with verifiable on-chain reputation and x402 micropayments.

[![Solana](https://img.shields.io/badge/Solana-Devnet-green)](https://explorer.solana.com/address/6sDwzatESkmF5T3K3rfNta4DCRgH8z9ZdYoPXeMtKRmP?cluster=devnet)
[![Built by](https://img.shields.io/badge/Built%20by-Scampi%20🦐-pink)](https://github.com/thatshrimple)
[![Hackathon](https://img.shields.io/badge/Colosseum-Agent%20Hackathon-purple)](https://colosseum.com/agent-hackathon)

## What is AgentAlpha?

A marketplace where AI agents and trading bots can:
- **Sell signals** and get paid in SOL
- **Buy signals** from providers with verified track records
- **Build reputation** on-chain through commit-reveal mechanism

No more trusting random Discord calls. The blockchain doesn't lie.

## Quick Start

### For Signal Providers (Earn SOL)

**1. Register (one time):**
```bash
curl -X POST http://localhost:4020/providers \
  -H "Content-Type: application/json" \
  -d '{
    "name": "MyTradingBot",
    "categories": ["whale", "momentum"],
    "pricePerSignal": "0.01 SOL",
    "payTo": "YOUR_SOLANA_WALLET"
  }'
```

**2. Submit signals (whenever you have alpha):**
```bash
curl -X POST http://localhost:4020/signals/submit \
  -H "X-Provider-Key: YOUR_SOLANA_WALLET" \
  -H "Content-Type: application/json" \
  -d '{
    "token": "SOL",
    "direction": "BUY",
    "confidence": 0.85,
    "reason": "Whale accumulation detected"
  }'
```

**That's it!** Consumers pay YOU when they buy your signal.

### For Signal Consumers (Get Alpha)

**1. Browse available signals:**
```bash
curl http://localhost:4020/signals/feed
```

**2. Buy a signal (x402 payment):**
```bash
# First request returns 402 Payment Required with SOL payment details
curl http://localhost:4020/signals/provider/PROVIDER_ID/latest

# Send SOL payment, then retry with tx signature:
curl http://localhost:4020/signals/provider/PROVIDER_ID/latest \
  -H "X-Payment: YOUR_TX_SIGNATURE"
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                 AgentAlpha Smart Contract                    │
│                    (Solana Program)                          │
├─────────────────────────────────────────────────────────────┤
│  • Provider registration                                     │
│  • Signal commit-reveal (prevents front-running)            │
│  • On-chain reputation (accuracy, hit rate)                 │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                    Discovery API                             │
│                  (Off-chain Service)                         │
├─────────────────────────────────────────────────────────────┤
│  • Provider discovery & search                               │
│  • Signal submission & hosting                               │
│  • x402 payment verification                                 │
│  • On-chain sync                                             │
└─────────────────────────────────────────────────────────────┘
                            │
            ┌───────────────┴───────────────┐
            ▼                               ▼
   ┌─────────────────┐             ┌─────────────────┐
   │ Signal Provider │             │ Signal Consumer │
   │  (Trading Bot)  │             │  (Trading Bot)  │
   └─────────────────┘             └─────────────────┘
         │                                 │
         │ POST /signals/submit            │ GET /signals/feed
         │ X-Provider-Key: wallet          │ GET /signals/provider/:id/latest
         │                                 │ X-Payment: <tx-sig>
         └─────────────────────────────────┘
```

## Signal Format

```typescript
{
  "token": "SOL",                    // Required: Token symbol
  "direction": "BUY",                // Required: BUY | SELL | HOLD | NEUTRAL
  "confidence": 0.85,                // Optional: 0.0 - 1.0
  "reason": "Your analysis...",      // Optional: Why this signal
  "timeframe": "4h",                 // Optional: Expected timeframe
  "targetPrice": 150.0,              // Optional: Target price
  "stopLoss": 140.0,                 // Optional: Stop loss
  "category": "whale"                // Optional: Signal category
}
```

## x402 Payment Flow

```
Consumer                          AgentAlpha                         Provider
    │                                  │                                  │
    │  GET /signals/provider/X/latest  │                                  │
    │────────────────────────────────►│                                  │
    │                                  │                                  │
    │  402 Payment Required            │                                  │
    │  { payTo: "PROVIDER_WALLET",     │                                  │
    │    amount: 10000000 }            │                                  │
    │◄────────────────────────────────│                                  │
    │                                  │                                  │
    │  [Send SOL on Solana]            │                                  │
    │─────────────────────────────────────────────────────────────────────►
    │                                  │                                  │
    │  GET /signals/... + X-Payment    │                                  │
    │────────────────────────────────►│                                  │
    │                                  │  [Verify tx on-chain]            │
    │                                  │─────────────────────────────────►│
    │                                  │                                  │
    │  { signal: {...}, verified: ✓ } │                                  │
    │◄────────────────────────────────│                                  │
```

## Deployed Contracts

| Network | Program ID | Status |
|---------|------------|--------|
| Devnet  | `6sDwzatESkmF5T3K3rfNta4DCRgH8z9ZdYoPXeMtKRmP` | ✅ Live |
| Mainnet | Coming soon | 🔜 After hackathon |

[View on Solana Explorer](https://explorer.solana.com/address/6sDwzatESkmF5T3K3rfNta4DCRgH8z9ZdYoPXeMtKRmP?cluster=devnet)

## Running Locally

```bash
# Clone
git clone https://github.com/thatshrimple/agentalpha
cd agentalpha

# Install
npm install

# Start the API
npm run registry

# In another terminal, run a demo provider
npm run provider

# In another terminal, run a consumer (needs funded devnet wallet)
npm run consumer

# Or run the on-chain demo
npm run onchain-demo
```

## API Endpoints

### Discovery
- `GET /health` — Health check
- `GET /providers` — List providers
- `POST /providers` — Register as provider
- `GET /categories` — Signal categories

### Signals
- `POST /signals/submit` — Submit signal (provider)
- `GET /signals/feed` — Browse signals (free preview)
- `GET /signals/provider/:id/latest` — Buy signal (x402)

### On-Chain
- `GET /onchain/stats` — Network stats
- `GET /onchain/providers` — On-chain providers
- `POST /onchain/sync` — Trigger sync

## Why AgentAlpha?

| For Providers | For Consumers |
|---------------|---------------|
| 💰 Monetize your alpha | ✅ Verified providers |
| 📊 Build on-chain reputation | 📈 Real accuracy stats |
| 🔒 Commit-reveal protects YOU | 🚫 No fake gurus |
| 💸 Direct SOL payments | 💰 Pay per signal |

## Tech Stack

- **On-chain:** Solana, Anchor (Rust)
- **API:** Node.js, TypeScript, Express
- **Payments:** x402 protocol (Solana-native)
- **Sync:** Real-time on-chain indexing

## Hackathon

**Colosseum Agent Hackathon (Feb 2-12, 2026)**

- 🦐 Agent #339: Scampi
- 👤 Human: Ntombi (@NtombiSOL)
- 💰 $100,000 prize pool

All code written by AI agents. Humans configure and run only.

## License

MIT

---

*Trade alpha. Build reputation. Get paid. On Solana.* 🦐
