"""
FastAPI Main Application

Production-ready backend for UtilizeReach
"""

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Depends, Header, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import sys
import os
import json
from typing import Dict, Set

# Add parent directory to import path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from api.routers import scraper, email_tracking, leads, emails, email_accounts, campaigns, exclusions, scheduler, setup, email_ai_settings, chat, test_email, auth, tracking, analytics, api_keys
from api.routers import nexus_migration, nexus_agents, nexus_stakeholders
from api.routers import segments
from api.routers import campaigns_mgmt
from api.routers import analytics_outbound
from api.routers import insights
from api.routers import unsubscribe
from api.routers import lead_activity
from api.routers import stream
from api.routers import social_media
from api.routers import social_accounts
from api.routers import brands
from api.dependencies import get_current_user, get_current_user_from_query
from typing import Optional
from utils.redis_client import subscribe_to_progress


def _authenticated(skip_suffixes: tuple = ()):
    """Router-level authentication + brand binding (multi-brand isolation).

    Every route of the router requires a valid, active account and runs bound
    to the caller's active brand (database/tenancy.py). Exceptions:
      * paths ending in one of `skip_suffixes` stay public (e.g. the Google
        OAuth callback, which Google reaches by redirecting the browser);
      * Server-Sent-Events paths (containing "stream") may pass the JWT as
        ?token=, because the browser EventSource API cannot send headers.
    """
    async def _dep(request: Request, authorization: Optional[str] = Header(None),
                   token: Optional[str] = None):
        path = request.url.path
        if skip_suffixes and path.endswith(skip_suffixes):
            return None
        if not authorization and token and "stream" in path:
            return await get_current_user_from_query(request, token, authorization)
        return await get_current_user(request, authorization)
    return [Depends(_dep)]


_AUTH = _authenticated()

# Initialize FastAPI app
app = FastAPI(
    title="UtilizeReach API",
    description="Self-hosted AI lead generation, scraping and email marketing platform",
    version="2.0.0",
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json",
)

# CORS Configuration for frontend
# Default allows all origins during setup, then restricts after configuration
CORS_ORIGINS_ENV = os.getenv("CORS_ORIGINS", "")
if CORS_ORIGINS_ENV:
    CORS_ORIGINS = CORS_ORIGINS_ENV.split(",")
