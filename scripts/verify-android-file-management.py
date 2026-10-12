#!/usr/bin/env python3
"""Verify picker/duplicate/reading/delete flow on an own tiny synthetic CBZ.
Requires an installed development APK with current Metro already loaded. Uses
read-only SQLite copies; changes only the new owned fixture via product UI.
Leaves the provider fixture in Downloads to prove it was not deleted.
"""
import time,pathlib,subprocess,tempfile,sqlite3,json,re,io,zipfile,xml.etree.ElementTree as ET

def adb(*args): return subprocess.check_output(['adb',*map(str,args)],text=True)
def nodes():
 adb('shell','uiautomator','dump','/sdcard/cbz-file-management-ui.xml')
 return list(ET.fromstring(adb('shell','cat','/sdcard/cbz-file-management-ui.xml')).iter('node'))
def tap(label):
 n=next(n for n in nodes() if n.get('text')==label or n.get('content-desc')==label)
 x1,y1,x2,y2=map(int,re.findall(r'\d+',n.get('bounds')))
 adb('shell','input','tap',(x1+x2)//2,(y1+y2)//2)
APP='com.yoophi.mobilecbzviewer'; TITLE='file-management-ui.cbz'
def rows():
 with tempfile.TemporaryDirectory(prefix='cbz-file-ui-') as d:
  p=pathlib.Path(d)/'library.db'
  for suffix in ['', '-wal']:
   try: pathlib.Path(str(p)+suffix).write_bytes(subprocess.check_output(['adb','exec-out','run-as',APP,'cat','files/SQLite/library.db'+suffix],stderr=subprocess.DEVNULL))
   except subprocess.CalledProcessError:
    if not suffix: raise
  db=sqlite3.connect(f'file:{p}?mode=ro',uri=True); db.row_factory=sqlite3.Row
  try: return [dict(r) for r in db.execute('SELECT id,name,archivePath,size,status FROM comics ORDER BY id')]
  finally: db.close()
def wait(predicate):
 for _ in range(25):
  ui=nodes()
  if predicate(ui): return ui
  time.sleep(.2)
 raise AssertionError('Expected UI state not reached')
def pick():
 tap('CBZ 파일 가져오기'); wait(lambda ui:any(n.get('text')==TITLE for n in ui));tap(TITLE)
def exists(path):
 return subprocess.run(['adb','shell','run-as',APP,'test','-e',path],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode==0
# Dedicated own fixture only. Never overwrite an existing provider file.
fixture_path='/sdcard/Download/'+TITLE
if subprocess.run(['adb','shell','test','-f',fixture_path],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode:
 source=pathlib.Path(__file__).resolve().parents[1]/'src/diagnostics/zip-fixture.ts'
 match=re.search(r'export const imageBytes = new Uint8Array\(\[([^]]+)\]',source.read_text())
 assert match
 png=bytes(map(int,match.group(1).split(',')))
 with tempfile.TemporaryDirectory(prefix='cbz-own-ui-fixture-') as folder:
  path=pathlib.Path(folder)/TITLE
  with zipfile.ZipFile(path,'w') as archive:
   archive.writestr('1.png',png); archive.writestr('2.png',png)
   archive.writestr('identity.txt','Own synthetic file management UI test')
  subprocess.check_call(['adb','push',str(path),fixture_path])
assert int(adb('shell','stat','-c','%s',fixture_path))<32768, 'Unexpected existing provider file'
with zipfile.ZipFile(io.BytesIO(subprocess.check_output(['adb','exec-out','cat',fixture_path]))) as archive:
 assert set(archive.namelist())=={'1.png','2.png','identity.txt'}
 assert archive.read('identity.txt')==b'Own synthetic file management UI test', 'Provider fixture is not owned by this test'
checks=[]
def check(label,passed):
 assert passed,label
 checks.append(label); print('PASS',label,flush=True)
adb('shell','am','start','-a','android.intent.action.VIEW','-d','mobilecbzviewer:///',APP)
wait(lambda ui:any(n.get('text')=='나의 만화 서재' for n in ui))
before=rows(); assert not any(r['name']==TITLE for r in before), 'Own UI fixture already exists; do not delete an existing book'
pick(); wait(lambda ui:any(n.get('content-desc')==TITLE+' 열기' and n.get('enabled')=='true' for n in ui))
current=rows(); imported=next(r for r in current if r['name']==TITLE)
check('system picker imports synthetic CBZ and prepares its two pages',len(current)==len(before)+1 and imported['status']=='ready')
tap(TITLE+' 열기'); wait(lambda ui:any(n.get('text')=='1 / 2' for n in ui));tap('다음 →')
wait(lambda ui:any(n.get('text')=='2 / 2' for n in ui));tap('서재로')
wait(lambda ui:any(n.get('text')=='읽던 위치 · 2 페이지 · 페이지' for n in ui))
check('library displays the position after reader navigation',True)
pick(); wait(lambda ui:any('같은 내용의 파일이 이미 서재에 있습니다:' in n.get('text','') for n in ui))
check('duplicate picker selection shows a notice and creates no additional book',rows()==current)
tap(TITLE+' 삭제'); wait(lambda ui:any(n.get('text')=='만화를 삭제할까요?' for n in ui));tap('취소')
check('cancelled native confirmation keeps original and library entry',rows()==current and exists('files/'+imported['archivePath']))
tap(TITLE+' 삭제'); wait(lambda ui:any(n.get('text')=='만화를 삭제할까요?' for n in ui));tap('삭제')
wait(lambda ui:any(n.get('text')=='만화와 관련 파일을 삭제했습니다.' for n in ui))
check('confirmed native deletion removes library entry, original and extracted cache',rows()==before
 and not exists('files/'+imported['archivePath']) and not exists('cache/comic-extracted/'+str(imported['id'])))
check('other books and their original files stay unchanged',all(exists('files/'+r['archivePath']) for r in before))
check('document provider source remains after deleting app copy',subprocess.run(['adb','shell','test','-f','/sdcard/Download/'+TITLE]).returncode==0)
result={'platform':'Android emulator API36','nativeBuild':'existing development APK','passed':len(checks),'checks':checks,'fixture':TITLE,'otherBooks':len(before),'sourcePatch':'content identity and durable deletion schema6; final library focus/writes behavior'}
pathlib.Path(tempfile.gettempdir(),'android-file-management-ui.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
