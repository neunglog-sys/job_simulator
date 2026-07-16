"""데모 리허설 — 실제 서비스 전 구간을 사용자처럼 밟는 E2E 스모크.

가입 → 상담(설문·이력서·SSE 대화) → 추천 → 게임(WS: 대화·과제) → 점수 → 리포트(PDF) → TTS
각 구간을 실제 API로 수행하고 ✅/⚠️/❌ 체크리스트를 출력한다. 발표 전 구멍 찾기용.

사용법 (컨테이너 안 — LLM 실키·DB 연결 그대로 사용):
  docker compose -f infra/docker-compose.yml -f infra/docker-compose.override.yml \
    exec -T api python scripts/demo-rehearsal.py
"""

import asyncio
import io
import json
import time
import uuid

import httpx
import websockets

BASE = "http://localhost:8000"
WS_BASE = "ws://localhost:8000"
RESULTS: list[tuple[str, str, str]] = []  # (상태, 구간, 비고)


def record(ok: str, stage: str, note: str = "") -> None:
    RESULTS.append((ok, stage, note))
    print(f"{ok} {stage}" + (f" — {note}" if note else ""), flush=True)


def make_resume_pdf() -> bytes:
    from reportlab.pdfgen import canvas

    buf = io.BytesIO()
    c = canvas.Canvas(buf)
    for i, line in enumerate([
        "Junior Purchasing Assistant Resume",
        "Experience: procurement support 1 year, vendor quotes, ERP entry",
        "Skills: Excel, ERP, negotiation basics",
    ]):
        c.drawString(72, 780 - i * 22, line)
    c.save()
    return buf.getvalue()


async def sse_chat(client: httpx.AsyncClient, cid: int, text: str) -> str:
    """상담 SSE 한 턴 — 토큰 조각을 모아 전체 응답을 돌려준다."""
    full = []
    async with client.stream(
        "POST", f"/api/consultations/{cid}/messages", json={"content": text}, timeout=90
    ) as res:
        async for line in res.aiter_lines():
            if line.startswith("data:"):
                try:
                    full.append(json.loads(line[5:]).get("text", ""))
                except ValueError:
                    pass
    return "".join(full)


