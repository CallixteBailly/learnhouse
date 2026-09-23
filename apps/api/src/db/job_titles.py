# apps/api/src/db/job_titles.py
from typing import Optional

from sqlmodel import Field, SQLModel


class JobTitleBase(SQLModel):
    label: str
    slug: str
    is_active: bool = True
    sort_order: int = 0


class JobTitle(JobTitleBase, table=True):
    __table_args__ = {"extend_existing": True}
    id: Optional[int] = Field(default=None, primary_key=True)
    creation_date: str = ""
    update_date: str = ""


class JobTitleCreate(SQLModel):
    label: str
    slug: Optional[str] = None  # derived from label when omitted
    sort_order: int = 0


class JobTitleUpdate(SQLModel):
    label: Optional[str] = None
    sort_order: Optional[int] = None
    is_active: Optional[bool] = None


class JobTitleRead(JobTitleBase):
    id: int
