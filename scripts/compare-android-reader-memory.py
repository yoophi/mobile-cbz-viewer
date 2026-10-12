#!/usr/bin/env python3
"""Compare warm reader memory across Metro sources with the SAME installed native app.
Start the specified source's Metro first. Uses only own synthetic reader-stress-1
book id 2; does not write/delete app database or archives. Fresh process per run.
"""
import argparse, json, pathlib, re, subprocess, time, urllib.parse, xml.etree.ElementTree as ET
APP='com.yoophi.mobilecbzviewer'
parser=argparse.ArgumentParser()
parser.add_argument('--port',type=int,required=True)
parser.add_argument('--source-commit',required=True)
parser.add_argument('--js-mode',choices=['development','production'],default='development')
parser.add_argument('--source-dirty',action='store_true',help='Source includes uncommitted changes on top of source-commit')
parser.add_argument('--output',type=pathlib.Path,required=True)
args=parser.parse_args()
assert 1024<=args.port<=65535 and re.fullmatch(r'[0-9a-f]{7,40}',args.source_commit)
def adb(*a): return subprocess.check_output(['adb',*map(str,a)],text=True)
def nodes():
    adb('shell','uiautomator','dump','/sdcard/cbz-memory-comparison.xml')
    return list(ET.fromstring(adb('shell','cat','/sdcard/cbz-memory-comparison.xml')).iter('node'))
def wait_ready(predicate):
    deadline=time.monotonic()+90
    while time.monotonic()<deadline:
        try:
            ui=nodes()
            if predicate(ui): return ui
        except (subprocess.CalledProcessError,ET.ParseError): pass
        time.sleep(.3)
    raise AssertionError('Same launched app did not become ready')
def tap(label):
    n=next(n for n in nodes() if n.get('content-desc')==label and n.get('enabled')=='true')
    x1,y1,x2,y2=map(int,re.findall(r'\d+',n.get('bounds')))
    adb('shell','input','tap',(x1+x2)//2,(y1+y2)//2)
result={'sourceCommit':args.source_commit,'sourceDirty':args.source_dirty,'metroPort':args.port,'platform':'Android emulator API36',
    'developmentBuild':True,'jsMode':args.js_mode,'sameNativeApp':APP,'samples':[]}
def capture(stage):
    report=adb('shell','dumpsys','meminfo',APP)
    pss=re.search(r'TOTAL PSS:\s*(\d+)',report)
    heap=re.search(r'^\s*Native Heap\s+(\d+)',report,re.M)
    bitmap=re.search(r'Bitmap \(malloced\):\s*(\d+)\s*(\d+)',report)
    assert pss and heap and bitmap,'Incomplete native memory report'
    sample={'stage':stage,'pssKiB':int(pss.group(1)),'nativeHeapPssKiB':int(heap.group(1)),
        'bitmapCount':int(bitmap.group(1)),'bitmapKiB':int(bitmap.group(2))}
    result['samples'].append(sample)
    args.output.write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps(sample),flush=True)
adb('reverse',f'tcp:{args.port}',f'tcp:{args.port}')
adb('shell','am','force-stop',APP)
url='exp+mobile-cbz-viewer://expo-development-client/?url='+urllib.parse.quote(f'http://127.0.0.1:{args.port}',safe='')
adb('shell','am','start','-a','android.intent.action.VIEW','-d',url,APP)
wait_ready(lambda ui:any(n.get('text')=='나의 만화 서재' for n in ui) and any(n.get('text')=='reader-many-1.cbz' for n in ui))
time.sleep(2); capture('library after ready +2s')
time.sleep(8); capture('library after ready +10s')
adb('shell','am','start','-a','android.intent.action.VIEW','-d','mobilecbzviewer://reader/2',APP)
ui=wait_ready(lambda ui:any(n.get('text')=='reader-stress-1.cbz' for n in ui) and any(re.fullmatch(r'\d+ / 40',n.get('text','')) for n in ui))
if any(n.get('content-desc')=='열람 모드: 페이지' for n in ui): tap('열람 모드: 페이지')
ui=wait_ready(lambda ui:any(re.fullmatch(r'\d+ 페이지, \d+ 구간',n.get('content-desc','')) for n in ui))
result['readerCounter']=next(n.get('text') for n in ui if re.fullmatch(r'\d+ / 40',n.get('text','')))
time.sleep(2); capture('scroll after image ready +2s')
time.sleep(8); capture('scroll after image ready +10s')
adb('shell','input','keyevent',4)
wait_ready(lambda ui:any(n.get('text')=='나의 만화 서재' for n in ui) and any(n.get('text')=='reader-many-1.cbz' for n in ui))
time.sleep(2); capture('return library +2s')
