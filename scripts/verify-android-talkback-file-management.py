#!/usr/bin/env python3
"""Import and delete an owned disposable CBZ through actual TalkBack gestures.
Requires API36 Pixel9 emulator, AccessibilityProbe dex and current Metro8084.
Reads SQLite snapshots only. Never deletes pre-existing library books. Restores
accessibility service settings and leaves the owned provider source in Downloads.
"""
import argparse
import io
import json
import pathlib
import re
import shlex
import sqlite3
import shutil
import subprocess
import tempfile
import time
import zipfile

APP = 'com.yoophi.mobilecbzviewer'
TITLE = 'talkback-file-management.cbz'
IDENTITY = b'Owned disposable TalkBack import and deletion verification'
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--output', type=pathlib.Path, required=True)
parser.add_argument('--serial', default='emulator-5554', help='Owned API36 emulator ADB serial')
args = parser.parse_args()
ADB = [shutil.which('adb') or str(pathlib.Path.home()/'Library/Android/sdk/platform-tools/adb'), '-s', args.serial]

def adb(*values):
    return subprocess.check_output(ADB + list(map(str, values)), text=True)

def probe(label=None, gesture=None):
    values = ['shell', 'CLASSPATH=/data/local/tmp/cbz-accessibility.dex', 'app_process', '/', 'AccessibilityProbe']
    if label is not None:
        values.append(shlex.quote(label))
    if gesture is not None:
        values.append(gesture)
    return json.loads(adb(*values))

def wait(predicate):
    for _ in range(30):
        ui = probe()
        if predicate(ui):
            return ui
        time.sleep(.3)
    pathlib.Path('/tmp/cbz-talkback-file-ui.json').write_text(json.dumps(ui, ensure_ascii=False, indent=2))
    raise AssertionError('Expected fresh native UI state not reached')

def bound():
    state = adb('shell', 'dumpsys', 'accessibility')
    assert 'label=TalkBack,' in state.split('Bound services:')[1].split('Enabled services:')[0]
    assert 'Crashed services:{}' in state
    return True

checks, observations = [], []
def check(name, condition):
    assert condition, name
    checks.append(name)
    print('PASS '+name, flush=True)

def activate(label):
    bound()
    ui = probe(label, '--double-tap')
    focused = [n for n in ui if n['accessibilityFocused'] and label in [n['text'], n['content-desc']]]
    assert len(focused) == 1, 'Verified accessibility focus required before activation'
    observations.append({'action': label, 'focusedBeforeGesture': focused[0], 'serviceBoundAfterGesture': bound()})

def ready(label):
    return wait(lambda ui: any(n['content-desc'] == label and n['enabled'] for n in ui))

def focus(label):
    for _ in range(3):
        focused = [n for n in probe(label) if n['accessibilityFocused'] and label in [n['text'], n['content-desc']]]
        if len(focused) == 1:
            return focused[0]
        time.sleep(.3)
    raise AssertionError('Stable accessibility focus required: '+label)

def select_file():
    ui = wait(lambda ui: any(n['text'] == TITLE for n in ui))
    title = next(n for n in ui if n['text'] == TITLE)
    target_rect = list(map(int, re.findall(r'\d+', title['bounds'])))
    # Start from a stable toolbar target before the file collection. The
    # provider no longer exposes the older 'Files in Downloads' caption.
    focus('Show roots')
    for _ in range(24):
        ui = probe(gesture='--next')
        focused = [n for n in ui if n['accessibilityFocused']]
        assert len(focused) == 1
        node = focused[0]
        rect = list(map(int, re.findall(r'\d+', node['bounds'])))
        contains_title = rect[0] <= target_rect[0] and rect[1] <= target_rect[1] and rect[2] >= target_rect[2] and rect[3] >= target_rect[3]
        if node['class'] == 'androidx.cardview.widget.CardView' and node['clickable'] and contains_title:
            break
    else:
        raise AssertionError('TalkBack did not reach the owned picker card')
    check('TalkBack next gesture reaches actionable owned file card', bound())
    ui = probe(gesture='--double-tap-focused')
    focused = [n for n in ui if n['accessibilityFocused']]
    assert len(focused) == 1 and focused[0]['bounds'] == node['bounds']
    observations.append({'action': 'select '+TITLE, 'focusedBeforeGesture': focused[0],
                         'descendantCaption': title, 'serviceBoundAfterGesture': bound()})

