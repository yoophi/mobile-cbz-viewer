import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import Storage from 'expo-sqlite/kv-store';
import { StatusBar } from 'expo-status-bar';
import { NavigationBar } from 'expo-navigation-bar';
import { router, useFocusEffect } from 'expo-router';
import { openComic, prepareComic, retainComic, getReadingState, createComicReadingWriter, type Comic, type ComicPage } from '@/services/library';
import { pageAfter, physicalPageAction } from '@/utils/reader-navigation';
import { ScrollReader } from './scroll-reader';
import type { ReadingPosition } from '@/utils/scroll-layout';
import { DEFAULT_READING_STATE, normalizeReadingState, type ReadingState } from '@/utils/reading-state';
import { ReadingSaveNotice } from './reading-save-notice';
import { ZoomCanvas } from './zoom-canvas';
import { fitPageSpread, pageSpread, spreadPageAfter, type PageLayout } from '@/utils/page-spread';

function ReaderButton({ label, onPress, disabled = false }: { label: string; onPress: () => void; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled}
    onPress={onPress} style={[styles.button, disabled && styles.disabled]}><Text style={styles.text}>{label}</Text></Pressable>;
}

function PageNavigation({ side, direction, disabled, overlay = false, marginWidth, onNavigate }: {
  side: 'left' | 'right'; direction: 'ltr' | 'rtl'; disabled: boolean; overlay?: boolean; marginWidth?: number; onNavigate: (side: 'left' | 'right') => void;
}) {
  const action = physicalPageAction(side, direction);
  const label = action === 'next' ? '다음 페이지' : '이전 페이지';
  const activate = () => { if (!disabled) onNavigate(side); };
  if (marginWidth !== undefined) return <Pressable accessible={false} disabled={disabled} onPress={activate}
    style={[styles.margin, { width: marginWidth }, side === 'left' ? styles.leftRegion : styles.rightRegion]} />;
  if (overlay) return <View collapsable={false} pointerEvents="none" accessible accessibilityRole="button"
    accessibilityLabel={label} accessibilityHint="이미지의 왼쪽 또는 오른쪽 가장자리를 눌러 페이지를 넘깁니다."
    accessibilityState={{ disabled }} accessibilityActions={[{ name: 'activate' }]}
    onAccessibilityTap={activate}
    onAccessibilityAction={({ nativeEvent }) => { if (nativeEvent.actionName === 'activate') activate(); }}
    style={[styles.tapRegion, side === 'left' ? styles.leftRegion : styles.rightRegion]} />;
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }}
    disabled={disabled} onPress={activate} style={styles.topButton}>
    <Text style={styles.text}>{side === 'left' ? '‹' : '›'} {action === 'next' ? '다음' : '이전'}</Text>
  </Pressable>;
}

