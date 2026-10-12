#!/usr/bin/env python3
"""Exercise actual responsive page UI using only own 40-page synthetic book id2.
Emulator API36 required. Temporarily changes display size/density; restores these
and rotation settings in finally. Reading state changes only through normal UI.
"""
import argparse, json, pathlib, re, sqlite3, subprocess, tempfile, time, xml.etree.ElementTree as ET

APP = 'com.yoophi.mobilecbzviewer'
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--port', type=int, default=8084)
parser.add_argument('--output', type=pathlib.Path, required=True)
args = parser.parse_args()

def adb(*values):
    return subprocess.check_output(['adb', *map(str, values)], text=True)

assert adb('shell', 'getprop', 'ro.kernel.qemu').strip() == '1', 'Emulator only'
assert adb('shell', 'getprop', 'ro.build.version.sdk').strip() == '36', 'API36 required'
assert 1 <= args.port <= 65535

def nodes():
    for _ in range(3):
        try:
            adb('shell', 'rm', '-f', '/sdcard/cbz-spread-ui.xml')
            adb('shell', 'uiautomator', 'dump', '/sdcard/cbz-spread-ui.xml')
            return list(ET.fromstring(adb('shell', 'cat', '/sdcard/cbz-spread-ui.xml')).iter('node'))
        except (subprocess.CalledProcessError, ET.ParseError):
            time.sleep(.2)
    raise AssertionError('Native UI unavailable')

def bounds(node):
    return list(map(int, re.findall(r'\d+', node.get('bounds'))))

