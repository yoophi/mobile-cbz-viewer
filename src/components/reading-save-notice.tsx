import { useState, useSyncExternalStore } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { getReadingSaveFailures, subscribeReadingSaveFailures, retryReadingSaves } from '@/services/library';

export type ReadingSaveChannel = {
  getReadingSaveFailures: typeof getReadingSaveFailures;
  subscribeReadingSaveFailures: typeof subscribeReadingSaveFailures;
  retryReadingSaves: typeof retryReadingSaves;
};
const defaultChannel: ReadingSaveChannel = { getReadingSaveFailures, subscribeReadingSaveFailures, retryReadingSaves };
export function ReadingSaveNotice({ id, source = defaultChannel }: { id?: number; source?: ReadingSaveChannel }) {
  const failures = useSyncExternalStore(source.subscribeReadingSaveFailures, source.getReadingSaveFailures, source.getReadingSaveFailures);
  const [retrying, setRetrying] = useState(false);
  if (!failures.some((failure) => id === undefined || failure.comicId === id)) return null;
  return <View style={styles.notice}>
    <Text accessibilityRole="alert" style={styles.error}>읽던 위치를 저장하지 못했습니다. 앱을 닫기 전에 다시 시도해 주세요.</Text>
    <Pressable accessibilityRole="button" accessibilityState={{ disabled: retrying }} disabled={retrying}
      style={styles.button} onPress={() => {
        setRetrying(true);
        // Failed retry remains visible in the shared notice, including after leaving the reader.
        void source.retryReadingSaves(id).catch(() => {}).finally(() => setRetrying(false));
      }}><Text style={styles.text}>{retrying ? '저장 중…' : '읽던 위치 저장 다시 시도'}</Text></Pressable>
  </View>;
}
const styles = StyleSheet.create({
  notice: { padding: 12, gap: 8, backgroundColor: '#372129' },
  error: { color: '#ffb4b4', textAlign: 'center' },
  text: { color: '#f4f7fc', textAlign: 'center' },
  button: { minHeight: 48, padding: 12, justifyContent: 'center', backgroundColor: '#50333c', borderRadius: 8 },
});
