#!/usr/bin/env python3
"""Verify rotation during a native two-pointer stream on own synthetic reader-stress-1 book id 2.
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
def check(name, passed):
    if not passed: raise AssertionError(name)
    checks.append(name)
    print('PASS '+name,flush=True)
def rotated(rotation):
    output=adb('shell','dumpsys','window','displays')
    return re.search(r'^    mRotation='+str(rotation)+r' ',output,re.M) is not None

adb('shell','am','start','-a','android.intent.action.VIEW','-d','mobilecbzviewer://reader/2',APP)
ui=nodes()
assert any(n.get('text')=='reader-stress-1.cbz' for n in ui), 'Only own synthetic book supported'
assert any(re.fullmatch(r'\d+ / 40',n.get('text','')) for n in ui)
if any(n.get('content-desc')=='열람 모드: 페이지' for n in ui): tap('열람 모드: 페이지')
if zoomed(): tap('확대 초기화')
rotation=adb('shell','settings','get','system','user_rotation').strip()
auto=adb('shell','settings','get','system','accelerometer_rotation').strip()
observations=[]
try:
    adb('shell','settings','put','system','accelerometer_rotation',0)
    adb('shell','settings','put','system','user_rotation',0)
    for _ in range(20):
        if rotated(0): break
        time.sleep(.1)
    else: raise AssertionError('Portrait display required')
    # Interior source position, not a page boundary or an end-of-book no-op.
    button=next(n.get('content-desc') for n in nodes() if n.get('enabled')=='true'
        and n.get('content-desc') in ['다음 →','← 다음'])
    tap(button)
    time.sleep(.5)
    adb('shell','input','swipe',540,1500,540,1100,600)
    baseline=saved()
    assert 0 < baseline['fraction'] < .95, 'Expected interior source fraction'
    for target in [1,0]:
        viewport=next(n for n in nodes() if n.get('content-desc')=='세로 스크롤 만화')
        x1,y1,x2,y2=map(int,re.findall(r'\d+',viewport.get('bounds')))
        cx,cy=(x1+x2)//2,(y1+y2)//2
        half=(x2-x1)//10
        points=[cx-half,cy,cx+half,cy,cx-2*half,cy,cx+2*half,cy]
        proc=subprocess.Popen(['adb','shell','CLASSPATH=/data/local/tmp/cbz-touch.dex','app_process','/system/bin','TouchProbe',*map(str,points),'--slow'],stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
        try:
            assert proc.stdout.readline().strip()=='ACTIVE_TWO_POINTERS', 'Native pointer stream did not start'
            marker_time=time.monotonic()
            assert proc.poll() is None, 'Touch stream ended before rotation request'
            adb('shell','settings','put','system','user_rotation',target)
            during=False
            elapsed=None
            for _ in range(20):
                if rotated(target):
                    elapsed=time.monotonic()-marker_time
                    # Step5 precedes at least25 remaining100ms sleeps before UP.
                    # This bound rules out observing only process teardown.
                    during=proc.poll() is None and elapsed < 2.5
                    break
                if proc.poll() is not None: break
                time.sleep(.05)
            output,error=proc.communicate(timeout=10)
            assert proc.returncode==0 and 'Injected 34' in output, error
            check(f'rotation {target} occurs while two-pointer stream is still live',during)
        finally:
            if proc.poll() is None:
                proc.kill(); proc.communicate()
        after=saved()
        observations.append({'rotation':target,'before':baseline,'after':after,'displayChangedDuringLiveStream':during,
            'displayChangedAfterMarkerMs':round(elapsed*1000,1) if elapsed is not None else None})
        print(json.dumps(observations[-1]),flush=True)
        check(f'rotation {target} cancels active zoom',not zoomed())
        check(f'rotation {target} preserves exact source anchor and settings',same(baseline,after))
    adb('shell','input','swipe',540,1500,540,1100,600)
    check('one-finger scroll resumes after mid-gesture rotations',not same(baseline,saved()))
finally:
    for key,value in [('user_rotation',rotation),('accelerometer_rotation',auto)]:
        if value=='null': adb('shell','settings','delete','system',key)
        else: adb('shell','settings','put','system',key,value)
print(json.dumps({'platform':'Android emulator API36','passed':len(checks),'checks':checks,'observations':observations},ensure_ascii=False,indent=2))
