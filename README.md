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
- 20Hz Colyseus 권위 서버의 이동·카메라 방향·점프 입력과 sequence 검증
- 서버 권위 중력, 접지, `PLAYGROUND_ROUTE` 발판 충돌과 월드 경계 제한
- 서버가 계산하는 상승 용암, 플레이어 탈락·탈출, 경기 단계와 승패
- 서버 위치 기반 로컬·원격 아바타 보간과 온라인 타이머·용암·생존 HUD
- 온라인에서 E를 길게 눌러 추락한 동료를 끌어올리는 라바 라이프라인
- 서버 권위 대상 선정·당김 힘·그립·쿨다운과 용암 근접 패닉 보정
- 1인 1링크, 다중 체인 금지, 구조 로프·그립 HUD와 모바일 구조 버튼
- 용암 근접도와 그립을 굵기·맥동·처짐·끊김으로 각각 표현하는 구조 로프와 양 끝 매듭·고리 표식
- 색에만 의존하지 않는 구조 경고: HUD 칩의 `용암 근접`·`용암 직전` 문구와 아이콘, 모션 최소화 설정 지원

현재 온라인 모드는 권위형 수직 이동, 기본 경기 결과와 동료 구조까지 검증합니다. 구조 클라이언트는 E의 누름 상태만 보내며 대상 ID·좌표·힘·그립을 제출할 수 없습니다. 서버가 전방 범위의 공중·낮은 동료를 결정하고 한 플레이어당 하나의 링크만 허용합니다. 용암에 가까울수록 당김이 강해지지만 그립 소모와 구조자 역끌림도 커집니다. 아이템, 전투, 다중 구조 체인과 HIVE 인증·매치메이킹은 후속 범위입니다.

구조 로프는 서버가 게시한 상태만 읽어 그립니다. 용암과의 거리는 로프 굵기·맥동 속도·팽팽함·색으로, 구조자의 그립은 가닥 끊김·떨림·깜빡임으로 서로 독립되게 표시하므로 한쪽 위험이 다른 쪽을 가리지 않습니다. 같은 정보를 HUD 칩이 문구로 다시 알려 주고, 운영체제의 모션 최소화 설정을 켜면 맥동과 떨림이 멈춰도 굵기·형태·색·문구로 단계를 구분할 수 있습니다.

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

- GitHub Pages(정적 웹, 게스트 데모 전용): https://doheon-kim1.github.io/hellbreak/
- GitHub Pages 수동 배포: `npm run deploy:pages`
- Render(실시간 룸 서버): [`render.yaml`](render.yaml) Blueprint
- Vercel(HIVE 인증 경로 전용): 자격 증명 확보 후 연결 예정

GitHub Pages는 정적 웹 호스팅이므로 Colyseus 서버를 실행하지 않습니다. 서버 URL이 없는 Pages 빌드에서는 로컬 봇 경기는 계속 플레이할 수 있고 온라인 룸은 비활성 상태로 안내됩니다. 실시간 룸은 별도의 Node 프로세스로 Render에 배포합니다.

### Render 룸 서버 배포

