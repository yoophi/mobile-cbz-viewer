# 페이지·스크롤 확대 진행 기록

이 기록은 #9의 페이지·세로 스크롤 확대 구현을 설명합니다. #9는 iOS 실행과 실기기 검증이 남아 진행 중입니다.

## 동작

설치된 Gesture Handler 2.32와 Reanimated 4.5를 사용합니다. 앱 루트에 GestureHandlerRootView를 두고, 현재 페이지의 이미지만 UI 스레드에서 변환합니다. 핀치 확대 범위는 1–4배입니다. 더블 탭은 터치한 지점을 기준으로 2.5배 확대하거나 기본 배율로 복원합니다. 확대 중에는 한 손가락으로 이동하고, 표시 중인 이미지의 contain 크기와 뷰포트에 따라 이동 범위를 제한합니다. 확대된 이미지가 화면보다 작은 축은 가운데에 유지합니다.

초점 좌표에서 변환 전 원본 좌표를 구하고 새 배율·초점 위치에 맞춰 이동량을 계산합니다. 화면 가장자리에서는 빈 영역을 드러내지 않는 경계 제한이 초점 유지보다 우선합니다. Android는 두 번째 손가락을 떼는 순간 남은 손가락의 좌표로 마지막 pinch update를 보냅니다. 두 손가락 미만의 update를 무시하여 이미지가 갑자기 이동하지 않도록 합니다. 세 번째 손가락의 추가·제거로 포인터 수가 바뀌면 현재 변환을 새 초점·배율 기준으로 다시 고정해 좌표 점프를 방지합니다. 다중 터치는 더블 탭으로 인식하지 않습니다.

페이지 변경, 모드 변경, 원본 복구·이미지 재시도, 화면 크기 변경은 확대 상태를 초기화합니다. 확대 상태는 저장하지 않습니다. 제스처는 페이지 번호나 읽기 상태를 변경하지 않고, 기존 이전·다음 버튼으로 페이지를 이동합니다. 현재 페이지의 화면 맞춤 이미지 버퍼를 확대하므로 높은 배율에서는 원본보다 흐릴 수 있습니다. 확대 해상도 개선은 기존 메모리 예산 검증과 함께 후속 검증해야 합니다.

## 세로 스크롤의 우선순위

세로 스크롤에서는 현재 보이는 뷰포트를 확대합니다. 이미 로드한 가상화 구간을 확대하며 책 전체를 디코딩하지 않습니다. 이동 경계는 원래 뷰포트의 확대된 경계입니다. 다른 구간으로 스크롤하려면 기본 배율로 복원합니다. 명시적 페이지 이동과 모드 변경은 확대 상태를 초기화하고 기존 원본 페이지·내부 위치 모델을 유지합니다.

React Native FlatList에 Native gesture를 한 번 연결합니다. 핀치와 확대 상태의 pan이 Native gesture를 차단하고, 기본 배율의 pan은 즉시 실패해 한 손가락 스크롤을 허용합니다. 두 번째 손가락이 내려온 동안과 확대 상태에서는 FlatList의 scrollEnabled도 끕니다. 더블 탭은 Native gesture와 동시에 판별해 탭으로 스크롤을 시작하지 않도록 합니다.

## 검증 방법

`npm test`의 zoom 테스트는 contain 여백, 초점 이동을 포함한 원본 좌표 유지, 극단적인 이동과 반복 확대의 범위 제한을 확인합니다.

`scripts/android/TouchProbe.java`는 Android shell 전용 입력 도구입니다. 앱 권한이나 앱 네이티브 소스를 변경하지 않습니다. Android SDK 36 android.jar로 javac 컴파일 후 d8로 dex를 생성하고 `/data/local/tmp/cbz-touch.dex`에 push합니다. `app_process`로 실제 두 포인터 MotionEvent 스트림을 주입합니다. 루트 권한은 필요하지 않습니다. 내부 InputManagerGlobal API를 사용하는 테스트 도구이므로 다른 Android 버전에서는 별도 호환성 확인이 필요합니다.

