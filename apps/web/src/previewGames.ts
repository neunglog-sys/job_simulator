// 미니게임 미리보기 데이터.
import type { MinigameDef } from "./components/scenario/minigames/types";
import { SNS_RESEARCH_PREVIEW_GAME } from "./data/snsResearchStages";
import { SNS_POST_DESIGN_PREVIEW_GAME } from "./data/snsPostDesignPuzzle";

export const PREVIEW_GAMES = {
  "cln-01": {
    "engine": "place",
    "title": "805호 정비 상태 검수·보완",
    "intro": "정비가 끝난 805호를 체크리스트와 대조하세요. 승인된 비품 누락과 가벼운 얼룩만 바로 보완하고, 고객 소지품처럼 임의로 만지면 안 되는 항목과 직접 처리할 수 없는 특이사항은 보고하세요.",
    "time_limit": 110,
    "pass_score": 70,
    "data": {
      "scene": "객실_805호_침실_욕실",
      "stains": [
        {
          "id": "시트_음료얼룩",
          "sprite": "침대시트_갈색얼룩",
          "at": [
            268,
            214
          ],
          "resolve": "교체"
        },
        {
          "id": "시트_이물질",
          "sprite": "침대시트_이물질",
          "at": [
            206,
            236
          ],
          "resolve": "문지르기"
        }
      ],
      "visual_cues": {
        "시트_음료얼룩": "넓게_배어든_갈색얼룩",
        "시트_이물질": "표면에_얹힌_부스러기",
        "컵_정상": "테두리_매끈",
        "컵_미세균열": "테두리_실금",
        "새_메모지": "깨끗한_새_메모지",
        "낙서된_메모지": "펜자국_남은_메모지",
        "세제통": "화학세제_통",
        "투숙객_소지품": "고객_개인_소지품",
        "새_시트": "교체용_새_시트"
      },
      "slots": [
        {
          "id": "욕실_타월대_1",
          "accepts": "타월_대",
          "at": [
            640,
            120
          ],
          "label": "욕실 선반 · 큰 타월"
        },
        {
          "id": "욕실_타월대_2",
          "accepts": "타월_대",
          "at": [
            700,
            120
          ],
          "label": "욕실 선반 · 큰 타월"
        },
        {
          "id": "욕실_타월중_1",
          "accepts": "타월_중",
          "at": [
            640,
            180
          ],
          "label": "욕실 선반 · 중간 타월"
        },
        {
          "id": "욕실_타월중_2",
          "accepts": "타월_중",
          "at": [
            700,
            180
          ],
          "label": "욕실 선반 · 중간 타월"
        },
        {
          "id": "욕실_타월소_1",
          "accepts": "타월_소",
          "at": [
            640,
            240
          ],
          "label": "욕실 선반 · 작은 타월"
        },
        {
          "id": "욕실_타월소_2",
          "accepts": "타월_소",
          "at": [
            700,
            240
          ],
          "label": "욕실 선반 · 작은 타월"
        },
        {
          "id": "욕실_컵_1",
          "accepts": "컵_정상",
          "at": [
            800,
            150
          ],
          "label": "세면대 · 컵"
        },
        {
          "id": "욕실_컵_2",
          "accepts": "컵_정상",
          "at": [
            852,
            150
          ],
          "label": "세면대 · 컵"
        },
        {
          "id": "미니바_생수_1",
          "accepts": "생수",
          "at": [
            800,
            330
          ],
          "label": "미니바 · 생수"
        },
        {
          "id": "미니바_생수_2",
          "accepts": "생수",
          "at": [
            852,
            330
          ],
          "label": "미니바 · 생수"
        },
        {
          "id": "데스크_메모지",
          "accepts": "새_메모지",
          "at": [
            420,
            350
          ],
          "label": "데스크 · 새 메모지"
        },
        {
          "id": "데스크_펜",
          "accepts": "펜",
          "at": [
            470,
            350
          ],
          "label": "데스크 · 펜"
        }
      ],
      "pieces": [
        "새_시트",
        "타월_대",
        "타월_대",
        "타월_중",
        "타월_중",
        "타월_소",
        "타월_소",
        "컵_정상",
        "컵_정상",
        "생수",
        "생수",
        "새_메모지",
        "펜",
        "낙서된_메모지",
        "컵_미세균열",
        "세제통",
        "투숙객_소지품"
      ],
      "extras": [
        {
          "id": "낙서된_메모지",
          "reason": "이전 투숙객의 흔적 — 새 메모지로 완전히 교체해야 한다"
        },
        {
          "id": "세제통",
          "reason": "청소용 화학 세제는 객실 어메니티와 구분해 카트에 둔다"
        }
      ],
      "forbidden": [
        {
          "id": "컵_미세균열",
          "reason": "파손품 비치 = 특이사항 묵인 — 비치가 아니라 보고 대상"
        },
        {
          "id": "투숙객_소지품",
          "reason": "고객 소지품 임의 취급 금지(원문 금지행동) — 보고 대상"
        }
      ],
      "escalate": {
        "label": "특이사항 보고",
        "when": [
          "컵_미세균열",
          "투숙객_소지품"
        ]
      }
    },
    "scoring": {
      "slot_count": 12,
      "stain_count": 2,
      "extra_penalty": 15,
      "forbidden_penalty": 40,
      "missed_escalate_penalty": 40,
      "escalate_mode": "대체",
      "wrong_slot_penalty": 5
    }
  },
  "gm-01": {
    "engine": "sort",
    "title": "대성패키징 입고 검수",
    "intro": "컨베이어로 내려오는 박스를 발주서 실루엣과 대조하세요. 파손·수침·수량 이상 박스는 격리존으로, 정상 박스만 합격 팔레트로 보냅니다. 손상 박스는 격리 전에 사진 촬영으로 증빙을 남기세요.",
    "time_limit": 75,
    "pass_score": 70,
    "data": {
      "presentation": "conveyor",
      "shuffle": true,
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
  "hr-01": {
    "engine": "place",
    "title": "기술 면접실 셋업 러시",
    "intro": "배치도 실루엣대로 면접관 좌석에 평가표·이력서를 세팅하고, 기기를 놓고, 대기실과 복도에 안내 표지판을 세우세요. 카트엔 자리에 두면 안 되는 물건이 섞여 있습니다 — 자리가 없는 물건은 보안 담당 보고 버튼으로.",
    "time_limit": 80,
    "pass_score": 70,
    "data": {
      "scene": "hr-01-background-cartoon-day-v3.webp",
      "slots": [
        {
          "id": "면접관석A_평가표",
          "accepts": "평가표",
          "at": [
            200,
            150
          ],
          "label": "면접관 A석 · 평가표"
        },
        {
          "id": "면접관석A_이력서",
          "accepts": "이력서묶음",
          "at": [
            250,
            150
          ],
          "label": "면접관 A석 · 이력서"
        },
        {
          "id": "면접관석B_평가표",
          "accepts": "평가표",
          "at": [
            200,
            250
          ],
          "label": "면접관 B석 · 평가표"
        },
        {
          "id": "면접관석B_이력서",
          "accepts": "이력서묶음",
          "at": [
            250,
            250
          ],
          "label": "면접관 B석 · 이력서"
        },
        {
          "id": "면접관석C_평가표",
          "accepts": "평가표",
          "at": [
            200,
            350
          ],
          "label": "면접관 C석 · 평가표"
        },
        {
          "id": "면접관석C_이력서",
          "accepts": "이력서묶음",
          "at": [
            250,
            350
          ],
          "label": "면접관 C석 · 이력서"
        },
        {
          "id": "기기_노트북",
          "accepts": "노트북",
          "at": [
            520,
            180
          ],
          "label": "AV 카트 상단 · 노트북"
        },
        {
          "id": "기기_빔프로젝터",
          "accepts": "빔프로젝터",
          "at": [
            520,
            260
          ],
          "label": "AV 카트 하단 · 빔프로젝터"
        },
        {
          "id": "대기실_안내",
          "accepts": "안내표지판",
          "at": [
            760,
            160
          ],
          "label": "대기실 · 안내 표지판"
        },
        {
          "id": "복도_안내",
          "accepts": "안내표지판",
          "at": [
            760,
            320
          ],
          "label": "복도 · 면접장 방향 표지판"
        }
      ],
      "pieces": [
        "평가표",
        "평가표",
        "평가표",
        "이력서묶음",
        "이력서묶음",
        "이력서묶음",
        "노트북",
        "빔프로젝터",
        "안내표지판",
        "안내표지판",
        "기출질문_목록",
        "지원자파일_공용사본"
      ],
      "visual_cues": {
        "평가표": "클립보드_빈_체크칸_격자양식",
        "이력서묶음": "밀봉_서류봉투_잠금띠지_증명사진칸",
        "기출질문_목록": "구겨진_손글씨쪽지_물음표낙서",
        "지원자파일_공용사본": "낱장_복사지_이중사본표시_흐트러진묶음"
      },
      "extras": [
        {
          "id": "기출질문_목록",
          "reason": "면접관 성향·기출 질문 유출 금지 — 지원자 대기실에도 두지 않는다"
        },
        {
          "id": "지원자파일_공용사본",
          "reason": "암호화 없이 오픈 공간에 두는 개인정보 서류는 보안 규정 위반"
        }
      ],
      "forbidden": [
        {
          "id": "이력서묶음",
          "slots": [
            "대기실_안내",
            "복도_안내"
          ],
          "reason": "개인정보 서류를 오픈 공간(대기실·복도)에 배치 — 보안 규정 위반"
        }
      ],
      "escalate": {
        "label": "보안 담당 보고",
        "when": [
          "기출질문_목록",
          "지원자파일_공용사본"
        ]
      }
    },
    "scoring": {
      "slot_count": 10,
      "forbidden_penalty": 40,
      "missed_escalate_penalty": 40,
      "escalate_mode": "대체",
      "wrong_slot_penalty": 10
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
  "jm-02": {
    "engine": "physics",
    "title": "운전명령 적용 주행 실습",
    "intro": "앞에서 확인한 운전명령과 점검 결과를 모의 운행에 적용합니다. 출발 전 제동시험부터 서행구간·건널목까지 표지와 신호에 맞춰 제동·가속·보고 타이밍을 맞추세요. 관제 승인 전에는 운행을 재개하면 안 됩니다.",
    "time_limit": 60,
    "pass_score": 70,
    "data": {
      "mode": "rhythm",
      "fall_speed": 1.1,
      "track": "102노선_주행뷰",
      "judge_marker": "판정선_열차",
      "beats": [
        {
          "at": 1.5,
          "key": "brake",
          "window": 0.5,
          "zone": "출발전_제동시험",
          "cue": "제동시험_표지",
          "action": "제동시험 체결",
          "sprite": "제동시험_표지",
          "label": "제동시험 체결"
        },
        {
          "at": 3.0,
          "key": "accel",
          "window": 0.5,
          "zone": "제동시험_완료_출발",
          "cue": "출발표지_녹",
          "action": "출발 가속",
          "sprite": "출발표지_녹",
          "label": "출발 가속"
        },
        {
          "at": 6.0,
          "key": "brake",
          "window": 0.5,
          "zone": "서행구간_A_진입",
          "cue": "서행표지_황",
          "action": "감속",
          "sprite": "서행표지_황",
          "label": "감속"
        },
        {
          "at": 8.0,
          "key": "accel",
          "window": 0.5,
          "zone": "서행구간_A_해제",
          "cue": "해제표지_녹",
          "action": "가속",
          "sprite": "해제표지_녹",
          "label": "가속"
        },
        {
          "at": 11.0,
          "key": "brake",
          "window": 0.5,
          "zone": "서행구간_B_진입",
          "cue": "서행표지_황",
          "action": "감속",
          "sprite": "서행표지_황",
          "label": "감속"
        },
        {
          "at": 13.0,
          "key": "accel",
          "window": 0.5,
          "zone": "서행구간_B_해제",
          "cue": "해제표지_녹",
          "action": "가속",
          "sprite": "해제표지_녹",
          "label": "가속"
        },
        {
          "at": 16.0,
          "key": "brake",
          "window": 0.4,
          "signal": "건널목_지장물",
          "cue": "건널목_경보",
          "action": "비상정차",
          "sprite": "건널목_경보",
          "label": "비상정차"
        },
        {
          "at": 17.5,
          "key": "report",
          "window": 0.8,
          "signal": "방호_보고",
          "cue": "방호버튼_점멸",
          "action": "열차방호 발신·관제 보고",
          "sprite": "방호버튼_점멸",
          "label": "열차방호 발신·관제 보고"
        },
        {
          "at": 20.0,
          "key": "accel",
          "window": 0.5,
          "signal": "관제_승인",
          "cue": "승인신호_녹",
          "action": "운행 재개",
          "sprite": "승인신호_녹",
          "label": "운행 재개"
        }
      ],
      "decoy_beats": [
        {
          "at": 4.5,
          "cue": "출발직후_정상주행",
          "note": "정상 주행 중 불필요한 급제동 금지",
          "sprite": "정상주행표지_녹",
          "label": "정상 주행"
        },
        {
          "at": 14.5,
          "cue": "정상구간",
          "note": "서행 해제 후 정상 구간 — 불필요한 제동 금지",
          "sprite": "정상주행표지_녹",
          "label": "정상 주행"
        }
      ],
      "fails": [
        {
          "when": "제동시험_누락",
          "reason": "제동시험 미완료 출발(출발 금지 규정 위반)"
        },
        {
          "when": "서행구간_A_제동_놓침",
          "reason": "서행구간 과속 진입"
        },
        {
          "when": "서행구간_B_제동_놓침",
          "reason": "서행구간 과속 진입"
        },
        {
          "when": "건널목_정차_놓침",
          "reason": "건널목 지장물 앞 비상정차 미이행"
        },
        {
          "when": "방호보고_누락",
          "reason": "열차방호 발신·관제 보고 누락"
        },
        {
          "when": "관제승인전_가속",
          "reason": "관제 승인 없이 운행 재개(원문 금지행동)"
        }
      ]
    },
    "scoring": {
      "beat_count": 9,
      "decoy_penalty": 20,
      "stray_input_penalty": 10
    }
  },
  "jm-03": {
    "engine": "spot",
    "title": "출발 전 외부점검(워크어라운드)",
    "intro": "주기된 기체를 둘러보며 외부점검 이상을 찾아 표시하세요. 정상인 곳을 표시하면 감점입니다.",
    "time_limit": 70,
    "pass_score": 70,
    "data": {
      "scene": "여객기_주기_외부점검",
      "mark": "tag",
      "targets": [
        {
          "id": "피토관_커버미제거",
          "sprite": "피토관_커버부착",
          "at": [
            150,
            200
          ],
          "size": 84,
          "label": "피토관 커버 미제거 상태"
        },
        {
          "id": "흡입구_이물질",
          "sprite": "엔진흡입구_이물질",
          "at": [
            430,
            300
          ],
          "size": 88,
          "label": "엔진 흡입구 이물질(FOD)"
        },
        {
          "id": "타이어_마모",
          "sprite": "타이어_마모",
          "at": [
            590,
            360
          ],
          "size": 64,
          "label": "타이어 마모 한계 초과"
        },
        {
          "id": "조종면_결빙",
          "sprite": "조종면_결빙",
          "at": [
            820,
            160
          ],
          "size": 96,
          "label": "조종면(날개 조절판) 결빙"
        }
      ],
      "decoys": [
        {
          "id": "피토관_정상",
          "sprite": "피토관_커버제거됨",
          "at": [
            250,
            150
          ],
          "size": 84
        },
        {
          "id": "흡입구_정상",
          "sprite": "엔진흡입구_청결",
          "at": [
            540,
            300
          ],
          "size": 88
        },
        {
          "id": "타이어_정상",
          "sprite": "타이어_정상",
          "at": [
            680,
            360
          ],
          "size": 64
        },
        {
          "id": "조종면_정상",
          "sprite": "조종면_결빙없음",
          "at": [
            760,
            220
          ],
          "size": 96
        }
      ]
    },
    "scoring": {
      "target_count": 4,
      "decoy_penalty": 10
    }
  },
  "jm-04": {
    "engine": "route",
    "title": "항로 회피 재설정",
    "intro": "초안 항로가 침선 위를 지나갑니다. 위험구역을 피해 변침점을 이어 항로 수정안을 그리고, 완성되면 보고로 제출하세요.",
    "time_limit": 90,
    "pass_score": 70,
    "data": {
      "map": "연안_해도",
      "start": {
        "id": "출항_변침점",
        "sprite": "운항선박_톱다운"
      },
      "waypoints": [
        {
          "id": "우회_변침점_A",
          "sprite": "변침점_부표"
        },
        {
          "id": "우회_변침점_B",
          "sprite": "변침점_부표"
        },
        {
          "id": "우회_변침점_C",
          "sprite": "변침점_부표"
        },
        {
          "id": "도착_정박지",
          "sprite": "정박지_부두"
        }
      ],
      "decoy_waypoints": [
        {
          "id": "초안_직선_변침점_1",
          "sprite": "변침점_부표",
          "note": "잇기 쉬워 보이지만 신설_침선 구역을 관통"
        },
        {
          "id": "초안_직선_변침점_2",
          "sprite": "변침점_부표",
          "note": "직선 회랑 위 — 준설공사구역을 관통"
        }
      ],
      "submit_as": "항로_수정안_보고",
      "avoid": [
        {
          "zone": "신설_침선",
          "penalty": 40,
          "radius": 80
        },
        {
          "zone": "준설공사구역",
          "penalty": 25,
          "radius": 72
        },
        {
          "zone": "등부표_구위치_주의구역",
          "penalty": 20,
          "radius": 66
        }
      ],
      "budget": {
        "time": 120,
        "time_over_penalty": 10
      }
    }
  },
  "jm-05": {
    "engine": "physics",
    "title": "안전조건 확인 후 크레인 양중 실습",
    "intro": "앞에서 점검한 크레인과 작업계획을 바탕으로, 허용 풍속의 모의 작업장에서 양중을 연습합니다. 흔들리는 화물을 수직으로 안정시킨 뒤 목표점에 천천히 내려놓으세요. 과속 착지나 측면 충돌은 실패입니다.",
    "time_limit": 60,
    "pass_score": 70,
    "data": {
      "mode": "balance",
      "target": 0.0,
      "drift": 0.3,
      "scene": "크레인_작업장_씬",
      "settle": {
        "target_zone": "착지_목표점",
        "tolerance": 0.1,
        "sway_fail": 0.6,
        "drop_fail": 0.5,
        "load_sprite": "양중_화물_철골",
        "zone_sprite": "착지_목표패드"
      }
    }
  },
  "kts-01": {
    "engine": "sort",
    "title": "대기 환자 트리아지",
    "intro": "대기 환자를 위험도에 맞는 진료실로 보내세요. 증상·소지품 아이콘을 기준표와 대조해 판단합니다. 소리가 큰 쪽이 급한 쪽은 아닙니다.",
    "time_limit": 75,
    "pass_score": 70,
    "data": {
      "bins": [
        {
          "id": "응급처치실",
          "label": "응급 처치",
          "color": "red",
          "icon": "심전도"
        },
        {
          "id": "예약진료실",
          "label": "예약 진료",
          "color": "yellow",
          "icon": "달력"
        },
        {
          "id": "접수대기석",
          "label": "당일 접수",
          "color": "green",
          "icon": "번호표"
        },
        {
          "id": "별도상담실",
          "label": "별도 상담",
          "color": "gray",
          "icon": "닫힌문"
        }
      ],
      "legend": [
        {
          "symptom": "가슴통증",
          "goes_to": "응급처치실"
        },
        {
          "symptom": "진료카드",
          "goes_to": "예약진료실"
        },
        {
          "symptom": "문진표",
          "goes_to": "접수대기석"
        }
      ],
      "items": [
        {
          "id": "환자_흉통",
          "sprite": "환자_가슴움켜쥠_식은땀",
          "icon": "가슴통증",
          "bin": "응급처치실",
          "priority": 1,
          "label": "조용히 앉아 있는 환자"
        },
        {
          "id": "환자_부축_보행보조",
          "sprite": "환자_부축_지팡이",
          "icon": "진료카드",
          "bin": "예약진료실",
          "priority": 2,
          "label": "부축받아 들어온 환자"
        },
        {
          "id": "환자_재진_1",
          "sprite": "환자_진료카드_보유",
          "icon": "진료카드",
          "bin": "예약진료실",
          "priority": 2,
          "label": "진료카드를 든 환자"
        },
        {
          "id": "환자_재진_2",
          "sprite": "환자_진료카드_보유",
          "icon": "진료카드",
          "bin": "예약진료실",
          "priority": 2,
          "label": "진료카드를 든 환자"
        },
        {
          "id": "환자_초진_1",
          "sprite": "환자_문진표_작성중",
          "icon": "문진표",
          "bin": "접수대기석",
          "priority": 3,
          "label": "문진표 작성 중인 환자"
        },
        {
          "id": "환자_초진_2",
          "sprite": "환자_문진표_공란",
          "icon": "문진표",
          "bin": "접수대기석",
          "priority": 3,
          "label": "문진표를 받아 든 환자"
        }
      ],
      "sudden": {
        "id": "환자_임현서_항의",
        "sprite": "환자_접수대막음_고성",
        "appears_after_seconds": 5,
        "label": "비급여 고지 누락 항의 — 접수대를 막고 고성",
        "freeze_queue": true,
        "must_resolve_sudden": true,
        "bin": "별도상담실",
        "forbidden_bins": [
          {
            "bin": "응급처치실",
            "reason": "고성은 응급 징후가 아니다 — 응급 자원 낭비"
          },
          {
            "bin": "접수대기석",
            "reason": "접수대에 세워둔 채 다른 환자 앞에서 수납내역 노출"
          },
          {
            "bin": "예약진료실",
            "reason": "진료가 아니라 민원 — 진료 대기열을 다시 막는다"
          }
        ],
        "stages": [
          {
            "id": "사실확인",
            "sprite": "접수기록_대조",
            "label": "경청·공감하며 접수 기록으로 고지 여부 확인"
          },
          {
            "id": "방안안내",
            "sprite": "사과_처리안내",
            "label": "누락이 확인되면 사과·처리 방안 안내"
          },
          {
            "id": "팀장인계",
            "sprite": "원무팀장_호출",
            "label": "권한 밖 감면 요구는 원무팀장 인계"
          }
        ],
        "persists_after_stages": true
      },
      "escalate": {
        "label": "보안요원 호출",
        "when": "업무방해_지속",
        "requires": [
          "사실확인",
          "방안안내",
          "팀장인계"
        ]
      }
    },
    "scoring": {
      "item_count": 6,
      "wrong_bin_penalty": 12,
      "missed_emergency_penalty": 25,
      "over_triage_penalty": 15,
      "forbidden_penalty": 40,
      "early_escalate_penalty": 40,
      "missed_escalate_penalty": 40,
      "stage_skip_penalty": 15,
      "ignore_sudden_penalty": 40
    }
  },
  "kts-02": {
    "engine": "match",
    "title": "레벨·금기 매칭",
    "intro": "회원마다 레벨(색)과 조심할 부위(아이콘)가 다릅니다. 레벨이 맞는 카드를 이어 주세요. 조심 부위가 있는 회원은 그 부위를 보호하는 대체 카드로. 고강도 카드는 잇지 말고 남겨 두세요.",
    "time_limit": 75,
    "pass_score": 70,
    "data": {
      "one_line_per_left": true,
      "left_label": "회원 명단",
      "right_label": "동작 카드",
      "left": [
        {
          "id": "회원_초급_A",
          "sprite": "회원_초급_제약없음",
          "level": "green",
          "caution": "none",
          "label": "초급 · 제약 없음"
        },
        {
          "id": "회원_초급_B",
          "sprite": "회원_초급_제약없음",
          "level": "green",
          "caution": "none",
          "label": "초급 · 제약 없음"
        },
        {
          "id": "회원_초급_E",
          "sprite": "회원_초급_무릎보호",
          "level": "green",
          "caution": "knee",
          "label": "초급 · 무릎 수술 이력"
        },
        {
          "id": "회원_중급_C",
          "sprite": "회원_중급_제약없음",
          "level": "blue",
          "caution": "none",
          "label": "중급 · 제약 없음"
        },
        {
          "id": "회원_중급_D",
          "sprite": "회원_중급_허리보호",
          "level": "blue",
          "caution": "back",
          "label": "중급 · 허리 통증 이력"
        },
        {
          "id": "회원_중급_F",
          "sprite": "회원_중급_제약없음",
          "level": "blue",
          "caution": "none",
          "label": "중급 · 제약 없음"
        }
      ],
      "right": [
        {
          "id": "카드_초급매트",
          "sprite": "동작_매트_기초",
          "level": "green",
          "load": "none",
          "label": "초급 매트 기초"
        },
        {
          "id": "카드_초급리포머",
          "sprite": "동작_리포머_기초",
          "level": "green",
          "load": "none",
          "label": "초급 리포머 기초"
        },
        {
          "id": "카드_저강도무릎",
          "sprite": "동작_대체_무릎보호",
          "level": "green",
          "load": "none",
          "label": "저강도 대체 · 무릎 부담 없음"
        },
        {
          "id": "카드_중급리포머",
          "sprite": "동작_리포머_중급",
          "level": "blue",
          "load": "none",
          "label": "중급 리포머"
        },
        {
          "id": "카드_중급대체허리",
          "sprite": "동작_대체_허리보호",
          "level": "blue",
          "load": "none",
          "label": "중급 대체 · 허리 부담 없음"
        },
        {
          "id": "카드_중급점프",
          "sprite": "동작_점프보드_중급",
          "level": "blue",
          "load": "none",
          "label": "중급 점프보드"
        },
        {
          "id": "카드_고강도점프",
          "sprite": "동작_점프보드_고강도",
          "level": "red",
          "load": "knee",
          "label": "고강도 점프보드 · 무릎 충격"
        },
        {
          "id": "카드_고강도후굴",
          "sprite": "동작_후굴_고강도",
          "level": "red",
          "load": "back",
          "label": "고강도 후굴 · 허리 부담"
        }
      ],
      "pairs": [
        [
          "회원_초급_A",
          "카드_초급매트"
        ],
        [
          "회원_초급_B",
          "카드_초급리포머"
        ],
        [
          "회원_초급_E",
          "카드_저강도무릎"
        ],
        [
          "회원_중급_C",
          "카드_중급리포머"
        ],
        [
          "회원_중급_D",
          "카드_중급대체허리"
        ],
        [
          "회원_중급_F",
          "카드_중급점프"
        ]
      ],
      "equivalent": [
        [
          "회원_초급_A",
          "회원_초급_B"
        ],
        [
          "회원_중급_C",
          "회원_중급_F"
        ]
      ],
      "unmatched": [
        "카드_고강도점프",
        "카드_고강도후굴"
      ],
      "forbidden_pairs": [
        {
          "left": "회원_초급_E",
          "right": "카드_고강도점프",
          "reason": "무릎 수술 이력에 고강도 점프는 금기"
        },
        {
          "left": "회원_중급_D",
          "right": "카드_고강도후굴",
          "reason": "허리 통증 이력에 고강도 후굴은 금기"
        },
        {
          "left": "회원_초급_A",
          "right": [
            "카드_중급리포머",
            "카드_중급대체허리",
            "카드_중급점프",
            "카드_고강도점프",
            "카드_고강도후굴"
          ],
          "reason": "초급에게 중급·고강도 배정 — 초급 방치·부상 위험"
        },
        {
          "left": "회원_초급_B",
          "right": [
            "카드_중급리포머",
            "카드_중급대체허리",
            "카드_중급점프",
            "카드_고강도점프",
            "카드_고강도후굴"
          ],
          "reason": "초급에게 중급·고강도 배정 — 초급 방치·부상 위험"
        },
        {
          "left": "회원_초급_E",
          "right": [
            "카드_중급리포머",
            "카드_중급대체허리",
            "카드_중급점프",
            "카드_고강도후굴"
          ],
          "reason": "초급에게 중급·고강도 배정 — 초급 방치·부상 위험"
        },
        {
          "left": "회원_중급_C",
          "right": [
            "카드_고강도점프",
            "카드_고강도후굴"
          ],
          "reason": "수업 레벨을 넘는 고강도 배정 — 부상 위험"
        },
        {
          "left": "회원_중급_D",
          "right": "카드_고강도점프",
          "reason": "수업 레벨을 넘는 고강도 배정 — 부상 위험"
        },
        {
          "left": "회원_중급_F",
          "right": [
            "카드_고강도점프",
            "카드_고강도후굴"
          ],
          "reason": "수업 레벨을 넘는 고강도 배정 — 부상 위험"
        }
      ]
    },
    "scoring": {
      "pair_count": 6,
      "wrong_pair_penalty": 12,
      "forbidden_penalty": 40
    }
  },
  "kts-03": {
    "engine": "match",
    "title": "니즈-상품 추천 매칭",
    "intro": "손님의 요구를 확인하고 오른쪽 진열대의 와인을 눌러 상품 정보를 살펴본 뒤 알맞은 와인을 추천하세요. 예산을 넘거나 품절된 와인은 추천하지 마세요.",
    "time_limit": 75,
    "pass_score": 70,
    "data": {
      "background_id": "kts-03",
      "presentation": "customer_floor",
      "supply_run": {
        "memory_seconds": 10,
        "order": [
          { "id": "레드", "label": "레드 와인", "display_label": "Red wine", "sprite": "와인_레드_중가", "target": 7, "at": [105, 64], "hit_at": [151, 114], "hit_size": [31, 63] },
          { "id": "화이트", "label": "화이트 와인", "display_label": "White wine", "sprite": "와인_화이트_저가", "target": 5, "at": [915, 194], "hit_at": [893, 280], "hit_size": [41, 80] },
          { "id": "스파클링", "label": "스파클링 와인", "display_label": "Sparkling wine", "sprite": "와인_스파클링_중가", "target": 3, "at": [769, 126], "hit_at": [811, 155], "hit_size": [21, 27] },
          { "id": "로제", "label": "로제 와인", "display_label": "Rose wine", "sprite": "와인_스위트_저가", "target": 1, "at": [646, 141], "hit_at": [671, 192], "hit_size": [27, 19] },
          { "id": "스위트", "label": "스위트 와인", "display_label": "Sweet wine", "sprite": "와인_스위트_저가", "target": 4, "at": [167, 231], "hit_at": [212, 254], "hit_size": [27, 37] }
        ],
        "transport": {
          "duration_seconds": 24,
          "overspeed_ticks": 12,
          "obstacles": [
            { "id": "직원_통로", "label": "이동 중인 직원", "sprite": "손님_갈색머리", "lane": 0, "at": 24 },
            { "id": "적치_상자", "label": "통로의 적치물", "sprite": "적치물_상자더미", "lane": 2, "at": 43 },
            { "id": "고객_횡단", "label": "지나가는 고객", "sprite": "손님_금발_안경", "lane": 1, "at": 61 },
            { "id": "작업_라바콘", "label": "작업 구역", "sprite": "장애물_라바콘", "lane": 0, "at": 79 },
            { "id": "진열_상자", "label": "진열 대기 상자", "sprite": "상자_별아이콘_도장별", "lane": 2, "at": 91 }
          ]
        }
      },
      "left_label": "손님 니즈",
      "right_label": "와인 진열",
      "left": [
        {
          "id": "니즈_승진축하",
          "sprite": "니즈_승진_레드선호",
          "customer_sprite": "손님_승진축하_카툰",
          "budget": "yellow",
          "occasion": "승진",
          "label": "승진 축하 · 중간 예산 · 레드 선호",
          "speech": "동료의 승진을 축하할 선물이에요. 부담스럽지 않은 레드 와인을 추천해 주세요."
        },
        {
          "id": "니즈_집들이",
          "sprite": "니즈_집들이_화이트",
          "customer_sprite": "손님_집들이_카툰",
          "budget": "green",
          "occasion": "집들이",
          "label": "집들이 · 낮은 예산 · 화이트",
          "speech": "친구 집들이에 가져갈 가벼운 화이트 와인을 찾고 있어요."
        },
        {
          "id": "니즈_부모님",
          "sprite": "니즈_부모님_레드",
          "customer_sprite": "손님_부모님선물_카툰",
          "budget": "red",
          "occasion": "자식",
          "label": "자식 선물 · 높은 예산 · 레드",
          "speech": "자식에게 줄 선물이라 품질 좋은 레드 와인을 원합니다."
        },
        {
          "id": "니즈_와인초보",
          "sprite": "니즈_초보_스위트",
          "customer_sprite": "손님_와인초보_카툰",
          "budget": "green",
          "occasion": "입문",
          "label": "와인 초보 · 낮은 예산 · 달달한 맛",
          "speech": "와인은 처음이라 저렴하고 달콤하게 마시기 쉬운 와인이 좋아요."
        },
        {
          "id": "니즈_기념일",
          "sprite": "니즈_기념일_스파클링",
          "customer_sprite": "손님_기념일_카툰",
          "budget": "yellow",
          "occasion": "기념일",
          "label": "기념일 · 중간 예산 · 스파클링",
          "foreign": true,
          "foreign_speech": "I need a sparkling wine for our anniversary. Something nice, but not too expensive.",
          "translated_speech": "기념일에 마실 스파클링 와인을 찾고 있어요. 너무 비싸지 않은 좋은 제품이면 좋겠습니다."
        }
      ],
      "right": [
        {
          "id": "상품_레드_중가",
          "sprite": "와인_레드_중가",
          "price": "yellow",
          "kind": "red",
          "tier": "house",
          "slot": 2,
          "accent": "#8A0447",
          "stock": "ok",
          "label": "레드 · 중간 가격"
        },
        {
          "id": "상품_화이트_저가",
          "sprite": "와인_화이트_저가",
          "price": "green",
          "kind": "white",
          "tier": "favorite",
          "slot": 2,
          "accent": "#0BD01F",
          "stock": "ok",
          "label": "화이트 · 저가"
        },
        {
          "id": "상품_레드_고가",
          "sprite": "와인_레드_고가",
          "price": "red",
          "kind": "red",
          "tier": "favorite",
          "slot": 1,
          "accent": "#8A0447",
          "stock": "ok",
          "label": "레드 · 고가"
        },
        {
          "id": "상품_스위트_저가",
          "sprite": "와인_스위트_저가",
          "price": "green",
          "kind": "sweet",
          "tier": "house",
          "slot": 1,
          "accent": "#FFF019",
          "stock": "ok",
          "label": "스위트 · 저가"
        },
        {
          "id": "상품_스파클링_중가",
          "sprite": "와인_스파클링_중가",
          "price": "yellow",
          "kind": "sparkling",
          "tier": "favorite",
          "slot": 3,
          "accent": "#C3FF8A",
          "stock": "ok",
          "label": "스파클링 · 중간 가격"
        },
        {
          "id": "상품_레드_프리미엄",
          "sprite": "와인_레드_프리미엄",
          "price": "red",
          "kind": "red",
          "tier": "premium",
          "slot": 1,
          "accent": "#9106A4",
          "stock": "ok",
          "label": "레드 · 프리미엄"
        },
        {
          "id": "상품_레드_품절",
          "sprite": "와인_레드_품절",
          "price": "yellow",
          "kind": "red",
          "tier": "premium",
          "slot": 2,
          "accent": "#8A0447",
          "stock": "soldout",
          "label": "레드 · 중간 가격"
        }
      ],
      "visual_cues": {
        "니즈_집들이": "가격표_1장",
        "니즈_와인초보": "가격표_1장",
        "니즈_승진축하": "가격표_2장",
        "니즈_기념일": "가격표_2장",
        "니즈_부모님": "가격표_3장",
        "상품_화이트_저가": "가격표_1장",
        "상품_스위트_저가": "가격표_1장",
        "상품_레드_중가": "가격표_2장",
        "상품_스파클링_중가": "가격표_2장",
        "상품_레드_품절": "가격표_2장_재고없음_빗금",
        "상품_레드_고가": "가격표_3장",
        "상품_레드_프리미엄": "가격표_4장_금박리본"
      },
      "pairs": [
        [
          "니즈_승진축하",
          "상품_레드_중가"
        ],
        [
          "니즈_집들이",
          "상품_화이트_저가"
        ],
        [
          "니즈_부모님",
          "상품_레드_고가"
        ],
        [
          "니즈_와인초보",
          "상품_스위트_저가"
        ],
        [
          "니즈_기념일",
          "상품_스파클링_중가"
        ]
      ],
      "unmatched": [
        "상품_레드_프리미엄",
        "상품_레드_품절"
      ],
      "forbidden_pairs": [
        {
          "left": "니즈_집들이",
          "right": "상품_레드_프리미엄",
          "reason": "저예산 손님에게 최고가 제시(예산 초과)"
        },
        {
          "left": "니즈_와인초보",
          "right": "상품_레드_프리미엄",
          "reason": "저예산 손님에게 최고가 제시(예산 초과)"
        },
        {
          "left": "니즈_부모님",
          "right": "상품_레드_프리미엄",
          "reason": "예산 초과 제시 — 가격표 4장 > 예산 3장(비싼 상품부터 제시)"
        },
        {
          "left": "니즈_승진축하",
          "right": "상품_레드_품절",
          "reason": "품절 상품 추천 — 재고 현황 미확인"
        }
      ],
      "sudden": {
        "id": "손님_오건우_환불",
        "sprite": "손님_개봉상품_고성",
        "appears_at": 7,
        "label": "영수증 없는 개봉 상품 환불 요구 · 고성",
        "stages": [
          {
            "id": "경청_사실확인",
            "sprite": "구매이력_조회",
            "label": "사실안내"
          },
          {
            "id": "규정안내",
            "sprite": "환불규정_안내",
            "label": "규정안내"
          },
          {
            "id": "대안제시",
            "sprite": "교환_적립_안내",
            "label": "확인제시"
          }
        ],
        "persists_after_stages": true,
        "forbidden_actions": [
          {
            "id": "맞대응_언쟁",
            "label": "언쟁",
            "reason": "언쟁으로 맞대응"
          },
          {
            "id": "규정밖_환불",
            "label": "환불",
            "reason": "조용히 시키려 규정 밖 환불 승인"
          }
        ]
      },
      "escalate": {
        "label": "호출",
        "when": "고성_지속",
        "requires": [
          "경청_사실확인",
          "규정안내",
          "대안제시"
        ]
      }
    },
    "scoring": {
      "pair_count": 5,
      "wrong_pair_penalty": 14,
      "forbidden_penalty": 40,
      "matched_unmatched_penalty": 15,
      "early_escalate_penalty": 0,
      "stage_skip_penalty": 15,
      "ignore_sudden_penalty": 40,
      "missed_escalate_penalty": 40
    }
  },
  "kts-04": {
    "engine": "sort",
    "title": "창구 대기열 배정",
    "intro": "마감 30분 전, 대기 손님을 처리 방식에 맞게 배정하세요. 시간 배지를 기준표와 대조해 판단합니다. 목소리 큰 순서도, 먼저 온 순서도 답이 아닐 수 있습니다.",
    "time_limit": 75,
    "pass_score": 70,
    "data": {
      "bins": [
        {
          "id": "지금처리",
          "label": "지금 처리",
          "color": "red",
          "icon": "번개"
        },
        {
          "id": "다음처리",
          "label": "다음 순서(단순)",
          "color": "green",
          "icon": "번호표"
        },
        {
          "id": "예약전환",
          "label": "예약 전환(장시간)",
          "color": "blue",
          "icon": "달력"
        },
        {
          "id": "순서안내석",
          "label": "순서 안내 후 대기",
          "color": "gray",
          "icon": "안내판"
        }
      ],
      "legend": [
        {
          "symptom": "모래시계",
          "goes_to": "지금처리"
        },
        {
          "symptom": "짧음",
          "goes_to": "다음처리"
        },
        {
          "symptom": "김",
          "goes_to": "예약전환"
        }
      ],
      "items": [
        {
          "id": "손님_증명서발급",
          "sprite": "손님_서류_한장",
          "icon": "증명서",
          "time_badge": "짧음",
          "bin": "다음처리",
          "priority": 2,
          "label": "증명서 발급 요청"
        },
        {
          "id": "손님_대출상담",
          "sprite": "손님_서류뭉치",
          "icon": "대출",
          "time_badge": "김",
          "bin": "예약전환",
          "priority": 3,
          "label": "대출 상담 요청"
        },
        {
          "id": "손님_통장재발급",
          "sprite": "손님_통장_재촉_큰소리",
          "icon": "통장",
          "time_badge": "짧음",
          "bin": "다음처리",
          "priority": 2,
          "label": "통장 재발급 요청"
        },
        {
          "id": "손님_종합상담",
          "sprite": "손님_상담희망",
          "icon": "상담",
          "time_badge": "김",
          "bin": "예약전환",
          "priority": 3,
          "label": "종합 자산 상담 요청"
        },
        {
          "id": "손님_송금컷오프",
          "sprite": "손님_조용_봉투",
          "icon": "송금",
          "time_badge": "모래시계",
          "bin": "지금처리",
          "priority": 1,
          "label": "송금 요청"
        }
      ],
      "sudden": {
        "id": "손님_조선우_새치기",
        "sprite": "손님_새치기_고성",
        "appears_after_seconds": 5,
        "label": "순서 무시 새치기 · 폭언",
        "freeze_queue": true,
        "must_resolve_sudden": true,
        "bin": "순서안내석",
        "forbidden_bins": [
          {
            "bin": "지금처리",
            "reason": "소란을 멈추려 순서를 바꿔 먼저 처리(원문 오답 b)"
          },
          {
            "bin": "다음처리",
            "reason": "대기 고객 양해 없이 순서를 앞당김"
          }
        ],
        "stages": [
          {
            "id": "원칙안내",
            "sprite": "번호표_절차안내",
            "label": "대기 순서 원칙·번호표 절차를 다시 안내"
          },
          {
            "id": "용건확인",
            "sprite": "용건_소요시간",
            "label": "용건·예상 소요시간 확인(짧으면 양해 구해 배정 검토)"
          }
        ],
        "persists_after_stages": true
      },
      "escalate": {
        "label": "선임·지점장 인계",
        "when": "업무방해_지속",
        "requires": [
          "원칙안내",
          "용건확인"
        ]
      }
    },
    "scoring": {
      "item_count": 5,
      "wrong_bin_penalty": 14,
      "missed_cutoff_penalty": 25,
      "forbidden_penalty": 40,
      "sudden_wrong_bin_penalty": 20,
      "early_escalate_penalty": 25,
      "missed_escalate_penalty": 40,
      "stage_skip_penalty": 15,
      "ignore_sudden_penalty": 40
    }
  },
  "kts-05": {
    "engine": "match",
    "title": "여권 대조 체크인",
    "intro": "손님과 여권 사진을 이어 본인 확인을 하세요. 안경·머리색·점 같은 굵은 특징으로 대조합니다. 같은 성이라도 사람이 다르면 잇지 마세요. 확인이 끝나면 맞는 색 객실 키가 전달됩니다.",
    "time_limit": 80,
    "pass_score": 70,
    "data": {
      "left_label": "체크인 손님",
      "right_label": "여권 사진",
      "left": [
        {
          "id": "손님_Kim_안경",
          "sprite": "손님_안경_흑발",
          "features": {
            "glasses": true,
            "hair": "black",
            "mole": "none",
            "hat": false
          },
          "label": "손님 A"
        },
        {
          "id": "손님_Kim_점",
          "sprite": "손님_흑발_오른뺨점",
          "features": {
            "glasses": false,
            "hair": "black",
            "mole": "right",
            "hat": false
          },
          "label": "손님 B"
        },
        {
          "id": "손님_Lee_갈색",
          "sprite": "손님_갈색머리",
          "features": {
            "glasses": false,
            "hair": "brown",
            "mole": "none",
            "hat": false
          },
          "label": "손님 C"
        },
        {
          "id": "손님_Park_모자",
          "sprite": "손님_모자_흑발",
          "features": {
            "glasses": false,
            "hair": "black",
            "mole": "none",
            "hat": true
          },
          "label": "손님 D"
        },
        {
          "id": "손님_Choi_금발",
          "sprite": "손님_금발_안경",
          "features": {
            "glasses": true,
            "hair": "blond",
            "mole": "none",
            "hat": false
          },
          "label": "손님 E"
        }
      ],
      "right": [
        {
          "id": "여권_안경흑발",
          "sprite": "여권_안경_흑발",
          "features": {
            "glasses": true,
            "hair": "black",
            "mole": "none",
            "hat": false
          },
          "label": "여권 1"
        },
        {
          "id": "여권_흑발점",
          "sprite": "여권_흑발_오른뺨점",
          "features": {
            "glasses": false,
            "hair": "black",
            "mole": "right",
            "hat": false
          },
          "label": "여권 2"
        },
        {
          "id": "여권_갈색",
          "sprite": "여권_갈색머리",
          "features": {
            "glasses": false,
            "hair": "brown",
            "mole": "none",
            "hat": false
          },
          "label": "여권 3"
        },
        {
          "id": "여권_흑발민머리",
          "sprite": "여권_흑발_모자없음",
          "features": {
            "glasses": false,
            "hair": "black",
            "mole": "none",
            "hat": false
          },
          "label": "여권 4"
        },
        {
          "id": "여권_금발안경",
          "sprite": "여권_금발_안경",
          "features": {
            "glasses": true,
            "hair": "blond",
            "mole": "none",
            "hat": false
          },
          "label": "여권 5"
        },
        {
          "id": "여권_흑발콧수염",
          "sprite": "여권_흑발_콧수염",
          "features": {
            "glasses": false,
            "hair": "black",
            "mole": "none",
            "hat": false,
            "beard": true
          },
          "label": "여권 6"
        }
      ],
      "pairs": [
        [
          "손님_Kim_안경",
          "여권_안경흑발"
        ],
        [
          "손님_Kim_점",
          "여권_흑발점"
        ],
        [
          "손님_Lee_갈색",
          "여권_갈색"
        ],
        [
          "손님_Park_모자",
          "여권_흑발민머리"
        ],
        [
          "손님_Choi_금발",
          "여권_금발안경"
        ]
      ],
      "unmatched": [
        "여권_흑발콧수염"
      ],
      "forbidden_pairs": [
        {
          "left": "손님_Kim_안경",
          "right": "여권_흑발점",
          "reason": "동일 성 오배정 — 점 특징 불일치"
        },
        {
          "left": "손님_Kim_점",
          "right": "여권_안경흑발",
          "reason": "동일 성 오배정 — 안경 특징 불일치"
        },
        {
          "left": "손님_Kim_안경",
          "right": "여권_흑발콧수염",
          "reason": "동일 성 오배정 — 미도착 예약에 배정"
        },
        {
          "left": "손님_Kim_점",
          "right": "여권_흑발콧수염",
          "reason": "동일 성 오배정 — 미도착 예약에 배정"
        },
        {
          "left": "손님_Park_모자",
          "right": "여권_흑발점",
          "reason": "검은 머리만 같고 점이 다른 오배정"
        }
      ],
      "keys": [
        {
          "guest": "손님_Kim_안경",
          "key_color": "blue",
          "label": "일반실 · 파란 키",
          "sprite": "객실키_파랑"
        },
        {
          "guest": "손님_Kim_점",
          "key_color": "blue",
          "label": "일반실 · 파란 키",
          "sprite": "객실키_파랑"
        },
        {
          "guest": "손님_Lee_갈색",
          "key_color": "green",
          "label": "일반실 · 초록 키",
          "sprite": "객실키_초록"
        },
        {
          "guest": "손님_Park_모자",
          "key_color": "green",
          "label": "일반실 · 초록 키",
          "sprite": "객실키_초록"
        },
        {
          "guest": "손님_Choi_금발",
          "key_color": "gold",
          "label": "VIP · 금색 키",
          "sprite": "객실키_금색"
        }
      ]
    },
    "scoring": {
      "pair_count": 5,
      "wrong_pair_penalty": 14,
      "forbidden_penalty": 40,
      "matched_unmatched_penalty": 15,
      "wrong_key_penalty": 10
    }
  },
  "ms-01": {
    "engine": "sort",
    "title": "증거 분류함",
    "intro": "문서 아이콘을 보고 맞는 캐비닛에 넣으세요. 리본 표식이 있는 계약서 원본은 원본 보관함, 라벨이 찢겨 유형을 알 수 없는 것은 보완요청함입니다.",
    "time_limit": 90,
    "pass_score": 70,
    "data": {
      "bins": [
        {
          "id": "계약서함",
          "label": "계약서",
          "sprite": "캐비닛_계약서"
        },
        {
          "id": "이메일함",
          "label": "이메일",
          "sprite": "캐비닛_이메일"
        },
        {
          "id": "접수메모함",
          "label": "접수메모",
          "sprite": "캐비닛_메모"
        },
        {
          "id": "원본_보관함",
          "label": "원본 보관(잠금)",
          "sprite": "캐비닛_원본잠금"
        },
        {
          "id": "보완요청함",
          "label": "보완 요청",
          "sprite": "보완요청_트레이"
        }
      ],
      "items": [
        {
          "id": "계약서_원본",
          "sprite": "문서_계약서아이콘",
          "bin": "계약서함"
        },
        {
          "id": "계약서_수정본",
          "sprite": "문서_계약서아이콘_수정본",
          "bin": "계약서함"
        },
        {
          "id": "이메일_1",
          "sprite": "문서_봉투아이콘",
          "bin": "이메일함"
        },
        {
          "id": "이메일_2",
          "sprite": "문서_봉투아이콘",
          "bin": "이메일함"
        },
        {
          "id": "이메일_3",
          "sprite": "문서_봉투아이콘",
          "bin": "이메일함"
        },
        {
          "id": "접수메모",
          "sprite": "문서_메모지아이콘",
          "bin": "접수메모함"
        },
        {
          "id": "계약서_원본",
          "sprite": "문서_계약서아이콘_빨간리본",
          "bin": "원본_보관함"
        },
        {
          "id": "계약서_수정본",
          "sprite": "문서_계약서아이콘_리본없음",
          "bin": "계약서함"
        },
        {
          "id": "기록물_라벨찢김",
          "sprite": "문서_라벨찢김",
          "bin": "보완요청함"
        },
        {
          "id": "이관기록물_빈칸",
          "sprite": "문서_라벨빈칸",
          "bin": "보완요청함"
        },
        {
          "id": "이관기록물_중복",
          "sprite": "문서_겹친아이콘",
          "bin": "보완요청함"
        },
        {
          "id": "개인정보_포함_발송문서",
          "sprite": "문서_발송대기_개인정보도장",
          "escalate": true
        }
      ],
      "escalate": {
        "label": "발송 보류·승인 요청",
        "when": "개인정보_포함_발송문서"
      }
    },
    "scoring": {
      "item_count": 12,
      "wrong_bin_penalty": 8,
      "missed_escalate_penalty": 15
    }
  },
  "ms-02": {
    "engine": "match",
    "title": "장부 대사",
    "intro": "왼쪽 카드전표와 오른쪽 영수증을 도장이 같은 것끼리 이으세요. 도장은 모양과 색이 모두 같아야 한 짝입니다. 짝이 없는 전표에는 누락 도장을 찍으세요.",
    "time_limit": 120,
    "pass_score": 70,
    "data": {
      "left_label": "카드전표",
      "right_label": "영수증",
      "left": [
        {
          "id": "전표_원형파랑",
          "sprite": "카드전표_원형_파랑"
        },
        {
          "id": "전표_원형초록",
          "sprite": "카드전표_원형_초록"
        },
        {
          "id": "전표_원형주황",
          "sprite": "카드전표_원형_주황"
        },
        {
          "id": "전표_원형보라",
          "sprite": "카드전표_원형_보라"
        },
        {
          "id": "전표_사각파랑",
          "sprite": "카드전표_사각_파랑"
        },
        {
          "id": "전표_사각초록",
          "sprite": "카드전표_사각_초록"
        },
        {
          "id": "전표_사각주황",
          "sprite": "카드전표_사각_주황"
        },
        {
          "id": "전표_사각보라",
          "sprite": "카드전표_사각_보라"
        },
        {
          "id": "전표_삼각파랑",
          "sprite": "카드전표_삼각_파랑"
        },
        {
          "id": "전표_삼각초록",
          "sprite": "카드전표_삼각_초록"
        },
        {
          "id": "전표_삼각주황",
          "sprite": "카드전표_삼각_주황"
        },
        {
          "id": "전표_삼각보라",
          "sprite": "카드전표_삼각_보라"
        },
        {
          "id": "전표_육각파랑",
          "sprite": "카드전표_육각_파랑"
        },
        {
          "id": "전표_육각초록",
          "sprite": "카드전표_육각_초록"
        },
        {
          "id": "전표_육각주황",
          "sprite": "카드전표_육각_주황"
        }
      ],
      "right": [
        {
          "id": "영수증_원형파랑",
          "sprite": "영수증_원형_파랑"
        },
        {
          "id": "영수증_원형초록",
          "sprite": "영수증_원형_초록"
        },
        {
          "id": "영수증_원형주황",
          "sprite": "영수증_원형_주황"
        },
        {
          "id": "영수증_원형보라",
          "sprite": "영수증_원형_보라"
        },
        {
          "id": "영수증_사각파랑",
          "sprite": "영수증_사각_파랑"
        },
        {
          "id": "영수증_사각주황",
          "sprite": "영수증_사각_주황"
        },
        {
          "id": "영수증_사각보라",
          "sprite": "영수증_사각_보라"
        },
        {
          "id": "영수증_삼각파랑",
          "sprite": "영수증_삼각_파랑"
        },
        {
          "id": "영수증_삼각초록",
          "sprite": "영수증_삼각_초록"
        },
        {
          "id": "영수증_삼각주황",
          "sprite": "영수증_삼각_주황"
        },
        {
          "id": "영수증_삼각보라",
          "sprite": "영수증_삼각_보라"
        },
        {
          "id": "영수증_육각파랑",
          "sprite": "영수증_육각_파랑"
        },
        {
          "id": "영수증_육각초록",
          "sprite": "영수증_육각_초록"
        },
        {
          "id": "영수증_육각주황",
          "sprite": "영수증_육각_주황"
        }
      ],
      "pairs": [
        [
          "전표_원형파랑",
          "영수증_원형파랑"
        ],
        [
          "전표_원형초록",
          "영수증_원형초록"
        ],
        [
          "전표_원형주황",
          "영수증_원형주황"
        ],
        [
          "전표_원형보라",
          "영수증_원형보라"
        ],
        [
          "전표_사각파랑",
          "영수증_사각파랑"
        ],
        [
          "전표_사각주황",
          "영수증_사각주황"
        ],
        [
          "전표_사각보라",
          "영수증_사각보라"
        ],
        [
          "전표_삼각파랑",
          "영수증_삼각파랑"
        ],
        [
          "전표_삼각초록",
          "영수증_삼각초록"
        ],
        [
          "전표_삼각주황",
          "영수증_삼각주황"
        ],
        [
          "전표_삼각보라",
          "영수증_삼각보라"
        ],
        [
          "전표_육각파랑",
          "영수증_육각파랑"
        ],
        [
          "전표_육각초록",
          "영수증_육각초록"
        ],
        [
          "전표_육각주황",
          "영수증_육각주황"
        ]
      ],
      "unmatched": [
        "전표_사각초록"
      ]
    },
    "scoring": {
      "pair_count": 14,
      "unmatched_count": 1,
      "wrong_pair_penalty": 7
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
  "ms-04": {
    "engine": "sort",
    "title": "출고 배차 퍼즐",
    "intro": "목적지 아이콘이 같은 트럭 짐칸에 화물을 실으세요. 서류 도장과 아이콘이 어긋나거나 짐칸을 넘치는 상자는 보류 팔레트로 보내세요.",
    "time_limit": 90,
    "pass_score": 70,
    "data": {
      "bins": [
        {
          "id": "트럭_별",
          "label": "별 목적지",
          "sprite": "배차트럭_별"
        },
        {
          "id": "트럭_달",
          "label": "달 목적지",
          "sprite": "배차트럭_달"
        },
        {
          "id": "트럭_해",
          "label": "해 목적지",
          "sprite": "배차트럭_해"
        },
        {
          "id": "트럭_산",
          "label": "산 목적지",
          "sprite": "배차트럭_산"
        },
        {
          "id": "보류팔레트",
          "label": "보류",
          "sprite": "팔레트_빨강_보류"
        }
      ],
      "items": [
        {
          "id": "화물_별1",
          "sprite": "상자_별아이콘_도장별",
          "bin": "트럭_별"
        },
        {
          "id": "화물_별2",
          "sprite": "상자_별아이콘_도장별",
          "bin": "트럭_별"
        },
        {
          "id": "화물_달1",
          "sprite": "상자_달아이콘_도장달",
          "bin": "트럭_달"
        },
        {
          "id": "화물_달2",
          "sprite": "상자_달아이콘_도장달",
          "bin": "트럭_달"
        },
        {
          "id": "화물_해1",
          "sprite": "상자_해아이콘_도장해",
          "bin": "트럭_해"
        },
        {
          "id": "화물_산1",
          "sprite": "상자_산아이콘_도장산",
          "bin": "트럭_산"
        },
        {
          "id": "화물_불일치1",
          "sprite": "상자_별아이콘_도장달",
          "bin": "보류팔레트"
        },
        {
          "id": "화물_불일치2",
          "sprite": "상자_해아이콘_도장산",
          "bin": "보류팔레트"
        },
        {
          "id": "화물_초과",
          "sprite": "상자_별아이콘_초대형",
          "bin": "보류팔레트",
          "scale": 1.35
        },
        {
          "id": "화물_세관보류",
          "sprite": "상자_세관도장_확인요청",
          "escalate": true
        }
      ],
      "escalate": {
        "label": "출고보류·전문담당자 호출",
        "when": "화물_세관보류"
      }
    },
    "scoring": {
      "item_count": 10,
      "wrong_bin_penalty": 9,
      "missed_escalate_penalty": 15,
      "customs_to_hold_penalty": 5
    }
  },
  "ms-05": {
    "engine": "spot",
    "title": "불량 골라내기",
    "intro": "컨베이어를 지나는 제품 중 균열·변색·찌그러진 것과 품질 도장이 없는 로트를 집어 격리함으로 보내세요. 정상 제품을 집으면 감점입니다.",
    "time_limit": 45,
    "pass_score": 70,
    "data": {
      "scene": "생산라인_컨베이어벨트",
      "mark": "tag",
      "targets": [
        {
          "id": "제품_균열1",
          "sprite": "제품_균열",
          "at": [
            150,
            210
          ],
          "size": 64,
          "label": "표면 균열"
        },
        {
          "id": "제품_균열2",
          "sprite": "제품_균열",
          "at": [
            470,
            300
          ],
          "size": 64,
          "label": "표면 균열"
        },
        {
          "id": "제품_변색",
          "sprite": "제품_변색",
          "at": [
            300,
            170
          ],
          "size": 64,
          "label": "변색"
        },
        {
          "id": "제품_찌그러짐1",
          "sprite": "제품_찌그러짐",
          "at": [
            620,
            195
          ],
          "size": 64,
          "label": "찌그러짐"
        },
        {
          "id": "제품_찌그러짐2",
          "sprite": "제품_찌그러짐",
          "at": [
            810,
            285
          ],
          "size": 64,
          "label": "찌그러짐"
        },
        {
          "id": "자재_성적서없음",
          "sprite": "제품_정상외관_도장없음",
          "at": [
            720,
            350
          ],
          "size": 64,
          "label": "성적서(품질 도장) 없는 로트"
        }
      ],
      "decoys": [
        {
          "id": "제품_물방울",
          "sprite": "제품_정상_물기",
          "at": [
            220,
            340
          ],
          "size": 64
        },
        {
          "id": "제품_반사",
          "sprite": "제품_정상_조명반사",
          "at": [
            390,
            240
          ],
          "size": 64
        },
        {
          "id": "제품_정상_도장",
          "sprite": "제품_정상_도장있음",
          "at": [
            560,
            350
          ],
          "size": 64
        },
        {
          "id": "제품_정상",
          "sprite": "제품_정상",
          "at": [
            900,
            200
          ],
          "size": 64
        },
        {
          "id": "제품_반사2",
          "sprite": "제품_정상_조명반사",
          "at": [
            90,
            130
          ],
          "size": 64
        },
        {
          "id": "제품_물방울2",
          "sprite": "제품_정상_물기",
          "at": [
            860,
            380
          ],
          "size": 64
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
    "intro": "구유마다 표시선 높이가 다릅니다. 원하는 구유의 사료 포대를 누르고 있으면 부어집니다 — 선에 맞춰 손을 떼세요. 넘치면 사료가 흩어집니다.",
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
  "ms-07": {
    "engine": "physics",
    "title": "재료 전처리 리듬",
    "intro": "도마 위로 내려오는 재료를 판정선에서 스페이스로 다듬으세요. 상한 재료는 치지 말고, 재료가 바뀌는 지점에서는 Shift로 칼과 도마를 교체하세요.",
    "time_limit": 60,
    "pass_score": 70,
    "data": {
      "mode": "rhythm",
      "bpm": 100,
      "hit_window": 0.15,
      "hit_offset": 0.04,
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
  "ms-08": {
    "engine": "trace",
    "title": "커트 가이드라인 선긋기",
    "intro": "상담·패치테스트·두피 확인을 마쳐 시술 가능 판정을 받은 고객입니다. 가위로 점선 커트 가이드라인을 따라가되, 고객이 움직이면 잠시 멈추고 두피 발적이 나타나면 즉시 시술을 종료하세요.",
    "time_limit": 70,
    "pass_score": 70,
    "data": {
      "guide": "사람_커트_가이드라인",
      "tolerance": 12,
      "start_gate": {
        "action": "패치테스트_확인카드_탭",
        "reason": "염모제 패치테스트 미확인 — 확인 전엔 시작 금지 (2스텝 warning)",
        "skip_penalty": 25,
        "sprite": "패치테스트_확인카드"
      },
      "interrupts": [
        {
          "at": 0.22,
          "reason": "고객이 움찔함 — 잠깐 멈추기",
          "hold": 0.4,
          "sprite": "움찔_모션_아이콘"
        },
        {
          "at": 0.48,
          "reason": "두피에 작은 상처·염증 관찰됨 — 피해서 멈추기",
          "hold": 0.5,
          "sprite": "두피_상처_아이콘"
        },
        {
          "at": 0.71,
          "reason": "고객이 자세를 고쳐 앉음 — 멈추기",
          "hold": 0.4,
          "sprite": "자세고침_아이콘"
        }
      ],
      "terminal_stop": {
        "at": 0.88,
        "reason": "두피 발적 호소 — 즉시 중단하고 종료하는 것이 정답 (재개 금지)",
        "sprite": "두피_발적_아이콘"
      },
      "head": "커트가위_커서"
    },
    "scoring": {
      "complete_at": 0.88,
      "off_track_penalty": 10,
      "interrupt_miss_penalty": 15,
      "fail": [
        {
          "when": "발적지점_강행",
          "reason": "발적 지점(0.88)에서 멈추지 않고 지나감 — sudden_quest 위반, 즉시 실패"
        },
        {
          "when": "발적지점_재개",
          "reason": "발적 지점에서 멈췄다가 다시 그어 완성 — '결과 완성을 위해 계속 진행'(금지행동), 즉시 실패"
        }
      ]
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
          "beacon": true,
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
          "locked_hint": "잠김 — 선행공정 확인(표지판)이 끝나야 시공을 시작할 수 있습니다",
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
          "locked_hint": "잠김 — 아직 걸 받침이 없습니다. 받침이 생기면 배선할 수 있습니다",
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
  "sns-01": {
    "engine": "spot",
    "title": "카드뉴스 시각 결함 검수",
    "intro": "업로드 전 카드뉴스 5장을 훑어 시각 결함을 찾아 표시하세요. 정상인 곳을 표시하면 감점입니다.",
    "time_limit": 60,
    "pass_score": 70,
    "data": {
      "scene": "카드뉴스_5장_검수보드",
      "mark": "tag",
      "reference": {
        "sprite": "견본_표준_카드뉴스",
        "label": "브랜드 기준에 맞는 표준 카드뉴스 예시 (견본)"
      },
      "targets": [
        {
          "id": "카드3_로고부",
          "sprite": "카드3_로고영역",
          "at": [
            470,
            150
          ],
          "size": 60,
          "label": "타사 로고 노출(3페이지)"
        },
        {
          "id": "카드1_타이틀부",
          "sprite": "카드1_타이틀블록",
          "at": [
            110,
            150
          ],
          "size": 120,
          "label": "메인 타이틀 색면이 어긋나 찢김(오타)"
        },
        {
          "id": "카드2_본문서체부",
          "sprite": "카드2_본문글자블록",
          "at": [
            290,
            230
          ],
          "size": 110,
          "label": "권장 서체와 다른 이질적 글자 모양"
        },
        {
          "id": "카드4_이미지부",
          "sprite": "카드4_이미지영역",
          "at": [
            650,
            240
          ],
          "size": 96,
          "label": "이미지 잘림(1:1 규격 벗어남)"
        },
        {
          "id": "카드5_하단문구부",
          "sprite": "카드5_하단문구블록",
          "at": [
            830,
            310
          ],
          "size": 120,
          "label": "유의사항 문구 블록 과도하게 작음"
        }
      ],
      "decoys": [
        {
          "id": "카드5_로고부",
          "sprite": "카드5_로고영역",
          "at": [
            830,
            150
          ],
          "size": 60
        },
        {
          "id": "카드2_이미지부",
          "sprite": "카드2_이미지영역",
          "at": [
            290,
            340
          ],
          "size": 96
        },
        {
          "id": "카드4_색면부",
          "sprite": "카드4_상단색면",
          "at": [
            650,
            140
          ],
          "size": 120
        }
      ]
    },
    "scoring": {
      "target_count": 5,
      "decoy_penalty": 15
    }
  },
  "stn-01": {
    "engine": "match",
    "title": "타깃 취향과 시안 맞추기",
    "intro": "손님 말풍선의 색·모티프에 맞는 광고 시안을 이으세요. 브랜드 가이드에 어긋나거나 권리가 확인되지 않은 시안은 잇지 말고 휴지통으로 버립니다.",
    "time_limit": 75,
    "pass_score": 70,
    "data": {
      "left_label": "손님",
      "right_label": "시안 보드",
      "left": [
        {
          "id": "손님_민트새싹",
          "sprite": "손님_말풍선_민트_새싹"
        },
        {
          "id": "손님_코랄물결",
          "sprite": "손님_말풍선_코랄_물결"
        },
        {
          "id": "손님_네이비별",
          "sprite": "손님_말풍선_네이비_별"
        },
        {
          "id": "손님_옐로해",
          "sprite": "손님_말풍선_옐로_해"
        },
        {
          "id": "손님_보라달",
          "sprite": "손님_말풍선_보라_달"
        }
      ],
      "right": [
        {
          "id": "시안_민트새싹",
          "sprite": "시안_민트_새싹"
        },
        {
          "id": "시안_코랄물결",
          "sprite": "시안_코랄_물결"
        },
        {
          "id": "시안_네이비별",
          "sprite": "시안_네이비_별"
        },
        {
          "id": "시안_옐로해",
          "sprite": "시안_옐로_해"
        },
        {
          "id": "시안_형광레드별",
          "sprite": "시안_형광레드_별_금지마크"
        },
        {
          "id": "시안_코랄물결_워터마크",
          "sprite": "시안_코랄_물결_워터마크"
        }
      ],
      "pairs": [
        [
          "손님_민트새싹",
          "시안_민트새싹"
        ],
        [
          "손님_코랄물결",
          "시안_코랄물결"
        ],
        [
          "손님_네이비별",
          "시안_네이비별"
        ],
        [
          "손님_옐로해",
          "시안_옐로해"
        ]
      ],
      "unmatched": [
        "손님_보라달"
      ],
      "discard": {
        "bin": "휴지통",
        "sprite": "휴지통",
        "items": [
          {
            "id": "시안_형광레드별",
            "reason": "브랜드 가이드 금지색 — 모티프가 맞아 손님_네이비별에 붙이고 싶어진다"
          },
          {
            "id": "시안_코랄물결_워터마크",
            "reason": "이미지 권리 미확인 — 색·모티프가 완전히 일치해 가장 유혹적인 함정"
          }
        ]
      }
    },
    "scoring": {
      "judgement_count": 7,
      "wrong_pair_penalty": 12,
      "forbidden_penalty": 40
    }
  },
  "stn-02": {
    "engine": "route",
    "title": "전시 관람 동선 설계",
    "intro": "작품 배치가 끝난 전시장입니다. 주출입구에서 구역을 관람 순서대로 이어 퇴장구까지 동선을 그으세요. 관람객이 몰리면 바닥이 붉게 달아오르고, 점검 중 발견한 위험물은 보고해야 합니다.",
    "time_limit": 90,
    "pass_score": 70,
    "data": {
      "map": "전시장_도면",
      "start": {
        "id": "주출입구",
        "at": [
          80,
          220
        ],
        "icon": "입구_표지",
        "sprite": "입구_표지",
        "color": "흰색",
        "label": "주출입구"
      },
      "waypoints": [
        {
          "id": "구역_소품_도입",
          "at": [
            240,
            120
          ],
          "icon": "소품_진열대",
          "sprite": "소품_진열대",
          "color": "노랑",
          "label": "도입부 · 소품 — 걸음이 느려지는 구간"
        },
        {
          "id": "구역_회화_벽면",
          "at": [
            480,
            80
          ],
          "icon": "회화_액자",
          "sprite": "회화_액자",
          "color": "파랑",
          "label": "벽면 · 회화"
        },
        {
          "id": "구역_대형설치",
          "at": [
            700,
            160
          ],
          "icon": "설치_구조물",
          "sprite": "설치_구조물",
          "color": "주황",
          "label": "대형 설치 — 관람객이 멈춰 서서 오래 머문다"
        },
        {
          "id": "구역_영상_암전",
          "at": [
            700,
            330
          ],
          "icon": "영상_스크린",
          "sprite": "영상_스크린",
          "color": "보라",
          "label": "영상 · 암전실 — 상영 주기마다 한꺼번에 빠져나온다"
        },
        {
          "id": "퇴장구",
          "at": [
            880,
            330
          ],
          "icon": "출구_표지",
          "sprite": "출구_표지",
          "color": "초록",
          "label": "퇴장구",
          "arrival": true
        }
      ],
      "decoy_waypoints": [
        {
          "id": "목록순_꺾임_A",
          "at": [
            560,
            250
          ],
          "note": "번호 순서를 따라 회화에서 암전실로 곧장 내려가는 점 — 낙상_단차구간 관통"
        },
        {
          "id": "목록순_꺾임_B",
          "at": [
            410,
            190
          ],
          "note": "번호를 따라 홀 가운데를 되짚는 점 — 들어가는 선과 엇갈려 역주행_교차 발생"
        },
        {
          "id": "목록순_꺾임_C",
          "at": [
            210,
            265
          ],
          "note": "번호를 따라 입구 쪽으로 되돌아오는 점 — 주출입구 앞 병목 관통"
        }
      ],
      "avoid": [
        {
          "zone": "병목_주출입구앞",
          "at": [
            200,
            260
          ],
          "radius": 70,
          "penalty": 20,
          "reason": "입장 대기와 되돌아온 관람객이 겹치는 목"
        },
        {
          "zone": "낙상_단차구간",
          "at": [
            560,
            230
          ],
          "radius": 60,
          "penalty": 20,
          "reason": "암전실 앞 단차 — 어두운 데서 걸려 넘어진다"
        },
        {
          "zone": "역주행_교차",
          "at": [
            420,
            180
          ],
          "radius": 50,
          "penalty": 15,
          "reason": "되돌아 나오는 선과 들어가는 선이 엇갈리는 지점"
        },
        {
          "zone": "비상동선_침범",
          "at": [
            480,
            400
          ],
          "radius": 60,
          "penalty": 40,
          "reason": "비상동선 — 관람 동선을 겹쳐 그리면 운영 불가"
        }
      ],
      "blockers": [
        {
          "id": "비상구_적치물",
          "at": [
            470,
            415
          ],
          "sprite": "적치물_상자더미",
          "action": "운영팀_보고",
          "missed_penalty": 40,
          "label": "비상구 앞 상자 더미"
        }
      ],
      "budget": {
        "time": 90
      }
    },
    "scoring": {
      "waypoint_count": 5,
      "order_matters": true
    }
  },
  "stn-03": {
    "engine": "match",
    "title": "매출·CRM 데이터 파이프 조인",
    "intro": "매출 탱크와 CRM 탱크의 소켓을 열쇠 이빨이 꼭 맞는 짝끼리 파이프로 이으세요. 모양이 어긋나도 끼워지긴 하지만 이음새로 구슬이 샙니다. 파이프에 흐르는 구슬 중 색이 튀는 이상치만 클릭해 걸러내세요.",
    "time_limit": 80,
    "pass_score": 70,
    "data": {
      "left_label": "매출 탱크",
      "right_label": "CRM 탱크",
      "left": [
        {
          "id": "매출소켓_톱니A",
          "sprite": "매출탱크_열쇠_톱니A"
        },
        {
          "id": "매출소켓_둥근B",
          "sprite": "매출탱크_열쇠_둥근B"
        },
        {
          "id": "매출소켓_각진C",
          "sprite": "매출탱크_열쇠_각진C"
        },
        {
          "id": "매출소켓_이중D",
          "sprite": "매출탱크_열쇠_이중D"
        },
        {
          "id": "매출소켓_타임존없음",
          "sprite": "매출탱크_열쇠_반투명"
        }
      ],
      "right": [
        {
          "id": "CRM소켓_톱니A",
          "sprite": "CRM탱크_열쇠_톱니A"
        },
        {
          "id": "CRM소켓_둥근B",
          "sprite": "CRM탱크_열쇠_둥근B"
        },
        {
          "id": "CRM소켓_각진C",
          "sprite": "CRM탱크_열쇠_각진C"
        },
        {
          "id": "CRM소켓_이중D",
          "sprite": "CRM탱크_열쇠_이중D"
        },
        {
          "id": "CRM소켓_유사톱니A",
          "sprite": "CRM탱크_열쇠_톱니A_유사"
        }
      ],
      "pairs": [
        [
          "매출소켓_톱니A",
          "CRM소켓_톱니A"
        ],
        [
          "매출소켓_둥근B",
          "CRM소켓_둥근B"
        ],
        [
          "매출소켓_각진C",
          "CRM소켓_각진C"
        ],
        [
          "매출소켓_이중D",
          "CRM소켓_이중D"
        ]
      ],
      "unmatched": [
        "매출소켓_타임존없음",
        "CRM소켓_유사톱니A"
      ],
      "forbidden_pairs": [
        {
          "pair": [
            "매출소켓_톱니A",
            "CRM소켓_유사톱니A"
          ],
          "reason": "이빨이 미세하게 다른 동명이인 — 임의 병합 금지"
        }
      ],
      "stream": {
        "beads": [
          {
            "id": "구슬_파랑_1",
            "sprite": "구슬_파랑"
          },
          {
            "id": "구슬_파랑_2",
            "sprite": "구슬_파랑"
          },
          {
            "id": "구슬_파랑_3",
            "sprite": "구슬_파랑"
          },
          {
            "id": "구슬_파랑_4",
            "sprite": "구슬_파랑"
          }
        ],
        "outliers": [
          {
            "id": "구슬_환불_붉은",
            "sprite": "구슬_붉은",
            "reason": "환불이 매출로 뒤집혀 섞인 이상치 — 반영하면 매출이 부풀려진다"
          },
          {
            "id": "구슬_중복_노란",
            "sprite": "구슬_노란",
            "reason": "중복 고객ID로 두 번 세어진 구슬 — 고객수·구매건수 혼동의 원인"
          }
        ],
        "decoy_beads": [
          {
            "id": "구슬_짙은파랑",
            "sprite": "구슬_짙은파랑"
          },
          {
            "id": "구슬_옅은파랑",
            "sprite": "구슬_옅은파랑"
          },
          {
            "id": "구슬_파랑_광택",
            "sprite": "구슬_파랑_광택"
          }
        ]
      }
    },
    "scoring": {
      "judgement_count": 8,
      "wrong_pair_penalty": 12,
      "forbidden_penalty": 40,
      "decoy_penalty": 15
    }
  },
  "stn-04": {
    "engine": "match",
    "title": "실험 조건·결과 대조",
    "intro": "실험 조건 카드와 결과 카드에서 같은 마커(색·모양)를 찾아 짝지으세요. 어느 조건과도 마커가 맞지 않는 결과 카드는 억지로 잇지 말고 '재검증 표시'를 붙여 남깁니다.",
    "time_limit": 80,
    "pass_score": 70,
    "data": {
      "left_label": "실험 조건",
      "right_label": "시험 결과",
      "left": [
        {
          "id": "조건_A",
          "sprite": "조건카드_세모_파랑",
          "label": "조건 A"
        },
        {
          "id": "조건_B",
          "sprite": "조건카드_네모_주황",
          "label": "조건 B"
        },
        {
          "id": "조건_C",
          "sprite": "조건카드_동그라미_초록",
          "label": "조건 C"
        },
        {
          "id": "조건_D",
          "sprite": "조건카드_마름모_보라",
          "label": "조건 D"
        }
      ],
      "right": [
        {
          "id": "결과_1",
          "sprite": "결과카드_세모_파랑_상승",
          "label": "결과 1"
        },
        {
          "id": "결과_2",
          "sprite": "결과카드_네모_주황_하락",
          "label": "결과 2"
        },
        {
          "id": "결과_3",
          "sprite": "결과카드_동그라미_초록_상승",
          "label": "결과 3"
        },
        {
          "id": "결과_4",
          "sprite": "결과카드_마름모_보라_평탄",
          "label": "결과 4"
        },
        {
          "id": "결과_5",
          "sprite": "결과카드_별_빨강_역상승",
          "label": "결과 5"
        }
      ],
      "pairs": [
        [
          "조건_A",
          "결과_1"
        ],
        [
          "조건_B",
          "결과_2"
        ],
        [
          "조건_C",
          "결과_3"
        ],
        [
          "조건_D",
          "결과_4"
        ]
      ],
      "unmatched": [
        "결과_5"
      ],
      "unmatched_action": "재검증_표시"
    },
    "scoring": {
      "pair_count": 4,
      "unmatched_count": 1,
      "wrong_pair_penalty": 15,
      "missed_unmatched_penalty": 40
    }
  },
  "stn-05": {
    "engine": "place",
    "title": "온보딩 퍼널 새는 구멍 막기",
    "intro": "위에서 구슬을 흘리면 이탈 구간이 붉게 새어 나옵니다. 막개는 어느 구간에나 꽂을 수 있지만, 구멍 옆 근거 카드와 마커가 다르면 계속 샙니다. 같은 마커의 막개로 막고, 근거 없는 막개나 새지 않는 정상 구간은 건드리지 마세요.",
    "time_limit": 80,
    "pass_score": 70,
    "data": {
      "scene": "stn-05-onboarding-funnel-cartoon.png",
      "fit": "any",
      "slots": [
        {
          "id": "구멍_구간1",
          "accepts": "막개_말풍선_노랑",
          "marker": "근거카드_말풍선_노랑",
          "label": "구간 1",
          "kind": "dock",
          "at": [173, 174]
        },
        {
          "id": "구멍_구간2",
          "accepts": "막개_마이크_파랑",
          "marker": "근거카드_마이크_파랑",
          "label": "구간 2",
          "kind": "dock",
          "at": [356, 174]
        },
        {
          "id": "구멍_구간3",
          "accepts": "막개_화면화살표_보라",
          "marker": "근거카드_화면화살표_보라",
          "label": "구간 3",
          "kind": "dock",
          "at": [575, 174]
        },
        {
          "id": "구간_정상",
          "accepts": null,
          "label": "구간 4",
          "kind": "dock",
          "at": [777, 174]
        }
      ],
      "pieces": [
        "막개_말풍선_노랑",
        "막개_마이크_파랑",
        "막개_화면화살표_보라",
        "막개_왕관_금테",
        "막개_과녁_회색"
      ],
      "extras": [
        {
          "id": "막개_왕관_금테",
          "reason": "사용자 근거 없이 상급자 지시만 반영한 기능 — m1 warning·보기 e의 흔한 실수. 어느 구멍의 근거 카드와도 마커가 대응하지 않는다."
        },
        {
          "id": "막개_과녁_회색",
          "reason": "사업목표 문서만 근거로 단 기능 — 이탈 증거(문의·인터뷰·화면흐름)와 교차검증(answer_guide ②)이 되지 않는다. 새지 않는 구간 4에 끼우는 것도 같은 감점."
        }
      ]
    },
    "scoring": {
      "slot_count": 3,
      "extra_penalty": 20,
      "wrong_slot_penalty": 10
    }
  },
  "wh-01": {
    "engine": "sort",
    "title": "바코드 색 분류 컨베이어",
    "intro": "컨베이어의 택배를 바코드 색에 맞는 지역 슈트로 빠르게 넣으세요. 겉면 라벨이 아니라 바코드 색을 보세요. 슈트로 보낼 수 없는 상태의 택배는 반장 보고 버튼으로 처리하세요.",
    "time_limit": 60,
    "pass_score": 70,
    "data": {
      "presentation": "conveyor",
      "bins": [
        {
          "id": "슈트_A구역",
          "label": "A구역",
          "color": "파랑"
        },
        {
          "id": "슈트_B구역",
          "label": "B구역",
          "color": "초록"
        },
        {
          "id": "슈트_C구역",
          "label": "C구역",
          "color": "주황"
        }
      ],
      "items": [
        {
          "id": "택배_정상_A1",
          "sprite": "택배_파랑바코드",
          "bin": "슈트_A구역"
        },
        {
          "id": "택배_정상_B1",
          "sprite": "택배_초록바코드",
          "bin": "슈트_B구역"
        },
        {
          "id": "택배_정상_C1",
          "sprite": "택배_주황바코드",
          "bin": "슈트_C구역"
        },
        {
          "id": "택배_정상_A2",
          "sprite": "택배_파랑바코드_2",
          "bin": "슈트_A구역"
        },
        {
          "id": "택배_라벨불일치_1",
          "sprite": "택배_A라벨_주황바코드",
          "bin": "슈트_C구역"
        },
        {
          "id": "택배_라벨불일치_2",
          "sprite": "택배_C라벨_파랑바코드",
          "bin": "슈트_A구역"
        },
        {
          "id": "택배_파손_누출",
          "sprite": "택배_젖은박스_누출자국",
          "escalate": true
        }
      ],
      "escalate": {
        "label": "반장 보고",
        "when": "택배_파손_누출"
      }
    },
    "scoring": {
      "item_count": 7,
      "wrong_bin_penalty": 15,
      "forbidden_penalty": 40,
      "missed_escalate_penalty": 40,
      "escalate_mode": "대체",
      "escalate_required": [
        "택배_파손_누출"
      ]
    }
  },
  "yg-01": {
    "engine": "spot",
    "title": "배너 시안 교정 스팟",
    "intro": "배너 시안 3종을 브리프·검수표와 대조해 시각 결함을 찾아 X로 표시하세요. 정상인 곳을 표시하면 감점입니다.",
    "time_limit": 60,
    "pass_score": 70,
    "data": {
      "scene": "배너시안_3종_검수대",
      "mark": "x",
      "reference": {
        "sprite": "견본_표준_배너",
        "label": "브리프·검수표 기준에 맞는 표준 배너 시안 예시 (견본)"
      },
      "targets": [
        {
          "id": "A_상단색면",
          "sprite": "시안A_상단색면",
          "at": [
            138,
            152
          ],
          "size": 100,
          "label": "브랜드 색이 아닌 색상 오류"
        },
        {
          "id": "A_본문이미지",
          "sprite": "시안A_본문이미지",
          "at": [
            250,
            300
          ],
          "size": 90,
          "label": "저해상도로 뭉개진 이미지(해상도 미달)"
        },
        {
          "id": "B_좌측버튼",
          "sprite": "시안B_좌측버튼",
          "at": [
            470,
            322
          ],
          "size": 76,
          "label": "색면이 어긋나 찢긴 버튼(오탈자 글리치)"
        },
        {
          "id": "B_상단심볼",
          "sprite": "시안B_상단심볼",
          "at": [
            392,
            130
          ],
          "size": 48,
          "label": "브리프에 없는 잘못된 심볼"
        },
        {
          "id": "C_우상단요소",
          "sprite": "시안C_우상단요소",
          "at": [
            880,
            112
          ],
          "size": 72,
          "label": "요소가 재단선(세이프영역) 밖으로 넘침"
        },
        {
          "id": "C_중앙배경면",
          "sprite": "시안C_중앙배경면",
          "at": [
            700,
            250
          ],
          "size": 110,
          "label": "배경 색면이 프레임과 어긋나 흰 틈"
        }
      ],
      "decoys": [
        {
          "id": "A_로고부",
          "sprite": "시안A_로고부",
          "at": [
            92,
            92
          ],
          "size": 48
        },
        {
          "id": "A_포인트색면",
          "sprite": "시안A_포인트색면",
          "at": [
            200,
            220
          ],
          "size": 100
        },
        {
          "id": "B_우측버튼",
          "sprite": "시안B_우측버튼",
          "at": [
            560,
            300
          ],
          "size": 76
        },
        {
          "id": "C_하단여백",
          "sprite": "시안C_하단여백",
          "at": [
            762,
            360
          ],
          "size": 120
        }
      ]
    },
    "scoring": {
      "target_count": 6,
      "decoy_penalty": 10
    }
  },
  "yg-02": {
    "engine": "sort",
    "title": "세공품 검수대",
    "intro": "확대 인스펙션 뷰로 세공품을 도안과 대조하세요. 결함이 보이면 보류함, 도안과 일치하면 합격 트레이로. 판정이 애매하면 실장을 호출하세요. 검수대는 쉬지 않고 돌아갑니다 — 시간 안에 처리하세요.",
    "time_limit": 45,
    "pass_score": 70,
    "data": {
      "presentation": "conveyor",
      "shuffle": true,
      "legend": [
        {
          "symptom": "도안 일치",
          "goes_to": "합격"
        },
        {
          "symptom": "미세 기움 · 허용오차 내",
          "goes_to": "합격"
        },
        {
          "symptom": "보석 크게 기욺",
          "goes_to": "보류"
        },
        {
          "symptom": "용접부 끊김",
          "goes_to": "보류"
        },
        {
          "symptom": "도안 흐려 대조 불가",
          "goes_to": "실장 호출"
        }
      ],
      "bins": [
        {
          "id": "합격",
          "label": "합격 트레이",
          "color": "초록"
        },
        {
          "id": "보류",
          "label": "보류함",
          "color": "빨강"
        }
      ],
      "items": [
        {
          "id": "반지_보석기움",
          "forbidden_bin": "합격",
          "sprite": "반지_보석세팅_기욺",
          "bin": "보류",
          "note": "보석 세팅이 도안보다 확연히 기욺(확대뷰 과장)"
        },
        {
          "id": "목걸이_용접끊김",
          "forbidden_bin": "합격",
          "sprite": "목걸이_연결부_용접끊김",
          "bin": "보류",
          "note": "체인 연결 용접선이 끊겨 벌어짐"
        },
        {
          "id": "브로치_핀끊김",
          "forbidden_bin": "합격",
          "sprite": "브로치_고정핀_용접끊김",
          "bin": "보류",
          "note": "뒷면 고정핀 용접부 끊김"
        },
        {
          "id": "반지_정상",
          "sprite": "반지_도안일치",
          "bin": "합격",
          "note": "보석 정렬·표면 마감 도안과 일치"
        },
        {
          "id": "브로치_정상",
          "sprite": "브로치_도안일치",
          "bin": "합격",
          "note": "도안과 일치"
        },
        {
          "id": "목걸이_미세기움",
          "sprite": "목걸이_보석_허용오차내",
          "bin": "합격",
          "note": "미세하게 기운 듯하나 도안 허용오차 내 — 정상"
        },
        {
          "id": "목걸이_도안흐림",
          "sprite": "목걸이_도안_판독불가",
          "escalate": true,
          "note": "도안이 흐려 판정 불가 — 임의 판정 금지"
        }
      ],
      "escalate": {
        "label": "실장 호출",
        "when": "목걸이_도안흐림"
      }
    },
    "scoring": {
      "item_count": 7,
      "wrong_bin_penalty": 15,
      "escalate_required": [
        "목걸이_도안흐림"
      ],
      "forbidden_penalty": 40,
      "missed_escalate_penalty": 40
    }
  },
  "yg-03": {
    "engine": "typing",
    "title": "배포 전 안전 점검",
    "intro": "릴리스 배포 전 마지막 점검입니다. 치명 위험을 막는 점검 코드를 정확히 입력하세요. 위험을 발견하면 혼자 고치지 말고 배포를 중단·보고해야 합니다. 스펙에 없는 줄은 입력하면 안 됩니다.",
    "time_limit": 90,
    "pass_score": 70,
    "data": {
      "fall_seconds": 14,
      "presentation": "dev_desk",
      "lines": [
        {
          "id": "pii",
          "text": "if has_plaintext_pii(logs): block_release()",
          "label": "로그의 개인정보 평문 노출 탐지 → 배포 중단"
        },
        {
          "id": "secret",
          "text": "if api_key_in_source(config): block_release()",
          "label": "소스에 하드코딩된 API 키 탐지 → 배포 중단"
        },
        {
          "id": "backup",
          "text": "if migration_lacks_backup(): block_release()",
          "label": "백업 없는 마이그레이션 탐지 → 배포 중단"
        },
        {
          "id": "report",
          "text": "if release_blocked: report_to_lead()",
          "label": "중단 시 선임에게 보고 (혼자 처리 금지)"
        }
      ],
      "distractors": [
        {
          "id": "force",
          "text": "deploy_anyway(ignore_warnings=True)",
          "reason": "일정 압박에 밀려 경고를 무시하고 배포 강행"
        },
        {
          "id": "selffix",
          "text": "patch_secret_and_deploy()",
          "reason": "위험을 발견하고도 혼자 스크립트를 수정·실행"
        }
      ]
    },
    "scoring": {
      "line_count": 4,
      "critical_lines": [
        "pii",
        "secret",
        "backup"
      ],
      "missed_critical_penalty": 40,
      "distractor_penalty": 40,
      "count_speed": false
    }
  },
  "yg-04": {
    "engine": "route",
    "title": "장애 구간 추적",
    "intro": "호출 경로를 따라가며 상태등이 처음 빨개지는 구간을 찾으세요. 직접 고치지 말고 위치만 보고하면 됩니다.",
    "time_limit": 60,
    "pass_score": 70,
    "data": {
      "map": "호출경로_상황판",
      "start": {
        "id": "게이트웨이",
        "sprite": "게이트웨이_라우터"
      },
      "waypoints": [
        {
          "id": "추론서버",
          "sprite": "추론서버_랙"
        },
        {
          "id": "모델저장소",
          "sprite": "모델저장소_디스크"
        }
      ],
      "report_at": "모델저장소",
      "signals": [
        {
          "at": "게이트웨이",
          "light": "yellow",
          "hint": "지연 — 뒤쪽에 원인이 있다"
        },
        {
          "at": "추론서버",
          "light": "yellow",
          "hint": "지연 — 더 따라가야 한다"
        },
        {
          "at": "모델저장소",
          "light": "red",
          "hint": "차단 — 여기서 끊긴다"
        },
        {
          "at": "DB",
          "light": "green",
          "hint": "정상 — 이 방향은 아니다",
          "sprite": "DB_실린더"
        }
      ],
      "avoid": [
        {
          "zone": "DB_정상구간",
          "penalty": 15
        }
      ],
      "log_hints": [
        {
          "at": "모델저장소",
          "text": "504 upstream timeout",
          "role": "보조"
        }
      ],
      "budget": {
        "time": 60
      }
    },
    "scoring": {}
  },
  "ys-01": {
    "engine": "place",
    "title": "112 배차 관제",
    "intro": "접수된 신고 카드를 배차판에 올리세요. 순찰차는 2대뿐입니다. 순찰차가 필요 없는 신고는 지원요청함·예약함으로 보내세요.",
    "time_limit": 60,
    "pass_score": 70,
    "data": {
      "slots": [
        {
          "id": "순찰차_1순위",
          "label": "순찰차 1호 · 최우선 출동",
          "marker": "배차마커_순찰차",
          "accepts": "신고_흉기난동"
        },
        {
          "id": "순찰차_2순위",
          "label": "순찰차 2호 · 후속 출동",
          "marker": "배차마커_순찰차",
          "accepts": "신고_주취폭행"
        },
        {
          "id": "지원요청함",
          "label": "인접 지구대 지원요청",
          "marker": "배차마커_지원요청",
          "accepts": "신고_주차시비"
        },
        {
          "id": "예약함",
          "label": "당일 방문 예약",
          "marker": "배차마커_예약",
          "accepts": "신고_자전거절도"
        }
      ],
      "pieces": [
        "신고_흉기난동",
        "신고_주취폭행",
        "신고_주차시비",
        "신고_자전거절도",
        "신고_위치미특정"
      ],
      "extras": [
        "신고_위치미특정"
      ]
    },
    "scoring": {
      "slot_count": 4,
      "wrong_slot_penalty": 12,
      "extra_penalty": 20
    }
  },
  "ys-02": {
    "engine": "sequence",
    "title": "야간 초소 수하 절차",
    "intro": "철책 너머로 미상 인원이 접근합니다. 엄폐한 채로 수하 절차를 배운 순서대로 밟으세요. 순서를 틀리면 절차가 무너집니다.",
    "time_limit": 45,
    "pass_score": 70,
    "data": {
      "steps": [
        {
          "id": "엄폐_정지명령",
          "sprite": "초소_엄폐_정지수신호",
          "label": "엄폐 유지하며 \"정지\" 3회 명령"
        },
        {
          "id": "손들어_명령",
          "sprite": "손들어_수신호",
          "label": "\"손들어\" 후 이동 정지 확인"
        },
        {
          "id": "문어_제시",
          "sprite": "암구호_문어패",
          "label": "문어 제시"
        },
        {
          "id": "답어_확인",
          "sprite": "암구호_답어대조",
          "label": "답어 확인 — 이번 인원은 답어 불일치"
        },
        {
          "id": "무전보고_상황실",
          "sprite": "무전기_보고",
          "label": "현 위치 고수하며 상황실에 무전보고 (위치·인원·행동)"
        },
        {
          "id": "관측_지속",
          "sprite": "야간투시경_관측",
          "label": "분대장 지시 수신 시까지 관측 지속"
        }
      ],
      "forbidden": [
        {
          "id": "접근_허용",
          "sprite": "차단봉_개방",
          "reason": "암구호 확인 전 접근 허용은 금지"
        },
        {
          "id": "단독_추격",
          "sprite": "초소밖_추격",
          "reason": "단독 추격은 금지행동"
        },
        {
          "id": "초소_이탈",
          "sprite": "초소_비움",
          "reason": "초소 이탈은 금지행동 — 경계공백이 생긴다"
        },
        {
          "id": "자체_종결",
          "sprite": "상황일지_종결도장",
          "reason": "보고 없이 자체 종결은 금지 — 단독 판단 불가"
        }
      ]
    },
    "scoring": {
      "step_count": 6,
      "wrong_order": "fail",
      "forbidden": "fail",
      "partial_credit": true
    }
  },
  "ys-03": {
    "engine": "match",
    "title": "정문 검색대 출입통제",
    "intro": "입장객 얼굴과 출입증 초상을 선으로 이으세요. 짝이 없는 쪽은 '불가능' 도장, 탐지기가 울린 사람은 직접 손대지 말고 2차 검색 벨을 누르세요.",
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
      "unmatched_action": "불가능",
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
  "ys-06": {
    "engine": "gauge",
    "title": "회로별 절연저항 측정",
    "intro": "집게를 단자에 물리면 바늘이 출렁입니다. 멈춘 자리가 초록 띠 안이면 합격 도장, 빨강이면 손대지 말고 차단 표찰을 붙이세요.",
    "time_limit": 75,
    "pass_score": 70,
    "data": {
      "ok_zone": [
        60,
        100
      ],
      "gauges": [
        {
          "id": "전등분전반_L1",
          "label": "전등 분전반 L1",
          "sprite": "분전반_회로_외관",
          "value": 88,
          "verdict": "pass"
        },
        {
          "id": "콘센트회로_L2",
          "label": "콘센트 회로 L2",
          "sprite": "분전반_회로_외관",
          "value": 76,
          "verdict": "pass"
        },
        {
          "id": "에어컨전용선_증설회로",
          "label": "에어컨 전용선 증설 회로",
          "sprite": "임시배선_새회로_외관",
          "value": 62,
          "verdict": "pass"
        },
        {
          "id": "배전반_3층_R상",
          "label": "3층 배전반 R상",
          "sprite": "분전반_회로_외관",
          "value": 57,
          "verdict": "fail",
          "action": "차단표찰_부착"
        },
        {
          "id": "누전차단기_502호",
          "label": "502호 누전차단기 회로",
          "sprite": "분전반_회로_외관",
          "value": 41,
          "verdict": "fail",
          "action": "차단표찰_부착"
        },
        {
          "id": "분전반_지하1층_동력",
          "label": "지하 1층 분전반 동력회로",
          "sprite": "분전반_회로_외관",
          "value": 33,
          "verdict": "fail",
          "action": "차단표찰_부착"
        },
        {
          "id": "접속부_과열회로",
          "label": "접속부 회로",
          "sprite": "분전반_회로_외관",
          "value": 46,
          "verdict": "fail",
          "action": "차단표찰_부착"
        }
      ],
      "forbidden": [
        {
          "id": "과열단자_직접조임",
          "reason": "과열 접속부를 공구로 직접 조이는 것은 신입 금지행동"
        },
        {
          "id": "차단상태_임의복전",
          "reason": "미달 회로는 차단 상태를 유지해야 하며 복전은 선임 입회하에만 한다"
        }
      ]
    },
    "scoring": {
      "gauge_count": 7,
      "forbidden_penalty": 40
    }
  },
  "ys-07": {
    "engine": "gauge",
    "title": "규정 토크로 조이기",
    "intro": "드레인 플러그 체결 시도마다 토크렌치 바늘이 멈춰 있습니다. 초록 띠(규정 토크) 안이면 합격, 지나치면 나사산 손상·모자라면 누유 — 재조임 판정하세요.",
    "time_limit": 70,
    "pass_score": 70,
    "data": {
      "ok_zone": [
        45,
        60
      ],
      "gauges": [
        {
          "id": "체결시도_1",
          "label": "드레인 플러그 · 시도 1",
          "sprite": "토크렌치_드레인플러그",
          "value": 52,
          "verdict": "pass"
        },
        {
          "id": "체결시도_2",
          "label": "드레인 플러그 · 시도 2",
          "sprite": "토크렌치_드레인플러그",
          "value": 48,
          "verdict": "pass"
        },
        {
          "id": "체결시도_3",
          "label": "드레인 플러그 · 시도 3",
          "sprite": "토크렌치_드레인플러그",
          "value": 56,
          "verdict": "pass"
        },
        {
          "id": "체결시도_4_과조임",
          "label": "드레인 플러그 · 시도 4",
          "sprite": "토크렌치_드레인플러그",
          "value": 84,
          "verdict": "fail",
          "action": "재조임"
        },
        {
          "id": "체결시도_5_헐거움",
          "label": "드레인 플러그 · 시도 5",
          "sprite": "토크렌치_드레인플러그",
          "value": 38,
          "verdict": "fail",
          "action": "재조임"
        },
        {
          "id": "체결시도_6_과조임",
          "label": "드레인 플러그 · 시도 6",
          "sprite": "토크렌치_드레인플러그",
          "value": 93,
          "verdict": "fail",
          "action": "재조임"
        }
      ]
    },
    "scoring": {
      "gauge_count": 6
    }
  },
  "ys-08": {
    "engine": "gauge",
    "title": "계기판 순찰",
    "intro": "기관실 계기판을 훑어 바늘이 빨강(적색존)에 든 이상 계기만 탭하세요. 하나라도 놓치면 큰 감점입니다. 정상 계기는 건드리지 마세요.",
    "time_limit": 80,
    "pass_score": 70,
    "data": {
      "ok_zone": [
        25,
        72
      ],
      "gauges": [
        {
          "id": "비상발전기_냉각수온도",
          "label": "비상발전기 냉각수 온도",
          "sprite": "비상발전기_본체",
          "value": 48,
          "verdict": "pass"
        },
        {
          "id": "비상발전기_유압",
          "label": "비상발전기 윤활유압",
          "sprite": "비상발전기_본체",
          "value": 55,
          "verdict": "pass"
        },
        {
          "id": "공기압축기_토출압력",
          "label": "공기압축기 토출압력",
          "sprite": "공기압축기_본체",
          "value": 61,
          "verdict": "pass"
        },
        {
          "id": "공기압축기_탱크압력",
          "label": "공기압축기 탱크압력",
          "sprite": "공기압축기_본체",
          "value": 70,
          "verdict": "pass"
        },
        {
          "id": "냉각수펌프_1_흡입압력",
          "label": "1번 냉각수 펌프 흡입압력",
          "sprite": "냉각수펌프_본체",
          "value": 27,
          "verdict": "pass"
        },
        {
          "id": "배전반_주회로_전류",
          "label": "배전반 주회로 부하전류",
          "sprite": "배전반_본체",
          "value": 44,
          "verdict": "pass"
        },
        {
          "id": "배전반_단자_온도",
          "label": "배전반 단자 온도",
          "sprite": "배전반_본체",
          "value": 91,
          "verdict": "fail",
          "action": "접촉금지_보고"
        },
        {
          "id": "냉각수펌프_3_토출압력",
          "label": "3번 냉각수 펌프 토출압력",
          "sprite": "냉각수펌프_본체",
          "value": 84,
          "verdict": "fail",
          "action": "이상표시_보고"
        },
        {
          "id": "하역장비_PLC_압력",
          "label": "하역장비 유압",
          "sprite": "하역장비_본체",
          "value": 14,
          "verdict": "fail",
          "action": "이상표시_보고"
        }
      ]
    },
    "scoring": {
      "gauge_count": 9,
      "abnormal_count": 3,
      "miss_penalty": 30,
      "false_tap_penalty": 12
    }
  },
  "ys-09": {
    "engine": "physics",
    "title": "수평 트림 안정화",
    "intro": "기체가 기울면 방향키로 수평을 잡으세요. 축별 기울기 표시계가 허용범위(±2°) 안에 머물러야 안정화 판정입니다. 지그에 올리기 전 프로펠러부터 분리하세요.",
    "time_limit": 60,
    "pass_score": 70,
    "data": {
      "mode": "balance",
      "target": 0.0,
      "tolerance": 2.0,
      "drift": 0.45,
      "hold_seconds": 5,
      "scene": "정비고_수평지그_씬",
      "axes": [
        {
          "id": "피치",
          "label": "앞뒤 기울기(피치)",
          "start": 3.4,
          "sprite": "드론_기체_측면"
        },
        {
          "id": "롤",
          "label": "좌우 기울기(롤)",
          "start": -2.7,
          "sprite": "드론_기체_정면"
        }
      ],
      "disturbances": [
        {
          "at": 0.2,
          "axis": "피치",
          "push": 2.4,
          "reason": "지그 재조정으로 기체가 흔들림",
          "sprite": "교란_지그_재조정"
        },
        {
          "at": 0.38,
          "axis": "롤",
          "push": -2.3,
          "reason": "케이블 정리 중 기체가 밀림",
          "sprite": "교란_케이블_당김"
        },
        {
          "at": 0.56,
          "axis": "피치",
          "push": -2.6,
          "reason": "지그 고정쇠 재체결 반동",
          "sprite": "교란_지그_재조정"
        },
        {
          "at": 0.74,
          "axis": "롤",
          "push": 2.5,
          "reason": "정비이력 확인 중 기체가 밀림",
          "sprite": "교란_케이블_당김"
        }
      ],
      "forbidden": [
        {
          "id": "프로펠러_장착상태_조정",
          "reason": "프로펠러를 분리하지 않고 조정하면 시험 중 사고 위험 — 먼저 분리해야 시작 가능",
          "sprite": "게이트_프로펠러_분리"
        },
        {
          "id": "수평확인_생략_비행투입",
          "reason": "수평 확인을 건너뛰고 비행 투입을 요청하면 현장에서 편류가 난다",
          "sprite": "비행투입_요청카드"
        }
      ]
    },
    "scoring": {
      "axis_count": 2,
      "out_of_range_penalty": 15,
      "forbidden_penalty": 40
    }
  },
  "ys-10": {
    "engine": "sequence",
    "title": "LOTO 확인 입회",
    "intro": "협력업체 작업 전 확인 입회입니다. 카드를 안전 절차에 맞는 순서로 누르세요. 확인 결과 이상이 있으면 어떻게 끝내야 하는지도 판단입니다.",
    "time_limit": 70,
    "pass_score": 70,
    "data": {
      "steps": [
        {
          "id": "작업허가서_확인",
          "sprite": "PTW_대장",
          "label": "작업허가서(PTW) 게시·유효기간 확인"
        },
        {
          "id": "차단기_개방상태_확인",
          "sprite": "차단기_상태창_눈아이콘",
          "label": "차단기 개방 상태 확인"
        },
        {
          "id": "자물쇠표지_확인",
          "sprite": "LOTO_자물쇠표지",
          "label": "잠금장치·표지(LOTO) 부착 상태 확인"
        },
        {
          "id": "검전기_무전압확인",
          "sprite": "검전기",
          "label": "검전기로 무전압 확인 — (결과) 활선 감지"
        },
        {
          "id": "작업중지_요청",
          "sprite": "작업중지_손신호",
          "label": "작업 중지 요청"
        },
        {
          "id": "무전보고",
          "sprite": "무전기_보고",
          "label": "안전관리자에게 무전 보고"
        }
      ],
      "forbidden": [
        {
          "id": "차단기_직접조작",
          "sprite": "차단기_레버_손아이콘",
          "reason": "신입이 직접 차단기를 조작하는 것은 금지행동(활선작업·차단기 임의 조작 금지 카드)"
        },
        {
          "id": "활선단자_접촉",
          "sprite": "배전반_단자",
          "reason": "검전에서 활선이 잡히면 만지지 말 것 — 접촉 금지"
        },
        {
          "id": "재촉수용_작업허용",
          "sprite": "작업자_재촉",
          "reason": "'빨리 끝내자'는 작업자 말에 밀려 확인 없이 작업을 허용하면 안 된다"
        }
      ]
    },
    "scoring": {
      "step_count": 6,
      "wrong_order_fail": true,
      "forbidden_fail": true
    }
  }
} as unknown as Record<string, MinigameDef>;

// KTS-03은 운영 YAML에서 두 게임으로 분리된다. 미리보기에서도 같은 화면을 각각
// 독립 실행할 수 있도록 출고 데이터만 떼어 별도 항목으로 만든다.
const kts03PreviewData = PREVIEW_GAMES["kts-03"].data as Record<string, unknown>;
const kts03SupplyRun = kts03PreviewData.supply_run;
delete kts03PreviewData.supply_run;
PREVIEW_GAMES["kts-03-supply"] = {
  id: "kts-03-supply",
  engine: "match",
  title: "오픈 진열분 출고·안전 운반",
  intro: "출고 목록의 종류와 수량을 기억해 정확히 피킹하고, 카트 속도를 조절하며 장애물을 피해 매장까지 운반하세요.",
  time_limit: 70,
  pass_score: 70,
  data: {
    background_id: "kts-03",
    presentation: "supply_run",
    supply_only: true,
    supply_run: kts03SupplyRun,
    left: [],
    right: [],
    pairs: [],
    unmatched: [],
  },
  scoring: { supply_weight: 100 },
};

PREVIEW_GAMES["sns-01-research"] = SNS_RESEARCH_PREVIEW_GAME;
PREVIEW_GAMES["sns-01-design"] = SNS_POST_DESIGN_PREVIEW_GAME;
