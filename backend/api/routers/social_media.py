"""
Social Media Agent Router
Generates platform-specific content using the existing LLM stack
and manages a post draft queue.
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
import uuid

from integrations.llm_client import get_llm_client
from config import get_company_info
from database.pg import execute_sql

router = APIRouter(prefix="/api/social-media", tags=["social-media"])

# ── Ensure table exists ──────────────────────────────────────────────────────

def _ensure_table():
    execute_sql("""
        CREATE TABLE IF NOT EXISTS social_media_posts (
            id          TEXT PRIMARY KEY,
            platform    TEXT NOT NULL,
            content     TEXT NOT NULL,
            topic       TEXT,
            tone        TEXT,
            post_type   TEXT,
            status      TEXT DEFAULT 'draft',
            created_at  TIMESTAMPTZ DEFAULT NOW(),
            updated_at  TIMESTAMPTZ DEFAULT NOW()
        )
    """, [])

try:
    _ensure_table()
except Exception:
    pass


# ── Models ───────────────────────────────────────────────────────────────────

class GenerateRequest(BaseModel):
    platform: str          # linkedin | tiktok | facebook | instagram
    topic: str
    tone: str = "professional"
    post_type: str = "post"    # post | thread | story

class SavePostRequest(BaseModel):
    platform: str
    content: str
    topic: Optional[str] = None
    tone: Optional[str] = None
    post_type: Optional[str] = None
    status: str = "draft"

class UpdatePostRequest(BaseModel):
    content: Optional[str] = None
    status: Optional[str] = None


# ── Platform content specs ────────────────────────────────────────────────────

PLATFORM_SPECS = {
    "linkedin": {
        "name": "LinkedIn",
        "char_limit": 3000,
        "style": "professional, thought-leadership tone. Use line breaks for readability. Include 3-5 relevant hashtags at the end.",
    },
    "tiktok": {
        "name": "TikTok",
        "char_limit": 2200,
        "style": "energetic, trend-aware, and hook-driven. Open with a strong attention-grabbing first line. Use emojis naturally. Include 3-5 relevant hashtags. Write as a caption for a short video or as a standalone text post.",
    },
    "facebook": {
        "name": "Facebook",
        "char_limit": 2000,
        "style": "friendly, engaging, community-focused. Can be longer with a question to encourage comments.",
    },
    "instagram": {
        "name": "Instagram",
        "char_limit": 2200,
        "style": "visual-first, inspirational. Write a compelling caption with emojis and 5-10 hashtags at the end.",
    },
}

TONE_DESCRIPTIONS = {
    "professional":  "authoritative and professional",
    "casual":        "relaxed, friendly and approachable",
    "inspirational": "motivating and uplifting",
    "educational":   "informative and helpful, like a teacher",
    "promotional":   "persuasive and benefit-focused",
    "storytelling":  "narrative and story-driven",
}


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.post("/generate")
async def generate_content(req: GenerateRequest):
    """Generate social media content using the configured LLM."""
    spec = PLATFORM_SPECS.get(req.platform.lower())
    if not spec:
        raise HTTPException(status_code=400, detail=f"Unsupported platform: {req.platform}")

    try:
        company = get_company_info()
        company_name    = company.get("name", "our company")
        company_tagline = company.get("tagline", "")
        tone_desc       = TONE_DESCRIPTIONS.get(req.tone, req.tone)

        thread_note = (
            "Format it as a numbered thread (1/ 2/ 3/ ...) with each tweet under 280 characters."
            if req.post_type == "thread" else ""
        )
        story_note = (
            "Format it as a storyboard outline with 5-7 slides/frames, each with a short caption."
            if req.post_type == "story" else ""
        )

        prompt = f"""You are a social media content expert for {company_name}{(' — ' + company_tagline) if company_tagline else ''}.

Write a {spec['name']} {req.post_type} about: {req.topic}

Requirements:
- Tone: {tone_desc}
- Platform style: {spec['style']}
- Character limit: {spec['char_limit']}
{thread_note}{story_note}

Output ONLY the post content — no labels, no explanations, no surrounding quotes.
"""

        client = get_llm_client()
        content, _ = client._complete(prompt, max_tokens=1000)
        return {"content": content.strip(), "platform": req.platform, "topic": req.topic}

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Content generation failed: {str(e)}")


@router.get("/posts")
async def list_posts(platform: Optional[str] = None, status: Optional[str] = None):
    """List saved post drafts, newest first."""
    try:
        where_clauses = []
        params = []
        if platform:
            where_clauses.append("platform = %s")
            params.append(platform)
        if status:
            where_clauses.append("status = %s")
            params.append(status)

        where = ("WHERE " + " AND ".join(where_clauses)) if where_clauses else ""
        rows = execute_sql(
            f"SELECT * FROM social_media_posts {where} ORDER BY created_at DESC LIMIT 200",
            params,
        )
        return {"posts": rows or []}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load posts: {str(e)}")


@router.post("/posts")
async def save_post(req: SavePostRequest):
    """Save a generated post as a draft."""
    try:
        post_id = str(uuid.uuid4())
        execute_sql(
            """INSERT INTO social_media_posts (id, platform, content, topic, tone, post_type, status)
               VALUES (%s, %s, %s, %s, %s, %s, %s)""",
            [post_id, req.platform, req.content, req.topic, req.tone, req.post_type, req.status],
        )
        rows = execute_sql("SELECT * FROM social_media_posts WHERE id = %s", [post_id])
        return rows[0] if rows else {"id": post_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save post: {str(e)}")


@router.patch("/posts/{post_id}")
async def update_post(post_id: str, req: UpdatePostRequest):
    """Update post content or status."""
    try:
        sets, params = [], []
        if req.content is not None:
            sets.append("content = %s"); params.append(req.content)
        if req.status is not None:
            sets.append("status = %s"); params.append(req.status)
        if not sets:
            raise HTTPException(status_code=400, detail="Nothing to update")
        sets.append("updated_at = NOW()")
        params.append(post_id)
        execute_sql(f"UPDATE social_media_posts SET {', '.join(sets)} WHERE id = %s", params)
        rows = execute_sql("SELECT * FROM social_media_posts WHERE id = %s", [post_id])
        return rows[0] if rows else {"id": post_id}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update post: {str(e)}")


@router.delete("/posts/{post_id}")
async def delete_post(post_id: str):
    """Delete a post from the queue."""
    try:
        execute_sql("DELETE FROM social_media_posts WHERE id = %s", [post_id])
        return {"success": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to delete post: {str(e)}")
