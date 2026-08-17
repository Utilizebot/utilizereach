"""
Setup Router
API endpoints for initial application setup and configuration
This router works even when the database is not reachable yet (first-time setup)
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
import os
import re
import json
import secrets
from pathlib import Path

router = APIRouter(prefix="/api/setup", tags=["Setup"])

# Paths for config files
# In Docker: /app is the working directory
# Backend config: /app/config/.env (persistent volume)
# Frontend config: /app/shared_config/config.json (shared with nginx)
# Root .env: For docker-compose to read environment variables
IS_DOCKER = os.path.exists("/app")
BACKEND_CONFIG_DIR = Path("/app/config") if IS_DOCKER else Path(__file__).parent.parent.parent
SHARED_CONFIG_DIR = Path("/app/shared_config") if IS_DOCKER else Path(__file__).parent.parent.parent.parent / "public"
ROOT_DIR = Path("/app").parent if IS_DOCKER else Path(__file__).parent.parent.parent.parent
BACKEND_ENV_PATH = BACKEND_CONFIG_DIR / ".env"
ROOT_ENV_PATH = ROOT_DIR / ".env"  # Root .env for docker-compose
CONFIG_JSON_PATH = SHARED_CONFIG_DIR / "config.json"

# Local dev fallback DSN (only written when DATABASE_URL is not provided by the environment)
LOCAL_DEV_DATABASE_URL = "postgresql://marketing:marketing_dev_pw@localhost:5436/marketing_ai"


class SetupData(BaseModel):
    """All setup data from the wizard"""
    # AI provider (gemini | claude | claude-cli | openai | custom)
    aiProvider: Optional[str] = "gemini"
    aiModel: Optional[str] = ""
    aiApiKey: Optional[str] = ""
    aiBaseUrl: Optional[str] = ""
    # APIs (geminiApiKey kept for backward compatibility; aiApiKey wins)
    geminiApiKey: Optional[str] = ""
    serpApiKey: Optional[str] = ""
    googleClientId: Optional[str] = ""
    googleClientSecret: Optional[str] = ""
    # Backend
    backendUrl: str
    frontendUrl: Optional[str] = "http://localhost:3000"
    redisUrl: Optional[str] = "redis://redis:6379/0"
    # Company
    companyName: Optional[str] = "Your Company"
    companyEmail: Optional[str] = "sales@yourcompany.com"
    companyPhone: Optional[str] = "+1234567890"
    companyWebsite: Optional[str] = "https://www.yourcompany.com"


class SetupStatus(BaseModel):
    """Setup status response"""
    isComplete: bool
    hasEnvFile: bool
    hasConfigFile: bool
    backendReady: bool
    databaseConnected: bool
    adminExists: bool


def _check_database() -> bool:
    """Return True if SELECT 1 works against the configured Postgres."""
    try:
        from database.pg import get_pool
        pool = get_pool()
        with pool.connection() as conn:
            conn.execute("SELECT 1")
        return True
    except Exception:
        return False


def _check_admin_exists() -> bool:
    """Return True if any sales_reps row has a password set."""
    try:
        from database.pg import get_pool
        pool = get_pool()
        with pool.connection() as conn:
            row = conn.execute(
                "SELECT 1 FROM sales_reps WHERE password_hash IS NOT NULL LIMIT 1"
            ).fetchone()
        return row is not None
    except Exception:
        return False


@router.get("/status")
async def get_setup_status() -> SetupStatus:
    """
    Check if setup has been completed
    Returns status of configuration files and database connectivity
    """
    has_env = BACKEND_ENV_PATH.exists()

    # Check if config.json exists and is marked complete
    has_config = CONFIG_JSON_PATH.exists()
    config_complete = False
    if has_config:
        try:
            with open(CONFIG_JSON_PATH, 'r') as f:
                config = json.load(f)
                config_complete = config.get('setup', {}).get('completed', False)
        except Exception:
            pass

    database_connected = _check_database()
    admin_exists = _check_admin_exists()

    return SetupStatus(
        isComplete=config_complete and database_connected,
        hasEnvFile=has_env,
        hasConfigFile=has_config and config_complete,
        backendReady=database_connected,
        databaseConnected=database_connected,
        adminExists=admin_exists
    )


@router.get("/config")
async def get_config():
    """
    Get current config.json content
    Used by frontend to load configuration
    """
    if not CONFIG_JSON_PATH.exists():
        # Return default config if file doesn't exist
        return {
            "setup": {
                "completed": False,
                "apiUrl": ""
            },
            "company": {
                "name": "Your Company",
                "tagline": "AI-Powered Lead Generation",
                "logo": "/logo.png",
                "website": "https://www.yourcompany.com",
                "email": "sales@yourcompany.com",
                "phone": "+1234567890"
            },
            "branding": {
                "primaryColor": "#6366f1",
                "secondaryColor": "#8b5cf6",
                "accentColor": "#06b6d4"
            },
            "form": {
                "title": "Get Your Free Consultation",
                "subtitle": "Find out how we can transform your operations",
                "successMessage": "Thank you for your interest! Our experts will contact you within 24 hours."
            },
            "dashboard": {
                "title": "Lead Generation Analytics",
                "subtitle": "Track and analyze your lead performance"
            },
            "emailTeam": [],
            "features": {
                "enableScraper": True,
                "enableScheduler": True,
                "enableEmailTracking": True,
                "enableAIEmails": True
            }
        }

    try:
        with open(CONFIG_JSON_PATH, 'r') as f:
            return json.load(f)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error reading config: {str(e)}")


@router.post("/save")
async def save_setup(data: SetupData):
    """
    Save setup configuration
    Writes:
    - backend config/.env (full config for backend)
    - root .env (best-effort, for docker-compose environment variables)
    - shared_config/config.json (for frontend)
    """
    try:
        # Ensure config directories exist
        BACKEND_CONFIG_DIR.mkdir(parents=True, exist_ok=True)
        SHARED_CONFIG_DIR.mkdir(parents=True, exist_ok=True)

        # Generate and save backend .env (full config)
        env_content = generate_backend_env(data)
        with open(BACKEND_ENV_PATH, 'w') as f:
            f.write(env_content)

        # Generate and save root .env (for docker-compose) - best effort
        # Merge into the root .env instead of overwriting it — it may hold
        # user-managed settings (port overrides, postgres credentials, ...)
        try:
            _merge_root_env(data)
        except Exception as e:
            print(f"Warning: Could not update root .env: {e}")

        # Generate and save config.json
        config_content = generate_config_json(data)
        with open(CONFIG_JSON_PATH, 'w') as f:
            json.dump(config_content, f, indent=2)

        # Persist the AI provider selection into email_ai_settings (DB)
        try:
            _save_ai_provider_settings(data)
        except Exception as e:
            print(f"Warning: could not save AI provider settings to database: {e}")

        return {
            "success": True,
            "message": "Configuration saved successfully",
            "envPath": str(BACKEND_ENV_PATH),
            "configPath": str(CONFIG_JSON_PATH),
            "nextStep": "Restart the backend containers so Celery picks up the new API keys: docker compose restart backend celery_worker celery_beat"
        }

    except PermissionError:
        raise HTTPException(
            status_code=500,
            detail="Permission denied writing config files. Check Docker volume permissions."
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error saving config: {str(e)}")


@router.post("/test-connection")
async def test_database_connection():
    """
    Test the Postgres database connection (SELECT 1)
    """
    try:
        from database.pg import get_pool
        pool = get_pool()
        with pool.connection() as conn:
            conn.execute("SELECT 1")
        return {"success": True, "message": "Database connection successful"}
    except Exception as e:
        return {"success": False, "message": str(e)}


def _effective_gemini_key(data: SetupData) -> str:
    """Gemini key for env compatibility: aiApiKey when provider is gemini, else legacy field."""
    if (data.aiProvider or "gemini").lower() == "gemini" and (data.aiApiKey or "").strip():
        return data.aiApiKey.strip()
    return (data.geminiApiKey or "").strip()


def _save_ai_provider_settings(data: SetupData) -> None:
    """Write the wizard's AI provider choice into the email_ai_settings row."""
    provider = (data.aiProvider or "gemini").strip().lower()
    api_key = (data.aiApiKey or "").strip()
    if provider == "gemini" and not api_key:
        api_key = (data.geminiApiKey or "").strip()

    from database.pg import get_pool
    pool = get_pool()
    with pool.connection() as conn:
        row = conn.execute("SELECT id FROM email_ai_settings LIMIT 1").fetchone()
        if row:
            conn.execute(
                "UPDATE email_ai_settings SET ai_provider = %s, ai_model = %s, "
                "ai_api_key = %s, ai_base_url = %s, updated_at = NOW() WHERE id = %s",
                (provider, data.aiModel or "", api_key, data.aiBaseUrl or "", row["id"]),
            )
        else:
            conn.execute(
                "INSERT INTO email_ai_settings (ai_provider, ai_model, ai_api_key, ai_base_url) "
                "VALUES (%s, %s, %s, %s)",
                (provider, data.aiModel or "", api_key, data.aiBaseUrl or ""),
            )


