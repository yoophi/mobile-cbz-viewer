import { useEffect, useState } from 'react';
import { Platform, ScrollView, Text } from 'react-native';
import { Stack } from 'expo-router';

import { runZipProbe, type ZipProbeResult } from '@/diagnostics/zip-probe';

export default function ZipDiagnosticsScreen() {
  const [result, setResult] = useState<ZipProbeResult>();
  const [error, setError] = useState<string>();
  const enabled = __DEV__ && Platform.OS !== 'web';
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    runZipProbe().then((value) => { if (active) setResult(value); })
      .catch(() => { if (active) setError('ZIP diagnostic failed'); });
    return () => { active = false; };
  }, [enabled]);
  return (
    <ScrollView contentContainerStyle={{ padding: 24, gap: 16 }}>
      <Stack.Screen options={{ headerShown: true, title: 'ZIP development diagnostics' }} />
      <Text selectable>{!enabled ? 'Native development build required' : error ?? (result ?
        JSON.stringify(result, null, 2) : 'Running native ZIP checks…')}</Text>
    </ScrollView>
  );
}
