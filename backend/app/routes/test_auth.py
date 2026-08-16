from fastapi import APIRouter, Depends

from app.core.dependencies import get_current_user
from app.models.user import User


router = APIRouter(
    prefix="/test",
    tags=["Testing"]
)


@router.get("/protected")
def protected_route(
    current_user: User = Depends(get_current_user)
):
    return {
        "message": "You are authenticated",
        "user_id": current_user.id,
        "email": current_user.email
    }