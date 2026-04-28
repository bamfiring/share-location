# 실시간 위치 공유 앱

실시간으로 현재 위치를 공유할 수 있는 간단한 PWA 웹앱입니다. `Render`에 바로 배포할 수 있도록 정리되어 있습니다.

## 기능

- 방 코드 생성
- 닉네임 기반 참여
- 브라우저 위치 권한을 이용한 실시간 위치 업로드
- SSE(Server-Sent Events) 기반 참여자 위치 동기화
- 지도 위 참여자 표시 및 초대 링크 복사
- 모바일 홈화면 설치 지원
- 오프라인 안내 페이지 및 앱 셸 캐싱
- 닉네임, 색상, 마지막 방 코드 로컬 저장

## 로컬 실행

Node.js가 설치되어 있다면 아래 명령으로 실행할 수 있습니다.

```powershell
node server.js
```

또는 이 작업 환경의 번들 Node를 사용할 수도 있습니다.

```powershell
& "C:\Users\bamfi\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" "C:\Users\bamfi\Documents\Codex\2026-04-28-new-chat\server.js"
```

브라우저에서 `http://127.0.0.1:3000` 으로 접속하세요.

## Render 배포

### 1. GitHub에 올리기

이 프로젝트를 GitHub 저장소에 올립니다.

### 2. Render에서 새 Web Service 만들기

- Render 대시보드에서 `New +` → `Web Service`
- GitHub 저장소 연결
- Runtime: `Node`

### 3. 배포 설정

- Build Command: `npm install`
- Start Command: `npm start`

이 프로젝트는 `PORT` 환경변수를 자동으로 사용하므로 Render 기본 설정으로 동작합니다.

### 4. 배포 후 접속

Render가 발급한 `https://...onrender.com` 주소로 접속하면 모바일에서도 위치 권한을 사용할 수 있습니다.

## PWA 사용

- Chrome, Edge, Android 브라우저에서는 `홈화면에 설치` 버튼으로 설치할 수 있습니다.
- 설치 후에는 독립 앱처럼 실행됩니다.
- 오프라인일 때는 안내 화면이 표시되며, 네트워크가 복구되면 다시 앱에 접속할 수 있습니다.

## 참고

- 현재 서버는 메모리 기반이므로 서버가 재시작되면 방 정보가 초기화됩니다.
- 지도 타일과 `Leaflet` 라이브러리는 외부 CDN을 사용하므로 인터넷 연결이 필요합니다.
- 위치 공유 기능은 HTTPS 환경에서 가장 안정적으로 동작합니다.
