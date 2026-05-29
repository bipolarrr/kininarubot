# kininarubot

Discord slash command 기반 개인용 YouTube 음악 봇입니다. Debian 홈서버에서 Docker 컨테이너로 실행하는 구성을 기준으로 합니다.

## 기능

- `/play query:<url-or-search>`: YouTube URL 또는 검색어로 재생/큐 추가
- `/queue`: 현재 곡과 대기열 표시
- `/jump index:<number>`: `/queue`에 표시된 대기열 번호로 즉시 이동
- `/skip`: 현재 곡 건너뛰기
- `/stop`: 재생 중단 및 큐 비우기
- `/now`: 현재 곡 표시
- `/leave`: 음성 채널 나가기
- `/panel channel:<text-channel>`: 공개 뮤직 패널을 해당 채널에 게시

검색어는 `yt-dlp`의 `ytsearch10:` 결과를 가져온 뒤 official audio, official music video, Topic 채널, `Provided to YouTube by` 같은 metadata 신호를 점수화해 가장 공식 음원에 가까운 후보를 고릅니다. YouTube Data API를 쓰지 않으므로 공식성을 보장하지는 않습니다.

명령어 응답과 버튼 클릭 결과는 대부분 본인에게만 보이고, 서버 채널에는 뮤직 패널 메시지만 공개로 남습니다. 패널은 현재 곡, 큐, 반복 상태, 일시정지 상태와 이전/다음/정지/나가기 버튼을 제공합니다.

## Discord 설정

1. Discord Developer Portal에서 Application과 Bot을 생성합니다.
2. Bot token을 발급받고, Privileged Gateway Intents는 켤 필요가 없습니다.
3. OAuth2 URL Generator에서 `bot`, `applications.commands` scope를 선택합니다.
4. Bot permission은 `Connect`, `Speak`, `Use Voice Activity`, `Send Messages`를 포함합니다.
5. 봇을 테스트 서버에 초대합니다.

## 로컬 준비

```bash
npm install
cp .env.example .env
```

`.env`에 값을 채웁니다.

```env
DISCORD_TOKEN=...
CLIENT_ID=...
GUILD_ID=...
IDLE_DISCONNECT_MS=0
MUSIC_PANEL_CHANNEL_ID=...
```

`IDLE_DISCONNECT_MS=0`이면 큐가 비어도 자동으로 음성 채널에서 나가지 않습니다. 직접 내보내려면 `/leave`를 사용합니다.

`MUSIC_PANEL_CHANNEL_ID`를 설정하면 봇 시작 시 해당 텍스트 채널에 새 뮤직 패널을 게시합니다. 재시작 때 기존 패널을 찾아 수정하지 않고 새 패널을 만듭니다. 실행 중 패널 위치는 `/panel channel:<text-channel>`로 바꿀 수 있으며, 이 변경은 재시작 전까지만 유지됩니다.

명령어를 등록합니다. `GUILD_ID`가 있으면 guild command로 등록되어 즉시 반영됩니다.

```bash
npm run deploy:commands
```

개발 실행:

```bash
npm run dev
```

## Docker 실행

홈서버에서는 다음 구조를 권장합니다.

```text
/srv/kininarubot/
  app/
  data/
  docker-compose.yml
  .env
```

```bash
docker compose build
docker compose up -d
```

로그 확인:

```bash
docker compose logs -f bot
```

## 검증

```bash
npm run build
npm test
```

Docker 이미지에는 `ffmpeg`와 `yt-dlp`가 포함됩니다. 로컬에서 Docker 없이 실행하려면 `ffmpeg`와 `yt-dlp`가 PATH에 있어야 합니다.

## 주의

이 봇은 개인 과제/개인 서버 사용을 전제로 합니다. YouTube, Discord의 서비스 약관과 저작권을 준수해야 합니다.
