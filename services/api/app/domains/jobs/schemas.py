from pydantic import BaseModel


class JobOut(BaseModel):
    code: str
    title: str
    description: str
    competencies: dict
    # 배치1 조사 필드(선택) — 미조사 직무는 None/빈 리스트. docs/jobs/batch1_mapping_candidates.md
    education_requirement: dict | None = None
    salary: dict | None = None
    certifications: list = []
    status: str | None = None

    model_config = {"from_attributes": True}


class KnowledgeChunkOut(BaseModel):
    source: str
    content: str

    model_config = {"from_attributes": True}
