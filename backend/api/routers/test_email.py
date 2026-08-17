"""
Test Email Router - Quick send with AI personalization + Gmail API
Works directly without Celery workers. Uses the multi-provider LLM client
(integrations.llm_client) configured in email_ai_settings.
"""

from fastapi import APIRouter, HTTPException
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel
from typing import Optional
import os
import sys
import uuid
import json
import traceback

# Add parent paths for imports
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

router = APIRouter(prefix="/api/test-email", tags=["test-email"])


def get_email_ai_settings() -> dict:
    """Load email AI settings (company info + CTA links) with neutral fallbacks."""
    settings = {}
    try:
        from database.client import get_supabase_admin_client
        result = (
            get_supabase_admin_client()
            .table("email_ai_settings")
            .select("*")
            .limit(1)
            .execute()
        )
        if result.data:
            settings = result.data[0]
    except Exception as e:
        print(f"[Test Email] Could not load email_ai_settings: {e}")

    return {
        "company_name": settings.get("company_name") or "Your Company",
        "company_tagline": settings.get("company_tagline") or "",
        "company_services": settings.get("company_services") or "",
        "cta_link_1_label": settings.get("cta_link_1_label") or "Schedule a Call",
        "cta_link_1_url": settings.get("cta_link_1_url") or "",
        "cta_link_2_label": settings.get("cta_link_2_label") or "Learn More",
        "cta_link_2_url": settings.get("cta_link_2_url") or "",
    }


class TestEmailRequest(BaseModel):
    to_email: str
    to_name: Optional[str] = ""
    custom_message: Optional[str] = ""
    hints: Optional[str] = ""
    # Pre-generated content — skip AI generation if provided
    subject: Optional[str] = None
    body_html: Optional[str] = None
    body_text: Optional[str] = None


class PreviewEmailRequest(BaseModel):
    to_email: str
    to_name: Optional[str] = ""
    hints: Optional[str] = ""


class TestEmailResponse(BaseModel):
    success: bool
    message: str
    subject: Optional[str] = None
    preview: Optional[str] = None
    gmail_message_id: Optional[str] = None


class PreviewEmailResponse(BaseModel):
    success: bool
    subject: str
    body_html: str
    body_text: str
    preview: Optional[str] = None


