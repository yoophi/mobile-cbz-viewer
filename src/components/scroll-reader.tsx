import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { Image } from 'expo-image';
import { GestureDetector } from 'react-native-gesture-handler';
import { ZoomCanvas, type ZoomScrollControls } from './zoom-canvas';
import { acquireScrollPage, type ComicPage } from '@/services/library';
import { buildScrollLayout, scrollOffsetAtPosition, scrollPositionAtOffset, scrollRowAtOffset,
  type ReadingPosition, type ScrollLayout, type ScrollRow } from '@/utils/scroll-layout';

const Band = memo(function Band({ page, row, width, active, repair }: {
  page: ComicPage; row: ScrollRow; width: number; active: boolean; repair: () => void;
}) {
  const [uri, setUri] = useState<string>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    if (!active || !row.known) return;
    let mounted = true;
    const lease = acquireScrollPage(page);
    lease.promise.then((result) => { if (mounted) { setUri(result.uris[row.part]); setError(undefined); } })
      .catch((cause) => { if (mounted) setError(cause instanceof Error ? cause.message : '이미지를 표시하지 못했습니다.'); });
    return () => { mounted = false; lease.release(); };
  }, [active, page, row.known, row.part]);
  const failed = error ?? (!row.known ? '이미지 크기를 확인하지 못했습니다.' : undefined);
  return <View style={{ width, height: row.length, overflow: 'hidden' }}>
    {active && uri && !failed ? <Image source={{ uri }} style={{ width, height: row.imageHeight }} contentFit="fill"
      cachePolicy="none" allowDownscaling enforceEarlyResizing autoplay={false}
      recyclingKey={`${page.comicId}:${page.position}:${row.part}`}
      accessibilityLabel={`${page.position + 1} 페이지, ${row.part + 1} 구간`}
      onError={() => setError('스크롤 이미지를 표시하지 못했습니다. 원본에서 복구해 주세요.')} />
      : <View style={[styles.placeholder, { height: row.imageHeight }]}>
        {active && failed ? <Pressable accessibilityRole="button" accessibilityLabel={`${failed} 원본에서 페이지 복구`}
          onPress={repair} style={styles.failure}><Text numberOfLines={3} style={styles.error}>{failed} 원본에서 복구</Text></Pressable>
          : active ? <><ActivityIndicator color="#9abfff" /><Text style={styles.text}>{page.position + 1} 페이지 준비 중…</Text></> : null}
      </View>}
  </View>;
});

