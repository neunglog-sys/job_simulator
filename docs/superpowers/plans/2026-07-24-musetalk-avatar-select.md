# MuseTalk 아바타 남/여 선택 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** MuseTalk WebSocket 아바타 경로가 `avatar_id`("male"/"female")를 받아 해당 페르소나(영상+목소리)로 발화하게 하고, 여성 영상이 아직 없어도 서버가 정상 기동하도록 만든다.

**Architecture:** 프론트가 WS 요청에 `avatar_id`를 실어 보낸다(백엔드는 투명 릴레이라 변경 없음). Colab 노트북의 MuseTalk 서버 셀에 `resolve_persona()` 헬퍼를 추가해 3개 핸들러의 중복 조회 로직을 통일하고, startup 루프를 "없으면 건너뛰고 기본으로 폴백"하는 관대한 방식으로 바꾼다.

**Tech Stack:** TypeScript(React, 프론트) / Python(FastAPI, Colab 노트북 셀) — 노트북은 `%%writefile`로 셀 하나가 통째로 서버 스크립트가 된다.

## Global Constraints

- 스펙: [`docs/superpowers/specs/2026-07-24-musetalk-avatar-select-design.md`](../specs/2026-07-24-musetalk-avatar-select-design.md) — 승인됨, 변경 없음.
- 백엔드(`services/api`)는 **변경 없음**. `relay_musetalk_ws`/`_pump_bidirectional`은 페이로드를 파싱하지 않는 투명 릴레이이므로 프론트가 보낸 `avatar_id`가 그대로 코랩까지 전달된다.
- 프론트(`apps/web`)는 vitest/jest 등 테스트 러너가 없다. 이 저장소의 검증 게이트는 `npm run lint`(`tsc -b`) exit 0이다. 새 테스트 프레임워크를 도입하지 않는다(기존 관례 유지, YAGNI).
- 노트북 원본은 **`G:\내 드라이브\JOBIVERSE\JOBIVERSE_MuseTalk_ElevenLabs_A100_Stream_v2_2.ipynb`** 하나뿐이다. `c:\JMS\프로젝트\3_project\avatar\JOBIVERSE_MuseTalk_ElevenLabs_A100_Stream_v2_2.ipynb`는 Drive 마이그레이션 이전의 **동결된 백업**이며 의도적으로 동기화하지 않는다 — 이번 계획에서 절대 건드리지 않는다.
- `avatar/` 폴더는 어떤 git 저장소에도 속하지 않는다(`job_simulator/`만 별도 repo). 노트북·패치 스크립트 관련 단계는 git commit이 아니라 **타임스탬프 백업 파일**로 되돌릴 지점을 만든다.
- **`NotebookEdit` 도구는 이 노트북에 쓸 수 없다.** 이 도구는 사용 전 같은 대화에서 `Read`가 먼저 성공해야 하는데, 이 파일은 약 53,000토큰이라 `Read`가 `limit`을 줘도(실측: `limit=5`조차) "File content exceeds maximum allowed tokens"로 실패한다. 대신 **셀의 `source`를 Python으로 직접 JSON 조작**해서 쓴다(Task 2/3). 이 접근은 이미 스크래치 사본에 대해 왕복 테스트를 마쳤다(문법 통과, JSON 재로드 확인).
- 노트북 서버 코드 안에서 `PERSONA_MAP.get(...)` 조회가 **3곳**(`/generate`, `/generate-audio`, WS `/generate-stream`)에 흩어져 있다. 전부 `resolve_persona()` 하나로 통일한다.
- 없는 페르소나는 **에러가 아니라 기본(male)로 폴백**해야 한다(A안). 서버 기동이 실패해서는 안 된다.
- 기존 `speaker_id: "coach"` 요청은 **회귀 없이** male로 계속 동작해야 한다(`AVATAR_ALIASES = {"coach": "male"}`).
- `AVATAR_VIDEO_PATH` 환경변수 이름은 **바꾸지 않는다** — 기존 male/coach 경로가 이미 이 이름으로 동작 중이므로, 이름을 바꾸면 기존 Colab Secrets/셀 설정과 어긋날 위험이 있다. 여성 전용 변수만 신규(`AVATAR_VIDEO_PATH_FEMALE`, `ELEVENLABS_VOICE_ID_FEMALE`)로 추가한다.

---

## Task 1: 프론트 — `avatar_id` 계약 (api.ts + AiAvatarStage.tsx)

**Files:**
- Modify: `apps/web/src/lib/api.ts:697-754`
- Modify: `apps/web/src/components/conversation/AiAvatarStage.tsx:19-44`, `:150`, `:387-395`
- Test: 없음(이 저장소의 `apps/web`에는 vitest/jest가 없다). `npm run lint`(`tsc -b`)로 검증한다.

