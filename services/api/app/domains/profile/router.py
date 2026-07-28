import logging
import os
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.db import get_session
from app.core.deps import get_current_user
from app.core.security import hash_password, verify_password
from app.domains.profile.schemas import (
    DocumentKind,
    PasswordChangeIn,
    PolicyProfileIn,
    PolicyProfileOut,
    ProfileAccountOut,
    ProfileUpdateIn,
    UserDocumentOut,
)
from app.models import User, UserDocument

router = APIRouter(prefix="/api/profile", tags=["profile"])
logger = logging.getLogger(__name__)

MAX_PDF_BYTES = 8 * 1024 * 1024
MAX_AVATAR_BYTES = 5 * 1024 * 1024
AVATAR_MEDIA_TYPES = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
}


def _account_out(user: User) -> ProfileAccountOut:
    return ProfileAccountOut(
        id=user.id,
        email=user.email,
        name=user.name,
        has_password=bool(user.pw_hash),
    )


def _document_root(user_id: int) -> Path:
    return Path(settings.storage_dir) / "user-documents" / str(user_id)


def _avatar_root(user_id: int) -> Path:
    return Path(settings.storage_dir) / "user-avatars" / str(user_id)


def _avatar_path(user_id: int) -> Path | None:
    root = _avatar_root(user_id)
    for suffix in AVATAR_MEDIA_TYPES.values():
        candidate = root / f"avatar{suffix}"
        if candidate.is_file():
            return candidate
    return None


def _valid_avatar_signature(data: bytes, media_type: str) -> bool:
    if media_type == "image/jpeg":
        return data.startswith(b"\xff\xd8\xff")
    if media_type == "image/png":
        return data.startswith(b"\x89PNG\r\n\x1a\n")
    if media_type == "image/webp":
        return len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP"
    return False


def _owned_document_path(document: UserDocument, user_id: int) -> Path:
    root = _document_root(user_id).resolve()
    path = (Path(settings.storage_dir) / document.storage_key).resolve()
    if root not in path.parents:
        raise HTTPException(status_code=404, detail="문서를 찾을 수 없어요.")
    return path


async def _get_owned_document(
    session: AsyncSession, document_id: int, user_id: int
) -> UserDocument:
    document = (
        await session.execute(
            select(UserDocument).where(
                UserDocument.id == document_id,
                UserDocument.user_id == user_id,
            )
        )
    ).scalar_one_or_none()
    if document is None:
        raise HTTPException(status_code=404, detail="문서를 찾을 수 없어요.")
    return document


@router.patch("/account", response_model=ProfileAccountOut)
async def update_account(
    body: ProfileUpdateIn,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
):
    """로그인한 사용자의 화면 표시 이름을 수정한다."""
    user.name = body.name
    await session.commit()
    await session.refresh(user)
    return _account_out(user)


def _policy_profile_out(user: User) -> PolicyProfileOut:
    return PolicyProfileOut(
        birth_year=user.birth_year,
        gender=user.gender,
        region_ctpv=user.region_ctpv,
        region_sgg=user.region_sgg,
        has_disability=user.has_disability,
        sensitive_agreed_at=user.sensitive_agreed_at,
    )


@router.get("/policy-profile", response_model=PolicyProfileOut)
async def get_policy_profile(user: User = Depends(get_current_user)):
    """맞춤 제도 조회에 쓰는 프로필. 입력 폼 초기값 채우기용."""
    return _policy_profile_out(user)


@router.patch("/policy-profile", response_model=PolicyProfileOut)
async def update_policy_profile(
    body: PolicyProfileIn,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
):
    """맞춤 제도 조회 프로필을 수정한다.

    부분 수정이라 **요청에 담긴 항목만** 반영한다 — 한 화면에서 일부만 고쳐 보내도
    나머지가 지워지지 않게. 명시적으로 null을 보내면 그 항목은 지운다.
    """
    sent = body.model_fields_set
    for field in ("birth_year", "gender", "region_ctpv", "region_sgg"):
        if field in sent:
            setattr(user, field, getattr(body, field))

    if "has_disability" in sent:
        # 민감정보(개인정보보호법 §23) — 별도 동의 없이는 저장하지 않는다.
        if body.has_disability is not None and not body.sensitive_agreed:
            raise HTTPException(
                status_code=400,
                detail="장애 여부는 민감정보라 별도 동의가 필요해요.",
            )
        user.has_disability = body.has_disability
        # 철회(null)하면 동의 기록도 함께 지운다 — 값이 없는데 동의 시각만 남으면
        # 동의한 적 있는 사용자로 보인다.
        user.sensitive_agreed_at = (
            datetime.now(UTC) if body.has_disability is not None else None
        )

    await session.commit()
    await session.refresh(user)
    return _policy_profile_out(user)


@router.put("/password", status_code=204)
async def change_password(
    body: PasswordChangeIn,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
):
    """이메일·비밀번호 계정의 비밀번호를 현재 비밀번호 확인 후 변경한다."""
    if not user.pw_hash:
        raise HTTPException(status_code=409, detail="소셜 로그인 계정은 연결된 서비스에서 비밀번호를 관리해주세요.")
    if not verify_password(body.current_password, user.pw_hash):
        raise HTTPException(status_code=400, detail="현재 비밀번호가 올바르지 않아요.")
    if verify_password(body.new_password, user.pw_hash):
        raise HTTPException(status_code=400, detail="새 비밀번호는 현재 비밀번호와 다르게 입력해주세요.")

    user.pw_hash = hash_password(body.new_password)
    await session.commit()
    return Response(status_code=204)


