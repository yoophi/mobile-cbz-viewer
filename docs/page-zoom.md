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
```

페이지 검증 스크립트는 개발 빌드의 `zoom-diagnostics` 화면에서 동일한 ZoomCanvas를 실제 입력으로 조작합니다. 합성 화면의 뷰포트와 종료 시점 변환을 읽어 초점·경계를 확인합니다. 추가로 직접 생성한 reader-sample 책(id 1)을 열어 확대·가장자리 드래그 후 페이지 유지와 버튼 이동 후 초기화를 확인합니다. 사용자 책을 대상으로 실행하지 마세요. 개발 앱을 새로 실행해 초기 진단 상태를 만든 뒤 실행해야 합니다. 앱 업데이트 적용 여부가 불확실하면 같은 검증 결과를 재사용하지 말고 새 앱 실행으로 확인합니다.

스크롤 검증은 직접 만든 40페이지 reader-stress-1 책(id 2)을 사용합니다. 일반 스크롤과 초기화 후 스크롤 재개를 확인하고, 실제 두·세 손가락 핀치와 확대 중 수직·가장자리 드래그 전후 SQLite 읽기 상태를 읽기 전용 복사본으로 비교합니다. 페이지·내부 위치·모드·방향을 비교하므로 페이지 번호가 같아도 내부 위치가 이동하면 실패합니다. 페이지 버튼·모드 변경의 초기화도 확인합니다.

## Android 메모리 관찰

제스처 검증 후 재시작한 개발 앱에서 `scripts/measure-android-scroll-zoom.py`로 측정했습니다. 새 서재 PSS는 약497.1 MiB, 스크롤 진입 후 약566.6 MiB, 핀치 후 약567.4 MiB였습니다. 20회 더블 탭 확대·초기화 동안 PSS는 약559.1–574.5 MiB였고 malloc 비트맵은 약25.1 MiB로 같았습니다. 네이티브 힙 PSS는 스크롤 진입349,836 KiB에서 20회 후361,277 KiB로 증가했습니다. 이 표본만으로 장시간 누적 증가나 누수가 없다고 판정하지 않습니다.

앞선 동일 AVD의 PSS 기준450 MiB를 초과했으므로 메모리 검증은 통과로 처리하지 않습니다. 확대 전의 서재부터 기준보다 높아 원인을 아직 확대 비트맵에 한정할 수 없습니다. 기존 커밋과의 동일 조건 비교, 개발 도구·런타임 초기 사용량과 네이티브 힙의 구분, 릴리스·저메모리 기기의 재측정이 필요합니다. 기존 기준을 높여 통과 처리하지 않습니다. [원시 관찰](validation/android-scroll-zoom-memory.json)에 기록했습니다.

## 남은 범위

- 스크롤 관성 동작 중 확대 시작 및 회전 중 조작의 추가 네이티브 검증
- 큰 이미지 확대 시 화질·메모리 측정
- iOS 실제 실행과 iPhone/iPad 검증

iOS JS 번들 생성은 iOS 네이티브 제스처 검증을 대신하지 않습니다. 현재 Xcode 라이선스 미동의로 시뮬레이터 실행이 막혀 있습니다.
