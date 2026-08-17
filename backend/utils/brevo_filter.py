"""
Brevo Lead Filtering Utility

Filters raw leads to identify Brevo-ready leads (decision makers with valid emails)
Based on clean_leads_for_brevo.py logic
"""

import re
from typing import Dict, Any, Optional

# Email validation regex
EMAIL_REGEX = re.compile(r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$')

# Generic email patterns to exclude (not decision makers)
GENERIC_PATTERNS = [
    'info@', 'contact@', 'support@', 'help@', 'customer', 'service@',
    'sales@', 'marketing@', 'admin@', 'reception@', 'enquiry', 'enquiries',
    'feedback@', 'grievance', 'compliance', 'webmaster', 'noreply',
    'secretariat@', 'helpline@', 'businessdevelopment', 'web@',
    'general@', 'office@', 'inquiry@'
]

# Executive titles we want (decision makers)
EXECUTIVE_KEYWORDS = [
    'ceo', 'chief executive', 'president', 'director', 'vice president', 'vp',
    'head', 'manager', 'senior', 'executive', 'officer', 'chairman', 'founder',
    'owner', 'partner', 'lead', 'superintendent', 'administrator'
]


def is_generic_email(email: str) -> bool:
    """
    Check if email is generic (not a decision maker)

    Args:
        email: Email address to check

    Returns:
        True if generic, False if likely a personal email
    """
    if not email:
        return True

    email_lower = email.lower()

    # Check against generic patterns
    for pattern in GENERIC_PATTERNS:
        if pattern in email_lower:
            return True

    return False


def is_executive_title(title: str) -> bool:
    """
    Check if title indicates decision maker

    Args:
        title: Job title to check

    Returns:
        True if executive title, False otherwise
    """
    if not title:
        return False

    title_lower = title.lower()

    for keyword in EXECUTIVE_KEYWORDS:
        if keyword in title_lower:
            return True

    return False


def clean_name(name: str) -> str:
    """
    Clean decision maker name

    Args:
        name: Name to clean

    Returns:
        Cleaned name string
    """
    if not name:
        return ""

    # Remove extra whitespace and newlines
    name = ' '.join(name.split())

    # Remove common suffixes/prefixes
    name = re.sub(r'\b(Mr\.?|Mrs\.?|Ms\.?|Dr\.?|Prof\.?)\s*', '', name, flags=re.IGNORECASE)

    return name.strip()


def clean_title(title: str) -> str:
    """
    Clean decision maker title

    Args:
        title: Title to clean

    Returns:
        Cleaned title string
    """
    if not title:
        return ""

    # Remove extra whitespace and newlines
    title = ' '.join(title.split())

    # Take first line if multiple lines
    title = title.split('\n')[0]

    # Remove "View Bio" and similar
    title = re.sub(r'\b(View Bio|Read More|Learn More)\b', '', title, flags=re.IGNORECASE)

    return title.strip()


def extract_company_from_email(email: str) -> str:
    """
    Extract company name from email domain

    Args:
        email: Email address

    Returns:
        Company name extracted from domain
    """
    if not email or '@' not in email:
        return ""

    domain = email.split('@')[1]
    company = domain.split('.')[0]

    # Capitalize
    company = company.capitalize()

    return company


def is_brevo_ready(lead: Dict[str, Any]) -> bool:
    """
    Check if a lead is ready for Brevo email campaign

    Criteria:
    - Valid email (not None, not empty)
    - Not a generic email (info@, sales@, etc.)
    - Has executive/decision maker title OR is_executive flag is True

    Args:
        lead: Lead dictionary with keys: email, company_name, decision_maker_title, is_executive

    Returns:
        True if lead is Brevo-ready, False otherwise
    """
    # Must have valid email
    email = lead.get('email')
    if not email or not EMAIL_REGEX.match(email):
        return False

    # Must not be generic email
    if is_generic_email(email):
        return False

    # Must be executive/decision maker
    title = lead.get('decision_maker_title') or lead.get('contact_title') or ''
    is_exec = lead.get('is_executive', False)

    if not (is_exec or is_executive_title(title)):
        return False

    return True


def format_for_brevo(lead: Dict[str, Any]) -> Dict[str, str]:
    """
    Format a lead for Brevo import

    Brevo CSV format:
    - EMAIL (required)
    - FIRSTNAME
    - LASTNAME
    - COMPANY
    - JOB_TITLE
    - INDUSTRY
    - PHONE

    Args:
        lead: Raw lead dictionary

    Returns:
        Formatted dictionary for Brevo import
    """
    email = lead.get('email', '')
    name = clean_name(lead.get('decision_maker_name') or lead.get('contact_name') or '')
    title = clean_title(lead.get('decision_maker_title') or lead.get('contact_title') or '')
    company = lead.get('company_name', '') or extract_company_from_email(email)
    phone = lead.get('phone', '')

    # Split name into first and last
    name_parts = name.split() if name else []
    firstname = name_parts[0] if name_parts else ''
    lastname = ' '.join(name_parts[1:]) if len(name_parts) > 1 else ''

    return {
        'EMAIL': email,
        'FIRSTNAME': firstname,
        'LASTNAME': lastname,
        'COMPANY': company,
        'JOB_TITLE': title,
        'INDUSTRY': '',  # Can be populated from search_query or job industry
        'PHONE': phone,
    }
