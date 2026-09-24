import { useRef, useState } from 'react';
import { NativeScrollEvent, NativeSyntheticEvent, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSettings } from '@/lib/settings';
import { Photo } from './Kit';
import { radius } from './theme';

/** Carrusel de fotos con paginación y puntos indicadores. */
export function Gallery({ urls, icon }: { urls: string[]; icon?: 'cube-outline' | 'cut-outline' }) {
  const { colors } = useSettings();
  const [width, setWidth] = useState(0);
  const [page, setPage] = useState(0);
  const scroller = useRef<ScrollView>(null);

  if (urls.length === 0) return <Photo icon={icon} style={styles.frame} />;

  const onEnd = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (width > 0) setPage(Math.round(event.nativeEvent.contentOffset.x / width));
  };

  return (
    <View style={styles.frame} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      <ScrollView ref={scroller} horizontal pagingEnabled showsHorizontalScrollIndicator={false} onMomentumScrollEnd={onEnd} scrollEnabled={urls.length > 1}>
        {urls.map((url) => (
          <Photo key={url} url={url} icon={icon} style={{ width: width || undefined, height: '100%', borderRadius: 0, aspectRatio: undefined }} />
        ))}
      </ScrollView>
      {urls.length > 1 ? (
        <View style={styles.dots}>
          {urls.map((url, index) => (
            <Pressable
              key={url}
              accessibilityRole="button"
              accessibilityLabel={`${index + 1}/${urls.length}`}
              onPress={() => {
                scroller.current?.scrollTo({ x: index * width, animated: true });
                setPage(index);
              }}
              style={[styles.dot, { width: page === index ? 18 : 7, backgroundColor: page === index ? colors.gold : 'rgba(255,255,255,0.65)' }]}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { width: '100%', height: 250, borderRadius: radius.xl, overflow: 'hidden' },
  dots: { position: 'absolute', bottom: 12, left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', gap: 6 },
  dot: { height: 7, borderRadius: 4 },
});
