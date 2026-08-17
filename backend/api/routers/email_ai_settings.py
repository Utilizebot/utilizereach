"""
Email AI Settings Router
API endpoints for managing AI email generation settings
"""

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime
from database.client import get_supabase_admin_client

router = APIRouter(prefix="/api/email-ai-settings", tags=["Email AI Settings"])


def get_supabase():
    """Get database client"""
    return get_supabase_admin_client()


class EmailAISettingsUpdate(BaseModel):
    """Schema for updating email AI settings"""
    company_name: Optional[str] = Field(None, min_length=1, max_length=255)
    company_tagline: Optional[str] = None
    company_services: Optional[str] = None
    cta_link_1_label: Optional[str] = Field(None, max_length=100)
    cta_link_1_url: Optional[str] = Field(None, max_length=500)
    cta_link_2_label: Optional[str] = Field(None, max_length=100)
    cta_link_2_url: Optional[str] = Field(None, max_length=500)
    email_word_limit: Optional[int] = Field(None, ge=50, le=500)
    email_tone: Optional[str] = Field(None, max_length=100)
    ai_prompt_template: Optional[str] = None
    # AI provider selection
    ai_provider: Optional[str] = Field(None, pattern="^(gemini|claude|claude-cli|openai|custom)$")
    ai_model: Optional[str] = Field(None, max_length=100)
    ai_api_key: Optional[str] = None
    ai_base_url: Optional[str] = Field(None, max_length=500)


class EmailAISettingsResponse(BaseModel):
    """Schema for email AI settings response"""
    id: str
    company_name: str
    company_tagline: Optional[str]
    company_services: Optional[str]
    cta_link_1_label: str
    cta_link_1_url: str
    cta_link_2_label: str
    cta_link_2_url: str
    email_word_limit: int
    email_tone: str
    ai_prompt_template: Optional[str]
    created_at: str
    updated_at: str


# Default settings for new installations
DEFAULT_SETTINGS = {
    'company_name': 'Your Company Name',
    'company_tagline': 'Your company tagline here',
    'company_services': '''- Your service or product 1
- Your service or product 2
- Your service or product 3
- Your service or product 4''',
    'cta_link_1_label': 'Schedule a Call',
    'cta_link_1_url': 'https://calendly.com/your-link',
    'cta_link_2_label': 'Learn More',
    'cta_link_2_url': 'https://www.your-website.com',
    'email_word_limit': 150,
    'email_tone': 'professional but conversational',
    'ai_provider': 'gemini',
    'ai_model': '',
    'ai_api_key': '',
    'ai_base_url': '',
    'ai_prompt_template': '''You are {sender_name}, {sender_title} at {company_name} - {company_tagline}.

Your personality: {sender_persona}
Your focus: {sender_focus}

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
7. Focus on YOUR specialty: {sender_focus}
8. Keep it under {word_limit} words (3-4 short paragraphs)
9. Sign as {sender_name}, {sender_title} at {company_name}
10. Include clear call-to-action with the CTA links provided

NEVER:
- Mention you are an AI or this is automated
- Talk about services outside what is listed above
- Use generic "solutions" language without specifics
- Write about other companies or industries
- Use salesy buzzwords

Write as if you personally researched {lead_company} and are genuinely reaching out to help.'''
}


@router.get("")
async def get_email_ai_settings():
    """
    Get current email AI settings

    Returns all email AI configuration including:
    - company_name, company_tagline, company_services
    - CTA links (label and URL for 2 links)
    - email_word_limit, email_tone
    - ai_prompt_template (full customizable prompt)
    """
    try:
        supabase = get_supabase()
        result = supabase.table('email_ai_settings').select('*').limit(1).execute()

        if not result.data:
            # Create default settings if none exist
            insert_result = supabase.table('email_ai_settings').insert(DEFAULT_SETTINGS).execute()
            if insert_result.data:
                return insert_result.data[0]
            return DEFAULT_SETTINGS

        return result.data[0]

    except Exception as e:
        # If table doesn't exist, return defaults (user needs to run migration)
        if 'does not exist' in str(e).lower() or 'relation' in str(e).lower():
            return {
                **DEFAULT_SETTINGS,
                'id': None,
                'error': 'Table not found. Please run the migration: backend/migrations/add_email_ai_settings.sql',
                'created_at': None,
                'updated_at': None
            }
        raise HTTPException(status_code=500, detail=f"Failed to get settings: {str(e)}")