**Interfaces:**
- Produces: `MuseTalkSpeakRequest.avatar_id?: "male" | "female"` — `api.ts`가 export하는 타입. `AiAvatarStage.tsx`의 `MuseTalkStageRequest = MuseTalkSpeakRequest & { id: number }`가 그대로 물려받는다.
- Produces: `resolveAvatarId(): "male" | "female"` — `AiAvatarStage.tsx`의 로컬 헬퍼. 기존 `resolveStartBufferSeconds()`와 동일한 `?param=` URL 패턴.

- [ ] **Step 1: `api.ts`의 `MuseTalkSpeakRequest` 타입에 `avatar_id` 필드 추가**

`apps/web/src/lib/api.ts:697`의 현재 코드:

```typescript
export type MuseTalkSpeakRequest = {
  text: string;
  voice?: string | null;
  speaker_id?: string;
  gesture_index?: number;
```

아래로 교체:

```typescript
export type MuseTalkSpeakRequest = {
  text: string;
  voice?: string | null;
  speaker_id?: string;
  /** 남/여 아바타 선택. 미지정 시 서버 기본(male)로 진행. */
  avatar_id?: "male" | "female";
  gesture_index?: number;
```

- [ ] **Step 2: `generateMuseTalkBlob`의 WS 송신에 기본값 추가**

`apps/web/src/lib/api.ts:754` 부근의 현재 코드:

```typescript
      socket.send(JSON.stringify({ speaker_id: "coach", emotion: "neutral", ...request }));
```

아래로 교체:

```typescript
      socket.send(
        JSON.stringify({ speaker_id: "coach", avatar_id: "male", emotion: "neutral", ...request })
      );
```

- [ ] **Step 3: 타입체크로 여기까지 검증**

Run: `cd apps/web && npm run lint`
Expected: `tsc -b --pretty false` 종료 코드 0, 에러 출력 없음.

- [ ] **Step 4: `AiAvatarStage.tsx`에 `resolveAvatarId()` 헬퍼 추가**

`apps/web/src/components/conversation/AiAvatarStage.tsx:19-46`의 현재 코드(파일 맨 위, `resolveStartBufferSeconds` 정의 부분):

```typescript
const MUSE_TALK_MIME = 'video/mp4; codecs="avc1.42E01F, mp4a.40.2"';
const MUSE_TALK_START_BUFFER_SECONDS = 2;
const MUSE_TALK_START_BUFFER_MIN = 0.3;
const MUSE_TALK_START_BUFFER_MAX = 5;

/** 시작 버퍼 임계값. `?startBuffer=1.0`으로 런타임 조정한다(첫 재생 지연 스윕 측정용).
 *
 * 빈 문자열·비수치·NaN은 전부 기본값으로 떨어뜨린다. `Number("")`는 0이고 오타는 NaN인데,
 * NaN이 새면 `bufferedAhead < NaN`이 **항상 false**라 버퍼 없이 즉시 재생돼버린다 —
 * stall 위험이 가장 큰 설정으로 조용히 빠지는 것이라 반드시 막아야 한다.
 */
function resolveStartBufferSeconds(): number {
  if (typeof window === "undefined") return MUSE_TALK_START_BUFFER_SECONDS;
  try {
    const raw = new URLSearchParams(window.location.search).get("startBuffer");
    if (raw === null || raw.trim() === "") return MUSE_TALK_START_BUFFER_SECONDS;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return MUSE_TALK_START_BUFFER_SECONDS;
    return Math.min(
      MUSE_TALK_START_BUFFER_MAX,
      Math.max(MUSE_TALK_START_BUFFER_MIN, parsed)
    );
  } catch {
    return MUSE_TALK_START_BUFFER_SECONDS;
  }
}

export function AiAvatarStage({
```

아래로 교체(끝의 `resolveAvatarId` 함수 + `export function AiAvatarStage({` 추가 부분만 새로 들어감, 나머지는 그대로):

```typescript
const MUSE_TALK_MIME = 'video/mp4; codecs="avc1.42E01F, mp4a.40.2"';
const MUSE_TALK_START_BUFFER_SECONDS = 2;
const MUSE_TALK_START_BUFFER_MIN = 0.3;
const MUSE_TALK_START_BUFFER_MAX = 5;

/** 시작 버퍼 임계값. `?startBuffer=1.0`으로 런타임 조정한다(첫 재생 지연 스윕 측정용).
 *
 * 빈 문자열·비수치·NaN은 전부 기본값으로 떨어뜨린다. `Number("")`는 0이고 오타는 NaN인데,
 * NaN이 새면 `bufferedAhead < NaN`이 **항상 false**라 버퍼 없이 즉시 재생돼버린다 —
 * stall 위험이 가장 큰 설정으로 조용히 빠지는 것이라 반드시 막아야 한다.
 */
function resolveStartBufferSeconds(): number {
  if (typeof window === "undefined") return MUSE_TALK_START_BUFFER_SECONDS;
  try {
    const raw = new URLSearchParams(window.location.search).get("startBuffer");
    if (raw === null || raw.trim() === "") return MUSE_TALK_START_BUFFER_SECONDS;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return MUSE_TALK_START_BUFFER_SECONDS;
    return Math.min(
      MUSE_TALK_START_BUFFER_MAX,
      Math.max(MUSE_TALK_START_BUFFER_MIN, parsed)
    );
  } catch {
    return MUSE_TALK_START_BUFFER_SECONDS;
  }
}

/** 아바타 선택. `?avatarId=female`로 런타임 지정한다(선택 UI가 붙기 전 개발자용 테스트 경로).
 *  유효하지 않은 값은 기본값(male)으로 떨어뜨린다 — 노트북의 resolve_persona()도 어차피
 *  모르는 값이면 기본으로 폴백하지만, 프론트에서도 방어해 의도를 명확히 한다. */
function resolveAvatarId(): "male" | "female" {
  if (typeof window === "undefined") return "male";
  try {
    const raw = new URLSearchParams(window.location.search).get("avatarId");
    return raw === "female" ? "female" : "male";
  } catch {
    return "male";
  }
}

export function AiAvatarStage({
```

