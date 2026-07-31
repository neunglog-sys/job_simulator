# 미니게임 밝은 카툰 배경 v2

기존 `cartoon-v1` 44장을 편집 대상으로 사용해 구도와 게임 배치 영역은 유지하고, 조명과 색감만 밝은 주간 팔레트로 변경한 세트다.

## 파일 규격

- 경로: `apps/web/public/assets/minigames/backgrounds/cartoon-bright-v2/`
- 이름: `<미니게임 ID>-background-cartoon-bright-v2.webp`
- 수량: 44개
- 해상도: `1920×880`
- 형식: WebP, 품질 92
- 원본 보존: 기존 `cartoon-v1` 세트는 변경하지 않음

## 최종 편집 프롬프트

> Use case: lighting-weather. Asset type: 2D cartoon minigame environment background. Input image: edit target. Change only the lighting, atmosphere, and color palette from a dark nighttime navy scene to a bright cheerful daytime scene. Preserve the exact camera angle, geometry, object positions, framing, room layout, gameplay sockets, blank panels, paths, clear placement zones, and all negative space. Keep the same original hand-drawn 2D cel-shaded cartoon rendering with clean dark outlines and rounded readable shapes. Use high-key daylight, pale sky blue, warm cream, soft mint, light coral and sunny yellow accents, gentle soft shadows, clear midtones, and strong gameplay readability. Avoid deep navy dominance, crushed blacks, gloomy mood, neon nightclub lighting, haze, new props, removed props, characters, animals, text, letters, numbers, logos, UI, checkmarks, X marks, answer hints, pixel art, or watermarks. Do not redesign the composition.

## 검수 결과

- 44개 미니게임 ID와 44개 WebP 파일이 1:1 대응한다.
- 모든 파일이 `1920×880`으로 정상 디코딩된다.
- YAML에 좌표가 있는 9개 게임의 116개 좌표 객체를 배경 위에 오버레이해 여백과 배치 구도를 재확인했다.
- 전체 평균 명도는 기존 세트 약 `45.27/255`에서 밝은 세트 약 `200.04/255`로 상승했다.
- 44개 모두 기존 이미지보다 밝으며, 가장 작은 명도 상승폭도 약 `+107.26`이다.
- 배경에는 캐릭터, 텍스트, UI, 정답 체크/X를 추가하지 않았다.

## 대상 ID

`cln-01`, `gm-01`, `hr-01`, `jm-01`, `jm-02`, `jm-03`, `jm-04`, `jm-05`, `kts-01`, `kts-02`, `kts-03`, `kts-04`, `kts-05`, `ms-01`, `ms-02`, `ms-03`, `ms-04`, `ms-05`, `ms-06`, `ms-07`, `ms-08`, `ms-09`, `ms-10`, `sns-01`, `stn-01`, `stn-02`, `stn-03`, `stn-04`, `stn-05`, `wh-01`, `yg-01`, `yg-02`, `yg-03`, `yg-04`, `ys-01`, `ys-02`, `ys-03`, `ys-04`, `ys-05`, `ys-06`, `ys-07`, `ys-08`, `ys-09`, `ys-10`
