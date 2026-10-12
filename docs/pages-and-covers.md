# 페이지 목록과 표지 (#5)

페이지는 디렉터리 구성 요소를 먼저 비교하고 각 요소의 ASCII 숫자를 자연 정렬한다. `1.jpg → 2.jpg → 10.jpg` 순서를 사용하며 숫자의 자릿수에는 제한이 없다. 같은 숫자는 앞쪽 0이 적은 이름을 먼저 둔다. 한글 등 문자열은 NFC 정규화와 대소문자 무시 비교 후 원문으로 순서를 결정한다. OS 언어나 ICU 정렬 설정에 의존하지 않는다. 숨김 경로와 `__MACOSX`는 제외한다.

SQLite v3의 `comic_pages`에 책 ID, 0부터 시작하는 순서, 원본 상대 경로, 파일 크기를 저장한다. 재실행 후에도 DB 순서대로 읽으며 파일 URI는 현재 캐시 루트에서 계산한다. v1/v2 마이그레이션은 기존 책·원본·파일명·시각을 보존한다. 이전 추출 캐시는 새 `pages/` 구조로 다시 생성해야 하므로 재시도 가능한 상태로 전환한다.

첫 페이지를 [Expo Image의 크기 제한](https://docs.expo.dev/versions/v57.0.0/sdk/image/#imageloadoptions)으로 240×360 픽셀 이내에 로딩하고 [ImageManipulator](https://docs.expo.dev/versions/v57.0.0/sdk/imagemanipulator/)로 JPEG 표지를 저장한다. 원본을 JS Base64로 읽지 않는다. 원본 페이지와 표지·manifest 폴더를 분리하여 만화 내부 파일명과 충돌하지 않게 한다. 생성에 사용한 네이티브 이미지 참조와 임시 출력은 정리한다.

손상 이미지로 표지 생성이 실패하면 경고와 빈 표지를 표시하며 페이지 목록과 서재를 계속 사용할 수 있다. 뷰어의 개별 페이지 디코딩 오류와 누락 파일 복구는 #6에서 처리한다. JPEG/PNG/WebP는 Android 개발 빌드의 실제 디코더로 확인했고 iOS 검증은 아직 남아 있다.

## 검증

`npm test`는 숫자·한글·중첩 경로·대소문자·큰 숫자·앞쪽 0·입력 순서 독립성·숨김 파일 규칙을 검사한다. 기존 ZIP 검사와 합쳐 21개 자동 검사가 통과했다.

`mobilecbzviewer://pages-diagnostics`는 격리 DB에서 합성 PNG를 JPEG/WebP로 생성한 뒤, 뒤섞인 ZIP을 가져와 실제 마이그레이션·정렬·디코딩·표지 저장·DB 재연결·손상 이미지 처리 6개 항목을 실행한다. 진단 샘플과 DB는 끝나면 정리된다.

```sh
adb shell am start -a android.intent.action.VIEW -d 'mobilecbzviewer://pages-diagnostics' com.yoophi.mobilecbzviewer
adb shell run-as com.yoophi.mobilecbzviewer cat files/pages-probe-result.json
```

2026-10-12 Pixel_9 AVD / Android 16 API 36 / arm64-v8a에서 6개 실행 검사 통과. [결과 JSON](validation/android-pages-probe.json)을 보관한다. `expo-image-manipulator`는 SDK 57 호환 버전으로 설치했으며 네이티브 개발 빌드 재생성이 필요하다. Android APK 재빌드·설치·실행을 확인했다. iPhone/iPad 실행 결과는 #3 및 #14에서 추가해야 한다.
