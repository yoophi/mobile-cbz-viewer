import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { router, useFocusEffect } from 'expo-router';
import { openComic, prepareComic, retainComic, type Comic, type ComicPage } from '@/services/library';
import { pageAfter, physicalPageAction, type ReadingDirection } from '@/utils/reader-navigation';
import { ScrollReader } from './scroll-reader';
import type { ReadingPosition } from '@/utils/scroll-layout';

function ReaderButton({ label, onPress, disabled = false }: { label: string; onPress: () => void; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled}
    onPress={onPress} style={[styles.button, disabled && styles.disabled]}><Text style={styles.text}>{label}</Text></Pressable>;
}

function PageImage({ page, repair }: { page: ComicPage; repair: () => void }) {
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  return <View style={styles.canvas}>
    <Image key={attempt} source={{ uri: page.uri }} style={styles.image} contentFit="contain"
      cachePolicy="none" recyclingKey={`${page.comicId}:${page.position}:${attempt}`} allowDownscaling
      enforceEarlyResizing autoplay={false}
      accessibilityLabel={`${page.position + 1} 페이지`} onLoad={() => setLoading(false)}
      onError={() => { setLoading(false); setFailed(true); }} />
    {loading ? <View style={styles.overlay}><ActivityIndicator color="#9abfff" /><Text style={styles.text}>이미지 불러오는 중…</Text></View> : null}
    {failed ? <View style={styles.overlay}>
      <Text accessibilityRole="alert" style={styles.error}>이미지를 표시하지 못했습니다. 다른 페이지로 이동하거나 원본에서 복구해 주세요.</Text>
      <ReaderButton label="이미지 다시 시도" onPress={() => { setLoading(true); setFailed(false); setAttempt((value) => value + 1); }} />
      <ReaderButton label="원본에서 페이지 복구" onPress={repair} />
    </View> : null}
  </View>;
}

export function ComicReader({ id }: { id?: number }) {
  const [book, setBook] = useState<{ comic: Comic; pages: ComicPage[] }>();
  const [position, setPosition] = useState<ReadingPosition>({ index: 0, fraction: 0 });
  const [navigation, setNavigation] = useState<ReadingPosition>(position);
  const [mode, setMode] = useState<'page' | 'scroll'>('page');
  const index = position.index;
  const [direction, setDirection] = useState<ReadingDirection>('ltr');
  const [request, setRequest] = useState({ version: 0, repair: false });
  const [busy, setBusy] = useState(id !== undefined);
  const [error, setError] = useState<string>();
  const [focused, setFocused] = useState(false);
  const repairedVersion = useRef(-1);

  useFocusEffect(useCallback(() => {
    if (id === undefined) return;
    setFocused(true); setBusy(true); setError(undefined);
    const comicId = id;
    const release = retainComic(comicId);
    const controller = new AbortController();
    let active = true;
    async function load() {
      if (request.repair && repairedVersion.current !== request.version) {
        await prepareComic(comicId, controller.signal);
        repairedVersion.current = request.version;
      }
      return openComic(comicId, controller.signal);
    }
    load().then((result) => {
      if (!active) return;
      setBook(result);
      setPosition((value) => ({ ...value, index: Math.min(value.index, result.pages.length - 1) }));
    }).catch((cause) => {
      if (active) setError(cause instanceof Error ? cause.message : '만화를 열지 못했습니다.');
    }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; controller.abort(); release(); setFocused(false); };
  }, [id, request]));

  function reload(repair: boolean) {
    setBusy(true);
    setError(undefined);
    setRequest((value) => ({ version: value.version + 1, repair }));
  }
  const repair = useCallback(() => {
    setBusy(true); setError(undefined);
    setRequest((value) => ({ version: value.version + 1, repair: true }));
  }, []);
  const scrollPosition = useCallback((value: ReadingPosition) => setPosition(value), []);
  const count = book?.pages.length ?? 0;
  const page = book?.pages[index];
  return <SafeAreaView style={styles.screen}>
    <View style={styles.header}>
      <ReaderButton label="서재로" onPress={() => router.canGoBack() ? router.back() : router.replace('/')} />
      <Text numberOfLines={1} style={styles.title}>{book?.comic.name ?? '만화 열람'}</Text>
    </View>
    {id === undefined ? <Text accessibilityRole="alert" style={styles.error}>올바르지 않은 서재 주소입니다.</Text>
      : !focused ? <View style={styles.canvas} />
      : busy ? <View style={styles.canvas}><ActivityIndicator color="#9abfff" /><Text style={styles.text}>페이지 준비 중…</Text></View>
      : error ? <View style={styles.canvas}><Text accessibilityRole="alert" style={styles.error}>{error}</Text><ReaderButton label="다시 열기" onPress={() => reload(false)} /></View>
      : page ? mode === 'scroll' ? <ScrollReader pages={book!.pages} position={position} navigation={navigation}
        onPosition={scrollPosition} repair={repair} />
        : <PageImage key={`${id}:${index}:${request.version}`} page={page} repair={repair} /> : null}
    <View style={styles.controls}>
      <ReaderButton label={`열람 모드: ${mode === 'page' ? '페이지' : '세로 스크롤'}`} disabled={busy || !!error || !count}
        onPress={() => { setNavigation(position); setMode((value) => value === 'page' ? 'scroll' : 'page'); }} />
      <ReaderButton label={`읽기 방향: ${direction === 'ltr' ? '좌→우' : '우→좌'}`}
        onPress={() => setDirection((value) => value === 'ltr' ? 'rtl' : 'ltr')} />
      <Text accessibilityLiveRegion="polite" style={styles.text}>{count ? `${index + 1} / ${count}` : '— / —'}</Text>
      <View style={styles.row}>{(['left', 'right'] as const).map((side) => {
        const action = physicalPageAction(side, direction);
        return <ReaderButton key={side} label={`${side === 'left' ? '← ' : ''}${action === 'next' ? '다음' : '이전'}${side === 'right' ? ' →' : ''}`}
          disabled={busy || !!error || !count || (action === 'next' ? index === count - 1 : index === 0)}
          onPress={() => {
            const next = { index: pageAfter(index, count, action), fraction: 0 };
            setPosition(next); setNavigation(next);
          }} />;
      })}</View>
    </View>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#101724' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12 },
  title: { flex: 1, color: '#f4f7fc', fontSize: 16 },
  text: { color: '#f4f7fc', fontSize: 15, textAlign: 'center' },
  button: { minHeight: 48, padding: 12, justifyContent: 'center', borderRadius: 10, backgroundColor: '#263850' },
  disabled: { opacity: 0.35 },
  canvas: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  image: { width: '100%', height: '100%' },
  overlay: { position: 'absolute', inset: 0, backgroundColor: '#101724', alignItems: 'center', justifyContent: 'center', padding: 24, gap: 16 },
  error: { color: '#ffb4b4', padding: 16, lineHeight: 22, textAlign: 'center' },
  controls: { padding: 12, gap: 8 },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 24 },
});
