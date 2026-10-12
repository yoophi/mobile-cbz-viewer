#!/usr/bin/env python3
"""Check own API36 emulator sample UI at 2x font; restore display settings.
Uses Metro port 8084 and synthetic reader-sample.cbz. No screen reader enabled.
"""
import subprocess,time,xml.etree.ElementTree as E,re,json,pathlib
A='com.yoophi.mobilecbzviewer'
def adb(*a):return subprocess.check_output(['adb',*map(str,a)],text=True)
def nodes():
 for _ in range(3):
  try:
   adb('shell','rm','-f','/sdcard/cbz-a11y.xml')
   adb('shell','uiautomator','dump','/sdcard/cbz-a11y.xml')
   return list(E.fromstring(adb('shell','cat','/sdcard/cbz-a11y.xml')).iter('node'))
  except (subprocess.CalledProcessError,E.ParseError):time.sleep(.2)
 raise AssertionError('Fresh UI unavailable')
def wait(label):
 for _ in range(30):
  ns=nodes()
  if any(label in [n.get('text'),n.get('content-desc')] for n in ns):return ns
  time.sleep(.3)
 raise AssertionError(label)
def rect(n):return list(map(int,re.findall(r'\d+',n.get('bounds'))))
def tap(label):
 n=next(n for n in nodes() if label in [n.get('text'),n.get('content-desc')]);x,y,xx,yy=rect(n)
 adb('shell','input','tap',(x+xx)//2,(y+yy)//2)
assert adb('shell','getprop','ro.kernel.qemu').strip()=='1', 'Emulator only'
assert adb('shell','getprop','ro.build.version.sdk').strip()=='36', 'API36 required'
font=adb('shell','settings','get','system','font_scale').strip();sz=adb('shell','wm','size');ov=re.search(r'Override size: (\d+x\d+)',sz)
checks=[];obs=[]
def check(s,b):
 assert b,s
 checks.append(s);print('PASS',s,flush=True)
try:
 adb('shell','settings','put','system','font_scale',2)
 adb('shell','wm','size','840x1100')
 adb('reverse','tcp:8084','tcp:8084')
 adb('shell','am','force-stop',A)
 adb('shell','am','start','-a','android.intent.action.VIEW','-d','exp+mobile-cbz-viewer://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8084',A)
 wait('나의 만화 서재')
 for _ in range(18):
  ns=nodes()
  if any(n.get('content-desc')=='reader-sample.cbz 열기' for n in ns):break
  adb('shell','input','swipe',420,920,420,250,500)
 else:raise AssertionError('Library sample not reachable')
 check('Large-font short library scroll reaches sample open control',True)
 tap('reader-sample.cbz 열기')
 wait('서재로')
 ns=nodes();pages=[n for n in ns if re.fullmatch(r'[1-3] 페이지',n.get('content-desc',''))]
 check('Reader retains visible image viewport with 2x font in short window',bool(pages) and rect(pages[0])[3]-rect(pages[0])[1]>150)
 labels=set()
 for _ in range(6):
  ns=nodes();labels.update(n.get('content-desc','') for n in ns)
  controls=[n for n in ns if n.get('scrollable')=='true']
  if not controls:break
  assert controls[-1].get('package')==A, 'App must stay foreground while scrolling'
  x,y,xx,yy=rect(controls[-1]);adb('shell','input','swipe',(x+xx)//2,yy-100,(x+xx)//2,y+60,450)
 check('Scrollable toolbar exposes mode and direction at large font',any('열람 모드:' in s for s in labels) and any('읽기 방향:' in s for s in labels))
 check('Scrollable toolbar exposes current page and navigation',any(s.startswith('현재 ') for s in labels) and any('다음' in s for s in labels) and any('이전' in s for s in labels))
 check('App stays foreground after toolbar scroll', A in adb('shell','dumpsys','activity','activities').split('topResumedActivity=')[1].split('\n')[0])
 obs.append({'fontScale':2,'window':'840x1100','pages':[n.attrib for n in pages],'toolbarLabels':sorted(labels)})
 pathlib.Path('/tmp/cbz-a11y-reader.png').write_bytes(subprocess.check_output(['adb','exec-out','screencap','-p']))
 adb('shell','input','keyevent','KEYCODE_BACK')
 check('Android hardware back returns to library after opening a book',any(n.get('content-desc')=='reader-sample.cbz 열기' for n in wait('reader-sample.cbz 열기')))
 pathlib.Path('/tmp/cbz-large-font-result.json').write_text(json.dumps({'sourceBaseCommit':subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip(),'sourceChanges':['src/app/index.tsx','src/components/comic-reader.tsx','src/app/_layout.tsx','src/hooks/use-reduced-motion.ts'],'checks':checks,'observations':obs},ensure_ascii=False,indent=2))
finally:
 adb('shell','settings','put','system','font_scale',font)
 adb('shell','wm','size',ov[1] if ov else 'reset')
