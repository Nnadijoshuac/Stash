# Stash for Android

The phone version of Stash, on Solana devnet. Connect a wallet through Mobile Wallet Adapter, set
your rule on chain, and get a notification when a USDC payment lands. One tap stashes the slice.

Started from the official Solana Mobile template `expo-web3js-minimal`
([solana-mobile/templates](https://github.com/solana-mobile/templates), commit `fd9c8e5`).

## What it does on devnet

| Step | On chain |
| :--- | :--- |
| Connect | Mobile Wallet Adapter (any MWA wallet, or the Fake Wallet on an emulator) |
| Save rule | `set_rule` on the Stash program, signed by your wallet |
| Payment lands | Read from the chain every 15 seconds; a phone notification shows the slice |
| Stash | One transaction: move the slice into a second USDC account your wallet owns, and `record_stash` writes the receipt. Stashing the same payment twice fails on chain. |
| Move back | A plain token transfer from that account to your wallet |

Devnet has no tokenized stocks and no Jupiter, so the phone can't buy SPYx there. The web app does
the real swaps against a mainnet fork; see the main README.

## Try it

1. Install the APK on an Android phone or emulator that has an MWA wallet. On an emulator, the
   [Fake Wallet](https://github.com/solana-mobile/mobile-wallet-adapter/tree/main/android/fakewallet)
   works.
2. Get devnet SOL for fees (faucet.solana.com) and devnet USDC (faucet.circle.com, Solana devnet).
3. Open Stash, connect, save a rule, then send yourself some devnet USDC from another wallet.

## Build

Needs Node 20+, JDK 17 and the Android SDK (`ANDROID_HOME`).

```bash
npm install
npx expo prebuild -p android
cd android && ./gradlew assembleRelease
# APK: android/app/build/outputs/apk/release/app-release.apk
```

For development: `npm run android` with a device or emulator attached.
