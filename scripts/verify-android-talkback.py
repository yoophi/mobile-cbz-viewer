#!/usr/bin/env python3
"""Exercise TalkBack on own API36 Pixel9 emulator and synthetic sample id1.
Requires AccessibilityProbe dex, Metro8084, 1080x2424/density420/font1.
Temporarily enables TalkBack and restores accessibility service settings.
"""
import argparse,shlex,sqlite3,tempfile,subprocess,time,xml.etree.ElementTree as E,re,json,pathlib
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--output',type=pathlib.Path,required=True)
args=parser.parse_args()
A='com.yoophi.mobilecbzviewer'
def adb(*a):return subprocess.check_output(['adb',*map(str,a)],text=True)
def nodes():
 data=adb('shell','CLASSPATH=/data/local/tmp/cbz-accessibility.dex','app_process','/','AccessibilityProbe')
 return [E.Element('node',{k:str(v).lower() if isinstance(v,bool) else str(v) for k,v in n.items()}) for n in json.loads(data)]
def wait(label):
 for _ in range(30):
  ns=nodes()
  if any(label in [n.get('text'),n.get('content-desc')] for n in ns):return ns
  time.sleep(.3)
 raise AssertionError(label)
def ready(label):
 for _ in range(30):
  ns=nodes()
  if any(label==n.get('content-desc') and n.get('enabled')=='true' for n in ns):return ns
  time.sleep(.3)
 raise AssertionError('Enabled control missing: '+label)
def focus(label):
 for _ in range(3):
  data=adb('shell','CLASSPATH=/data/local/tmp/cbz-accessibility.dex','app_process','/','AccessibilityProbe',shlex.quote(label))
  fs=[n for n in json.loads(data) if n['accessibilityFocused'] and label in [n['text'],n['content-desc']]]
  if len(fs)==1:return fs[0]
  time.sleep(.3)
 raise AssertionError('Stable accessibility focus missing: '+label)
