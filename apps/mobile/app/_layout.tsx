import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import * as SplashScreen from 'expo-splash-screen'
import { useFonts, Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold } from '@expo-google-fonts/inter'
import { useEffect } from 'react'
import 'react-native-reanimated'
import { AppProviders } from '@/components/app-providers'

void SplashScreen.preventAutoHideAsync()

export default function RootLayout() {
  const [loaded] = useFonts({ Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold })
  useEffect(() => {
    if (loaded) void SplashScreen.hideAsync()
  }, [loaded])
  if (!loaded) return null
  return (
    <AppProviders>
      <Stack>
        <Stack.Screen name="index" options={{ headerShown: false }} />
      </Stack>
      <StatusBar style="light" />
    </AppProviders>
  )
}
