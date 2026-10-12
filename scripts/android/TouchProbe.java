import android.os.SystemClock;
import android.view.InputDevice;
import android.view.InputEvent;
import android.view.MotionEvent;
import java.lang.reflect.Method;

/** Shell-only test helper: sends a real two-pointer stream, no app permissions or files. */
public class TouchProbe {
  static Object input;
  static Method inject;
  static long down;
  static void send(int action, float x1, float y1, float x2, float y2, int count) throws Exception {
    MotionEvent.PointerProperties[] properties = new MotionEvent.PointerProperties[count];
    MotionEvent.PointerCoords[] coordinates = new MotionEvent.PointerCoords[count];
    for (int i = 0; i < count; i++) {
      properties[i] = new MotionEvent.PointerProperties(); properties[i].id = i;
      properties[i].toolType = MotionEvent.TOOL_TYPE_FINGER;
      coordinates[i] = new MotionEvent.PointerCoords();
      coordinates[i].x = i == 0 ? x1 : x2; coordinates[i].y = i == 0 ? y1 : y2;
      coordinates[i].pressure = 1; coordinates[i].size = 1;
    }
    MotionEvent event = MotionEvent.obtain(down, SystemClock.uptimeMillis(), action, count,
      properties, coordinates, 0, 0, 1, 1, 0, 0, InputDevice.SOURCE_TOUCHSCREEN, 0);
    try { if (!(Boolean) inject.invoke(input, event, 2)) throw new IllegalStateException("Input injection failed"); }
    finally { event.recycle(); }
  }
  public static void main(String[] args) throws Exception {
    if (args.length != 8) throw new IllegalArgumentException("start x1 y1 x2 y2, end x1 y1 x2 y2");
    Class<?> manager = Class.forName("android.hardware.input.InputManagerGlobal");
    input = manager.getMethod("getInstance").invoke(null);
    inject = manager.getMethod("injectInputEvent", InputEvent.class, int.class);
    float[] p = new float[8]; for (int i = 0; i < 8; i++) p[i] = Float.parseFloat(args[i]);
    down = SystemClock.uptimeMillis();
    send(MotionEvent.ACTION_DOWN, p[0], p[1], p[2], p[3], 1);
    send(MotionEvent.ACTION_POINTER_DOWN | (1 << MotionEvent.ACTION_POINTER_INDEX_SHIFT), p[0], p[1], p[2], p[3], 2);
    for (int i = 1; i <= 30; i++) {
      float t = i / 30f;
      send(MotionEvent.ACTION_MOVE, p[0]+(p[4]-p[0])*t, p[1]+(p[5]-p[1])*t,
        p[2]+(p[6]-p[2])*t, p[3]+(p[7]-p[3])*t, 2);
      SystemClock.sleep(16);
    }
    send(MotionEvent.ACTION_POINTER_UP | (1 << MotionEvent.ACTION_POINTER_INDEX_SHIFT), p[4], p[5], p[6], p[7], 2);
    send(MotionEvent.ACTION_UP, p[4], p[5], p[6], p[7], 1);
    System.out.println("Injected 34 two-pointer events");
  }
}
