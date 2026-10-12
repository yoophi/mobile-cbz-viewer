#!/usr/bin/env python3
"""Real Android touch verification. Uses only generated reader-sample book id 1.
Build scripts/android/TouchProbe.java with Android SDK javac/d8 and push classes.dex
as /data/local/tmp/cbz-touch.dex first. Start the dev app/Metro before this script.
"""
import json, math, re, subprocess, time, xml.etree.ElementTree as ET

APP = 'com.yoophi.mobilecbzviewer'
def adb(*args):
    return subprocess.check_output(['adb', *map(str, args)], text=True)
def nodes():
    adb('shell', 'uiautomator', 'dump', '/sdcard/cbz-zoom-ui.xml')
    return list(ET.fromstring(adb('shell', 'cat', '/sdcard/cbz-zoom-ui.xml')).iter('node'))
def bounds(node): return list(map(int, re.findall(r'\d+', node.attrib['bounds'])))
def tap(label):
    node = next(n for n in nodes() if label in [n.get('text'), n.get('content-desc')])
    x1, y1, x2, y2 = bounds(node)
    adb('shell', 'input', 'tap', (x1+x2)//2, (y1+y2)//2)
def route(path):
    adb('shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', 'mobilecbzviewer://'+path, APP)
    time.sleep(1)
def probe():
    for _ in range(5):
        for node in nodes():
            label = node.get('content-desc', '')
            if label.startswith('zoom:'):
                return json.loads(label[5:]), bounds(node)
        time.sleep(.3)
    raise AssertionError('Gesture diagnostic is not ready')
def pinch(start, end):
    adb('shell', 'CLASSPATH=/data/local/tmp/cbz-touch.dex', 'app_process', '/system/bin', 'TouchProbe', *start, *end)
    time.sleep(.2)
def check_bounds(value, size):
    assert 1 <= value['scale'] <= 4
    for axis, extent in [('x', 'width'), ('y', 'height')]:
        assert abs(value[axis]) <= (value['scale']-1)*size[extent]/2 + .01

route('zoom-diagnostics')
data, label_bounds = probe()
assert data['value'] == {'scale': 1, 'x': 0, 'y': 0}, 'Restart route/app for a fresh diagnostic'
density = data['size']['width'] and label_bounds[2] / data['size']['width']
width = label_bounds[2]; top = label_bounds[3]
height = data['size']['height'] * density
cx, cy = round(width*.5), round(top+height*.4)
start = [cx-100,cy,cx+100,cy]; end = [cx-300,cy,cx+300,cy]
pinch(start, end)
data, _ = probe(); value, size = data['value'], data['size']
assert 1.5 < value['scale'] < 4
for axis, focal in [('x',cx/density-size['width']/2), ('y',(cy-top)/density-size['height']/2)]:
    assert abs(value[axis] - (1-value['scale'])*focal) < 2, (axis, value, focal)
check_bounds(value,size)
checks = ['real two-pointer pinch retains focal pixel after pointer lift']
adb('shell','input','swipe',cx,cy,width-20,round(top+height-20),300)
data,_ = probe(); check_bounds(data['value'],data['size'])
assert abs(data['value']['x']-value['x']) + abs(data['value']['y']-value['y']) > 10, 'Drag did not move image'
checks.append('zoomed one-finger drag stays inside viewport bounds')
tap('확대 초기화'); data,_ = probe(); assert data['value'] == {'scale':1,'x':0,'y':0}
adb('shell',f'input tap {cx} {cy}; input tap {cx} {cy}')
data,_=probe(); assert data['value']['scale']==2.5
adb('shell',f'input tap {cx} {cy}; input tap {cx} {cy}')
data,_=probe(); assert data['value']=={'scale':1,'x':0,'y':0}
checks.append('double tap zoom/reset and explicit reset')
for _ in range(3): pinch(start,end)
data,_=probe(); check_bounds(data['value'],data['size']); assert data['value']['scale']==4
checks.append('repeated pinch saturates at 4x without leaving bounds')
route('reader/1')
ui=nodes()
if any(n.get('content-desc')=='열람 모드: 세로 스크롤' for n in ui): tap('열람 모드: 세로 스크롤')
ui=nodes()
page_label=next(n.get('text') for n in ui if re.fullmatch(r'\d+ / 3', n.get('text','')))
pinch([440,1000,640,1000],[240,1000,840,1000])
adb('shell','input','swipe',500,1000,30,1500,200)
ui=nodes(); assert any(n.get('text')==page_label for n in ui)
assert any(n.get('content-desc')=='확대 초기화' for n in ui)
checks.append('pinch and edge drag do not change real reader page')
# The sample has three pages; choose an enabled navigation button by current index/direction.
button=next(n for n in ui if n.get('clickable')=='true' and n.get('enabled')=='true' and
    n.get('content-desc') in ['다음 →','← 다음','이전 →','← 이전'])
tap(button.get('content-desc')); ui=nodes()
assert not any(n.get('content-desc')=='확대 초기화' for n in ui)
assert not any(n.get('text')==page_label for n in ui)
checks.append('explicit page navigation resets zoom')
print(json.dumps({'platform':'Android emulator API36','checks':checks,'passed':len(checks)},ensure_ascii=False,indent=2))
