import { useEffect, useState } from 'react';
import { Platform, Pressable, ScrollView, Text } from 'react-native';
import { Stack } from 'expo-router';
import { ReadingSaveNotice } from '@/components/reading-save-notice';
import { createReadingSaveUIProbe } from '@/diagnostics/reading-save-ui-probe';

export default function ReadingSaveUIDiagnosticsScreen() {
  const [probe, setProbe] = useState<Awaited<ReturnType<typeof createReadingSaveUIProbe>>>();
  const [status, setStatus] = useState('Preparing an isolated SQLite save failure…');
  const enabled = __DEV__ && Platform.OS !== 'web';
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    let instance: Awaited<ReturnType<typeof createReadingSaveUIProbe>> | undefined;
    createReadingSaveUIProbe().then((value) => {
      instance = value;
      if (active) { setProbe(value); setStatus('Simulated SQLite failure is active'); }
      else void value.dispose();
    }).catch((cause) => { if (active) setStatus(cause instanceof Error ? cause.message : 'Diagnostic failed'); });
    return () => { active = false; void instance?.dispose(); };
  }, [enabled]);
  return <ScrollView contentContainerStyle={{ padding: 24, gap: 16 }}>
    <Stack.Screen options={{ headerShown: true, title: 'Save warning development diagnostics' }} />
    <Text selectable>{enabled ? status : 'Native development build required'}</Text>
    {probe ? <>
      <ReadingSaveNotice source={probe.source} id={probe.id} />
      <Pressable accessibilityRole="button" accessibilityLabel="Remove simulated SQLite failure" style={{ minHeight: 48, padding: 16 }}
        onPress={() => { void probe.unblock().then(() => setStatus('Simulated SQLite failure removed')).catch(() => setStatus('Could not remove failure')); }}>
        <Text>Remove simulated SQLite failure</Text>
      </Pressable>
    </> : null}
  </ScrollView>;
}
