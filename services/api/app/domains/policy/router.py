from datetime import datetime

from fastapi import APIRouter, Depends

from app.core.deps import get_current_user
from app.domains.policy import providers, service
from app.models import User

router = APIRouter(prefix="/api/policies", tags=["policy"])


def _age_of(user: User) -> int | None:
    """만 나이 — 생년만 저장하므로 연 단위 근사. 제도 연령 조건도 만 나이 기준이다."""
    if not user.birth_year:
        return None
    return datetime.now().year - user.birth_year


@router.get("/card")
async def policy_card(user: User = Depends(get_current_user)):
    """상담 화면 '알고 계셨나요?' 카드.

    프로필(나이·성별·장애·거주지)이 비어 있으면 그 조건은 빼고 넓게 찾는다 —
    정보를 안 준 사용자에게도 전국 공통 제도는 보여줄 수 있어야 한다.
    카드가 없으면 available=false로만 알리고, 프론트는 카드를 감춘다.
    """
    age = _age_of(user)
    # 나이를 함께 내려보낸다 — 프론트가 API 장애 시 쓰는 고정 목록을 연령으로 걸러야 한다.
    # 이 값이 없으면 68세 계정에도 청년 전용 제도가 그대로 노출된다(실측).
    if not providers.is_configured():
        return {"available": False, "reason": "not_configured", "age": age}

    card = await service.build_card(
        age=age,
        gender=user.gender,
        has_disability=user.has_disability,
        ctpv=user.region_ctpv,
        sgg=user.region_sgg,
    )
    if not card:
        return {"available": False, "reason": "no_match", "age": age}
    return {"available": True, "age": age, **card}