def snapshot():
    with tempfile.TemporaryDirectory(prefix='cbz-talkback-file-db-') as folder:
        path = pathlib.Path(folder)/'library.db'
        for suffix in ['', '-wal']:
            try:
                pathlib.Path(str(path)+suffix).write_bytes(subprocess.check_output(
                    [*ADB, 'exec-out', 'run-as', APP, 'cat', 'files/SQLite/library.db'+suffix], stderr=subprocess.DEVNULL))
            except subprocess.CalledProcessError:
                if not suffix:
                    raise
        db = sqlite3.connect(f'file:{path}?mode=ro', uri=True)
        db.row_factory = sqlite3.Row
        try:
            books = [dict(r) for r in db.execute('SELECT id,name,archivePath,size,status,pageCount,coverPath FROM comics ORDER BY id')]
            reading = [dict(r) for r in db.execute('SELECT comicId,pageIndex,fraction,mode,direction FROM comic_reading_state ORDER BY comicId')]
            pages = [dict(r) for r in db.execute('SELECT comicId,position,path FROM comic_pages ORDER BY comicId,position')]
            return {'books': books, 'reading': reading, 'pages': pages}
        finally:
            db.close()

def exists(relative):
    return subprocess.run([*ADB, 'shell', 'run-as', APP, 'test', '-e', shlex.quote(relative)],
                          stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0

def digest(relative):
    return adb('shell', 'run-as', APP, 'sha256sum', shlex.quote(relative)).split()[0]

assert adb('shell', 'getprop', 'ro.kernel.qemu').strip() == '1'
assert adb('shell', 'getprop', 'ro.build.version.sdk').strip() == '36'
assert 'Override size' not in adb('shell', 'wm', 'size') and '1080x2424' in adb('shell', 'wm', 'size')
assert adb('shell', 'settings', 'get', 'system', 'font_scale').strip() == '1.0'
before = snapshot()
assert not any(r['name'] == TITLE for r in before['books']), 'Never delete an existing library book'
original_hashes = {r['id']: digest('files/'+r['archivePath']) for r in before['books']}
provider = '/sdcard/Download/'+TITLE
if subprocess.run([*ADB, 'shell', 'test', '-f', provider], stdout=subprocess.DEVNULL).returncode:
    text = (pathlib.Path(__file__).resolve().parents[1]/'src/diagnostics/zip-fixture.ts').read_text()
    match = re.search(r'export const imageBytes = new Uint8Array\(\[([^]]+)\]', text)
    assert match
    png = bytes(map(int, match.group(1).split(',')))
    with tempfile.TemporaryDirectory(prefix='cbz-talkback-file-') as folder:
        path = pathlib.Path(folder)/TITLE
        with zipfile.ZipFile(path, 'w') as archive:
            archive.writestr('1.png', png)
            archive.writestr('2.png', png)
            archive.writestr('identity.txt', IDENTITY)
        subprocess.check_call([*ADB, 'push', str(path), provider])
assert int(adb('shell', 'stat', '-c', '%s', provider)) < 32768
with zipfile.ZipFile(io.BytesIO(subprocess.check_output([*ADB, 'exec-out', 'cat', provider]))) as archive:
    assert set(archive.namelist()) == {'1.png', '2.png', 'identity.txt'}
    assert archive.read('identity.txt') == IDENTITY, 'Provider file must be owned by this test'
provider_hash = adb('shell', 'sha256sum', provider).split()[0]
services = adb('shell', 'settings', 'get', 'secure', 'enabled_accessibility_services').strip()
enabled = adb('shell', 'settings', 'get', 'secure', 'accessibility_enabled').strip()
try:
    adb('reverse', 'tcp:8084', 'tcp:8084')
    adb('shell', 'am', 'force-stop', APP)
    adb('shell', 'am', 'start', '-n', APP+'/.MainActivity', '-a', 'android.intent.action.VIEW', '-d',
        'exp+mobile-cbz-viewer://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8084')
    ready('CBZ 파일 가져오기')
    service = 'com.google.android.marvin.talkback/com.google.android.marvin.talkback.TalkBackService'
    adb('shell', 'settings', 'put', 'secure', 'enabled_accessibility_services', service if services == 'null' else services+':'+service)
    adb('shell', 'settings', 'put', 'secure', 'accessibility_enabled', 1)
    time.sleep(3)
    check('TalkBack service bound during file-management flow', bound())
    activate('CBZ 파일 가져오기')
    select_file()
    ready(TITLE+' 열기')
    current = snapshot()
    imported = next(r for r in current['books'] if r['name'] == TITLE)
    check('TalkBack system picker imports and prepares owned two-page CBZ',
          len(current['books']) == len(before['books'])+1 and imported['status'] == 'ready' and imported['pageCount'] == 2)
    imported_pages = [r for r in current['pages'] if r['comicId'] == imported['id']]
    cover = 'cache/comic-extracted/'+str(imported['coverPath'])
    check('Imported source, both extracted pages and generated cover exist before deletion',
          exists('files/'+imported['archivePath']) and digest('files/'+imported['archivePath']) == provider_hash and len(imported_pages) == 2
          and all(exists('cache/comic-extracted/'+str(imported['id'])+'/pages/'+r['path']) for r in imported_pages)
          and imported['coverPath'] == str(imported['id'])+'/cover.jpg' and exists(cover))
    observations.append({'importedFixtureId': imported['id'], 'sourcePresent': True, 'sourceMatchesProvider': True,
                         'extractedPagesPresent': 2, 'coverPresent': True})
    activate(TITLE+' 열기')
    wait(lambda ui: any(n['content-desc'] == '1 페이지' for n in ui))
    activate('열람 도구 표시')
    wait(lambda ui: any(n['content-desc'] == '현재 1 페이지, 전체 2 페이지' for n in ui))
    activate('다음 페이지')
    wait(lambda ui: any(n['content-desc'] == '현재 2 페이지, 전체 2 페이지' for n in ui))
    activate('서재로')
    ready(TITLE+' 열기')
    current = snapshot()
    check('Imported book reading state persisted through TalkBack navigation',
          any(r['comicId'] == imported['id'] and r['pageIndex'] == 1 and r['mode'] == 'page' for r in current['reading']))
    for confirm in ['취소', '삭제']:
        ready(TITLE+' 열기')
        focus(TITLE+' 열기')
        focused = [n for n in probe(gesture='--next') if n['accessibilityFocused']]
        assert len(focused) == 1 and focused[0]['content-desc'] == TITLE+' 삭제'
        activate(TITLE+' 삭제')
        wait(lambda ui: any(n['text'] == '만화를 삭제할까요?' for n in ui))
        assert any(TITLE in n['text'] for n in probe()), 'Confirmation must name only the owned fixture'
        activate(confirm)
        if confirm == '취소':
            ready(TITLE+' 열기')
            check('TalkBack cancellation preserves new book and managed source', snapshot() == current and exists('files/'+imported['archivePath']))
        else:
            wait(lambda ui: any(n['text'] == '만화와 관련 파일을 삭제했습니다.' for n in ui))
    after = snapshot()
    check('TalkBack confirmed deletion removes book, pages and reading state', after == before)
    check('Managed original, extraction and cover are removed after confirmed deletion',
          not exists('files/'+imported['archivePath']) and not exists('cache/comic-extracted/'+str(imported['id']))
          and not exists(cover))
    check('Existing library originals remain byte-identical',
          all(digest('files/'+r['archivePath']) == original_hashes[r['id']] for r in before['books']))
    check('Document-provider source remains byte-identical', adb('shell', 'sha256sum', provider).split()[0] == provider_hash)
    args.output.write_text(json.dumps({'sourceCommit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip(),
        'checks': checks, 'observations': observations, 'fixture': TITLE, 'existingBooks': len(before['books']),
        'scope': 'API36 Pixel9 emulator; actual TalkBack input-filter activation; read-only SQLite and file/hash verification; no iOS/speech-output proof'},
        ensure_ascii=False, indent=2)+'\n')
finally:
    for key, value in [('enabled_accessibility_services', services), ('accessibility_enabled', enabled)]:
        adb('shell', 'settings', 'delete', 'secure', key) if value == 'null' else adb('shell', 'settings', 'put', 'secure', key, value)
