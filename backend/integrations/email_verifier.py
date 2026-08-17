"""
Email Verification System
Validates emails before sending to prevent bounces and protect domain reputation
"""

import os
import re
import dns.resolver
import smtplib
import socket
from typing import Dict, Tuple
from email.utils import parseaddr


class EmailVerifier:
    """Comprehensive email verification"""

    # Common disposable email domains to block
    DISPOSABLE_DOMAINS = {
        'tempmail.com', 'throwaway.email', 'guerrillamail.com',
        'mailinator.com', '10minutemail.com', 'trashmail.com',
        'yopmail.com', 'maildrop.cc'
    }

    # Common role-based emails (optional to filter)
    ROLE_EMAILS = {
        'noreply', 'no-reply', 'donotreply', 'postmaster',
        'admin', 'support', 'info', 'sales', 'marketing'
    }

    @staticmethod
    def validate_syntax(email: str) -> Tuple[bool, str]:
        """
        Validate email syntax

        Returns:
            (is_valid, reason)
        """
        if not email or not isinstance(email, str):
            return False, "Email is empty or invalid type"

        email = email.strip().lower()

        # Basic regex validation
        pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
        if not re.match(pattern, email):
            return False, "Invalid email syntax"

        # Parse email
        _, parsed_email = parseaddr(email)
        if not parsed_email or '@' not in parsed_email:
            return False, "Invalid email format"

        local, domain = parsed_email.split('@')

        # Check local part
        if len(local) == 0 or len(local) > 64:
            return False, "Local part too long or empty"

        # Check domain
        if len(domain) == 0 or len(domain) > 255:
            return False, "Domain too long or empty"

        # Check for consecutive dots
        if '..' in email:
            return False, "Contains consecutive dots"

        return True, "Syntax valid"

    @staticmethod
    def check_disposable(email: str) -> Tuple[bool, str]:
        """
        Check if email is from disposable domain

        Returns:
            (is_disposable, reason)
        """
        domain = email.split('@')[1].lower()

        if domain in EmailVerifier.DISPOSABLE_DOMAINS:
            return True, f"Disposable email domain: {domain}"

        return False, "Not disposable"

    @staticmethod
    def check_mx_records(domain: str) -> Tuple[bool, str]:
        """
        Check if domain has valid MX (mail exchange) records

        Returns:
            (has_mx, reason)
        """
        try:
            # Get MX records
            mx_records = dns.resolver.resolve(domain, 'MX')

            if not mx_records:
                return False, "No MX records found"

            # Check if at least one MX record exists
            mx_list = [str(r.exchange) for r in mx_records]
            if len(mx_list) == 0:
                return False, "Empty MX records"

            return True, f"Valid MX records: {len(mx_list)} found"

        except dns.resolver.NXDOMAIN:
            return False, "Domain does not exist"
        except dns.resolver.NoAnswer:
            return False, "No MX records configured"
        except dns.resolver.Timeout:
            return False, "DNS timeout"
        except Exception as e:
            return False, f"DNS error: {str(e)}"

    @staticmethod
    def verify_smtp(email: str, timeout: int = 10) -> Tuple[bool, str]:
        """
        Verify email exists via SMTP (advanced check)

        Warning: Some servers block this, so use with caution

        Returns:
            (exists, reason)
        """
        try:
            domain = email.split('@')[1]

            # Get MX records
            mx_records = dns.resolver.resolve(domain, 'MX')
            mx_host = str(mx_records[0].exchange)

            # Connect to mail server
            server = smtplib.SMTP(timeout=timeout)
            server.set_debuglevel(0)

            # Connect
            server.connect(mx_host)
            server.helo(server.local_hostname)
            server.mail(os.getenv('VERIFY_MAIL_FROM', 'verify@example.com'))

            # Check if email exists
            code, message = server.rcpt(email)
            server.quit()

            # Check response code
            if code == 250:
                return True, "Email exists"
            elif code == 550:
                return False, "Mailbox does not exist"
            else:
                return False, f"SMTP code {code}: {message.decode()}"

        except smtplib.SMTPServerDisconnected:
            return False, "SMTP server disconnected"
        except smtplib.SMTPConnectError:
            return False, "Cannot connect to SMTP server"
        except socket.timeout:
            return False, "SMTP connection timeout"
        except Exception as e:
            # If SMTP verification fails, don't reject - might be server blocking
            return True, f"SMTP verification unavailable: {str(e)}"

    @classmethod
    def verify_email(cls, email: str, check_smtp: bool = False) -> Dict:
        """
        Comprehensive email verification

        Args:
            email: Email address to verify
            check_smtp: Whether to perform SMTP verification (slower, may be blocked)

        Returns:
            {
                'email': str,
                'is_valid': bool,
                'is_risky': bool,
                'checks': {
                    'syntax': bool,
                    'disposable': bool,
                    'mx_records': bool,
                    'smtp': bool (if checked)
                },
                'reasons': [str],
                'recommendation': str
            }
        """
        email = email.strip().lower()
        checks = {}
        reasons = []
        is_risky = False

        # 1. Syntax check
        syntax_valid, syntax_reason = cls.validate_syntax(email)
        checks['syntax'] = syntax_valid
        if not syntax_valid:
            return {
                'email': email,
                'is_valid': False,
                'is_risky': True,
                'checks': checks,
                'reasons': [syntax_reason],
                'recommendation': 'REJECT: Invalid syntax'
            }
        reasons.append(syntax_reason)

        # 2. Disposable check
        is_disposable, disposable_reason = cls.check_disposable(email)
        checks['disposable'] = not is_disposable
        if is_disposable:
            is_risky = True
            reasons.append(disposable_reason)

        # 3. MX records check
        domain = email.split('@')[1]
        has_mx, mx_reason = cls.check_mx_records(domain)
        checks['mx_records'] = has_mx
        reasons.append(mx_reason)

        if not has_mx:
            return {
                'email': email,
                'is_valid': False,
                'is_risky': True,
                'checks': checks,
                'reasons': reasons,
                'recommendation': 'REJECT: No mail server configured'
            }

        # 4. SMTP check (optional - slower)
        if check_smtp:
            smtp_valid, smtp_reason = cls.verify_smtp(email)
            checks['smtp'] = smtp_valid
            reasons.append(smtp_reason)

            if not smtp_valid and 'does not exist' in smtp_reason.lower():
                return {
                    'email': email,
                    'is_valid': False,
                    'is_risky': True,
                    'checks': checks,
                    'reasons': reasons,
                    'recommendation': 'REJECT: Mailbox does not exist'
                }

        # Final recommendation
        if is_risky:
            recommendation = 'WARN: Email is risky (disposable or suspicious)'
        else:
            recommendation = 'ACCEPT: Email appears valid'

        return {
            'email': email,
            'is_valid': True,
            'is_risky': is_risky,
            'checks': checks,
            'reasons': reasons,
            'recommendation': recommendation
        }

    @classmethod
    def bulk_verify(cls, emails: list, check_smtp: bool = False) -> Dict:
        """
        Verify multiple emails

        Returns:
            {
                'total': int,
                'valid': int,
                'invalid': int,
                'risky': int,
                'results': [dict]
            }
        """
        results = []
        valid_count = 0
        invalid_count = 0
        risky_count = 0

        for email in emails:
            result = cls.verify_email(email, check_smtp=check_smtp)
            results.append(result)

            if result['is_valid']:
                valid_count += 1
                if result['is_risky']:
                    risky_count += 1
            else:
                invalid_count += 1

        return {
            'total': len(emails),
            'valid': valid_count,
            'invalid': invalid_count,
            'risky': risky_count,
            'results': results
        }


# Test function
if __name__ == "__main__":
    # Test emails
    test_emails = [
        "someone@gmail.com",  # Valid
        "invalid@nonexistentdomain12345.com",  # Invalid domain
        "test@tempmail.com",  # Disposable
        "not-an-email",  # Invalid syntax
    ]

    print("Email Verification Test")
    print("=" * 60)

    for email in test_emails:
        result = EmailVerifier.verify_email(email, check_smtp=False)
        print(f"\nEmail: {email}")
        print(f"Valid: {result['is_valid']}")
        print(f"Risky: {result['is_risky']}")
        print(f"Recommendation: {result['recommendation']}")
        print(f"Checks: {result['checks']}")
        print(f"Reasons: {', '.join(result['reasons'])}")