else:
    # Allow all origins during initial setup (before .env is configured)
    CORS_ORIGINS = ["*"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def no_store_api_responses(request, call_next):
    """API responses must never be cached by the browser.

    Without this, list endpoints (exclusions, leads, segments, ...) carry no
    Cache-Control header, so browsers may serve a stale cached GET after a
    delete/update, making changes look like they "didn't save" until a hard
    refresh. Force revalidation on every API/tracking response.
    """
    response = await call_next(request)
    path = request.url.path
    if path.startswith("/api") or path.startswith("/track"):
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    return response

# Initialize shared config directory with default config.json for frontend
# This ensures nginx can serve config.json even before Setup Wizard runs
SHARED_CONFIG_PATH = "/app/shared_config/config.json"
DEFAULT_CONFIG = {
    "setup": {
        "completed": False,
        "apiUrl": ""
    },
    "company": {
        "name": "example.com",
        "tagline": "AI meeting intelligence for Malay & English",
        "logo": "/logo.png",
        "website": "https://example.com",
        "email": "",
        "phone": ""
    },
    "branding": {
        "primaryColor": "#2aa8e0",
        "secondaryColor": "#0d78b0",
        "accentColor": "#30b9eb"
    },
    "form": {
        "title": "Request a demo",
        "subtitle": "Tell us about your team and try UtilizeReach on your next meeting",
        "successMessage": "Thanks! We'll reach out to get you set up — try UtilizeReach on your next meeting."
    },
    "dashboard": {
        "title": "UtilizeReach Lead Analytics",
        "subtitle": "Track and manage your demo requests"
    },
    "emailTeam": [],
    "features": {
        "enableScraper": True,
        "enableScheduler": True,
        "enableEmailTracking": True,
        "enableAIEmails": True
    }
}

@app.on_event("startup")
async def apply_database_schema():
    """Apply/upgrade the database schema on startup (idempotent, advisory-locked)"""
    try:
        from database.migrate import apply_schema
        apply_schema()
        print("[Startup] Database schema applied")
    except Exception as e:
        # Don't crash the app: the Setup Wizard needs the API up to report
        # database status; /api/setup/status will show databaseConnected=false
        print(f"[Startup] WARNING: schema migration failed: {e}")


@app.on_event("startup")
async def initialize_shared_config():
    """Initialize shared config volume with default config.json if not exists"""
    try:
        shared_dir = os.path.dirname(SHARED_CONFIG_PATH)
        if os.path.exists(shared_dir):
            if not os.path.exists(SHARED_CONFIG_PATH):
                with open(SHARED_CONFIG_PATH, 'w') as f:
                    json.dump(DEFAULT_CONFIG, f, indent=2)
                print(f"[Startup] Created default config.json at {SHARED_CONFIG_PATH}")
            else:
                print(f"[Startup] Config.json already exists at {SHARED_CONFIG_PATH}")
        else:
            print(f"[Startup] Shared config directory not found: {shared_dir}")
    except Exception as e:
        print(f"[Startup] Error initializing shared config: {e}")

# ---------------------------------------------------------------------------
# Routers
#
# PUBLIC (no router-level auth; each guards itself where needed):
#   email_tracking (/track pixel/click/unsubscribe tokens), tracking (public
#   lead form), unsubscribe, setup (bootstrap wizard), auth (login/register/
#   status public, the rest per-endpoint), chat (website widget), brands
#   (public-config public, the rest per-endpoint).
# PROTECTED: everything else requires an active account and is bound to the
#   caller's active brand. See docs/MULTIBRAND.md.
# ---------------------------------------------------------------------------
app.include_router(email_tracking.router)
app.include_router(tracking.router)
app.include_router(unsubscribe.router)
app.include_router(setup.router)
app.include_router(auth.router)
app.include_router(chat.router)
app.include_router(brands.router)

app.include_router(scraper.router, dependencies=_AUTH)
app.include_router(lead_activity.router, dependencies=_AUTH)  # before leads.router so /activity isn't shadowed by /{lead_id}
app.include_router(leads.router, dependencies=_AUTH)
app.include_router(emails.router, dependencies=_AUTH)
app.include_router(email_accounts.public_router)  # Google OAuth callback only (verifies its signed state)
app.include_router(email_accounts.router, dependencies=_authenticated(skip_suffixes=("/google/callback",)))
app.include_router(campaigns.router, dependencies=_AUTH)
app.include_router(exclusions.router, dependencies=_AUTH)
app.include_router(scheduler.router, dependencies=_AUTH)
app.include_router(email_ai_settings.router, dependencies=_AUTH)
app.include_router(test_email.router, dependencies=_AUTH)
app.include_router(analytics.router, dependencies=_AUTH)
app.include_router(api_keys.router, dependencies=_AUTH)
app.include_router(nexus_migration.router, dependencies=_AUTH)
app.include_router(nexus_agents.router, dependencies=_AUTH)
app.include_router(nexus_agents.stream_router, dependencies=_AUTH)  # SSE: ?token= accepted on stream paths
app.include_router(nexus_stakeholders.router, dependencies=_AUTH)
app.include_router(segments.router, dependencies=_AUTH)
app.include_router(campaigns_mgmt.router, dependencies=_AUTH)
app.include_router(analytics_outbound.router, dependencies=_AUTH)
app.include_router(insights.router, dependencies=_AUTH)
app.include_router(stream.router, dependencies=_AUTH)
app.include_router(social_media.router, dependencies=_AUTH)
app.include_router(social_accounts.router, dependencies=_AUTH)

# WebSocket connection manager
class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[str, Set[WebSocket]] = {}

    async def connect(self, websocket: WebSocket, job_id: str):
        await websocket.accept()
        if job_id not in self.active_connections:
            self.active_connections[job_id] = set()
        self.active_connections[job_id].add(websocket)

    def disconnect(self, websocket: WebSocket, job_id: str):
        if job_id in self.active_connections:
            self.active_connections[job_id].discard(websocket)
            if not self.active_connections[job_id]:
                del self.active_connections[job_id]

    async def send_personal_message(self, message: dict, websocket: WebSocket):
        await websocket.send_json(message)

    async def broadcast_to_job(self, message: dict, job_id: str):
        if job_id in self.active_connections:
            disconnected = set()
            for connection in self.active_connections[job_id]:
                try:
                    await connection.send_json(message)
                except Exception:
                    disconnected.add(connection)

            # Clean up disconnected clients
            for connection in disconnected:
                self.active_connections[job_id].discard(connection)

manager = ConnectionManager()


@app.get("/health")
async def health_check():
    """
    Health check endpoint for monitoring (Docker healthcheck)
    """
    return {
        "status": "healthy",
        "service": "UtilizeReach API",
        "version": "2.0.0"
    }


@app.get("/api/health")
async def api_health_check():
    """
    Health check endpoint for monitoring (API route)
    """
    return {
        "status": "healthy",
        "service": "UtilizeReach API",
        "version": "2.0.0"
    }


@app.websocket("/ws/progress/{job_id}")
async def websocket_endpoint(websocket: WebSocket, job_id: str):
    """
    WebSocket endpoint for real-time progress updates

    Clients connect to this endpoint to receive live updates
    about their scraping job progress.

    Args:
        job_id: The scraping job ID to subscribe to
    """
    # Multi-brand: the socket must carry a valid token (?token=) and the job
    # must belong to that user's active brand.
    token = websocket.query_params.get("token")
    try:
        from api.dependencies import _decode, _load_user, resolve_user_brand
        from database.tenancy import brand_scope
        from database.pg import execute_sql
        user = _load_user(_decode(f"Bearer {token}" if token else None))
        payload = _decode(f"Bearer {token}")
        brand = resolve_user_brand(user, payload.get("brand"), websocket.headers.get("host"))["brand"]
        with brand_scope(brand["id"]):
            owned = execute_sql("SELECT 1 FROM scraping_jobs WHERE id = %s AND brand_id = %s", [job_id, brand["id"]])
        if not owned:
            raise ValueError("job not found")
    except Exception:
        await websocket.close(code=4403)
        return
    await manager.connect(websocket, job_id)

    try:
        # Send initial connection confirmation
        await manager.send_personal_message({
            "type": "connected",
            "job_id": job_id,
            "message": "Connected to job progress updates"
        }, websocket)

        # Subscribe to Redis pub/sub for this job
        async def handle_redis_message(message_data: dict):
            """Forward Redis messages to WebSocket client"""
            await manager.send_personal_message(message_data, websocket)

        # Start listening to Redis pub/sub in background
        # Note: In production, you'd want to run this in a separate task
        # For now, we'll keep the connection open and let the client poll via REST API

        # Keep connection alive
        while True:
            # Wait for any message from client (ping/pong)
            data = await websocket.receive_text()

            # Handle ping-pong for connection keep-alive
            if data == "ping":
                await websocket.send_text("pong")

    except WebSocketDisconnect:
        manager.disconnect(websocket, job_id)
    except Exception as e:
        print(f"WebSocket error for job {job_id}: {str(e)}")
        manager.disconnect(websocket, job_id)


@app.on_event("startup")
async def startup_event():
    """
    Application startup tasks
    """
    print("Starting UtilizeReach API...")
    print("API Documentation available at: http://localhost:8000/api/docs")
    print("WebSocket endpoint: ws://localhost:8000/ws/progress/{job_id}")


@app.on_event("shutdown")
async def shutdown_event():
    """
    Application shutdown tasks
    """
    print("Shutting down UtilizeReach API...")


@app.exception_handler(Exception)
async def global_exception_handler(request, exc):
    """
    Global exception handler for unhandled errors
    """
    print(f"Unhandled exception: {str(exc)}")
    return JSONResponse(
        status_code=500,
        content={
            "detail": "Internal server error",
            "error": str(exc) if os.getenv("DEBUG", "false").lower() == "true" else None
        }
    )


if __name__ == "__main__":
    import uvicorn

    # Run server
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,  # Auto-reload on code changes (development only)
        log_level="info"
    )
