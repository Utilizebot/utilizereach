"""
Campaigns Router
API endpoints for campaign management and execution
"""

from fastapi import APIRouter, HTTPException, BackgroundTasks
from pydantic import BaseModel
from typing import Optional
import os
import sys
import uuid
from pathlib import Path
from datetime import datetime
from dotenv import load_dotenv

# Add parent directory to path to import campaign logic
sys.path.append(str(Path(__file__).parent.parent.parent))
from integrations.gmail_client import GmailClient
from integrations.llm_client import get_llm_client
from integrations.email_verifier import EmailVerifier
from config import get_email_team, get_company_info
from database.client import get_supabase_admin_client

# Load environment variables from Docker config volume if available
config_env = Path("/app/config/.env")
if config_env.exists():
    load_dotenv(config_env)
else:
    load_dotenv()

router = APIRouter(prefix="/api/campaigns", tags=["Campaigns"])

# Load AI Team from configuration file
AI_TEAM = get_email_team()


class CampaignStartRequest(BaseModel):
    max_emails: int = 30  # Warmup mode: start with 30/day
    delay_seconds: int = 60  # Warmup mode: 60 seconds between emails
    segment: Optional[str] = None  # Target a specific segment (None = all leads)


def get_supabase():
    """Get database client"""
    return get_supabase_admin_client()


def load_gmail_tokens():
    """Load Gmail tokens from .gmail_tokens file"""
    tokens_file = Path(__file__).parent.parent.parent / '.gmail_tokens'

    if not tokens_file.exists():
        raise FileNotFoundError(".gmail_tokens file not found!")

    tokens = {}
    with open(tokens_file) as f:
        for line in f:
            line = line.strip()
            if line and '=' in line:
                key, value = line.split('=', 1)
                tokens[key] = value

    return tokens


def get_unemailed_leads(limit: int = 50, verify_emails: bool = True, segment: Optional[str] = None):
    """
    Get leads that haven't been emailed yet and aren't excluded

    Args:
        limit: Maximum number of leads to return
        verify_emails: Whether to verify email validity (recommended: True)
        segment: Optional segment key to restrict the campaign to one segment
    """
    supabase = get_supabase()
    verifier = EmailVerifier()

    # Get exclusion list
    exclusions_result = supabase.table('email_exclusions').select('email').execute()
    excluded_emails = {e['email'].lower() for e in (exclusions_result.data or [])}

    # Get all leads from scraped_leads (get more to account for invalid emails)
    fetch_limit = limit * 3 if verify_emails else limit * 2
    leads_query = supabase.table('scraped_leads')\
        .select('*')\
        .eq('status', 'new')
    if segment:
        leads_query = leads_query.eq('segment', segment)
    leads_result = leads_query.limit(fetch_limit).execute()

    all_leads = leads_result.data or []

    # Filter out leads that have already been emailed or are excluded
    unemailed_leads = []
    invalid_count = 0

    for lead in all_leads:
        lead_email = lead.get('email', '').lower()

        # Skip if excluded
        if lead_email in excluded_emails:
            continue

        # Verify email validity (protects domain reputation)
        if verify_emails:
            verification = verifier.verify_email(lead_email, check_smtp=False)

            if not verification['is_valid']:
                print(f"❌ Skipping invalid email: {lead_email} - {verification['recommendation']}")
                invalid_count += 1

                # Auto-add to exclusions and mark as invalid
                try:
                    supabase.table('email_exclusions').insert({
                        'email': lead_email,
                        'reason': f"Auto-excluded: {verification['recommendation']}",
                        'excluded_by': 'system_verification'
                    }).execute()

                    supabase.table('scraped_leads').update({
                        'status': 'invalid'
                    }).eq('id', lead['id']).execute()
                except:
                    pass  # Ignore if already exists

                continue

        # Check if lead has been emailed
        sent_check = supabase.table('sent_emails')\
            .select('id')\
            .eq('recipient_email', lead['email'])\
            .limit(1)\
            .execute()

        if not sent_check.data or len(sent_check.data) == 0:
            # Normalize lead data to match expected format
            normalized_lead = {
                'id': lead.get('id'),
                'email': lead.get('email'),
                'name': lead.get('decision_maker_name'),
                'company': lead.get('company_name'),
                'title': lead.get('decision_maker_title'),
                'industry': lead.get('industry'),
                'location': lead.get('location'),
                'status': lead.get('status')
            }
            unemailed_leads.append(normalized_lead)

            # Stop if we have enough
            if len(unemailed_leads) >= limit:
                break

    if invalid_count > 0:
        print(f"⚠️  Filtered out {invalid_count} invalid emails to protect domain reputation")

    return unemailed_leads