def get_or_create_jwt_secret() -> str:
    """
    Return the JWT secret to write into config/.env.
    Preserves an existing value (from the current .env file or the environment)
    so already-issued tokens stay valid; generates a new one otherwise.
    """
    if BACKEND_ENV_PATH.exists():
        try:
            content = BACKEND_ENV_PATH.read_text()
            match = re.search(r'^JWT_SECRET=(.+)$', content, re.MULTILINE)
            if match and match.group(1).strip():
                return match.group(1).strip()
        except Exception:
            pass

    env_secret = os.getenv('JWT_SECRET', '').strip()
    if env_secret:
        return env_secret

    return secrets.token_urlsafe(32)


def generate_backend_env(data: SetupData) -> str:
    """Generate backend .env file content"""
    from datetime import datetime

    jwt_secret = get_or_create_jwt_secret()

    env = f"""# Marketing AI - Backend Environment Variables
# Generated by Setup Wizard on {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}

# ===========================================
# AUTH (JWT)
# ===========================================
JWT_SECRET={jwt_secret}

# ===========================================
# REDIS CONFIGURATION (Required for Celery)
# ===========================================
REDIS_URL={data.redisUrl}
CELERY_BROKER_URL={data.redisUrl}
CELERY_RESULT_BACKEND={data.redisUrl}

# ===========================================
# APPLICATION SETTINGS
# ===========================================
ENVIRONMENT=production
DEBUG=false
API_PORT=8000
CSV_STORAGE_PATH=/app/storage/csv_files

# ===========================================
# CORS ORIGINS (Required for frontend access)
# ===========================================
CORS_ORIGINS={data.frontendUrl}

# ===========================================
# BACKEND URL (Required for email tracking)
# ===========================================
BACKEND_URL={data.backendUrl}

# ===========================================
# AI PROVIDER (fallbacks - the DB email_ai_settings row is authoritative)
# ===========================================
AI_PROVIDER={(data.aiProvider or 'gemini')}
GOOGLE_API_KEY={_effective_gemini_key(data)}
GEMINI_API_KEY={_effective_gemini_key(data)}
"""

    # DATABASE_URL normally comes from the container environment (docker-compose).
    # Only write it when the environment doesn't provide one (local dev).
    if not os.getenv('DATABASE_URL'):
        env += f"""
# ===========================================
# DATABASE (local dev fallback - docker-compose provides this in Docker)
# ===========================================
DATABASE_URL={LOCAL_DEV_DATABASE_URL}
"""

    if data.serpApiKey:
        env += f"""
# ===========================================
# SERPAPI (Optional - for lead scraping)
# ===========================================
SERPAPI_KEY={data.serpApiKey}
"""

    if data.googleClientId:
        env += f"""
# ===========================================
# GOOGLE OAUTH (Optional - for Gmail sending)
# ===========================================
GOOGLE_CLIENT_ID={data.googleClientId}
GOOGLE_CLIENT_SECRET={data.googleClientSecret}
"""

    return env


