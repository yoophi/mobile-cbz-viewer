import { useMemo, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { boundZoom, containSize, focalZoom, IDENTITY_ZOOM, type ZoomSize, type ZoomTransform } from '@/utils/zoom';

export type ZoomScrollControls = { scrollGesture: ReturnType<typeof Gesture.Native>; scrollEnabled: boolean };
type ZoomChildren = ReactNode | ((controls: ZoomScrollControls) => ReactNode);

function SizedZoom({ size, image, children, onSettled }: { size: ZoomSize; image?: ZoomSize; children: ZoomChildren; onSettled?: (value: ZoomTransform) => void }) {
  const content = containSize(size, image);
  const transform = useSharedValue(IDENTITY_ZOOM);
  const start = useSharedValue(IDENTITY_ZOOM);
  const focal = useSharedValue({ x: 0, y: 0 });
  const pointerCount = useSharedValue(0);
  const gestureScale = useSharedValue(1);
  const pinching = useSharedValue(false);
  const [zoomed, setZoomed] = useState(false);
  const [pinchPending, setPinchPending] = useState(false);
  const scrollGesture = useMemo(() => Gesture.Native().shouldCancelWhenOutside(false), []);
  const scrollable = typeof children === 'function';
  const pinch = Gesture.Pinch().onTouchesDown((event) => {
    if (scrollable && event.numberOfTouches >= 2) scheduleOnRN(setPinchPending, true);
  }).onStart((event) => {
    pinching.value = true;
    start.value = transform.value;
    pointerCount.value = event.numberOfPointers;
    gestureScale.value = event.scale;
    focal.value = { x: event.focalX - size.width / 2, y: event.focalY - size.height / 2 };
  }).onUpdate((event) => {
    // Android emits a last update with one remaining pointer on POINTER_UP.
    // Its centroid jumps to that finger; it must not shift the zoomed image.
    if (event.numberOfPointers < 2) return;
    // Adding/removing a third finger changes the native centroid and scale
    // baseline. Re-anchor the unchanged transform instead of jumping to it.
    if (pointerCount.value !== event.numberOfPointers) {
      pointerCount.value = event.numberOfPointers;
      start.value = transform.value;
      gestureScale.value = event.scale;
      focal.value = { x: event.focalX - size.width / 2, y: event.focalY - size.height / 2 };
      return;
    }
    transform.value = focalZoom(start.value, focal.value,
      { x: event.focalX - size.width / 2, y: event.focalY - size.height / 2 },
      start.value.scale * event.scale / gestureScale.value, size, content);
  }).onFinalize(() => {
    pinching.value = false;
    scheduleOnRN(setPinchPending, false);
    scheduleOnRN(setZoomed, transform.value.scale > 1);
    if (onSettled) scheduleOnRN(onSettled, transform.value);
  });
  const pan = Gesture.Pan().maxPointers(1).manualActivation(true)
    .onTouchesMove((_event, manager) => {
      if (transform.value.scale > 1 && !pinching.value) manager.activate();
      else manager.fail();
    }).onChange((event) => {
      if (pinching.value) return;
      const previous = transform.value;
      transform.value = boundZoom({ ...previous, x: previous.x + event.changeX, y: previous.y + event.changeY }, size, content);
    }).onFinalize(() => { if (onSettled) scheduleOnRN(onSettled, transform.value); });
  const doubleTap = Gesture.Tap().numberOfTaps(2)
    .onTouchesDown((event, manager) => { if (event.numberOfTouches > 1) manager.fail(); })
    .onEnd((event, success) => {
    if (!success) return;
    const previous = transform.value;
    const point = { x: event.x - size.width / 2, y: event.y - size.height / 2 };
    transform.value = previous.scale > 1 ? IDENTITY_ZOOM : focalZoom(previous, point, point, 2.5, size, content);
    scheduleOnRN(setZoomed, transform.value.scale > 1);
    if (onSettled) scheduleOnRN(onSettled, transform.value);
  });
  if (scrollable) {
    // Native FlatList must yield to pinch and zoomed pan. Pan fails immediately
    // at 1x, so ordinary one-finger scrolling stays available.
    pinch.blocksExternalGesture(scrollGesture);
    pan.blocksExternalGesture(scrollGesture);
    doubleTap.simultaneousWithExternalGesture(scrollGesture);
  }
  const animatedStyle = useAnimatedStyle(() => ({ transform: [
    { translateX: transform.value.x }, { translateY: transform.value.y }, { scale: transform.value.scale },
  ] }));
  return <View style={styles.fill}>
    <GestureDetector gesture={Gesture.Simultaneous(pinch, pan, doubleTap)}>
      <View style={styles.fill} collapsable={false}>
        <Animated.View style={[styles.fill, animatedStyle]}>{typeof children === 'function'
          ? children({ scrollGesture, scrollEnabled: !zoomed && !pinchPending }) : children}</Animated.View>
      </View>
    </GestureDetector>
    {zoomed ? <Pressable accessibilityRole="button" accessibilityLabel="확대 초기화"
      onPress={() => { transform.set(IDENTITY_ZOOM); setZoomed(false); onSettled?.(IDENTITY_ZOOM); }} style={styles.reset}>
      <Text style={styles.text}>확대 초기화</Text>
    </Pressable> : null}
  </View>;
}

// A new page/mode gets a new instance; a size change remounts only the gesture
// layer. Neither gesture changes the reading index or writes reading state.
export function ZoomCanvas({ image, children, onSettled, resetKey = '' }: {
  image?: ZoomSize; children: ZoomChildren; onSettled?: (value: ZoomTransform) => void; resetKey?: string;
}) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  return <View style={[styles.fill, styles.clip]} onLayout={({ nativeEvent: { layout } }) => {
    setSize((previous) => previous.width === layout.width && previous.height === layout.height ? previous : { width: layout.width, height: layout.height });
  }}>
    {size.width > 0 && size.height > 0 ? <SizedZoom key={`${size.width}:${size.height}:${resetKey}`} size={size} image={image} onSettled={onSettled}>{children}</SizedZoom> : null}
  </View>;
}
const styles = StyleSheet.create({
  fill: { flex: 1, width: '100%' }, clip: { overflow: 'hidden' },
  reset: { position: 'absolute', left: 8, top: 8, minHeight: 48, justifyContent: 'center', paddingHorizontal: 12, borderRadius: 8, backgroundColor: '#243858' },
  text: { color: '#f4f7fc' },
});