async def main() -> None:  # noqa: PLR0915 — 리허설 시나리오는 한 흐름이 읽기 쉽다
    email = f"rehearsal-{uuid.uuid4().hex[:8]}@example.com"  # .local 등 특수 TLD는 EmailStr이 거부
    async with httpx.AsyncClient(base_url=BASE, timeout=60) as c:
        # ── 0. 헬스 ──
        r = await c.get("/health/deep")
        d = r.json() if r.status_code == 200 else {}
        record("✅" if r.status_code == 200 else "❌", "헬스체크(deep)", str(d))

        # ── 1. 가입/로그인 ──
        r = await c.post("/api/auth/signup", json={"email": email, "password": "rehearsal123", "name": "리허설"})
        if r.status_code != 201:
            record("❌", "회원가입", f"{r.status_code} {r.text[:80]}"); return
        c.headers["Authorization"] = f"Bearer {r.json()['access_token']}"
        me = await c.get("/api/auth/me")
        record("✅" if me.status_code == 200 else "❌", "가입→토큰→/me", me.json().get("name", ""))

        # ── 2. 상담: 설문 ──
        cid = (await c.post("/api/consultations")).json()["id"]
        items = (await c.get(f"/api/consultations/{cid}/survey")).json()["items"]
        answers = {it["id"]: it["options"][0]["key"] for it in items}
        r = await c.post(f"/api/consultations/{cid}/survey", json={"answers": answers})
        ok = r.status_code == 200 and r.json().get("avatar_lines")
        record("✅" if ok else "❌", f"사전 설문 ({len(items)}문항)", f"avatar_lines {len(r.json().get('avatar_lines', []))}개")

        # ── 3. 상담: 이력서 업로드 ──
        r = await c.post(f"/api/consultations/{cid}/resume",
                         files={"file": ("resume.pdf", make_resume_pdf(), "application/pdf")})
        if r.status_code == 200:
            record("✅", "이력서 업로드·분석", f"희망방향 {r.json().get('desired_directions')}")
        else:
            record("⚠️", "이력서 업로드·분석", f"{r.status_code} {r.text[:80]}")

        # ── 4. 상담: SSE 자유대화 ──
        t0 = time.time()
        reply = await sse_chat(c, cid, "구매 자재 관리 쪽 일이 잘 맞을지 고민이에요. 꼼꼼한 편이고 협상도 재밌었어요.")
        record("✅" if reply else "❌", "상담 SSE 1턴", f"{len(reply)}자 / {time.time()-t0:.1f}s")
        await sse_chat(c, cid, "네, 발주 정리하고 단가 비교하는 일에서 성취감을 느꼈어요. 문서 정리도 좋아해요.")

        # ── 5. 추천 (aptitude_unclear면 후속 대화 후 재시도) ──
        rec = None
        for attempt in range(3):
            r = await c.post("/api/recommendations", json={"consultation_id": cid})
            if r.status_code == 201:
                rec = r.json(); break
            if r.status_code == 409:
                detail = r.json().get("detail", {})
                followups = detail.get("followup_questions") or ["어떤 업무 환경을 선호하세요?"]
                record("⚠️", f"추천 게이트(409) {attempt+1}회", detail.get("message", "")[:40])
                await sse_chat(c, cid, f"{followups[0]}에 답하자면: 체계적인 사무 환경에서 자재·수치 다루는 일이 좋아요.")
            else:
                record("❌", "추천", f"{r.status_code} {r.text[:80]}"); break
        if rec:
            top = rec["results"][0]
            record("✅", f"추천 상위 {len(rec['results'])}개", f"1위 {top['job_title']} ({top['score']}점, scenario={top['scenario_slug']})")

        # ── 6. 게임 생성 (추천의 scenario_slug 우선, 없으면 gm-01) ──
        slug = next((x["scenario_slug"] for x in (rec or {}).get("results", []) if x.get("scenario_slug")), "gm-01")
        r = await c.post("/api/simulations", json={"scenario_slug": slug})
        sim = r.json()
        sim_id = sim["id"]
        map_ok = bool(sim.get("map"))
        spawn_ok = all(n.get("spawn") for n in sim["npcs"])
        record("✅" if r.status_code in (200, 201) else "❌", f"시뮬 생성 ({slug})",
               f"map={'있음' if map_ok else '없음(폴백)'}, NPC {len(sim['npcs'])}명 spawn {'전원' if spawn_ok else '일부'} 배정")
        if map_ok:
            bg = await c.get(sim["map"]["background"])
            record("✅" if bg.status_code == 200 else "❌", "맵 배경 정적 서빙", f"{bg.status_code} {len(bg.content)//1024}KB")

        # ── 7. 게임 WS: 대화 + 과제 제출 ──
        token = c.headers["Authorization"].split(" ")[1]
        step = sim["step"]
        npc_id = (step.get("npcs") or [sim["npcs"][0]["npc_id"]])[0]
        frames_seen: set[str] = set()
        try:
            async with websockets.connect(f"{WS_BASE}/ws/simulations/{sim_id}?token={token}", open_timeout=15) as ws:
                first = json.loads(await asyncio.wait_for(ws.recv(), 15))
                frames_seen.add(first.get("type", "?"))
                record("✅" if first.get("type") == "session" else "❌", "WS 접속(session 프레임)",
                       f"map { '포함' if first.get('map') else '없음' }")

                # NPC 대화 한 턴
                await ws.send(json.dumps({"type": "chat", "npc": npc_id,
                                          "content": "안녕하세요, 오늘 처리할 요청 내용부터 확인하고 싶습니다."}))
                npc_reply = None
                deadline = time.time() + 120
                while time.time() < deadline:
                    frame = json.loads(await asyncio.wait_for(ws.recv(), 120))
                    frames_seen.add(frame.get("type", "?"))
                    if frame.get("type") == "npc_reply":
                        npc_reply = frame; break
                if npc_reply:
                    record("✅", "WS NPC 대화", f"{npc_reply['name']}: {npc_reply['content'][:36]}… "
                           f"(affinity {npc_reply.get('affinity', {}).get('value')})")
                else:
                    record("❌", "WS NPC 대화", "npc_reply 미수신(120s)")

                # 과제 제출 1회 (write형이면 성의 있는 답, 선택형이면 보기 전체/첫 키)
                task = step.get("task") or {}
                kind = task.get("kind", "write")
                if kind == "write":
                    content = ("확인한 요청 내용 기준으로 정리했습니다. 목적과 대상, 조건, 예외 상황을 항목별로 "
                               "구분해 초안을 작성했고, 불명확한 부분은 담당자 확인 후 반영하겠습니다.")
                elif kind == "order":
                    content = [o["key"] for o in task.get("options", [])]
                elif kind == "checklist":
                    content = [o["key"] for o in task.get("options", [])][:3]
                else:
                    content = [task.get("options", [{}])[0].get("key", "a")]
                await ws.send(json.dumps({"type": "task_submit", "content": content}))
                result = None
                deadline = time.time() + 180
                while time.time() < deadline:
                    frame = json.loads(await asyncio.wait_for(ws.recv(), 180))
                    frames_seen.add(frame.get("type", "?"))
                    if frame.get("type") in ("task_result", "quest_result"):
                        result = frame; break
                if result:
                    record("✅", f"과제 제출({kind}) 채점", f"{result.get('total')}점 / {'통과' if result.get('passed') else '미달(재도전 흐름 정상)'}")
                else:
                    record("❌", "과제 채점", "task_result 미수신(180s)")
        except Exception as exc:  # noqa: BLE001
            record("❌", "게임 WS", f"{type(exc).__name__}: {exc}")
        record("✅", "WS 수신 프레임 종류", ", ".join(sorted(frames_seen)))

        # ── 8. 점수 (진행 중 부분 집계) ──
        r = await c.get(f"/api/simulations/{sim_id}/score")
        record("✅" if r.status_code == 200 else "❌", "점수 조회", f"total={r.json().get('total')}")

        # ── 9. 리포트 → PDF ──
        r = await c.post("/api/reports", json={"consultation_id": cid})
        rep_id = r.json().get("id")
        status = "pending"
        for _ in range(60):
            await asyncio.sleep(2)
            status = (await c.get(f"/api/reports/{rep_id}")).json().get("status")
            if status in ("done", "failed"):
                break
        if status == "done":
            pdf = await c.get(f"/api/reports/{rep_id}/pdf")
            ok = pdf.status_code == 200 and pdf.content[:4] == b"%PDF"
            record("✅" if ok else "❌", "리포트 PDF", f"{len(pdf.content)//1024}KB")
        else:
            record("❌", "리포트 생성", f"status={status}")

        # ── 10. TTS ──
        r = await c.post("/api/tts", json={"text": "직무 아카데미아에 오신 것을 환영합니다"})
        record("✅" if r.status_code == 200 and len(r.content) > 1000 else "⚠️", "TTS",
               f"{r.headers.get('content-type')} {len(r.content)//1024}KB")

    print("\n" + "=" * 52)
    print("데모 리허설 결과")
    print("=" * 52)
    for ok, stage, note in RESULTS:
        print(f"  {ok} {stage}" + (f" — {note}" if note else ""))
    fails = [s for ok, s, _ in RESULTS if ok == "❌"]
    print("=" * 52)
    print("구멍 없음 🎉" if not fails else f"구멍 {len(fails)}곳: {fails}")


if __name__ == "__main__":
    asyncio.run(main())
