#!/usr/bin/env python3
"""Verify native scroll/zoom arbitration on own synthetic reader-stress-1 book id 2.
Requires an active development app/Metro and the compiled TouchProbe dex described
in docs/page-zoom.md. This script changes only reading state through normal UI.
"""
import json, pathlib, re, sqlite3, subprocess, tempfile, time, xml.etree.ElementTree as ET
APP='com.yoophi.mobilecbzviewer'
def adb(*args): return subprocess.check_output(['adb',*map(str,args)],text=True)
def nodes():
    adb('shell','uiautomator','dump','/sdcard/cbz-scroll-zoom.xml')
    return list(ET.fromstring(adb('shell','cat','/sdcard/cbz-scroll-zoom.xml')).iter('node'))
def tap(label):
    n=next(n for n in nodes() if n.get('content-desc')==label and n.get('enabled')=='true')
    x1,y1,x2,y2=map(int,re.findall(r'\d+',n.get('bounds')))
    adb('shell','input','tap',(x1+x2)//2,(y1+y2)//2)
def saved():
    time.sleep(1.3)
    with tempfile.TemporaryDirectory(prefix='cbz-scroll-zoom-') as folder:
        path=pathlib.Path(folder)/'library.db'
        for suffix in ['','-wal']:
            try:
                data=subprocess.check_output(['adb','exec-out','run-as',APP,'cat','files/SQLite/library.db'+suffix],stderr=subprocess.DEVNULL)
                pathlib.Path(str(path)+suffix).write_bytes(data)
            except subprocess.CalledProcessError:
                if not suffix: raise
        db=sqlite3.connect(f'file:{path}?mode=ro',uri=True)
        try: row=db.execute('SELECT pageIndex,fraction,mode,direction FROM comic_reading_state WHERE comicId=2').fetchone()
        finally: db.close()
        return dict(zip(['index','fraction','mode','direction'],row))
def zoomed(): return any(n.get('content-desc')=='확대 초기화' for n in nodes())
def pinch(moving=False, third=False):
    adb('shell','CLASSPATH=/data/local/tmp/cbz-touch.dex','app_process','/system/bin','TouchProbe',440,1000,640,1000,240,700 if moving else 1000,840,700 if moving else 1000,*(['--third'] if third else []))
def same(a,b): return a['index']==b['index'] and abs(a['fraction']-b['fraction'])<.0001 and a['mode']==b['mode'] and a['direction']==b['direction']
checks=[]
def record(name,passed):
    if not passed: raise AssertionError(name)
    checks.append(name)

adb('shell','am','start','-a','android.intent.action.VIEW','-d','mobilecbzviewer://reader/2',APP)
for _ in range(20):
    ui=nodes()
    if any(n.get('text')=='reader-stress-1.cbz' for n in ui) and any(re.fullmatch(r'\d+ / 40',n.get('text','')) for n in ui): break
    time.sleep(.3)
else: raise AssertionError('Expected own synthetic 40-page reader')
if any(n.get('content-desc')=='열람 모드: 페이지' for n in ui): tap('열람 모드: 페이지')
# Navigate to an interior anchor via normal UI, avoiding an end-of-book no-op scroll.
ui=nodes(); button=next(n.get('content-desc') for n in ui if n.get('clickable')=='true' and n.get('enabled')=='true' and n.get('content-desc') in ['← 이전','이전 →'])
tap(button)
before=saved(); assert before['mode']=='scroll'
adb('shell','input','swipe',540,1500,540,850,450)
after=saved(); record('base one-finger scroll changes source position',not same(before,after))
before=after
pinch(True)
record('two-finger moving pinch activates zoom without scrolling',zoomed() and same(before,saved()))
for start,end in [((540,1450),(540,600)),((540,600),(30,1650)),((900,1400),(1050,300))]:
    adb('shell','input','swipe',*start,*end,180)
    record(f'zoom remains active after drag {start} to {end}',zoomed())
record('zoomed vertical and edge drags preserve source position',same(before,saved()))
pinch(third=True)
record('adding and removing third finger preserves source position and zoom',zoomed() and same(before,saved()))
tap('확대 초기화'); record('explicit reset returns to base scale',not zoomed())
adb('shell','input','swipe',540,1500,540,850,450)
after=saved(); record('one-finger scrolling resumes after reset',not same(before,after))
before=after
adb('shell','input tap 540 1000; input tap 540 1000')
record('scroll mode double-tap zoom activates',zoomed())
adb('shell','input','swipe',540,1400,540,500,180)
record('double-tap zoom also locks native scrolling',same(before,saved()))
adb('shell','input tap 540 1000; input tap 540 1000')
record('double-tap reset restores scrolling scale',not zoomed())
pinch()
ui=nodes(); button=next(n.get('content-desc') for n in ui if n.get('clickable')=='true' and n.get('enabled')=='true' and n.get('content-desc') in ['다음 →','← 다음'])
before=saved(); tap(button); after=saved()
record('explicit scroll page navigation resets zoom and moves to requested page',not zoomed() and after['index']==before['index']+1 and after['fraction']<.001)
pinch(); tap('열람 모드: 세로 스크롤')
record('mode change resets zoom',not zoomed() and saved()['mode']=='page')
tap('열람 모드: 페이지')
record('return to scroll keeps source anchor with base zoom',not zoomed() and saved()['mode']=='scroll')
# Restore the user's rotation settings even when any assertion fails.
rotation = adb('shell','settings','get','system','user_rotation').strip()
auto_rotation = adb('shell','settings','get','system','accelerometer_rotation').strip()
def orientation(landscape):
    for _ in range(20):
        ui = nodes()
        scroll = next((n for n in ui if n.get('content-desc') == '세로 스크롤 만화'), None)
        if scroll is not None:
            x1,y1,x2,y2 = map(int,re.findall(r'\d+',scroll.get('bounds')))
            if ((x2-x1) > (y2-y1)) == landscape: return ui
        time.sleep(.2)
    raise AssertionError('Reader viewport did not rotate')
try:
    adb('shell','settings','put','system','accelerometer_rotation',0)
    adb('shell','settings','put','system','user_rotation',0)
    orientation(False)
    previous = saved()
    adb('shell','input','swipe',540,1500,540,1100,600)
    before = saved()
    record('rotation probe starts inside a source page',not same(previous,before) and 0 < before['fraction'] < .95)
    pinch(); assert zoomed(), 'Expected portrait zoom before rotation'
    adb('shell','settings','put','system','user_rotation',1)
    orientation(True)
    record('landscape rotation resets scroll zoom',not zoomed())
    after = saved()
    if not same(before,after): raise AssertionError(f'Landscape anchor changed: {before} -> {after}')
    record('landscape rotation preserves source anchor and settings',True)
    # Actual double tap in the newly sized landscape viewport.
    scroll = next(n for n in nodes() if n.get('content-desc') == '세로 스크롤 만화')
    x1,y1,x2,y2 = map(int,re.findall(r'\d+',scroll.get('bounds')))
    x,y = (x1+x2)//2,(y1+y2)//2
    adb('shell',f'input tap {x} {y}; input tap {x} {y}')
    assert zoomed(), 'Expected landscape zoom before rotation'
    adb('shell','settings','put','system','user_rotation',0)
    orientation(False)
    record('portrait rotation resets landscape zoom',not zoomed())
    record('portrait rotation preserves source anchor and settings',same(before,saved()))
    adb('shell','input','swipe',540,1500,540,1100,600)
    record('native scrolling resumes after rotation restoration',not same(before,saved()))
finally:
    for key,value in [('user_rotation',rotation),('accelerometer_rotation',auto_rotation)]:
        if value == 'null': adb('shell','settings','delete','system',key)
        else: adb('shell','settings','put','system',key,value)
print(json.dumps({'platform':'Android emulator API36','passed':len(checks),'checks':checks},ensure_ascii=False,indent=2))