@router.get("/avatar")
async def get_avatar(user: User = Depends(get_current_user)):
    """로그인한 사용자의 프로필 이미지만 반환한다.

    이미지를 안 올린 상태는 오류가 아니라 정상이므로 204로 답한다. 404로 두면
    브라우저 콘솔에 매 진입마다 빨간 에러가 찍혀, 정작 봐야 할 오류가 묻힌다.
    """
    path = _avatar_path(user.id)
    if path is None:
        return Response(status_code=204)
    media_type = next(
        media_type
        for media_type, suffix in AVATAR_MEDIA_TYPES.items()
        if suffix == path.suffix.lower()
    )
    return FileResponse(path, media_type=media_type)


@router.post("/avatar", status_code=204)
async def upload_avatar(
    file: UploadFile = File(...),
    user: User = Depends(get_current_user),
):
    """로그인한 사용자의 프로필 이미지를 전용 저장소에 교체 저장한다."""
    media_type = (file.content_type or "").lower()
    suffix = AVATAR_MEDIA_TYPES.get(media_type)
    if suffix is None:
        raise HTTPException(status_code=400, detail="JPG, PNG, WEBP 이미지만 등록할 수 있어요.")
    if file.size is not None and file.size > MAX_AVATAR_BYTES:
        raise HTTPException(status_code=413, detail="프로필 이미지는 최대 5MB까지 등록할 수 있어요.")

    data = await file.read(MAX_AVATAR_BYTES + 1)
    if len(data) > MAX_AVATAR_BYTES:
        raise HTTPException(status_code=413, detail="프로필 이미지는 최대 5MB까지 등록할 수 있어요.")
    if not _valid_avatar_signature(data, media_type):
        raise HTTPException(status_code=400, detail="올바른 이미지 파일인지 확인해주세요.")

    root = _avatar_root(user.id)
    root.mkdir(parents=True, exist_ok=True)
    final_path = root / f"avatar{suffix}"
    temp_path = root / f".{uuid4().hex}.upload"
    try:
        temp_path.write_bytes(data)
        os.replace(temp_path, final_path)
        for old_suffix in AVATAR_MEDIA_TYPES.values():
            old_path = root / f"avatar{old_suffix}"
            if old_path != final_path:
                old_path.unlink(missing_ok=True)
    except Exception:
        temp_path.unlink(missing_ok=True)
        raise
    return Response(status_code=204)


@router.get("/documents", response_model=list[UserDocumentOut])
async def list_documents(
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
):
    rows = (
        await session.execute(
            select(UserDocument)
            .where(UserDocument.user_id == user.id)
            .order_by(UserDocument.created_at.desc(), UserDocument.id.desc())
        )
    ).scalars()
    return list(rows)


@router.post("/documents", response_model=UserDocumentOut, status_code=201)
async def upload_document(
    kind: DocumentKind = Form(...),
    file: UploadFile = File(...),
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
):
    filename = (file.filename or "document.pdf").strip() or "document.pdf"
    is_pdf = file.content_type == "application/pdf" or filename.lower().endswith(".pdf")
    if not is_pdf:
        raise HTTPException(status_code=400, detail="PDF 파일만 업로드할 수 있어요.")
    if file.size is not None and file.size > MAX_PDF_BYTES:
        raise HTTPException(status_code=413, detail="PDF는 최대 8MB까지 업로드할 수 있어요.")

    data = await file.read(MAX_PDF_BYTES + 1)
    if len(data) > MAX_PDF_BYTES:
        raise HTTPException(status_code=413, detail="PDF는 최대 8MB까지 업로드할 수 있어요.")
    if not data.startswith(b"%PDF-"):
        raise HTTPException(status_code=400, detail="올바른 PDF 파일인지 확인해주세요.")

    root = _document_root(user.id)
    root.mkdir(parents=True, exist_ok=True)
    stored_name = f"{uuid4().hex}.pdf"
    final_path = root / stored_name
    temp_path = root / f".{stored_name}.upload"
    storage_key = final_path.relative_to(Path(settings.storage_dir)).as_posix()

    try:
        temp_path.write_bytes(data)
        os.replace(temp_path, final_path)
        document = UserDocument(
            user_id=user.id,
            kind=kind,
            original_name=filename[:255],
            storage_key=storage_key,
            mime_type="application/pdf",
            size_bytes=len(data),
        )
        session.add(document)
        await session.commit()
        await session.refresh(document)
        return document
    except Exception:
        await session.rollback()
        temp_path.unlink(missing_ok=True)
        final_path.unlink(missing_ok=True)
        raise


@router.get("/documents/{document_id}/download")
async def download_document(
    document_id: int,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
):
    document = await _get_owned_document(session, document_id, user.id)
    path = _owned_document_path(document, user.id)
    if not path.is_file():
        raise HTTPException(status_code=404, detail="저장된 파일을 찾을 수 없어요.")
    return FileResponse(path, media_type=document.mime_type, filename=document.original_name)


@router.delete("/documents/{document_id}", status_code=204)
async def delete_document(
    document_id: int,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
):
    document = await _get_owned_document(session, document_id, user.id)
    path = _owned_document_path(document, user.id)
    await session.delete(document)
    await session.commit()
    try:
        path.unlink(missing_ok=True)
    except OSError:
        logger.warning("사용자 문서 파일 삭제 실패: %s", path, exc_info=True)
    return Response(status_code=204)
