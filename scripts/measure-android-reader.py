"""Measure native reader memory after importing synthetic CBZs in the development app."""
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
    adb('shell', 'uiautomator', 'dump', '/sdcard/mobile-cbz-benchmark.xml')
    return list(ET.fromstring(adb('shell', 'cat', '/sdcard/mobile-cbz-benchmark.xml')).iter('node'))


def position(items):
    for node in items:
        match = re.fullmatch(r'(\d+) / (\d+)', node.get('text', ''))
        if match:
            return tuple(map(int, match.groups()))
    raise RuntimeError('Reader page counter is not visible')


def button(action):
    for node in nodes():
        if action in node.get('content-desc', '') and node.get('clickable') == 'true' and node.get('enabled') == 'true':
            left, top, right, bottom = map(int, re.findall(r'\d+', node.get('bounds')))
            return (left + right) // 2, (top + bottom) // 2
    raise RuntimeError('Requested page button is unavailable')


parser = argparse.ArgumentParser()
parser.add_argument('--book-ids', nargs='+', type=int, required=True)
parser.add_argument('--switches', type=int, default=8)
parser.add_argument('--page-changes', type=int, default=14)
parser.add_argument('--sweep', action='store_true', help='Visit every remaining page of each book')
parser.add_argument('--output', type=pathlib.Path, default=pathlib.Path('/tmp/android-reader-memory.json'))
args = parser.parse_args()
if args.switches < 1 or args.page_changes < 1 or any(not 0 < value < 2**53 for value in args.book_ids):
    parser.error('positive safe book ids and positive trial sizes are required')

result = {'model': adb('shell', 'getprop', 'ro.product.model').strip(),
          'api': adb('shell', 'getprop', 'ro.build.version.sdk').strip(),
          'display': adb('shell', 'wm', 'size').strip(),
          'density': adb('shell', 'wm', 'density').strip(), 'samples': []}


def capture(stage, expected=None):
    items = nodes()
    current, count = position(items)
    if expected is not None and current != expected:
        raise RuntimeError('Page movement did not reach the expected position')
    if not any(node.get('content-desc') == f'{current} 페이지' for node in items):
        raise RuntimeError('Current image is not visible (loading or decoder error)')
    text = adb('shell', 'dumpsys', 'meminfo', PACKAGE)
    pss = re.search(r'TOTAL PSS:\s*(\d+)', text)
    bitmap = re.search(r'Bitmap \(malloced\):\s*(\d+)\s*(\d+)', text)
    if not pss:
        raise RuntimeError('Native process memory report is unavailable')
    sample = {'stage': stage, 'page': current, 'pageCount': count, 'pssKiB': int(pss.group(1)),
              'bitmapCount': int(bitmap.group(1)) if bitmap else None,
              'bitmapKiB': int(bitmap.group(2)) if bitmap else None}
    result['samples'].append(sample)
    args.output.write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(sample), flush=True)
    return current, count


if not any(node.get('text') == '나의 만화 서재' for node in nodes()):
    raise RuntimeError('Start the development app on the library screen')
for trial in range(args.switches):
    book = args.book_ids[trial % len(args.book_ids)]
    adb('shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d',
        f'mobilecbzviewer://reader/{book}', PACKAGE)
    time.sleep(1)
    start, count = capture(f'trial{trial + 1} start')
    changes = count - start if args.sweep else min(args.page_changes, count - start)
    if changes:
        x, y = button('다음')
        for change in range(1, changes + 1):
            adb('shell', 'input', 'tap', str(x), str(y))
            if change % 100 == 0 or change == changes:
                time.sleep(1)
                capture(f'trial{trial + 1} forward', start + change)
    adb('shell', 'input', 'keyevent', '4')
    if not any(node.get('text') == '나의 만화 서재' for node in nodes()):
        raise RuntimeError('Android back did not return to the library')
