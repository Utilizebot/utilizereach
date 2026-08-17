"""
Celery Tasks

Background tasks for lead scraping
"""

import os
import sys
from datetime import datetime
from typing import Dict, Any

# Add parent directory to path to import scraper
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from celery_app.celery import celery_app
from database.operations import (
    update_job_status,
    create_scraping_result,
    get_results_by_job,
)
from utils.redis_client import publish_progress
from utils.csv_generator import (
    generate_csv_from_results,
    initialize_csv_file,
    append_leads_to_csv,
    initialize_verified_csv_file,
    append_leads_to_verified_csv,
)
from scraper.location_config import get_location_config
from scraper.lead_generator_flexible import FlexibleLeadGenerator
from scraper.scraper_with_progress import add_progress_support

# Add progress callback support
add_progress_support()


@celery_app.task(bind=True, name="scrape_leads")
def scrape_leads(
    self,
    job_id: str,
    search_query: str,
    location: str,
    num_queries: int,
    api_key: str,
    industry: str = None,
) -> Dict[str, Any]:
    """
    Execute lead scraping job

    Args:
        self: Celery task instance (for updating state)
        job_id: Job UUID
        search_query: Search query
        location: Location/country code
        num_queries: Number of queries to run
        api_key: SerpAPI key
        industry: Optional industry filter

    Returns:
        Result summary
    """
    try:
        # Initialize RAW CSV file with headers (for progressive writing)
        csv_path = initialize_csv_file(job_id)
        print(f"[Job {job_id}] Raw CSV file initialized: {csv_path}")

        # Initialize VERIFIED LEADS CSV file with headers (for progressive writing)
        verified_csv_path = initialize_verified_csv_file(job_id)
        print(f"[Job {job_id}] Verified leads CSV file initialized: {verified_csv_path}")

        # Update job status to running with CSV paths
        # Note: verified_csv_path stored locally, not in DB (column doesn't exist yet)
        update_job_status(
            job_id,
            status="running",
            started_at=datetime.utcnow().isoformat(),
            celery_task_id=self.request.id,
            csv_file_path=csv_path,
        )

        # Get location configuration
        location_config = get_location_config(location)
        if not location_config:
            raise ValueError(f"Invalid location: {location}")

        # Set API key in environment FIRST (before initializing scraper)
        os.environ["SERPAPI_KEY"] = api_key

        # Initialize scraper (now it can find the API key)
        generator = FlexibleLeadGenerator(location_config)

        # Prepare progress callback
        total_steps = num_queries
        current_step = [0]  # Use list to allow modification in nested function

        def on_progress(query_num: int, total_queries: int, message: str, leads_so_far: int = 0):
            """Progress callback for scraper"""
            current_step[0] = query_num
            progress = int((query_num / total_queries) * 100)

            # Update database
            from database.operations import update_job_progress
            update_job_progress(
                job_id,
                progress=progress,
                current_step=message,
                total_leads_found=leads_so_far,
            )

            # Publish to Redis for WebSocket
            publish_progress(job_id, progress, message, leads_so_far)

            # Update Celery task state
            self.update_state(
                state="PROGRESS",
                meta={
                    "progress": progress,
                    "current_step": message,
                    "total_leads_found": leads_so_far,
                },
            )

        # Track verified leads count
        verified_count = [0]  # Use list to allow modification in nested function

        # Prepare save callback for progressive saving (DB + Raw CSV + Verified CSV)
        def on_save_leads(leads_list):
            """Save leads immediately to database AND both CSVs (called after each website)"""
            # Save to database
            for lead in leads_list:
                try:
                    create_scraping_result(
                        job_id=job_id,
                        company_name=lead.get("company"),
                        contact_name=lead.get("name"),
                        contact_title=lead.get("title"),
                        email=lead.get("email"),
                        phone=lead.get("phone"),
                        source_url=lead.get("url"),
                        relevance_score=lead.get("score", 0),
                    )
                except Exception as e:
                    print(f"[Job {job_id}] Warning: Failed to save lead to DB: {e}")
                    continue

            # Append to Raw CSV file
            try:
                append_leads_to_csv(job_id, leads_list)
            except Exception as e:
                print(f"[Job {job_id}] Warning: Failed to append to Raw CSV: {e}")

            # Append to Verified CSV file (filtered with email verification)
            try:
                verified_added = append_leads_to_verified_csv(job_id, leads_list, verify_mx=True)
                verified_count[0] += verified_added
            except Exception as e:
                print(f"[Job {job_id}] Warning: Failed to append to Verified CSV: {e}")

        # Run scraping with progressive saving
        print(f"[Job {job_id}] Starting scraping: query='{search_query}', location={location}, num_queries={num_queries}")
        print(f"[Job {job_id}] Progressive saving ENABLED - DB + Raw CSV + Verified CSV updated after each website")

        results = generator.scrape_leads_with_progress(
            base_query=search_query,
            num_queries=num_queries,
            progress_callback=on_progress,
            save_callback=on_save_leads,  # Progressive saving callback (DB + CSV)
        )

        print(f"[Job {job_id}] Scraping complete. Found {len(results)} raw leads (all already saved to DB + Raw CSV).")
        print(f"[Job {job_id}] Verified leads: {verified_count[0]} (saved to Verified CSV with MX verification)")

        # Update job as completed
        # Note: Only using columns that exist in DB schema
        update_job_status(
            job_id,
            status="completed",
            completed_at=datetime.utcnow().isoformat(),
            leads_found=len(results),  # Schema uses 'leads_found' not 'total_leads_found'
            csv_file_path=csv_path,
            progress=100,
            current_step=f"Completed - {verified_count[0]} verified leads",
        )

        # Final progress update
        publish_progress(job_id, 100, "Completed", len(results))

        return {
            "status": "completed",
            "total_leads_found": len(results),
            "verified_count": verified_count[0],
            "csv_path": csv_path,
            "verified_csv_path": verified_csv_path,
        }

    except Exception as e:
        # Log error
        error_message = str(e)
        print(f"[Job {job_id}] ERROR: {error_message}")

        # Update job as failed
        update_job_status(
            job_id,
            status="failed",
            error_message=error_message,
            completed_at=datetime.utcnow().isoformat(),
        )

        # Publish error
        publish_progress(job_id, 0, f"Failed: {error_message}", 0)

        # Re-raise for Celery retry mechanism
        raise


