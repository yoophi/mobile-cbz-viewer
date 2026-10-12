"""Test the shared save warning/retry UI against an isolated real SQLite failure."""
import argparse
import json
import pathlib
import re
import subprocess
import time
import xml.etree.ElementTree as ET

PACKAGE = 'com.yoophi.mobilecbzviewer'
WARNING = '읽던 위치를 저장하지 못했습니다. 앱을 닫기 전에 다시 시도해 주세요.'
RETRY = '읽던 위치 저장 다시 시도'


def adb(*args):
    return subprocess.check_output(['adb', *args], text=True)


def nodes():
    adb('shell', 'uiautomator', 'dump', '/sdcard/mobile-cbz-warning-check.xml')
    return list(ET.fromstring(adb('shell', 'cat', '/sdcard/mobile-cbz-warning-check.xml')).iter('node'))


def wait_for(predicate):
    deadline = time.monotonic() + 45
    while time.monotonic() < deadline:
        try:
            items = nodes()
            if predicate(items):
                return items
        except subprocess.CalledProcessError:
            pass  # Observe the same app again; startup may not yet expose an idle UI.
        time.sleep(.3)
    raise RuntimeError('Expected warning UI did not appear')


def has(items, label):
    return any(n.get('text') == label or n.get('content-desc') == label for n in items)


def tap(label):
    node = next(n for n in nodes() if (n.get('text') == label or n.get('content-desc') == label) and n.get('clickable') == 'true')
    left, top, right, bottom = map(int, re.findall(r'\d+', node.get('bounds')))
    adb('shell', 'input', 'tap', str((left + right) // 2), str((top + bottom) // 2))


def outcome():
    return json.loads(adb('shell', 'run-as', PACKAGE, 'cat', 'files/reading-save-ui-probe-result.json'))


parser = argparse.ArgumentParser()
parser.add_argument('--output', type=pathlib.Path, default=pathlib.Path('/tmp/android-reading-save-warning-check.json'))
args = parser.parse_args()
adb('shell', 'am', 'force-stop', PACKAGE)
adb('shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d',
    'exp+mobile-cbz-viewer://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8081', PACKAGE)
wait_for(lambda items: has(items, '나의 만화 서재'))
adb('shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', 'mobilecbzviewer://reading-save-ui-diagnostics', PACKAGE)
wait_for(lambda items: has(items, WARNING))
tap(RETRY)
wait_for(lambda items: has(items, WARNING) and has(items, RETRY))
failed = outcome()
if not failed['blocked'] or not failed['warningVisible'] or failed['persisted'] or not failed['pendingStateRetained']:
    raise RuntimeError('Blocked retry did not preserve the visible failure and pending position')
tap('Remove simulated SQLite failure')
wait_for(lambda items: has(items, 'Simulated SQLite failure removed'))
tap(RETRY)
wait_for(lambda items: not has(items, WARNING) and not has(items, RETRY))
success = outcome()
if success['blocked'] or success['warningVisible'] or not success['persisted'] or success['retries'] != 2:
    raise RuntimeError('Successful retry did not persist the pending position and clear the UI')
result = {'platform': 'android', 'checks': [
    {'name': 'Real SQLite save failure and unsuccessful retry remain visible with pending position intact', 'passed': True},
    {'name': 'After removing the failure, the retry button commits pending state and removes the warning', 'passed': True}],
    'failedRetry': failed, 'successfulRetry': success, 'passed': True}
args.output.write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps(result['checks']), flush=True)
adb('shell', 'input', 'keyevent', '4')
