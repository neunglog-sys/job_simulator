# 미니게임 카툰 배경 v1

`data/minigames/*.yaml` 44개와 대응하는 `data/scenarios/*.yaml` 44개를 기준으로 만든 배경 후보 목록이다. 모든 배경은 게임의 논리 캔버스 `960×440`과 같은 비율인 `1920×880` WebP로 통일했다.

## 공통 아트 프롬프트

> 독창적인 손그림 2D 셀 셰이딩 카툰 배경. 굵고 깨끗한 어두운 외곽선, 둥글고 읽기 쉬운 실루엣, 네이비·틸 야간 팔레트와 따뜻한 앰버 작업등, 은은한 코믹 질감, 친근한 소셜 파티게임 분위기. 24:11 와이드 게임 배경. 캐릭터·동물·글자·숫자·로고·UI·체크·X·정답 단서·픽셀아트는 넣지 않는다. 별도 렌더되는 카드·아이콘·스프라이트·경로·게이지가 올라갈 영역은 대비와 디테일을 낮춘다.

각 게임에는 아래 구도를 추가했고, `at: [x, y]`, `radius`, 경로·슬롯·타깃 정의가 있는 게임은 `960×440` 좌표를 그대로 프롬프트의 빈 공간 설계에 반영했다.

## 배경 파일 목록