```sh
mkdir -p /tmp/cbz-touch/classes /tmp/cbz-touch/dex
javac -source 8 -target 8 -cp "$ANDROID_HOME/platforms/android-36/android.jar" -d /tmp/cbz-touch/classes scripts/android/TouchProbe.java
"$ANDROID_HOME/build-tools/36.0.0/d8" --lib "$ANDROID_HOME/platforms/android-36/android.jar" --output /tmp/cbz-touch/dex /tmp/cbz-touch/classes/TouchProbe.class
adb push /tmp/cbz-touch/dex/classes.dex /data/local/tmp/cbz-touch.dex
python3 scripts/verify-android-page-zoom.py
python3 scripts/verify-android-scroll-zoom.py
python3 scripts/verify-android-active-zoom-rotation.py
python3 scripts/verify-android-active-page-rotation.py --port 8084 --output docs/validation/android-active-page-rotation.json
python3 scripts/verify-android-fling-zoom.py --port 8084 --output docs/validation/android-fling-zoom.json
```

페이지 검증 스크립트는 개발 빌드의 `zoom-diagnostics` 화면에서 동일한 ZoomCanvas를 실제 입력으로 조작합니다. 합성 화면의 뷰포트와 종료 시점 변환을 읽어 초점·경계를 확인합니다. 추가로 직접 생성한 reader-sample 책(id 1)을 열어 확대·가장자리 드래그 후 페이지 유지와 버튼 이동 후 초기화를 확인합니다. 사용자 책을 대상으로 실행하지 마세요. 개발 앱을 새로 실행해 초기 진단 상태를 만든 뒤 실행해야 합니다. 앱 업데이트 적용 여부가 불확실하면 같은 검증 결과를 재사용하지 말고 새 앱 실행으로 확인합니다.

스크롤 검증은 직접 만든 40페이지 reader-stress-1 책(id 2)을 사용합니다. 일반 스크롤과 초기화 후 스크롤 재개를 확인하고, 실제 두·세 손가락 핀치와 확대 중 수직·가장자리 드래그 전후 SQLite 읽기 상태를 읽기 전용 복사본으로 비교합니다. 페이지·내부 위치·모드·방향을 비교하므로 페이지 번호가 같아도 내부 위치가 이동하면 실패합니다. 페이지 버튼·모드 변경의 초기화도 확인합니다.

## Android 메모리 관찰

제스처 검증 후 재시작한 개발 앱에서 `scripts/measure-android-scroll-zoom.py`로 측정했습니다. 새 서재 PSS는 약497.1 MiB, 스크롤 진입 후 약566.6 MiB, 핀치 후 약567.4 MiB였습니다. 20회 더블 탭 확대·초기화 동안 PSS는 약559.1–574.5 MiB였고 malloc 비트맵은 약25.1 MiB로 같았습니다. 네이티브 힙 PSS는 스크롤 진입349,836 KiB에서 20회 후361,277 KiB로 증가했습니다. 이 표본만으로 장시간 누적 증가나 누수가 없다고 판정하지 않습니다.

앞선 동일 AVD의 PSS 기준450 MiB를 초과했으므로 메모리 검증은 통과로 처리하지 않습니다. 확대 전의 서재부터 기준보다 높아 원인을 아직 확대 비트맵에 한정할 수 없습니다. 기존 커밋과의 동일 조건 비교, 개발 도구·런타임 초기 사용량과 네이티브 힙의 구분, 릴리스·저메모리 기기의 재측정이 필요합니다. 기존 기준을 높여 통과 처리하지 않습니다. [원시 관찰](validation/android-scroll-zoom-memory.json)에 기록했습니다.

## 같은 네이티브 앱에서 소스 비교

