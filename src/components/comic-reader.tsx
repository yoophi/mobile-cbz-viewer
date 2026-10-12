import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { router, useFocusEffect } from 'expo-router';
import { openComic, prepareComic, retainComic, getReadingState, createComicReadingWriter, type Comic, type ComicPage } from '@/services/library';
import { pageAfter, physicalPageAction } from '@/utils/reader-navigation';
import { ScrollReader } from './scroll-reader';
import type { ReadingPosition } from '@/utils/scroll-layout';
import { DEFAULT_READING_STATE, normalizeReadingState, type ReadingState } from '@/utils/reading-state';
import { ReadingSaveNotice } from './reading-save-notice';
import { ZoomCanvas } from './zoom-canvas';
import { pageSpread, spreadPageAfter, SPREAD_GAP } from '@/utils/page-spread';

function ReaderButton({ label, onPress, disabled = false }: { label: string; onPress: () => void; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled}
    onPress={onPress} style={[styles.button, disabled && styles.disabled]}><Text style={styles.text}>{label}</Text></Pressable>;
}

function PageImage({ page, repair, direction }: { page: ComicPage; repair: () => void; direction: 'ltr' | 'rtl' }) {
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  return <View style={styles.canvas}>
    <ZoomCanvas key={attempt} resetKey={direction} image={page.width && page.height ? { width: page.width, height: page.height } : undefined}>
    <Image source={{ uri: page.uri }} style={styles.image} contentFit="contain"
      cachePolicy="none" recyclingKey={`${page.comicId}:${page.position}:${attempt}`} allowDownscaling
      enforceEarlyResizing autoplay={false}
      accessibilityLabel={`${page.position + 1} 페이지`} onLoad={() => setLoading(false)}
      onError={() => { setLoading(false); setFailed(true); }} />
    </ZoomCanvas>
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
  const [reading, setReading] = useState<ReadingState>(DEFAULT_READING_STATE);
  const readingRef = useRef(reading);
  const writer = useRef<ReturnType<typeof createComicReadingWriter> | undefined>(undefined);
  const [navigation, setNavigation] = useState<ReadingPosition>({ index: 0, fraction: 0 });
  const { index, mode, direction } = reading;
  const position = { index, fraction: reading.fraction };
  const [request, setRequest] = useState({ version: 0, repair: false });
  const [busy, setBusy] = useState(id !== undefined);
  const [error, setError] = useState<string>();
  const [focused, setFocused] = useState(false);
  const repairedVersion = useRef(-1);
  const [screenSize, setScreenSize] = useState({ width: 0, height: 0 });
  const [pageWidth, setPageWidth] = useState(0);

  useFocusEffect(useCallback(() => {
    if (id === undefined) return;
    setFocused(true); setBusy(true); setError(undefined);
    const comicId = id;
    const release = retainComic(comicId);
    const controller = new AbortController();
    let active = true;
    let currentWriter: ReturnType<typeof createComicReadingWriter> | undefined;
    async function load() {
      if (request.repair && repairedVersion.current !== request.version) {
        await prepareComic(comicId, controller.signal);
        repairedVersion.current = request.version;
      }
      const result = await openComic(comicId, controller.signal);
      const state = normalizeReadingState(await getReadingState(comicId, result.pages.length), result.pages.length);
      return { result, state };
    }
    load().then(({ result, state }) => {
      if (!active) return;
      setBook(result);
      readingRef.current = state; setReading(state); setNavigation({ index: state.index, fraction: state.fraction });
      currentWriter = createComicReadingWriter(comicId); writer.current = currentWriter;
      // Also persist corrected anchors after page count changes or migration.
      currentWriter.update(state);
    }).catch((cause) => {
      if (active) setError(cause instanceof Error ? cause.message : '만화를 열지 못했습니다.');
    }).finally(() => { if (active) setBusy(false); });
    return () => {
      active = false; controller.abort(); release(); setFocused(false);
      if (writer.current === currentWriter) writer.current = undefined;
      // Save failures stay visible in both the reader and library via ReadingSaveNotice.
      void currentWriter?.dispose().catch(() => {});
    };
  }, [id, request]));

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') void writer.current?.flush().catch(() => {});
    });
    return () => subscription.remove();
  }, []);

  const updateReading = useCallback((patch: Partial<ReadingState>, flush = false) => {
    const previous = readingRef.current; const next = { ...previous, ...patch };
    if (next.index === previous.index && next.fraction === previous.fraction && next.mode === previous.mode && next.direction === previous.direction) return;
    readingRef.current = next; setReading(next); writer.current?.update(next);
    if (flush) void writer.current?.flush().catch(() => {});
  }, []);

  function reload(repair: boolean) {
    setBusy(true);
    setError(undefined);
    setRequest((value) => ({ version: value.version + 1, repair }));
  }
  const repair = useCallback(() => {
    setBusy(true); setError(undefined);
    setRequest((value) => ({ version: value.version + 1, repair: true }));
  }, []);
  const scrollPosition = useCallback((value: ReadingPosition) => updateReading(value), [updateReading]);
  const count = book?.pages.length ?? 0;
  const page = book?.pages[index];
  const spread = pageSpread(index, count, pageWidth, direction);
  const first = mode === 'page' ? spread?.first ?? index : index;
  const last = mode === 'page' ? spread?.last ?? index : index;
  const counter = count ? first === last ? `${first + 1} / ${count}` : `${first + 1}–${last + 1} / ${count}` : '— / —';
  const compact = screenSize.height > 0 && screenSize.height < 520;
  const returnToLibrary = useCallback(() => router.dismissTo('/'), []);
  return <SafeAreaView style={styles.screen} onAccessibilityEscape={returnToLibrary}>
    <View style={styles.screen} onLayout={({ nativeEvent: { layout } }) => {
      setScreenSize((previous) => previous.width === layout.width && previous.height === layout.height
        ? previous : { width: layout.width, height: layout.height });
    }}>
    <View style={styles.header}>
      <ReaderButton label="서재로" onPress={returnToLibrary} />
      <Text accessibilityRole="header" numberOfLines={1} style={styles.title}>{book?.comic.name ?? '만화 열람'}</Text>
    </View>
    <ReadingSaveNotice id={id} />
    <View style={styles.viewport} onLayout={({ nativeEvent: { layout } }) => setPageWidth((previous) => previous === layout.width ? previous : layout.width)}>
    {id === undefined ? <Text accessibilityRole="alert" style={styles.error}>올바르지 않은 서재 주소입니다.</Text>
      : !focused ? <View style={styles.canvas} />
      : busy ? <View style={styles.canvas}><ActivityIndicator color="#9abfff" /><Text style={styles.text}>페이지 준비 중…</Text></View>
      : error ? <View style={styles.canvas}><Text accessibilityRole="alert" style={styles.error}>{error}</Text><ReaderButton label="다시 열기" onPress={() => reload(false)} /></View>
      : page ? mode === 'scroll' ? <ScrollReader pages={book!.pages} position={position} navigation={navigation}
        onPosition={scrollPosition} repair={repair} />
        : pageWidth > 0 && spread ? <View style={[styles.canvas, styles.spread]}>
          {spread.indices.map((visibleIndex) => <PageImage key={`${id}:${visibleIndex}:${request.version}`}
            page={book!.pages[visibleIndex]} repair={repair} direction={direction} />)}
        </View> : null : null}
    </View>
    <ScrollView style={[styles.toolbar, screenSize.height > 0 && { maxHeight: screenSize.height * 0.5 }]}
      contentContainerStyle={[styles.controls, compact && styles.compactControls]}>
      <ReaderButton label={`열람 모드: ${mode === 'page' ? '페이지' : '세로 스크롤'}`} disabled={busy || !!error || !count}
        onPress={() => { setNavigation(position); updateReading({ mode: mode === 'page' ? 'scroll' : 'page' }, true); }} />
      <ReaderButton label={`읽기 방향: ${direction === 'ltr' ? '좌→우' : '우→좌'}`}
        disabled={busy || !!error || !count} onPress={() => updateReading({ direction: direction === 'ltr' ? 'rtl' : 'ltr' }, true)} />
      <Text accessibilityLiveRegion="polite" accessibilityLabel={count
        ? `현재 ${index + 1} 페이지, 전체 ${count} 페이지${first !== last ? `, 화면에 ${first + 1}부터 ${last + 1} 페이지` : ''}`
        : '페이지 없음'} style={styles.text}>{counter}</Text>
      <View style={styles.row}>{(['left', 'right'] as const).map((side) => {
        const action = physicalPageAction(side, direction);
        return <ReaderButton key={side} label={`${side === 'left' ? '← ' : ''}${action === 'next' ? '다음' : '이전'}${side === 'right' ? ' →' : ''}`}
          disabled={busy || !!error || !count || (action === 'next' ? last === count - 1 : first === 0)}
          onPress={() => {
            const next = { index: mode === 'page' ? spreadPageAfter(readingRef.current.index, count, pageWidth, action)
              : pageAfter(readingRef.current.index, count, action), fraction: 0 };
            updateReading(next, true); setNavigation(next);
          }} />;
      })}</View>
    </ScrollView>
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
  viewport: { flex: 1, width: '100%' },
  spread: { width: '100%', flexDirection: 'row', alignItems: 'stretch', gap: SPREAD_GAP },
  image: { width: '100%', height: '100%' },
  overlay: { position: 'absolute', inset: 0, backgroundColor: '#101724', alignItems: 'center', justifyContent: 'center', padding: 24, gap: 16 },
  error: { color: '#ffb4b4', padding: 16, lineHeight: 22, textAlign: 'center' },
  controls: { padding: 12, gap: 8 },
  toolbar: { flexGrow: 0, flexShrink: 1 },
  compactControls: { padding: 8, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 24 },
});
