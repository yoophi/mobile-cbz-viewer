# Mobile CBZ Viewer

아이폰·아이패드·안드로이드용 오프라인 CBZ 리더를 만드는 Expo / React Native / TypeScript 프로젝트입니다.

## 현재 구현

- Expo SDK 57, Expo Router 기반 초기 앱
- 시스템 파일 선택기로 `.cbz` 파일 가져오기 (iOS / Android)
- 선택 파일을 앱 내부 문서 저장소로 복사하고 SQLite에 파일명·크기·경로·등록 시각 저장
- 앱을 다시 실행해도 보관 파일 목록 유지
- 아이패드 지원, 화면 회전 허용, 넓은 화면에서 콘텐츠 폭 제한
- Expo Development Build와 EAS 빌드 프로필 설정

**현재는 서재와 파일 보관 단계입니다. CBZ 압축 해제, 이미지 표시, 읽던 위치 저장은 아직 구현하지 않았습니다.** 확장자만 확인하므로 ZIP 내부 구조도 후속 단계에서 검증해야 합니다. 같은 파일을 다시 가져오면 별도 항목으로 보관합니다. 파일 삭제 UI는 아직 없으며, 앱 삭제 시 보관 파일도 삭제될 수 있습니다.

## 개발 시작

Node.js LTS와 npm을 준비합니다. 의존성의 Node 엔진 조건을 충족하는 버전을 사용하세요.

```sh
npm ci
npm start
```

권장 실행 환경은 개발 빌드입니다. 네이티브 모듈 변경 시 앱을 다시 빌드하세요.

```sh
# macOS + Xcode (선택된 developer directory도 Xcode여야 함)
npm run ios

# Android SDK + JDK + 기기 또는 에뮬레이터
npm run android
```

EAS 클라우드 빌드도 사용할 수 있습니다. 최초 사용 시 Expo 계정과 프로젝트 연결, iOS 서명 설정 등이 필요합니다. 이 저장소는 아직 EAS 프로젝트에 연결되지 않았습니다.

```sh
npx eas-cli@latest build --profile development --platform ios
npx eas-cli@latest build --profile development --platform android
```

`npm run web`은 화면 미리보기 용도입니다. 웹에서는 파일 가져오기를 비활성화하며, 정식 지원 대상은 iOS / Android입니다.

## 검증

```sh
npm run typecheck
npm run lint
npx expo-doctor
npx expo export --platform ios --platform android --output-dir dist
```

초기 구성에서 타입 검사·린트·Expo 진단·양 플랫폼 JS 번들 생성을 확인합니다. 네이티브 앱 실행 및 실제 기기의 파일 가져오기·재시작·회전 동작은 별도 검증해야 합니다. 번들 생성은 네이티브 컴파일이나 실기기 검증을 대신하지 않습니다.

## 작업 관리 (td)

`td`의 GitHub Issues 저장소를 사용하며, 대상은 `origin`의 [yoophi/mobile-cbz-viewer](https://github.com/yoophi/mobile-cbz-viewer/issues)입니다. `td`와 GitHub CLI(`gh`)를 설치하고 GitHub 인증을 완료한 뒤 프로젝트 루트에서 초기화합니다.

```sh
td init --store=gh-issue
td config list
td doctor
td --refresh list
```

초기화는 기존 데이터를 자동으로 이전하지 않습니다. 새 작업 환경에서도 위 명령으로 연결을 설정하고 확인하세요. 인증 정보와 로컬 상태·캐시는 커밋하지 않습니다.

## 구조

- `src/app/`: Expo Router 화면 및 앱 레이아웃
- `src/services/library.ts`: 내부 파일 보관 및 SQLite 저장
- `app.json`: 플랫폼, 식별자, 화면 회전, 플러그인 설정
- `eas.json`: development / preview / production 빌드 프로필

네이티브 프로젝트는 Expo 설정으로 생성하므로 `ios/`, `android/`는 커밋하지 않습니다. 개인 CBZ와 `.env` 파일도 공개 저장소에서 제외합니다.

## 다음 작업

1. Expo / RN 버전과 호환되는 네이티브 ZIP 모듈 검증
2. ZIP 항목의 경로·크기·이미지 형식 검증과 안전한 추출
3. 자연 정렬, 표지 생성, 페이지 / 세로 스크롤 모드
4. 메모리를 제한하는 이미지 로딩, 확대 / 이동 제스처
5. 읽던 위치 저장, 파일 삭제, 중복 감지
6. 아이패드 두 페이지 및 창 크기 변화 대응
7. 한글 파일명·대용량 CBZ·중단 복구 실기기 테스트

데스크톱 다운로드 앱과는 파일 형식 및 순수 TypeScript 모델을 공유하는 방향입니다. 모바일 다운로드나 기기 간 동기화는 현재 범위에 포함되지 않습니다.

## 참고 문서

- [Expo SDK 57](https://docs.expo.dev/versions/v57.0.0/)
- [DocumentPicker](https://docs.expo.dev/versions/v57.0.0/sdk/document-picker/)
- [FileSystem](https://docs.expo.dev/versions/v57.0.0/sdk/filesystem/)
- [SQLite](https://docs.expo.dev/versions/v57.0.0/sdk/sqlite/)
- [Development builds](https://docs.expo.dev/develop/development-builds/introduction/)

## 의존성 점검

초기 템플릿 설치에서 `npm audit` 경고가 발견되었습니다. 호환되지 않는 Expo / React Native 버전으로 변경하는 `npm audit fix --force`는 적용하지 않습니다. 릴리스 전에 최신 감사 결과와 Expo 호환 패치를 검토하세요.
