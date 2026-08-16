import os
import uuid
from typing import Optional, List

from fastapi import (
    APIRouter,
    Depends,
    File as FastAPIFile,
    HTTPException,
    UploadFile,
    status,
    Query,
    Header,
)
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from jose import jwt, JWTError

from app.core.dependencies import get_current_user
from app.core.security import SECRET_KEY, ALGORITHM
from app.database.database import get_db
from app.models.file import File
from app.models.user import User
from app.models.folder import Folder
from app.schemas.file import FileResponse as FileSchema, FileUpdate


router = APIRouter(
    prefix="/files",
    tags=["Files"]
)


UPLOAD_DIR = "uploads"
MAX_FILE_SIZE = 100 * 1024 * 1024  # 100 MB

os.makedirs(UPLOAD_DIR, exist_ok=True)


# Helper function to authenticate user via Header or Query Param
# Used for direct downloads and public files
def get_user_from_token_or_param(
    db: Session = Depends(get_db),
    authorization: Optional[str] = Header(None),
    token: Optional[str] = Query(None)
) -> Optional[User]:

    jwt_token = None

    if authorization and authorization.startswith("Bearer "):
        jwt_token = authorization.split(" ")[1]

    elif token:
        jwt_token = token

    if not jwt_token:
        return None

    try:
        payload = jwt.decode(
            jwt_token,
            SECRET_KEY,
            algorithms=[ALGORITHM]
        )

        user_id = payload.get("sub")

        if not user_id:
            return None

        return db.query(User).filter(
            User.id == int(user_id)
        ).first()

    except JWTError:
        return None


@router.post(
    "/upload",
    response_model=FileSchema,
    status_code=status.HTTP_201_CREATED
)
def upload_file(
    file: UploadFile = FastAPIFile(...),
    folder_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):

    if not file.filename:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Filename is required"
        )

    # Validate folder ownership if folder_id is provided
    if folder_id is not None:
        folder = (
            db.query(Folder)
            .filter(
                Folder.id == folder_id,
                Folder.owner_id == current_user.id
            )
            .first()
        )

        if not folder:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Folder not found or does not belong to you"
            )

    stored_filename = f"{uuid.uuid4()}_{file.filename}"
    file_path = os.path.join(UPLOAD_DIR, stored_filename)

    total_size = 0

    try:
        with open(file_path, "wb") as buffer:

            while True:
                chunk = file.file.read(1024 * 1024)

                if not chunk:
                    break

                total_size += len(chunk)

                if total_size > MAX_FILE_SIZE:

                    buffer.close()

                    if os.path.exists(file_path):
                        os.remove(file_path)

                    raise HTTPException(
                        status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                        detail="File size cannot exceed 100 MB"
                    )

                buffer.write(chunk)

    except HTTPException:
        raise

    except Exception as e:

        if os.path.exists(file_path):
            os.remove(file_path)

        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to upload file"
        ) from e

    new_file = File(
        filename=file.filename,
        stored_filename=stored_filename,
        file_path=file_path,
        content_type=file.content_type,
        file_size=total_size,
        owner_id=current_user.id,
        folder_id=folder_id,
        is_public=False
    )

    db.add(new_file)
    db.commit()
    db.refresh(new_file)

    return new_file