- [ ] **Step 5: 발화 effect 안에서 `avatarId` 계산**

`apps/web/src/components/conversation/AiAvatarStage.tsx:150` 부근(발화 WS effect 시작부)의 현재 코드:

```typescript
    const startedAt = window.performance.now();
    const startBufferSeconds = resolveStartBufferSeconds();
```

아래로 교체:

```typescript
    const startedAt = window.performance.now();
    const startBufferSeconds = resolveStartBufferSeconds();
    const avatarId = resolveAvatarId();
```

- [ ] **Step 6: WS 송신 페이로드에 `avatar_id` 추가**

`apps/web/src/components/conversation/AiAvatarStage.tsx:387-394`의 현재 코드:

```typescript
      socket.send(
        JSON.stringify({
          speaker_id: "coach",
          emotion: "neutral",
          idle_time: idleTime,
          ...payload,
        })
      );
```

아래로 교체:

```typescript
      socket.send(
        JSON.stringify({
          speaker_id: "coach",
          avatar_id: avatarId,
          emotion: "neutral",
          idle_time: idleTime,
          ...payload,
        })
      );
```

- [ ] **Step 7: 타입체크로 전체 검증**

Run: `cd apps/web && npm run lint`
Expected: `tsc -b --pretty false` 종료 코드 0.

- [ ] **Step 8: 수동 확인 — URL 파라미터로 강제 지정이 실제로 페이로드에 실리는지**

브라우저에서 1:1 대화 페이지를 **`?avatarId=female`**을 붙여 열고, F12 콘솔에서 발화 1회 트리거 후 다음 로그를 확인한다:

```
[MuseTalk] ws_open { ..., idle_time: ... }
```

이 시점에는 콘솔에 `avatar_id`가 직접 안 찍히므로(payload 로그가 `avatar_id` 필드를 포함한 전체 객체를 안 찍음), Network 탭 → WS 프레임 → 전송된 프레임 내용에서 `"avatar_id":"female"`이 보이는지 확인한다. (선택 UI 없이도 계약이 제대로 실리는지 확인하는 유일한 방법이다.)

- [ ] **Step 9: Commit**

```bash
cd job_simulator
git add apps/web/src/lib/api.ts apps/web/src/components/conversation/AiAvatarStage.tsx
git commit -m "$(cat <<'EOF'
feat(avatar): MuseTalk WS 경로에 avatar_id(male/female) 계약 추가

백엔드 avatar_catalog()가 이미 쓰는 avatar_id 계약을 MuseTalk WS 경로에도
연결한다. 선택 UI는 아직 없어 ?avatarId= URL 파라미터로만 테스트 가능하다.
기본값 male이라 기존 동작은 그대로다.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
git log --oneline -1
```

Expected: 새 커밋 1개 생성, `git status --short`에 이 두 파일 안 보임.

---

## Task 2: 노트북 패치 스크립트 작성 + 스크래치 사본으로 드라이런 검증

**Files:**
- Create: `avatar/패치_아바타선택_20260724.py`
- Create: `avatar/_test_resolve_persona.py`
- Test: 두 층위로 검증한다 — ① `_test_resolve_persona.py`가 결정 로직(우선순위·별칭·폴백)을 행위 테스트하고(Step 2), ② 패치 스크립트 자체는 앵커 매칭 assert + 문법 검사로 "패치가 정확히 적용됐는지"를 검증한다(Step 3-5). **이 태스크는 실제 노트북을 건드리지 않는다.**

**Interfaces:**
- Consumes: 없음(독립 실행 스크립트).
- Produces: `patch_notebook(path: str) -> None` 함수 — Task 3이 같은 스크립트를 **경로만 바꿔** 재사용한다. 함수가 내부에서 원본을 `<path>.bak-<timestamp>`로 백업한 뒤 패치하므로, 어느 경로에 대해 실행해도 안전하게 되돌릴 수 있다.

- [ ] **Step 1: 패치 스크립트 작성**

Create `avatar/패치_아바타선택_20260724.py`:

