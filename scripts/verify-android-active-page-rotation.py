#!/usr/bin/env python3
"""Rotate the actual page reader during two-pointer input, using own sample id1.
Requires development Metro and TouchProbe dex. Changes synthetic reading state
through normal UI only; copies SQLite read-only and restores rotation settings.
"""
import argparse, json, pathlib, re, sqlite3, subprocess, tempfile, time, xml.etree.ElementTree as ET

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
            adb('shell', 'rm', '-f', '/sdcard/cbz-page-rotation.xml')
            adb('shell', 'uiautomator', 'dump', '/sdcard/cbz-page-rotation.xml')
            return list(ET.fromstring(adb('shell', 'cat', '/sdcard/cbz-page-rotation.xml')).iter('node'))
        except (subprocess.CalledProcessError, ET.ParseError):
            time.sleep(.2)
    raise AssertionError('Native UI unavailable')

def tap(label):
    node = next(n for n in nodes() if label in [n.get('content-desc'), n.get('text')] and n.get('enabled') == 'true')
    x1, y1, x2, y2 = map(int, re.findall(r'\d+', node.get('bounds')))
    adb('shell', 'input', 'tap', (x1+x2)//2, (y1+y2)//2)

def saved():
    time.sleep(1.3)
    with tempfile.TemporaryDirectory(prefix='cbz-page-rotation-') as folder:
        path = pathlib.Path(folder) / 'library.db'
        for suffix in ['', '-wal']:
            try:
                data = subprocess.check_output(['adb', 'exec-out', 'run-as', APP, 'cat', 'files/SQLite/library.db'+suffix], stderr=subprocess.DEVNULL)
                pathlib.Path(str(path)+suffix).write_bytes(data)
            except subprocess.CalledProcessError:
                if not suffix:
                    raise
        db = sqlite3.connect(f'file:{path}?mode=ro', uri=True)
        try:
            comic = db.execute('SELECT name,pageCount FROM comics WHERE id=1').fetchone()
            assert comic == ('reader-sample.cbz', 3), 'Only own synthetic sample supported'
            row = db.execute('SELECT pageIndex,fraction,mode,direction FROM comic_reading_state WHERE comicId=1').fetchone()
        finally:
            db.close()
        assert row is not None
        return dict(zip(['index', 'fraction', 'mode', 'direction'], row))

def zoomed():
    return any(n.get('content-desc') == '확대 초기화' for n in nodes())

def canvas():
    ui = nodes()
    page = next(n for n in ui if re.fullmatch(r'[1-3] 페이지', n.get('content-desc', '')))
    assert not any(n.get('text') == '이미지 불러오는 중…' for n in ui)
    x1, y1, x2, y2 = map(int, re.findall(r'\d+', page.get('bounds')))
    assert x2-x1 > 200 and y2-y1 > 100, 'Page viewport must remain usable'
    return (x1+x2)//2, (y1+y2)//2, (x2-x1)//10

def rotated(target):
    return re.search(r'^    mRotation='+str(target)+r' ', adb('shell', 'dumpsys', 'window', 'displays'), re.M) is not None

checks, observations = [], []
def check(name, passed):
    if not passed:
        raise AssertionError(name)
    checks.append(name)
    print('PASS '+name, flush=True)

adb('reverse', f'tcp:{args.port}', f'tcp:{args.port}')
adb('shell', 'am', 'force-stop', APP)
url = f'exp+mobile-cbz-viewer://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A{args.port}'
adb('shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', url, APP)
for _ in range(30):
    if any(n.get('text') == 'reader-many-1.cbz' for n in nodes()):
        break
    time.sleep(.3)
else:
    raise AssertionError('Expected synthetic library')
adb('shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', 'mobilecbzviewer://reader/1', APP)
for _ in range(20):
    ui = nodes()
    if any(n.get('text') == 'reader-sample.cbz' for n in ui) and any(re.fullmatch(r'\d / 3', n.get('text', '')) for n in ui):
        break
    time.sleep(.3)
else:
    raise AssertionError('Expected actual sample reader')
saved()  # Verify fixture identity before changing its state.
if any(n.get('content-desc') == '열람 모드: 세로 스크롤' for n in ui):
    tap('열람 모드: 세로 스크롤')

rotation = adb('shell', 'settings', 'get', 'system', 'user_rotation').strip()
auto = adb('shell', 'settings', 'get', 'system', 'accelerometer_rotation').strip()
try:
    adb('shell', 'settings', 'put', 'system', 'accelerometer_rotation', 0)
    adb('shell', 'settings', 'put', 'system', 'user_rotation', 0)
    for _ in range(20):
        if rotated(0):
            break
        time.sleep(.1)
    else:
        raise AssertionError('Portrait display required')
    for direction in ['ltr', 'rtl']:
        if saved()['direction'] != direction:
            other = '우→좌' if direction == 'ltr' else '좌→우'
            tap('읽기 방향: '+other)
        baseline = saved()
        assert baseline['mode'] == 'page' and baseline['direction'] == direction
        for target in [1, 0]:
            cx, cy, half = canvas()
            points = [cx-half, cy, cx+half, cy, cx-2*half, cy, cx+2*half, cy]
            proc = subprocess.Popen(['adb', 'shell', 'CLASSPATH=/data/local/tmp/cbz-touch.dex', 'app_process', '/system/bin',
                                     'TouchProbe', *map(str, points), '--slow'], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            try:
                assert proc.stdout.readline().strip() == 'ACTIVE_TWO_POINTERS'
                marker = time.monotonic()
                assert proc.poll() is None
                adb('shell', 'settings', 'put', 'system', 'user_rotation', target)
                elapsed, during = None, False
                for _ in range(20):
                    if rotated(target):
                        elapsed = time.monotonic()-marker
                        during = proc.poll() is None and elapsed < 2.5
                        break
                    if proc.poll() is not None:
                        break
                    time.sleep(.05)
                output, error = proc.communicate(timeout=10)
                assert proc.returncode == 0 and 'Injected 34' in output, error
                check(f'{direction} rotation{target}: display changes during two-pointer stream', during)
            finally:
                if proc.poll() is None:
                    proc.kill()
                    proc.communicate()
            after = saved()
            observations.append({'direction': direction, 'rotation': target, 'before': baseline, 'after': after,
                                 'displayChangedDuringLiveStream': during, 'displayChangedAfterMarkerMs': round(elapsed*1000, 1) if elapsed is not None else None})
            check(f'{direction} rotation{target}: active zoom resets', not zoomed())
            check(f'{direction} rotation{target}: exact SQLite anchor and settings remain', after == baseline)
            canvas()
            ui = nodes()
            counters = [re.fullmatch(r'(\d+)(?:–(\d+))? / 3', n.get('text', '')) for n in ui]
            counter = next(match for match in counters if match)
            first, last = int(counter[1]), int(counter[2] or counter[1])
            shown = [int(n.get('content-desc').split()[0]) for n in ui if re.fullmatch(r'[1-3] 페이지', n.get('content-desc', ''))]
            check(f'{direction} rotation{target}: displayed page matches saved anchor',
                  baseline['index']+1 in shown and sorted(shown) == list(range(first, last+1)))
        cx, cy, _ = canvas()
        adb('shell', f'input tap {cx} {cy}; input tap {cx} {cy}')
        check(f'{direction}: zoom resumes after active rotations', zoomed() and saved() == baseline)
        tap('확대 초기화')
        check(f'{direction}: reset remains usable', not zoomed())
        choices = ['다음 →', '← 다음'] if baseline['index'] < 2 else ['이전 →', '← 이전']
        button = next(n.get('content-desc') for n in nodes() if n.get('enabled') == 'true' and n.get('content-desc') in choices)
        tap(button)
        after = saved()
        expected = baseline['index']+1 if baseline['index'] < 2 else baseline['index']-1
        check(f'{direction}: page navigation resumes with base zoom', after['index'] == expected and after['mode'] == 'page'
              and after['direction'] == direction and not zoomed())
finally:
    for key, value in [('user_rotation', rotation), ('accelerometer_rotation', auto)]:
        if value == 'null':
            adb('shell', 'settings', 'delete', 'system', key)
        else:
            adb('shell', 'settings', 'put', 'system', key, value)

result = {'platform': 'Android emulator API36, development APK/development JS',
          'sourceBaseCommit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip(),
          'sourceChanges': sorted(set(subprocess.check_output(['git', 'diff', '--name-only', 'HEAD', '--', 'src'], text=True).splitlines()
                                     + subprocess.check_output(['git', 'ls-files', '--others', '--exclude-standard', 'src'], text=True).splitlines())),
          'passed': len(checks), 'checks': checks, 'observations': observations,
          'scope': 'Actual page reader, read-only SQLite snapshots; iOS/physical/release not verified'}
args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2)+'\n')
print(f'Saved {len(checks)} checks to {args.output}', flush=True)
