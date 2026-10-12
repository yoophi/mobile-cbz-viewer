import { useEffect, useState } from 'react';
import { Platform, ScrollView, Text } from 'react-native';
import { Stack } from 'expo-router';
import { runScrollCacheProbe } from '@/diagnostics/scroll-cache-probe';

let running: ReturnType<typeof runScrollCacheProbe> | undefined;
export default function ScrollCacheDiagnosticsScreen() {
  const [result, setResult] = useState('Running isolated scroll cache checks…');
  const enabled = __DEV__ && Platform.OS !== 'web';
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    running ??= runScrollCacheProbe().finally(() => { running = undefined; });
    running.then((value) => { if (active) setResult(JSON.stringify(value, null, 2)); })
      .catch((cause) => { if (active) setResult(cause instanceof Error ? cause.message : 'Scroll cache diagnostic failed'); });
    return () => { active = false; };
  }, [enabled]);
  return <ScrollView contentContainerStyle={{ padding: 24 }}>
    <Stack.Screen options={{ headerShown: true, title: 'Scroll cache development diagnostics' }} />
    <Text selectable>{enabled ? result : 'Native development build required'}</Text>
  </ScrollView>;
}