function PageImage({ page, repair, direction, onTap, size }: { page: ComicPage; repair: () => void; onTap: (fraction: number, zoomed: boolean) => void; direction: 'ltr' | 'rtl'; size?: { width: number; height: number } }) {
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  return <View style={size ? { width: size.width, height: size.height } : styles.canvas}>
    <ZoomCanvas key={attempt} onTap={onTap} resetKey={direction} image={page.width && page.height ? { width: page.width, height: page.height } : undefined}>
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
  const [toolsVisible, setToolsVisible] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [layoutError, setLayoutError] = useState(false);
  const [pageLayout, setPageLayout] = useState<PageLayout>(() => {
    try { return Storage.getItemSync('reader-page-layout') === 'double' ? 'double' : 'single'; }
    catch { return 'single'; }
  });
  const [pageWidth, setPageWidth] = useState(0);
  const [pageHeight, setPageHeight] = useState(0);

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
  const spread = pageSpread(index, count, pageWidth, direction, pageLayout);
  const spreadSize = fitPageSpread(pageWidth, pageHeight, spread?.indices.map((visibleIndex) => book!.pages[visibleIndex]) ?? []);
  const first = mode === 'page' ? spread?.first ?? index : index;
  const last = mode === 'page' ? spread?.last ?? index : index;
  const counter = count ? first === last ? `${first + 1} / ${count}` : `${first + 1}–${last + 1} / ${count}` : '— / —';
  const disabled = busy || !!error || !count;
  const showTools = mode === 'scroll' || toolsVisible || disabled;
  function changeLayout() {
    const next = pageLayout === 'single' ? 'double' : 'single';
    setPageLayout(next);
    try { Storage.setItemSync('reader-page-layout', next); setLayoutError(false); }
    catch { setLayoutError(true); }
  }
  const navigate = useCallback((side: 'left' | 'right') => {
    const action = physicalPageAction(side, direction);
    const next = { index: mode === 'page' ? spreadPageAfter(index, count, pageWidth, action, pageLayout)
      : pageAfter(index, count, action), fraction: 0 };
    updateReading(next, true); setNavigation(next);
  }, [mode, direction, index, count, pageWidth, pageLayout, updateReading]);
  function imageTap(fraction: number, slot: number, slots: number, zoomed: boolean) {
    const viewportFraction = slots > 1 ? ((pageWidth - spreadSize.width) / 2
      + spreadSize.widths.slice(0, slot).reduce((sum, width) => sum + width, 0) + fraction * spreadSize.widths[slot]) / pageWidth : fraction;
    if (viewportFraction > 0.2 && viewportFraction < 0.8) setToolsVisible((value) => !value);
    else if (!zoomed) navigate(viewportFraction <= 0.2 ? 'left' : 'right');
  }
  const returnToLibrary = useCallback(() => router.dismissTo('/'), []);
  return <SafeAreaView style={styles.screen} onAccessibilityEscape={returnToLibrary}>
    {focused ? <><StatusBar hidden={!showTools} style="light" /><NavigationBar hidden={!showTools} style="light" /></> : null}
    <View style={styles.screen}>
    {showTools ? <View style={styles.topOverlay}>
    <ScrollView horizontal style={styles.header} contentContainerStyle={styles.headerContent} showsHorizontalScrollIndicator={false}>
      <Pressable accessibilityRole="button" accessibilityLabel="서재로" onPress={returnToLibrary} style={styles.topButton}><Text style={styles.text}>‹ 서재</Text></Pressable>
      <Text accessibilityLiveRegion="polite" accessibilityLabel={count
        ? `현재 ${index + 1} 페이지, 전체 ${count} 페이지${first !== last ? `, 화면에 ${first + 1}부터 ${last + 1} 페이지` : ''}`
        : '페이지 없음'} style={styles.counter}>{counter}</Text>
      {mode === 'page' ? <Pressable accessibilityRole="button" accessibilityLabel={`페이지 배치: ${pageLayout === 'single' ? '한 장' : '두 장'}`}
        accessibilityState={{ disabled }} disabled={disabled} onPress={changeLayout} style={[styles.topButton, disabled && styles.disabled]}>
        <Text style={styles.text}>{pageLayout === 'single' ? '한 장' : '두 장'}</Text>
      </Pressable> : null}
      <Pressable accessibilityRole="button" accessibilityLabel="열람 설정" accessibilityState={{ expanded: settingsOpen }}
        onPress={() => setSettingsOpen((value) => !value)} style={styles.topButton}><Text style={styles.text}>{settingsOpen ? '닫기' : '설정'}</Text></Pressable>
      <Text accessibilityRole="header" numberOfLines={1} style={styles.title}>{book?.comic.name ?? '만화 열람'}</Text>
    </ScrollView>
    {settingsOpen ? <ScrollView horizontal style={styles.header} contentContainerStyle={styles.headerContent}>
      <Pressable accessibilityRole="button" accessibilityLabel={`열람 모드: ${mode === 'page' ? '페이지' : '세로 스크롤'}`}
        accessibilityState={{ disabled }} disabled={disabled} style={styles.topButton}
        onPress={() => { setNavigation(position); updateReading({ mode: mode === 'page' ? 'scroll' : 'page' }, true); }}>
        <Text style={styles.text}>{mode === 'page' ? '페이지' : '세로 스크롤'}</Text>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={`읽기 방향: ${direction === 'ltr' ? '좌→우' : '우→좌'}`}
        accessibilityState={{ disabled }} disabled={disabled} style={styles.topButton}
        onPress={() => updateReading({ direction: direction === 'ltr' ? 'rtl' : 'ltr' }, true)}>
        <Text style={styles.text}>{direction === 'ltr' ? '좌→우' : '우→좌'}</Text>
      </Pressable>
      {mode === 'scroll' ? (['left', 'right'] as const).map((side) => {
        const action = physicalPageAction(side, direction);
        return <PageNavigation key={side} side={side} direction={direction} onNavigate={navigate}
          disabled={disabled || (action === 'next' ? last === count - 1 : first === 0)} />;
      }) : null}
    </ScrollView> : null}
    {layoutError ? <Text accessibilityRole="alert" style={styles.error}>페이지 배치를 저장하지 못했습니다. 다시 선택해 주세요.</Text> : null}
    <ReadingSaveNotice id={id} />
    </View> : <ReadingSaveNotice id={id} />}
    <View style={styles.viewport} onLayout={({ nativeEvent: { layout } }) => {
      setPageWidth((previous) => previous === layout.width ? previous : layout.width);
      setPageHeight((previous) => previous === layout.height ? previous : layout.height);
    }}>
    {id === undefined ? <Text accessibilityRole="alert" style={styles.error}>올바르지 않은 서재 주소입니다.</Text>
      : !focused ? <View style={styles.canvas} />
      : busy ? <View style={styles.canvas}><ActivityIndicator color="#9abfff" /><Text style={styles.text}>페이지 준비 중…</Text></View>
      : error ? <View style={styles.canvas}><Text accessibilityRole="alert" style={styles.error}>{error}</Text><ReaderButton label="다시 열기" onPress={() => reload(false)} /></View>
      : page ? mode === 'scroll' ? <ScrollReader pages={book!.pages} position={position} navigation={navigation}
        onPosition={scrollPosition} repair={repair} />
        : pageWidth > 0 && pageHeight > 0 && spread ? <View style={styles.canvas}>
          <View style={spread.indices.length > 1 ? [styles.spread, { width: spreadSize.width, height: spreadSize.height }] : styles.canvas}>
          {spread.indices.map((visibleIndex, slot) => <PageImage key={`${id}:${visibleIndex}:${request.version}`}
            page={book!.pages[visibleIndex]} repair={repair} direction={direction}
            size={spread.indices.length > 1 ? { width: spreadSize.widths[slot], height: spreadSize.height } : undefined}
            onTap={(fraction, zoomed) => imageTap(fraction, slot, spread.indices.length, zoomed)} />)}
          </View>
          {spread.indices.length > 1 && spreadSize.width < pageWidth ? (['left', 'right'] as const).map((side) => <PageNavigation key={side}
            side={side} direction={direction} disabled={false} onNavigate={navigate} marginWidth={(pageWidth - spreadSize.width) / 2} />) : null}
          {spread.indices.length > 1 && spreadSize.height < pageHeight ? (['top', 'bottom'] as const).map((side) => <Pressable key={side}
            accessible={false} onPress={() => setToolsVisible((value) => !value)} style={[styles.verticalMargin, { height: (pageHeight - spreadSize.height) / 2 }, side === 'top' ? { top: 0 } : { bottom: 0 }]} />) : null}
        </View> : null : null}
    {mode === 'page' && !disabled ? <View pointerEvents="none" collapsable={false} accessible accessibilityRole="button"
      accessibilityLabel={toolsVisible ? '열람 도구 숨기기' : '열람 도구 표시'} accessibilityActions={[{ name: 'activate' }]}
      onAccessibilityTap={() => setToolsVisible((value) => !value)}
      onAccessibilityAction={({ nativeEvent }) => { if (nativeEvent.actionName === 'activate') setToolsVisible((value) => !value); }}
      style={styles.centerRegion} /> : null}
    {mode === 'page' && !disabled ? (['left', 'right'] as const).map((side) => {
      const action = physicalPageAction(side, direction);
      const unavailable = action === 'next' ? last === count - 1 : first === 0;
      // The gesture layer receives touches; these invisible native buttons
      // provide screen-reader activation without blocking pinch or double tap.
      return <PageNavigation key={side} side={side} direction={direction} overlay onNavigate={navigate} disabled={unavailable} />;
    }) : null}
    </View>
    </View>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#101724' },
  topOverlay: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10, backgroundColor: '#101724ee' },
  centerRegion: { position: 'absolute', top: 0, bottom: 0, left: '20%', width: '60%' },
  margin: { position: 'absolute', top: 0, bottom: 0 },
  verticalMargin: { position: 'absolute', left: '20%', right: '20%' },
  header: { flexGrow: 0, flexShrink: 0 },
  headerContent: { alignItems: 'center', gap: 8, paddingHorizontal: 8 },
  topButton: { minHeight: 44, minWidth: 44, paddingHorizontal: 8, justifyContent: 'center' },
  counter: { color: '#c7d2e2', fontSize: 13, fontVariant: ['tabular-nums'] },
  tapRegion: { position: 'absolute', top: 0, bottom: 0, width: '20%' },
  leftRegion: { left: 0 }, rightRegion: { right: 0 },
  title: { maxWidth: 160, flexShrink: 1, color: '#c7d2e2', fontSize: 13 },
  text: { color: '#f4f7fc', fontSize: 15, textAlign: 'center' },
  button: { minHeight: 48, padding: 12, justifyContent: 'center', borderRadius: 10, backgroundColor: '#263850' },
  disabled: { opacity: 0.35 },
  canvas: { flex: 1, width: '100%', alignItems: 'center', justifyContent: 'center', gap: 12 },
  viewport: { flex: 1, width: '100%' },
  spread: { flexDirection: 'row', alignItems: 'stretch', gap: 0 },
  image: { width: '100%', height: '100%' },
  overlay: { position: 'absolute', inset: 0, backgroundColor: '#101724', alignItems: 'center', justifyContent: 'center', padding: 24, gap: 16 },
  error: { color: '#ffb4b4', padding: 16, lineHeight: 22, textAlign: 'center' },
});
