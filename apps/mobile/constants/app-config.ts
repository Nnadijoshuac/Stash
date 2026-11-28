import { clusterApiUrl } from '@solana/web3.js'
import { SolanaCluster } from '@wallet-ui/react-native-web3js'

export class AppConfig {
  // Shown by the wallet when it asks you to connect or sign.
  static identity = { name: 'Stash', uri: 'https://stash-drab-gamma.vercel.app', icon: 'brand/stash-splat-192.png' }
  // Devnet only. The program is deployed there; stock swaps need mainnet.
  static network: SolanaCluster = { id: 'solana:devnet', label: 'Devnet', url: clusterApiUrl('devnet') }
}