```python
"""MuseTalk 노트북 서버 셀에 avatar_id(male/female) 지원을 추가하는 1회성 패치.

노트북(.ipynb)은 이 저장소에서 git 추적 대상이 아니라서(커밋 불가) 원본을
`<path>.bak-<타임스탬프>`로 항상 먼저 백업한 뒤 패치한다.

NotebookEdit 도구를 쓰지 않는 이유: 이 노트북은 약 53,000토큰이라 `Read`가
`limit`을 줘도(실측 limit=5도) "File content exceeds maximum allowed tokens"로
실패한다. NotebookEdit은 같은 대화에서 Read가 먼저 성공해야 하므로 이 파일에는
쓸 수 없다. 대신 셀의 `source`를 JSON 레벨에서 직접 교체한다.

사용법:
  python 패치_아바타선택_20260724.py <노트북_경로.ipynb>

8개 앵커 전부가 정확히 1번씩만 매치되는지 확인(assert)한 뒤 교체한다 —
하나라도 없거나 중복이면 아무것도 안 쓰고 즉시 실패한다(부분 패치 방지).
"""

import io
import json
import shutil
import sys
import time

SERVER_CELL_ID = "04f25804"

# (설명, OLD, NEW) — 전부 노트북 셀의 실제 코드에서 그대로 추출한 앵커.
EDITS = [
    (
        "PERSONA_MAP 정의 확장 + resolve_persona() 추가",
        '''PERSONA_MAP = {
    "coach": {
        "video_path": os.environ.get("AVATAR_VIDEO_PATH", "data/coach/idle_25fps.mp4"),
        "voice_id": ELEVENLABS_VOICE_ID,
        "instructions": "calm friendly job interview coach",
    },
}''',
        '''DEFAULT_AVATAR_ID = "male"
# 구버전 프론트/테스트 스크립트가 보내는 speaker_id="coach" 를 흡수한다.
AVATAR_ALIASES = {"coach": "male"}

PERSONA_MAP = {
    "male": {
        "video_path": os.environ.get("AVATAR_VIDEO_PATH", "data/coach/idle_25fps.mp4"),
        "voice_id": ELEVENLABS_VOICE_ID,
        "instructions": "calm friendly job interview coach",
    },
    "female": {
        "video_path": os.environ.get("AVATAR_VIDEO_PATH_FEMALE", "data/female/idle_25fps.mp4"),
        # 여성 전용 voice_id 없으면 남성과 동일 목소리로 폴백(무음보다 낫다).
        "voice_id": os.environ.get("ELEVENLABS_VOICE_ID_FEMALE", "").strip() or ELEVENLABS_VOICE_ID,
        "instructions": "calm friendly job interview coach",
    },
}


def resolve_persona(req: dict) -> tuple[str, dict]:
    """avatar_id > speaker_id(별칭) > 기본 순으로 페르소나를 고른다.

    미등록·미준비 페르소나는 에러가 아니라 **기본 아바타로 폴백**한다(백엔드
    avatar_catalog()의 "이미지 없으면 기본으로 진행" 정책과 동일 철학).
    """
    raw = req.get("avatar_id") or req.get("speaker_id") or DEFAULT_AVATAR_ID
    aid = AVATAR_ALIASES.get(raw, raw)
    persona = PERSONA_MAP.get(aid)
    if persona is None or not persona.get("ready"):
        aid = DEFAULT_AVATAR_ID
        persona = PERSONA_MAP[aid]
    return aid, persona''',
    ),
    (
        "startup: 관대한 페르소나 등록(A안)",
        '''    for persona in PERSONA_MAP.values():
        if not os.path.exists(persona["video_path"]):
            raise FileNotFoundError(f"Avatar video not found: {persona['video_path']}")

    print("[SYSTEM]", json.dumps(gpu_snapshot(), ensure_ascii=False), flush=True)
    load_models()
    for persona in PERSONA_MAP.values():
        _prepare_persona(persona["video_path"])
        _ensure_idle_loop_video(persona["video_path"])
    print("[ML-TIMING] server startup ready - models/persona loaded", flush=True)''',
        '''    print("[SYSTEM]", json.dumps(gpu_snapshot(), ensure_ascii=False), flush=True)
    load_models()
    for aid, persona in PERSONA_MAP.items():
        if not os.path.exists(persona["video_path"]):
            print(f"[WARN] 아바타 '{aid}' 영상 없음({persona['video_path']}) → 비활성. "
                  f"파일을 넣고 재기동하면 자동으로 활성화됩니다.", flush=True)
            persona["ready"] = False
            continue
        _prepare_persona(persona["video_path"])
        _ensure_idle_loop_video(persona["video_path"])
        persona["ready"] = True
    ready_ids = [aid for aid, p in PERSONA_MAP.items() if p["ready"]]
    if not ready_ids:
        raise RuntimeError("준비된 아바타가 하나도 없습니다 — 최소 1개 영상이 필요합니다.")
    print("[ML-TIMING] server startup ready - ready personas:", ready_ids, flush=True)''',
    ),
    (
        "/health: personas_missing·default_avatar_id 노출",
        '''        "personas_ready": list(PERSONA_MAP.keys()),
        "elevenlabs_configured": bool(ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID),''',
        '''        "personas_ready": [aid for aid, p in PERSONA_MAP.items() if p.get("ready")],
        "personas_missing": [aid for aid, p in PERSONA_MAP.items() if not p.get("ready")],
        "default_avatar_id": DEFAULT_AVATAR_ID,
        "elevenlabs_configured": bool(ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID),''',
    ),
    (
        "MediaLineRequest에 avatar_id 필드 추가",
        '''class MediaLineRequest(BaseModel):
    speaker_id: str
    speaker_name: str | None = None''',
        '''class MediaLineRequest(BaseModel):
    speaker_id: str
    avatar_id: str | None = None
    speaker_name: str | None = None''',
    ),
    (
        "/generate 핸들러: resolve_persona 사용",
        '''@app.post("/generate")
def generate(req: MediaLineRequest):
    persona = PERSONA_MAP.get(req.speaker_id)
    if not persona:
        raise HTTPException(400, f"unknown speaker_id: {req.speaker_id}")''',
        '''@app.post("/generate")
def generate(req: MediaLineRequest):
    _avatar_id, persona = resolve_persona({"avatar_id": req.avatar_id, "speaker_id": req.speaker_id})''',
    ),
    (
        "/generate-audio 핸들러: avatar_id Form 필드 + resolve_persona",
        '''@app.post("/generate-audio")
def generate_audio(
    speaker_id: str = Form("coach"),
    audio: UploadFile = File(...),
):
    persona = PERSONA_MAP.get(speaker_id)
    if not persona:
        raise HTTPException(400, f"unknown speaker_id: {speaker_id}")''',
        '''@app.post("/generate-audio")
def generate_audio(
    speaker_id: str = Form("coach"),
    avatar_id: str | None = Form(None),
    audio: UploadFile = File(...),
):
    _avatar_id, persona = resolve_persona({"avatar_id": avatar_id, "speaker_id": speaker_id})''',
    ),
    (
        "WS /generate-stream: resolve_persona 사용",
        '''        req = await ws.receive_json()
        persona = PERSONA_MAP.get(req.get("speaker_id"))
        if not persona:
            await ws.send_json({"type": "error", "message": f"unknown speaker_id: {req.get('speaker_id')}"})
            return''',
        '''        req = await ws.receive_json()
        avatar_id, persona = resolve_persona(req)''',
    ),
    (
        "WS metrics에 avatar_id 포함(done 페이로드로 프론트가 폴백 여부를 앎)",
        '''        metrics = {
            "job_id": job_id,
            **tts_metrics,''',
        '''        metrics = {
            "job_id": job_id,
            "avatar_id": avatar_id,
            **tts_metrics,''',
    ),
]


def patch_notebook(path: str) -> None:
    backup_path = f"{path}.bak-{time.strftime('%Y%m%d-%H%M%S')}"
    shutil.copy2(path, backup_path)
    print(f"백업 생성: {backup_path}")

    with io.open(path, encoding="utf-8") as f:
        nb = json.load(f)

    cell = next((c for c in nb["cells"] if c.get("id") == SERVER_CELL_ID), None)
    if cell is None:
        raise RuntimeError(f"셀 id={SERVER_CELL_ID} 를 찾을 수 없습니다.")

    source = "".join(cell.get("source", []))

    for name, old, new in EDITS:
        count = source.count(old)
        if count != 1:
            raise RuntimeError(
                f"패치 실패 — '{name}' 앵커가 {count}번 매치됨(1이어야 함). "
                f"노트북 셀이 이 스크립트가 가정한 것과 달라졌을 수 있습니다. "
                f"아무것도 쓰지 않았습니다."
            )
        source = source.replace(old, new, 1)
        print(f"적용됨: {name}")

    cell["source"] = source.splitlines(keepends=True)
    cell["outputs"] = []
    cell["execution_count"] = None

    with io.open(path, "w", encoding="utf-8") as f:
        json.dump(nb, f, ensure_ascii=False, indent=1)

    # 재로드 검증 — 쓰기 직후 실제로 반영됐는지 확인.
    with io.open(path, encoding="utf-8") as f:
        nb2 = json.load(f)
    cell2 = next(c for c in nb2["cells"] if c.get("id") == SERVER_CELL_ID)
    src2 = "".join(cell2["source"])
    assert "resolve_persona" in src2
    assert "AVATAR_ALIASES" in src2
    assert "personas_missing" in src2
    print(f"검증 완료: {path} (셀 길이 {len(src2)}자)")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("사용법: python 패치_아바타선택_20260724.py <노트북_경로.ipynb>")
        sys.exit(1)
    patch_notebook(sys.argv[1])
```