같은 설치 APK·에뮬레이터·보관 파일·읽기 위치(4/40)를 유지하고 제스처 전 `0d3a568`과 제스처 후 `8f27168`의 Metro 소스를 번갈아 실행했습니다. 각 실행은 앱 프로세스를 종료한 뒤 새로 시작하고, 서재 표지와 실제 스크롤 이미지 표시를 확인한 후2초·10초에 측정했습니다. 기준 소스는 별도 worktree에 `npm ci`로 동일 잠금 파일을 설치했습니다. 의존성 symlink로 시도했던 최초 실행은 이미지 모듈 로드 오류가 있었으므로 폐기했습니다.

| 소스 | 서재 PSS (MiB) | 스크롤 PSS (MiB) | 스크롤 malloc 비트맵 (MiB) |
| --- | --- | --- | --- |
| `0d3a568` | 386.8–392.0 | 404.6–421.7 | 25.1 |
| `8f27168` | 486.6–493.0 | 537.9–559.0 | 25.1 |

10초 시점의 네이티브 힙 PSS도 서재 약175.6→273.8 MiB, 스크롤 약204.2→341.3 MiB로 증가했습니다. 설치된 네이티브 모듈과 비트맵 크기가 같은 조건에서도 제스처 소스 추가에 따른 높은 초기 사용량이 재현됐습니다. 이것만으로 주 JS 힙, Reanimated UI 런타임, 기타 네이티브 할당 중 어느 쪽의 원인인지 확정하지는 않습니다. [기준 소스](validation/android-memory-before-zoom.json), [현재 소스](validation/android-memory-with-zoom.json)에 모든 관찰을 보존합니다.

재현 도구는 `scripts/compare-android-reader-memory.py --port <Metro 포트> --source-commit <해시> --output <JSON 경로>`입니다. 같은 APK와 데이터를 사용하고, UI 확인 실패 시 비교를 성공으로 처리하지 않습니다. 자동 개발 앱 재시작은 데이터를 초기화하지 않습니다.

## 최적화 JS 실행 오류 수정

같은 개발 APK에서 `expo start --no-dev --minify`로 실행했을 때, 이미지 처리의 동적 import가 추가 JavaScript 청크의 호스팅 URL을 찾으려 했고 네이티브 환경의 `location` 부재로 서재·책 열기가 실패했습니다. 이 실패 실행의 메모리 수치는 유효한 비교 표본으로 사용하지 않았습니다.

`library.ts`와 `scroll-cache.ts`의 Expo Image·ImageManipulator를 정적 import로 바꾸어 이미지 처리 경로에서 추가 청크 URL을 요구하지 않도록 했습니다. 동일 조건에서 수정 후 서재·40페이지 책의 실제 스크롤 이미지·서재 복귀를 확인했습니다. 이 검증은 개발 APK에 공급한 최적화 JS이며 실제 릴리스 네이티브 빌드 검증은 별도입니다. 수정 코드의 Android 네이티브 프로브20개(페이지·표지6, 이미지 방향·긴 구간8, 캐시 압박·취소6)도 통과했습니다. 최적화 JS에서 실제 두·세 손가락 확대, 스크롤 잠금·재개, 페이지·모드 초기화와 SQLite 위치 유지 검증15개도 통과했습니다. [제스처 결과](validation/android-scroll-zoom-production-js.json). [원시 결과](validation/android-static-image-probes.json).

수정 후 개발 JS의 스크롤 PSS는 약557.5–566.0 MiB, 최적화 JS는 약487.8–503.7 MiB였습니다. 두 조건 모두450 MiB 기준을 초과했습니다. 정적 import 수정으로 런타임 로딩 오류를 해결했으며, 전체 메모리 문제가 해결됐다고 판정하지 않습니다. [개발 JS](validation/android-memory-development-static-imports.json), [최적화 JS](validation/android-memory-production-js-static-imports.json)에 소스가 `8f27168` 위의 미커밋 정적 import 패치였음을 명시했습니다.

