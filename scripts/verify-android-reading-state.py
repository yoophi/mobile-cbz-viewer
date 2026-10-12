"""Verify durable reading state using an imported synthetic stress CBZ and real app lifecycle."""
import argparse
import json
import pathlib
import re
import sqlite3
import subprocess
import tempfile
import time
import xml.etree.ElementTree as ET

PACKAGE = 'com.yoophi.mobilecbzviewer'


def adb(*args):
    return subprocess.check_output(['adb', *args], text=True)


def nodes():
    adb('shell', 'uiautomator', 'dump', '/sdcard/mobile-cbz-reading-check.xml')
    return list(ET.fromstring(adb('shell', 'cat', '/sdcard/mobile-cbz-reading-check.xml')).iter('node'))


def counter(items):
    for node in items:
        match = re.fullmatch(r'(\d+) / (\d+)', node.get('text', ''))
        if match:
            return tuple(map(int, match.groups()))
    return None


def bounds(node):
    return tuple(map(int, re.findall(r'\d+', node.get('bounds'))))


def tap(label):
    node = next(n for n in nodes() if n.get('content-desc') == label and n.get('enabled') == 'true')
    left, top, right, bottom = bounds(node)
    adb('shell', 'input', 'tap', str((left + right) // 2), str((top + bottom) // 2))


def visible(page=None, mode=None):
    deadline = time.monotonic() + 45
    while time.monotonic() < deadline:
        items = nodes()
        current = counter(items)
        descriptions = [node.get('content-desc', '') for node in items]
        if current and (page is None or current[0] == page):
            active_mode = 'scroll' if '열람 모드: 세로 스크롤' in descriptions else 'page'
            image = re.compile(rf'{current[0]} 페이지, \d+ 구간' if active_mode == 'scroll' else rf'{current[0]} 페이지')
            if (mode is None or active_mode == mode) and any(image.fullmatch(label) for label in descriptions):
                return items
        time.sleep(.3)
    raise RuntimeError('Expected persisted reader did not become visible')


parser = argparse.ArgumentParser()
parser.add_argument('--book-id', type=int, default=2)
parser.add_argument('--output', type=pathlib.Path, default=pathlib.Path('/tmp/android-reading-state-check.json'))
args = parser.parse_args()
if not 0 < args.book_id < 2**53:
    parser.error('positive safe synthetic book id required')
result = {'platform': 'android', 'api': adb('shell', 'getprop', 'ro.build.version.sdk').strip(), 'checks': [], 'states': []}


def record(name, passed):
    result['checks'].append({'name': name, 'passed': bool(passed)})
    args.output.write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result['checks'][-1]), flush=True)
    if not passed:
        raise RuntimeError(name)


def saved(stage):
    # Copy only for read-only queries after UI/writes settle; never write the app database.
    time.sleep(1.2)
    with tempfile.TemporaryDirectory(prefix='cbz-reading-check-') as temporary:
        database = pathlib.Path(temporary) / 'library.db'
        for suffix in ['', '-wal']:
            try:
                content = subprocess.check_output(['adb', 'exec-out', 'run-as', PACKAGE, 'cat', f'files/SQLite/library.db{suffix}'], stderr=subprocess.DEVNULL)
                pathlib.Path(str(database) + suffix).write_bytes(content)
            except subprocess.CalledProcessError:
                if not suffix:
                    raise
        connection = sqlite3.connect(f'file:{database}?mode=ro', uri=True)
        try:
            row = connection.execute('SELECT pageIndex,fraction,mode,direction,updatedAt FROM comic_reading_state WHERE comicId=?', (args.book_id,)).fetchone()
        finally:
            connection.close()
    if not row:
        raise RuntimeError('Reading state was not persisted')
    state = dict(zip(['index', 'fraction', 'mode', 'direction', 'updatedAt'], row))
    result['states'].append({'stage': stage, **state})
    args.output.write_text(json.dumps(result, indent=2) + '\n')
    return state


def same(a, b):
    return a['index'] == b['index'] and a['mode'] == b['mode'] and a['direction'] == b['direction'] and abs(a['fraction'] - b['fraction']) < .002


