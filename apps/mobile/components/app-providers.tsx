import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PropsWithChildren } from 'react'
import { MobileWalletProvider } from '@wallet-ui/react-native-web3js'
import { AppConfig } from '@/constants/app-config'

const queryClient = new QueryClient()

export function AppProviders({ children }: PropsWithChildren) {
  return (
    <QueryClientProvider client={queryClient}>
      <MobileWalletProvider chain={AppConfig.network.id} endpoint={AppConfig.network.url} identity={AppConfig.identity}>
        {children}
      </MobileWalletProvider>
    </QueryClientProvider>
  )
}
