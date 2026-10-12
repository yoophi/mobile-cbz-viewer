import { useEffect, useState } from 'react';
import { Platform, ScrollView, Text } from 'react-native';
import { Stack } from 'expo-router';
import { runDimensionsProbe } from '@/diagnostics/dimensions-probe';

let running: ReturnType<typeof runDimensionsProbe> | undefined;
export default function DimensionsDiagnosticsScreen() {
  const [result, setResult] = useState('Running isolated dimension checks…');
  const enabled = __DEV__ && Platform.OS !== 'web';
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    running ??= runDimensionsProbe().finally(() => { running = undefined; });
    running.then((value) => { if (active) setResult(JSON.stringify(value, null, 2)); })
      .catch((cause) => { if (active) setResult(cause instanceof Error ? cause.message : 'Dimension diagnostic failed'); });
    return () => { active = false; };
  }, [enabled]);
  return <ScrollView contentContainerStyle={{ padding: 24 }}>
    <Stack.Screen options={{ headerShown: true, title: 'Dimension development diagnostics' }} />
    <Text selectable>{enabled ? result : 'Native development build required'}</Text>
  </ScrollView>;
}
