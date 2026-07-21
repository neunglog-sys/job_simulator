import logging
import os
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.db import get_session
from app.core.deps import get_current_user
from app.domains.profile.schemas import DocumentKind, UserDocumentOut
from app.models import User, UserDocument

router = APIRouter(prefix="/api/profile", tags=["profile"])
logger = logging.getLogger(__name__)

MAX_PDF_BYTES = 8 * 1024 * 1024


def _document_root(user_id: int) -> Path:
    return Path(settings.storage_dir) / "user-documents" / str(user_id)


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