function ScrollBody({ pages, layout, width, height, position, navigation, onPosition, repair, scrollGesture, scrollEnabled }: {
  pages: ComicPage[]; layout: ScrollLayout; width: number; height: number;
  position: ReadingPosition; navigation: ReadingPosition; onPosition: (value: ReadingPosition) => void; repair: () => void;
} & ZoomScrollControls) {
  const list = useRef<FlatList<ScrollRow>>(null);
  const [initialOffset] = useState(() => scrollOffsetAtPosition(layout, position));
  const [initialIndex] = useState(() => scrollRowAtOffset(layout, initialOffset));
  const [range, setRange] = useState(() => ({ first: Math.max(0, initialIndex - 1),
    last: Math.min(layout.rows.length - 1, scrollRowAtOffset(layout, initialOffset + height) + 1) }));
  const initialized = useRef(false);
  const pending = useRef<number | undefined>(initialOffset);
  const lastOffset = useRef<number | undefined>(undefined);
  const lastNavigation = useRef(navigation);

  const move = useCallback((offset: number) => {
    pending.current = offset;
    setRange({ first: Math.max(0, scrollRowAtOffset(layout, offset) - 1),
      last: Math.min(layout.rows.length - 1, scrollRowAtOffset(layout, offset + height) + 1) });
    list.current?.scrollToOffset({ offset, animated: false });
  }, [layout, height]);
  useEffect(() => {
    if (lastNavigation.current === navigation) return;
    lastNavigation.current = navigation;
    move(scrollOffsetAtPosition(layout, navigation));
  }, [navigation, layout, move]);
  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const offset = Math.max(0, event.nativeEvent.contentOffset.y);
    if (pending.current !== undefined) {
      if (Math.abs(offset - pending.current) > 3) return;
      pending.current = undefined;
      lastOffset.current = offset;
      // Restoring a source anchor rounds to native display pixels. Keep the
      // source position until an actual scroll rather than saving that rounding.
      return;
    }
    if (lastOffset.current === offset) return;
    lastOffset.current = offset;
    const first = Math.max(0, scrollRowAtOffset(layout, offset) - 1);
    const last = Math.min(layout.rows.length - 1, scrollRowAtOffset(layout, offset + height) + 1);
    setRange((previous) => previous.first === first && previous.last === last ? previous : { first, last });
    onPosition(scrollPositionAtOffset(layout, offset));
  }, [height, layout, onPosition]);
  const renderItem = useCallback(({ item, index }: { item: ScrollRow; index: number }) =>
    <Band page={pages[item.pageIndex]} row={item} width={width} active={index >= range.first && index <= range.last} repair={repair} />,
  [pages, width, range, repair]);
  const getItemLayout = useCallback((_data: ArrayLike<ScrollRow> | null | undefined, index: number) =>
    ({ index, offset: layout.rows[index].offset, length: layout.rows[index].length }), [layout]);
  const lastPage = layout.pages[layout.pages.length - 1];
  return <GestureDetector gesture={scrollGesture}><FlatList ref={list} data={layout.rows} keyExtractor={(row) => `${row.pageIndex}:${row.part}`}
    renderItem={renderItem} getItemLayout={getItemLayout} initialScrollIndex={initialIndex}
    initialNumToRender={2} maxToRenderPerBatch={2} updateCellsBatchingPeriod={30} windowSize={3}
    removeClippedSubviews={false} scrollEnabled={scrollEnabled} scrollEventThrottle={100} onScroll={onScroll}
    onScrollBeginDrag={() => { pending.current = undefined; }}
    onContentSizeChange={() => { if (!initialized.current) { initialized.current = true; move(initialOffset); } }}
    ListFooterComponent={<View style={{ height: Math.max(0, height - (lastPage?.length ?? height)) }} />}
    accessibilityLabel="세로 스크롤 만화" style={styles.list} /></GestureDetector>;
}

function SizedScroll({ pages, width, height, ...props }: {
  pages: ComicPage[]; width: number; height: number; position: ReadingPosition; navigation: ReadingPosition;
  onPosition: (position: ReadingPosition) => void; repair: () => void;
}) {
  const result = useMemo(() => {
    try { return { layout: buildScrollLayout(pages, width) }; }
    catch (cause) { return { error: cause instanceof Error ? cause.message : '스크롤 모드를 준비하지 못했습니다.' }; }
  }, [pages, width]);
  const layout = result.layout;
  return layout ? <ZoomCanvas resetKey={`${props.navigation.index}:${props.navigation.fraction}`}>
    {(controls) => <ScrollBody pages={pages} layout={layout} width={width} height={height} {...props} {...controls} />}
    </ZoomCanvas>
    : <Text accessibilityRole="alert" style={styles.error}>{result.error}</Text>;
}

export function ScrollReader(props: {
  pages: ComicPage[]; position: ReadingPosition; navigation: ReadingPosition;
  onPosition: (position: ReadingPosition) => void; repair: () => void;
}) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  return <View style={styles.list} onLayout={({ nativeEvent: { layout } }) => {
    setSize((previous) => previous.width === layout.width && previous.height === layout.height ? previous : { width: layout.width, height: layout.height });
  }}>
    {size.width > 0 && size.height > 0 ? <SizedScroll key={`${size.width}:${size.height}`} {...props} {...size} /> : null}
  </View>;
}

const styles = StyleSheet.create({
  list: { flex: 1 },
  placeholder: { alignItems: 'center', justifyContent: 'center', gap: 12, backgroundColor: '#101724' },
  failure: { minHeight: 48, padding: 12, justifyContent: 'center' },
  text: { color: '#f4f7fc', textAlign: 'center' },
  error: { color: '#ffb4b4', textAlign: 'center', padding: 12 },
});
