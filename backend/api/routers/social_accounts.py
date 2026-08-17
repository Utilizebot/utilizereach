"""
Social Media Accounts Router
Stores platform credentials and handles posting to each network.

Credential fields by platform:
  linkedin  – access_token, person_urn  (from LinkedIn Developer Portal)
  tiktok    – access_token, open_id     (from TikTok for Developers OAuth)
  facebook  – page_access_token, page_id
  instagram – ig_account_id, access_token  (same Facebook app token)
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional, Dict, Any
import requests
import json
import base64
import hashlib
import hmac
import time
import uuid

from database.pg import execute_sql

router = APIRouter(prefix="/api/social-accounts", tags=["social-accounts"])


# ── Table ─────────────────────────────────────────────────────────────────────

def _ensure_table():
    execute_sql("""
        CREATE TABLE IF NOT EXISTS social_media_accounts (
            id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
            platform    TEXT UNIQUE NOT NULL,
            credentials JSONB DEFAULT '{}',
            is_connected BOOLEAN DEFAULT FALSE,
            handle      TEXT,
            updated_at  TIMESTAMPTZ DEFAULT NOW()
        )
    """, [])
    # Seed one row per platform so UI always has something to show
    for p in ("linkedin", "tiktok", "facebook", "instagram"):
        execute_sql("""
            INSERT INTO social_media_accounts (platform)
            VALUES (%s)
            ON CONFLICT (platform) DO NOTHING
        """, [p])
    # Remove legacy twitter row (replaced by tiktok)
    execute_sql("DELETE FROM social_media_accounts WHERE platform = 'twitter'", [])

try:
    _ensure_table()
except Exception:
    pass


# ── Models ────────────────────────────────────────────────────────────────────

class UpdateAccountRequest(BaseModel):
    credentials: Dict[str, str]
    handle: Optional[str] = None


class PostRequest(BaseModel):
    platform: str
    content: str
    post_id: Optional[str] = None   # social_media_posts.id to mark as posted


# ── Helpers ───────────────────────────────────────────────────────────────────

def _get_creds(platform: str) -> Dict[str, Any]:
    rows = execute_sql(
        "SELECT credentials, is_connected FROM social_media_accounts WHERE platform = %s",
        [platform],
    )
    if not rows:
        raise HTTPException(status_code=404, detail=f"No account found for {platform}")
    row = rows[0]
    if not row["is_connected"]:
        raise HTTPException(status_code=400, detail=f"{platform} account is not connected")
    return row["credentials"] or {}


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/")
async def list_accounts():
    """Return connection status for all platforms."""
    rows = execute_sql(
        "SELECT platform, is_connected, handle, updated_at FROM social_media_accounts ORDER BY platform",
        [],
    )
    return {"accounts": rows or []}


@router.get("/{platform}")
async def get_account(platform: str):
    rows = execute_sql(
        "SELECT platform, is_connected, handle, updated_at FROM social_media_accounts WHERE platform = %s",
        [platform],
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Account not found")
    return rows[0]


@router.put("/{platform}")
async def update_account(platform: str, req: UpdateAccountRequest):
    """Save credentials and mark the account as connected."""
    VALID = {"linkedin", "tiktok", "facebook", "instagram"}
    if platform not in VALID:
        raise HTTPException(status_code=400, detail=f"Unknown platform: {platform}")
    execute_sql("""
        UPDATE social_media_accounts
        SET credentials = %s, handle = %s, is_connected = TRUE, updated_at = NOW()
        WHERE platform = %s
    """, [json.dumps(req.credentials), req.handle, platform])
    return {"success": True, "platform": platform, "handle": req.handle}


@router.delete("/{platform}/disconnect")
async def disconnect(platform: str):
    """Clear credentials and mark disconnected."""
    execute_sql("""
        UPDATE social_media_accounts
        SET credentials = '{}', is_connected = FALSE, handle = NULL, updated_at = NOW()
        WHERE platform = %s
    """, [platform])
    return {"success": True}


@router.post("/{platform}/test")
async def test_connection(platform: str):
    """Quick API call to verify the stored credentials work."""
    creds = _get_creds(platform)
    try:
        if platform == "linkedin":
            token = creds.get("access_token", "")
            r = requests.get(
                "https://api.linkedin.com/v2/userinfo",
                headers={"Authorization": f"Bearer {token}"},
                timeout=10,
            )
            if r.status_code == 200:
                data = r.json()
                return {"success": True, "name": data.get("name", ""), "platform": platform}
            raise Exception(f"LinkedIn returned {r.status_code}: {r.text[:200]}")

        elif platform == "tiktok":
            token = creds.get("access_token", "")
            r = requests.get(
                "https://open.tiktokapis.com/v2/user/info/",
                params={"fields": "open_id,display_name"},
                headers={"Authorization": f"Bearer {token}"},
                timeout=10,
            )
            if r.status_code == 200:
                data = r.json().get("data", {}).get("user", {})
                return {"success": True, "name": data.get("display_name", ""), "platform": platform}
            raise Exception(f"TikTok returned {r.status_code}: {r.text[:200]}")

        elif platform == "facebook":
            token = creds.get("page_access_token", "")
            page_id = creds.get("page_id", "me")
            r = requests.get(
                f"https://graph.facebook.com/v19.0/{page_id}",
                params={"fields": "name,id", "access_token": token},
                timeout=10,
            )
            if r.status_code == 200:
                data = r.json()
                return {"success": True, "name": data.get("name", ""), "platform": platform}
            raise Exception(f"Facebook returned {r.status_code}: {r.text[:200]}")

        elif platform == "instagram":
            token = creds.get("access_token", "")
            ig_id = creds.get("ig_account_id", "")
            r = requests.get(
                f"https://graph.facebook.com/v19.0/{ig_id}",
                params={"fields": "name,username", "access_token": token},
                timeout=10,
            )
            if r.status_code == 200:
                data = r.json()
                return {"success": True, "name": data.get("username", data.get("name", "")), "platform": platform}
            raise Exception(f"Instagram returned {r.status_code}: {r.text[:200]}")

        raise HTTPException(status_code=400, detail=f"Unknown platform: {platform}")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/post")
async def post_to_platform(req: PostRequest):
    """Post content to the specified social media platform."""
    platform = req.platform.lower()
    creds = _get_creds(platform)

    try:
        result = {}

        if platform == "linkedin":
            token = creds.get("access_token", "")
            person_urn = creds.get("person_urn", "")
            if not token or not person_urn:
                raise Exception("LinkedIn access_token and person_urn are required")
            payload = {
                "author": person_urn,
                "lifecycleState": "PUBLISHED",
                "specificContent": {
                    "com.linkedin.ugc.ShareContent": {
                        "shareCommentary": {"text": req.content},
                        "shareMediaCategory": "NONE",
                    }
                },
                "visibility": {"com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC"},
            }
            r = requests.post(
                "https://api.linkedin.com/v2/ugcPosts",
                json=payload,
                headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
                timeout=15,
            )
            if r.status_code not in (200, 201):
                raise Exception(f"LinkedIn error {r.status_code}: {r.text[:300]}")
            result = {"post_id": r.headers.get("x-restli-id", ""), "url": "https://linkedin.com/feed"}

        elif platform == "tiktok":
            token = creds.get("access_token", "")
            open_id = creds.get("open_id", "")
            if not token:
                raise Exception("TikTok access_token is required")
            # TikTok Content Posting API — text post
            r = requests.post(
                "https://open.tiktokapis.com/v2/post/publish/text/init/",
                json={
                    "post_info": {
                        "title": req.content[:2200],
                        "privacy_level": "PUBLIC_TO_EVERYONE",
                        "disable_duet": False,
                        "disable_comment": False,
                        "disable_stitch": False,
                    },
                    "source_info": {"source": "PULL_FROM_URL"},
                },
                headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
                timeout=15,
            )
            if r.status_code not in (200, 201):
                raise Exception(f"TikTok error {r.status_code}: {r.text[:300]}")
            publish_id = r.json().get("data", {}).get("publish_id", "")
            result = {"publish_id": publish_id, "url": "https://www.tiktok.com"}

        elif platform == "facebook":
            token = creds.get("page_access_token", "")
            page_id = creds.get("page_id", "")
            if not token or not page_id:
                raise Exception("Facebook page_access_token and page_id are required")
            r = requests.post(
                f"https://graph.facebook.com/v19.0/{page_id}/feed",
                data={"message": req.content, "access_token": token},
                timeout=15,
            )
            if r.status_code != 200:
                raise Exception(f"Facebook error {r.status_code}: {r.text[:300]}")
            post_id = r.json().get("id", "")
            result = {"post_id": post_id, "url": f"https://facebook.com/{post_id}"}

        elif platform == "instagram":
            token = creds.get("access_token", "")
            ig_id = creds.get("ig_account_id", "")
            if not token or not ig_id:
                raise Exception("Instagram ig_account_id and access_token are required")
            # Step 1: create media container
            r1 = requests.post(
                f"https://graph.facebook.com/v19.0/{ig_id}/media",
                data={"caption": req.content, "media_type": "TEXT", "access_token": token},
                timeout=15,
            )
            if r1.status_code != 200:
                raise Exception(f"Instagram media create error {r1.status_code}: {r1.text[:300]}")
            container_id = r1.json().get("id", "")
            # Step 2: publish container
            r2 = requests.post(
                f"https://graph.facebook.com/v19.0/{ig_id}/media_publish",
                data={"creation_id": container_id, "access_token": token},
                timeout=15,
            )
            if r2.status_code != 200:
                raise Exception(f"Instagram publish error {r2.status_code}: {r2.text[:300]}")
            result = {"media_id": r2.json().get("id", ""), "url": "https://instagram.com"}

        else:
            raise HTTPException(status_code=400, detail=f"Unknown platform: {platform}")

        # Mark the draft as posted if a post_id was given
        if req.post_id:
            execute_sql(
                "UPDATE social_media_posts SET status = 'posted', updated_at = NOW() WHERE id = %s",
                [req.post_id],
            )

        return {"success": True, "platform": platform, **result}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
