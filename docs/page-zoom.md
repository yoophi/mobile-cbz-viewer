# 단일 페이지 확대 진행 기록

이 기록은 #9의 단일 페이지 부분 구현을 설명합니다. #9는 진행 중이며 세로 스크롤 제스처 우선순위와 iOS 실행 검증은 남아 있습니다.

## 동작

설치된 Gesture Handler 2.32와 Reanimated 4.5를 사용합니다. 앱 루트에 GestureHandlerRootView를 두고, 현재 페이지의 이미지만 UI 스레드에서 변환합니다. 핀치 확대 범위는 1–4배입니다. 더블 탭은 터치한 지점을 기준으로 2.5배 확대하거나 기본 배율로 복원합니다. 확대 중에는 한 손가락으로 이동하고, 표시 중인 이미지의 contain 크기와 뷰포트에 따라 이동 범위를 제한합니다. 확대된 이미지가 화면보다 작은 축은 가운데에 유지합니다.

초점 좌표에서 변환 전 원본 좌표를 구하고 새 배율·초점 위치에 맞춰 이동량을 계산합니다. 화면 가장자리에서는 빈 영역을 드러내지 않는 경계 제한이 초점 유지보다 우선합니다. Android는 두 번째 손가락을 떼는 순간 남은 손가락의 좌표로 마지막 pinch update를 보냅니다. 두 손가락 미만의 update를 무시하여 이미지가 갑자기 이동하지 않도록 합니다. 다중 터치는 더블 탭으로 인식하지 않습니다.

페이지 변경, 모드 변경, 원본 복구·이미지 재시도, 화면 크기 변경은 확대 상태를 초기화합니다. 확대 상태는 저장하지 않습니다. 제스처는 페이지 번호나 읽기 상태를 변경하지 않고, 기존 이전·다음 버튼으로 페이지를 이동합니다. 현재 페이지의 화면 맞춤 이미지 버퍼를 확대하므로 높은 배율에서는 원본보다 흐릴 수 있습니다. 확대 해상도 개선은 기존 메모리 예산 검증과 함께 후속 검증해야 합니다.

## 검증 방법

`npm test`의 zoom 테스트는 contain 여백, 초점 이동을 포함한 원본 좌표 유지, 극단적인 이동과 반복 확대의 범위 제한을 확인합니다.

`scripts/android/TouchProbe.java`는 Android shell 전용 입력 도구입니다. 앱 권한이나 앱 네이티브 소스를 변경하지 않습니다. Android SDK 36 android.jar로 javac 컴파일 후 d8로 dex를 생성하고 `/data/local/tmp/cbz-touch.dex`에 push합니다. `app_process`로 실제 두 포인터 MotionEvent 스트림을 주입합니다. 루트 권한은 필요하지 않습니다. 내부 InputManagerGlobal API를 사용하는 테스트 도구이므로 다른 Android 버전에서는 별도 호환성 확인이 필요합니다.

```sh
mkdir -p /tmp/cbz-touch/classes /tmp/cbz-touch/dex
javac -source 8 -target 8 -cp "$ANDROID_HOME/platforms/android-36/android.jar" -d /tmp/cbz-touch/classes scripts/android/TouchProbe.java
"$ANDROID_HOME/build-tools/36.0.0/d8" --lib "$ANDROID_HOME/platforms/android-36/android.jar" --output /tmp/cbz-touch/dex /tmp/cbz-touch/classes/TouchProbe.class
adb push /tmp/cbz-touch/dex/classes.dex /data/local/tmp/cbz-touch.dex
python3 scripts/verify-android-page-zoom.py
```

검증 스크립트는 개발 빌드의 `zoom-diagnostics` 화면에서 동일한 ZoomCanvas를 실제 입력으로 조작합니다. 합성 화면의 뷰포트와 종료 시점 변환을 읽어 초점·경계를 확인합니다. 추가로 직접 생성한 reader-sample 책(id 1)을 열어 확대·가장자리 드래그 후 페이지 유지와 버튼 이동 후 초기화를 확인합니다. 사용자 책을 대상으로 실행하지 마세요. 개발 앱을 새로 실행해 초기 진단 상태를 만든 뒤 실행해야 합니다. 앱 업데이트 적용 여부가 불확실하면 같은 검증 결과를 재사용하지 말고 새 앱 실행으로 확인합니다.

## 남은 범위

- 세로 스크롤에서 핀치·확대 이동이 FlatList 스크롤로 처리되지 않는 우선순위
- 세 번째 손가락 추가·제거와 빠른 연속 입력, 회전 중 조작의 추가 네이티브 검증
- 큰 이미지 확대 시 화질·메모리 측정
- iOS 실제 실행과 iPhone/iPad 검증

iOS JS 번들 생성은 iOS 네이티브 제스처 검증을 대신하지 않습니다. 현재 Xcode 라이선스 미동의로 시뮬레이터 실행이 막혀 있습니다.