def _generate_test_email_sync(recipient_name: str, recipient_email: str, custom_message: str = "", hints: str = "") -> dict:
    """Generate a personalized test email using the configured LLM provider."""
    from integrations.llm_client import get_llm_client

    settings = get_email_ai_settings()
    company_name = settings["company_name"]
    company_tagline = settings["company_tagline"]
    company_services = settings["company_services"]

    # Build hint/context blocks
    extra_context_parts = []
    if custom_message:
        extra_context_parts.append(f"Additional context: {custom_message}")
    if hints:
        extra_context_parts.append(f"Key points to include in the email:\n{hints}")
    extra_context = ("\n" + "\n".join(extra_context_parts) + "\n") if extra_context_parts else ""

    tagline_line = f" ({company_tagline})" if company_tagline else ""
    services_block = ""
    if company_services:
        services_block = f"\nThe company offers:\n{company_services}\n"

    # CTA / contact details are injected programmatically after generation
    prompt = f"""Write a short, warm, professional outreach email from a team member at {company_name}{tagline_line} to {recipient_name}.
{extra_context}{services_block}
Requirements:
- Warm and professional tone, not salesy or generic
- Briefly explain how {company_name} can specifically help the recipient
- Reference the key points provided (if any) naturally in the email body
- Invite them to schedule a call or learn more
- Under 150 words total

Return a JSON object with exactly 3 keys: "subject", "body_html", "body_text"
For body_html use simple HTML only: <p>, <strong>, <a>, <br>, <small> — no CSS, no style blocks, no classes.
Use {{{{CTA_LINK_1}}}} and {{{{CTA_LINK_2}}}} as placeholders for call-to-action links.

Return ONLY valid JSON, no markdown fences."""

    try:
        client = get_llm_client()
        content, _usage = client._complete(prompt, max_tokens=2000)
    except Exception as e:
        print(f"[Test Email] LLM error: {e}")
        raise HTTPException(status_code=502, detail="AI service error. Please check your AI provider settings and try again.")

    content = (content or "").strip()
    if not content:
        print("[Test Email] LLM returned empty response")
        raise HTTPException(status_code=502, detail="AI returned empty response. Please try again.")

    # Clean markdown code blocks
    if content.startswith("```"):
        content = content.split("\n", 1)[1] if "\n" in content else content[3:]
        if content.endswith("```"):
            content = content[:-3]
        content = content.strip()
    if content.startswith("json"):
        content = content[4:].strip()

    # Fix invalid JSON escape sequences some models produce
    def fix_json_escapes(s: str) -> str:
        valid_escapes = set('"\\/bfnrtu')
        result = []
        i = 0
        while i < len(s):
            if s[i] == '\\' and i + 1 < len(s):
                next_char = s[i + 1]
                if next_char in valid_escapes:
                    result.append(s[i])
                    result.append(next_char)
                    i += 2
                else:
                    result.append('\\\\')
                    result.append(next_char)
                    i += 2
            else:
                result.append(s[i])
                i += 1
        return ''.join(result)

    try:
        email_data = json.loads(content)
    except json.JSONDecodeError:
        try:
            fixed = fix_json_escapes(content)
            email_data = json.loads(fixed)
        except json.JSONDecodeError as e:
            print(f"[Test Email] JSON parse error: {e}")
            print(f"[Test Email] Raw LLM content: {content[:500]}")
            raise HTTPException(status_code=502, detail="AI response format error. Please try again.")

    # Replace CTA placeholders with configured links (neutral fallback: '#')
    cta_1 = settings["cta_link_1_url"] or "#"
    cta_2 = settings["cta_link_2_url"] or "#"
    contact_replacements = {
        "{{CTA_LINK_1}}": cta_1,
        "{{CTA_LINK_2}}": cta_2,
        "{CTA_LINK_1}": cta_1,
        "{CTA_LINK_2}": cta_2,
    }

    for key in ("subject", "body_html", "body_text"):
        if key in email_data and email_data[key]:
            for placeholder, value in contact_replacements.items():
                email_data[key] = email_data[key].replace(placeholder, value)

    return email_data


async def generate_test_email(recipient_name: str, recipient_email: str, custom_message: str = "", hints: str = "") -> dict:
    """Async wrapper: run the (blocking) LLM generation in a thread pool."""
    return await run_in_threadpool(
        _generate_test_email_sync, recipient_name, recipient_email, custom_message, hints
    )


def get_oauth_account():
    """Get an email account with OAuth refresh token from Supabase"""
    from database.client import get_supabase_client
    supabase = get_supabase_client()

    result = supabase.table("email_accounts") \
        .select("*") \
        .neq("refresh_token", "null") \
        .eq("is_active", True) \
        .limit(1) \
        .execute()

    # Filter out accounts where refresh_token is actually None/empty
    accounts = [a for a in (result.data or []) if a.get("refresh_token")]

    if not accounts:
        raise HTTPException(
            status_code=400,
            detail="No email account with OAuth connected. Go to Email Accounts and connect a Gmail account first."
        )

    return accounts[0]


@router.post("/preview", response_model=PreviewEmailResponse)
async def preview_test_email(request: PreviewEmailRequest):
    """
    Generate a test email via AI (no sending). Returns subject + body for user review.
    """
    try:
        recipient_name = request.to_name or request.to_email.split("@")[0].title()
        print(f"[Test Email Preview] Generating preview for {recipient_name} <{request.to_email}>...")
        email_data = await generate_test_email(recipient_name, request.to_email, "", request.hints or "")
        subject = email_data.get("subject") or "Quick introduction"
        body_html = email_data.get("body_html", "")
        body_text = email_data.get("body_text", "")
        return PreviewEmailResponse(
            success=True,
            subject=subject,
            body_html=body_html,
            body_text=body_text,
            preview=body_text[:300] if body_text else None,
        )
    except HTTPException:
        raise
    except Exception as e:
        print(f"[Test Email Preview] Error: {e}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/send", response_model=TestEmailResponse)
