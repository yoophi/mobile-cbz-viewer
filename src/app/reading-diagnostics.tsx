import { useEffect, useState } from 'react';
import { Platform, ScrollView, Text } from 'react-native';
import { Stack } from 'expo-router';
import { runReadingProbe } from '@/diagnostics/reading-probe';

let running: ReturnType<typeof runReadingProbe> | undefined;
export default function ReadingDiagnosticsScreen() {
  const [result, setResult] = useState('Running isolated reading-state checks…');
  const enabled = __DEV__ && Platform.OS !== 'web';
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    running ??= runReadingProbe().finally(() => { running = undefined; });
    running.then((value) => { if (active) setResult(JSON.stringify(value, null, 2)); })
      .catch((cause) => { if (active) setResult(cause instanceof Error ? cause.message : 'Reading-state diagnostic failed'); });
    return () => { active = false; };
  }, [enabled]);
  return <ScrollView contentContainerStyle={{ padding: 24 }}>
    <Stack.Screen options={{ headerShown: true, title: 'Reading-state development diagnostics' }} />
    <Text selectable>{enabled ? result : 'Native development build required'}</Text>
  </ScrollView>;
}