def get_email_ai_settings():
    """Get email AI settings from database, with fallback to defaults"""
    try:
        supabase = get_supabase()
        result = supabase.table('email_ai_settings').select('*').limit(1).execute()

        if result.data and len(result.data) > 0:
            return result.data[0]
    except Exception as e:
        print(f"Warning: Could not load email AI settings from database: {e}")

    # Return defaults if database not available or no settings
    return {
        'company_name': 'Your Company Name',
        'company_tagline': 'Your company tagline here',
        'company_services': '- Your service or product 1\n- Your service or product 2\n- Your service or product 3',
        'cta_link_1_label': 'Schedule a Call',
        'cta_link_1_url': 'https://calendly.com/your-link',
        'cta_link_2_label': 'Learn More',
        'cta_link_2_url': 'https://www.your-website.com',
        'email_word_limit': 150,
        'email_tone': 'professional but conversational',
        'ai_prompt_template': None  # Will use fallback prompt
    }


def generate_personalized_email(gemini_client, sender, lead):
    """Generate personalized email for lead using Gemini AI"""

    # Get settings from database
    settings = get_email_ai_settings()

    # Build lead context
    lead_name = lead.get('name', 'there')
    lead_company = lead.get('company', 'your company')
    lead_title = lead.get('title', 'your role')
    lead_industry = lead.get('industry', 'your industry')

    # CTA links from settings
    cta_links = {
        settings.get('cta_link_1_label', 'Schedule a Call'): settings.get('cta_link_1_url', '#'),
        settings.get('cta_link_2_label', 'Learn More'): settings.get('cta_link_2_url', '#')
    }

    # Get company info from settings
    company_name = settings.get('company_name', 'Your Company')
    company_tagline = settings.get('company_tagline', '')
    company_services = settings.get('company_services', '')
    word_limit = settings.get('email_word_limit', 150)

    # Check if custom prompt template exists
    custom_template = settings.get('ai_prompt_template')

    if custom_template:
        # Use custom template with placeholder replacement
        try:
            prompt = custom_template.format(
                company_name=company_name,
                company_tagline=company_tagline,
                company_services=company_services,
                sender_name=sender['name'],
                sender_title=sender['title'],
                sender_persona=sender.get('persona', 'professional and consultative'),
                sender_focus=sender.get('focus', 'helping businesses succeed'),
                lead_name=lead_name,
                lead_company=lead_company,
                lead_title=lead_title,
                lead_industry=lead_industry,
                word_limit=word_limit
            )
        except KeyError as e:
            print(f"Warning: Missing placeholder in custom template: {e}. Using fallback prompt.")
            prompt = None
    else:
        prompt = None

    # Fallback to default prompt if no custom template or template failed
    if not prompt:
        prompt = f"""
You are {sender['name']}, {sender['title']} at {company_name} - {company_tagline}.

Your personality: {sender.get('persona', 'professional and consultative')}
Your focus: {sender.get('focus', 'helping businesses succeed')}

ABOUT {company_name} (CRITICAL - ONLY WRITE ABOUT THIS):
{company_name} specializes in:
{company_services}

Write a personalized cold outreach email to:
- Name: {lead_name}
- Company: {lead_company}
- Title: {lead_title}
- Industry: {lead_industry}

STRICT REQUIREMENTS:
1. ONLY discuss {company_name}'s services (listed above)
2. Focus on how {lead_company} in {lead_industry} industry could benefit
3. Reference specific pain points in {lead_industry} that your services can solve
4. Mention CONCRETE benefits: cost reduction, efficiency gains, ROI
5. Professional but conversational tone - like a human consultant reaching out
6. Show you researched their company/industry (mention {lead_title} role specifically)
7. Focus on YOUR specialty: {sender.get('focus', 'your area of expertise')}
8. Keep it under {word_limit} words (3-4 short paragraphs)
9. Sign as {sender['name']}, {sender['title']} at {company_name}
10. Include clear call-to-action with the CTA links provided

NEVER:
- Mention you're an AI or this is automated
- Talk about services outside what is listed above
- Use generic "solutions" language without specifics
- Write about other companies or industries
- Use salesy buzzwords

Write as if you personally researched {lead_company} and are genuinely reaching out to help.
"""

    lead_data = {
        'name': lead_name,
        'email': lead.get('email'),
        'company': lead_company,
        'title': lead_title,
        'industry': lead_industry
    }

    try:
        result = gemini_client.generate_email(
            user_prompt=prompt,
            lead_data=lead_data,
            cta_links=cta_links,
            sender_name=sender['name']
        )

        return result
    except Exception as e:
        print(f"Error generating email: {e}")
        return None