@router.get(
    "",
    response_model=List[FileSchema]
)
def list_files(
    search: Optional[str] = Query(None),
    category: Optional[str] = Query(None),
    folder_id: Optional[int] = Query(None),
    sort_by: str = Query("created_at"),
    sort_order: str = Query("desc"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):

    query = db.query(File).filter(
        File.owner_id == current_user.id
    )

    # Filter by folder
    if folder_id is not None:

        if folder_id == -1:
            query = query.filter(File.folder_id == None)

        else:
            query = query.filter(
                File.folder_id == folder_id
            )

    # Filter by search term
    if search:
        query = query.filter(
            File.filename.ilike(f"%{search}%")
        )

    # Filter by category
    if category:

        if category == "image":
            query = query.filter(
                File.content_type.like("image/%")
            )

        elif category == "video":
            query = query.filter(
                File.content_type.like("video/%")
            )

        elif category == "audio":
            query = query.filter(
                File.content_type.like("audio/%")
            )

        elif category == "document":
            query = query.filter(
                (File.content_type.like("text/%")) |
                (File.content_type == "application/pdf") |
                (File.content_type.like("application/vnd.%")) |
                (File.content_type == "application/msword")
            )

        elif category == "other":
            query = query.filter(
                ~File.content_type.like("image/%"),
                ~File.content_type.like("video/%"),
                ~File.content_type.like("audio/%"),
                ~File.content_type.like("text/%"),
                File.content_type != "application/pdf",
                ~File.content_type.like("application/vnd.%"),
                File.content_type != "application/msword"
            )

    # Validate sorting column
    sort_attr = getattr(
        File,
        sort_by,
        File.created_at
    )

    if sort_order == "desc":
        query = query.order_by(sort_attr.desc())

    else:
        query = query.order_by(sort_attr.asc())

    return query.all()


# PUBLIC / PRIVATE FILE METADATA
@router.get(
    "/{file_id}",
    response_model=FileSchema
)
def get_file_metadata(
    file_id: int,
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(
        get_user_from_token_or_param
    )
):

    file_record = (
        db.query(File)
        .filter(File.id == file_id)
        .first()
    )

    if not file_record:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="File not found"
        )

    # Public files can be viewed by anyone.
    # Private files can only be viewed by their owner.
    if not file_record.is_public:

        if (
            not current_user
            or file_record.owner_id != current_user.id
        ):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Access denied to this file metadata"
            )

    return file_record


@router.delete(
    "/{file_id}",
    status_code=status.HTTP_200_OK
)
def delete_file(
    file_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):

    file_record = (
        db.query(File)
        .filter(File.id == file_id)
        .first()
    )

    if not file_record:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="File not found"
        )

    if file_record.owner_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have permission to delete this file"
        )

    # Delete physical file
    if os.path.exists(file_record.file_path):

        try:
            os.remove(file_record.file_path)

        except Exception:
            pass

    db.delete(file_record)
    db.commit()

    return {
        "message": "File deleted successfully"
    }


@router.patch(
    "/{file_id}/visibility",
    response_model=FileSchema
)
def update_file_visibility(
    file_id: int,
    update_data: FileUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):

    file_record = (
        db.query(File)
        .filter(File.id == file_id)
        .first()
    )

    if not file_record:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="File not found"
        )

    if file_record.owner_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have permission to modify this file"
        )

    if update_data.is_public is not None:
        file_record.is_public = update_data.is_public

    db.commit()
    db.refresh(file_record)

    return file_record


@router.patch(
    "/{file_id}/move",
    response_model=FileSchema
)
def move_file_folder(
    file_id: int,
    update_data: FileUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):

    file_record = (
        db.query(File)
        .filter(File.id == file_id)
        .first()
    )

    if not file_record:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="File not found"
        )

    if file_record.owner_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have permission to modify this file"
        )

    if update_data.folder_id is not None:

        folder = (
            db.query(Folder)
            .filter(
                Folder.id == update_data.folder_id,
                Folder.owner_id == current_user.id
            )
            .first()
        )

        if not folder:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Folder not found or does not belong to you"
            )

        file_record.folder_id = update_data.folder_id

    else:
        file_record.folder_id = None

    db.commit()
    db.refresh(file_record)

    return file_record


# PUBLIC / PRIVATE DOWNLOAD
@router.get("/{file_id}/download")
def download_file(
    file_id: int,
    db: Session = Depends(get_db),
    user: Optional[User] = Depends(
        get_user_from_token_or_param
    )
):

    file_record = (
        db.query(File)
        .filter(File.id == file_id)
        .first()
    )

    if not file_record:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="File not found"
        )

    # Private files require authentication and ownership.
    # Public files can be downloaded anonymously.
    if not file_record.is_public:

        if (
            not user
            or file_record.owner_id != user.id
        ):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You do not have permission to access this private file"
            )

    # Make sure physical file still exists
    if not os.path.exists(file_record.file_path):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Physical file does not exist on disk"
        )

    # Security headers
    headers = {
        "X-Content-Type-Options": "nosniff"
    }

    # Images, videos and PDFs can be viewed inline.
    # Everything else is downloaded.
    is_inline_type = (
        file_record.content_type
        and (
            file_record.content_type.startswith("image/")
            or file_record.content_type.startswith("video/")
            or file_record.content_type == "application/pdf"
        )
    )

    disposition = (
        "inline"
        if is_inline_type
        else "attachment"
    )

    return FileResponse(
        path=file_record.file_path,
        media_type=file_record.content_type,
        filename=file_record.filename,
        headers=headers,
        content_disposition_type=disposition
    )