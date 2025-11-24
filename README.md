# superpower-frontend

모바일 웹에서 카메라를 열어 촬영·업로드하고, WebSocket 응답을 실시간으로 확인하는 Vite + TypeScript 프로젝트입니다. 단말의 전/후면 카메라 전환, 파일 선택 업로드, 업로드 대기 오버레이, 응답 타이머, 간단한 WebSocket 로그 뷰어를 제공합니다.

## 주요 기능
- 카메라 열기/중지, 전·후면 전환, 촬영 결과 캔버스 미리보기
- 로컬(파일:// 또는 localhost)에서 테스트 시 기본 이미지(`static/다운로드.jpg`)를 캔버스에 그려서 흐름 검증
- 촬영 이미지 또는 선택한 파일을 S3 presigned URL을 통해 업로드 (`PRESIGN_ENDPOINT`, 업로드 확장자/품질/타입 설정)
- WebSocket 연결(`SOCKET_URL`)로 서버 메시지 수신, `image_complete` 이벤트 시 결과 이미지 표시
- 업로드 대기 패널(최대 60초 타임아웃), 업로드 중 로딩 오버레이, 전송 애니메이션
- WebSocket 로그 패널/토글, 최근 메시지 10개 표시 및 connectionId 콘솔 출력

## 기술 스택
- Vite 7 (vanilla-ts 템플릿 기반), TypeScript 5
- 순수 DOM API + Canvas API + getUserMedia + WebSocket
- Node 스크립트: `ws` 패키지를 사용한 간단한 WebSocket 테스트 클라이언트(`scripts/ws-test.mjs`)

## 구조
```
superpower-frontend/
├─ index.html          # 단일 페이지, UI 스타일/마크업 포함
├─ src/main.ts        # 카메라/업로드/WebSocket 로직
├─ static/다운로드.jpg # 로컬 테스트용 기본 이미지
├─ scripts/ws-test.mjs # WebSocket 수동 테스트 스크립트
└─ vite.config.ts     # dev 서버 호스트/허용 도메인 설정
```

## 환경/설정 포인트
- `src/main.ts` 상단 상수
  - `PRESIGN_ENDPOINT`: 업로드용 presigned URL을 반환하는 API Gateway 엔드포인트
  - `SOCKET_URL`: WebSocket 접속 URL (API Gateway WebSocket)
  - `MAX_CANVAS_WIDTH`, `UPLOAD_QUALITY/TYPE/EXTENSION`, `WAITING_TIMEOUT_SEC` 등 업로드/캔버스 옵션
- `vite.config.ts`: `server.host = true`로 LAN 노출, `allowedHosts`에 ngrok 도메인 포함
- `.env`: 현재 비어 있음. 필요 시 Vite 환경 변수(`VITE_...`)로 치환해 사용할 수 있습니다.

## 설치 및 실행
```bash
cd superpower-frontend
npm install
npm run dev          # http://localhost:5173 (LAN 노출)
```
- 모바일 실기기 테스트 시 같은 Wi-Fi에서 `http://<개발PC IP>:5173` 접속.
- iOS Safari는 HTTPS/localhost에서만 카메라 접근을 허용하므로 터널(ngrok 등) 또는 로컬 인증서가 필요할 수 있습니다.

### 빌드/프리뷰
```bash
npm run build        # tsc 후 Vite build
npm run preview      # 빌드 산출물 로컬 프리뷰
```

## 테스트/검증 방법
- 기본 흐름: `카메라 열기` → `사진 찍기` → 필요 시 `전면/후면 전환` → `이미지 전송` → 대기 패널에서 결과 확인
- 파일 업로드 흐름: `파일 선택 업로드`로 여러 이미지를 선택 후 `이미지 전송` 클릭
- WebSocket 응답 확인: 화면 우측 하단 로그 패널 토글 → 메시지/connectionId 확인
- CLI WebSocket 테스트:
  ```bash
  npm run ws:test -- --url wss://<your-endpoint> --message '{"action":"ping"}' --json --close 8000
  ```

## 특이사항
- 문서 숨김 상태가 되면 카메라 스트림을 자동으로 중단합니다.
- 대기 패널은 최대 60초 후 실패 상태로 전환하며, `image_complete` 메시지 수신 시 완료/결과 이미지를 표시합니다.
- 로컬 모드(파일:// 또는 localhost)에서는 카메라가 없어도 기본 이미지를 사용해 업로드 흐름을 점검할 수 있습니다.