- [ ] **Step 2: `resolve_persona()` 결정 로직 자체를 행위 테스트로 검증 (torch 불필요)**

Step 1의 스크립트는 "패치가 정확히 적용됐는지"만 검증한다(`count(old) == 1` assert). **`resolve_persona()`가 실제로 옳은 결정을 내리는지**(우선순위, 별칭, 폴백)는 별도로 검증해야 한다. 이 함수는 `PERSONA_MAP`/`AVATAR_ALIASES`/`DEFAULT_AVATAR_ID`만 참조하고 torch/musetalk을 import하지 않으므로, Colab 없이 순수 파이썬으로 뗴어내 테스트할 수 있다.

Create `avatar/_test_resolve_persona.py`:

```python
"""resolve_persona()의 결정 로직만 독립 실행해 검증한다 (torch/musetalk import 없음).

노트북 셀은 GPU 런타임에서만 통째로 실행 가능해 일반적인 pytest 대상이 될 수 없다.
대신 순수 결정 로직(우선순위·별칭·폴백)만 로직 블록으로 떼어 실행 검증한다.
아래 LOGIC 문자열은 avatar/패치_아바타선택_20260724.py의 EDITS[0] 안 resolve_persona
정의와 동일한 알고리즘이어야 한다 — 그 스크립트를 수정하면 여기도 같이 확인할 것.
"""

LOGIC = '''
DEFAULT_AVATAR_ID = "male"
AVATAR_ALIASES = {"coach": "male"}

PERSONA_MAP = {
    "male": {"video_path": "m.mp4", "voice_id": "vm", "ready": True},
    "female": {"video_path": "f.mp4", "voice_id": "vf", "ready": False},
}


def resolve_persona(req):
    raw = req.get("avatar_id") or req.get("speaker_id") or DEFAULT_AVATAR_ID
    aid = AVATAR_ALIASES.get(raw, raw)
    persona = PERSONA_MAP.get(aid)
    if persona is None or not persona.get("ready"):
        aid = DEFAULT_AVATAR_ID
        persona = PERSONA_MAP[aid]
    return aid, persona
'''

ns = {}
exec(LOGIC, ns)
resolve_persona = ns["resolve_persona"]
PERSONA_MAP = ns["PERSONA_MAP"]

CASES = [
    ("avatar_id=male, ready", {"avatar_id": "male"}, "male"),
    ("avatar_id=female, 미준비 -> male 폴백", {"avatar_id": "female"}, "male"),
    ("speaker_id=coach(별칭) -> male", {"speaker_id": "coach"}, "male"),
    ("아무 키도 없음 -> 기본 male", {}, "male"),
    ("avatar_id=bogus -> male 폴백", {"avatar_id": "bogus"}, "male"),
    ("avatar_id 우선, speaker_id 무시", {"avatar_id": "male", "speaker_id": "coach"}, "male"),
]

if __name__ == "__main__":
    for name, req, expected in CASES:
        aid, persona = resolve_persona(req)
        assert aid == expected, f"FAIL [{name}]: got {aid}, expected {expected}"
        assert persona is PERSONA_MAP[aid]
        print(f"OK  {name} -> {aid}")

    # female이 ready=True로 바뀌면 실제로 선택되는지 (폴백이 아니라 진짜 전환인지 확인)
    PERSONA_MAP["female"]["ready"] = True
    aid, persona = resolve_persona({"avatar_id": "female"})
    assert aid == "female", f"FAIL: female ready인데 폴백됨 -> {aid}"
    print("OK  avatar_id=female, ready -> female (실제 전환 확인)")
    print("\n✅ 전부 통과 (7/7)")
```