Android arm64 릴리스 APK 빌드도 시작했으나 아직 완료되지 않았습니다. 네이티브 의존성 다운로드와 실제 빌드·실행이 끝난 뒤 서명 호환성을 확인해 데이터를 유지한 채 측정해야 합니다.

## 회전 후 원본 위치 보존

확대한 스크롤 화면을 가로로 회전하는 추가 검증에서 페이지 번호는 같지만 내부 위치가 바뀌는 현상을 발견했습니다. 실제 SQLite 값은 0 기반 페이지 index 3의 fraction 0에서 0.00014589461129336625로 바뀌었습니다. 새 화면 폭에 맞춘 자동 스크롤 위치가 네이티브 픽셀로 반올림된 후 저장 좌표를 다시 덮어쓴 결과였습니다.

자동 복원에 대응하는 첫 스크롤 이벤트는 저장 위치를 바꾸지 않고, 같은 네이티브 offset의 중복 이벤트도 무시합니다. 사용자가 실제로 스크롤하면 위치 저장을 재개합니다. 회전 검증은 확대 초기화와 SQLite의 페이지·내부 위치·모드·방향 보존을 함께 확인하고, 실패 시에도 기기의 회전 설정을 원래 값으로 복원합니다.

수정 소스를 새로 실행한 Android 개발 APK·최적화 JS에서 기존 제스처15개와 추가 회전6개, 총21개 검증이 통과했습니다. 페이지 내부 위치에서 가로·세로 회전 후 저장 좌표가 그대로 유지되며, 회전 후 일반 스크롤도 재개됐습니다. [원시 결과](validation/android-scroll-zoom-rotation.json). 타입 검사·린트·42개 모델 테스트·iOS/Android JS 번들 생성도 통과했습니다. 이는 확대 동작이 끝난 상태에서 회전한 검증이며, 손가락 입력이 진행 중인 회전과 릴리스 네이티브 실행은 별도 범위입니다.

## 입력이 진행 중인 회전

추가된 검증 도구는 실제 스크롤 뷰포트 경계를 읽어 두 손가락 입력을 보냅니다. `TouchProbe --slow`는 각 이동 사이100ms를 기다리고5번째 이동 직후 표식을 출력합니다. 이 시점부터 손가락을 떼기까지 최소2.5초가 남습니다. 검증은 표식 이후 회전을 요청하고 Android WindowManager의 실제 화면 회전 값이 바뀌었음을 확인합니다. 입력 프로세스가 살아 있고 표식 이후2.5초 이내에 변경된 경우만 입력 중 회전으로 인정합니다.

Android 개발 APK·최적화 JS에서 추가7개 검증이 통과했습니다. 두 방향 모두 회전이 입력 중에 적용됐고, 확대 초기화와 SQLite의 페이지·내부 위치·모드·방향 보존, 이후 일반 스크롤 재개를 확인했습니다. 실패한 경우에도 기기의 회전 설정을 복원합니다. [원시 관찰](validation/android-active-zoom-rotation.json). 이 결과는 스크롤 모드의 Android 검증이며 페이지 모드 입력 중 회전, iOS·실기기·릴리스 실행과 관성 스크롤 중 확대는 별도 범위입니다.

## 페이지 모드 입력 중 회전

`verify-android-active-page-rotation.py`는 직접 만든 3페이지 `reader-sample.cbz`(id 1)의 실제 페이지 리더를 사용합니다. 화면에 표시된 이미지의 네이티브 경계에서 두 손가락 입력 좌표를 구합니다. 좌→우·우→좌 각각에서 핀치 입력 중 가로·세로로 회전합니다. `TouchProbe --slow`의5번째 이동 표식 이후2.5초 안에 WindowManager의 실제 회전 변경과 살아 있는 입력 프로세스를 함께 확인합니다.

