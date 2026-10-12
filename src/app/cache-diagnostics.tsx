import { useEffect, useState } from 'react';
import { Platform, ScrollView, Text } from 'react-native';
import { Stack } from 'expo-router';
import { runCacheProbe } from '@/diagnostics/cache-probe';

let running: ReturnType<typeof runCacheProbe> | undefined;
export default function CacheDiagnosticsScreen() {
  const [result, setResult] = useState('Running isolated cache checks…');
  const enabled = __DEV__ && Platform.OS !== 'web';
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    running ??= runCacheProbe().finally(() => { running = undefined; });
    running.then((value) => { if (active) setResult(JSON.stringify(value, null, 2)); })
      .catch((cause) => { if (active) setResult(cause instanceof Error ? cause.message : 'Cache diagnostic failed'); });
    return () => { active = false; };
  }, [enabled]);
  return <ScrollView contentContainerStyle={{ padding: 24 }}>
    <Stack.Screen options={{ headerShown: true, title: 'Cache development diagnostics' }} />
    <Text selectable>{enabled ? result : 'Native development build required'}</Text>
  </ScrollView>;
}