async def run_campaign_background(max_emails: int, delay_seconds: int, segment: Optional[str] = None):
    """
    Run email campaign in background

    Args:
        max_emails: Maximum number of emails to send
        delay_seconds: Delay between emails (rate limiting)
        segment: Optional segment key to restrict the campaign to one segment
    """
    import time

    try:
        # Initialize clients
        tokens = load_gmail_tokens()
        base_email = tokens.get('GMAIL_EMAIL')
        refresh_token = tokens.get('GMAIL_REFRESH_TOKEN')
        access_token = tokens.get('GMAIL_ACCESS_TOKEN')

        gmail_client = GmailClient(
            email=base_email,
            refresh_token=refresh_token,
            access_token=access_token
        )

        gemini_client = get_llm_client()

        # Get unemailed leads
        leads = get_unemailed_leads(max_emails, segment=segment)

        if not leads:
            return {
                'success': True,
                'sent': 0,
                'errors': 0,
                'total': 0,
                'message': 'No new leads to email'
            }

        # Distribute leads across AI team (round-robin)
        lead_assignments = []
        for idx, lead in enumerate(leads):
            sender = AI_TEAM[idx % len(AI_TEAM)]
            lead_assignments.append({
                'lead': lead,
                'sender': sender
            })

        # Send emails
        sent_count = 0
        error_count = 0

        for idx, assignment in enumerate(lead_assignments):
            lead = assignment['lead']
            sender = assignment['sender']

            try:
                # Generate personalized email
                email_content = generate_personalized_email(gemini_client, sender, lead)

                if not email_content:
                    error_count += 1
                    continue

                # Create tracking token
                tracking_token = str(uuid.uuid4())

                # Send email
                result = gmail_client.send_email(
                    to_email=lead['email'],
                    to_name=lead.get('name'),
                    subject=email_content['subject'],
                    body_html=email_content['body_html'],
                    body_text=email_content['body_text'],
                    tracking_token=tracking_token,
                    backend_url=os.getenv('BACKEND_URL', 'http://localhost:8000'),
                    save_to_db=True,
                    from_email=sender['email'],
                    from_name=sender['name']
                )

                if result.get('success'):
                    sent_count += 1

                    # Update lead status in scraped_leads
                    supabase = get_supabase()
                    supabase.table('scraped_leads').update({
                        'status': 'contacted',
                        'updated_at': datetime.utcnow().isoformat()
                    }).eq('id', lead['id']).execute()

                else:
                    error_count += 1

            except Exception as e:
                error_count += 1
                print(f"Error sending to {lead.get('email')}: {e}")

            # Rate limiting delay
            if idx < len(lead_assignments) - 1:
                time.sleep(delay_seconds)

        return {
            'success': True,
            'sent': sent_count,
            'errors': error_count,
            'total': len(lead_assignments)
        }

    except Exception as e:
        print(f"Campaign error: {e}")
        return {
            'success': False,
            'error': str(e)
        }


@router.post("/start")
async def start_campaign(request: CampaignStartRequest, background_tasks: BackgroundTasks):
    """
    Start an email campaign

    Sends personalized emails to unemailed leads using AI team members.
    Campaign runs in the background.

    Args:
        max_emails: Maximum number of emails to send (default: 50)
        delay_seconds: Delay between emails in seconds (default: 10)

    Returns:
        Campaign start confirmation and estimated details
    """
    try:
        # Check if .gmail_tokens exists
        tokens_file = Path(__file__).parent.parent.parent / '.gmail_tokens'
        if not tokens_file.exists():
            raise HTTPException(
                status_code=400,
                detail="Gmail tokens not configured. Please authenticate with Gmail first."
            )

        # Get count of unemailed leads
        leads = get_unemailed_leads(request.max_emails, segment=request.segment)
        leads_count = len(leads)

        if leads_count == 0:
            return {
                'success': True,
                'started': False,
                'message': 'No new leads to email',
                'leads_count': 0
            }

        # Start campaign in background
        background_tasks.add_task(
            run_campaign_background,
            request.max_emails,
            request.delay_seconds,
            request.segment
        )

        seg_note = f' in segment "{request.segment}"' if request.segment else ''

        return {
            'success': True,
            'started': True,
            'message': f'Campaign started! Sending to {leads_count} leads{seg_note}.',
            'leads_count': leads_count,
            'max_emails': request.max_emails,
            'delay_seconds': request.delay_seconds,
            'estimated_duration_minutes': (leads_count * request.delay_seconds) / 60
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to start campaign: {str(e)}")


@router.get("/status")
async def get_campaign_status():
    """
    Get current campaign status

    Returns count of leads by status
    """
    try:
        supabase = get_supabase()

        # Get total leads
        total_leads = supabase.table('scraped_leads').select('id', count='exact').execute()

        # Get leads by status
        new_leads = supabase.table('scraped_leads').select('id', count='exact').eq('status', 'new').execute()
        contacted_leads = supabase.table('scraped_leads').select('id', count='exact').eq('status', 'contacted').execute()

        # Get unemailed count
        unemailed = get_unemailed_leads(1000)  # Check up to 1000

        return {
            'total_leads': total_leads.count if total_leads.count else 0,
            'new_leads': new_leads.count if new_leads.count else 0,
            'contacted_leads': contacted_leads.count if contacted_leads.count else 0,
            'unemailed_leads': len(unemailed)
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get campaign status: {str(e)}")