1. 원클릭 배포 링크를 엽니다: https://render.com/deploy?repo=https://github.com/Doheon-Kim1/hellbreak
2. 이 저장소는 비공개이므로 저장소 소유자가 [Render GitHub App](https://github.com/apps/render)을 설치하고 `Doheon-Kim1/hellbreak` 접근을 허용해야 Blueprint를 적용할 수 있습니다.
3. Blueprint가 `render.yaml`의 설정으로 `hellbreak-room` 웹 서비스를 생성합니다. 리전 `singapore`, 브랜치 `main`, 인스턴스 1개, 헬스체크 `/health`, 빌드 `npm ci --include=dev`, 시작 `npm run start:room`, PR 프리뷰 비활성입니다.
4. `NODE_VERSION`은 lockfile 검증에 사용한 Node 22 릴리스로 고정되어 있고, `HELLBREAK_ALLOWED_ORIGINS`는 `https://doheon-kim1.github.io`로 설정됩니다. Blueprint에는 비밀 값이 들어 있지 않습니다.
5. `https://<render-service>/health`가 HTTP 200과 룸 이름을 반환하면 배포된 것입니다. 할당된 HTTPS 주소를 기록해 두세요.

`plan: free`로 선언되어 있지만 Render 계정 상태나 요금제 정책에 따라 무료 인스턴스가 보장되지는 않습니다. 실제 청구 조건은 배포 전에 Render 대시보드에서 확인하세요.

Deploy-to-Render 버튼으로 생성된 여러 서비스가 원본 저장소 커밋마다 일괄 재배포되지 않도록 자동 배포는 꺼져 있습니다. 룸 서버 코드를 변경한 뒤에는 Render 대시보드에서 해당 서비스의 수동 배포를 실행하세요.

### 배포 후 Pages 연결

```bash
NEXT_PUBLIC_GAME_SERVER_URL=https://<render-service> npm run deploy:pages
```

`<render-service>`를 Render가 할당한 실제 호스트로 바꿉니다. 브라우저 SDK가 매치메이킹 HTTP 요청과 WebSocket 프로토콜을 이 주소에서 자동으로 선택하므로 `https://` 형태를 그대로 사용합니다. 이 값은 빌드 타임에 정적 산출물로 구워지므로 서버 주소가 바뀌면 Pages를 다시 빌드해야 합니다.

### 온라인 모드 분리: 게스트 데모와 HIVE 인증 대기열

온라인 탭에는 두 갈래가 항상 함께 보이며, 서로 얽히지 않습니다.

- **게스트 빠른 플레이:** 지금 배포된 경로입니다. 로그인 없이 룸을 만들거나 룸 ID로 참가합니다.
  정적 GitHub Pages 빌드에서도 그대로 동작합니다.
- **HIVE 인증 대기열:** 빌드·브라우저 로그인·서버가 모두 준비됐을 때만 열립니다. 그 전에는 버튼이
  비활성 상태로 남고 **이유가 그대로 표시됩니다.** 환경 변수 이름은 노출하지 않습니다.

닫히는 이유는 근본적인 순서대로 판정합니다: 정적 빌드 → 브라우저 로그인 미포함 → 서버 확인 중 →
서버 설정 없음. 그래서 화면에 뜨는 문장은 "가장 먼저 바뀌어야 하는 것"과 항상 일치합니다.

HIVE 서버 라우트(`src/app/api/hive/*`)는 모두 `route.ts`이고, Pages 빌드는 `.tsx`만 페이지로
인식하므로 정적 산출물에는 아예 포함되지 않습니다. 자격 증명이 없는 배포에서 이 라우트들은
`503 hive_not_configured`와 **부족한 키 이름만** 돌려주며, 값은 절대 노출하지 않습니다.

룸 서버는 `ROOM_TOKEN_SECRET`을 공유받으면 서명된 짧은 수명 입장 토큰(신원·룸·만료·1회용 nonce)을
검증합니다. 이 값은 두 호스트가 **같은 규칙으로 읽고 어느 쪽도 다듬지 않습니다**. 앞뒤 공백이
붙어 있으면 한쪽만 조용히 잘라내 서로 다른 키를 쓰는 대신, 양쪽 모두 설정 오류로 거부합니다.
`HELLBREAK_GUEST_JOIN`은 기본값이 `allow`라서 현재 공개 데모가 그대로 유지되고,
운영 전환 시 `deny`로 닫습니다. 호스트별 환경 변수 소유와 남은 자격 증명 블로커는
[`docs/hive-matchmaking-rollout.md`](docs/hive-matchmaking-rollout.md)에 정리돼 있습니다.

### 게스트 데모 경계

공개된 룸 서버는 **인증 없는 게스트 데모**입니다. 다음을 명확히 전제합니다.

- **신원 없음:** 로그인, 계정, 지속되는 플레이어 식별자가 없습니다.
- **인메모리 룸:** 룸 상태는 프로세스 메모리에만 존재합니다. 데이터베이스도 저장소도 없습니다.
- **재시작·콜드스타트 시 연결 끊김:** 배포, 재시작, 유휴 상태에서 깨어나는 인스턴스는 진행 중인 룸을 모두 파괴하고 접속자를 끊습니다. 첫 요청은 응답이 느릴 수 있습니다.
- **단일 인스턴스:** 룸 상태를 인스턴스 간에 공유할 수 없으므로 수평 확장이 불가능합니다.
- **Origin 검사는 인증이 아님:** `HELLBREAK_ALLOWED_ORIGINS`는 일반적인 브라우저 임베딩만 제한합니다. 브라우저가 아닌 클라이언트는 Origin 헤더를 위조할 수 있습니다.
- **없는 것:** 리더보드, 결제, 랭킹 보존, 운영 SLA가 없습니다.

실제 공개 런칭 전에는 룸 생성 레이트 리밋, 지속되는 신원, 운영 체계가 여전히 필요합니다. 짧은 수명
룸 토큰 검증은 구현돼 있지만, HIVE 자격 증명과 매치 결과 콜백 계약이 확보되기 전까지는 켤 수
없습니다.

아키텍처는 [`docs/architecture.md`](docs/architecture.md), 놀이터 참고 자료는 [`docs/playground-reference.md`](docs/playground-reference.md), HIVE 롤아웃은 [`docs/hive-matchmaking-rollout.md`](docs/hive-matchmaking-rollout.md), 저용량 작업 정책은 [`docs/low-disk-workflow.md`](docs/low-disk-workflow.md)를 참고하세요.
