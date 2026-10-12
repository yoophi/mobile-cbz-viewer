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
  static int injectionMode = 2;
  static void send(int action, float x1, float y1, float x2, float y2, int count) throws Exception {
    MotionEvent.PointerProperties[] properties = new MotionEvent.PointerProperties[count];
    MotionEvent.PointerCoords[] coordinates = new MotionEvent.PointerCoords[count];
    for (int i = 0; i < count; i++) {
      properties[i] = new MotionEvent.PointerProperties(); properties[i].id = i;
      properties[i].toolType = MotionEvent.TOOL_TYPE_FINGER;
      coordinates[i] = new MotionEvent.PointerCoords();
      coordinates[i].x = i == 0 ? x1 : i == 1 ? x2 : (x1+x2)/2;
      coordinates[i].y = i == 0 ? y1 : i == 1 ? y2 : (y1+y2)/2+150;
      coordinates[i].pressure = 1; coordinates[i].size = 1;
    }
    MotionEvent event = MotionEvent.obtain(down, SystemClock.uptimeMillis(), action, count,
      properties, coordinates, 0, 0, 1, 1, 0, 0, InputDevice.SOURCE_TOUCHSCREEN, 0);
    try { if (!(Boolean) inject.invoke(input, event, injectionMode)) throw new IllegalStateException("Input injection failed"); }
    finally { event.recycle(); }
  }
  public static void main(String[] args) throws Exception {
    if (args.length < 8) throw new IllegalArgumentException("start x1 y1 x2 y2, end x1 y1 x2 y2 [--third] [--slow] [--fling]");
    boolean third = false, slow = false, fling = false;
    for (int i = 8; i < args.length; i++) {
      if (args[i].equals("--third")) third = true;
      else if (args[i].equals("--slow")) slow = true;
      else if (args[i].equals("--fling")) fling = true;
      else throw new IllegalArgumentException("Unknown flag: " + args[i]);
    }
    Class<?> manager = Class.forName("android.hardware.input.InputManagerGlobal");
    input = manager.getMethod("getInstance").invoke(null);
    inject = manager.getMethod("injectInputEvent", InputEvent.class, int.class);
    float[] p = new float[8]; for (int i = 0; i < 8; i++) p[i] = Float.parseFloat(args[i]);
    if (fling) {
      float x=(p[0]+p[2])/2, y=(p[1]+p[3])/2;
      // Queue this fast stream without a WAIT_FOR_FINISH pause at each MOVE.
      // The verifier requires native momentum and movement, not this marker.
      injectionMode = 0;
      down = SystemClock.uptimeMillis();
      send(MotionEvent.ACTION_DOWN, x,y+500,0,0,1);
      for (int i=1; i<=10; i++) { send(MotionEvent.ACTION_MOVE,x,y+500-i*100,0,0,1); SystemClock.sleep(8); }
      System.out.println("FLING_UP_STARTED:" + System.currentTimeMillis());
      send(MotionEvent.ACTION_UP,x,y-500,0,0,1);
      System.out.println("FLING_UP_QUEUED:" + System.currentTimeMillis());
      injectionMode = 2;
      SystemClock.sleep(180);
    }
    down = SystemClock.uptimeMillis();
    if (fling) System.out.println("PINCH_FIRST_DOWN:" + System.currentTimeMillis());
    send(MotionEvent.ACTION_DOWN, p[0], p[1], p[2], p[3], 1);
    send(MotionEvent.ACTION_POINTER_DOWN | (1 << MotionEvent.ACTION_POINTER_INDEX_SHIFT), p[0], p[1], p[2], p[3], 2);
    for (int i = 1; i <= 30; i++) {
      float t = i / 30f;
      float x1=p[0]+(p[4]-p[0])*t, y1=p[1]+(p[5]-p[1])*t;
      float x2=p[2]+(p[6]-p[2])*t, y2=p[3]+(p[7]-p[3])*t;
      if (third && i == 10) send(MotionEvent.ACTION_POINTER_DOWN | (2 << MotionEvent.ACTION_POINTER_INDEX_SHIFT), x1,y1,x2,y2,3);
      if (third && i == 20) send(MotionEvent.ACTION_POINTER_UP | (2 << MotionEvent.ACTION_POINTER_INDEX_SHIFT), x1,y1,x2,y2,3);
      send(MotionEvent.ACTION_MOVE, x1,y1,x2,y2,third && i >= 10 && i < 20 ? 3 : 2);
      if (slow && i == 5) {
        System.out.println("ACTIVE_TWO_POINTERS"); System.out.flush();
      }
      SystemClock.sleep(slow ? 100 : 16);
    }
    send(MotionEvent.ACTION_POINTER_UP | (1 << MotionEvent.ACTION_POINTER_INDEX_SHIFT), p[4], p[5], p[6], p[7], 2);
    send(MotionEvent.ACTION_UP, p[4], p[5], p[6], p[7], 1);
    System.out.println("Injected " + (third ? 36 : 34) + " multi-pointer events");
  }
}
