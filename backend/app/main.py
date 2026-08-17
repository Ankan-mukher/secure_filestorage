from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.database.database import Base, engine
from app.models.user import User
from app.models.file import File
from app.routes.auth import router as auth_router
from app.routes.test_auth import router as test_auth_router
from app.routes.files import router as files_router
from app.routes.folders import router as folders_router

# Load Cloudinary configuration
from app import cloudinary_config


print("REGISTERED TABLES:", Base.metadata.tables.keys())

Base.metadata.create_all(bind=engine)


app = FastAPI(
    title="AROKHHO",
    description="Secure file storage service built for the Full Stack Engineer assignment.",
    version="1.0.0",
)


app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "https://secure-filestorage.vercel.app",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


app.include_router(auth_router)
app.include_router(test_auth_router)
app.include_router(files_router)
app.include_router(folders_router)


@app.get("/")
def root():
    return {
        "message": "Secure File Storage API is running"
    }


@app.get("/health")
def health_check():
    try:
        with engine.connect():
            return {
                "status": "healthy",
                "database": "connected"
            }

    except Exception as e:
        return {
            "status": "unhealthy",
            "database": "disconnected",
            "error": str(e)
        }