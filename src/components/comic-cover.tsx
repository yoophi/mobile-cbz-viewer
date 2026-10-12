import { useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { Image } from 'expo-image';

export function ComicCover({ uri, name }: { uri?: string; name: string }) {
  return uri ? <CoverImage key={uri} uri={uri} name={name} /> : <Text style={styles.placeholder}>표지 없음</Text>;
}

function CoverImage({ uri, name }: { uri: string; name: string }) {
  const [failed, setFailed] = useState(false);
  return !failed ? <Image source={uri} contentFit="contain" cachePolicy="none" allowDownscaling enforceEarlyResizing autoplay={false}
    accessible accessibilityRole="image" accessibilityLabel={`${name} 표지`} onError={() => setFailed(true)} style={styles.image} />
    : <Text style={styles.placeholder}>표지 없음</Text>;
}

const styles = StyleSheet.create({
  image: { height: 160, width: 110, marginBottom: 12, backgroundColor: '#101724' },
  placeholder: { color: '#a9b5c7', marginBottom: 12 },
});