# Add a simple test task
@celery_app.task(name="test_celery")
def test_celery():
    """Simple test task to verify Celery is working"""
    return {"status": "ok", "message": "Celery is working!"}


@celery_app.task(bind=True, name="celery_app.tasks.send_daily_campaign")
def send_daily_campaign(self) -> Dict[str, Any]:
    """
    Automated daily email campaign task

    Runs at 10:00 AM Malaysia time (configured in celery.py beat_schedule)
    Sends personalized AI-generated emails to new leads

    Returns:
        Result summary with sent count, errors, and status
    """
    import time
    import uuid
    from datetime import datetime, timedelta
    from pathlib import Path

    # Import from parent directory
    sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    from integrations.gmail_client import GmailClient
    from integrations.llm_client import get_llm_client
    from integrations.email_verifier import EmailVerifier
    from database.client import get_supabase_admin_client
    from config import get_email_team

    def get_supabase():
        """Get database client"""
        return get_supabase_admin_client()

    # AI Team Configuration (same source as campaigns.py: config/team_config.json)
    AI_TEAM = get_email_team()
    if not AI_TEAM:
        print("[Scheduler] No email team configured (config/team_config.json), skipping")
        return {'status': 'skipped', 'reason': 'No email team configured'}

    supabase = get_supabase()
    print(f"[Scheduler] Daily campaign task started at {datetime.utcnow().isoformat()}")

    # 1. Check if scheduler is enabled
    settings_result = supabase.table('scheduler_settings').select('*').limit(1).execute()

    if not settings_result.data:
        print("[Scheduler] No settings found, creating default settings")
        supabase.table('scheduler_settings').insert({
            'is_enabled': False,
            'daily_limit': 30,
            'send_hour': 10,
            'send_minute': 0,
            'timezone': 'Asia/Kuala_Lumpur',
            'delay_between_emails': 60
        }).execute()
        return {'status': 'skipped', 'reason': 'Scheduler not configured'}

    config = settings_result.data[0]

    if not config.get('is_enabled'):
        print("[Scheduler] Scheduler is disabled, skipping")
        return {'status': 'skipped', 'reason': 'Scheduler is disabled'}

    daily_limit = config.get('daily_limit', 30)
    delay_seconds = config.get('delay_between_emails', 60)

    print(f"[Scheduler] Config: daily_limit={daily_limit}, delay={delay_seconds}s")

    # 2. Create run history record
    run_record = supabase.table('scheduler_run_history').insert({
        'status': 'running',
        'leads_attempted': 0,
        'emails_sent': 0,
        'emails_failed': 0
    }).execute()
    run_id = run_record.data[0]['id']

    try:
        # 3. Get unemailed leads (reuse logic from campaigns.py)
        verifier = EmailVerifier()

        # Get exclusion list
        exclusions_result = supabase.table('email_exclusions').select('email').execute()
        excluded_emails = {e['email'].lower() for e in (exclusions_result.data or [])}

        # Get leads with status='new'
        fetch_limit = daily_limit * 3
        leads_result = supabase.table('scraped_leads')\
            .select('*')\
            .eq('status', 'new')\
            .limit(fetch_limit)\
            .execute()

        all_leads = leads_result.data or []
        leads = []

        for lead in all_leads:
            lead_email = lead.get('email', '').lower()

            if lead_email in excluded_emails:
                continue

            # Verify email
            verification = verifier.verify_email(lead_email, check_smtp=False)
            if not verification['is_valid']:
                print(f"[Scheduler] Skipping invalid email: {lead_email}")
                try:
                    supabase.table('email_exclusions').insert({
                        'email': lead_email,
                        'reason': f"Auto-excluded: {verification['recommendation']}",
                        'excluded_by': 'scheduler'
                    }).execute()
                    supabase.table('scraped_leads').update({
                        'status': 'invalid'
                    }).eq('id', lead['id']).execute()
                except:
                    pass
                continue

            # Check if already emailed
            sent_check = supabase.table('sent_emails')\
                .select('id')\
                .eq('recipient_email', lead['email'])\
                .limit(1)\
                .execute()

            if not sent_check.data:
                leads.append({
                    'id': lead.get('id'),
                    'email': lead.get('email'),
                    'name': lead.get('decision_maker_name'),
                    'company': lead.get('company_name'),
                    'title': lead.get('decision_maker_title'),
                    'industry': lead.get('industry'),
                    'location': lead.get('location')
                })

                if len(leads) >= daily_limit:
                    break

        if not leads:
            print("[Scheduler] No new leads to email")
            supabase.table('scheduler_run_history').update({
                'status': 'success',
                'completed_at': datetime.utcnow().isoformat(),
                'leads_attempted': 0,
                'emails_sent': 0
            }).eq('id', run_id).execute()

            # Update next run time
            next_run = datetime.utcnow() + timedelta(days=1)
            supabase.table('scheduler_settings').update({
                'last_run_at': datetime.utcnow().isoformat(),
                'last_run_status': 'success',
                'last_run_sent_count': 0,
                'next_run_at': next_run.isoformat()
            }).eq('id', config['id']).execute()

            return {'status': 'success', 'sent': 0, 'reason': 'No new leads'}

        print(f"[Scheduler] Found {len(leads)} leads to email")

        # 4. Initialize clients
        tokens_file = Path(__file__).parent.parent / '.gmail_tokens'
        if not tokens_file.exists():
            raise FileNotFoundError(".gmail_tokens file not found!")

        tokens = {}
        with open(tokens_file) as f:
            for line in f:
                line = line.strip()
                if line and '=' in line:
                    key, value = line.split('=', 1)
                    tokens[key] = value

        gmail_client = GmailClient(
            email=tokens.get('GMAIL_EMAIL'),
            refresh_token=tokens.get('GMAIL_REFRESH_TOKEN'),
            access_token=tokens.get('GMAIL_ACCESS_TOKEN')
        )
        gemini_client = get_llm_client()

        # Company info + CTA links from email_ai_settings (neutral fallbacks)
        email_ai = {}
        try:
            ai_settings_result = supabase.table('email_ai_settings').select('*').limit(1).execute()
            if ai_settings_result.data:
                email_ai = ai_settings_result.data[0]
        except Exception as e:
            print(f"[Scheduler] Could not load email_ai_settings: {e}")

        company_name = email_ai.get('company_name') or 'Your Company'
        company_tagline = email_ai.get('company_tagline') or ''
        company_services = email_ai.get('company_services') or ''
        word_limit = email_ai.get('email_word_limit') or 150

        # 5. Send emails
        sent_count = 0
        failed_count = 0

        for idx, lead in enumerate(leads):
            try:
                sender = AI_TEAM[idx % len(AI_TEAM)]

                # Generate email using Gemini
                lead_name = lead.get('name', 'there')
                lead_company = lead.get('company', 'your company')
                lead_title = lead.get('title', 'your role')
                lead_industry = lead.get('industry', 'your industry')

                cta_links = {
                    email_ai.get('cta_link_1_label') or 'Schedule a Call': email_ai.get('cta_link_1_url') or '#',
                    email_ai.get('cta_link_2_label') or 'Learn More': email_ai.get('cta_link_2_url') or '#'
                }

                services_block = f"\nABOUT {company_name}:\n{company_name} specializes in:\n{company_services}\n" if company_services else ""

                prompt = f"""
You are {sender['name']}, {sender['title']} at {company_name}{' - ' + company_tagline if company_tagline else ''}.

Your personality: {sender.get('persona', 'professional and consultative')}
Your focus: {sender.get('focus', 'helping businesses succeed')}
{services_block}
Write a personalized cold outreach email to:
- Name: {lead_name}
- Company: {lead_company}
- Title: {lead_title}
- Industry: {lead_industry}

REQUIREMENTS:
1. ONLY discuss {company_name}'s services (listed above)
2. Reference specific pain points in {lead_industry} that your services can solve
3. Professional but conversational tone
4. Keep it under {word_limit} words
5. Sign as {sender['name']}, {sender['title']} at {company_name}
6. Include clear call-to-action
"""

                lead_data = {
                    'name': lead_name,
                    'email': lead.get('email'),
                    'company': lead_company,
                    'title': lead_title,
                    'industry': lead_industry
                }

                email_content = gemini_client.generate_email(
                    user_prompt=prompt,
                    lead_data=lead_data,
                    cta_links=cta_links,
                    sender_name=sender['name']
                )

                if not email_content:
                    failed_count += 1
                    continue

                # Send email
                tracking_token = str(uuid.uuid4())
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
                    supabase.table('scraped_leads').update({
                        'status': 'contacted',
                        'updated_at': datetime.utcnow().isoformat()
                    }).eq('id', lead['id']).execute()
                    print(f"[Scheduler] Sent email {sent_count}/{len(leads)} to {lead['email']}")
                else:
                    failed_count += 1
                    print(f"[Scheduler] Failed to send to {lead['email']}")

            except Exception as e:
                failed_count += 1
                print(f"[Scheduler] Error sending to {lead.get('email')}: {e}")

            # Rate limiting delay
            if idx < len(leads) - 1:
                time.sleep(delay_seconds)

        # 6. Update run history
        status = 'success' if failed_count == 0 else ('partial' if sent_count > 0 else 'failed')
        supabase.table('scheduler_run_history').update({
            'status': status,
            'completed_at': datetime.utcnow().isoformat(),
            'leads_attempted': len(leads),
            'emails_sent': sent_count,
            'emails_failed': failed_count
        }).eq('id', run_id).execute()

        # 7. Update scheduler settings
        next_run = datetime.utcnow() + timedelta(days=1)
        supabase.table('scheduler_settings').update({
            'last_run_at': datetime.utcnow().isoformat(),
            'last_run_status': status,
            'last_run_sent_count': sent_count,
            'next_run_at': next_run.isoformat(),
            'total_runs': config.get('total_runs', 0) + 1,
            'total_emails_sent': config.get('total_emails_sent', 0) + sent_count
        }).eq('id', config['id']).execute()

        print(f"[Scheduler] Campaign complete: sent={sent_count}, failed={failed_count}")

        return {
            'status': status,
            'sent': sent_count,
            'failed': failed_count,
            'total_leads': len(leads)
        }

    except Exception as e:
        error_msg = str(e)
        print(f"[Scheduler] Campaign error: {error_msg}")

        # Update run history with error
        supabase.table('scheduler_run_history').update({
            'status': 'failed',
            'completed_at': datetime.utcnow().isoformat(),
            'error_message': error_msg
        }).eq('id', run_id).execute()

        # Update scheduler settings
        supabase.table('scheduler_settings').update({
            'last_run_at': datetime.utcnow().isoformat(),
            'last_run_status': 'failed',
            'last_run_error': error_msg
        }).eq('id', config['id']).execute()

        raise


