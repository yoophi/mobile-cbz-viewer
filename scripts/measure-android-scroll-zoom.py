#!/usr/bin/env python3
"""Sample actual native memory during zoom cycles on own synthetic book id 2.
The active development app must start on the library; Metro and TouchProbe dex
must be ready. Reports observations, not a universal device memory guarantee.
"""
import json, re, subprocess, time, xml.etree.ElementTree as ET
APP='com.yoophi.mobilecbzviewer'
def adb(*args): return subprocess.check_output(['adb',*map(str,args)],text=True)
def nodes():
    adb('shell','uiautomator','dump','/sdcard/cbz-zoom-memory.xml')
    return list(ET.fromstring(adb('shell','cat','/sdcard/cbz-zoom-memory.xml')).iter('node'))
def labels(): return [n.get('content-desc','') or n.get('text','') for n in nodes()]
def tap(label):
    n=next(n for n in nodes() if n.get('content-desc')==label and n.get('enabled')=='true')
    x1,y1,x2,y2=map(int,re.findall(r'\d+',n.get('bounds')))
    adb('shell','input','tap',(x1+x2)//2,(y1+y2)//2)
samples=[]
def capture(stage):
    report=adb('shell','dumpsys','meminfo',APP)
    pss=re.search(r'TOTAL PSS:\s*(\d+)',report)
    heap=re.search(r'^\s*Native Heap\s+(\d+)',report,re.M)
    bitmap=re.search(r'Bitmap \(malloced\):\s*(\d+)\s*(\d+)',report)
    assert pss and heap and bitmap, 'Native memory report incomplete'
    samples.append({'stage':stage,'pssKiB':int(pss.group(1)),'nativeHeapPssKiB':int(heap.group(1)),
        'bitmapCount':int(bitmap.group(1)),'bitmapKiB':int(bitmap.group(2))})
    print(json.dumps(samples[-1]),flush=True)
assert '나의 만화 서재' in labels(), 'Start freshly launched app on library screen'
capture('fresh library')
adb('shell','am','start','-a','android.intent.action.VIEW','-d','mobilecbzviewer://reader/2',APP)
for _ in range(20):
    if 'reader-stress-1.cbz' in labels(): break
    time.sleep(.3)
else: raise AssertionError('Expected own synthetic reader')
if '열람 모드: 페이지' in labels(): tap('열람 모드: 페이지')
for _ in range(20):
    if any(re.fullmatch(r'\d+ 페이지, \d+ 구간',s) for s in labels()): break
    time.sleep(.3)
else: raise AssertionError('Scroll image not visible')
time.sleep(2); capture('scroll before zoom')
adb('shell','CLASSPATH=/data/local/tmp/cbz-touch.dex','app_process','/system/bin','TouchProbe',440,1000,640,1000,240,1000,840,1000)
assert '확대 초기화' in labels(); capture('pinch zoom')
tap('확대 초기화')
for cycle in range(1,21):
    adb('shell','input tap 540 1000; input tap 540 1000')
    time.sleep(.3)
    adb('shell','input tap 540 1000; input tap 540 1000')
    time.sleep(.3)
    if cycle in [5,10,20]:
        assert '확대 초기화' not in labels(), 'Zoom reset cycle did not finish at base scale'
        capture(f'after {cycle} zoom/reset cycles')
print(json.dumps({'platform':'Android emulator API36','developmentBuild':True,'samples':samples},indent=2))
