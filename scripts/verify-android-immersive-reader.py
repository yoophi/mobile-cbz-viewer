#!/usr/bin/env python3
"""Native regression using only the owned synthetic reader-stress-1 book (id 2).
Requires Metro8084, API36 emulator-5554 and the existing cbz-touch.dex helper.
Never modifies archives; all state changes go through the reader UI.
"""
import argparse,json,pathlib,re,shutil,subprocess,time,xml.etree.ElementTree as ET
p=argparse.ArgumentParser();p.add_argument('--output',required=True);args=p.parse_args()
A='com.yoophi.mobilecbzviewer'; BASE=[shutil.which('adb') or str(pathlib.Path.home()/'Library/Android/sdk/platform-tools/adb'),'-s','emulator-5554']
def adb(*args):return subprocess.check_output(BASE+list(map(str,args)),text=True,stderr=subprocess.DEVNULL)
def nodes():
 for _ in range(4):
  adb('shell','rm','-f','/sdcard/cbz-immersive.xml')
  adb('shell','uiautomator','dump','/sdcard/cbz-immersive.xml')
  try:return list(ET.fromstring(adb('shell','cat','/sdcard/cbz-immersive.xml')).iter('node'))
  except (subprocess.CalledProcessError,ET.ParseError):time.sleep(.2)
 raise AssertionError('No fresh native UI tree')
