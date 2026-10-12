"""Check scroll rendering, navigation and rotation on imported synthetic stress books."""
import argparse
import json
import pathlib
import re
import subprocess
import time
import xml.etree.ElementTree as ET

PACKAGE = 'com.yoophi.mobilecbzviewer'


def adb(*args):
    return subprocess.check_output(['adb', *args], text=True)


def nodes():
    adb('shell', 'uiautomator', 'dump', '/sdcard/mobile-cbz-scroll-check.xml')
    return list(ET.fromstring(adb('shell', 'cat', '/sdcard/mobile-cbz-scroll-check.xml')).iter('node'))


def counter(items):
    for node in items:
        match = re.fullmatch(r'(\d+) / (\d+)', node.get('text', ''))
        if match:
            return tuple(map(int, match.groups()))
    raise RuntimeError('Reader counter is unavailable')


def bounds(node):
    return tuple(map(int, re.findall(r'\d+', node.get('bounds'))))


def tap(label):
    node = next(n for n in nodes() if n.get('content-desc') == label and n.get('enabled') == 'true')
    left, top, right, bottom = bounds(node)
    adb('shell', 'input', 'tap', str((left + right) // 2), str((top + bottom) // 2))


def visible(expected=None, scroll=True):
    deadline = time.monotonic() + 45
    while time.monotonic() < deadline:
        items = nodes()
        try:
            current, count = counter(items)
        except RuntimeError:
            time.sleep(0.3)
            continue
        label = re.compile(rf'{current} 페이지, \d+ 구간' if scroll else rf'{current} 페이지')
        if (expected is None or current == expected) and any(label.fullmatch(n.get('content-desc', '')) for n in items):
            return items
        time.sleep(0.3)
    raise RuntimeError('Expected page did not become visible')


def visible_parts(items, page):
    parts = []
    for node in items:
        match = re.fullmatch(rf'{page} 페이지, (\d+) 구간', node.get('content-desc', ''))
        if match:
            left, top, right, bottom = bounds(node)
            if right > left and bottom > top:
                parts.append(int(match.group(1)))
    return parts


parser = argparse.ArgumentParser()
parser.add_argument('--book-id', type=int, default=2)
parser.add_argument('--last-page', action='store_true', help='Walk to the final synthetic page, including its long image')
parser.add_argument('--output', type=pathlib.Path, default=pathlib.Path('/tmp/android-scroll-check.json'))
args = parser.parse_args()
if not 0 < args.book_id < 2**53:
    parser.error('positive safe book id required')
result = {'platform': 'android', 'api': adb('shell', 'getprop', 'ro.build.version.sdk').strip(), 'checks': [], 'samples': []}


def record(name, passed):
    result['checks'].append({'name': name, 'passed': bool(passed)})
    args.output.write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result['checks'][-1]), flush=True)
    if not passed:
        raise RuntimeError(name)


def memory(stage):
    text = adb('shell', 'dumpsys', 'meminfo', PACKAGE)
    pss = re.search(r'TOTAL PSS:\s*(\d+)', text)
    bitmap = re.search(r'Bitmap \(malloced\):\s*(\d+)\s*(\d+)', text)
    paths = adb('shell', 'run-as', PACKAGE, 'find', f'cache/comic-extracted/{args.book_id}/scroll', '-name', 'manifest.json').splitlines()
    result['samples'].append({'stage': stage, 'pssKiB': int(pss.group(1)),
                              'bitmapKiB': int(bitmap.group(2)) if bitmap else None, 'renderedSourcePages': len(paths)})
    args.output.write_text(json.dumps(result, indent=2) + '\n')


rotation = adb('shell', 'settings', 'get', 'system', 'user_rotation').strip()
auto = adb('shell', 'settings', 'get', 'system', 'accelerometer_rotation').strip()
try:
    adb('shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', f'mobilecbzviewer://reader/{args.book_id}', PACKAGE)
    visible(1, scroll=False)
    tap('열람 모드: 페이지')
    items = visible(1)
    count = counter(items)[1]
    memory('first screen')
    record('First viewport renders without preparing the whole chapter', result['samples'][-1]['renderedSourcePages'] < count)
    canvas = next(n for n in items if n.get('content-desc') == '세로 스크롤 만화')
    left, top, right, bottom = bounds(canvas)
    x = (left + right) // 2
    for _ in range(3):
        adb('shell', 'input', 'swipe', str(x), str(bottom - 100), str(x), str(top + 100), '450')
    items = visible()
    page = counter(items)[0]
    record('Vertical swipes advance the shared current-page counter', page > 1)
    tap('열람 모드: 세로 스크롤')
    visible(page, scroll=False)
    tap('열람 모드: 페이지')
    visible(page)
    record('Page to scroll and back preserves the current page', True)
    adb('shell', 'settings', 'put', 'system', 'accelerometer_rotation', '0')
    adb('shell', 'settings', 'put', 'system', 'user_rotation', '1')
    visible(page)
    adb('shell', 'settings', 'put', 'system', 'user_rotation', '0')
    visible(page)
    record('Landscape and portrait keep the same current page', True)
    memory('after swipe and rotation')
    if args.last_page:
        tap('열람 모드: 세로 스크롤')
        items = visible(page, scroll=False)
        next_button = next(n for n in items if n.get('content-desc') == '다음 →')
        left, top, right, bottom = bounds(next_button)
        for _ in range(count - page):
            adb('shell', 'input', 'tap', str((left + right) // 2), str((top + bottom) // 2))
        visible(count, scroll=False)
        tap('열람 모드: 페이지')
        items = visible(count)
        before_parts = visible_parts(items, count)
        canvas = next(n for n in items if n.get('content-desc') == '세로 스크롤 만화')
        left, top, right, bottom = bounds(canvas)
        x = (left + right) // 2
        for _ in range(5):
            adb('shell', 'input', 'swipe', str(x), str(bottom - 100), str(x), str(top + 100), '450')
        after_parts = visible_parts(visible(count), count)
        record('Final long page remains accessible and scrolls across its image bands', max(after_parts) > max(before_parts))
        memory('long final page')
    result['passed'] = all(check['passed'] for check in result['checks'])
    args.output.write_text(json.dumps(result, indent=2) + '\n')
finally:
    for key, value in [('user_rotation', rotation), ('accelerometer_rotation', auto)]:
        if value == 'null':
            adb('shell', 'settings', 'delete', 'system', key)
        else:
            adb('shell', 'settings', 'put', 'system', key, value)
