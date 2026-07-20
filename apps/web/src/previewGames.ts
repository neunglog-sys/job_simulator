// 미니게임 미리보기 데이터 — data/minigames/*.yaml 에서 자동 변환 (도트 아트 검수용).
// 재생성: 이 파일을 만든 스크립트를 다시 돌리면 됨. 실게임은 백엔드가 내려주는 정의를 쓴다.
import type { MinigameDef } from "./components/scenario/minigames/types";

export const PREVIEW_GAMES = {
  "gm-01": {
    "engine": "sort",
    "title": "대성패키징 입고 검수",
    "intro": "컨베이어로 내려오는 박스를 발주서 실루엣과 대조하세요. 파손·수침·수량 이상 박스는 격리존으로, 정상 박스만 합격 팔레트로 보냅니다. 손상 박스는 격리 전에 사진 촬영으로 증빙을 남기세요.",
    "time_limit": 75,
    "pass_score": 70,
    "data": {
      "presentation": "conveyor",
      "bins": [
        {
          "id": "합격_팔레트",
          "label": "합격 · 입고 등록",
          "sprite": "팔레트_초록"
        },
        {
          "id": "격리존",
          "label": "격리 · 보류 식별표",
          "sprite": "팔레트_빨강_보류"
        }
      ],
      "order_sheet": {
        "label": "발주서",
        "bin": "합격_팔레트",
        "slots": [
          {
            "sprite": "포장박스_정상",
            "count": 4
          }
        ]
      },
      "equivalent": [
        "박스_정상_1",
        "박스_정상_2",
        "박스_정상_3",
        "박스_정상_4",
        "박스_수량초과"
      ],
      "items": [
        {
          "id": "박스_정상_1",
          "sprite": "포장박스_정상",
          "bin": "합격_팔레트"
        },
        {
          "id": "박스_정상_2",
          "sprite": "포장박스_정상",
          "bin": "합격_팔레트"
        },
        {
          "id": "박스_정상_3",
          "sprite": "포장박스_정상",
          "bin": "합격_팔레트"
        },
        {
          "id": "박스_정상_4",
          "sprite": "포장박스_정상",
          "bin": "합격_팔레트"
        },
        {
          "id": "박스_수량초과",
          "forbidden_bin": "합격_팔레트",
          "sprite": "포장박스_정상",
          "bin": "격리존"
        },
        {
          "id": "박스_수침_1",
          "forbidden_bin": "합격_팔레트",
          "sprite": "포장박스_모퉁이젖음",
          "bin": "격리존"
        },
        {
          "id": "박스_수침_2",
          "forbidden_bin": "합격_팔레트",
          "sprite": "포장박스_모퉁이젖음",
          "bin": "격리존"
        },
        {
          "id": "박스_찌그러짐_1",
          "forbidden_bin": "합격_팔레트",
          "sprite": "포장박스_찌그러짐",
          "bin": "격리존"
        },
        {
          "id": "박스_찌그러짐_2",
          "forbidden_bin": "합격_팔레트",
          "sprite": "포장박스_찌그러짐",
          "bin": "격리존"
        },
        {
          "id": "박스_규격이상",
          "forbidden_bin": "합격_팔레트",
          "sprite": "포장박스_다른규격",
          "bin": "격리존",
          "scale": 1.3
        }
      ],
      "escalate": {
        "label": "사진 촬영 후 보류",
        "when": [
          "박스_수침_1",
          "박스_수침_2",
          "박스_찌그러짐_1",
          "박스_찌그러짐_2"
        ],
        "note": "손상 박스는 임의 폐기·정상 등록 없이 사진 증빙 후 식별표 부착·격리(원문 answer_guide ②③)"
      }
    },
    "scoring": {
      "item_count": 10,
      "wrong_bin_penalty": 12,
      "forbidden_penalty": 40,
      "escalate_mode": "병행필수",
      "missed_escalate_penalty": 20
    }
  },
  "ys-03": {
    "engine": "match",
    "title": "정문 검색대 출입통제",
    "intro": "입장객 얼굴과 출입증 초상을 선으로 이으세요. 짝이 없는 쪽은 '불일치' 도장, 탐지기가 울린 사람은 직접 손대지 말고 2차 검색 벨을 누르세요.",
    "time_limit": 75,
    "pass_score": 70,
    "data": {
      "left": [
        {
          "id": "입장객_A",
          "sprite": "입장객_얼굴_A"
        },
        {
          "id": "입장객_B",
          "sprite": "입장객_얼굴_B"
        },
        {
          "id": "입장객_C",
          "sprite": "입장객_얼굴_C"
        },
        {
          "id": "입장객_D",
          "sprite": "입장객_얼굴_D"
        },
        {
          "id": "입장객_E",
          "sprite": "입장객_얼굴_E",
          "detector": true
        }
      ],
      "right": [
        {
          "id": "출입증_A",
          "sprite": "출입증_초상_A"
        },
        {
          "id": "출입증_B",
          "sprite": "출입증_초상_B"
        },
        {
          "id": "출입증_C",
          "sprite": "출입증_초상_C"
        },
        {
          "id": "출입증_D",
          "sprite": "출입증_초상_미상"
        },
        {
          "id": "출입증_E",
          "sprite": "출입증_초상_E"
        }
      ],
      "pairs": [
        [
          "입장객_A",
          "출입증_A"
        ],
        [
          "입장객_B",
          "출입증_B"
        ],
        [
          "입장객_C",
          "출입증_C"
        ]
      ],
      "unmatched": [
        "입장객_D",
        "출입증_D"
      ],
      "escalate": {
        "label": "2차 검색 벨 (선임 호출)",
        "when": "입장객_E"
      },
      "forbidden": [
        {
          "id": "직접_신체수색",
          "reason": "신입의 직접 신체수색은 금지 — 선임에게 2차 검색 요청"
        },
        {
          "id": "그냥_통과",
          "reason": "탐지기 반응자를 조치 없이 통과시키면 안 됨"
        }
      ]
    },
    "scoring": {
      "decision_count": 6,
      "wrong_pair_penalty": 15,
      "forbidden_penalty": 40,
      "missed_escalate_penalty": 40
    }
  },
  "ms-03": {
    "engine": "place",
    "title": "회의실 세팅",
    "intro": "색 배지로 짝지어진 참석자와 그 자료를 좌석 배치도에 배치하세요. 금색 의자가 상석입니다. 시간 안에 끝내세요.",
    "time_limit": 90,
    "pass_score": 70,
    "data": {
      "slots": [
        {
          "id": "상석_금색의자",
          "marker": "금색_의자",
          "accepts": "진행자_금배지",
          "at": [
            480,
            58
          ]
        },
        {
          "id": "좌석_좌1",
          "marker": "명패_빨강",
          "accepts": "참석자_빨강",
          "at": [
            268,
            212
          ]
        },
        {
          "id": "좌석_좌2",
          "marker": "명패_파랑",
          "accepts": "참석자_파랑",
          "at": [
            268,
            340
          ]
        },
        {
          "id": "좌석_우1",
          "marker": "명패_초록",
          "accepts": "참석자_초록",
          "at": [
            692,
            212
          ]
        },
        {
          "id": "좌석_우2",
          "marker": "명패_노랑",
          "accepts": "참석자_노랑",
          "at": [
            692,
            340
          ]
        },
        {
          "id": "거치대_상석",
          "accepts": "자료_금배지_최신",
          "at": [
            480,
            144
          ]
        },
        {
          "id": "거치대_좌1",
          "accepts": "자료_빨강_최신",
          "at": [
            408,
            212
          ]
        },
        {
          "id": "거치대_좌2",
          "accepts": "자료_파랑_최신",
          "at": [
            408,
            340
          ]
        },
        {
          "id": "거치대_우1",
          "accepts": "자료_초록_최신",
          "at": [
            552,
            212
          ]
        },
        {
          "id": "거치대_우2",
          "accepts": "자료_노랑_최신",
          "at": [
            552,
            340
          ]
        }
      ],
      "pieces": [
        "진행자_금배지",
        "참석자_빨강",
        "참석자_파랑",
        "참석자_초록",
        "참석자_노랑",
        "자료_금배지_최신",
        "자료_빨강_최신",
        "자료_파랑_최신",
        "자료_초록_최신",
        "자료_노랑_최신",
        "자료_파랑_구버전",
        "자료_초록_구버전",
        "참석자_회색_불참",
        "배너_행사용"
      ],
      "visual_cues": {
        "자료_파랑_구버전": "빛바랜_종이_모서리접힘_취소선스탬프",
        "자료_초록_구버전": "빛바랜_종이_모서리접힘_취소선스탬프",
        "자료_파랑_최신": "흰_종이_파란클립",
        "자료_초록_최신": "흰_종이_파란클립"
      },
      "extras": [
        "자료_파랑_구버전",
        "자료_초록_구버전",
        "참석자_회색_불참",
        "배너_행사용"
      ]
    },
    "scoring": {
      "slot_count": 10,
      "extra_penalty": 10
    }
  },
  "ys-04": {
    "engine": "gauge",
    "title": "출동 전 공기호흡기 점검",
    "intro": "공기호흡기 눈금판의 바늘이 녹색 구간에 있으면 적재칸으로, 녹색을 벗어났으면 재충전대로 보내세요. 숫자는 없습니다. 색으로 판단하세요.",
    "time_limit": 60,
    "pass_score": 70,
    "data": {
      "ok_zone": [
        90,
        100
      ],
      "gauges": [
        {
          "id": "공기호흡기_1",
          "sprite": "공기호흡기_본체",
          "value": 96,
          "verdict": "pass",
          "action": "적재칸"
        },
        {
          "id": "공기호흡기_2",
          "sprite": "공기호흡기_본체",
          "value": 91,
          "verdict": "pass",
          "action": "적재칸"
        },
        {
          "id": "공기호흡기_3",
          "sprite": "공기호흡기_본체",
          "value": 88,
          "verdict": "fail",
          "action": "재충전대"
        },
        {
          "id": "공기호흡기_4",
          "sprite": "공기호흡기_본체",
          "value": 72,
          "verdict": "fail",
          "action": "재충전대"
        },
        {
          "id": "공기호흡기_5",
          "sprite": "공기호흡기_본체",
          "value": 34,
          "verdict": "fail",
          "action": "재충전대"
        }
      ],
      "escalate": {
        "label": "사용 불가 표시 + 반장에게 교체 보고",
        "sprite": "무전기_보고",
        "when": "미달_장비_발생"
      },
      "forbidden": [
        {
          "id": "미달장비_적재",
          "reason": "녹색 미달 장비를 적재칸에 실으면 안 됨 — 현장에서 잔압이 먼저 떨어진다"
        },
        {
          "id": "보고_생략",
          "reason": "미달 장비를 재충전대에만 두고 반장 보고를 빼면 교체가 안 됨"
        }
      ]
    },
    "scoring": {
      "decision_count": 6,
      "misjudge_penalty": 15,
      "escalate_required": true,
      "escalate_missed_penalty": 15
    }
  },
  "jm-01": {
    "engine": "route",
    "title": "3구역 배송 루트",
    "intro": "출발 전 노선도와 기상 안내를 확인하고, 배송지를 순서대로 이어 경로를 계획하세요. 제출하면 실제 주행이 시작됩니다 — 방향키로 장애물을 피하고 서행 구간을 지키세요.",
    "time_limit": 90,
    "pass_score": 70,
    "data": {
      "map": "3구역_노선도",
      "start": {
        "id": "영업소_차고",
        "at": [
          480,
          400
        ],
        "label": "3구역 영업소 · 출차",
        "sprite": "배송트럭_톱다운"
      },
      "waypoints": [
        {
          "id": "배송지_1",
          "at": [
            360,
            330
          ],
          "label": "1번지 · 일반 배송",
          "sprite": "배송지_건물"
        },
        {
          "id": "배송지_2",
          "at": [
            620,
            300
          ],
          "label": "2번지 · 일반 배송",
          "sprite": "배송지_건물"
        },
        {
          "id": "배송지_파손주의",
          "at": [
            300,
            240
          ],
          "label": "3번지 · 파손주의 물품 — 상단 경량 적재 확인",
          "fragile": true,
          "sprite": "배송지_파손주의"
        },
        {
          "id": "배송지_4",
          "at": [
            660,
            200
          ],
          "label": "4번지 · 일반 배송",
          "sprite": "배송지_건물"
        },
        {
          "id": "도착_종점",
          "at": [
            480,
            90
          ],
          "label": "종점 · 하차 완료",
          "arrival": true,
          "sprite": "종점_창고"
        }
      ],
      "avoid": [
        {
          "zone": "어린이보호구역",
          "at": [
            480,
            250
          ],
          "radius": 90,
          "penalty": 40,
          "reason": "보호구역 지름길·통과는 금지행동 — 민원 압박에도 상위 배치 금지",
          "visible": true,
          "sprite": "어린이보호구역_표지"
        },
        {
          "zone": "호우_시야불량구간",
          "at": [
            700,
            260
          ],
          "radius": 60,
          "penalty": 10,
          "reason": "호우로 시야 불량 — 서행·우회, 과속 만회 금지"
        }
      ],
      "shortcut_trap": {
        "id": "보호구역_지름길",
        "through": "어린이보호구역",
        "note": "시간은 벌지만 규정 위반·감점"
      },
      "budget": {
        "time": 90
      },
      "weather_pool": [
        {
          "id": "맑음",
          "notice": "기상 특이사항 없음"
        },
        {
          "id": "호우",
          "effect": "서행",
          "notice": "호우로 시야 불량 — 전 구간 서행"
        },
        {
          "id": "안개",
          "effect": "서행",
          "notice": "짙은 안개 — 시야 확보 어려움",
          "서행": null
        }
      ],
      "driving": {
        "duration": 24,
        "obstacle_density": 0.5,
        "obstacles": [
          "장애물_차량",
          "물웅덩이",
          "장애물_라바콘"
        ],
        "slow_zones": [
          {
            "id": "어린이보호구역",
            "from": 0.3,
            "to": 0.52,
            "penalty": 40,
            "sprite": "어린이보호구역_표지",
            "reason": "보호구역 과속·무정차 통과는 금지행동"
          },
          {
            "id": "시야불량구간",
            "from": 0.64,
            "to": 0.84,
            "penalty": 10,
            "when_effect": "서행",
            "reason": "시야 불량 — 서행 의무",
            "과속 만회 금지": null
          }
        ]
      }
    },
    "scoring": {
      "waypoint_count": 5,
      "order_matters": true,
      "collision_penalty": 8
    }
  },
  "ms-10": {
    "engine": "sequence",
    "title": "트렌치 기초 시공",
    "intro": "어질러진 자재를 트렌치의 맞는 자리에 순서대로 깐 뒤 마감 타일로 덮으세요. 매립할 것을 먼저, 마감은 맨 끝입니다. 순서를 틀리면 재작업입니다.",
    "time_limit": 90,
    "pass_score": 70,
    "data": {
      "steps": [
        {
          "id": "선행공정_확인",
          "sprite": "트렌치_굴착완료",
          "at": [
            150,
            88
          ],
          "zone": "확인_표지판",
          "label": "선행공정(트렌치 굴착) 완료 확인"
        },
        {
          "id": "배관_안착",
          "sprite": "배관_자재",
          "fit": "트렌치_바닥_큰반원홈",
          "at": [
            480,
            368
          ],
          "zone": "바닥_큰_홈",
          "label": "배관을 트렌치 바닥 홈에 안착"
        },
        {
          "id": "전선관_배선",
          "sprite": "전선관_자재",
          "fit": "배관위_클립받침",
          "at": [
            480,
            288
          ],
          "zone": "배관_위_받침",
          "label": "전선관을 위 받침대에 배선"
        },
        {
          "id": "간섭점_표시",
          "sprite": "간섭점_마킹",
          "at": [
            620,
            330
          ],
          "zone": "교차_지점",
          "label": "배관·전선 교차 간섭점 표시"
        },
        {
          "id": "되메움_고정",
          "sprite": "되메움_모래",
          "at": [
            480,
            208
          ],
          "zone": "되메움_구역",
          "label": "되메움으로 자재 고정"
        },
        {
          "id": "마감타일_덮기",
          "sprite": "마감_타일",
          "at": [
            480,
            140
          ],
          "zone": "표면_마감_구역",
          "label": "마감 타일로 덮기 (맨 끝)"
        }
      ],
      "forbidden": [
        {
          "id": "미확인배관_천공",
          "sprite": "미확인_배관",
          "at": [
            340,
            248
          ],
          "reason": "미확인 배관 위 임의 천공 — sudden_quest는 '작업중지·접근통제'가 정답"
        },
        {
          "id": "구두지시_임의배치",
          "sprite": "구두지시_메모",
          "at": [
            835,
            90
          ],
          "reason": "변경도면 없이 구두지시대로 배치 — 2스텝 warning (임의 반영 금지)"
        }
      ]
    },
    "scoring": {
      "wrong_order_fail": true,
      "forbidden_penalty": 40,
      "step_count": 6
    }
  },
  "ms-07": {
    "engine": "physics",
    "title": "재료 전처리 리듬",
    "intro": "도마 위로 내려오는 재료를 판정선에서 스페이스로 다듬으세요. 상한 재료는 치지 말고, 재료가 바뀌는 지점에서는 Shift로 칼과 도마를 교체하세요.",
    "time_limit": 60,
    "pass_score": 70,
    "data": {
      "mode": "rhythm",
      "bpm": 100,
      "hit_window": 0.12,
      "judge_marker": "판정선_칼날",
      "lanes": [
        {
          "id": "도마",
          "label": "전처리 도마"
        }
      ],
      "beats": [
        {
          "at": 1.5,
          "key": "space",
          "type": "wash",
          "sprite": "손세정_소독",
          "label": "작업 전 손 위생"
        },
        {
          "at": 3.0,
          "key": "space",
          "type": "cut",
          "sprite": "재료_당근"
        },
        {
          "at": 3.5,
          "key": "space",
          "type": "cut",
          "sprite": "재료_당근"
        },
        {
          "at": 4.0,
          "key": "space",
          "type": "cut",
          "sprite": "재료_당근"
        },
        {
          "at": 4.5,
          "key": "space",
          "type": "cut",
          "sprite": "재료_당근"
        },
        {
          "at": 5.0,
          "key": "space",
          "type": "cut",
          "sprite": "재료_당근"
        },
        {
          "at": 5.5,
          "key": "space",
          "type": "cut",
          "sprite": "재료_당근"
        },
        {
          "at": 6.0,
          "key": "space",
          "type": "cut",
          "sprite": "재료_당근"
        },
        {
          "at": 6.5,
          "type": "avoid",
          "sprite": "재료_무름",
          "label": "신선도 불량"
        },
        {
          "at": 7.0,
          "key": "space",
          "type": "cut",
          "sprite": "재료_당근"
        },
        {
          "at": 7.5,
          "key": "space",
          "type": "cut",
          "sprite": "재료_당근"
        },
        {
          "at": 8.5,
          "key": "shift",
          "type": "swap",
          "sprite": "칼_도마_교체"
        },
        {
          "at": 10.0,
          "key": "space",
          "type": "cut",
          "sprite": "재료_양파"
        },
        {
          "at": 10.6,
          "key": "space",
          "type": "cut",
          "sprite": "재료_양파"
        },
        {
          "at": 11.2,
          "key": "space",
          "type": "cut",
          "sprite": "재료_양파"
        },
        {
          "at": 11.8,
          "type": "avoid",
          "sprite": "재료_기한경과",
          "label": "유통기한 경과"
        },
        {
          "at": 12.4,
          "key": "space",
          "type": "cut",
          "sprite": "재료_양파"
        },
        {
          "at": 13.0,
          "key": "space",
          "type": "cut",
          "sprite": "재료_양파"
        },
        {
          "at": 14.0,
          "key": "shift",
          "type": "swap",
          "sprite": "칼_도마_교체"
        },
        {
          "at": 15.5,
          "key": "space",
          "type": "cut",
          "sprite": "재료_감자"
        },
        {
          "at": 16.0,
          "key": "space",
          "type": "cut",
          "sprite": "재료_감자"
        },
        {
          "at": 16.5,
          "key": "space",
          "type": "cut",
          "sprite": "재료_감자"
        },
        {
          "at": 17.0,
          "key": "space",
          "type": "cut",
          "sprite": "재료_감자"
        },
        {
          "at": 17.5,
          "type": "avoid",
          "sprite": "재료_온도이탈",
          "label": "보관온도 이탈"
        },
        {
          "at": 18.0,
          "key": "space",
          "type": "cut",
          "sprite": "재료_감자"
        },
        {
          "at": 18.5,
          "key": "space",
          "type": "cut",
          "sprite": "재료_감자"
        },
        {
          "at": 19.0,
          "key": "space",
          "type": "cut",
          "sprite": "재료_감자"
        },
        {
          "at": 20.0,
          "key": "shift",
          "type": "swap",
          "sprite": "칼_도마_교체"
        },
        {
          "at": 21.5,
          "key": "space",
          "type": "cut",
          "sprite": "재료_마늘"
        },
        {
          "at": 22.2,
          "key": "space",
          "type": "cut",
          "sprite": "재료_마늘"
        },
        {
          "at": 22.9,
          "key": "space",
          "type": "cut",
          "sprite": "재료_마늘"
        },
        {
          "at": 23.6,
          "type": "avoid",
          "sprite": "재료_이물혼입",
          "label": "이물 혼입"
        },
        {
          "at": 24.2,
          "key": "space",
          "type": "cut",
          "sprite": "재료_마늘"
        },
        {
          "at": 24.8,
          "key": "space",
          "type": "cut",
          "sprite": "재료_마늘"
        }
      ]
    },
    "scoring": {
      "hit_count": 30,
      "miss_penalty": 4,
      "spoiled_hit_penalty": 12,
      "swap_miss_penalty": 15,
      "overcut_penalty": 6,
      "fail": [
        {
          "when": "손위생_생략",
          "reason": "손 위생 노트를 놓치고 칼을 잡음 — 모범답안 ①번 위반이라 즉시 실패"
        },
        {
          "when": "상한재료_3회",
          "reason": "상한 재료를 3회 이상 손질 — 검수 자체가 성립하지 않음"
        }
      ]
    }
  },
  "ys-05": {
    "engine": "spot",
    "title": "현장 안전 순회점검",
    "intro": "3층 슬래브와 외부비계를 돌며 위험요소를 찾아 X로 표시하세요. 정상인 곳을 표시하면 감점입니다.",
    "time_limit": 60,
    "pass_score": 70,
    "data": {
      "scene": "건설현장_3층슬래브_외부비계",
      "mark": "x",
      "targets": [
        {
          "id": "개구부_덮개없음",
          "sprite": "슬래브_개구부_뚫림",
          "at": [
            286,
            214
          ],
          "size": 92,
          "label": "덮개 없는 개구부"
        },
        {
          "id": "개구부_덮개파손",
          "sprite": "슬래브_개구부_덮개깨짐",
          "at": [
            604,
            236
          ],
          "size": 92,
          "label": "개구부 덮개 파손"
        },
        {
          "id": "난간_미설치",
          "sprite": "비계_난간없음",
          "at": [
            832,
            178
          ],
          "size": 76,
          "label": "비계 단부 난간 미설치"
        },
        {
          "id": "안전대_미착용",
          "sprite": "작업자_안전대없음",
          "at": [
            418,
            330
          ],
          "size": 52,
          "label": "고소작업 중 안전대 미착용"
        },
        {
          "id": "안전모_미착용",
          "sprite": "작업자_맨머리",
          "at": [
            712,
            372
          ],
          "size": 52,
          "label": "안전모 미착용"
        },
        {
          "id": "가설전선_피복손상",
          "sprite": "가설전선_피복벗겨짐_물웅덩이",
          "at": [
            166,
            288
          ],
          "size": 104,
          "label": "가설전선 피복 손상 — 물웅덩이 위 배선"
        }
      ],
      "decoys": [
        {
          "id": "개구부_정상",
          "sprite": "슬래브_개구부_덮개정상",
          "at": [
            520,
            196
          ],
          "size": 92
        },
        {
          "id": "난간_정상",
          "sprite": "비계_난간설치",
          "at": [
            900,
            250
          ],
          "size": 76
        },
        {
          "id": "안전모_착용",
          "sprite": "작업자_안전모착용",
          "at": [
            244,
            356
          ],
          "size": 52
        },
        {
          "id": "소화기_비치",
          "sprite": "소화기_정위치",
          "at": [
            120,
            402
          ],
          "size": 44
        }
      ]
    },
    "scoring": {
      "target_count": 6,
      "decoy_penalty": 10
    }
  },
  "ms-06": {
    "engine": "pour",
    "title": "개체별 정량 급이",
    "intro": "구유마다 표시선 높이가 다릅니다. 눌러서 붓고, 선에 맞춰 손을 떼세요. 넘치면 사료가 흩어집니다.",
    "time_limit": 75,
    "pass_score": 70,
    "data": {
      "trough_sprite": "구유_나무",
      "pour_sprite": "사료포대_삽",
      "vessels": [
        {
          "id": "1번축사_성체",
          "label": "1번 축사 · 성체 6두",
          "target": 0.78,
          "tolerance": 0.06,
          "sprite": "가축_성체"
        },
        {
          "id": "2번축사_어린개체",
          "label": "2번 축사 · 어린 개체 12두",
          "target": 0.4,
          "tolerance": 0.05,
          "sprite": "가축_어린개체",
          "scale": 1.3
        },
        {
          "id": "3번축사_임신개체",
          "label": "3번 축사 · 임신 개체 2두",
          "target": 0.62,
          "tolerance": 0.05,
          "sprite": "가축_임신개체"
        },
        {
          "id": "4번축사_회복개체",
          "label": "4번 축사 · 회복 중 1두",
          "target": 0.25,
          "tolerance": 0.04,
          "sprite": "가축_회복개체"
        }
      ]
    },
    "scoring": {
      "over_penalty": 12,
      "under_penalty": 8
    }
  },
  "ms-09": {
    "engine": "trace",
    "title": "기준 확인 후 정밀 시험절삭",
    "intro": "도면·최신 검사기준서·보호구·장비 상태 확인을 모두 마친 뒤 수행하는 시험절삭입니다. 절삭 경로를 따라가며 양옆 색 밴드인 공차 안에 머무르세요. 밴드를 벗어나면 즉시 작업을 멈추고 보고해야 합니다.",
    "time_limit": 75,
    "pass_score": 70,
    "data": {
      "guide": "절삭_경로_최신본",
      "tolerance": 9,
      "bands": [
        {
          "from": 0.0,
          "to": 0.3,
          "tolerance": 9,
          "color": "초록",
          "note": "직선 구간 · 여유 폭"
        },
        {
          "from": 0.3,
          "to": 0.55,
          "tolerance": 5,
          "color": "초록",
          "note": "곡선 진입 · 폭 좁아짐"
        },
        {
          "from": 0.55,
          "to": 0.78,
          "tolerance": 3,
          "color": "노랑",
          "note": "정밀 구간 · 공차 최소"
        },
        {
          "from": 0.78,
          "to": 1.0,
          "tolerance": 6,
          "color": "초록",
          "note": "마무리 직선"
        }
      ],
      "sparks": [
        {
          "at": 0.42,
          "reason": "이음부 근처 — 이탈 시 스파크"
        }
      ],
      "emergency": {
        "at": 0.66,
        "signal": "균열라인_연기_아이콘",
        "action": "작업중지_보고_버튼",
        "resume_after_report": true
      },
      "no_go": [
        {
          "from": 0.55,
          "to": 0.78,
          "reason": "구버전 경로가 겹쳐 보임 — 최신본만 따라갈 것",
          "offset": 12
        }
      ],
      "head": "절삭헤드_커터",
      "spark_sprite": "스파크_이펙트"
    },
    "scoring": {
      "off_track_penalty": 10,
      "spark_penalty": 15,
      "no_go_penalty": 20,
      "incomplete_penalty": 12,
      "fail": [
        {
          "when": "정밀구간_전면이탈",
          "reason": "노랑 정밀 구간(0.55~0.78)을 밴드 밖으로 완전히 이탈 — 절삭 불량, 재검 대상이라 즉시 실패"
        },
        {
          "when": "돌발신호_무시_지속",
          "reason": "균열·연기 신호(0.66)를 무시하고 계속 절삭 — 원문 금지행동 '냄새를 무시하고 작업 지속', 즉시 실패"
        }
      ]
    }
  },
  "backend-dev-day1": {
    "engine": "typing",
    "title": "알림 발송 예외 처리",
    "intro": "막아야 할 예외 조건이 위에서 내려옵니다. 정확히 입력해 걸러내세요. 스펙에 없는 줄은 입력하면 안 됩니다.",
    "time_limit": 90,
    "pass_score": 70,
    "data": {
      "fall_seconds": 9,
      "presentation": "dev_desk",
      "lines": [
        {
          "id": "dup",
          "text": "if already_sent(user, notice): skip()",
          "label": "같은 사용자에게 중복 발송 차단"
        },
        {
          "id": "optout",
          "text": "if user.opted_out: skip()",
          "label": "수신거부 사용자 제외"
        },
        {
          "id": "night",
          "text": "if is_night(now): hold_until_morning()",
          "label": "야간 시간대 발송 보류"
        },
        {
          "id": "log",
          "text": "log_skipped(user, reason)",
          "label": "걸러진 건을 사유와 함께 기록"
        }
      ],
      "distractors": [
        {
          "id": "force",
          "text": "send_all(users)",
          "reason": "조건 확인 없이 전체 발송부터 시도"
        },
        {
          "id": "retry",
          "text": "cancel_after_send()",
          "reason": "일단 보내고 문제 생기면 취소하는 방식"
        }
      ]
    },
    "scoring": {
      "line_count": 4,
      "critical_lines": [
        "dup",
        "optout",
        "night"
      ],
      "missed_critical_penalty": 40,
      "distractor_penalty": 40,
      "count_speed": false
    }
  }
} as unknown as Record<string, MinigameDef>;
