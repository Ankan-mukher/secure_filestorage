from datetime import datetime

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    Integer,
    String,
)
from sqlalchemy.orm import relationship

from app.database.database import Base


class File(Base):
    __tablename__ = "files"

    id = Column(
        Integer,
        primary_key=True,
        index=True
    )

    filename = Column(
        String,
        nullable=False
    )

    stored_filename = Column(
        String,
        unique=True,
        nullable=False
    )

    file_path = Column(
        String,
        nullable=False
    )

    content_type = Column(
        String,
        nullable=True
    )

    file_size = Column(
        Integer,
        nullable=False
    )

    is_public = Column(
        Boolean,
        default=False,
        nullable=False
    )

    owner_id = Column(
        Integer,
        ForeignKey("users.id"),
        nullable=False,
        index=True
    )

    created_at = Column(
        DateTime,
        default=datetime.utcnow,
        nullable=False
    )

    owner = relationship(
        "User",
        back_populates="files"
    )

    folder_id = Column(
        Integer,
        ForeignKey("folders.id", ondelete="SET NULL"),
        nullable=True,
        index=True
    )

    folder = relationship(
        "Folder",
        back_populates="files"
    )