입력이 끝난 뒤 확대 초기화, SQLite의 페이지·내부 위치·모드·방향 보존, 실제 이미지와 페이지 표시의 일치를 확인합니다. 각 읽기 방향에서 더블 탭 확대·초기화와 버튼 페이지 이동도 다시 실행합니다. 합성 책의 읽기 상태만 정상 UI로 변경하고 SQLite는 읽기 전용 복사본으로 조회합니다. 실패 시에도 기기의 원래 회전 설정을 복원합니다.

Android 개발 APK·개발 JS에서22개 검증이 통과했습니다. 네 번 모두 실제 회전이 입력 표식 이후2.5초 안에 적용됐고, 저장 위치와 표시 페이지가 유지됐습니다. [원시 결과](validation/android-active-page-rotation.json). 타입 검사와 린트도 통과했습니다. 페이지·스크롤 모드의 Android 입력 중 회전 근거를 확보했으며 iOS·실기기·릴리스 범위는 남아 있습니다.

## 관성 스크롤 중 핀치 검증

`scroll-gesture-diagnostics`는 개발 빌드 전용 화면으로, 직접 만든 40페이지 `reader-stress-1.cbz`(id 2)를 확인한 뒤 제품과 같은 ScrollReader를 사용합니다. 원본·읽기 상태는 수정하지 않고 현재 원본 페이지·내부 위치 콜백과 스크롤 offset, 잠금·관성 이벤트를 최대256개 기록합니다. 화면에서 벗어나면 책 참조를 해제하고 이미지 뷰를 제거합니다. 제품 화면에서는 관찰 콜백을 넘기지 않습니다.

`TouchProbe --fling`는 빠른 한 손가락 이동과 해제를 비동기로 주입하고180ms 후 실제 두 손가락 핀치를 시작합니다. 각 이벤트의 처리를 동기 대기하면 에뮬레이터 부하에 따라 마지막 이동 이후 긴 정지가 생겨 관성이 발생하지 않을 수 있기 때문입니다. 주입 성공이나 해제 표식만으로 관성 검증을 통과시키지 않습니다. 같은 기기 시계로 기록한 네이티브 관성 시작, 이후 offset 이동, 핀치 첫 DOWN의 순서를 비교하고 핀치 전에 관성 종료가 관찰된 실행도 실패로 처리합니다.

검증 도구는 앱을 새로 실행하는 세 번의 반복에서 관성 중 핀치, 확대 후 위치 잠금, 한 손가락 드래그의 위치 유지, 초기화와 일반 스크롤 재개를 확인합니다. Android API36의 큰 세로 뷰포트와 현재 개발 JS를 제공하는 Metro가 필요합니다. 실제 제품의 SQLite 저장, iOS·실기기·릴리스 실행, 확대 해상도·메모리는 별도 범위입니다.

Android 개발 APK·개발 JS에서 세 번의 반복, 총15개 검증이 통과했습니다. [원시 이벤트와 결과](validation/android-fling-zoom.json)에 입력 표식, 관성 offset, 잠금 이후 위치와 재개 이후 위치를 기록했습니다. 타입 검사·린트·44개 모델 테스트·iOS/Android JS 번들 생성도 통과했습니다. 이번 추가는 진단·검증이며 기존 제품의 제스처 우선순위 동작을 수정하지 않았습니다. 전체 플랫폼 대상 #9는 아직 진행 중입니다.

## 남은 범위

- 페이지·스크롤 입력 중 회전과 관성 중 확대의 iOS·실기기·릴리스 검증
- 큰 이미지 확대 시 화질·메모리 측정
- iOS 실제 실행과 iPhone/iPad 검증

iOS JS 번들 생성은 iOS 네이티브 제스처 검증을 대신하지 않습니다. 현재 Xcode 라이선스 미동의로 시뮬레이터 실행이 막혀 있습니다.
