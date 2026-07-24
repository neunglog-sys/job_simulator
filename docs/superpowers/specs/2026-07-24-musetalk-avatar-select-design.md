# MuseTalk 아바타 남/여 선택 — 설계

- 작성일: 2026-07-24
- 상태: 승인됨 (A안) — 여성 idle 영상 도착 대기 중

## 배경

`origin/dev`에서 아바타 선택 기능(`avatar_id: "male" | "female"`)이 들어왔다
(`services/api/app/domains/avatar/service.py:364-406`: `DEFAULT_AVATAR_ID`,
`avatar_catalog()`, `resolve_avatar()`, `available_avatars()`).

이 계약은 **HTTP/SSE 경로**(`speak()`, `speak_chunk_events()`, `_speak_fastapi_provider()` —
과거 SoulX-FlashHead/Gradio용으로 설계됨)에만 연결돼 있다. 현재 실제로 쓰는 경로는
**MuseTalk WebSocket 릴레이**(`relay_musetalk_ws()`)이고, 이쪽은 `speaker_id: "coach"`
단일 값을 하드코딩해 쓴다(`AiAvatarStage.tsx:389`, `api.ts:725`).

SoulX는 쓰지 않기로 확정했으므로, 아바타 선택 기능을 **MuseTalk 경로에도** 붙인다.

## 목표 / 비목표

**목표**
- MuseTalk WS 경로가 `avatar_id`("male"/"female")를 받아 해당 페르소나(영상+목소리)로 발화
- 여성 idle 영상이 아직 없어도 서버가 정상 기동하고, 나중에 파일만 넣으면 재기동 시 자동 활성화
- 기존 `speaker_id: "coach"` 요청은 회귀 없이 계속 동작(male로 매핑)

**비목표(이번 스코프 제외)**
- 프론트 선택 UI(버튼/드롭다운 등) — 팀/나중 작업
- SoulX(HTTP/Gradio) 경로 변경 — 안 씀
- 여성 목소리(ElevenLabs voice_id) 확보 — 없으면 남성 목소리로 폴백

## 결정된 사항

| 항목 | 결정 |
|---|---|
| 에셋 확보 | 사용자가 여성 driving 영상을 직접 준비해 투입 (시점 미정) |
| 작업 범위 | 계약 + 노트북까지. 프론트 선택 UI는 제외 |
| 계약 키 | `avatar_id` 우선, `speaker_id` 하위 호환 폴백 |
| 미준비 페르소나 처리 | **관대한 등록(A안)** — 없으면 건너뛰고 기본으로 폴백. 기동 실패 금지 |

## 설계

### 1. 요청 계약 (프론트 → 백엔드 → 코랩, 변경 없이 그대로 릴레이)

```jsonc
{
  "avatar_id": "male" | "female",   // 신규, 우선
  "speaker_id": "coach",            // 구버전 호환용 폴백 (그대로 유지)
  "text": "...",
  "emotion": "neutral",
  ...
}
```

백엔드 릴레이(`relay_musetalk_ws` / `_pump_bidirectional`)는 페이로드를 파싱하지 않고
text/bytes를 그대로 중계하는 투명 펌프이므로 **백엔드 변경 없음**.

### 2. 노트북 — 페르소나 정의 확장

```python
DEFAULT_AVATAR_ID = "male"
# 구버전 프론트/테스트 스크립트가 보내는 speaker_id="coach" 를 흡수한다.
AVATAR_ALIASES = {"coach": "male"}

PERSONA_MAP = {
    "male": {
        "video_path": os.environ.get("AVATAR_VIDEO_PATH_MALE", "data/male/idle_25fps.mp4"),
        "voice_id": os.environ.get("ELEVENLABS_VOICE_ID_MALE", ELEVENLABS_VOICE_ID),
        "instructions": "calm friendly job interview coach",
    },
    "female": {
        "video_path": os.environ.get("AVATAR_VIDEO_PATH_FEMALE", "data/female/idle_25fps.mp4"),
        # 여성 전용 voice_id 없으면 남성과 동일 목소리로 폴백(무음보다 낫다).
        "voice_id": os.environ.get("ELEVENLABS_VOICE_ID_FEMALE", ELEVENLABS_VOICE_ID),
        "instructions": "calm friendly job interview coach",
    },
}
```

### 3. 관대한 등록 (startup) — A안 핵심

기존 코드는 파일이 없으면 `raise FileNotFoundError`로 **서버 기동 자체가 실패**한다.
이를 "없으면 건너뛰고 표시만 남기는" 방식으로 바꾼다:

```python
for aid, p in PERSONA_MAP.items():
    if not os.path.exists(p["video_path"]):
        print(f"[WARN] 아바타 '{aid}' 영상 없음({p['video_path']}) → 비활성. "
              f"파일을 넣고 재기동하면 자동으로 활성화됩니다.")
        p["ready"] = False
        continue
    _prepare_persona(p["video_path"])
    _ensure_idle_loop_video(p["video_path"])
    p["ready"] = True
print("[ML-TIMING] server startup ready - ready personas:",
      [aid for aid, p in PERSONA_MAP.items() if p["ready"]])
```

이미 파일이 있는 "male"은 지금처럼 그대로 전처리·프리로드된다. "female"은 파일이
생기기 전까지 `ready=False`로 등록만 되고, 파일이 생긴 뒤 재기동하면 자동으로 켜진다.
(코드 변경이 다시 필요하지 않다 — 파일만 넣으면 됨.)

### 4. 조회 헬퍼 통일 (기존 3곳 중복 제거)

현재 `PERSONA_MAP.get(...)`이 서로 다른 핸들러 3곳(`/speak`, `/speak-chunks`,
WS 핸들러)에 흩어져 각자 "unknown speaker_id" 에러를 던진다. 하나로 모은다:

```python
def resolve_persona(req: dict) -> tuple[str, dict]:
    """avatar_id > speaker_id(별칭) > 기본 순으로 페르소나를 고른다.

    미등록·미준비 페르소나는 에러가 아니라 **기본 아바타로 폴백**한다.
    (백엔드 avatar_catalog()의 기존 정책 — "이미지 없으면 기본으로 진행" — 과 동일 철학.)
    """
    raw = req.get("avatar_id") or req.get("speaker_id") or DEFAULT_AVATAR_ID
    aid = AVATAR_ALIASES.get(raw, raw)
    persona = PERSONA_MAP.get(aid)
    if persona is None or not persona.get("ready"):
        aid = DEFAULT_AVATAR_ID
        persona = PERSONA_MAP[aid]
    return aid, persona
```

기존 3개 핸들러의 `PERSONA_MAP.get(req.speaker_id)` 등을 `resolve_persona(req)` 호출로
교체한다. TTS 호출은 `persona["voice_id"]`를 쓰므로, 아바타가 바뀌면 **목소리도 함께**
전환된다.

### 5. 관측성 — 조용한 폴백 완화

A안의 유일한 리스크는 "없는 아바타를 요청해도 조용히 male이 나온다"는 점이다.
아래 두 곳에 실제 사용된/준비된 아바타를 노출해 완화한다.

**`/system-info` (또는 유사 상태 엔드포인트)**
```jsonc
{
  "personas_ready": ["male"],
  "personas_missing": ["female"],
  "default_avatar_id": "male"
}
```

**WS `done` 페이로드**
```jsonc
{ "type": "done", "avatar_id": "male", ... }  // 실제로 쓰인 값 — 폴백 여부를 프론트가 알 수 있다
```

### 6. 프론트 (3곳, UI 없이 계약만)

| 파일 | 변경 |
|---|---|
| `apps/web/src/lib/api.ts:668-681` (`MuseTalkSpeakRequest`) | `avatar_id?: "male" \| "female"` 필드 추가 |
| `apps/web/src/lib/api.ts:725` | `socket.send(JSON.stringify({ avatar_id: "male", emotion: "neutral", ...request }))` — 기본값을 두고 `request`가 덮어쓸 수 있게 |
| `apps/web/src/components/conversation/AiAvatarStage.tsx:389` | 동일 패턴 적용 |

선택 UI가 없으므로 테스트는 기존 `?startBuffer=` 패턴과 동일하게
**`?avatarId=female` URL 파라미터**로 개발자가 강제 지정하는 방식을 쓴다
(`resolveStartBufferSeconds()` 옆에 유사한 `resolveAvatarId()` 헬퍼 추가).

## 검증 계획

1. **여성 영상 없는 상태**로 서버 기동 → 기동 성공 + `personas_missing: ["female"]` 확인
2. `avatar_id: "female"` 요청(영상 없음) → male로 폴백 동작, `done.avatar_id == "male"` 확인
3. 구버전 호환: `speaker_id: "coach"` 단독 요청 → male로 정상 동작(회귀 없음)
4. 여성 영상 투입 후 재기동 → `personas_ready: ["male", "female"]`, 여성 선택 시 영상+목소리 둘 다 전환 확인
5. Drive 용량: persona 캐시 1개 추가 시 +약 2.7GB (현재 여유 8.17GB → 충분)

## 리스크 / 오픈 이슈

- 여성 전용 ElevenLabs voice_id가 없으면 남성 목소리로 폴백 — 이후 목소리 리소스 별도 확보 필요
- 이번 스코프에 선택 UI가 없어, 실사용자는 아직 아바타를 못 바꾼다(팀/다음 작업에서 UI 연결 필요)
- persona 캐시가 늘어날수록 startup 시간이 길어짐(현재 1개 → 2개, 콜드스타트 영향은 미미할 것으로 예상되나 미실측)
