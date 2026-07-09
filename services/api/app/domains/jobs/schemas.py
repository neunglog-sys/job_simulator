from pydantic import BaseModel


class JobOut(BaseModel):
    code: str
    title: str
    description: str
    competencies: dict

    model_config = {"from_attributes": True}


class KnowledgeChunkOut(BaseModel):
    source: str
    content: str

    model_config = {"from_attributes": True}
