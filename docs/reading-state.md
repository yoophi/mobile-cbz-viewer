# 읽던 위치와 설정 저장 (#10, 진행 중)

책마다 페이지 index, 이미지 안의 fraction, page/scroll 모드, ltr/rtl 방향, 갱신 시각을 SQLite에 저장한다. fraction은 원본 이미지 상단부터 화면 상단까지의 비율이다. 페이지 모드로 전환해도 같은 페이지의 스크롤 위치를 보존하며, 명시적인 페이지 이동은 fraction을 0으로 초기화한다.

## 저장과 복원

schema 5는 comic_reading_state 테이블을 추가한다. comicId가 기존 서재의 외래 키이며 읽기 상태에 파일 URI를 저장하지 않는다. 기존 원본·추출 파일·페이지 geometry·표지는 유지한다. 최초 상태는 첫 페이지, page 모드, ltr 방향이다. 서재의 원본 보관 파일은 기존 archivePath 상대 경로로 찾는다.

책을 열 때 추출 페이지 수를 확인한 뒤 읽기 상태를 복원한다. 페이지 수가 줄면 마지막 유효 페이지로 보정하고 fraction을 0으로 초기화한다. 누락/잘못된 index·fraction·모드·방향도 유효한 기본값 또는 범위로 보정한다. 보정한 상태는 다시 저장한다. 추출 캐시를 지워도 읽기 상태는 유지된다.

스크롤 이벤트는 최신 값으로 합쳐 기본 1초 간격으로 저장한다. 페이지 이동·모드·방향 버튼, 화면 이탈, 앱 비활성화는 대기 중인 최신 상태를 즉시 flush한다. 쓰기는 책별로 직렬화하여 이전 작업이 늦게 끝나 최신 위치를 덮지 않는다. 화면 이탈 시 시작한 저장을 다음 화면 진입의 복원이 기다린다.

일반적인 백그라운드 전환 뒤 종료·재실행을 검증했다. OS가 비활성화 이벤트나 DB 쓰기 완료 전에 프로세스를 즉시 종료하면 마지막 미완료 저장을 보장할 수 없다. 스크롤의 자동 저장 사이에는 최대 약 1초의 변경이 대기할 수 있고, 느린 저장소에서는 DB 작업 시간이 추가된다.

## 저장 실패

SQLite 쓰기 실패를 호출자에게 반환하며 최신 미저장 상태를 메모리에 유지한다. 뷰어와 서재는 같은 실패 목록을 구독하여 경고와 재시도 버튼을 표시한다. 화면을 벗어났다는 이유로 실패를 숨기지 않는다. 재시도가 성공해야 경고를 지운다. 저장 불가능한 상태로 앱을 닫으면 미저장 메모리 상태를 잃을 수 있으므로 경고에서 닫기 전 재시도를 안내한다.

실패한 같은 revision을 계속 자동 재시도하지 않는다. 새로운 읽기 조작, 명시적 재시도, 또는 lifecycle flush는 다시 저장할 수 있다. 자동 저장 실패·동시 flush·대기 쓰기 순서와 마지막 revision을 보존하는 단위 테스트가 있다.

## 검증

- 전체 Node 테스트 39개 통과: 새 상태 보정·쓰기 병합·동시 flush·실패 재시도 테스트 4개 포함.
- Android 실제 SQLite 검사 8개: v4→v5 보존과 기본값, DB 재열기, 책별 분리, 상대 경로/캐시 누락/페이지 수 변경 보정, 실제 INSERT 트리거 오류와 경고 구독, 최신 상태 재시도, 직렬화, 캐시 정리 후 유지. [결과](validation/android-reading-store.json).
- Android 실제 앱 UI 검사 6개: 페이지·RTL 저장, 스크롤 fraction 저장, 화면 재진입, 회전, 모드 왕복, 홈 화면 전환 뒤 force-stop·재실행. 같은 index·fraction·mode·direction이 복원되는 것을 앱 화면과 DB의 읽기 전용 사본에서 확인했다. [결과](validation/android-reading-state.json).
- 저장 실패 UI 검사 2개: 별도 DB의 실제 트리거 오류에서 실패한 재시도 후 경고·미저장 상태 유지, 오류 해제 후 버튼으로 저장하고 경고 제거. 실제 앱과 같은 ReadingSaveNotice 컴포넌트를 사용한다. [결과](validation/android-reading-save-warning.json).
- schema 5 변경 후 추출 17·페이지 6·캐시 4·크기/구간 8·스크롤 캐시 압박 6개의 Android 네이티브 회귀 검사를 추가 확인한다. [전체 결과](validation/android-reading-regressions.json).
- 타입 검사·린트·Android/iOS JS 번들 통과. 네이티브 기준 기기는 Pixel 9 API 36 AVD다.

## 재현

개발 앱과 Metro를 실행하고 합성 stress CBZ를 가져온 뒤 해당 서재 id로 검사한다. 실제 개인 만화의 읽기 진행률에는 검사 스크립트를 실행하지 않는다. 테스트 결과에는 파일명·만화 내용·계정 정보가 포함되지 않는다.

```sh
python3 scripts/verify-android-reading-state.py --book-id 2
python3 scripts/verify-android-reading-save-warning.py
```

서비스 검사는 개발 전용 `mobilecbzviewer://reading-diagnostics`, 실패 UI는 `mobilecbzviewer://reading-save-ui-diagnostics`로 실행한다. 모두 별도 DB·디렉터리를 사용한다. 후자는 개발용 오류 해제 버튼을 제공하며 일반 앱 화면에는 이 버튼이 없다.

## 남은 완료 조건

iOS의 inactive/background 전환·화면 제스처 이탈·재실행, 양 플랫폼 실기기 종료/저장소 압박/장시간 쓰기, 확대·두 페이지 보기 추가 후 공통 위치 모델 회귀 검증이 남았다. Xcode 라이선스 미승인으로 iOS 네이티브 실행을 아직 확인하지 못했다. #10과 전체 MVP는 진행 중이며 JS 번들 생성으로 해당 실행 검증을 대신하지 않는다.

API 근거: [Expo SDK 57 SQLite](https://docs.expo.dev/versions/v57.0.0/sdk/sqlite/), [Expo Router](https://docs.expo.dev/versions/v57.0.0/sdk/router/), [React Native 0.86 AppState](https://reactnative.dev/docs/0.86/appstate).
