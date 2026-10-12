# 이미지 로딩과 캐시 예산 (#7)

현재 리더는 현재 페이지 하나만 마운트한다. 전체 책의 페이지 메타데이터는 SQLite에서 읽지만 이미지 바이트·Base64·디코딩된 이미지 배열은 JS에 보관하지 않는다. 인접 페이지 선행 로딩도 하지 않는다. 현재 화면의 `contain` 크기를 기준으로 `expo-image`의 다운샘플링을 사용하며, iOS에는 `enforceEarlyResizing`을 적용한다. 애니메이션 자동 재생을 끄고 페이지·표지 모두 `cachePolicy="none"`으로 중복 이미지 캐시를 피한다. 표지는 최대 240×360으로 만든다.

## 디스크 정책

- 추출 페이지·표지·manifest의 논리적 파일 용량: 전체 512 MiB.
- 위 예산에 포함된 JPEG 표지의 별도 상한: 전체 16 MiB.
- 원본 CBZ와 SQLite 메타데이터는 이 예산에 포함되지 않는다. 원본은 캐시 정리로 삭제하지 않는다.
- 추출 전에 페이지 크기 합계·manifest UTF-8 상한·표지 예약 공간을 계산한다. 저장 공간 검사도 유지한다. 추출 뒤 실제 폴더·표지 용량으로 다시 확인한 후 공개한다. 단일 책이 예산을 넘으면 원본을 유지하고 오류를 표시한다.
- 준비 완료·열람 시각을 SQLite 보조 테이블에 기록하며 가장 오래 사용하지 않은 캐시부터 정리한다. 활성 리더는 참조 수로 보호한다. 보호된 책 때문에 예산을 지킬 수 없으면 추출을 거절한다.
- 캐시 삭제 전에 상태·페이지·표지 메타데이터를 재생성 가능한 상태로 바꾼다. 중단된 삭제의 폴더는 다음 용량 검사에서 정리한다. 앱 시작 시에도 복구와 예산 정리를 수행한다.
- 표지 생성의 네이티브 로더가 만든 디스크 캐시는 시작 시와 표지 생성 후 `Image.clearDiskCache()`로 제거한다. 파일 선택기와 이미지 조작의 임시 파일도 사용 후 제거한다.
- 수동 정리 API는 활성 리더를 제외하고 원본을 보존한다. 공개 저장 공간 UI는 #11에서 연결한다. 삭제된 페이지·표지는 책 열기 또는 서재의 재추출로 복원된다.

## Android 측정

2026-10-12, Pixel 9 AVD / Android 16 API 36 / arm64 / RAM 약1.93 GiB / 1080×2424 / density 420. 개발 빌드와 Metro를 사용했다. PSS에는 앱·JS·네이티브 라이브러리와 개발 도구가 포함된다. `Bitmap (malloced)`는 dumpsys가 제공하는 하위 항목이며 모든 그래픽 메모리를 대표하지 않는다.

합성 CBZ 2권은 각 40페이지·약29.7 MiB이다. 일반 페이지는 2048×3072, 마지막은 512×30000이다. 별도 책은 같은 이미지 규격의 1,000페이지·약176.1 MiB이다. 처음 네 장은 무작위 픽셀을 사용해 파일 크기도 크게 만들었다. 모든 샘플은 실제 Android 파일 선택기로 가져왔다.

| 실험 | PSS 범위 (MiB) | malloc 비트맵 최대 (MiB) | 결과 |
| --- | --- | --- | --- |
| 40페이지 책에서 왕복 3회, 234번 이동 | 358.1–393.9 | 14.5 | 첫·마지막 이미지 정상, 순회별 누적 증가 없음 |
| 2권을 8번 전환, 각 14번 이동 | 382.0–409.1 | 14.3 | 원래 화면으로 복귀; 초기 PSS 증가 후 추가 실험 수행 |
| 이어서 24번 더 전환 | 351.8–404.6 | 21.0 | 자연스러운 회수 구간 관찰; 마지막 서재 PSS 약365.8 MiB |
| 1,000페이지를 처음부터 끝까지 이동 | 378.3–409.4 | 8.2 | 100페이지마다 번호·이미지·메모리 확인; 마지막 긴 이미지 정상 |

