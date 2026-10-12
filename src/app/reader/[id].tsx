import { useLocalSearchParams } from 'expo-router';
import { ComicReader } from '@/components/comic-reader';
import { parseComicId } from '@/utils/reader-navigation';

export default function ReaderScreen() {
  const { id } = useLocalSearchParams<{ id?: string | string[] }>();
  const comicId = parseComicId(id);
  return <ComicReader key={comicId ?? 'invalid'} id={comicId} />;
}
