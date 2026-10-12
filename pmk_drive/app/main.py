import hashlib
import hmac
import math
import os
import secrets
import sqlite3
import time
import unicodedata
import uuid
from contextlib import asynccontextmanager, contextmanager
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urlsplit

from botocore.exceptions import BotoCoreError, ClientError
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

from .storage import GCSStorage, LocalStorage, S3Storage
from google.api_core.exceptions import GoogleAPIError

load_dotenv()


@dataclass
class Settings:
    data_dir: Path = field(default_factory=lambda: Path(os.getenv("DATA_DIR", "data")))
    base_path: str = os.getenv("BASE_PATH", "/pmk_drive")
    app_url: str = os.getenv("APP_URL", "http://127.0.0.1:8090/pmk_drive")
    backend: str = os.getenv("STORAGE_BACKEND", "local")
    bucket: str = os.getenv("GCS_BUCKET", os.getenv("S3_BUCKET", ""))
    endpoint: str = os.getenv("S3_ENDPOINT_URL", "")
    region: str = os.getenv("AWS_DEFAULT_REGION", "ap-northeast-2")
    addressing_style: str = os.getenv("S3_ADDRESSING_STYLE", "auto")
    admin_username: str = os.getenv("PMK_ADMIN_USERNAME", "admin")
    admin_password_hash: str = os.getenv("PMK_ADMIN_PASSWORD_HASH", "")
    admin_password: str = os.getenv("PMK_ADMIN_PASSWORD", "")
    max_file_size: int = int(os.getenv("MAX_FILE_SIZE", str(100 * 1024**3)))


SCHEMA = """
CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL,
 display_name TEXT NOT NULL, password TEXT NOT NULL, role TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id), expires INTEGER);
CREATE TABLE IF NOT EXISTS attempts(key TEXT NOT NULL, created INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS attempts_time ON attempts(created);
CREATE TABLE IF NOT EXISTS nodes(id TEXT PRIMARY KEY, parent_id TEXT REFERENCES nodes(id),
 name TEXT NOT NULL, kind TEXT NOT NULL, size INTEGER NOT NULL DEFAULT 0, mime TEXT,
 owner_id TEXT REFERENCES users(id), created INTEGER NOT NULL, updated INTEGER NOT NULL,
 status TEXT NOT NULL DEFAULT 'ready', trash_batch TEXT);
CREATE UNIQUE INDEX IF NOT EXISTS sibling_name ON nodes(COALESCE(parent_id,''), name) WHERE trash_batch IS NULL;
CREATE INDEX IF NOT EXISTS node_parent ON nodes(parent_id);
CREATE TABLE IF NOT EXISTS uploads(node_id TEXT PRIMARY KEY REFERENCES nodes(id),
 upload_id TEXT NOT NULL, part_size INTEGER NOT NULL, fingerprint TEXT NOT NULL, backend TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS stars(user_id TEXT REFERENCES users(id), node_id TEXT REFERENCES nodes(id), PRIMARY KEY(user_id,node_id));
CREATE TABLE IF NOT EXISTS shares(id TEXT PRIMARY KEY, node_id TEXT REFERENCES nodes(id),
 token TEXT UNIQUE NOT NULL, expires INTEGER NOT NULL, created INTEGER NOT NULL);
"""


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def password_hash(value, salt=None):
    salt = salt or secrets.token_hex(16)
    hashed = hashlib.scrypt(value.encode(), salt=salt.encode(), n=16384, r=8, p=1).hex()
    return salt + ":" + hashed


def clean_name(name):
    name = unicodedata.normalize("NFC", name.strip())
    if not name or name in (".", "..") or len(name.encode()) > 240 or any(ord(c) < 32 or c in "/\\" for c in name):
        raise HTTPException(400, "이름은 1~240바이트여야 하며 /, \\ 또는 제어 문자를 포함할 수 없습니다.")
    return name


class Login(BaseModel):
    username: str = Field(min_length=1, max_length=80)
    password: str = Field(min_length=1, max_length=256)


class Member(Login):
    display_name: str = Field(min_length=1, max_length=80)


class Folder(BaseModel):
    name: str = Field(max_length=240)
    parent_id: str | None = None


class Edit(BaseModel):
    name: str | None = Field(default=None, max_length=240)
    parent_id: str | None = None


class Upload(Folder):
    size: int = Field(ge=0)
    mime: str = Field(default="application/octet-stream", max_length=200)
    fingerprint: str = Field(min_length=1, max_length=200)