def box(n):return list(map(int,re.findall(r'\d+',n.get('bounds'))))
def find(label):return next(n for n in nodes() if label in [n.get('text'),n.get('content-desc')])
def tap(label):
 n=find(label);x,y,r,b=box(n);adb('shell','input','tap',(x+r)//2,(y+b)//2);time.sleep(.35)
def count(ui=None):
 ui=ui or nodes()
 counter=next((n.get('text') for n in ui if re.fullmatch(r'\d+(?:–\d+)? / 40',n.get('text',''))),None)
 if counter:return counter
 visible=sorted(int(n.get('content-desc').split()[0]) for n in pages(ui))
 assert visible,'No native page image'
 return (str(visible[0]) if len(visible)==1 else f'{visible[0]}–{visible[-1]}')+' / 40'
def pages(ui=None):return [n for n in (ui or nodes()) if re.fullmatch(r'\d+ 페이지',n.get('content-desc',''))]
def status_visible():return bool(re.search(r'type=statusBars[^\n]*visible=true',adb('shell','dumpsys','window')))
def tools():return any(n.get('content-desc')=='열람 설정' for n in nodes())
def center():adb('shell','input','tap',540,1050);time.sleep(.35)
def edge(side):adb('shell','input','tap',50 if side=='left' else 1030,1050);time.sleep(.4)
def route():adb('shell','am','start','-n',A+'/.MainActivity','-a','android.intent.action.VIEW','-d','mobilecbzviewer://reader/2');time.sleep(.5)
checks=[];observations={}
def check(name,ok):
 assert ok,name
 checks.append(name);print('PASS',name,flush=True)
route()
for _ in range(8):
 if pages():break
 time.sleep(1);route()
ui=nodes();assert any(n.get('text')=='reader-stress-1.cbz' for n in ui) or pages(ui),'Owned synthetic reader not loaded'
if not tools():center()
tap('열람 설정')
ui=nodes()
if any(n.get('content-desc')=='열람 모드: 세로 스크롤' for n in ui):tap('열람 모드: 세로 스크롤')
ui=nodes()
if any(n.get('content-desc')=='읽기 방향: 우→좌' for n in ui):tap('읽기 방향: 우→좌')
tap('열람 설정')
if any(n.get('content-desc')=='페이지 배치: 두 장' for n in nodes()):tap('페이지 배치: 두 장')
# Start at an interior source anchor without editing the database.
current=int(count().split(' /')[0])
for _ in range(abs(current-12)):edge('left' if current>12 else 'right')
before=count();center();check('center tap hides top navigation',not tools());check('hidden navigation hides system status bar',not status_visible())
ui=nodes();rect=box(pages(ui)[0]);check('hidden chrome gives image at least 95 percent of safe height',rect[3]-rect[1]>2200)
check('no visible previous/next text or bottom toolbar',not any(n.get('text') in ['← 이전','다음 →','열람 모드: 페이지','읽기 방향: 좌→우'] for n in ui))
center();check('second center tap shows top navigation',tools());check('visible navigation shows system status bar',status_visible());check('center taps preserve source page',count()==before)
center();edge('right');check('right transparent region advances one page',int(count().split(' /')[0])==int(before.split(' /')[0])+1)
edge('left');check('left transparent region returns one page',count()==before)
# Double taps in a navigation region are zoom gestures, not page advances.
adb('shell','input tap 1030 1050; input tap 1030 1050');time.sleep(.4)
check('edge double tap zooms without advancing',any(n.get('content-desc')=='확대 초기화' for n in nodes()) and count()==before)
adb('shell','input','swipe',1030,1050,650,650,300)
check('zoomed drag preserves page',count()==before)
edge('right');check('zoomed edge tap does not advance',count()==before)
center();check('center can reveal controls while zoomed',tools())
center()
if any(n.get('content-desc')=='확대 초기화' for n in nodes()):tap('확대 초기화')
check('zoom reset or status-bar viewport resize restores image',not any(n.get('content-desc')=='확대 초기화' for n in nodes()))
adb('shell','CLASSPATH=/data/local/tmp/cbz-touch.dex','app_process','/system/bin','TouchProbe',440,1050,640,1050,240,1050,840,1050)
check('native two-finger pinch zooms without page navigation',any(n.get('content-desc')=='확대 초기화' for n in nodes()) and count()==before)
tap('확대 초기화')
center();tap('페이지 배치: 한 장');check('explicit double layout works on narrow phone',len(pages())==2)
ui=nodes();pair=sorted([box(n) for n in pages(ui)],key=lambda r:r[0]);check('two image canvases touch with zero gap',abs(pair[0][2]-pair[1][0])<=1)
check('two images are centered as one spread',abs(pair[0][0]-(1080-pair[1][2]))<=1)
observations['pairBounds']=pair;observations['doubleCounter']=count(ui)
prior=count();center();edge('right');check('double layout advances by a whole pair',int(count().split('–')[0])==int(prior.split('–')[0])+2)
edge('left');check('double layout returns to preceding pair',count()==prior)
center();tap('열람 설정');tap('읽기 방향: 좌→우');tap('열람 설정')
ui=nodes();pair=sorted(pages(ui),key=lambda n:box(n)[0]);check('RTL reverses physical image order',int(pair[0].get('content-desc').split()[0])>int(pair[1].get('content-desc').split()[0]))
center();edge('left');check('RTL left region advances a pair',int(count().split('–')[0])==int(prior.split('–')[0])+2)
# Lifecycle restore includes the explicit layout preference and source anchor.
prior=count();time.sleep(1.2);adb('shell','am','force-stop',A)
adb('shell','am','start','-n',A+'/.MainActivity','-a','android.intent.action.VIEW','-d','exp+mobile-cbz-viewer://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8084');time.sleep(5);route()
for _ in range(8):
 if pages():break
 time.sleep(1);route()
check('restart restores source page and double layout',count()==prior and len(pages())==2)
font=adb('shell','settings','get','system','font_scale').strip()
try:
 adb('shell','settings','put','system','font_scale',2);time.sleep(5);route()
 for _ in range(8):
  if pages():break
  time.sleep(1);route()
 if not tools():center()
 # Header scrolls when text grows, preserving each full size target.
 ui=nodes();check('large-font top navigation remains available',any(n.get('content-desc')=='서재로' for n in ui))
finally:
 adb('shell','settings','put','system','font_scale',font);time.sleep(5);route()
 for _ in range(8):
  if pages():break
  time.sleep(1);route()
if not tools():center()
tap('열람 설정')
if any(n.get('content-desc')=='읽기 방향: 우→좌' for n in nodes()):tap('읽기 방향: 우→좌')
tap('열람 모드: 페이지');check('scroll mode remains available from settings',any(n.get('content-desc')=='세로 스크롤 만화' for n in nodes()))
tap('열람 모드: 세로 스크롤');tap('열람 설정');tap('페이지 배치: 두 장');center()
center();tap('서재로');check('library restores system status bar',status_visible())
pathlib.Path(args.output).write_text(json.dumps({'workingTree':True,'sourceFilesSha256':{p:subprocess.check_output(['shasum','-a','256',p],text=True).split()[0] for p in ['src/components/comic-reader.tsx','src/components/zoom-canvas.tsx','src/utils/page-spread.ts']},'sourceCommit':subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip(),'environment':'owned API36 emulator, 1080x2424, density420; debug development build','checks':checks,'observations':observations},ensure_ascii=False,indent=2)+'\n')
print('ALL',len(checks),'PASS',flush=True)
