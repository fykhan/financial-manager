"""Single-user auth: argon2 password check + JWT in an httpOnly cookie.

Credentials live in env vars (AUTH_USERNAME, AUTH_PASSWORD_HASH) — there's no
users table. Rotating JWT_SECRET is the documented kill switch: it invalidates
every outstanding session at once.
"""

import hmac
import os
from datetime import datetime, timedelta, timezone

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError
from fastapi import APIRouter, Cookie, Depends, HTTPException, Request, Response
from pydantic import BaseModel
from sqlmodel import Session, select

from backend.db import get_session
from backend.models import LoginAttempt

COOKIE_NAME = "gradplan_session"
SESSION_DAYS = 30
REISSUE_AFTER = timedelta(days=1)
THROTTLE_WINDOW = timedelta(minutes=15)
THROTTLE_MAX_FAILURES = 10

# Browsers refuse to store a Secure cookie over plain http://, which is what
# local uvicorn serves. Vercel is HTTPS-only, so this is safe to gate on it.
_SECURE_COOKIES = bool(os.getenv("VERCEL"))

_hasher = PasswordHasher()


def verify_credentials(username: str, password: str) -> bool:
    expected_username = os.environ["AUTH_USERNAME"]
    password_hash = os.environ["AUTH_PASSWORD_HASH"]
    if not username or not password:
        return False
    if not hmac.compare_digest(username, expected_username):
        # still run the hash verify so failed-username and failed-password
        # attempts take roughly the same time
        try:
            _hasher.verify(password_hash, password)
        except VerifyMismatchError:
            pass
        return False
    try:
        return _hasher.verify(password_hash, password)
    except VerifyMismatchError:
        return False


def _jwt_secret() -> str:
    return os.environ["JWT_SECRET"]


def issue_token() -> str:
    now = datetime.now(timezone.utc)
    payload = {"iat": now.timestamp(), "exp": (now + timedelta(days=SESSION_DAYS)).timestamp()}
    return jwt.encode(payload, _jwt_secret(), algorithm="HS256")


def set_session_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        COOKIE_NAME,
        token,
        max_age=SESSION_DAYS * 24 * 3600,
        httponly=True,
        secure=_SECURE_COOKIES,
        samesite="lax",
        path="/",
    )


def clear_session_cookie(response: Response) -> None:
    response.delete_cookie(COOKIE_NAME, path="/")


def check_throttle(session: Session, ip: str) -> None:
    since = datetime.now(timezone.utc) - THROTTLE_WINDOW
    failures = session.exec(
        select(LoginAttempt).where(
            LoginAttempt.ip == ip,
            LoginAttempt.success == False,  # noqa: E712
            LoginAttempt.at >= since,
        )
    ).all()
    if len(failures) >= THROTTLE_MAX_FAILURES:
        raise HTTPException(status_code=429, detail="Too many attempts, try again later")


def record_attempt(session: Session, ip: str, success: bool) -> None:
    session.add(LoginAttempt(ip=ip, success=success))
    session.commit()


def has_valid_session(token: str | None) -> bool:
    if not token:
        return False
    try:
        jwt.decode(token, _jwt_secret(), algorithms=["HS256"])
    except jwt.PyJWTError:
        return False
    return True


def require_auth(
    response: Response,
    gradplan_session: str | None = Cookie(default=None, alias=COOKIE_NAME),
) -> None:
    if not gradplan_session:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = jwt.decode(gradplan_session, _jwt_secret(), algorithms=["HS256"])
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Not authenticated")

    issued_at = datetime.fromtimestamp(payload["iat"], tz=timezone.utc)
    if datetime.now(timezone.utc) - issued_at > REISSUE_AFTER:
        set_session_cookie(response, issue_token())


router = APIRouter(prefix="/api/auth", tags=["auth"])


class LoginBody(BaseModel):
    username: str
    password: str


def _client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


@router.post("/login")
def login(
    body: LoginBody,
    request: Request,
    response: Response,
    session: Session = Depends(get_session),
):
    ip = _client_ip(request)
    check_throttle(session, ip)

    ok = verify_credentials(body.username, body.password)
    record_attempt(session, ip, ok)
    if not ok:
        raise HTTPException(status_code=401, detail="Invalid username or password")

    set_session_cookie(response, issue_token())
    return {"ok": True}


@router.post("/logout")
def logout(response: Response):
    clear_session_cookie(response)
    return {"ok": True}


@router.get("/me")
def me(_: None = Depends(require_auth)):
    return {"ok": True}
