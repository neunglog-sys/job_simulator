from datetime import datetime
from typing import Literal

from pydantic import BaseModel


DocumentKind = Literal["resume", "portfolio", "other"]


class UserDocumentOut(BaseModel):
    id: int
    kind: DocumentKind
    original_name: str
    mime_type: str
    size_bytes: int
    created_at: datetime

    model_config = {"from_attributes": True}
