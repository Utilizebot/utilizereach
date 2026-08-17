"""
Email Accounts Router
API endpoints for managing email sending accounts and viewing their statistics
Includes Google OAuth integration for Gmail accounts
"""

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import RedirectResponse
import os
import json

from database.client import get_supabase_admin_client
from datetime import datetime, timedelta
from google_auth_oauthlib.flow import Flow
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build

router = APIRouter(prefix="/api/email-accounts", tags=["Email Accounts"])

# Google OAuth Configuration
GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "")
GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET", "")


def get_public_base_url(request: Request) -> str:
    """Public base URL used to build the OAuth redirect_uri.

    This MUST match the redirect URI registered in Google Cloud exactly.
    Behind a reverse proxy / Cloudflare tunnel the request reaches the backend
    over http internally, so header-derived schemes are unreliable — prefer an
    explicitly configured public URL.
    """
    for var in ("PUBLIC_BASE_URL", "BACKEND_URL", "FRONTEND_URL"):
        v = os.getenv(var, "").strip()
        if v.startswith("http"):
            return v.rstrip('/')
    host = request.headers.get('host', 'localhost:8000')
    scheme = request.headers.get('x-forwarded-proto', 'http')
    return f"{scheme}://{host}"


def get_frontend_url(request: Request) -> str:
    """Derive frontend URL from request headers (works with nginx proxy)"""
    # First check env var
    env_url = os.getenv("FRONTEND_URL", "")
    if env_url:
        return env_url.rstrip('/')

    # Otherwise derive from request
    host = request.headers.get('host', 'localhost:3000')
    scheme = request.headers.get('x-forwarded-proto', 'http')

    # In dev mode, frontend is on port 3000 while backend is on 8000
    if ':8000' in host:
        host = host.replace(':8000', ':3000')

    return f"{scheme}://{host}"

# Gmail API Scopes
GMAIL_SCOPES = [
    'https://www.googleapis.com/auth/gmail.send',
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/gmail.settings.basic',
    'https://www.googleapis.com/auth/gmail.settings.sharing',
    'https://www.googleapis.com/auth/userinfo.email',
    'openid'
]


def get_supabase():
    """Get database client"""
    return get_supabase_admin_client()


