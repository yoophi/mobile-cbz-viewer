import android.app.UiAutomation;
import android.os.HandlerThread;
import android.os.Looper;
import android.graphics.Rect;
import android.os.SystemClock;
import android.view.InputEvent;
import android.view.InputDevice;
import android.view.MotionEvent;
import android.view.accessibility.AccessibilityNodeInfo;
import org.json.JSONArray;
import org.json.JSONObject;
/** API36 shell-only accessibility probe. Keeps existing services enabled; no app permissions. */
public class AccessibilityProbe {
 static boolean focusedOnce=false;
 static boolean focusConfirmed=false;
 static void walk(AccessibilityNodeInfo n,JSONArray out,String focus) throws Exception {
  if(n==null)return;
  Rect r=new Rect();n.getBoundsInScreen(r);
  String text=n.getText()==null?"":n.getText().toString();
  String desc=n.getContentDescription()==null?"":n.getContentDescription().toString();
  if(!focusedOnce&&focus!=null&&(focus.equals(text)||focus.equals(desc))) {
   if(!n.isAccessibilityFocused()&&!n.performAction(AccessibilityNodeInfo.ACTION_ACCESSIBILITY_FOCUS))throw new IllegalStateException("Cannot focus "+focus);
   focusedOnce=true;
   for(int i=0;i<10&&!n.isAccessibilityFocused();i++){Thread.sleep(50);n.refresh();}
   focusConfirmed=n.isAccessibilityFocused();
  }
  out.put(new JSONObject().put("text",text).put("content-desc",desc).put("package",String.valueOf(n.getPackageName())).put("bounds","["+r.left+","+r.top+"]["+r.right+","+r.bottom+"]").put("heading",n.isHeading()).put("visible",n.isVisibleToUser()).put("class",String.valueOf(n.getClassName())).put("accessibilityFocused",n.isAccessibilityFocused()).put("enabled",n.isEnabled()).put("scrollable",n.isScrollable()).put("clickable",n.isClickable()));
  for(int i=0;i<n.getChildCount();i++)walk(n.getChild(i),out,focus);
 }
 public static void main(String[] args) throws Exception {
  Looper.prepareMainLooper();
  HandlerThread thread=new HandlerThread("cbz-a11y");thread.start();
  UiAutomation ui=null;
  try {
   Object connection=Class.forName("android.app.UiAutomationConnection").getDeclaredConstructor().newInstance();
   ui=(UiAutomation)UiAutomation.class.getDeclaredConstructor(Looper.class,Class.forName("android.app.IUiAutomationConnection")).newInstance(thread.getLooper(),connection);
   UiAutomation.class.getMethod("connect",int.class).invoke(ui,UiAutomation.FLAG_DONT_SUPPRESS_ACCESSIBILITY_SERVICES);
   AccessibilityNodeInfo root=null;
   for(int i=0;i<20&&root==null;i++){root=ui.getRootInActiveWindow();if(root==null)Thread.sleep(100);}
   if(root==null)throw new IllegalStateException("No active accessibility window");
   JSONArray out=new JSONArray();walk(root,out,args.length>0&&!args[0].equals("--next")?args[0]:null);
   if(args.length>1&&args[1].equals("--double-tap")) {
    if(!focusConfirmed)throw new IllegalStateException("Target is not accessibility focused");
    Thread.sleep(200);
    for(int tap=0;tap<2;tap++) {
     long down=SystemClock.uptimeMillis();
     for(int action:new int[]{MotionEvent.ACTION_DOWN,MotionEvent.ACTION_UP}) {
      MotionEvent e=MotionEvent.obtain(down,SystemClock.uptimeMillis(),action,540,1200,0);
      e.setSource(InputDevice.SOURCE_TOUCHSCREEN);
      try { UiAutomation.class.getMethod("injectInputEventToInputFilter",InputEvent.class).invoke(ui,e); }
      finally {e.recycle();}
      Thread.sleep(40);
     }
     Thread.sleep(80);
    }
    Thread.sleep(800);
   }
   if(args.length>0&&args[0].equals("--next")) {
    long down=SystemClock.uptimeMillis();
    for(int i=0;i<=12;i++) {
     int action=i==0?MotionEvent.ACTION_DOWN:i==12?MotionEvent.ACTION_UP:MotionEvent.ACTION_MOVE;
     MotionEvent e=MotionEvent.obtain(down,SystemClock.uptimeMillis(),action,300+i*40,1200,0);
     e.setSource(InputDevice.SOURCE_TOUCHSCREEN);
     try {UiAutomation.class.getMethod("injectInputEventToInputFilter",InputEvent.class).invoke(ui,e);}
     finally {e.recycle();}
     Thread.sleep(16);
    }
    Thread.sleep(700);
    out=new JSONArray();walk(ui.getRootInActiveWindow(),out,null);
   }
   System.out.println(out);
  } finally {
   if(ui!=null)UiAutomation.class.getMethod("disconnect").invoke(ui);
   thread.quitSafely();
  }
 }
}
