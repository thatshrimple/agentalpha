# AgentAlpha Quickstart

Get AgentAlpha running in 5 minutes.

## Prerequisites

- Node.js 18+
- npm
- (For consumer) A wallet with testnet USDC on Base Sepolia

## Installation

```bash
git clone https://github.com/agentalpha/agentalpha
cd agentalpha
npm install
```

## Quick Demo

### 1. Start the Registry API

```bash
npm run registry
```

This starts the discovery service on `http://localhost:4020`.

### 2. Start a Signal Provider

In a new terminal:

```bash
# Set your wallet address to receive payments
export PAY_TO=0xYourWalletAddress

npm run provider
```

This starts a demo sentiment signal provider on `http://localhost:4021`.

### 3. Test the Provider

```bash
# Free endpoints
curl http://localhost:4021/health
curl http://localhost:4021/info

# Paid endpoint (will return 402 without payment)
curl http://localhost:4021/signal/latest
```

### 4. Run a Signal Consumer

In a new terminal:

```bash
# Set your private key (needs testnet USDC on Base Sepolia)
export EVM_PRIVATE_KEY=your_private_key_without_0x

npm run consumer
```

The consumer will:
1. Connect to the provider
2. Pay via x402 micropayments
3. Receive and process signals

## Configuration

Copy `.env.example` to `.env` and customize:

```bash
cp .env.example .env
```

Key variables:

| Variable | Description | Default |
|----------|-------------|---------|
| `REGISTRY_PORT` | Registry API port | 4020 |
| `PORT` | Provider port | 4021 |
| `PAY_TO` | Wallet to receive payments | Required |
| `PRICE_PER_SIGNAL` | Price per signal | $0.001 |
| `NETWORK` | Payment network (CAIP-2) | eip155:84532 |
| `EVM_PRIVATE_KEY` | Consumer wallet key | Required for consumer |

## Getting Testnet Funds

1. Get Base Sepolia ETH from a faucet
2. Bridge or get testnet USDC on Base Sepolia
3. Fund your consumer wallet

## Next Steps

- [Building a Custom Provider](./PROVIDER_GUIDE.md)
- [Consumer Integration](./CONSUMER_GUIDE.md)
- [Reputation System](./REPUTATION.md)