Run: `python avatar/_test_resolve_persona.py`
Expected: 7개의 `OK` 라인 + `✅ 전부 통과 (7/7)`. 하나라도 AssertionError가 나면 이후 스텝(스크래치 드라이런)으로 넘어가지 말고 로직을 다시 확인한다.

- [ ] **Step 3: 스크래치 사본에 대해 드라이런**

```bash
cd "c:/JMS/프로젝트/3_project/avatar"
cp "/g/내 드라이브/JOBIVERSE/JOBIVERSE_MuseTalk_ElevenLabs_A100_Stream_v2_2.ipynb" \
   "/tmp/dryrun_notebook.ipynb" 2>/dev/null || \
cp "/g/내 드라이브/JOBIVERSE/JOBIVERSE_MuseTalk_ElevenLabs_A100_Stream_v2_2.ipynb" \
   "./_dryrun_notebook.ipynb"
python 패치_아바타선택_20260724.py "./_dryrun_notebook.ipynb"
```

Expected 출력(8개 적용 로그 + 검증 완료):

```
백업 생성: ./_dryrun_notebook.ipynb.bak-<타임스탬프>
적용됨: PERSONA_MAP 정의 확장 + resolve_persona() 추가
적용됨: startup: 관대한 페르소나 등록(A안)
적용됨: /health: personas_missing·default_avatar_id 노출
적용됨: MediaLineRequest에 avatar_id 필드 추가
적용됨: /generate 핸들러: resolve_persona 사용
적용됨: /generate-audio 핸들러: avatar_id Form 필드 + resolve_persona
적용됨: WS /generate-stream: resolve_persona 사용
적용됨: WS metrics에 avatar_id 포함(done 페이로드로 프론트가 폴백 여부를 앎)
검증 완료: ./_dryrun_notebook.ipynb (셀 길이 46241자)
```

