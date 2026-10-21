# LogContainer static log export v1

외부 PHP/그누보드 사이트에서 읽기 전용 세션 로그를 가져오기 위한 ZIP 포맷이다. 로그 수정 및 LogContainer로의 역가져오기는 범위에 포함하지 않는다.

## ZIP 구조

```text
session.logcontainer.zip
├─ manifest.json
├─ index.html
├─ README.txt
└─ assets/
   ├─ styles.css
   ├─ viewer.js
   ├─ bgm/*.mp3
   └─ images/*.{png,jpg,jpeg,gif,webp}
```

`manifest.json`의 최상위 식별자는 다음과 같다.

```json
{
  "format": "logcontainer-static-log",
  "version": 1
}
```

## manifest 필드

- `page`: 제목, 원본 플랫폼, 본문 글꼴, 개요
- `entries`: 표시 순서대로 정렬된 메시지 키, 정제된 읽기 전용 HTML, 간격 힌트
- `tracks`: 중복 제거된 음원 목록
  - `upload`: ZIP 내부 MP3 상대 경로, MIME, 최초 파일명
  - `youtube`: YouTube video ID
- `bgm`: 대기 BGM 또는 메시지별 BGM과 `trackKey` 연결
- `handouts`: 제목, 내용, 이미지의 ZIP 상대 경로

동일한 업로드 음원이 여러 메시지에서 쓰이면 `tracks` 및 실제 MP3는 하나만 존재하며 `bgm`의 여러 항목이 같은 `trackKey`를 참조한다. `entries[].key`는 가져오는 사이트에서 새 DB ID를 만든 뒤 BGM 위치를 연결하기 위한 외부 키다.

핸드아웃 이미지는 ZIP 파일로 포함한다. 현재 로그에서 실제 사용하는 관리형 화자 아바타는 `entries[].html`의 이미지 `src`에 Base64 data URL로 직접 포함하며 별도 아바타 파일을 만들지 않는다. 세션 카드와 사용하지 않는 표정 아바타는 포함하지 않는다.

## 그누보드 importer 필수 검증

1. ZIP 전체 크기, 압축 해제 후 총크기, 파일 개수를 제한한다.
2. 절대 경로, `..`, 빈 경로 조각, 심볼릭 링크를 거부하여 Zip Slip을 막는다.
3. 최상위 `format`과 지원하는 `version`을 먼저 확인한다.
4. manifest가 참조하는 파일만 풀고 확장자와 실제 MIME을 모두 검사한다.
5. MP3, PNG, JPEG, GIF, WebP 외의 사용자 자산은 거부한다.
6. 업로드된 임의 HTML이나 JavaScript를 관리자 권한으로 실행하지 않는다.
7. `entries[].html`은 신뢰 경계에서 다시 sanitize하거나, importer가 허용 목록 기반으로 다시 렌더링한다.
8. YouTube ID는 `^[A-Za-z0-9_-]{11}$`로 검증한다.
9. 파일명은 표시용일 뿐 저장 경로로 직접 사용하지 않고 서버가 새 이름을 발급한다.

`index.html`은 압축을 풀어 결과를 확인하기 위한 독립 읽기 화면이다. importer가 자체 페이지를 생성하는 경우에는 `manifest.json`을 기준 데이터로 사용한다.
