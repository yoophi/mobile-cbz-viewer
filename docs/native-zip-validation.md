# 네이티브 ZIP 검증 (#3)

## 후보와 선택 근거

Expo SDK 57 / React Native 0.86에서 `react-native-zip-archive` 9.5.3을 검증 후보로 고정한다. [모듈 문서](https://github.com/mockingbot/react-native-zip-archive#readme)는 React Native 0.82 이상에서 New Architecture를 사용하며 Expo 개발 빌드가 필요하다고 명시한다. 앱은 모듈의 config plugin과 autolinking을 사용한다.

네이티브 파일 경로 기반 추출을 사용하면 CBZ 전체를 JS 메모리나 Base64로 읽을 필요가 없다. `listContents`로 경로·크기·암호화 여부를 조회한 뒤 허용한 파일만 `unzip`의 `entries` 옵션으로 추출할 수 있다. 파일 URI는 `file://`를 제거하고 URL 인코딩을 해제한 경로로 전달한다.

## 안전성 범위와 후속 구현

모듈 설치만으로 CBZ 안전성 검증이 완성되지는 않는다. #4에서 경로, 항목 수, 개별/총 추출 크기, 압축률, 암호화, 지원 이미지 형식을 제한해야 한다. `listContents`는 심볼릭 링크 속성을 공개하지 않으므로 ZIP 중앙 디렉터리의 UNIX 속성을 별도로 검사해야 한다. 네이티브 추출기의 경로 이탈 방어에만 의존하지 않는다.

`AbortSignal`의 JS promise는 네이티브 작업 종료보다 먼저 거부될 수 있다. 취소 즉시 같은 폴더를 재사용하거나 삭제하지 않고, 네이티브 작업의 종료를 확인할 수 있는 순서 및 재실행 정리 정책이 필요하다. 현재 진단의 취소 검사는 시작 전 취소만 검증한다.

## 재현

[Expo 개발 빌드 안내](https://docs.expo.dev/develop/development-builds/introduction/)에 따라 네이티브 프로젝트를 생성하고 빌드한다. 생성된 `ios/`, `android/`는 커밋하지 않는다.

```sh
npm ci
npx expo run:android
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer npx expo run:ios
```

이미 네이티브 디렉터리가 있고 의존성/설정이 바뀌었다면 `npx expo prebuild --clean`으로 재생성한다. 이 명령은 생성된 네이티브 폴더를 대체하므로 수동 변경이 없는지 확인한다.

개발 빌드에서 `mobilecbzviewer://zip-diagnostics`를 열면 합성 PNG CBZ를 앱 캐시에 작성하고 실제 네이티브 모듈로 검증한다. 외부 만화와 서재 DB는 사용하지 않는다.

```sh
# Android 개발 서버가 8081에서 실행 중인 경우
adb reverse tcp:8081 tcp:8081
adb shell am start -a android.intent.action.VIEW -d 'exp+mobile-cbz-viewer://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8081' com.yoophi.mobilecbzviewer
# 개발 서버 연결이 완료된 뒤 진단 화면을 연다.
adb shell am start -a android.intent.action.VIEW -d 'mobilecbzviewer://zip-diagnostics' com.yoophi.mobilecbzviewer
adb shell run-as com.yoophi.mobilecbzviewer cat files/zip-probe-result.json

# iOS Simulator
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcrun simctl openurl booted 'mobilecbzviewer://zip-diagnostics'
```

검사 대상은 추출 전 항목 정보, 한글·중첩 경로, 선택 추출과 PNG 바이트 일치, 손상 파일 거부, 시작 전 취소이다. 결과는 화면과 앱 문서 폴더의 `zip-probe-result.json`에 기록되며 캐시 샘플은 정리한다. 릴리스 빌드에서는 진단 실행을 차단한다.

샘플은 `python3 scripts/generate-zip-fixture.py`로 재생성할 수 있다. 생성기는 고정 ZIP 시각과 유효한 PNG/ZIP CRC를 사용한다.

## 결과

- iOS: Xcode 27.0은 설치되어 있으나 라이선스 미동의로 Simulator 실행/빌드가 차단됨. 사용자 동의 후 재검증 필요.
- EAS: 현재 CLI가 로그인되어 있지 않음. 클라우드 빌드를 실행하지 않음.
- Android: 2026-10-12, Pixel_9 AVD / Android 16 (API 36) / arm64-v8a. Gradle 9.3.1 개발 APK 빌드 성공(7분 26초), 설치 및 Fabric 런타임 실행 성공. 진단 4개 항목 모두 통과했고 캐시 샘플 삭제를 확인했다. [실행 결과 JSON](validation/android-zip-probe.json)을 보관한다. 실기기 결과는 아직 없다.

검증한 Android 빌드 명령(Expo prebuild가 생성한 프로젝트 사용):

```sh
JAVA_HOME=/Library/Java/JavaVirtualMachines/temurin-21.jdk/Contents/Home ANDROID_HOME="$HOME/Library/Android/sdk" NODE_ENV=development ./android/gradlew -p android app:assembleDebug -PreactNativeArchitectures=arm64-v8a
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

양 플랫폼 개발 빌드 실행과 샘플 검증이 확인될 때까지 #3은 완료하지 않는다. 시뮬레이터 결과와 실기기 결과는 구분하여 기록한다.
