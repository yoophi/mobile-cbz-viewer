import { useCallback, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { File, Paths } from 'expo-file-system';
import { useFocusEffect } from 'expo-router';
import { ScrollReader, type ScrollObservation } from '@/components/scroll-reader';
import { listComics, openComic, retainComic, type ComicPage } from '@/services/library';
import type { ReadingPosition } from '@/utils/scroll-layout';

type Observation = ScrollObservation | { type: 'position'; position: ReadingPosition; time: number; enabled: boolean };
const initial = { index: 1, fraction: .2 };
export default function ScrollGestureDiagnostics() {
  const [pages, setPages] = useState<ComicPage[]>();
  const [position, setPosition] = useState(initial);
  const [message, setMessage] = useState('Loading own synthetic scroll book…');
  const [focused, setFocused] = useState(false);
  const events = useRef<Observation[]>([]);
  const current = useRef(initial);
  const enabled = useRef(true);
  const record = useCallback((event: Observation) => {
    if (events.current.length === 256) events.current.shift();
    events.current.push(event);
  }, []);
  const observe = useCallback((event: ScrollObservation) => { enabled.current = event.enabled; record(event); }, [record]);
  const update = useCallback((value: ReadingPosition) => {
    current.current = value; setPosition(value);
    record({ type: 'position', position: value, time: Date.now(), enabled: enabled.current });
  }, [record]);
  useFocusEffect(useCallback(() => {
    if (!__DEV__ || Platform.OS === 'web') return;
    let active = true; let release: (() => void) | undefined;
    setFocused(true);
    async function load() {
      const comic = (await listComics()).find((item) => item.id === 2);
      if (comic?.name !== 'reader-stress-1.cbz' || comic.pageCount !== 40) throw new Error('Own synthetic 40-page book id2 required');
      release = retainComic(2);
      const result = await openComic(2);
      if (active) { setPages(result.pages); setMessage('Ready: no reading-state writes'); }
      else { release(); release = undefined; }
    }
    void load().catch((error) => { if (active) setMessage(String(error)); });
    return () => { active = false; release?.(); setFocused(false); };
  }, []));
  return <SafeAreaView style={styles.screen}>
    <Text style={styles.text}>{__DEV__ && Platform.OS !== 'web' ? message : 'Native development build required'}</Text>
    {pages && focused ? <ScrollReader pages={pages} position={position} navigation={initial} onPosition={update}
      onObservation={observe} repair={() => setMessage('Repair intentionally disabled for the diagnostic')} /> : <View style={{ flex: 1 }} />}
    {__DEV__ && Platform.OS !== 'web' ? <View style={styles.row}>
      <Pressable accessibilityRole="button" accessibilityLabel="Snapshot scroll observations" style={styles.button} onPress={() => {
        new File(Paths.document, 'scroll-gesture-probe-result.json').write(JSON.stringify({ position: current.current, events: events.current }));
        setMessage(`Saved ${events.current.length} observations`);
      }}><Text style={styles.text}>Snapshot</Text></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Clear scroll observations" style={styles.button}
        onPress={() => { events.current = []; setMessage('Observations cleared'); }}><Text style={styles.text}>Clear</Text></Pressable>
    </View> : null}
  </SafeAreaView>;
}
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#101724' }, text: { color: '#f4f7fc', padding: 12 },
  row: { flexDirection: 'row', gap: 12, padding: 12 }, button: { minHeight: 48, backgroundColor: '#263850', borderRadius: 8 },
});
