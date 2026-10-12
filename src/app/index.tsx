import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as DocumentPicker from 'expo-document-picker';

import { importComic, listComics, type Comic } from '@/services/library';

export default function LibraryScreen() {
  const [comics, setComics] = useState<Comic[]>([]);
  const [busy, setBusy] = useState(Platform.OS !== 'web');
  const [error, setError] = useState<string>();
  const supported = Platform.OS !== 'web';

  useEffect(() => {
    let active = true;
    if (!supported) return;
    listComics().then((items) => { if (active) setComics(items); })
      .catch(() => { if (active) setError('라이브러리를 불러오지 못했습니다. 앱을 다시 실행해 주세요.'); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [supported]);

  async function pickComic() {
    setBusy(true);
    setError(undefined);
    try {
      // CBZ MIME registration varies between file providers; validate the extension after selection.
      const result = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
      if (!result.canceled) {
        await importComic(result.assets[0]);
        setComics(await listComics());
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '파일을 가져오지 못했습니다. 다시 시도해 주세요.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.content}>
        <Text style={styles.eyebrow}>MOBILE CBZ VIEWER</Text>
        <Text style={styles.title}>나의 만화 서재</Text>
        <Text style={styles.description}>아이폰 · 아이패드 · 안드로이드를 위한 오프라인 만화 리더 프로젝트</Text>
        <Pressable accessibilityRole="button" accessibilityState={{ disabled: busy || !supported }}
          disabled={busy || !supported} onPress={pickComic}
          style={[styles.button, (busy || !supported) && styles.disabled]}>
          <Text style={styles.buttonText}>{busy ? '불러오는 중…' : 'CBZ 파일 가져오기'}</Text>
        </Pressable>
        {busy ? <ActivityIndicator color="#9abfff" style={styles.loader} /> : null}
        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
        <Text style={styles.notice}>{supported
          ? '현재는 파일 가져오기와 서재 저장을 지원합니다. 압축 해제와 만화 열람 기능은 개발 예정입니다.'
          : '웹은 화면 미리보기용입니다. 파일 가져오기는 iOS·Android 개발 빌드에서 사용할 수 있습니다.'}</Text>
        <Text style={styles.section}>보관한 파일 · {comics.length}</Text>
        <FlatList data={comics} keyExtractor={(item) => String(item.id)}
          contentContainerStyle={styles.list}
          ListEmptyComponent={!busy ? <Text style={styles.empty}>아직 보관한 만화가 없습니다.</Text> : null}
          renderItem={({ item }) => (
            <View style={styles.card}>
              <Text style={styles.filename}>{item.name}</Text>
              <Text style={styles.metadata}>{(item.size / 1024 / 1024).toFixed(1)} MB · 파일 보관됨</Text>
            </View>
          )} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#101724' },
  content: { flex: 1, width: '100%', maxWidth: 900, alignSelf: 'center', padding: 24 },
  eyebrow: { color: '#9abfff', fontSize: 12, letterSpacing: 2, marginBottom: 12 },
  title: { color: '#f4f7fc', fontSize: 30, fontWeight: '700', marginBottom: 12 },
  description: { color: '#a9b5c7', fontSize: 15, lineHeight: 24, marginBottom: 24 },
  button: { backgroundColor: '#9abfff', borderRadius: 14, padding: 16, minHeight: 48, alignItems: 'center' },
  buttonText: { color: '#101724', fontSize: 16, fontWeight: '700' },
  disabled: { opacity: 0.5 }, loader: { marginTop: 16 },
  error: { color: '#ffb4b4', marginTop: 16, lineHeight: 22 },
  notice: { color: '#a9b5c7', fontSize: 13, lineHeight: 22, marginTop: 16, marginBottom: 28 },
  section: { color: '#f4f7fc', fontSize: 18, fontWeight: '600', marginBottom: 16 },
  list: { paddingBottom: 24, gap: 12 },
  empty: { color: '#a9b5c7', paddingVertical: 32, textAlign: 'center' },
  card: { backgroundColor: '#1c2738', borderRadius: 14, padding: 18 },
  filename: { color: '#f4f7fc', fontSize: 16, lineHeight: 24 },
  metadata: { color: '#a9b5c7', fontSize: 13, marginTop: 6 },
});
