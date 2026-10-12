import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { NavigationBar } from 'expo-navigation-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useReducedMotion } from '@/hooks/use-reduced-motion';

export default function RootLayout() {
  const reducedMotion = useReducedMotion();
  return (
    <GestureHandlerRootView style={{ flex: 1 }}><SafeAreaProvider>
      <StatusBar style="light" />
      <NavigationBar hidden={false} style="light" />
      <Stack screenOptions={{ headerShown: false, animation: reducedMotion ? 'none' : 'default' }} />
    </SafeAreaProvider></GestureHandlerRootView>
  );
}