def open_book():
    adb('shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', f'mobilecbzviewer://reader/{args.book_id}', PACKAGE)


rotation = adb('shell', 'settings', 'get', 'system', 'user_rotation').strip()
auto = adb('shell', 'settings', 'get', 'system', 'accelerometer_rotation').strip()
try:
    adb('shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', 'mobilecbzviewer://', PACKAGE)
    open_book()
    items = visible()
    if any(n.get('content-desc') == '열람 모드: 세로 스크롤' for n in items):
        tap('열람 모드: 세로 스크롤')
        items = visible(mode='page')
    current, count = counter(items)
    action = '다음' if current < count - 1 else '이전'
    for _ in range(2):
        items = visible(mode='page')
        node = next(n for n in items if action in n.get('content-desc', '') and n.get('clickable') == 'true' and n.get('enabled') == 'true')
        left, top, right, bottom = bounds(node)
        adb('shell', 'input', 'tap', str((left + right) // 2), str((top + bottom) // 2))
    items = visible(mode='page')
    if any(n.get('content-desc') == '읽기 방향: 좌→우' for n in items):
        tap('읽기 방향: 좌→우')
    page = counter(visible(mode='page'))[0]
    page_state = saved('page and RTL')
    record('Page movement and RTL direction persist', page_state['index'] == page - 1 and page_state['direction'] == 'rtl' and page_state['mode'] == 'page')
    tap('열람 모드: 페이지')
    items = visible(page, 'scroll')
    canvas = next(n for n in items if n.get('content-desc') == '세로 스크롤 만화')
    left, top, right, bottom = bounds(canvas)
    x = (left + right) // 2
    adb('shell', 'input', 'swipe', str(x), str(bottom - 120), str(x), str(top + 120), '600')
    page = counter(visible(mode='scroll'))[0]
    anchor = saved('scrolled anchor')
    record('Scroll page and within-image fraction persist', anchor['index'] == page - 1 and anchor['fraction'] > 0 and anchor['mode'] == 'scroll')
    tap('서재로')
    open_book()
    visible(page, 'scroll')
    record('Leaving and reopening the reader restores page, fraction and settings', same(anchor, saved('reopened reader')))
    adb('shell', 'settings', 'put', 'system', 'accelerometer_rotation', '0')
    adb('shell', 'settings', 'put', 'system', 'user_rotation', '1')
    visible(page, 'scroll')
    record('Rotation preserves the durable source fraction', same(anchor, saved('landscape')))
    adb('shell', 'settings', 'put', 'system', 'user_rotation', '0')
    visible(page, 'scroll')
    tap('열람 모드: 세로 스크롤')
    visible(page, 'page')
    tap('열람 모드: 페이지')
    visible(page, 'scroll')
    record('Mode round trip preserves the scroll anchor', same(anchor, saved('mode round trip')))
    adb('shell', 'input', 'keyevent', '3')
    background = saved('background')
    adb('shell', 'am', 'force-stop', PACKAGE)
    adb('shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d',
        'exp+mobile-cbz-viewer://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8081', PACKAGE)
    deadline = time.monotonic() + 45
    while not any(n.get('text') == '나의 만화 서재' for n in nodes()):
        if time.monotonic() > deadline:
            raise RuntimeError('Relaunched library did not become visible')
        time.sleep(.5)
    open_book()
    visible(page, 'scroll')
    items = nodes()
    record('Background, force-stop and relaunch restore the same reader', same(background, saved('process relaunched')) and
           any(n.get('content-desc') == '읽기 방향: 우→좌' for n in items))
    result['passed'] = all(check['passed'] for check in result['checks'])
    args.output.write_text(json.dumps(result, indent=2) + '\n')
finally:
    for key, value in [('user_rotation', rotation), ('accelerometer_rotation', auto)]:
        if value == 'null':
            adb('shell', 'settings', 'delete', 'system', key)
        else:
            adb('shell', 'settings', 'put', 'system', key, value)