async def send_test_email(request: TestEmailRequest):
    """
    Send a personalized test email.
    If subject/body_html/body_text are provided (from a preview), skips AI generation.
    Uses the configured LLM provider for AI personalization + Gmail API for sending.
    No Celery workers needed.
    """
    try:
        recipient_name = request.to_name or request.to_email.split("@")[0].title()

        # Step 1: Use pre-generated content if available, otherwise generate now
        if request.subject and request.body_html and request.body_text:
            print(f"[Test Email] Using pre-generated content for {recipient_name} <{request.to_email}>...")
            email_data = {
                "subject": request.subject,
                "body_html": request.body_html,
                "body_text": request.body_text,
            }
        else:
            print(f"[Test Email] Generating email for {recipient_name} <{request.to_email}>...")
            email_data = await generate_test_email(
                recipient_name, request.to_email,
                request.custom_message or "", request.hints or ""
            )

        subject = email_data.get("subject") or "Quick introduction"
        body_html = email_data.get("body_html", "")
        body_text = email_data.get("body_text", "")

        # Step 2: Send via Gmail API
        print(f"[Test Email] Sending via Gmail API...")

        from integrations.gmail_client import GmailClient

        account = get_oauth_account()

        gmail = GmailClient(
            email=account["email"],
            refresh_token=account["refresh_token"],
            access_token=account.get("access_token"),
        )

        tracking_token = str(uuid.uuid4())
        send_result = gmail.send_email(
            to_email=request.to_email,
            to_name=recipient_name,
            subject=subject,
            body_html=body_html,
            body_text=body_text,
            tracking_token=tracking_token,
            backend_url=os.getenv("BACKEND_URL", "http://localhost:8000"),
            save_to_db=False,
        )

        print(f"[Test Email] Sent! Message ID: {send_result.get('gmail_message_id')}")

        return TestEmailResponse(
            success=True,
            message=f"Email sent to {recipient_name} <{request.to_email}> from {account['email']}",
            subject=subject,
            preview=body_text[:200] if body_text else None,
            gmail_message_id=send_result.get("gmail_message_id"),
        )

    except HTTPException:
        raise
    except Exception as e:
        error_msg = str(e)
        print(f"[Test Email] Error: {error_msg}")
        traceback.print_exc()

        # Provide user-friendly error messages
        if "invalid_grant" in error_msg or "Token has been expired" in error_msg:
            raise HTTPException(
                status_code=400,
                detail="Gmail OAuth token expired. Please go to Email Accounts and reconnect your Gmail account."
            )
        elif "RefreshError" in error_msg:
            raise HTTPException(
                status_code=400,
                detail="Gmail authentication failed. Please reconnect your Gmail account in Email Accounts."
            )

        raise HTTPException(status_code=500, detail=error_msg)


@router.get("/accounts")
async def get_sending_accounts():
    """Get available email accounts that can send (have OAuth tokens)"""
    try:
        from database.client import get_supabase_client
        supabase = get_supabase_client()

        result = supabase.table("email_accounts") \
            .select("id,email,sender_name,sender_title,status,health_score,refresh_token") \
            .eq("is_active", True) \
            .execute()

        accounts = []
        for acc in (result.data or []):
            accounts.append({
                "id": acc["id"],
                "email": acc["email"],
                "sender_name": acc.get("sender_name", ""),
                "sender_title": acc.get("sender_title", ""),
                "status": acc["status"],
                "health_score": acc["health_score"],
                "has_oauth": acc.get("refresh_token") is not None,
            })

        return {"accounts": accounts}

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