만약 "패치 실패 — ... 앵커가 N번 매치됨"이 뜨면: 노트북이 이 계획 작성 시점(2026-07-24) 이후 다른 손을 탔다는 뜻이다. 실패 메시지가 가리키는 앵커 이름의 코드를 노트북에서 직접 확인하고, `EDITS`의 OLD 문자열을 실제 코드에 맞게 고친 뒤 다시 실행한다. **절대 assert를 우회하거나 old를 억지로 맞추지 말 것** — 실제 코드와 다른 곳을 바꾸는 사고를 막기 위한 안전장치다.

- [ ] **Step 4: 패치된 스크래치 사본의 서버 셀 문법 검사**

```bash
python -c "
import json
nb = json.load(open('./_dryrun_notebook.ipynb', encoding='utf-8'))
cell = next(c for c in nb['cells'] if c.get('id') == '04f25804')
src = ''.join(cell['source'])
# 1행은 '%%writefile ...' 매직 — 순수 파이썬이 아니므로 제외하고 검사한다.
body = '\n'.join(src.splitlines()[1:])
open('_dryrun_cell_body.py', 'w', encoding='utf-8').write(body)
"
python -m py_compile _dryrun_cell_body.py
echo "exit=$?"
```

Expected: `exit=0`, 에러 출력 없음.

- [ ] **Step 5: 새 마커가 정확한 위치에 들어갔는지 확인**

```bash
grep -n "resolve_persona\|AVATAR_ALIASES\|personas_missing\|DEFAULT_AVATAR_ID\|avatar_id" _dryrun_cell_body.py
```

Expected: `resolve_persona` 정의 1곳 + 호출 3곳(총 4), `AVATAR_ALIASES` 2곳(정의+참조), `personas_missing` 1곳, `DEFAULT_AVATAR_ID` 여러 곳 — 앞서 Step 2에서 로컬로 검증했을 때와 동일한 개수(정의 1 + 참조 다수)가 나와야 한다.

- [ ] **Step 6: 드라이런 산출물 정리**

```bash
rm -f "./_dryrun_notebook.ipynb" "./_dryrun_notebook.ipynb".bak-* "_dryrun_cell_body.py"
```

이 스크래치 파일들은 검증용이라 커밋 대상이 아니다. `avatar/`가 git 저장소 밖이라 애초에 커밋될 일도 없지만, 다음 사람이 헷갈리지 않도록 지운다.

**이 태스크는 여기서 끝난다 — 아직 실제(canonical) 노트북은 건드리지 않았다.**

---

## Task 3: 실제 노트북에 패치 적용 + Colab 수동 검증

**Files:**
- Modify(스크립트 경유): `G:\내 드라이브\JOBIVERSE\JOBIVERSE_MuseTalk_ElevenLabs_A100_Stream_v2_2.ipynb` (셀 id=`04f25804`)
- Test: Colab 런타임에서의 수동 기동/요청 검증(자동화 불가 — GPU/Colab 필요).

**Interfaces:**
- Consumes: Task 2에서 작성·검증한 `avatar/패치_아바타선택_20260724.py`의 `patch_notebook(path)` (변경 없이 그대로 재사용).

- [ ] **Step 1: 실제 노트북에 패치 적용**

```bash
cd "c:/JMS/프로젝트/3_project/avatar"
python 패치_아바타선택_20260724.py "/g/내 드라이브/JOBIVERSE/JOBIVERSE_MuseTalk_ElevenLabs_A100_Stream_v2_2.ipynb"
```

Expected: Task 2 Step 3과 동일한 8줄의 "적용됨:" 로그 + "검증 완료" 출력. 그리고 `G:\내 드라이브\JOBIVERSE\` 안에 `JOBIVERSE_MuseTalk_ElevenLabs_A100_Stream_v2_2.ipynb.bak-<타임스탬프>` 백업 파일이 새로 생겼는지 확인한다(이게 되돌릴 지점 — git commit이 없는 자리를 대신한다).

- [ ] **Step 2: (여성 영상 없는 상태) Colab에서 서버 기동 확인**

Colab에서 노트북을 처음부터 실행한다(런타임 A100). 서버 기동 셀의 출력에서 다음을 확인한다:

```
[WARN] 아바타 'female' 영상 없음(data/female/idle_25fps.mp4) → 비활성. 파일을 넣고 재기동하면 자동으로 활성화됩니다.
[ML-TIMING] server startup ready - ready personas: ['male']
```

Expected: **기동이 실패하지 않는다.** (여성 영상이 없어도 서버가 정상적으로 뜨는 것이 A안의 핵심 요구사항.)

- [ ] **Step 3: `/health`로 준비 상태 확인**

```bash
curl -s -H "ngrok-skip-browser-warning: true" https://<ngrok도메인>/health | python -m json.tool
```

Expected 응답에 다음이 포함:

```json
{
  "personas_ready": ["male"],
  "personas_missing": ["female"],
  "default_avatar_id": "male"
}
```

- [ ] **Step 4: `avatar_id: "female"` 요청 → male로 폴백 확인**

```python
import asyncio, json, websockets