| ID | 엔진 | 미니게임 | 배경 구도 | 파일 |
|---|---|---|---|---|
| cln-01 | place | 805호 정비 상태 검수·보완 | 침대·책상·빈 타월장·세면대·미니바를 실제 슬롯 좌표에 분할 | `cln-01-background-cartoon-v1.webp` |
| gm-01 | sort | 대성패키징 입고 검수 | 중앙 빈 검수대와 좌우 분류 팔레트 | `gm-01-background-cartoon-v1.webp` |
| hr-01 | place | 기술 면접실 셋업 러시 | 좌측 3개 면접관석·중앙 발표대·우측 대기실/복도 | `hr-01-background-cartoon-v1.webp` |
| jm-01 | route | 3구역 배송 루트 | 야간 물류도시 탑다운 도로망 | `jm-01-background-cartoon-v1.webp` |
| jm-02 | physics | 운전명령 적용 주행 실습 | 운전 시뮬레이터 전면 궤도/도로 | `jm-02-background-cartoon-v1.webp` |
| jm-03 | spot | 출발 전 외부점검 | 계류장 여객기 측면 점검 구도 | `jm-03-background-cartoon-v1.webp` |
| jm-04 | route | 항로 회피 재설정 | 야간 해상 항로 지도 | `jm-04-background-cartoon-v1.webp` |
| jm-05 | physics | 크레인 양중 실습 | 빈 양중 구역과 크레인 프레임 | `jm-05-background-cartoon-v1.webp` |
| kts-01 | sort | 대기 환자 트리아지 | 병원 로비의 중앙 접수대와 분리 대기구역 | `kts-01-background-cartoon-v1.webp` |
| kts-02 | match | 레벨·금기 매칭 | 코칭 스튜디오의 빈 매칭 매트 | `kts-02-background-cartoon-v1.webp` |
| kts-03 | match | 니즈-상품 추천 매칭 | 매장 상담대와 진열 배경 | `kts-03-background-cartoon-v1.webp` |
| kts-04 | sort | 창구 대기열 배정 | 은행 창구와 빈 대기 동선 | `kts-04-background-cartoon-v1.webp` |
| kts-05 | match | 여권 대조 체크인 | 공항 체크인 카운터 | `kts-05-background-cartoon-v1.webp` |
| ms-01 | sort | 증거 분류함 | 포렌식 작업실의 중앙 빈 증거대 | `ms-01-background-cartoon-v1.webp` |
| ms-02 | match | 장부 대사 | 회계 사무실의 두 개 빈 장부 매트 | `ms-02-background-cartoon-v1.webp` |
| ms-03 | place | 회의실 세팅 | 원형 회의 테이블과 좌석 슬롯 | `ms-03-background-cartoon-v1.webp` |
| ms-04 | sort | 출고 배차 퍼즐 | 물류 배차장의 빈 중앙 플랫폼 | `ms-04-background-cartoon-v1.webp` |
| ms-05 | spot | 불량 골라내기 | 제품 스프라이트가 올라갈 빈 컨베이어 | `ms-05-background-cartoon-v1.webp` |
| ms-06 | pour | 개체별 정량 급이 | 사육 시설의 빈 급이 칸 | `ms-06-background-cartoon-v1.webp` |
| ms-07 | physics | 재료 전처리 리듬 | 조리 전처리대와 빈 작업 보드 | `ms-07-background-cartoon-v1.webp` |
| ms-08 | trace | 커트 가이드라인 선긋기 | 미용 거울과 비어 있는 중앙 작업면 | `ms-08-background-cartoon-v1.webp` |
| ms-09 | trace | 기준 확인 후 정밀 시험절삭 | 선반 장비와 비어 있는 절삭 구간 | `ms-09-background-cartoon-v1.webp` |
| ms-10 | sequence | 트렌치 기초 시공 | 순서 오브젝트가 올라갈 빈 굴착 구역 | `ms-10-background-cartoon-v1.webp` |
| sns-01 | spot | 카드뉴스 시각 결함 검수 | 5개 빈 카드뉴스 패널 | `sns-01-background-cartoon-v1.webp` |
| stn-01 | match | 타깃 취향과 시안 맞추기 | 2개 빈 시안 보드와 낮은 대비의 스튜디오 | `stn-01-background-cartoon-v1.webp` |
| stn-02 | route | 전시 관람 동선 설계 | 탑다운 전시장 섬과 통로 | `stn-02-background-cartoon-v1.webp` |
| stn-03 | match | 매출·CRM 데이터 파이프 조인 | 데이터 운영실의 빈 중앙 작업영역 | `stn-03-background-cartoon-v1.webp` |
| stn-04 | match | 실험 조건·결과 대조 | 연구실의 좌우 빈 실험대 | `stn-04-background-cartoon-v1.webp` |
| stn-05 | place | 온보딩 퍼널 새는 구멍 막기 | 4개 퍼널 소켓이 있는 설비실 | `stn-05-background-cartoon-v1.webp` |
| wh-01 | sort | 바코드 색 분류 컨베이어 | 빈 물류 컨베이어와 분류 구역 | `wh-01-background-cartoon-v1.webp` |
| yg-01 | spot | 배너 시안 교정 스팟 | 3개 빈 배너 패널 | `yg-01-background-cartoon-v1.webp` |
| yg-02 | sort | 세공품 검수대 | 보석 감정 작업대 | `yg-02-background-cartoon-v1.webp` |
| yg-03 | typing | 배포 전 안전 점검 | 빈 개발 터미널 작업면 | `yg-03-background-cartoon-v1.webp` |
| yg-04 | route | 장애 구간 추적 | 서버실 네트워크 노드 벽 | `yg-04-background-cartoon-v1.webp` |
| ys-01 | place | 112 배차 관제 | 지도 모니터와 빈 배차 콘솔 | `ys-01-background-cartoon-v1.webp` |
| ys-02 | sequence | 야간 초소 수하 절차 | 야간 초소 관찰창과 절차 작업대 | `ys-02-background-cartoon-v1.webp` |
| ys-03 | match | 정문 검색대 출입통제 | 보안 검색 게이트와 빈 판독대 | `ys-03-background-cartoon-v1.webp` |
| ys-04 | gauge | 출동 전 공기호흡기 점검 | 4개 호흡기 거치대와 빈 게이지 영역 | `ys-04-background-cartoon-v1.webp` |
| ys-05 | spot | 현장 안전 순회점검 | 위험요소 스프라이트용 완전한 빈 슬래브와 정상 난간 | `ys-05-background-cartoon-v1.webp` |
| ys-06 | gauge | 회로별 절연저항 측정 | 6개 빈 회로 포트 | `ys-06-background-cartoon-v1.webp` |
| ys-07 | gauge | 규정 토크로 조이기 | 토크 대상이 올라갈 빈 작업대 | `ys-07-background-cartoon-v1.webp` |
| ys-08 | gauge | 계기판 순찰 | 계기 그룹별 빈 측정 소켓 | `ys-08-background-cartoon-v1.webp` |
| ys-09 | physics | 수평 트림 안정화 | 정비고 수평 지그와 빈 중앙 조작영역 | `ys-09-background-cartoon-v1.webp` |
| ys-10 | sequence | LOTO 확인 입회 | 설비 차단 패널과 잠금 작업 구역 | `ys-10-background-cartoon-v1.webp` |

## 배치 검수 규칙

- 좌표가 있는 9개 게임의 116개 `at` 객체를 배경 위에 오버레이해 배치 충돌을 확인했다.
- place/spot 배경에는 이동 아이템·캐릭터·결함·정답 마커를 굽지 않았다.
- sort/match/sequence/gauge/trace/physics 배경은 중앙 인터랙션 영역의 명암과 디테일을 낮췄다.
- 원본 배경 파일은 코드 연결 전 후보 자산이며, 기존 게임 로직·채점·스프라이트에는 변경을 가하지 않는다.
