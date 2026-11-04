# Trying a paid request on testnet

Before charging real money, run your config on Base Sepolia, Base's testnet, and pay for one page with test USDC:

```sh
FAIRTOLL_TESTNET_KEY=0x... npx fairtoll testnet config.json
```

`config.json` holds the same config you pass to `fairtoll()`. The command finds a path the config charges, asks for it as a paying AI agent, pays the price from your test wallet, and prints each step as it happens:

```
✓ 402 received: $0.002 in USDC to 0x...
✓ payment sent: signed a transfer of 2000 millionths of a USDC from 0x...
✓ payment verified by the facilitator
✓ settled in 2.4 seconds: https://sepolia.basescan.org/tx/0x...
✓ page served: Fairtoll passed the paid request on to the site
```

The payment goes to the config's `payTo` address on Base Sepolia, through x402.org's facilitator, which only settles on testnets. When a step fails, the command names the step and the reason, such as a wallet with too little test USDC, and exits with status 1.

## It can't spend real money

The run always charges on Base Sepolia, even when the config's `network` is `"base"`, and the test wallet only signs payments on Base Sepolia. So the key can't move funds on Base mainnet. Fairtoll reads the key from `FAIRTOLL_TESTNET_KEY` for the run and never stores it. Use a wallet made for testing anyway, never one that holds real funds.

## Getting a test wallet and test USDC

1. Make a new wallet. Any wallet app that can export a private key works, or Fairtoll's own dependencies can make one:

   ```sh
   node --input-type=module -e "import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'; const key = generatePrivateKey(); console.log(key, privateKeyToAccount(key).address)"
   ```

   That prints the private key, for `FAIRTOLL_TESTNET_KEY`, and the wallet's address.

2. Get test USDC at [faucet.circle.com](https://faucet.circle.com). Choose Base Sepolia and paste the wallet's address.

The wallet needs no test ETH, because the facilitator pays the transaction fee.
