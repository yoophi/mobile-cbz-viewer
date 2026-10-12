import { useCallback, useEffect, useRef, useState } from 'react';
import { router, useFocusEffect } from 'expo-router';
import { ActivityIndicator, Alert, FlatList, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as DocumentPicker from 'expo-document-picker';
import { ComicCover } from '@/components/comic-cover';
import { ReadingSaveNotice } from '@/components/reading-save-notice';

import { importComic, deleteComic, DuplicateComicError, listComics, prepareComic, type Comic } from '@/services/library';

export default function LibraryScreen() {
  const [comics, setComics] = useState<Comic[]>([]);
  const [busy, setBusy] = useState(Platform.OS !== 'web');
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [processing, setProcessing] = useState(false);
  const controller = useRef<AbortController | undefined>(undefined);
  const operation = useRef<'loading' | 'work' | undefined>(Platform.OS !== 'web' ? 'loading' : undefined);
  const supported = Platform.OS !== 'web';

  useFocusEffect(useCallback(() => {
    let active = true;
    if (!supported || operation.current === 'work') return;
    operation.current = 'loading'; setBusy(true);
    listComics().then((items) => { if (active) setComics(items); })
      .catch(() => { if (active) setError('라이브러리를 불러오지 못했습니다. 앱을 다시 실행해 주세요.'); })
      .finally(() => { if (active && operation.current === 'loading') { operation.current = undefined; setBusy(false); } });
    return () => { active = false; };
  }, [supported]));

  useEffect(() => () => { controller.current?.abort(); }, []);

  async function extractComic(id: number) {
    controller.current = new AbortController();
    setProcessing(true);
    try { await prepareComic(id, controller.current.signal); }
    finally { controller.current = undefined; setProcessing(false); }
  }

  async function retryComic(id: number) {
    if (operation.current) return;
    operation.current = 'work';
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try { await extractComic(id); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '추출에 실패했습니다.'); }
    finally {
      try { setComics(await listComics()); } catch { setError('서재 상태를 불러오지 못했습니다. 다시 실행해 주세요.'); }
      setBusy(false);
      operation.current = undefined;
    }
  }

  async function pickComic(restoreId?: number) {
    if (operation.current) return;
    operation.current = 'work';
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      // CBZ MIME registration varies between file providers; validate the extension after selection.
      const result = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
      if (!result.canceled) {
        const comic = await importComic(result.assets[0], restoreId);
        await extractComic(comic.id);
      }
    } catch (cause) {
      if (cause instanceof DuplicateComicError) setNotice(`같은 내용의 파일이 이미 서재에 있습니다: ${cause.comic.name}`);
      else setError(cause instanceof Error ? cause.message : '파일을 가져오지 못했습니다. 다시 시도해 주세요.');
    } finally {
      try { setComics(await listComics()); } catch { setError('서재 상태를 불러오지 못했습니다. 다시 실행해 주세요.'); }
      setBusy(false);
      operation.current = undefined;
    }
  }

  async function removeComic(id: number) {
    if (operation.current) return;
    operation.current = 'work'; setBusy(true); setError(undefined); setNotice(undefined);
    try { await deleteComic(id); setNotice('만화와 관련 파일을 삭제했습니다.'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '삭제하지 못했습니다. 다시 시도해 주세요.'); }
    finally {
      try { setComics(await listComics()); } catch { setError('서재 상태를 불러오지 못했습니다. 다시 실행해 주세요.'); }
      setBusy(false); operation.current = undefined;
    }
  }
  function confirmDelete(comic: Comic) {
    Alert.alert('만화를 삭제할까요?', `${comic.name}\n앱에 보관한 원본, 표지, 추출 파일과 읽던 위치가 삭제됩니다. 파일 선택기의 원본은 유지됩니다.`, [
      { text: '취소', style: 'cancel' }, { text: '삭제', style: 'destructive', onPress: () => { void removeComic(comic.id); } },
    ]);
  }

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.content}>
        <Text style={styles.eyebrow}>MOBILE CBZ VIEWER</Text>
        <Text style={styles.title}>나의 만화 서재</Text>
        <ReadingSaveNotice />
        <Text style={styles.description}>아이폰 · 아이패드 · 안드로이드를 위한 오프라인 만화 리더 프로젝트</Text>
        <Pressable accessibilityRole="button" accessibilityState={{ disabled: busy || !supported }}
          disabled={busy || !supported} onPress={() => { void pickComic(); }}
          style={[styles.button, (busy || !supported) && styles.disabled]}>
          <Text style={styles.buttonText}>{busy ? '불러오는 중…' : 'CBZ 파일 가져오기'}</Text>
        </Pressable>
        {busy ? <ActivityIndicator color="#9abfff" style={styles.loader} /> : null}
        {processing ? <Pressable accessibilityRole="button" onPress={() => controller.current?.abort()} style={styles.cancel}>
          <Text style={styles.filename}>추출 취소 · 원본 보관</Text>
        </Pressable> : null}
        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
        {notice ? <Text accessibilityRole="alert" style={styles.notice}>{notice}</Text> : null}
        <Text style={styles.notice}>{supported
          ? 'CBZ의 구조와 이미지 데이터를 확인한 뒤 안전하게 압축을 풉니다. 준비된 만화를 눌러 열람하세요.'
          : '웹은 화면 미리보기용입니다. 파일 가져오기는 iOS·Android 개발 빌드에서 사용할 수 있습니다.'}</Text>
        <Text style={styles.section}>보관한 파일 · {comics.length}</Text>
        <FlatList data={comics} keyExtractor={(item) => String(item.id)}
          contentContainerStyle={styles.list}
          ListEmptyComponent={!busy ? <Text style={styles.empty}>아직 보관한 만화가 없습니다.</Text> : null}
          renderItem={({ item }) => (
            <View style={styles.card}>
              <ComicCover uri={item.coverUri} name={item.name} />
              <Text style={styles.filename}>{item.name}</Text>
              <Text style={styles.metadata}>{(item.size / 1024 / 1024).toFixed(1)} MB · {item.status === 'ready'
                ? `열람 준비됨 · ${item.pageCount} 페이지` : item.status === 'extracting' ? '검증·추출 중' : item.status === 'deleting' ? '삭제 정리 대기 중' : '원본 보관됨'}</Text>
              {item.readingIndex != null ? <Text style={styles.metadata}>읽던 위치 · {item.readingIndex + 1} 페이지 · {item.readingMode === 'scroll' ? '세로 스크롤' : '페이지'}</Text> : null}
              {item.error ? <Text accessibilityRole="alert" style={styles.error}>{item.error}</Text> : null}
              {item.coverError ? <Text style={styles.metadata}>{item.coverError}</Text> : null}
              {item.status === 'ready' ? <Pressable accessibilityRole="button" accessibilityLabel={`${item.name} 열기`}
                disabled={busy} accessibilityState={{ disabled: busy }}
                onPress={() => router.push({ pathname: '/reader/[id]', params: { id: String(item.id) } })}
                style={[styles.retry, busy && styles.disabled]}><Text style={styles.buttonText}>만화 열기</Text></Pressable> : null}
              {item.sourceMissing && item.status !== 'deleting' ? <Pressable accessibilityRole="button" accessibilityLabel={`${item.name} 원본 다시 가져오기`}
                disabled={busy} accessibilityState={{ disabled: busy }} onPress={() => { void pickComic(item.id); }}
                style={[styles.retry, busy && styles.disabled]}><Text style={styles.buttonText}>원본 다시 가져오기</Text></Pressable> : null}
              {!item.sourceMissing && item.status !== 'ready' && item.status !== 'deleting' ? <Pressable accessibilityRole="button" accessibilityLabel={`${item.name} 검증 및 추출`}
                disabled={busy} accessibilityState={{ disabled: busy }} onPress={() => retryComic(item.id)}
                style={[styles.retry, busy && styles.disabled]}><Text style={styles.buttonText}>검증·추출 다시 시도</Text></Pressable> : null}
              <Pressable accessibilityRole="button" accessibilityLabel={`${item.name} 삭제`}
                accessibilityState={{ disabled: busy }} disabled={busy} onPress={() => confirmDelete(item)}
                style={[styles.cancel, busy && styles.disabled]}><Text style={styles.error}>{item.status === 'deleting' ? '삭제 다시 시도' : '만화 삭제'}</Text></Pressable>
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
  cancel: { padding: 14, alignItems: 'center', minHeight: 48 },
  retry: { padding: 12, minHeight: 48, alignItems: 'center', backgroundColor: '#9abfff', borderRadius: 10, marginTop: 12 },
  error: { color: '#ffb4b4', marginTop: 16, lineHeight: 22 },
  notice: { color: '#a9b5c7', fontSize: 13, lineHeight: 22, marginTop: 16, marginBottom: 28 },
  section: { color: '#f4f7fc', fontSize: 18, fontWeight: '600', marginBottom: 16 },
  list: { paddingBottom: 24, gap: 12 },
  empty: { color: '#a9b5c7', paddingVertical: 32, textAlign: 'center' },
  card: { backgroundColor: '#1c2738', borderRadius: 14, padding: 18 },
  filename: { color: '#f4f7fc', fontSize: 16, lineHeight: 24 },
  metadata: { color: '#a9b5c7', fontSize: 13, marginTop: 6 },
});
