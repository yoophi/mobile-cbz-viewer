#!/usr/bin/env python3
"""Observe genuine native momentum -> pinch on own synthetic id2 (development only).
Requires current Metro and TouchProbe dex; never writes reading state or originals.
"""
import argparse, json, pathlib, re, subprocess, time, xml.etree.ElementTree as ET

APP = 'com.yoophi.mobilecbzviewer'
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--port', type=int, default=8084)
parser.add_argument('--output', type=pathlib.Path, required=True)
args = parser.parse_args()
assert 1 <= args.port <= 65535

def adb(*values):
    return subprocess.check_output(['adb', *map(str, values)], text=True)

def nodes():
    for _ in range(3):
        try:
            adb('shell', 'uiautomator', 'dump', '/sdcard/cbz-fling-zoom.xml')
            return list(ET.fromstring(adb('shell', 'cat', '/sdcard/cbz-fling-zoom.xml')).iter('node'))
        except (subprocess.CalledProcessError, ET.ParseError):
            time.sleep(.3)
    raise AssertionError('Native UI unavailable')

def tap(label):
    node = next(n for n in nodes() if n.get('content-desc') == label and n.get('enabled') == 'true')
    x1, y1, x2, y2 = map(int, re.findall(r'\d+', node.get('bounds')))
    adb('shell', 'input', 'tap', (x1+x2)//2, (y1+y2)//2)

def snapshot():
    tap('Snapshot scroll observations')
    return json.loads(adb('shell', 'run-as', APP, 'cat', 'files/scroll-gesture-probe-result.json'))

def zoomed():
    return any(n.get('content-desc') == '확대 초기화' for n in nodes())

checks, trials = [], []
def check(name, condition):
    if not condition:
        raise AssertionError(name)
    checks.append(name)
    print('PASS ' + name, flush=True)

adb('reverse', f'tcp:{args.port}', f'tcp:{args.port}')
for trial in range(3):
    adb('shell', 'am', 'force-stop', APP)
    url = f'exp+mobile-cbz-viewer://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A{args.port}'
    adb('shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', url, APP)
    for _ in range(30):
        if any(n.get('text') == 'reader-many-1.cbz' for n in nodes()):
            break
        time.sleep(.3)
    else:
        raise AssertionError('Expected own synthetic library')
    adb('shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', 'mobilecbzviewer://scroll-gesture-diagnostics', APP)
    for _ in range(30):
        ui = nodes()
        if any(n.get('text') == 'Ready: no reading-state writes' for n in ui) and any(
                re.fullmatch(r'\d+ 페이지, \d+ 구간', n.get('content-desc', '')) for n in ui):
            break
        time.sleep(.3)
    else:
        raise AssertionError('Actual scroll image not ready')
    viewport = next(n for n in ui if n.get('content-desc') == '세로 스크롤 만화')
    x1, y1, x2, y2 = map(int, re.findall(r'\d+', viewport.get('bounds')))
    cx, cy, half = (x1+x2)//2, (y1+y2)//2, (x2-x1)//10
    assert y2-y1 > 1200, 'Tall portrait viewport required for this input fixture'
    tap('Clear scroll observations')
    markers = adb('shell', 'CLASSPATH=/data/local/tmp/cbz-touch.dex', 'app_process', '/system/bin',
                  'TouchProbe', cx-half, cy, cx+half, cy, cx-2*half, cy, cx+2*half, cy, '--fling')
    print(markers, flush=True)
    up_started = int(re.search(r'FLING_UP_STARTED:(\d+)', markers)[1])
    queued = int(re.search(r'FLING_UP_QUEUED:(\d+)', markers)[1])
    pinch = int(re.search(r'PINCH_FIRST_DOWN:(\d+)', markers)[1])
    assert zoomed(), 'Native pinch must activate zoom'
    time.sleep(2)
    locked = snapshot()
    events = locked['events']
    # The fast one-finger stream is queued asynchronously. A queue marker alone
    # is insufficient: require a native momentum callback followed by actual
    # offset movement, both observed before the first pinch DOWN.
    momentum = [e for e in events if e['type'] == 'momentum-begin' and up_started <= e['time'] < pinch]
    movement = [e for e in events if e['type'] == 'scroll' and momentum and momentum[0]['time'] < e['time'] < pinch]
    print(json.dumps(locked), flush=True)
    check(f'{trial}: native momentum moves after release and before pinch', bool(momentum) and bool(movement)
          and any(abs(e['offset']-momentum[0]['offset']) > 1 for e in movement)
          and not any(e['type'] == 'momentum-end' and up_started <= e['time'] < pinch for e in events))
    lock = next(e for e in events if e['type'] == 'lock' and not e['enabled'] and e['time'] >= pinch)
    check(f'{trial}: pinch locks native scroll', lock['time'] >= pinch)
    adb('shell', 'input', 'swipe', cx, cy+250, cx, cy-250, 180)
    time.sleep(1)
    dragged = snapshot()
    after_lock = [e for e in dragged['events'] if e['time'] > lock['time']]
    check(f'{trial}: momentum and zoomed drag preserve source position', dragged['position'] == locked['position']
          and not any(e['type'] == 'position' for e in after_lock)
          and all(abs(e['offset']-lock['offset']) <= 1 for e in after_lock if e['type'] == 'scroll')
          and zoomed())
    tap('확대 초기화')
    check(f'{trial}: reset restores base scale', not zoomed())
    adb('shell', 'input', 'swipe', cx, cy+250, cx, cy-250, 600)
    time.sleep(1)
    resumed = snapshot()
    check(f'{trial}: one-finger scrolling resumes', resumed['position'] != locked['position']
          and any(e['type'] == 'position' and e['enabled'] and e['time'] > lock['time'] for e in resumed['events']))
    trials.append({'upRequestTime': up_started, 'upQueuedTime': queued, 'pinchTime': pinch, 'locked': locked, 'dragged': dragged, 'resumed': resumed})

result = {'platform': 'Android API36 emulator, development APK and development JS',
          'sourceBaseCommit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip(),
          'sourceChanges': ['src/components/scroll-reader.tsx optional observations', 'src/app/scroll-gesture-diagnostics.tsx diagnostic route'],
          'scope': 'Actual ScrollReader callbacks, no reading-state writes; not SQLite persistence or release/iOS verification',
          'passed': len(checks), 'checks': checks, 'trials': trials}
args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
print(f'Saved {len(checks)} checks to {args.output}', flush=True)