@router.get("/")
async def get_all_accounts():
    """
    Get all email accounts with their current statistics

    Returns:
    - List of all email accounts
    - Sending statistics for each account
    - Quota usage
    - Health metrics
    """
    try:
        supabase = get_supabase()

        # Get all email accounts
        accounts_result = supabase.table('email_accounts')\
            .select('*')\
            .execute()

        if not accounts_result.data:
            return {"accounts": [], "total": 0}

        accounts_with_stats = []

        for account in accounts_result.data:
            # Get emails sent by this account (all time)
            all_time_sent = supabase.table('sent_emails')\
                .select('id', count='exact')\
                .eq('from_email', account.get('email', ''))\
                .execute()

            total_sent = len(all_time_sent.data) if all_time_sent.data else 0

            # Get emails sent today
            today_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
            today_sent = supabase.table('sent_emails')\
                .select('id', count='exact')\
                .eq('from_email', account.get('email', ''))\
                .gte('sent_at', today_start.isoformat())\
                .execute()

            sent_today = len(today_sent.data) if today_sent.data else 0

            # Get emails sent this week
            week_start = datetime.utcnow() - timedelta(days=7)
            week_sent = supabase.table('sent_emails')\
                .select('id', count='exact')\
                .eq('from_email', account.get('email', ''))\
                .gte('sent_at', week_start.isoformat())\
                .execute()

            sent_this_week = len(week_sent.data) if week_sent.data else 0

            # Calculate remaining quota
            daily_limit = account.get('daily_limit', 50)
            remaining_today = max(0, daily_limit - sent_today)

            # Get engagement stats for this account
            account_emails = supabase.table('sent_emails')\
                .select('*')\
                .eq('from_email', account.get('email', ''))\
                .execute()

            opened_count = len([e for e in (account_emails.data or []) if e.get('opened_at')])
            clicked_count = len([e for e in (account_emails.data or []) if e.get('clicked')])
            replied_count = len([e for e in (account_emails.data or []) if e.get('replied')])

            # Calculate engagement rate
            open_rate = (opened_count / total_sent * 100) if total_sent > 0 else 0
            click_rate = (clicked_count / opened_count * 100) if opened_count > 0 else 0
            reply_rate = (replied_count / total_sent * 100) if total_sent > 0 else 0

            accounts_with_stats.append({
                **account,
                "stats": {
                    "total_sent": total_sent,
                    "sent_today": sent_today,
                    "sent_this_week": sent_this_week,
                    "remaining_today": remaining_today,
                    "opened": opened_count,
                    "clicked": clicked_count,
                    "replied": replied_count,
                    "open_rate": round(open_rate, 1),
                    "click_rate": round(click_rate, 1),
                    "reply_rate": round(reply_rate, 1)
                }
            })

        return {
            "accounts": accounts_with_stats,
            "total": len(accounts_with_stats)
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get accounts: {str(e)}")


@router.get("/stats")
async def get_accounts_summary():
    """
    Get summary statistics across all email accounts

    Returns:
    - Total accounts
    - Total emails sent
    - Combined quota usage
    - Overall health
    """
    try:
        supabase = get_supabase()

        # Get all accounts
        accounts = supabase.table('email_accounts').select('*').execute()

        total_accounts = len(accounts.data) if accounts.data else 0
        total_daily_limit = sum(a.get('daily_limit', 50) for a in (accounts.data or []))
        avg_health_score = sum(a.get('health_score', 100) for a in (accounts.data or [])) / total_accounts if total_accounts > 0 else 0

        # Get total emails sent today across all accounts
        today_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
        today_sent = supabase.table('sent_emails')\
            .select('id', count='exact')\
            .gte('sent_at', today_start.isoformat())\
            .execute()

        total_sent_today = len(today_sent.data) if today_sent.data else 0
        remaining_today = max(0, total_daily_limit - total_sent_today)

        # Get all time totals
        all_emails = supabase.table('sent_emails').select('id', count='exact').execute()
        total_all_time = len(all_emails.data) if all_emails.data else 0

        return {
            "total_accounts": total_accounts,
            "total_daily_limit": total_daily_limit,
            "total_sent_today": total_sent_today,
            "remaining_today": remaining_today,
            "total_sent_all_time": total_all_time,
            "avg_health_score": round(avg_health_score, 1),
            "usage_percentage": round((total_sent_today / total_daily_limit * 100) if total_daily_limit > 0 else 0, 1)
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get summary: {str(e)}")


@router.get("/personas")
async def get_sending_personas():
    """List the AI sending personas (from team config). These are the
    identities campaigns rotate through — each sends via the connected
    base account using its own send-as alias."""
    from config import get_email_team, get_company_info
    team = get_email_team()
    company = get_company_info()
    # which base mailbox actually sends (the connected account)
    base_email = None
    try:
        accounts = get_supabase().table('email_accounts').select('email').eq('status', 'active').limit(1).execute()
        if accounts.data:
            base_email = accounts.data[0]['email']
    except Exception:
        pass
    return {
        "personas": [
            {
                "name": p.get("name"),
                "email": p.get("email"),
                "title": p.get("title", ""),
                "focus": p.get("focus", ""),
            }
            for p in team
        ],
        "base_account": base_email,
        "company": company.get("name", ""),
    }


@router.get("/{account_id}")
async def get_account_details(account_id: str):
    """
    Get detailed information about a specific email account

    Returns:
    - Account details
    - Detailed sending history
    - Engagement metrics
    - Recent emails sent
    """
    try:
        supabase = get_supabase()

        # Get account
        account = supabase.table('email_accounts')\
            .select('*')\
            .eq('id', account_id)\
            .execute()

        if not account.data or len(account.data) == 0:
            raise HTTPException(status_code=404, detail="Account not found")

        account_data = account.data[0]

        # Get recent emails from this account (last 20)
        recent_emails = supabase.table('sent_emails')\
            .select('*')\
            .eq('email_account_id', account_id)\
            .order('sent_at', desc=True)\
            .limit(20)\
            .execute()

        # Get daily sending history (last 30 days)
        daily_history = []
        for i in range(30):
            day_start = (datetime.utcnow() - timedelta(days=i)).replace(hour=0, minute=0, second=0, microsecond=0)
            day_end = day_start + timedelta(days=1)

            day_emails = supabase.table('sent_emails')\
                .select('id', count='exact')\
                .eq('email_account_id', account_id)\
                .gte('sent_at', day_start.isoformat())\
                .lt('sent_at', day_end.isoformat())\
                .execute()

            daily_history.append({
                "date": day_start.strftime('%Y-%m-%d'),
                "sent": len(day_emails.data) if day_emails.data else 0
            })

        daily_history.reverse()  # Show oldest to newest

        return {
            "account": account_data,
            "recent_emails": recent_emails.data or [],
            "daily_history": daily_history
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get account details: {str(e)}")


@router.put("/{account_id}/status")
async def update_account_status(account_id: str, status_data: dict):
    """
    Update account status (active/paused/blocked)

    Body: {"status": "active" | "paused" | "blocked"}
    """
    try:
        supabase = get_supabase()

        new_status = status_data.get('status')
        if not new_status:
            raise HTTPException(status_code=400, detail="Status is required")

        if new_status not in ['active', 'paused', 'blocked', 'warning']:
            raise HTTPException(status_code=400, detail="Invalid status")

        result = supabase.table('email_accounts')\
            .update({"status": new_status})\
            .eq('id', account_id)\
            .execute()

        return {
            "success": True,
            "account_id": account_id,
            "new_status": new_status
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update status: {str(e)}")


# ============================================================================
# GOOGLE OAUTH ENDPOINTS
# ============================================================================

def get_google_oauth_flow(redirect_uri: str) -> Flow:
    """Create Google OAuth Flow"""
    if not GOOGLE_CLIENT_ID or not GOOGLE_CLIENT_SECRET:
        raise HTTPException(
            status_code=400,
            detail="Google OAuth not configured. Please add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to your environment."
        )

    client_config = {
        "web": {
            "client_id": GOOGLE_CLIENT_ID,
            "client_secret": GOOGLE_CLIENT_SECRET,
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": "https://oauth2.googleapis.com/token",
            "redirect_uris": [redirect_uri]
        }
    }

    flow = Flow.from_client_config(
        client_config,
        scopes=GMAIL_SCOPES,
        redirect_uri=redirect_uri
    )
    return flow


@router.get("/google/auth")
async def google_auth_start(request: Request):
    """
    Start Google OAuth flow
    Returns the authorization URL to redirect user to Google
    """
    try:
        # Build callback URL (must match the redirect URI registered in Google Cloud)
        redirect_uri = get_public_base_url(request) + "/api/email-accounts/google/callback"

        flow = get_google_oauth_flow(redirect_uri)

        authorization_url, state = flow.authorization_url(
            access_type='offline',
            include_granted_scopes='true',
            prompt='consent'
        )

        return {
            "auth_url": authorization_url,
            "state": state
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to start OAuth: {str(e)}")


@router.get("/google/callback")
async def google_auth_callback(request: Request, code: str = None, error: str = None, state: str = None):
    """
    Handle Google OAuth callback
    Exchanges auth code for tokens and creates email account
    """
    # Get frontend URL from request headers (works with nginx proxy)
    frontend_url = get_frontend_url(request)

    try:
        if error:
            # Redirect to frontend with error
            return RedirectResponse(
                url=f"{frontend_url}/email-accounts?error={error}",
                status_code=302
            )

        if not code:
            return RedirectResponse(
                url=f"{frontend_url}/email-accounts?error=no_code",
                status_code=302
            )

        # Build callback URL (must match the one used in auth start)
        redirect_uri = get_public_base_url(request) + "/api/email-accounts/google/callback"

        flow = get_google_oauth_flow(redirect_uri)

        # Exchange code for tokens
        flow.fetch_token(code=code)
        credentials = flow.credentials

        # Get user info from Google
        service = build('oauth2', 'v2', credentials=credentials)
        user_info = service.userinfo().get().execute()

        email = user_info.get('email')
        name = user_info.get('name', email.split('@')[0])

        if not email:
            return RedirectResponse(
                url=f"{frontend_url}/email-accounts?error=no_email",
                status_code=302
            )

        # Store in database
        supabase = get_supabase()

        # Check if account already exists
        existing = supabase.table('email_accounts')\
            .select('id')\
            .eq('email', email)\
            .execute()

        # Prepare token expiry (credentials.expiry might not exist)
        token_expiry = None
        if hasattr(credentials, 'expiry') and credentials.expiry:
            token_expiry = credentials.expiry.isoformat()

        if existing.data and len(existing.data) > 0:
            # Update existing account with new tokens
            supabase.table('email_accounts')\
                .update({
                    'access_token': credentials.token,
                    'refresh_token': credentials.refresh_token,
                    'token_expires_at': token_expiry,
                    'status': 'active',
                    'updated_at': datetime.utcnow().isoformat()
                })\
                .eq('email', email)\
                .execute()

            return RedirectResponse(
                url=f"{frontend_url}/email-accounts?success=updated&email={email}",
                status_code=302
            )
        else:
            # Create new account
            supabase.table('email_accounts').insert({
                'email': email,
                'display_name': name,
                'sender_name': name,
                'sender_title': 'Team Member',
                'persona': 'professional',
                'focus_area': 'general',
                'access_token': credentials.token,
                'refresh_token': credentials.refresh_token,
                'token_expires_at': token_expiry,
                'daily_limit': 50,
                'status': 'active',
                'health_score': 1.00,
                'provider': 'gmail'
            }).execute()

            return RedirectResponse(
                url=f"{frontend_url}/email-accounts?success=connected&email={email}",
                status_code=302
            )

    except Exception as e:
        print(f"OAuth callback error: {str(e)}")
        return RedirectResponse(
            url=f"{frontend_url}/email-accounts?error=callback_failed",
            status_code=302
        )


@router.delete("/google/{account_id}")
async def disconnect_google_account(account_id: str):
    """
    Disconnect a Google account (remove OAuth tokens)
    """
    try:
        supabase = get_supabase()

        # Get the account
        account = supabase.table('email_accounts')\
            .select('*')\
            .eq('id', account_id)\
            .execute()

        if not account.data or len(account.data) == 0:
            raise HTTPException(status_code=404, detail="Account not found")

        # Delete the account
        supabase.table('email_accounts')\
            .delete()\
            .eq('id', account_id)\
            .execute()

        return {
            "success": True,
            "message": "Account disconnected successfully"
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to disconnect: {str(e)}")
