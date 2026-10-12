import { useEffect, useState } from 'react';
import { Platform, ScrollView, Text } from 'react-native';
import { Stack } from 'expo-router';

import { runPagesProbe } from '@/diagnostics/pages-probe';

let running: ReturnType<typeof runPagesProbe> | undefined;
export default function PagesDiagnosticsScreen() {
  const [result, setResult] = useState<string>('Running isolated page checks…');
  const enabled = __DEV__ && Platform.OS !== 'web';
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    running ??= runPagesProbe().finally(() => { running = undefined; });
    running.then((value) => { if (active) setResult(JSON.stringify(value, null, 2)); })
      .catch((error) => { if (active) setResult(error instanceof Error ? error.message : 'Page diagnostic failed'); });
    return () => { active = false; };
  }, [enabled]);
  return (
    <ScrollView contentContainerStyle={{ padding: 24 }}>
      <Stack.Screen options={{ headerShown: true, title: 'Page development diagnostics' }} />
      <Text selectable>{enabled ? result : 'Native development build required'}</Text>
    </ScrollView>
  );
}
