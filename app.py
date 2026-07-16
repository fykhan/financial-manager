import os

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

load_dotenv()

app = FastAPI()

from backend.auth import router as auth_router  # noqa: E402
from backend.routes import router as data_router  # noqa: E402

app.include_router(auth_router)
app.include_router(data_router)

# Mounted last: Starlette matches routes in registration order, so /api/*
# above wins even though this mount's prefix is "/". Vercel's CDN serves
# public/ directly and only routes /api/* to this function; locally there's
# no CDN, so uvicorn needs to serve both.
if not os.getenv("VERCEL"):
    app.mount("/", StaticFiles(directory="public", html=True), name="static")
