# Android 릴리즈 설치 검증

현재 제품 소스 `b41a954`의 arm64 릴리즈 APK를 연결된 BOOX Go103(Android12/API32)에 업데이트 설치했다. 기존 서재와 읽던 위치를 유지했다. 개발 서버 reverse 연결을 제거한 상태에서 서재·만화 화면이 열리고, 두 장 중앙 배치·간격0과 중앙 탭에 따른 상단 도구·상태바·시스템 하단 바 표시/숨김을 확인했다.

Java21, Android SDK와 `NODE_ENV=production`으로 생성된 Android 프로젝트에서 `./gradlew :app:assembleRelease -PreactNativeArchitectures=arm64-v8a`를 실행했다. APK는 JS 번들을 포함하며 DEBUGGABLE 플래그가 없다. `apksigner verify` 및 타입 검사·린트가 통과했다. APK는 기존 개발 설치와 호환되는 디버그 인증서로 서명됐다. 스토어 배포용 서명 설정은 별도 작업이다.

[원시 결과](validation/android-release-install.json)는 제품 커밋·APK SHA256·검증 범위를 기록한다. 개인 서재 화면과 기기 식별자는 공개 기록에 포함하지 않는다. 릴리즈 메모리·전체 접근성·iOS 검증을 통과로 처리하지 않는다.
