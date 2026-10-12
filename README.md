# Mobile CBZ Viewer

아이폰·아이패드·안드로이드용 오프라인 CBZ 리더를 만드는 Expo / React Native / TypeScript 프로젝트입니다.

## 현재 구현

- Expo SDK 57, Expo Router 기반 초기 앱
- 시스템 파일 선택기로 `.cbz` 파일 가져오기 (iOS / Android)
- 선택 파일을 앱 내부 문서 저장소로 복사하고 SQLite에 파일명·크기·경로·등록 시각 저장
- 앱을 다시 실행해도 보관 파일 목록 유지
- ZIP 경로·심볼릭 링크·항목 수·크기·압축률 검사 및 실제 이미지 스트림 크기·CRC 확인
- JPEG/PNG/WebP 항목만 임시 폴더로 추출하고 성공 후 열람 준비 상태 저장
- 추출 취소·오류·앱 중단·캐시 삭제 후 원본 보존과 재시도
- 자연 정렬된 페이지 목록·크기·순서의 SQLite 저장과 첫 페이지 JPEG 표지
- 단일 페이지 맞춤 열람, 양방향 페이지 이동, 회전 시 페이지 유지와 누락·손상 이미지 복구
- 중앙 탭으로 표시·숨기는 상단 도구, 투명한 좌우 가장자리 페이지 이동, 한 장/두 장 선택과 간격 없는 중앙 맞춤 배치
- 페이지·세로 스크롤의 핀치 확대·제한된 이동·더블 탭 복원과 확대 중 스크롤 잠금
- 페이지 모드의 현재 한·두 페이지만 디코딩하고 추출 캐시 512 MiB·표지 16 MiB의 LRU 예산 및 활성 책 보호
- 화면 폭에 맞춘 세로 스크롤, 페이지 모드 전환 및 회전 후 현재 페이지 유지
- 이미지 비율의 DB 저장과 긴 이미지 구간 표시, 화면 근처만 로드하는 가상화 목록
- 책별 페이지·스크롤 내부 위치·모드·방향의 SQLite 저장과 재실행 복원
- 내용 식별자·블록 비교에 따른 중복 안내와 동명 파일의 별도 보관
- 삭제 확인·원본과 관련 캐시/DB 정리·중단 후 삭제 재개
- 서재의 읽던 위치 표시와 누락 원본의 명시적 재가져오기
- 저장 실패 경고·재시도와 스크롤 쓰기 빈도 제한
- 아이패드 지원, 화면 회전 허용, 넓은 화면에서 콘텐츠 폭 제한
- 큰 글꼴에서 서재·리더 조작 영역 스크롤, 현재 페이지 접근성 안내와 시스템 애니메이션 감소 설정 반영
- Expo Development Build와 EAS 빌드 프로필 설정

**서재·페이지/세로 스크롤 열람·확대·읽던 위치 복원과 파일 관리를 구현했습니다.** Android 에뮬레이터에서 네이티브 실행을 검증했고 iOS 실행 검증은 대기 중입니다. 같은 파일을 다시 선택하면 중복을 안내하며, 앱의 삭제 기능은 파일 선택기의 원본을 유지합니다. 앱 삭제 시 앱 내부 보관 파일은 삭제될 수 있습니다. 파일 관리·복구 정책은 [서재 파일 관리 기록](docs/file-management.md), 페이지 정렬·표지·마이그레이션은 [페이지 구성 기록](docs/pages-and-covers.md), 지원 형식과 크기 제한은 [안전한 추출 기록](docs/safe-extraction.md)을 참고하세요.

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

열람 동작과 Android 실행 결과는 [단일 페이지 열람 기록](docs/single-page-reader.md), 대용량·1,000페이지 메모리 측정과 캐시 정책은 [이미지·캐시 예산](docs/image-and-cache-budgets.md)을 참고하세요.

페이지·스크롤 확대의 초기화·경계 정책과 남은 검증은 [확대 진행 기록](docs/page-zoom.md)을 참고하세요.

세로 스크롤의 이미지 구간·위치 모델·검증 범위는 [스크롤 열람 기록](docs/scroll-reader.md)에 남깁니다.

읽던 위치·설정 저장, 저장 실패 UI와 재실행 검증은 [읽기 상태 기록](docs/reading-state.md)을 참고하세요.

## 검증

```sh
npm run typecheck
npm run lint
npm test
npx expo-doctor
npx expo export --platform ios --platform android --output-dir dist
```

초기 구성에서 타입 검사·린트·Expo 진단·양 플랫폼 JS 번들 생성을 확인합니다. 네이티브 앱 실행 및 실제 기기의 파일 가져오기·재시작·회전 동작은 별도 검증해야 합니다. 번들 생성은 네이티브 컴파일이나 실기기 검증을 대신하지 않습니다.

## 작업 관리 (td)

네이티브 ZIP 모듈 검증과 재현 방법은 [검증 기록](docs/native-zip-validation.md)에 남깁니다. 모듈 설치와 실제 기기 호환성 검증은 구분하며, CBZ 열람 기능은 후속 작업입니다.

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

1. iOS 개발 빌드에서 네이티브 ZIP·추출·복구 검증 완료
2. iOS 단일 페이지 뷰어·읽기 방향·누락 이미지 복구 검증
3. 세로 스크롤의 iOS·실기기·캐시 압박 및 중단 복구 검증
4. 이미지 로딩·캐시 정책의 iOS 검증, 확대 / 이동 제스처
5. 읽던 위치·중복·삭제·저장 공간 부족의 iOS·실기기 검증
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
