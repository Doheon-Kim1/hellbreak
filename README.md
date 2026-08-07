# HELLBREAK

**OpenAI Game Builders Seoul 2026** 참가용 브라우저 3D 비대칭 멀티플레이 게임입니다.

> 지옥 간수 1명이 상승하는 용암과 수직 감옥에서 도망자 3~5명을 추격합니다. 도망자는 영혼 잔상으로 간수를 속이거나, 잔상을 용암에 희생해 임시 발판을 만들 수 있습니다.

## MVP 기술 스택

- Next.js 16 App Router, React 19, TypeScript
- Three.js, React Three Fiber, Drei
- Rapier 물리와 Zustand 클라이언트 상태
- Colyseus 권위형 실시간 게임 룸
- 웹 인증, 매치메이킹, 리더보드, 채팅, 분석용 Com2uS HIVE
- Vitest 단위 테스트와 Playwright 브라우저 테스트
- Next.js 앱은 Vercel, Colyseus는 전용 WebSocket 호스트에 배포

## 실행 명령

```bash
npm ci
npm run dev          # Next.js :5173 + Colyseus :2567
npm test
npm run test:e2e
npm run lint
npm run build
npm run start:room   # 실시간 룸 서버
npm start            # 프로덕션 웹 앱
```

개발 서버를 시작한 뒤 `http://localhost:5173`을 여세요.

배포된 웹 앱에서 온라인 룸을 사용하려면 빌드 시 `NEXT_PUBLIC_GAME_SERVER_URL`을 HTTPS Colyseus 서버 주소로 설정해야 합니다. 브라우저 SDK가 매치메이킹 요청과 WebSocket 프로토콜을 자동으로 선택하므로 `https://rooms.example.com` 형태를 사용합니다.
룸 서버에는 `HELLBREAK_ALLOWED_ORIGINS=https://game.example.com`처럼 접속을 허용할 웹 Origin을 쉼표로 구분해 설정합니다. 기본값은 로컬 개발 Origin 두 개뿐입니다.

## 현재 플레이 가능한 범위

- WASD 및 방향키 이동과 정규화된 대각선 속도
- Space 점프와 Rapier 충돌
- Shift 달리기
- 부드러운 3인칭 추적 카메라
- 실제 놀이터 사진을 참고한 90 × 90 거대 놀이터 임시 맵
- 미끄럼틀 탑, 그네, 정글짐, 시소, 모래 구역, 탈출 전망대
- 넓은 맵을 횡단하는 물리 충돌 기반 17단 상승 경로
- 상승하는 용암, 플레이어 사망 및 관전 전환
- 발판 대기와 포물선 점프를 사용하는 도망자 봇 3명
- Q/E 관전 대상 전환과 봇 추적 카메라
- 경기 시작, 재시작, 탈출, 봇 승리, 리매치 루프
- 룸 생성과 룸 ID 참가, 최대 6명 접속·퇴장 동기화
- 20Hz Colyseus 권위 서버의 수평 이동·카메라 방향·입력 sequence 검증
- 서버 위치 기반 로컬·원격 아바타 렌더링과 부드러운 보간

현재 온라인 모드는 네트워크 기반 검증 단계로 `x/z` 수평 이동만 동기화합니다. 점프, 서버 물리, 용암, 아이템, 전투와 HIVE 인증·매치메이킹은 후속 범위입니다.

## MVP 범위

1. 수직 감옥 맵 1개와 상승하는 용암
2. 지옥 간수 1명, 도망자 봇 3명, 플레이어 역할 선택
3. 이동, 점프, 질주, 포획, 구출
4. 영혼 잔상 미끼와 용암 임시 발판 변환
5. 봉인 3개, 최종 탈출문, 4분 경기, 즉시 리매치
6. 로컬 봇 경기 우선 구현 후 권위형 온라인 룸 연결

## 백엔드 역할 구분

- **Next.js:** 웹 UI, 안전한 HIVE 서버 연동 라우트, 세션 초기화
- **HIVE:** 인증과 토큰 검증, 매치메이킹 티켓, 리더보드, 채팅, 분석
- **Colyseus:** 권위형 경기 시간, 이동 검증, 용암, 포획, 봉인, 승패

HIVE 매치메이킹은 입장할 룸을 선택하거나 할당합니다. 프레임 단위 게임 상태 전송에는 HIVE 데이터베이스/API 이벤트를 사용하지 않습니다. 브라우저는 서버에서 HIVE 토큰을 검증한 뒤 할당된 Colyseus WebSocket 룸에 직접 연결합니다.

## 배포

- GitHub Pages: https://doheon-kim1.github.io/hellbreak/
- GitHub Pages 수동 배포: `npm run deploy:pages`
- Vercel: 추후 연결 예정

GitHub Pages는 정적 웹 호스팅이므로 Colyseus 서버를 실행하지 않습니다. 서버 URL이 없는 Pages 빌드에서는 로컬 봇 경기는 계속 플레이할 수 있고 온라인 룸은 비활성 상태로 안내됩니다.
현재 룸은 인증 없는 로컬 게스트 검증용입니다. HIVE의 짧은 수명 룸 토큰과 생성 제한을 연결하기 전에는 Colyseus 프로세스를 공개 인터넷에 배포하지 않습니다.

아키텍처는 [`docs/architecture.md`](docs/architecture.md), 놀이터 참고 자료는 [`docs/playground-reference.md`](docs/playground-reference.md), 저용량 작업 정책은 [`docs/low-disk-workflow.md`](docs/low-disk-workflow.md)를 참고하세요.
