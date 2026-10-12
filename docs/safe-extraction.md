# 안전한 CBZ 추출과 복구 (#4)

## 처리 흐름

앱 전용 문서 폴더에 원본 CBZ를 보관하고 SQLite 상태를 `stored → extracting → ready`로 전환한다. 추출 전에 [ZIP 형식 명세](https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT)에 따라 중앙 디렉터리와 로컬 헤더가 일치하는지 확인한다. 허용한 이미지를 4 KB 압축 청크로 읽어 [fflate](https://github.com/101arrowz/fflate)의 스트리밍 Inflate로 실제 크기와 CRC를 확인한 뒤, 네이티브 ZIP 모듈로 앱 캐시의 임시 폴더에 선택 추출한다. 추출 파일 크기를 다시 확인하고 manifest와 캐시 폴더를 이동한 뒤에만 `ready`를 저장한다.

검증 중 CBZ 전체나 페이지 전체를 JS 메모리에 유지하지 않는다. 각 청크 사이에 UI 실행 시간을 주므로 취소가 가능하다. 안전 검증과 디스크 추출에서 압축 데이터를 두 번 읽고 푸는 비용이 있다. 대용량 파일의 시간·메모리 측정은 #7에서 이어간다.

## 지원 범위

- 단일 볼륨 ZIP의 Stored/Deflate, UTF-8 경로, JPEG/PNG/WebP 파일
- 원본 512 MB, 항목 2,000개, 중앙 디렉터리 8 MB, 개별 항목 64 MB, 총 해제 크기 1 GB, 압축률 200배 이하
- 절대/상위 경로, 역슬래시, 제어 문자, URI 구분자·퍼센트 이스케이프, 심볼릭 링크·특수 파일, 정규화·대소문자 경로 충돌은 거부
- ZIP64·분할·암호화 ZIP, 대체 경로/링크 확장 메타데이터는 미지원
- 숨김 경로·`__MACOSX`·비이미지 항목은 추출하지 않음. 이름만 이미지인 데이터와 빈 이미지도 거부

이미지 시그니처·ZIP CRC 검사와 이미지 디코더 검증은 다르다. 전체 이미지 디코딩 오류 처리는 뷰어 작업에서 구현한다. 페이지 순서는 #5의 자연 정렬 규칙을 사용하며 SQLite 페이지 테이블에 저장한다. 원본 항목은 추출 캐시의 `pages/` 아래에 두고, 표지와 manifest는 별도로 저장하여 파일명 충돌을 피한다.

## 취소와 중단

네이티브 추출 중 취소는 `cancel()`을 요청하고 원래 추출 promise가 끝날 때까지 기다린다. 빠르게 거부되는 `AbortSignal` 래퍼를 통해 임시 폴더를 먼저 삭제하지 않는다. 정상 실패·취소 시 원본을 보존하고 오류와 `stored` 상태를 기록한다.

재실행 시 남은 임시 폴더와 커밋되지 않은 추출 캐시를 정리하고 중단된 `extracting` 상태를 재시도 가능한 `stored`로 바꾼다. OS가 캐시를 삭제했으면 다시 추출할 수 있다. v1/v2 서재는 트랜잭션으로 v3로 이전하며 파일명·시각·원본을 보존하고 앱 내부 상대 경로를 추가한다. 복사/폴더 이동 완료를 기다리므로 SDK 57의 비동기 파일 작업과 DB 저장이 순서대로 실행된다.

## 검증

`npm test`의 17개 검사는 악성 경로, 링크, 경로 충돌, 손상/빈 ZIP, ZIP64/암호화, 과도한 크기·압축률, 거짓 크기, CRC, 이미지 시그니처, 취소와 data descriptor를 다룬다. Node.js 22.18 이상에서 TypeScript 소스를 직접 실행한다.

Android 개발 빌드에서 `mobilecbzviewer://library-diagnostics`를 열면 실제 서재와 별도 DB/폴더에서 합성 샘플만 사용하여 마이그레이션·추출·실패·취소·악성 샘플·복구·재시도를 검사하고 샘플을 정리한다.

```sh
adb shell am start -a android.intent.action.VIEW -d 'mobilecbzviewer://library-diagnostics' com.yoophi.mobilecbzviewer
adb shell run-as com.yoophi.mobilecbzviewer cat files/library-probe-result.json
```

2026-10-12, Pixel_9 AVD / Android 16 API 36 / arm64-v8a에서 17개 실행 검사 통과. [결과 JSON](validation/android-library-probe.json)을 보관한다. 프로세스 중단 상태는 격리 DB에 `extracting`과 잔여 파일을 만든 뒤 연결을 닫고 재초기화하여 검증했다. 실제 기기 강제 종료·대용량·용량 부족 검증과 iOS 실행 검증은 남아 있다. 전체 MVP나 양 플랫폼 작업 완료로 처리하지 않는다.
