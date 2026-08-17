import uuid
from typing import Optional, List

import cloudinary.uploader

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
from fastapi.responses import RedirectResponse
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


MAX_FILE_SIZE = 100 * 1024 * 1024  # 100 MB


# ============================================================
# AUTHENTICATION HELPER
# ============================================================

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

    except (JWTError, ValueError, TypeError):
        return None


# ============================================================
# UPLOAD FILE
# ============================================================

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

    # Validate folder ownership
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

    try:

        file.file.seek(0)

        upload_result = cloudinary.uploader.upload(
            file.file,
            resource_type="auto",
            public_id=stored_filename,
            folder="secure-file-storage"
        )

        file_path = upload_result["secure_url"]

        total_size = upload_result.get("bytes", 0)

        # Enforce 100 MB limit
        if total_size > MAX_FILE_SIZE:

            try:
                cloudinary.uploader.destroy(
                    upload_result["public_id"],
                    resource_type=upload_result.get(
                        "resource_type",
                        "image"
                    )
                )
            except Exception:
                pass

            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail="File size cannot exceed 100 MB"
            )

    except HTTPException:
        raise

    except Exception as e:

        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to upload file to Cloudinary"
        ) from e

    # Save metadata in database
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


# ============================================================
# LIST FILES
# ============================================================

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

    # Folder filter
    if folder_id is not None:

        if folder_id == -1:
            query = query.filter(File.folder_id == None)

        else:
            query = query.filter(
                File.folder_id == folder_id
            )

    # Search filter
    if search:
        query = query.filter(
            File.filename.ilike(f"%{search}%")
        )

    # Category filter
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

    # Sorting
    sort_attr = getattr(
        File,
        sort_by,
        File.created_at
    )

    if sort_order == "desc":

        query = query.order_by(
            sort_attr.desc()
        )

    else:

        query = query.order_by(
            sort_attr.asc()
        )

    return query.all()


# ============================================================
# GET FILE METADATA
# ============================================================

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

    # Private files require owner authentication
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


# ============================================================
# DELETE FILE
# ============================================================

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

    # Delete from Cloudinary
    try:

        public_id = (
            f"secure-file-storage/"
            f"{file_record.stored_filename}"
        )

        # Try image resource type
        try:

            cloudinary.uploader.destroy(
                public_id,
                resource_type="image"
            )

        except Exception:
            pass

        # Try raw resource type
        try:

            cloudinary.uploader.destroy(
                public_id,
                resource_type="raw"
            )

        except Exception:
            pass

        # Try video resource type
        try:

            cloudinary.uploader.destroy(
                public_id,
                resource_type="video"
            )

        except Exception:
            pass

    except Exception:
        pass

    # Delete database record
    db.delete(file_record)
    db.commit()

    return {
        "message": "File deleted successfully"
    }


# ============================================================
# UPDATE FILE VISIBILITY
# ============================================================

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


# ============================================================
# MOVE FILE TO FOLDER
# ============================================================

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


# ============================================================
# DOWNLOAD FILE
# ============================================================

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

    # Private files require authentication
    if not file_record.is_public:

        if (
            not user
            or file_record.owner_id != user.id
        ):

            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You do not have permission to access this private file"
            )

    # Make sure Cloudinary URL exists
    if not file_record.file_path:

        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Cloudinary file URL does not exist"
        )

    # Redirect directly to Cloudinary
    return RedirectResponse(
        url=file_record.file_path,
        status_code=status.HTTP_307_TEMPORARY_REDIRECT
    )
    
@router.get("/debug/paths")
def debug_file_paths(
    db: Session = Depends(get_db)
):
    files = db.query(File).all()

    return [
        {
            "id": file.id,
            "filename": file.filename,
            "file_path": file.file_path,
            "stored_filename": file.stored_filename,
        }
        for file in files
    ]