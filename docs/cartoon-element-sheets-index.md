# 미니게임 카툰 요소 시트 인덱스

## 생성 범위

- 사용자 지정 범위 21개에 누락된 `gm-01`을 보완하여 총 22개 게임 시트를 생성했다.
- 각 시트의 요소 순서는 [미니게임 픽셀 요소 교체 인벤토리](./minigame-pixel-replacement-inventory.md)의 해당 게임 항목을 따른다.
- 읽는 순서: 왼쪽에서 오른쪽, 위에서 아래
- 형식: 1254×1254 투명 무손실 WebP
- 배경: 투명
- 용도: 개별 스프라이트의 원본 아트 시트 및 재가공 기준

## 공통 생성 프롬프트

> 게임 YAML과 픽셀 요소 교체 인벤토리에 기록된 요소를 각각 한 번씩, 왼쪽에서 오른쪽·위에서 아래 순서로 겹치지 않게 배치한다. 밝고 선명한 현대식 2D 직업 카툰, 굵고 깨끗한 어두운 외곽선, 절제된 셀 셰이딩, 작은 크기에서도 읽히는 실루엣을 사용한다. 텍스트·숫자·브랜드·로고·UI·워터마크를 넣지 않고, 문서 정보는 도형과 픽토그램으로 표현한다. 모든 요소는 완전히 보이고 충분한 재단 여백을 가진다. 평면 마젠타 크로마 배경에서 생성한 뒤 투명 무손실 WebP로 변환한다.

게임별 세부 피사체 프롬프트는 [미니게임 픽셀 요소 교체 인벤토리](./minigame-pixel-replacement-inventory.md)의 정확한 항목명과 상태 차이를 사용했다. 정상/불량 쌍은 같은 각도와 실루엣, 경로 게임은 톱다운 시점, 캐릭터/신분증 쌍은 같은 인물 정체성을 유지하도록 추가 제약했다.

## 결과 파일

| ID | 요소 수 | 결과 파일 |
|---|---:|---|
| cln-01 | 14 | `cln-01-cartoon-elements.webp` |
| gm-01 | 6 | `gm-01-cartoon-elements.webp` |
| hr-01 | 7 | `hr-01-cartoon-elements.webp` |
| jm-01 | 8 | `jm-01-cartoon-elements.webp` |
| jm-02 | 10 | `jm-02-cartoon-elements.webp` |
| jm-03 | 8 | `jm-03-cartoon-elements.webp` |
| jm-04 | 3 | `jm-04-cartoon-elements.webp` |
| jm-05 | 2 | `jm-05-cartoon-elements.webp` |
| kts-01 | 9 | `kts-01-cartoon-elements.webp` |
| kts-02 | 12 | `kts-02-cartoon-elements.webp` |
| kts-03 | 16 | `kts-03-cartoon-elements.webp` |
| kts-04 | 8 | `kts-04-cartoon-elements.webp` |
| kts-05 | 14 | `kts-05-cartoon-elements.webp` |
| ms-01 | 15 | `ms-01-cartoon-elements.webp` |
| ms-02 | 29 | `ms-02-cartoon-elements.webp` |
| ms-03 | 19 | `ms-03-cartoon-elements.webp` |
| ms-04 | 13 | `ms-04-cartoon-elements.webp` |
| ms-05 | 8 | `ms-05-cartoon-elements.webp` |
| ms-06 | 6 | `ms-06-cartoon-elements.webp` |
| ms-07 | 11 | `ms-07-cartoon-elements.webp` |
| ms-08 | 7 | `ms-08-cartoon-elements.webp` |
| ms-09 | 4 | `ms-09-cartoon-elements.webp` |

모든 결과 파일은 `apps/web/public/assets/minigames/cartoon-element-sheets`에 저장되어 있다.

## 게임 반영 상태

1. 22개 시트를 YAML의 기존 에셋 ID에 맞춰 228개의 512×512 투명 무손실 WebP로 분리했다.
2. 개별 WebP는 `apps/web/public/assets/minigames`에 저장되어 있으며, 분리·재생성은 `scripts/split_cartoon_element_sheets.py`로 반복할 수 있다.
3. 게임 로더는 같은 ID의 WebP를 먼저 사용하고, WebP가 없는 나머지 게임은 기존 SVG로 자동 대체한다.
4. YAML의 좌표·판정·점수·시간·조작법은 변경하지 않았다. 이미지의 시각 중심과 기존 상호작용 중심이 유지되도록 모든 WebP를 동일 캔버스에 정규화했다.
5. 정상/불량 및 캐릭터/신분증 짝은 같은 캔버스 크기와 기준점을 사용한다. 원본 시트는 아트 검수와 향후 재분리에 계속 사용한다.

## `assets_by_map` 추가 반영 (2026-07-22)

- `assets_by_map`에 전달된 21개 PNG 시트를 게임 YAML의 실제 자산 ID와 의미 기준으로 다시 분류했다.
- 대상: `ms-10`, `sns-01`, `stn-01`~`stn-05`, `wh-01`, `yg-01`, `yg-02`, `yg-04`, `ys-01`~`ys-10`.
- `yg-03`은 코드 타이핑 UI 게임으로 교체할 비트맵 요소가 없어 시트가 필요하지 않다.
- 시트의 체크무늬 배경은 외곽선 기반으로 제거하고, 이웃 요소 조각을 분리한 뒤 512×512 RGBA 무손실 WebP로 정규화했다.
- 배치 수는 161개이며 `무전기_보고` 공용 자산을 세 게임이 공유하므로 결과는 159개 고유 WebP다. 공용 대표 이미지는 가장 크게 그려진 `ys-04` 시트 버전이다.
- 일부 시트는 생성 과정에서 시각 순서가 바뀌거나 여분 요소가 포함되어 있어 단순 좌→우 순번 대신 의미를 확인해 명시적으로 매핑했다. 대표 사례는 `stn-01`, `stn-03`, `yg-02`, `ys-03`, `ys-05`, `ys-09`이다.
- 재분리 스크립트: `scripts/split_assets_by_map.py --force`
- 전체 원본 아트 시트는 `apps/web/public/assets/minigames/cartoon-element-sheets`에 보존되어 있으며, 전체 시트 수는 기존 22개와 추가 21개를 합쳐 43개다.
- 요소용 WebP가 없는 도면·검수대·상황판·씬 6종은 카툰 배경/장면 자산으로 관리되므로 이번 요소 시트 분리 대상에서 제외했다.