1,000페이지 실험에서 비트맵은 첫 페이지 약8.0 MiB, 마지막 약8.2 MiB였다. 페이지 수만큼 디코딩 이미지를 누적하는 형태의 증가는 관찰하지 않았다. 이 AVD의 검증 기준은 malloc 비트맵 32 MiB 및 개발 빌드 PSS 450 MiB 이내이며 모두 충족했다. 이 수치는 다른 기기에 강제되는 전역 상한이 아니다. 실제 디코딩 버퍼와 재사용 풀은 네이티브 로더가 관리하며 화면 픽셀 수·포맷·기기에 따라 달라진다. 릴리스 빌드·실기기·iOS에서 같은 기준을 별도로 측정해야 한다.

원시 관찰은 [페이지 왕복](validation/android-reader-memory.json), [초기 책 전환](validation/android-book-switch-memory.json), [추가 책 전환](validation/android-book-switch-extended.json), [1,000페이지](validation/android-many-page-memory.json)에 있다. 작은 예산을 쓰는 격리 네이티브 프로브에서 LRU 삭제·활성 리더 보호·원본 유지·페이지/표지 재생성·미완료 폴더 정리를 검증했다: [캐시 프로브](validation/android-cache-probe.json).

## 재현

```sh
python3 scripts/generate-reader-stress.py /tmp
python3 scripts/generate-reader-stress.py /tmp --pages 1000 --books 1 --prefix reader-many
adb push /tmp/reader-stress-1.cbz /sdcard/Download/
adb push /tmp/reader-stress-2.cbz /sdcard/Download/
adb push /tmp/reader-many-1.cbz /sdcard/Download/
```

개발 앱의 파일 선택기로 가져온 뒤 서재 화면에서 실행한다. 책 ID는 설치마다 다르므로 해당 서재 항목의 라우트 ID를 사용한다. 아래 ID는 이 검증 설치의 예다. 스크립트는 XML에서 실제 버튼 위치를 얻으며, 번호·이미지 노출·Android 뒤로 가기를 확인하고 JSON을 기록한다.

```sh
python3 scripts/measure-android-reader.py --book-ids 2 3 --switches 32
python3 scripts/measure-android-reader.py --book-ids 4 --switches 1 --sweep
adb shell am start -a android.intent.action.VIEW -d 'mobilecbzviewer://cache-diagnostics' com.yoophi.mobilecbzviewer
adb shell run-as com.yoophi.mobilecbzviewer cat files/cache-probe-result.json
```

ZIP 검증은 4 KiB 읽기/임시 메모리 폭을 유지하며 64 KiB 또는 작업 시간 8 ms마다, 그리고 이미지 경계에서 UI에 제어를 돌려준다. 한 디코딩/CRC 작업의 실행 시간까지 엄격히 8 ms로 제한하는 것은 아니다.

## 긴 이미지와 남은 검증

현재 단일 페이지 모드는 긴 이미지 전체를 화면에 맞추므로 상세 글씨가 작아질 수 있다. 세로 스크롤과 확대는 #8·#9의 범위다. 긴 이미지를 전체 폭으로 디코딩한 뒤 단순 crop만 하는 방식은 원본 비트맵 전체를 먼저 할당하므로 메모리 해결책이 아니다. 세로 표시 구현에서는 원본 픽셀 수에 따른 작업 예산과 분할/영역 디코딩을 검토해야 한다. 이번 측정은 전체 맞춤 미리보기에서의 메모리를 증명하며 고해상도 확대나 타일링의 완료를 뜻하지 않는다.

iOS 네이티브 실행은 Xcode 라이선스 미동의로 아직 막혀 있다. iPhone·iPad 실기기 측정, 릴리스 성능, 애니메이션 WebP 및 특이한 이미지 규격의 메모리는 미검증이다. #7은 이 범위를 확인하기 전까지 진행 중으로 유지한다.

참조: [Expo SDK 57 Image](https://docs.expo.dev/versions/v57.0.0/sdk/image/), [FileSystem](https://docs.expo.dev/versions/v57.0.0/sdk/filesystem/).