def rect(n):return list(map(int,re.findall(r'\d+',n.get('bounds'))))
def tap(label):
 n=next(n for n in nodes() if label in [n.get('text'),n.get('content-desc')]);x,y,xx,yy=rect(n)
 adb('shell','input','tap',(x+xx)//2,(y+yy)//2)

assert adb('shell','getprop','ro.kernel.qemu').strip()=='1'
assert adb('shell','getprop','ro.build.version.sdk').strip()=='36'
assert 'Override size' not in adb('shell','wm','size') and '1080x2424' in adb('shell','wm','size')
assert adb('shell','settings','get','system','font_scale').strip()=='1.0'
assert '420' in adb('shell','wm','density')
with tempfile.TemporaryDirectory(prefix='cbz-a11y-fixture-') as folder:
 path=pathlib.Path(folder)/'library.db'
 for suffix in ['', '-wal']:
  try: pathlib.Path(str(path)+suffix).write_bytes(subprocess.check_output(['adb','exec-out','run-as',A,'cat','files/SQLite/library.db'+suffix],stderr=subprocess.DEVNULL))
  except subprocess.CalledProcessError:
   if not suffix:raise
 db=sqlite3.connect(f'file:{path}?mode=ro',uri=True)
 try:assert db.execute('SELECT name,pageCount FROM comics WHERE id=1').fetchone()==('reader-sample.cbz',3)
 finally:db.close()
services=adb('shell','settings','get','secure','enabled_accessibility_services').strip()
enabled=adb('shell','settings','get','secure','accessibility_enabled').strip()
checks=[];observations=[]
def check(name,value):
 assert value,name
 checks.append(name);print('PASS '+name,flush=True)
def bound():
 state=adb('shell','dumpsys','accessibility')
 assert 'label=TalkBack,' in state.split('Bound services:')[1].split('Enabled services:')[0]
 assert 'Crashed services:{}' in state
 return True
def activate(label):
 bound()
 data=adb('shell','CLASSPATH=/data/local/tmp/cbz-accessibility.dex','app_process','/','AccessibilityProbe',shlex.quote(label), "--double-tap")
 focused=[n for n in json.loads(data) if n['accessibilityFocused'] and label in [n['text'],n['content-desc']]]
 assert focused,'Accessibility focus missing: '+label
 observations.append({'action':label,'focusedBeforeGesture':focused[0],'serviceBoundAfterGesture':bound()})
 time.sleep(.6)
try:
 adb('shell','am','force-stop',A)
 adb('shell','am','start','-a','android.intent.action.VIEW','-d','exp+mobile-cbz-viewer://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8084',A)
 wait('나의 만화 서재')
 for _ in range(15):
  ns=nodes()
  if any(n.get('content-desc')=='reader-sample.cbz 열기' for n in ns):break
  adb('shell','input','swipe',540,1700,540,700,400)
 else:raise AssertionError('Own sample unavailable')
 tap('reader-sample.cbz 열기')
 wait('서재로')
 for _ in range(30):
  ns=nodes()
  if any(re.fullmatch(r'현재 [1-3] 페이지, 전체 3 페이지',n.get('content-desc','')) for n in ns):break
  time.sleep(.3)
 else:raise AssertionError('Expected loaded synthetic reader')
 if any(n.get('content-desc')=='열람 모드: 세로 스크롤' for n in ns):
  tap('열람 모드: 세로 스크롤');wait('열람 모드: 페이지')
 ns=nodes()
 if any(n.get('content-desc')=='읽기 방향: 좌→우' for n in ns):
  tap('읽기 방향: 좌→우');wait('읽기 방향: 우→좌')
 for _ in range(3):
  ns=nodes()
  if any(n.get('content-desc')=='현재 3 페이지, 전체 3 페이지' for n in ns):break
  tap('← 다음')
 else:raise AssertionError('Could not establish page3 start anchor')
 tap('서재로');wait('reader-sample.cbz 열기')
 service='com.google.android.marvin.talkback/com.google.android.marvin.talkback.TalkBackService'
 adb('shell','settings','put','secure','enabled_accessibility_services', service if services=='null' else services+':'+service)
 adb('shell','settings','put','secure','accessibility_enabled',1)
 time.sleep(3)
 state=adb('shell','dumpsys','accessibility')
 check('TalkBack service is bound', 'label=TalkBack,' in state.split('Bound services:')[1].split('Enabled services:')[0] and 'Crashed services:{}' in state)
 ns=nodes()
 if any(n.get('text')=='Don’t allow' for n in ns):
  activate('Don’t allow');time.sleep(1)

 activate('reader-sample.cbz 열기')
 wait('서재로')
 check('TalkBack focus and double-tap opens own sample',True)
 ns=nodes()
 check('Current page exposes anchor and total to accessibility',any(n.get('content-desc')=='현재 3 페이지, 전체 3 페이지' for n in ns))
 activate('이전 →');wait('현재 2 페이지, 전체 3 페이지')
 check('TalkBack page navigation changes displayed image and current page',any(n.get('content-desc')=='2 페이지' for n in nodes()))
 # Begin on the book heading and follow actual TalkBack next gestures.
 data=adb('shell','CLASSPATH=/data/local/tmp/cbz-accessibility.dex','app_process','/','AccessibilityProbe',shlex.quote('reader-sample.cbz'))
 focused=[n for n in json.loads(data) if n['accessibilityFocused']]
 check('Book title is an accessible heading',len(focused)==1 and focused[0]['heading'])
 order=[]
 for _ in range(6):
  data=adb('shell','CLASSPATH=/data/local/tmp/cbz-accessibility.dex','app_process','/','AccessibilityProbe','--next')
  fs=[n for n in json.loads(data) if n['accessibilityFocused']]
  assert len(fs)==1,'Single accessibility focus expected'
  order.append(fs[0]['content-desc'] or fs[0]['text'])
  bound()
 observations.append({'readerForwardFocusOrder':order})
 check('TalkBack sequential traversal reaches page and all reader controls',order==['2 페이지','열람 모드: 페이지','읽기 방향: 우→좌','현재 2 페이지, 전체 3 페이지','← 다음','이전 →'])
 activate('열람 모드: 페이지')
 wait('열람 모드: 세로 스크롤')
 check('TalkBack changes reading mode',True)
 activate('열람 모드: 세로 스크롤')
 wait('열람 모드: 페이지')
 activate('읽기 방향: 우→좌')
 wait('읽기 방향: 좌→우')
 check('TalkBack changes reading direction',True)
 activate('서재로')
 ready('reader-sample.cbz 열기')
 check('TalkBack returns to library',True)
 focus('reader-sample.cbz 열기')
 data=adb('shell','CLASSPATH=/data/local/tmp/cbz-accessibility.dex','app_process','/','AccessibilityProbe','--next')
 fs=[n for n in json.loads(data) if n['accessibilityFocused']]
 check('TalkBack next gesture reaches library delete control',len(fs)==1 and fs[0]['content-desc']=='reader-sample.cbz 삭제')
 observations.append({'libraryDeleteForwardFocus':fs[0],'serviceBound':bound()})
 activate('reader-sample.cbz 삭제')
 wait('만화를 삭제할까요?')
 activate('취소')
 wait('reader-sample.cbz 열기')
 check('TalkBack opens delete confirmation and cancels without deleting source',True)
 args.output.write_text(json.dumps({'sourceCommit':subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip(),'checks':checks,'observations':observations,'scope':'Android API36 Pixel9 emulator, synthetic sample id1, normal font; actual TalkBack input-filter gestures, explicit initial accessibility focus; no speech-output capture or iOS proof'},ensure_ascii=False,indent=2)+'\n')
finally:
 for key,value in [('enabled_accessibility_services',services),('accessibility_enabled',enabled)]:
  adb('shell','settings','delete','secure',key) if value=='null' else adb('shell','settings','put','secure',key,value)
