from datetime import datetime
from typing import Optional
from pydantic import BaseModel


class FileResponse(BaseModel):
    id: int
    filename: str
    stored_filename: str
    content_type: Optional[str] = None
    file_size: int
    is_public: bool
    owner_id: int
    folder_id: Optional[int] = None
    created_at: datetime

    class Config:
        from_attributes = True


class FileUpdate(BaseModel):
    is_public: Optional[bool] = None
    folder_id: Optional[int] = None