async def main():
    async with websockets.connect(
        "wss://<ngrok도메인>/generate-stream",
        additional_headers={"ngrok-skip-browser-warning": "true"},
        max_size=None,
    ) as ws:
        await ws.send(json.dumps({"avatar_id": "female", "text": "안녕하세요.", "emotion": "neutral"}))
        while True:
            msg = await ws.recv()
            if isinstance(msg, (bytes, bytearray)):
                continue
            data = json.loads(msg)
            print(data.get("type"), data)
            if data.get("type") == "done":
                assert data["avatar_id"] == "male", f"폴백 실패: {data['avatar_id']}"
                print("✅ female 요청이 male로 폴백됨")
                break
            if data.get("type") == "error":
                raise RuntimeError(data)

asyncio.run(main())
```

Expected: 에러 없이 스트림 완료, `done` 페이로드의 `avatar_id == "male"`.

- [ ] **Step 5: 구버전 `speaker_id: "coach"` 단독 요청 — 회귀 없음 확인**

위와 같은 스크립트에서 요청 payload만 `{"speaker_id": "coach", "text": "안녕하세요.", "emotion": "neutral"}`로 바꿔 재실행(avatar_id 없이).

Expected: 정상 동작, `done.avatar_id == "male"`. (기존 프론트/테스트 스크립트가 이 형식을 계속 보낼 수 있다는 뜻.)

- [ ] **Step 6: 여성 영상 투입 후 재기동 — 자동 활성화 확인 (여성 영상 도착 후 진행)**

여성 driving 영상이 도착하면:

1. Colab에 `data/female/idle_25fps.mp4`로 업로드(또는 `AVATAR_VIDEO_PATH_FEMALE` 환경변수로 다른 경로 지정).
2. 여성 voice_id를 받으면 `os.environ["ELEVENLABS_VOICE_ID_FEMALE"] = "<voice_id>"`를 Secrets 또는 셀에 설정.
3. 노트북 재기동.

Expected 기동 로그:

```
[ML-TIMING] server startup ready - ready personas: ['male', 'female']
```

`avatar_id: "female"` 요청을 다시 보내 `done.avatar_id == "female"`이 되는지, 영상과 목소리가 실제로 여성으로 바뀌는지 확인한다.

> 이 Step은 여성 에셋이 아직 없어 지금 당장 완료할 수 없다. Task 3의 나머지(Step 1-5)가 통과하면 이 계획의 나머지 목표는 달성된 것이고, Step 6은 에셋 도착 시 별도로 수행한다.

- [ ] **Step 7: Drive 용량 확인**

```powershell
Get-PSDrive G | Select-Object @{n='여유GB';e={[math]::Round($_.Free/1GB,2)}}
```

Expected: 페르소나 캐시가 1개(여성) 늘어도(+약 2.7GB) 여유 공간이 남는다(패치 시점 기준 여유 8.17GB 확인됨 — 실행 시점에 재확인).

---

## Self-Review 체크리스트 (계획 작성자용, 완료됨)

1. **스펙 커버리지**: 스펙 §1(계약)→Task1 Step1-2,6 / §2(페르소나 정의)→Task2 Edit1 / §3(관대한 등록)→Task2 Edit2 / §4(조회 헬퍼 통일)→Task2 Edit5-7 / §5(관측성)→Task2 Edit3,7(WS metrics) / §6(프론트 3곳)→Task1 / §검증계획 1-5→Task3 Step2-6. 전부 매핑됨.
2. **플레이스홀더**: 없음 — 모든 코드 블록이 실행 가능한 완전한 코드. Step 6(여성 에셋 도착 대기)만 "나중에"이지만 이는 실제 외부 의존성이지 미완성 계획이 아님.
3. **타입/이름 일관성**: `resolve_persona(req: dict) -> tuple[str, dict]` — Task2에서 정의, Task2/3의 3개 호출부 모두 동일 시그니처로 소비. `resolveAvatarId(): "male" | "female"` — Task1에서 정의 즉시 사용, 이름 불일치 없음.
4. **행위 테스트 추가**(pre-flight 스캔에서 발견·보완): 원래 Task2는 "패치가 적용됐는지"만 검증했고 `resolve_persona()`의 판단 로직 자체(우선순위·별칭·미준비 폴백)는 검증하지 않았다. torch/musetalk 없이 순수 로직만 실행하는 `_test_resolve_persona.py`(Step 2)를 추가했다 — 7개 케이스로 실제 실행 검증 완료(male 우선/female 미준비 폴백/coach 별칭/키 없음/bogus 값/avatar_id 우선순위/female ready 시 실제 전환).