def _merge_root_env(data: SetupData) -> None:
    """
    Update only the wizard-managed keys in the root .env, preserving every
    other line (port overrides, postgres credentials, JWT secret, ...).
    """
    managed = {
        'GOOGLE_API_KEY': _effective_gemini_key(data),
        'GEMINI_API_KEY': _effective_gemini_key(data),
    }
    if data.serpApiKey:
        managed['SERPAPI_KEY'] = data.serpApiKey
    if data.googleClientId:
        managed['GOOGLE_CLIENT_ID'] = data.googleClientId
        managed['GOOGLE_CLIENT_SECRET'] = data.googleClientSecret or ''

    lines = []
    if ROOT_ENV_PATH.exists():
        lines = ROOT_ENV_PATH.read_text().splitlines()

    remaining = dict(managed)
    out = []
    for line in lines:
        stripped = line.strip()
        key = stripped.split('=', 1)[0].strip() if '=' in stripped and not stripped.startswith('#') else None
        if key in remaining:
            out.append(f"{key}={remaining.pop(key)}")
        else:
            out.append(line)

    if remaining:
        if out and out[-1].strip():
            out.append('')
        out.append('# Added by Setup Wizard')
        for key, value in remaining.items():
            out.append(f"{key}={value}")

    ROOT_ENV_PATH.write_text('\n'.join(out) + '\n')


def generate_config_json(data: SetupData) -> dict:
    """Generate config.json content"""
    return {
        "setup": {
            "completed": True,
            "apiUrl": data.backendUrl
        },
        "company": {
            "name": data.companyName or "Your Company",
            "tagline": "AI-Powered Lead Generation",
            "logo": "/logo.png",
            "website": data.companyWebsite or "https://www.yourcompany.com",
            "email": data.companyEmail or "sales@yourcompany.com",
            "phone": data.companyPhone or "+1234567890"
        },
        "branding": {
            "primaryColor": "#6366f1",
            "secondaryColor": "#8b5cf6",
            "accentColor": "#06b6d4"
        },
        "form": {
            "title": "Get Your Free Consultation",
            "subtitle": "Find out how we can transform your operations",
            "successMessage": "Thank you for your interest! Our experts will contact you within 24 hours."
        },
        "dashboard": {
            "title": "Lead Generation Analytics",
            "subtitle": "Track and analyze your lead performance"
        },
        "emailTeam": [
            {
                "email": f"sales@{data.companyWebsite.replace('https://', '').replace('http://', '').replace('www.', '') if data.companyWebsite else 'yourcompany.com'}",
                "name": "Sales Team",
                "title": "Business Development",
                "persona": "professional, warm, and relationship-focused"
            }
        ],
        "features": {
            "enableScraper": True,
            "enableScheduler": True,
            "enableEmailTracking": True,
            "enableAIEmails": True
        }
    }
