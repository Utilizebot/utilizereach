"""
Email Tracking Router
Handles tracking endpoints for email opens, clicks, and unsubscribes
"""

from fastapi import APIRouter, Response, HTTPException
from fastapi.responses import RedirectResponse, StreamingResponse
from datetime import datetime

from database.client import get_supabase_admin_client
from urllib.parse import unquote
import io

router = APIRouter(prefix="/track", tags=["Email Tracking"])


def get_supabase():
    """Get database client"""
    return get_supabase_admin_client()


@router.get("/open/{tracking_token}")
async def track_email_open(tracking_token: str):
    """
    Track email open via tracking pixel

    Returns a 1x1 transparent PNG pixel
    Records the open event in the database

    Args:
        tracking_token: Unique tracking token for the email
    """
    try:
        supabase = get_supabase()

        # Find the sent email by tracking token
        sent_email = supabase.table("sent_emails").select("*").eq("tracking_token", tracking_token).execute()

        if not sent_email.data or len(sent_email.data) == 0:
            # Email not found, but still return pixel (don't reveal tracking)
            return _return_tracking_pixel()

        email_id = sent_email.data[0]["id"]

        # Check if already opened (check opened_at field in sent_emails)
        if not sent_email.data[0].get("opened_at"):
            # First open - update sent_emails with opened timestamp
            supabase.table("sent_emails").update({
                "opened_at": datetime.utcnow().isoformat(),
                "status": "opened"
            }).eq("id", email_id).execute()

        # Always return the tracking pixel
        return _return_tracking_pixel()

    except Exception as e:
        print(f"Error tracking email open: {e}")
        # Still return pixel even on error (silent failure)
        return _return_tracking_pixel()


@router.get("/click/{tracking_token}")
async def track_email_click(tracking_token: str, url: str):
    """
    Track email link click and redirect to original URL

    Records the click event and redirects user to the actual destination

    Args:
        tracking_token: Unique tracking token for the email
        url: Original URL to redirect to (URL-encoded)
    """
    try:
        supabase = get_supabase()

        # Decode the URL
        original_url = unquote(url)

        # Find the sent email by tracking token
        sent_email = supabase.table("sent_emails").select("*").eq("tracking_token", tracking_token).execute()

        if sent_email.data and len(sent_email.data) > 0:
            email_id = sent_email.data[0]["id"]

            # Record the click (removed event_type as it doesn't exist in schema)
            supabase.table("email_clicks").insert({
                "sent_email_id": email_id,
                "link_url": original_url,
                "clicked_at": datetime.utcnow().isoformat(),
                "user_agent": None,
                "ip_address": None
            }).execute()

            # Update sent_email status if not already opened/clicked
            if sent_email.data[0].get("status") == "sent":
                supabase.table("sent_emails").update({
                    "status": "clicked"
                }).eq("id", email_id).execute()

        # Redirect to original URL
        return RedirectResponse(url=original_url, status_code=302)

    except Exception as e:
        print(f"Error tracking email click: {e}")
        # Still redirect even on error
        return RedirectResponse(url=url, status_code=302)


@router.get("/unsubscribe/{tracking_token}")
async def track_unsubscribe(tracking_token: str):
    """
    Handle email unsubscribe request

    Records the unsubscribe and displays confirmation page

    Args:
        tracking_token: Unique tracking token for the email
    """
    try:
        supabase = get_supabase()

        # Find the sent email by tracking token
        sent_email = supabase.table("sent_emails").select("*").eq("tracking_token", tracking_token).execute()

        if not sent_email.data or len(sent_email.data) == 0:
            raise HTTPException(status_code=404, detail="Email not found")

        email_id = sent_email.data[0]["id"]
        recipient_email = sent_email.data[0]["recipient_email"]

        # Check if already unsubscribed
        existing = supabase.table("email_unsubscribes").select("id").eq("email", recipient_email).execute()

        if not existing.data or len(existing.data) == 0:
            # Record unsubscribe
            supabase.table("email_unsubscribes").insert({
                "email": recipient_email,
                "sent_email_id": email_id,
                "unsubscribed_at": datetime.utcnow().isoformat(),
                "reason": "user_request"
            }).execute()

            # Update sent_email status
            supabase.table("sent_emails").update({
                "status": "unsubscribed"
            }).eq("id", email_id).execute()

        # Return HTML confirmation page
        html_content = """
        <!DOCTYPE html>
        <html>
        <head>
            <title>Unsubscribed</title>
            <style>
                body {
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    min-height: 100vh;
                    margin: 0;
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                }
                .container {
                    background: white;
                    padding: 3rem;
                    border-radius: 12px;
                    box-shadow: 0 10px 40px rgba(0,0,0,0.1);
                    text-align: center;
                    max-width: 500px;
                }
                h1 {
                    color: #2d3748;
                    font-size: 2rem;
                    margin-bottom: 1rem;
                }
                p {
                    color: #718096;
                    font-size: 1.1rem;
                    line-height: 1.6;
                }
                .checkmark {
                    font-size: 4rem;
                    color: #48bb78;
                    margin-bottom: 1rem;
                }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="checkmark">✓</div>
                <h1>You've Been Unsubscribed</h1>
                <p>We're sorry to see you go! You will no longer receive emails from us.</p>
                <p style="color: #a0aec0; font-size: 0.9rem; margin-top: 2rem;">
                    If this was a mistake, please contact us directly.
                </p>
            </div>
        </body>
        </html>
        """

        return Response(content=html_content, media_type="text/html")

    except HTTPException:
        raise
    except Exception as e:
        print(f"Error handling unsubscribe: {e}")
        raise HTTPException(status_code=500, detail="Failed to process unsubscribe")


def _return_tracking_pixel():
    """Return a 1x1 transparent PNG pixel"""
    # 1x1 transparent PNG in base64
    pixel_data = b'\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\nIDATx\x9cc\x00\x01\x00\x00\x05\x00\x01\r\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82'

    return StreamingResponse(
        io.BytesIO(pixel_data),
        media_type="image/png",
        headers={
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Pragma": "no-cache",
            "Expires": "0"
        }
    )