@router.put("")
async def update_email_ai_settings(settings: EmailAISettingsUpdate):
    """
    Update email AI settings (Admin only - checked in frontend)

    Allowed updates:
    - company_name: Your company name
    - company_tagline: Short description
    - company_services: List of services (one per line, with - prefix)
    - cta_link_1_label/url: First CTA button
    - cta_link_2_label/url: Second CTA button
    - email_word_limit: Target word count (50-500)
    - email_tone: Tone description
    - ai_prompt_template: Full customizable AI prompt
    """
    try:
        supabase = get_supabase()

        # Get current settings
        current = supabase.table('email_ai_settings').select('*').limit(1).execute()

        if not current.data:
            # Create settings first if they don't exist
            insert_result = supabase.table('email_ai_settings').insert(DEFAULT_SETTINGS).execute()
            if not insert_result.data:
                raise HTTPException(status_code=500, detail="Failed to create default settings")
            current_id = insert_result.data[0]['id']
        else:
            current_id = current.data[0]['id']

        # Build update data (only include non-None values)
        update_data = {'updated_at': datetime.utcnow().isoformat()}

        if settings.company_name is not None:
            update_data['company_name'] = settings.company_name

        if settings.company_tagline is not None:
            update_data['company_tagline'] = settings.company_tagline

        if settings.company_services is not None:
            update_data['company_services'] = settings.company_services

        if settings.cta_link_1_label is not None:
            update_data['cta_link_1_label'] = settings.cta_link_1_label

        if settings.cta_link_1_url is not None:
            # Basic URL validation
            if settings.cta_link_1_url and not settings.cta_link_1_url.startswith(('http://', 'https://')):
                raise HTTPException(status_code=400, detail="CTA Link 1 URL must start with http:// or https://")
            update_data['cta_link_1_url'] = settings.cta_link_1_url

        if settings.cta_link_2_label is not None:
            update_data['cta_link_2_label'] = settings.cta_link_2_label

        if settings.cta_link_2_url is not None:
            # Basic URL validation
            if settings.cta_link_2_url and not settings.cta_link_2_url.startswith(('http://', 'https://')):
                raise HTTPException(status_code=400, detail="CTA Link 2 URL must start with http:// or https://")
            update_data['cta_link_2_url'] = settings.cta_link_2_url

        if settings.email_word_limit is not None:
            update_data['email_word_limit'] = settings.email_word_limit

        if settings.email_tone is not None:
            update_data['email_tone'] = settings.email_tone

        if settings.ai_prompt_template is not None:
            update_data['ai_prompt_template'] = settings.ai_prompt_template

        if settings.ai_provider is not None:
            update_data['ai_provider'] = settings.ai_provider

        if settings.ai_model is not None:
            update_data['ai_model'] = settings.ai_model

        if settings.ai_api_key is not None:
            update_data['ai_api_key'] = settings.ai_api_key

        if settings.ai_base_url is not None:
            update_data['ai_base_url'] = settings.ai_base_url

        # Update settings
        result = supabase.table('email_ai_settings').update(update_data).eq('id', current_id).execute()

        return {
            'success': True,
            'message': 'Email AI settings updated successfully',
            'settings': result.data[0] if result.data else update_data
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update settings: {str(e)}")


@router.post("/reset")
async def reset_email_ai_settings():
    """
    Reset email AI settings to defaults (Admin only)

    This will reset all settings to their default values.
    Useful if the user wants to start fresh.
    """
    try:
        supabase = get_supabase()

        # Get current settings
        current = supabase.table('email_ai_settings').select('id').limit(1).execute()

        if not current.data:
            # Create default settings
            result = supabase.table('email_ai_settings').insert(DEFAULT_SETTINGS).execute()
            return {
                'success': True,
                'message': 'Default settings created',
                'settings': result.data[0] if result.data else DEFAULT_SETTINGS
            }

        # Reset to defaults
        reset_data = {
            **DEFAULT_SETTINGS,
            'updated_at': datetime.utcnow().isoformat()
        }

        result = supabase.table('email_ai_settings').update(reset_data).eq('id', current.data[0]['id']).execute()

        return {
            'success': True,
            'message': 'Settings reset to defaults',
            'settings': result.data[0] if result.data else reset_data
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to reset settings: {str(e)}")


@router.get("/preview")
async def preview_email_prompt(
    lead_name: str = "John Smith",
    lead_company: str = "Acme Corporation",
    lead_title: str = "Operations Manager",
    lead_industry: str = "Manufacturing"
):
    """
    Preview how the AI prompt will look with sample lead data

    This helps users verify their prompt template is working correctly.
    Returns the fully rendered prompt with placeholder values replaced.
    """
    try:
        supabase = get_supabase()
        result = supabase.table('email_ai_settings').select('*').limit(1).execute()

        if not result.data:
            settings = DEFAULT_SETTINGS
        else:
            settings = result.data[0]

        # Build the preview prompt
        template = settings.get('ai_prompt_template', DEFAULT_SETTINGS['ai_prompt_template'])

        # Replace placeholders
        preview = template.format(
            company_name=settings.get('company_name', 'Your Company'),
            company_tagline=settings.get('company_tagline', 'Your tagline'),
            company_services=settings.get('company_services', '- Service 1'),
            sender_name='Sarah Johnson',
            sender_title='Business Development Manager',
            sender_persona='Friendly and consultative',
            sender_focus='identifying automation opportunities',
            lead_name=lead_name,
            lead_company=lead_company,
            lead_title=lead_title,
            lead_industry=lead_industry,
            word_limit=settings.get('email_word_limit', 150)
        )

        return {
            'success': True,
            'preview': preview,
            'cta_links': {
                settings.get('cta_link_1_label', 'Schedule a Call'): settings.get('cta_link_1_url', '#'),
                settings.get('cta_link_2_label', 'Learn More'): settings.get('cta_link_2_url', '#')
            },
            'sample_lead': {
                'name': lead_name,
                'company': lead_company,
                'title': lead_title,
                'industry': lead_industry
            }
        }

    except KeyError as e:
        return {
            'success': False,
            'error': f'Missing placeholder in template: {str(e)}',
            'hint': 'Make sure your template includes all required placeholders: {company_name}, {company_tagline}, {company_services}, {sender_name}, {sender_title}, {sender_persona}, {sender_focus}, {lead_name}, {lead_company}, {lead_title}, {lead_industry}, {word_limit}'
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to preview prompt: {str(e)}")


class ProviderTestRequest(BaseModel):
    """Test a provider configuration (uses saved settings when fields omitted)"""
    ai_provider: Optional[str] = Field(None, pattern="^(gemini|claude|claude-cli|openai|custom)$")
    ai_model: Optional[str] = None
    ai_api_key: Optional[str] = None
    ai_base_url: Optional[str] = None


@router.post("/test-provider")
async def test_ai_provider(request: ProviderTestRequest):
    """
    Test an AI provider configuration with a tiny round-trip generation.
    Fields left empty fall back to the saved settings / environment.
    """
    import time
    from integrations.llm_client import LLMClient, get_llm_client

    try:
        if request.ai_provider:
            # Merge with saved settings so an empty key field means "use saved"
            saved = {}
            try:
                current = get_supabase().table('email_ai_settings').select('*').limit(1).execute()
                if current.data:
                    saved = current.data[0]
            except Exception:
                pass
            same_provider = saved.get('ai_provider') == request.ai_provider
            client = LLMClient(
                provider=request.ai_provider,
                model=request.ai_model or (saved.get('ai_model') if same_provider else None),
                api_key=request.ai_api_key or (saved.get('ai_api_key') if same_provider else None),
                base_url=request.ai_base_url or (saved.get('ai_base_url') if same_provider else None),
            )
        else:
            client = get_llm_client()
    except Exception as e:
        return {'success': False, 'message': str(e)}

    start = time.time()
    ok, message = client.test_connection()
    return {
        'success': ok,
        'message': message,
        'provider': client.provider,
        'model': client.model or 'default',
        'latency_ms': int((time.time() - start) * 1000),
    }
