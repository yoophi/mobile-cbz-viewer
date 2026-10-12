import { useEffect, useState } from 'react';
import { Platform, ScrollView, Text } from 'react-native';
import { Stack } from 'expo-router';

import { runLibraryProbe } from '@/diagnostics/library-probe';

let running: ReturnType<typeof runLibraryProbe> | undefined;
export default function LibraryDiagnosticsScreen() {
  const [result, setResult] = useState<string>('Running isolated library checks…');
  const enabled = __DEV__ && Platform.OS !== 'web';
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    running ??= runLibraryProbe().finally(() => { running = undefined; });
    running.then((value) => { if (active) setResult(JSON.stringify(value, null, 2)); })
      .catch((error) => { if (active) setResult(error instanceof Error ? error.message : 'Library diagnostic failed'); });
    return () => { active = false; };
  }, [enabled]);
  return (
    <ScrollView contentContainerStyle={{ padding: 24 }}>
      <Stack.Screen options={{ headerShown: true, title: 'Library development diagnostics' }} />
      <Text selectable>{enabled ? result : 'Native development build required'}</Text>
    </ScrollView>
  );
}
