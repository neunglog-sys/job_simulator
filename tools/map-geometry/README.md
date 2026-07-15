# 게임 맵 좌표 제작 도구 (Tiled → geometry.json)

배경 PNG 위에 **갈 수 있는 곳/없는 곳·NPC 자리**를 찍어서 게임이 쓸 좌표 데이터를 만든다.
좌표 원본은 맵별 `geometry.json`, 검수용 CSV·오버레이·플레이테스트는 자동 생성.

## 0. 준비 (1회)

- **Tiled** 설치: <https://www.mapeditor.org> (또는 `winget install Tiled.Tiled`)
- Python 3 (표준 라이브러리만 씀 — 별도 설치 불필요)

## 1. Tiled에서 맵 만들기

**New Map** → 아래 설정 (1920×1080 배경에 딱 맞음)

| 항목 | 값 |
|---|---|
| Orientation | Orthogonal |
| Tile render order | Right Down |
| Map size | **80 × 45** (타일 개수) |
| Tile size | **24 × 24 px** |
| Infinite | 체크 해제 |

저장: `maps/맵이름.tmx` (배경 PNG와 **같은 폴더**에)

### 레이어 구성 (이 이름 그대로)

1. 자동 생성된 **Tile Layer 1 삭제**
2. **Layer → New → Image Layer** → 이름 `background` → 배경 PNG 지정 → **자물쇠로 잠금**
3. 아래 Object Layer들을 순서대로 추가 (Layers 패널 우클릭 → New → Object Layer)

| 레이어 | 내용 | 도구 |
|---|---|---|
| `play_bounds` | 플레이 영역 1개. 이름 `main_play_area`, **x70 / y80 / w1780 / h656** | R |
| `walkable` | 걸어도 되는 바닥. **실내 전체를 크게 1장**으로 잡아도 됨(가구는 collision으로 뺌) | R |
| `collision` | 통과 불가: 책상·기계·못 들어가는 방 | R |
| `spawn` | player 및 NPC 자리 — **Name 필수** (이게 자리 ID) | I (점) |
| `interaction` | (선택) 접수대·장비 등 상호작용 위치. Name 필수 | I 또는 R |
| `npc_paths` | (선택) NPC 순찰 경로 | P (점 찍고 Enter) |

> ⚠️ **그리기 전에 대상 레이어가 선택돼 있는지 확인** (제일 흔한 실수)

### 요령

- **벽 윤곽을 정밀하게 따지 말 것.** 책상+의자+화분은 **큰 사각형 하나**로 뭉뚱그린다.
- **못 들어가는 방은 통째로 하나의 상자**로 막는다.
- **들어가야 하는 방**은 방 안 가구만 막고 **문 위치에 틈을 남긴다** (안 그러면 못 들어감).
- 대충 그린 뒤 **S**로 선택해 Properties의 X/Y/W/H에 정확한 숫자를 넣으면 깔끔.
- spawn 점의 **Name이 곧 자리 ID** (`player`, `teamjang`, `sasu`, `bujang` …). 시나리오에서 이 ID로 NPC를 연결한다.

## 2. 변환 (저장한 뒤 명령 한 줄)

```bash
python tools/map-geometry/tiled-to-geometry.py maps/맵이름.tmx
```

같은 폴더에 3개가 생긴다.

| 파일 | 용도 |
|---|---|
| `geometry.json` | **좌표 원본** (게임이 읽는 데이터) |
| `review.csv` | 엑셀로 열어 표로 검수 |
| `debug-overlay.html` | 브라우저로 열면 배경 위에 좌표가 색깔로 표시 |
| `playtest.html` | **직접 움직여보는 플레이 테스트** |

- `play_bounds`를 안 그리면 공통 프리셋이 자동 적용된다.
- `walkable`을 안 그리면 플레이 영역 전체가 걷는 곳이 된다(전체 개방 + collision으로 빼기 방식).

## 3. 검수 — `playtest.html`

브라우저로 열고 **WASD/방향키**로 직접 돌아다녀 본다.

- 책상·벽에서 **막히는지**, 통로가 **뚫려 있는지**
- 들어가야 하는 방에 **들어가지는지**
- NPC 자리 근처에서 **대화 힌트가 뜨는지**
- **G** 키 → 걷는 곳(초록)/막힌 곳(빨강) 표시 토글

체크리스트

- [ ] 플레이어가 어딘가에 **갇히지 않는가**
- [ ] 모든 NPC 자리에 **접근 가능한가**
- [ ] NPC 자리가 **가구 위에 얹혀 있지 않은가**
- [ ] 못 가야 할 방에 **안 들어가지는가**

## 4. 커밋

`.tmx`(원본)와 `geometry.json`을 커밋한다. 배경 PNG는 용량이 크니 팀 규칙에 따른다.
