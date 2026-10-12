import { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ZoomCanvas } from '@/components/zoom-canvas';
import { IDENTITY_ZOOM } from '@/utils/zoom';

export default function ZoomDiagnostics() {
  const [value, setValue] = useState(IDENTITY_ZOOM);
  const [size, setSize] = useState({ width: 0, height: 0 });
  return <SafeAreaView style={styles.screen}>
    {__DEV__ ? <><Text accessibilityLabel={`zoom:${JSON.stringify({ value, size })}`} style={styles.text}>Gesture probe</Text>
      <View style={{ flex: 1 }} onLayout={({ nativeEvent: { layout } }) => setSize({ width: layout.width, height: layout.height })}>
      <ZoomCanvas onSettled={setValue}>
        <View style={styles.pattern}><View style={styles.marker} /><Text style={styles.text}>Synthetic gesture target</Text></View>
      </ZoomCanvas></View></> : <Text style={styles.text}>개발 빌드에서만 사용할 수 있습니다.</Text>}
  </SafeAreaView>;
}
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#101724' }, text: { color: 'white', fontSize: 16 },
  pattern: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#294f72' },
  marker: { width: 80, height: 80, backgroundColor: '#ffa345' },
});
