"""
Email Verification Utility

Provides email validation including:
- Format validation (regex)
- MX record check (domain has mail servers)
- Disposable email detection
- Generic email detection
"""

import re
import dns.resolver
from typing import Dict, Any, Optional, Tuple
from functools import lru_cache

# Email validation regex
EMAIL_REGEX = re.compile(r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$')

# Common disposable email domains
DISPOSABLE_DOMAINS = {
    'tempmail.com', 'guerrillamail.com', 'mailinator.com', 'throwaway.email',
    '10minutemail.com', 'temp-mail.org', 'fakeinbox.com', 'yopmail.com',
    'trashmail.com', 'maildrop.cc', 'getnada.com', 'sharklasers.com',
    'dispostable.com', 'mailnesia.com', 'tempail.com', 'tempr.email',
}

# Generic email patterns to exclude (not decision makers)
GENERIC_PATTERNS = [
    'info@', 'contact@', 'support@', 'help@', 'customer', 'service@',
    'sales@', 'marketing@', 'admin@', 'reception@', 'enquiry', 'enquiries',
    'feedback@', 'grievance', 'compliance', 'webmaster', 'noreply',
    'secretariat@', 'helpline@', 'businessdevelopment', 'web@',
    'general@', 'office@', 'inquiry@', 'hr@', 'careers@', 'jobs@',
    'press@', 'media@', 'pr@', 'billing@', 'accounts@', 'legal@'
]

# Executive titles we want (decision makers)
EXECUTIVE_KEYWORDS = [
    'ceo', 'chief executive', 'president', 'director', 'vice president', 'vp',
    'head', 'manager', 'senior', 'executive', 'officer', 'chairman', 'founder',
    'owner', 'partner', 'lead', 'superintendent', 'administrator',
    'managing director', 'md', 'cto', 'cfo', 'coo', 'cmo', 'cio'
]


def is_valid_email_format(email: str) -> bool:
    """
    Check if email has valid format

    Args:
        email: Email address to check

    Returns:
        True if valid format, False otherwise
    """
    if not email:
        return False
    return bool(EMAIL_REGEX.match(email.strip()))


@lru_cache(maxsize=1000)
def check_mx_record(domain: str) -> Tuple[bool, str]:
    """
    Check if domain has valid MX records (can receive email)
    Uses LRU cache to avoid repeated DNS lookups

    Args:
        domain: Email domain to check

    Returns:
        Tuple of (has_mx: bool, message: str)
    """
    try:
        mx_records = dns.resolver.resolve(domain, 'MX')
        if mx_records:
            return True, f"Found {len(mx_records)} MX record(s)"
        return False, "No MX records found"
    except dns.resolver.NXDOMAIN:
        return False, "Domain does not exist"
    except dns.resolver.NoAnswer:
        return False, "No MX records for domain"
    except dns.resolver.NoNameservers:
        return False, "No nameservers for domain"
    except dns.resolver.Timeout:
        return False, "DNS lookup timeout"
    except Exception as e:
        return False, f"DNS error: {str(e)}"


def is_disposable_email(email: str) -> bool:
    """
    Check if email is from a disposable email service

    Args:
        email: Email address to check

    Returns:
        True if disposable, False otherwise
    """
    if not email or '@' not in email:
        return False

    domain = email.split('@')[1].lower()
    return domain in DISPOSABLE_DOMAINS


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


def verify_email(email: str, check_mx: bool = True) -> Dict[str, Any]:
    """
    Comprehensive email verification

    Args:
        email: Email address to verify
        check_mx: Whether to perform MX record check (slower but more accurate)

    Returns:
        Dictionary with verification results:
        {
            'email': str,
            'is_valid_format': bool,
            'is_generic': bool,
            'is_disposable': bool,
            'has_mx_record': bool,
            'mx_message': str,
            'is_verified': bool,  # Overall verification status
            'verification_score': int,  # 0-100 quality score
        }
    """
    result = {
        'email': email,
        'is_valid_format': False,
        'is_generic': True,
        'is_disposable': False,
        'has_mx_record': False,
        'mx_message': '',
        'is_verified': False,
        'verification_score': 0,
    }

    if not email:
        return result

    email = email.strip()

    # Check format
    result['is_valid_format'] = is_valid_email_format(email)
    if not result['is_valid_format']:
        return result

    # Check if generic
    result['is_generic'] = is_generic_email(email)

    # Check if disposable
    result['is_disposable'] = is_disposable_email(email)

    # Check MX record (if enabled)
    if check_mx:
        domain = email.split('@')[1]
        result['has_mx_record'], result['mx_message'] = check_mx_record(domain)
    else:
        result['has_mx_record'] = True  # Assume valid if not checking
        result['mx_message'] = 'MX check skipped'

    # Calculate verification score (0-100)
    score = 0

    if result['is_valid_format']:
        score += 25

    if not result['is_generic']:
        score += 25

    if not result['is_disposable']:
        score += 25

    if result['has_mx_record']:
        score += 25

    result['verification_score'] = score

    # Overall verification: must have valid format, MX record, and not be disposable
    result['is_verified'] = (
        result['is_valid_format'] and
        result['has_mx_record'] and
        not result['is_disposable']
    )

    return result


def is_quality_lead(lead: Dict[str, Any], verify_mx: bool = True) -> Tuple[bool, Dict[str, Any]]:
    """
    Check if a lead is high quality (previously "Brevo-ready")

    Criteria:
    - Valid email format
    - Has MX record (email domain can receive mail)
    - Not a generic email (info@, sales@, etc.)
    - Not from disposable email service
    - Has executive/decision maker title OR is_executive flag is True

    Args:
        lead: Lead dictionary with keys: email, decision_maker_title, is_executive
        verify_mx: Whether to perform MX record check

    Returns:
        Tuple of (is_quality: bool, verification_result: dict)
    """
    email = lead.get('email')

    # Verify email
    verification = verify_email(email, check_mx=verify_mx)

    # Must pass basic verification
    if not verification['is_verified']:
        return False, verification

    # Must not be generic email
    if verification['is_generic']:
        return False, verification

    # Must be executive/decision maker
    title = lead.get('decision_maker_title') or lead.get('contact_title') or ''
    is_exec = lead.get('is_executive', False)

    if not (is_exec or is_executive_title(title)):
        verification['rejection_reason'] = 'Not a decision maker'
        return False, verification

    return True, verification


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


def format_verified_lead(lead: Dict[str, Any]) -> Dict[str, str]:
    """
    Format a lead for verified leads export (CSV format)

    Format:
    - EMAIL (required)
    - FIRSTNAME
    - LASTNAME
    - COMPANY
    - JOB_TITLE
    - INDUSTRY
    - PHONE
    - VERIFICATION_SCORE

    Args:
        lead: Raw lead dictionary

    Returns:
        Formatted dictionary for export
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
        'VERIFICATION_SCORE': str(lead.get('verification_score', 0)),
    }