class Share(BaseModel):
    days: int = Field(default=7, ge=1, le=30)


def create_app(settings=None):
    cfg = settings or Settings()
    cfg.data_dir = Path(cfg.data_dir)
    if cfg.backend not in ("local", "s3", "gcs"):
        raise RuntimeError("STORAGE_BACKEND must be local, s3 or gcs")
    if cfg.backend != "local" and not cfg.bucket:
        raise RuntimeError("GCS_BUCKET or S3_BUCKET is required")
    if not cfg.base_path.startswith("/") or cfg.base_path.endswith("/"):
        raise RuntimeError("BASE_PATH must start with / and have no trailing slash")
    cfg.data_dir.mkdir(parents=True, exist_ok=True)
    database = cfg.data_dir / "drive.sqlite3"

    @contextmanager
    def db(write=False):
        conn = sqlite3.connect(database, timeout=60)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys=ON")
        try:
            if write:
                conn.execute("BEGIN IMMEDIATE")
            yield conn
            conn.commit()
        except BaseException:
            conn.rollback()
            raise
        finally:
            conn.close()

    with db() as conn:
        conn.execute("PRAGMA journal_mode=WAL")
        conn.executescript(SCHEMA)
        if not conn.execute("SELECT 1 FROM users LIMIT 1").fetchone():
            if not cfg.admin_password_hash and len(cfg.admin_password) < 12:
                raise RuntimeError("Set PMK_ADMIN_PASSWORD to at least 12 characters before first startup")
            conn.execute("INSERT INTO users VALUES(?,?,?,?,?)", (uuid.uuid4().hex, cfg.admin_username,
                         "관리자", cfg.admin_password_hash or password_hash(cfg.admin_password), "admin"))
        conn.execute("DELETE FROM sessions WHERE expires<?", (int(time.time()),))

    store = {"local": lambda: LocalStorage(cfg.data_dir), "s3": lambda: S3Storage(cfg), "gcs": lambda: GCSStorage(cfg)}[cfg.backend]()
    api = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
    outer = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
    outer.state.storage = store
    outer.state.settings = cfg
    outer.state.db = db

    @api.middleware("http")
    async def protect(request, call_next):
        if request.method not in ("GET", "HEAD", "OPTIONS"):
            origin = request.headers.get("origin")
            url = urlsplit(cfg.app_url)
            if request.headers.get("x-pmk-request") != "1" or (origin and origin != f"{url.scheme}://{url.netloc}"):
                return JSONResponse({"detail": "허용되지 않은 요청입니다."}, status_code=403)
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Content-Security-Policy"] = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' https: http://127.0.0.1:* http://localhost:*; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
        if not request.url.path.endswith((".css", ".js", ".svg")):
            response.headers["Cache-Control"] = "no-store"
        return response

    @api.exception_handler(sqlite3.IntegrityError)
    async def conflict(request, exc):
        return JSONResponse({"detail": "같은 위치에 동일한 이름이 있습니다. 이름을 변경해 주세요."}, status_code=409)

    @api.exception_handler(GoogleAPIError)
    @api.exception_handler(ClientError)
    @api.exception_handler(BotoCoreError)
    async def storage_error(request, exc):
        return JSONResponse({"detail": "스토리지 요청에 실패했습니다. 연결 설정을 확인하거나 다시 시도해 주세요."}, status_code=502)

    def user(request: Request):
        token = request.cookies.get("pmk_session", "")
        with db() as conn:
            found = conn.execute("SELECT u.id,u.username,u.display_name,u.role FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires>?",
                                 (digest(token), int(time.time()))).fetchone()
        if not found:
            raise HTTPException(401, "로그인이 필요합니다.")
        return dict(found)

    def node(conn, node_id, active=True):
        found = conn.execute("SELECT * FROM nodes WHERE id=?", (node_id,)).fetchone()
        if not found or (active and (found["trash_batch"] or found["status"] != "ready")):
            raise HTTPException(404, "파일 또는 폴더를 찾을 수 없습니다.")
        return dict(found)

    def folder(conn, node_id):
        if node_id is not None:
            found = node(conn, node_id)
            if found["kind"] != "folder":
                raise HTTPException(400, "대상은 폴더여야 합니다.")

    def descendants(conn, node_id):
        return [r[0] for r in conn.execute("WITH RECURSIVE tree(id) AS (SELECT id FROM nodes WHERE id=? UNION ALL SELECT n.id FROM nodes n JOIN tree t ON n.parent_id=t.id) SELECT id FROM tree", (node_id,))]

    def upload_node(conn, upload_id, person, allow_ready=False):
        found = conn.execute("SELECT n.*,u.upload_id,u.part_size,u.fingerprint,u.backend FROM nodes n JOIN uploads u ON n.id=u.node_id WHERE n.id=?", (upload_id,)).fetchone()
        if not found or found["owner_id"] != person["id"] or found["trash_batch"] or (found["status"] != "uploading" and not allow_ready):
            raise HTTPException(404, "진행 중인 업로드가 없습니다.")
        if found["backend"] != cfg.backend:
            raise HTTPException(409, "스토리지가 변경되어 업로드를 재개할 수 없습니다.")
        folder(conn, found["parent_id"])
        return dict(found)

    @api.post("/api/login")
    def login(data: Login, request: Request):
        now = int(time.time())
        ip_key = digest(request.client.host if request.client else "unknown")
        name_key = digest(data.username)
        with db(write=True) as conn:
            conn.execute("DELETE FROM attempts WHERE created<?", (now - 900,))
            if conn.execute("SELECT count(*) FROM attempts WHERE key IN (?,?)", (ip_key, name_key)).fetchone()[0] >= 20:
                raise HTTPException(429, "로그인 시도가 너무 많습니다. 15분 후 다시 시도해 주세요.")
            found = conn.execute("SELECT * FROM users WHERE username=?", (data.username,)).fetchone()
            encoded = found["password"] if found else password_hash("dummy-password", "0" * 32)
            if encoded.startswith("pbkdf2:"):
                _, iterations, salt, expected = encoded.split(":")
                actual = hashlib.pbkdf2_hmac("sha256", data.password.encode(), bytes.fromhex(salt), int(iterations)).hex()
                valid = hmac.compare_digest(expected, actual)
            else:
                valid = hmac.compare_digest(encoded, password_hash(data.password, encoded.split(":")[0]))
            if not found or not valid:
                conn.executemany("INSERT INTO attempts VALUES(?,?)", [(ip_key, now), (name_key, now)])
            else:
                token = secrets.token_urlsafe(32)
                conn.execute("INSERT INTO sessions VALUES(?,?,?)", (digest(token), found["id"], now + 86400))
        if not found or not valid:
            raise HTTPException(401, "아이디 또는 비밀번호가 올바르지 않습니다.")
        response = JSONResponse({"ok": True})
        response.set_cookie("pmk_session", token, max_age=86400, httponly=True, secure=cfg.app_url.startswith("https://"), samesite="strict", path=cfg.base_path)
        return response

    @api.post("/api/logout")
    def logout(request: Request, person=Depends(user)):
        with db(write=True) as conn:
            conn.execute("DELETE FROM sessions WHERE token=?", (digest(request.cookies.get("pmk_session", "")),))
        response = JSONResponse({"ok": True})
        response.delete_cookie("pmk_session", path=cfg.base_path)
        return response

    @api.get("/api/me")
    def me(person=Depends(user)):
        return {**person, "storage": cfg.backend, "max_file_size": cfg.max_file_size}

    @api.post("/api/members", status_code=201)
    def add_member(data: Member, person=Depends(user)):
        if person["role"] != "admin":
            raise HTTPException(403, "관리자만 팀원을 추가할 수 있습니다.")
        if len(data.password) < 12:
            raise HTTPException(400, "비밀번호는 12자 이상이어야 합니다.")
        with db(write=True) as conn:
            conn.execute("INSERT INTO users VALUES(?,?,?,?,?)", (uuid.uuid4().hex, data.username.strip(), data.display_name.strip(), password_hash(data.password), "member"))
        return {"ok": True}

    @api.get("/api/nodes")
    def list_nodes(parent_id: str | None = None, view: str = "drive", q: str = "", type: str = "all", person=Depends(user)):
        with db() as conn:
            clauses, args = ["n.status='ready'"], [person["id"]]
            clauses.append("n.trash_batch IS NOT NULL" if view == "trash" else "n.trash_batch IS NULL")
            if view == "starred":
                clauses.append("s.user_id IS NOT NULL")
            elif view == "shared":
                clauses.append("EXISTS(SELECT 1 FROM shares h WHERE h.node_id=n.id AND h.expires>strftime('%s','now'))")
            elif view == "drive" and not q:
                folder(conn, parent_id)
                clauses.append("n.parent_id IS ?")
                args.append(parent_id)
            if q:
                clauses.append("instr(lower(n.name),lower(?))>0")
                args.append(q[:200])
            rows = [dict(r) for r in conn.execute("SELECT n.id,n.parent_id,n.name,n.kind,n.size,n.mime,n.created,n.updated,n.trash_batch,u.display_name AS owner,(s.user_id IS NOT NULL) AS starred FROM nodes n JOIN users u ON n.owner_id=u.id LEFT JOIN stars s ON s.node_id=n.id AND s.user_id=? WHERE " + " AND ".join(clauses) + " ORDER BY n.kind DESC,n.updated DESC LIMIT 2000", args)]
            if type != "all":
                extensions = {"excel": (".xls", ".xlsx", ".csv", ".ods"), "ppt": (".ppt", ".pptx"), "document": (".pdf", ".doc", ".docx", ".txt", ".hwp")}
                rows = [r for r in rows if r["kind"] == "folder" or r["name"].lower().endswith(extensions.get(type, ())) ]
            tree = [dict(r) for r in conn.execute("SELECT id,parent_id,name FROM nodes WHERE kind='folder' AND trash_batch IS NULL ORDER BY name")]
            stats = dict(conn.execute("SELECT coalesce(sum(size),0) AS bytes,count(*) AS files FROM nodes WHERE kind='file' AND status='ready' AND trash_batch IS NULL").fetchone())
            return {"items": rows, "folders": tree, "stats": stats, "limit": 2000}

    @api.post("/api/folders", status_code=201)
    def create_folder(data: Folder, person=Depends(user)):
        now, nid = int(time.time()), uuid.uuid4().hex
        with db(write=True) as conn:
            folder(conn, data.parent_id)
            conn.execute("INSERT INTO nodes(id,parent_id,name,kind,owner_id,created,updated) VALUES(?,?,?,'folder',?,?,?)", (nid, data.parent_id, clean_name(data.name), person["id"], now, now))
        return {"id": nid}

    @api.patch("/api/nodes/{nid}")
    def edit_node(nid: str, data: Edit, person=Depends(user)):
        with db(write=True) as conn:
            found = node(conn, nid)
            name = clean_name(data.name) if data.name is not None else found["name"]
            parent = data.parent_id if "parent_id" in data.model_fields_set else found["parent_id"]
            folder(conn, parent)
            if parent in descendants(conn, nid):
                raise HTTPException(400, "폴더를 자기 자신이나 하위 폴더로 이동할 수 없습니다.")
            conn.execute("UPDATE nodes SET name=?,parent_id=?,updated=? WHERE id=?", (name, parent, int(time.time()), nid))
        return {"ok": True}

    @api.post("/api/nodes/{nid}/star")
    def star(nid: str, person=Depends(user)):
        with db(write=True) as conn:
            node(conn, nid)
            exists = conn.execute("SELECT 1 FROM stars WHERE user_id=? AND node_id=?", (person["id"], nid)).fetchone()
            if exists:
                conn.execute("DELETE FROM stars WHERE user_id=? AND node_id=?", (person["id"], nid))
            else:
                conn.execute("INSERT INTO stars VALUES(?,?)", (person["id"], nid))
        return {"starred": not bool(exists)}

    @api.delete("/api/nodes/{nid}")
    def trash(nid: str, person=Depends(user)):
        with db(write=True) as conn:
            node(conn, nid)
            ids = descendants(conn, nid)
            batch = uuid.uuid4().hex
            for child in ids:
                conn.execute("UPDATE nodes SET trash_batch=?,updated=? WHERE id=? AND trash_batch IS NULL", (batch, int(time.time()), child))
        return {"ok": True}

    @api.post("/api/nodes/{nid}/restore")
    def restore(nid: str, person=Depends(user)):
        with db(write=True) as conn:
            found = node(conn, nid, active=False)
            if not found["trash_batch"]:
                return {"ok": True}
            if found["parent_id"]:
                parent = node(conn, found["parent_id"], active=False)
                if parent["trash_batch"]:
                    raise HTTPException(409, "상위 폴더를 먼저 복원해 주세요.")
            for child in descendants(conn, nid):
                conn.execute("UPDATE nodes SET trash_batch=NULL,updated=? WHERE id=? AND trash_batch=?", (int(time.time()), child, found["trash_batch"]))
        return {"ok": True}

    @api.post("/api/uploads", status_code=201)
    def start_upload(data: Upload, person=Depends(user)):
        if data.size > cfg.max_file_size:
            raise HTTPException(413, "허용된 파일 크기를 초과했습니다.")
        name, nid, now = clean_name(data.name), uuid.uuid4().hex, int(time.time())
        part_size = max(8 * 1024**2, math.ceil(data.size / 10000 / 1024**2) * 1024**2)
        with db(write=True) as conn:
            folder(conn, data.parent_id)
            found = conn.execute("SELECT n.id,n.size,u.part_size,u.fingerprint FROM nodes n JOIN uploads u ON n.id=u.node_id WHERE n.parent_id IS ? AND n.name=? AND n.owner_id=? AND n.status='uploading' AND n.trash_batch IS NULL", (data.parent_id, name, person["id"])).fetchone()
            if found and found["fingerprint"] == data.fingerprint and found["size"] == data.size:
                return {"id": found["id"], "part_size": found["part_size"], "resumed": True}
            conn.execute("INSERT INTO nodes(id,parent_id,name,kind,size,mime,owner_id,created,updated,status) VALUES(?,?,?,'file',?,?,?,?,?,'uploading')", (nid, data.parent_id, name, data.size, data.mime, person["id"], now, now))
            upload_id = store.start(nid, data.mime)
            conn.execute("INSERT INTO uploads VALUES(?,?,?,?,?)", (nid, upload_id, part_size, data.fingerprint, cfg.backend))
        return {"id": nid, "part_size": part_size, "resumed": False}

    @api.get("/api/uploads")
    def pending(person=Depends(user)):
        with db() as conn:
            return [dict(r) for r in conn.execute("SELECT id,name,size,parent_id FROM nodes WHERE status='uploading' AND owner_id=? AND trash_batch IS NULL", (person["id"],))]

    @api.get("/api/uploads/{nid}")
    def upload_status(nid: str, person=Depends(user)):
        with db() as conn:
            found = upload_node(conn, nid, person, allow_ready=True)
        assembled = found["status"] == "ready" or store.exists(nid, found["size"])
        parts = [] if assembled else store.parts(nid, found["upload_id"])
        return {"id": nid, "status": found["status"], "assembled": assembled, "part_size": found["part_size"], "parts": [{"number": p["PartNumber"], "size": p["Size"]} for p in parts]}

    def part_length(found, number):
        count = max(1, math.ceil(found["size"] / found["part_size"]))
        if not 1 <= number <= count:
            raise HTTPException(400, "잘못된 업로드 조각 번호입니다.")
        return min(found["part_size"], max(0, found["size"] - (number - 1) * found["part_size"]))

    @api.post("/api/uploads/{nid}/parts/{number}")
    def sign_part(nid: str, number: int, person=Depends(user)):
        with db() as conn:
            found = upload_node(conn, nid, person)
        size = part_length(found, number)
        url = store.sign_part(nid, found["upload_id"], number, size) if cfg.backend != "local" else f"{cfg.base_path}/api/uploads/{nid}/parts/{number}"
        return {"url": url, "direct": cfg.backend != "local"}

    @api.put("/api/uploads/{nid}/parts/{number}")
    async def put_part(nid: str, number: int, request: Request, person=Depends(user)):
        if cfg.backend != "local":
            raise HTTPException(400, "서명된 스토리지 URL로 업로드해 주세요.")
        with db() as conn:
            found = upload_node(conn, nid, person)
        expected = part_length(found, number)
        target = store.part_path(nid, number)
        target.parent.mkdir(parents=True, exist_ok=True)
        temporary = target.with_name(f"{number}.{uuid.uuid4().hex}.tmp")
        received = 0
        try:
            with temporary.open("wb") as out:
                async for chunk in request.stream():
                    received += len(chunk)
                    if received > expected:
                        raise HTTPException(413, "업로드 조각 크기가 맞지 않습니다.")
                    await run_in_threadpool(out.write, chunk)
            if received != expected:
                raise HTTPException(400, "업로드 조각이 완전하지 않습니다.")
            with db(write=True) as conn:
                upload_node(conn, nid, person)
                temporary.replace(target)
        finally:
            temporary.unlink(missing_ok=True)
        return {"ok": True}

    @api.post("/api/uploads/{nid}/complete")
    def complete(nid: str, person=Depends(user)):
        with db(write=True) as conn:
            found = upload_node(conn, nid, person, allow_ready=True)
            if found["status"] == "ready":
                return {"id": nid}
            if not store.exists(nid, found["size"]):
                parts = store.parts(nid, found["upload_id"])
                expected_count = max(1, math.ceil(found["size"] / found["part_size"]))
                if len(parts) != expected_count or any(p["PartNumber"] != i or p["Size"] != part_length(found, i) for i, p in enumerate(parts, 1)):
                    raise HTTPException(409, "업로드가 아직 완료되지 않았습니다. 파일을 다시 선택해 이어서 업로드해 주세요.")
                store.finish(nid, found["upload_id"], parts)
            conn.execute("UPDATE nodes SET status='ready',updated=? WHERE id=?", (int(time.time()), nid))
        return {"id": nid}

    @api.delete("/api/uploads/{nid}")
    def cancel(nid: str, person=Depends(user)):
        with db(write=True) as conn:
            found = conn.execute("SELECT n.*,u.upload_id FROM nodes n JOIN uploads u ON n.id=u.node_id WHERE n.id=? AND n.owner_id=? AND n.status='uploading'", (nid, person["id"])).fetchone()
            if not found:
                raise HTTPException(404, "진행 중인 업로드가 없습니다.")
            store.abort(nid, found["upload_id"])
            conn.execute("DELETE FROM uploads WHERE node_id=?", (nid,))
            conn.execute("DELETE FROM nodes WHERE id=?", (nid,))
        return {"ok": True}

    def download_response(found):
        if found["kind"] != "file":
            raise HTTPException(400, "폴더는 직접 다운로드할 수 없습니다.")
        if cfg.backend != "local":
            return RedirectResponse(store.download(found["id"], found["name"]), status_code=302)
        return FileResponse(cfg.data_dir / "objects" / found["id"], filename=found["name"], media_type="application/octet-stream")

    @api.get("/api/nodes/{nid}/download")
    def download(nid: str, person=Depends(user)):
        with db() as conn:
            found = node(conn, nid)
        return download_response(found)

    @api.get("/api/nodes/{nid}/shares")
    def shares(nid: str, person=Depends(user)):
        with db() as conn:
            node(conn, nid)
            return [dict(r) for r in conn.execute("SELECT id,expires,created FROM shares WHERE node_id=? AND expires>?", (nid, int(time.time())))]

    @api.post("/api/nodes/{nid}/shares", status_code=201)
    def share(nid: str, data: Share, person=Depends(user)):
        token, sid, now = secrets.token_urlsafe(32), uuid.uuid4().hex, int(time.time())
        with db(write=True) as conn:
            found = node(conn, nid)
            if found["kind"] != "file":
                raise HTTPException(400, "공유 링크는 파일에서 만들 수 있습니다.")
            conn.execute("INSERT INTO shares VALUES(?,?,?,?,?)", (sid, nid, digest(token), now + data.days * 86400, now))
        return {"id": sid, "url": cfg.app_url.rstrip("/") + "/s/" + token}

    @api.delete("/api/shares/{sid}")
    def revoke(sid: str, person=Depends(user)):
        with db(write=True) as conn:
            conn.execute("DELETE FROM shares WHERE id=?", (sid,))
        return {"ok": True}

    def shared_node(token):
        with db() as conn:
            found = conn.execute("SELECT n.* FROM nodes n JOIN shares s ON s.node_id=n.id WHERE s.token=? AND s.expires>? AND n.status='ready' AND n.trash_batch IS NULL", (digest(token), int(time.time()))).fetchone()
        if not found:
            raise HTTPException(404, "공유 링크가 만료되었거나 더 이상 사용할 수 없습니다.")
        return dict(found)

    @api.get("/api/shared/{token}")
    def shared_info(token: str):
        found = shared_node(token)
        return {k: found[k] for k in ("name", "size", "updated")}

    @api.get("/api/shared/{token}/download")
    def shared_download(token: str):
        return download_response(shared_node(token))

    static = Path(__file__).parent / "static"

    @api.get("/")
    @api.get("/s/{token}")
    def index(token: str = ""):
        return HTMLResponse((static / "index.html").read_text().replace("__BASE__", cfg.base_path))

    @api.get("/health")
    def health():
        return {"status": "ok"}

    api.mount("/static", StaticFiles(directory=static), name="static")
    outer.mount(cfg.base_path, api)

    @outer.get("/pmk")
    @outer.get("/pmk/")
    def portal():
        return HTMLResponse(
            (static / "portal.html").read_text().replace("__BASE__", cfg.base_path),
            headers={
                "Cache-Control": "no-store",
                "X-Content-Type-Options": "nosniff",
                "Referrer-Policy": "no-referrer",
                "X-Frame-Options": "DENY",
                "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
            },
        )

    @outer.get("/")
    def root():
        return RedirectResponse(cfg.base_path + "/")

    return outer
