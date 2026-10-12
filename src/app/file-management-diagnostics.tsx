import { useEffect, useState } from 'react';
import { Platform, ScrollView, Text } from 'react-native';
import { runFileManagementProbe } from '@/diagnostics/file-management-probe';
let running: ReturnType<typeof runFileManagementProbe> | undefined;
export default function FileManagementDiagnostics() {
  const [result, setResult] = useState('Running isolated file management checks…');
  useEffect(() => {
    if (!__DEV__ || Platform.OS === 'web') return;
    let active = true;
    running ??= runFileManagementProbe().finally(() => { running = undefined; });
    running.then((value) => { if (active) setResult(JSON.stringify(value, null, 2)); })
      .catch((error) => { if (active) setResult(String(error)); });
    return () => { active = false; };
  }, []);
  return <ScrollView contentContainerStyle={{ padding: 24 }}><Text selectable>{__DEV__ ? result : 'Native development build required'}</Text></ScrollView>;
}