@celery_app.task(bind=True, name="send_single_email_task")
def send_single_email_task(self, lead_id: str, email_account_id: str) -> Dict[str, Any]:
    """
    Send a single AI-generated email to a specific lead using a connected email account.

    Args:
        lead_id: ID of the lead to email
        email_account_id: ID of the email account to send from

    Returns:
        Result with success status and details
    """
    import uuid
    from datetime import datetime

    sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    from integrations.gmail_client import GmailClient
    from integrations.llm_client import get_llm_client
    from database.client import get_supabase_admin_client

    def get_supabase():
        return get_supabase_admin_client()

    supabase = get_supabase()
    print(f"[SingleEmail] Sending email to lead {lead_id}")

    try:
        # Get lead data
        lead_result = supabase.table('scraped_leads').select('*').eq('id', lead_id).execute()
        if not lead_result.data:
            raise ValueError(f"Lead {lead_id} not found")

        lead = lead_result.data[0]

        # Get email account
        account_result = supabase.table('email_accounts').select('*').eq('id', email_account_id).execute()
        if not account_result.data:
            raise ValueError(f"Email account {email_account_id} not found")

        account = account_result.data[0]

        if account.get('status') != 'active':
            raise ValueError("Email account is not active")

        # Get company config for email content (use defaults if table doesn't exist)
        company_name = os.getenv('COMPANY_NAME', 'Your Company')
        company_tagline = os.getenv('COMPANY_TAGLINE', 'products and services')

        try:
            config_result = supabase.table('app_config').select('*').limit(1).execute()
            if config_result.data:
                config = config_result.data[0]
                company_name = config.get('company_name', company_name)
                company_tagline = config.get('company_tagline', company_tagline)
        except Exception as config_err:
            print(f"[SingleEmail] Using default company config: {config_err}")

        # Initialize clients
        gmail_client = GmailClient(
            email=account['email'],
            refresh_token=account.get('gmail_refresh_token') or account.get('refresh_token'),
            access_token=account.get('gmail_access_token') or account.get('access_token')
        )
        gemini_client = get_llm_client()

        # Prepare lead data
        lead_name = lead.get('decision_maker_name') or 'there'
        lead_company = lead.get('company_name') or 'your company'
        lead_title = lead.get('decision_maker_title') or 'your role'
        lead_industry = lead.get('industry') or 'your industry'

        sender_name = account.get('sender_name') or account['email'].split('@')[0]
        sender_title = account.get('sender_title') or 'Team Member'

        # Generate email using Gemini
        prompt = f"""
You are {sender_name}, {sender_title} at {company_name}.

Write a personalized cold outreach email to:
- Name: {lead_name}
- Company: {lead_company}
- Title: {lead_title}
- Industry: {lead_industry}

ABOUT {company_name}:
We specialize in {company_tagline}.

REQUIREMENTS:
1. Professional but conversational tone
2. Reference specific pain points relevant to {lead_industry}
3. Keep it under 150 words
4. Sign as {sender_name}, {sender_title} at {company_name}
5. Include clear call-to-action
"""

        lead_data = {
            'name': lead_name,
            'email': lead.get('email'),
            'company': lead_company,
            'title': lead_title,
            'industry': lead_industry
        }

        email_content = gemini_client.generate_email(
            user_prompt=prompt,
            lead_data=lead_data,
            sender_name=sender_name
        )

        if not email_content:
            raise ValueError("Failed to generate email content")

        # Send email
        tracking_token = str(uuid.uuid4())
        result = gmail_client.send_email(
            to_email=lead['email'],
            to_name=lead_name,
            subject=email_content['subject'],
            body_html=email_content['body_html'],
            body_text=email_content['body_text'],
            tracking_token=tracking_token,
            backend_url=os.getenv('BACKEND_URL', 'http://localhost:8000'),
            save_to_db=True,
            from_email=account['email']
        )

        if result.get('success'):
            # Update lead status
            supabase.table('scraped_leads').update({
                'status': 'contacted',
                'updated_at': datetime.utcnow().isoformat()
            }).eq('id', lead_id).execute()

            print(f"[SingleEmail] Successfully sent email to {lead['email']}")
            return {
                'success': True,
                'lead_email': lead['email'],
                'message_id': result.get('message_id')
            }
        else:
            raise ValueError(result.get('error', 'Failed to send email'))

    except Exception as e:
        error_msg = str(e)
        print(f"[SingleEmail] Error: {error_msg}")

        # Update lead status to failed
        try:
            supabase.table('scraped_leads').update({
                'status': 'failed',
                'updated_at': datetime.utcnow().isoformat()
            }).eq('id', lead_id).execute()
        except:
            pass

        return {
            'success': False,
            'error': error_msg
        }