def tap(label):
    node = next(n for n in nodes() if n.get('content-desc') == label and n.get('enabled') == 'true')
    x1, y1, x2, y2 = bounds(node)
    adb('shell', 'input', 'tap', (x1+x2)//2, (y1+y2)//2)

def navigate(action):
    choices = ['다음 →', '← 다음'] if action == 'next' else ['이전 →', '← 이전']
    label = next(n.get('content-desc') for n in nodes() if n.get('content-desc') in choices and n.get('enabled') == 'true')
    tap(label)

def saved():
    time.sleep(1.3)
    with tempfile.TemporaryDirectory(prefix='cbz-spread-') as folder:
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
            assert db.execute('SELECT name,pageCount FROM comics WHERE id=2').fetchone() == ('reader-stress-1.cbz', 40)
            row = db.execute('SELECT pageIndex,fraction,mode,direction FROM comic_reading_state WHERE comicId=2').fetchone()
        finally:
            db.close()
        return dict(zip(['index', 'fraction', 'mode', 'direction'], row))

def shown(expected=None, landscape=None):
    for _ in range(15):
        ui = nodes()
        images = [n for n in ui if re.fullmatch(r'\d+ 페이지', n.get('content-desc', ''))]
        images.sort(key=lambda n: bounds(n)[0])
        order = [int(n.get('content-desc').split()[0])-1 for n in images]
        counter = next((n.get('text') for n in ui if re.fullmatch(r'\d+(?:–\d+)? / 40', n.get('text', ''))), None)
        rects = [bounds(n) for n in images]
        geometry_matches = bool(rects) and (landscape is None or
            (max(r[2] for r in rects)-min(r[0] for r in rects) > max(r[3] for r in rects)-min(r[1] for r in rects)) == landscape)
        if images and counter and geometry_matches and not any(n.get('text') == '이미지 불러오는 중…' for n in ui) and (expected is None or order == expected):
            return {'order': order, 'counter': counter, 'bounds': [bounds(n) for n in images]}
        time.sleep(.2)
    raise AssertionError(f'Expected loaded pages {expected}, observed {order}, counter {counter}')

checks, observations = [], []
def check(name, passed):
    if not passed:
        raise AssertionError(name)
    checks.append(name)
    print('PASS '+name, flush=True)

def resize(size):
    adb('shell', 'wm', 'size', size)
    time.sleep(.7)

size_text, density_text = adb('shell', 'wm', 'size'), adb('shell', 'wm', 'density')
old_size = re.search(r'Override size: (\d+x\d+)', size_text)
old_density = re.search(r'Override density: (\d+)', density_text)
old_rotation = adb('shell', 'settings', 'get', 'system', 'user_rotation').strip()
old_auto = adb('shell', 'settings', 'get', 'system', 'accelerometer_rotation').strip()

try:
    # Density changes recreate this Activity; window-size changes are handled
    # in place. Keep density constant while exercising live responsive layout.
    adb('shell', 'wm', 'density', 420)
    resize('1080x2424')
    adb('shell', 'settings', 'put', 'system', 'accelerometer_rotation', 0)
    adb('shell', 'settings', 'put', 'system', 'user_rotation', 0)
    adb('reverse', f'tcp:{args.port}', f'tcp:{args.port}')
    adb('shell', 'am', 'force-stop', APP)
    url = f'exp+mobile-cbz-viewer://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A{args.port}'
    adb('shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', url, APP)
    for _ in range(30):
        if any(n.get('text') == 'reader-many-1.cbz' for n in nodes()): break
        time.sleep(.3)
    else: raise AssertionError('Expected synthetic library')
    adb('shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', 'mobilecbzviewer://reader/2', APP)
    for _ in range(20):
        ui = nodes()
        if any(n.get('text') == 'reader-stress-1.cbz' for n in ui) and any(re.fullmatch(r'\d+ / 40', n.get('text', '')) for n in ui): break
        time.sleep(.3)
    else: raise AssertionError('Expected actual synthetic reader')
    state = saved()
    if state['mode'] == 'scroll': tap('열람 모드: 세로 스크롤')
    if state['direction'] == 'rtl': tap('읽기 방향: 우→좌')
    state = saved()
    # Reach an early anchor through normal UI without dozens of single-page
    # taps when a prior regression run left this synthetic book near its end.
    if state['index'] > 3:
        resize('2400x3600')
        shown()
        for _ in range(40):
            if state['index'] <= 2: break
            navigate('previous')
            state = saved()
        else: raise AssertionError('Could not reach the first body spread')
        resize('1080x2424')
        shown()
    for _ in range(40):
        if state['index'] == 2: break
        navigate('next' if state['index'] < 2 else 'previous')
        state = saved()
    else: raise AssertionError('Could not establish the second-page anchor')
    baseline = state
    check('narrow window shows the selected second body page alone', shown([2])['counter'] == '3 / 40')
    resize('2400x3600')
    wide = shown([1, 2], landscape=False)
    check('large portrait viewport shows body spread', wide['counter'] == '2–3 / 40')
    check('single to spread preserves exact saved second-page anchor', saved() == baseline)
    observations.append({'layout': 'large portrait', 'shown': wide, 'anchor': saved()})
    adb('shell', 'settings', 'put', 'system', 'user_rotation', 1)
    for _ in range(20):
        if re.search(r'^    mRotation=1 ', adb('shell', 'dumpsys', 'window', 'displays'), re.M): break
        time.sleep(.1)
    else: raise AssertionError('Actual landscape rotation missing')
    landscape = shown([1, 2], landscape=True)
    check('large landscape keeps both pages and exact anchor', saved() == baseline and landscape['counter'] == '2–3 / 40')
    tap('읽기 방향: 좌→우')
    rtl = shown([2, 1])
    state = saved()
    check('RTL reverses visual pair without changing anchor', state['index'] == baseline['index'] and state['fraction'] == baseline['fraction'] and state['direction'] == 'rtl')
    observations.append({'layout': 'large landscape RTL', 'shown': rtl, 'anchor': state})
    adb('shell', 'settings', 'put', 'system', 'user_rotation', 0)
    resize('1080x2424')
    check('narrow window returns to the exact selected page', shown([2])['counter'] == '3 / 40' and saved() == state)
    # Short narrow window exercises wrapping controls, not a device-model flag.
    resize('840x1100')
    small = shown([2])
    ui = nodes()
    required = ['서재로', '열람 모드: 페이지', '읽기 방향: 우→좌', '← 다음', '이전 →']
    button_bounds = [bounds(next(n for n in ui if n.get('content-desc') == label)) for label in required]
    check('short window exposes all controls with 48dp touch height', all(0 <= x1 < x2 <= 840 and 0 <= y1 < y2 <= 1100 and y2-y1 >= 126 for x1,y1,x2,y2 in button_bounds))
    check('short window keeps a usable single page and exact anchor', small['bounds'][0][3]-small['bounds'][0][1] >= 200 and saved() == state)
    observations.append({'layout': '320dp narrow/short window', 'shown': small, 'buttons': button_bounds, 'anchor': state})
    resize('2400x3600')
    shown([2, 1])
    tap('읽기 방향: 우→좌')
    navigate('previous')
    check('previous from restored second page reaches solitary cover', shown([0])['counter'] == '1 / 40' and saved()['index'] == 0)
    seen = [0]
    spreads = []
    for expected_first in range(1, 40, 2):
        navigate('next')
        expected = [expected_first] if expected_first == 39 else [expected_first, expected_first+1]
        frame = shown(expected)
        seen.extend(frame['order'])
        spreads.append(frame)
    check('native forward traversal shows all40 pages once', seen == list(range(40)))
    check('remaining unpaired final page stands alone', shown([39])['counter'] == '40 / 40' and saved()['index'] == 39)
    check('next is disabled at final page', any(n.get('content-desc') == '다음 →' and n.get('enabled') == 'false' for n in nodes()))
    tap('읽기 방향: 좌→우')
    navigate('previous')
    check('RTL previous from final page reaches the preceding full pair', shown([38, 37])['counter'] == '38–39 / 40' and saved()['index'] == 37)
    navigate('next')
    check('RTL next returns to the solitary final page', shown([39])['counter'] == '40 / 40' and saved()['index'] == 39)
    observations.append({'layout': 'large portrait traversal', 'spreads': spreads, 'seen': seen})
finally:
    adb('shell', 'wm', 'size', old_size[1] if old_size else 'reset')
    adb('shell', 'wm', 'density', old_density[1] if old_density else 'reset')
    for key, value in [('user_rotation', old_rotation), ('accelerometer_rotation', old_auto)]:
        if value == 'null': adb('shell', 'settings', 'delete', 'system', key)
        else: adb('shell', 'settings', 'put', 'system', key, value)

result = {'platform': 'Android API36 emulator with display overrides; development APK/development JS',
          'sourceBaseCommit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip(),
          'sourceChanges': ['comic-reader.tsx adaptive spread/compact controls', 'page-spread.ts'],
          'passed': len(checks), 'checks': checks, 'observations': observations,
          'scope': 'Responsive layout on simulated window sizes; not native iPad/Android tablet or physical/release verification'}
args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2)+'\n')
print(f'Saved {len(checks)} checks to {args.output}', flush=True)
