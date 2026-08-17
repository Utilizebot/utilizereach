"""
Gmail API Client for Email Marketing System
Handles sending emails, tracking, and webhook processing
"""

import base64
import os
from typing import Dict, List, Optional
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from datetime import datetime, timedelta

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError


class GmailClient:
    """Gmail API client for sending and tracking emails"""

    def __init__(self, email: str, refresh_token: str, access_token: Optional[str] = None):
        """
        Initialize Gmail client with OAuth credentials

        Args:
            email: Gmail address
            refresh_token: OAuth refresh token
            access_token: OAuth access token (optional, will refresh if needed)
        """
        self.email = email
        self.refresh_token = refresh_token
        self.access_token = access_token
        self.service = None
        self._initialize_service()

    def _initialize_service(self):
        """Initialize Gmail API service with credentials"""
        try:
            # Create credentials from tokens
            creds = Credentials(
                token=self.access_token,
                refresh_token=self.refresh_token,
                token_uri='https://oauth2.googleapis.com/token',
                client_id=os.getenv('GOOGLE_CLIENT_ID'),
                client_secret=os.getenv('GOOGLE_CLIENT_SECRET'),
                scopes=[
                    'https://www.googleapis.com/auth/gmail.send',
                    'https://www.googleapis.com/auth/gmail.readonly',
                    'https://www.googleapis.com/auth/userinfo.email',
                    'openid'
                ]
            )

            # Refresh if needed
            if not creds.valid:
                if creds.expired and creds.refresh_token:
                    creds.refresh(Request())
                    self.access_token = creds.token

            # Build service
            self.service = build('gmail', 'v1', credentials=creds)

        except Exception as e:
            raise Exception(f"Failed to initialize Gmail service: {str(e)}")

    def send_email(
        self,
        to_email: str,
        to_name: Optional[str],
        subject: str,
        body_html: str,
        body_text: str,
        tracking_token: str,
        backend_url: str,
        save_to_db: bool = False,
        campaign_id: Optional[str] = None,
        recipient_id: Optional[str] = None,
        from_email: Optional[str] = None,
        from_name: Optional[str] = None,
        bcc: Optional[str] = None
    ) -> Dict:
        """
        Send an email with tracking

        Args:
            to_email: Recipient email
            to_name: Recipient name
            subject: Email subject
            body_html: HTML body
            body_text: Plain text body
            tracking_token: Unique tracking token
            backend_url: Backend URL for tracking endpoints

        Returns:
            Dict with gmail_message_id and gmail_thread_id

        Raises:
            HttpError: If Gmail API returns an error
        """
        try:
            # Create message
            message = MIMEMultipart('alternative')
            # Use from_email parameter if provided, otherwise use self.email
            sender_email = from_email if from_email else self.email
            # Persona display name → "Nancy <nancy@example.com>"
            message['From'] = f"{from_name} <{sender_email}>" if from_name else sender_email
            # Replies should go back to the persona alias (routes to the base inbox)
            message['Reply-To'] = sender_email
            message['To'] = f"{to_name} <{to_email}>" if to_name else to_email
            if bcc:
                message['Bcc'] = bcc
            message['Subject'] = subject

            # Add tracking pixel to HTML body
            tracking_pixel = f'<img src="{backend_url}/track/open/{tracking_token}" width="1" height="1" style="display:none" />'
            tracked_html = body_html + tracking_pixel

            # Rewrite links in HTML for click tracking
            tracked_html = self._add_click_tracking(tracked_html, tracking_token, backend_url)

            # Attach parts
            part_text = MIMEText(body_text, 'plain')
            part_html = MIMEText(tracked_html, 'html')
            message.attach(part_text)
            message.attach(part_html)

            # Encode message
            raw_message = base64.urlsafe_b64encode(message.as_bytes()).decode('utf-8')

            # Send via Gmail API
            result = self.service.users().messages().send(
                userId='me',
                body={'raw': raw_message}
            ).execute()

            # Save to database if requested
            sent_email_id = None
            if save_to_db:
                sent_email_id = self._save_to_database(
                    to_email=to_email,
                    to_name=to_name,
                    subject=subject,
                    body_html=tracked_html,
                    body_text=body_text,
                    tracking_token=tracking_token,
                    gmail_message_id=result['id'],
                    gmail_thread_id=result['threadId'],
                    campaign_id=campaign_id,
                    recipient_id=recipient_id,
                    from_email=sender_email  # Pass the actual sender email
                )

            return {
                'gmail_message_id': result['id'],
                'gmail_thread_id': result['threadId'],
                'sent_email_id': sent_email_id,
                'success': True
            }

        except HttpError as error:
            # Parse Gmail API errors
            error_details = self._parse_gmail_error(error)
            raise Exception(f"Gmail API error: {error_details}")

    def _add_click_tracking(self, html: str, tracking_token: str, backend_url: str, skip_tracking_domains: list = None) -> str:
        """
        Rewrite all links in HTML to go through tracking redirect

        Args:
            html: Original HTML body
            tracking_token: Tracking token
            backend_url: Backend URL
            skip_tracking_domains: List of domains to skip tracking (direct links)

        Returns:
            HTML with tracked links
        """
        import re
        from urllib.parse import urlparse, quote

        # Default domains to skip tracking (always use direct links)
        skip_tracking_domains = list(skip_tracking_domains or [])

        # Tenant-configured skip domains (comma-separated env var, optional)
        env_domains = os.getenv('TRACKING_SKIP_DOMAINS', '')
        skip_tracking_domains.extend(
            d.strip() for d in env_domains.split(',') if d.strip()
        )

        # Scheduling links should always be direct
        skip_tracking_domains.append('calendly.com')

        # Never wrap links pointing at our own backend (e.g. unsubscribe)
        for candidate in (backend_url, os.getenv('BACKEND_URL', '')):
            try:
                backend_host = urlparse(candidate or '').hostname
                if backend_host and backend_host not in skip_tracking_domains:
                    skip_tracking_domains.append(backend_host)
            except Exception:
                pass

        # Find all href links
        def replace_link(match):
            original_url = match.group(1)
            # Skip if already a tracking link or anchor
            if original_url.startswith('#') or 'track/click' in original_url:
                return match.group(0)

            # Skip if domain is in the skip list (direct link)
            for domain in skip_tracking_domains:
                if domain in original_url:
                    return match.group(0)

            # Create tracking URL. URL-encode the original so its own query
            # string (e.g. multi-param UTMs) survives the redirect intact.
            tracked_url = f'{backend_url}/track/click/{tracking_token}?url={quote(original_url, safe="")}'
            return f'href="{tracked_url}"'

        # Replace all href attributes
        tracked_html = re.sub(r'href="([^"]+)"', replace_link, html)
        return tracked_html

    def _parse_gmail_error(self, error: HttpError) -> Dict:
        """
        Parse Gmail API error to determine bounce type

        Args:
            error: HttpError from Gmail API

        Returns:
            Dict with error details and bounce classification
        """
        error_content = error.content.decode('utf-8') if error.content else str(error)
        status_code = error.resp.status

        bounce_info = {
            'bounce_type': None,
            'bounce_subtype': None,
            'error_code': str(status_code),
            'error_message': error_content
        }

        # Classify bounce based on error
        error_lower = error_content.lower()

        # Hard bounces
        if any(keyword in error_lower for keyword in [
            'address not found',
            'user unknown',
            'no such user',
            'invalid recipient',
            'recipient address rejected'
        ]):
            bounce_info['bounce_type'] = 'hard'
            bounce_info['bounce_subtype'] = 'invalid_email'

        # Soft bounces
        elif any(keyword in error_lower for keyword in [
            'mailbox full',
            'quota exceeded',
            'storage exceeded'
        ]):
            bounce_info['bounce_type'] = 'soft'
            bounce_info['bounce_subtype'] = 'mailbox_full'

        elif any(keyword in error_lower for keyword in [
            'temporarily unavailable',
            'try again later',
            'service unavailable'
        ]):
            bounce_info['bounce_type'] = 'soft'
            bounce_info['bounce_subtype'] = 'temporary_failure'

        # Spam complaints
        elif any(keyword in error_lower for keyword in [
            'spam',
            'blocked',
            'blacklisted',
            'reputation'
        ]):
            bounce_info['bounce_type'] = 'complaint'
            bounce_info['bounce_subtype'] = 'spam_complaint'

        return bounce_info

    def get_message(self, message_id: str) -> Dict:
        """
        Fetch a message by ID

        Args:
            message_id: Gmail message ID

        Returns:
            Message details including headers and body
        """
        try:
            message = self.service.users().messages().get(
                userId='me',
                id=message_id,
                format='full'
            ).execute()

            return self._parse_message(message)

        except HttpError as error:
            raise Exception(f"Failed to fetch message: {str(error)}")

    def _parse_message(self, message: Dict) -> Dict:
        """
        Parse Gmail message into structured format

        Args:
            message: Raw Gmail message

        Returns:
            Parsed message dict
        """
        headers = message['payload'].get('headers', [])
        header_dict = {h['name']: h['value'] for h in headers}

        # Extract body
        body_text = ''
        body_html = ''

        if 'parts' in message['payload']:
            for part in message['payload']['parts']:
                if part['mimeType'] == 'text/plain':
                    body_text = base64.urlsafe_b64decode(
                        part['body'].get('data', '')
                    ).decode('utf-8')
                elif part['mimeType'] == 'text/html':
                    body_html = base64.urlsafe_b64decode(
                        part['body'].get('data', '')
                    ).decode('utf-8')
        else:
            # Simple message
            body_data = message['payload']['body'].get('data', '')
            if body_data:
                body_text = base64.urlsafe_b64decode(body_data).decode('utf-8')

        return {
            'message_id': message['id'],
            'thread_id': message['threadId'],
            'from': header_dict.get('From', ''),
            'to': header_dict.get('To', ''),
            'subject': header_dict.get('Subject', ''),
            'date': header_dict.get('Date', ''),
            'body_text': body_text,
            'body_html': body_html
        }

    def watch_mailbox(self, topic_name: str) -> Dict:
        """
        Set up Gmail push notifications for new messages

        Args:
            topic_name: Google Cloud Pub/Sub topic name

        Returns:
            Watch response with expiration
        """
        try:
            request = {
                'topicName': topic_name,
                'labelIds': ['INBOX']
            }

            response = self.service.users().watch(
                userId='me',
                body=request
            ).execute()

            return response

        except HttpError as error:
            raise Exception(f"Failed to set up mailbox watch: {str(error)}")

    def get_thread_messages(self, thread_id: str) -> List[Dict]:
        """
        Get all messages in a thread

        Args:
            thread_id: Gmail thread ID

        Returns:
            List of messages in thread
        """
        try:
            thread = self.service.users().threads().get(
                userId='me',
                id=thread_id,
                format='full'
            ).execute()

            messages = []
            for message in thread.get('messages', []):
                messages.append(self._parse_message(message))

            return messages

        except HttpError as error:
            raise Exception(f"Failed to fetch thread: {str(error)}")

    def check_quota(self) -> Dict:
        """
        Check current Gmail API quota usage

        Returns:
            Dict with quota information
        """
        # Gmail allows ~100 emails/day for free accounts
        # ~500-2000 for Google Workspace depending on plan
        # This is tracked client-side as Gmail API doesn't provide quota endpoint

        return {
            'daily_limit': 50,  # Conservative default
            'note': 'Gmail limits: 50/day (free), 500-2000/day (Workspace)'
        }


    def _save_to_database(
        self,
        to_email: str,
        to_name: Optional[str],
        subject: str,
        body_html: str,
        body_text: str,
        tracking_token: str,
        gmail_message_id: str,
        gmail_thread_id: str,
        campaign_id: Optional[str],
        recipient_id: Optional[str],
        from_email: Optional[str] = None
    ) -> str:
        """
        Save sent email to database

        Returns:
            sent_email_id: UUID of the created record
        """
        from datetime import datetime

        try:
            from database.client import get_supabase_admin_client
            supabase = get_supabase_admin_client()

            # Find email account ID - use from_email if provided, otherwise use self.email
            lookup_email = from_email if from_email else self.email
            account = supabase.table('email_accounts').select('id').eq('email', lookup_email).execute()
            account_id = account.data[0]['id'] if account.data else None

            # Insert sent email
            result = supabase.table('sent_emails').insert({
                'campaign_id': campaign_id,
                'recipient_id': recipient_id,
                'email_account_id': account_id,
                'from_email': lookup_email,  # Save the sender email
                'recipient_email': to_email,
                'recipient_name': to_name,
                'subject': subject,
                'body_html': body_html,
                'body_text': body_text,
                'tracking_token': tracking_token,
                'gmail_message_id': gmail_message_id,
                'gmail_thread_id': gmail_thread_id,
                'sent_at': datetime.utcnow().isoformat(),
                'status': 'sent'
            }).execute()

            return result.data[0]['id'] if result.data else None

        except Exception as e:
            print(f"Error saving email to database: {e}")
            return None


class GmailOAuthHelper:
    """Helper class for Gmail OAuth flow"""

    @staticmethod
    def get_authorization_url() -> str:
        """
        Get OAuth authorization URL for user to grant access

        Returns:
            Authorization URL
        """
        from google_auth_oauthlib.flow import Flow
        import json

        # Try to use oauth_credentials.json file first
        credentials_file = os.path.join(os.path.dirname(__file__), '..', 'oauth_credentials.json')

        if os.path.exists(credentials_file):
            # Use the credentials file directly
            flow = Flow.from_client_secrets_file(
                credentials_file,
                scopes=[
                    'https://www.googleapis.com/auth/gmail.send',
                    'https://www.googleapis.com/auth/gmail.readonly',
                    'https://www.googleapis.com/auth/userinfo.email',
                    'openid'
                ],
                redirect_uri='urn:ietf:wg:oauth:2.0:oob'  # Use out-of-band for desktop apps
            )
        else:
            # Fallback to .env configuration
            client_config = {
                "installed": {
                    "client_id": os.getenv('GOOGLE_CLIENT_ID'),
                    "client_secret": os.getenv('GOOGLE_CLIENT_SECRET'),
                    "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                    "token_uri": "https://oauth2.googleapis.com/token",
                    "redirect_uris": ["urn:ietf:wg:oauth:2.0:oob"]
                }
            }

            flow = Flow.from_client_config(
                client_config,
                scopes=[
                    'https://www.googleapis.com/auth/gmail.send',
                    'https://www.googleapis.com/auth/gmail.readonly',
                    'https://www.googleapis.com/auth/userinfo.email',
                    'openid'
                ],
                redirect_uri='urn:ietf:wg:oauth:2.0:oob'
            )

        auth_url, _ = flow.authorization_url(
            access_type='offline',
            include_granted_scopes='true',
            prompt='consent'
        )

        return auth_url

    @staticmethod
    def exchange_code_for_tokens(code: str) -> Dict:
        """
        Exchange authorization code for access and refresh tokens

        Args:
            code: Authorization code from OAuth callback

        Returns:
            Dict with access_token, refresh_token, and expiry
        """
        from google_auth_oauthlib.flow import Flow
        import json

        # Try to use oauth_credentials.json file first
        credentials_file = os.path.join(os.path.dirname(__file__), '..', 'oauth_credentials.json')

        if os.path.exists(credentials_file):
            # Use the credentials file directly
            flow = Flow.from_client_secrets_file(
                credentials_file,
                scopes=[
                    'https://www.googleapis.com/auth/gmail.send',
                    'https://www.googleapis.com/auth/gmail.readonly',
                    'https://www.googleapis.com/auth/userinfo.email',
                    'openid'
                ],
                redirect_uri='urn:ietf:wg:oauth:2.0:oob'
            )
        else:
            # Fallback to .env configuration
            client_config = {
                "installed": {
                    "client_id": os.getenv('GOOGLE_CLIENT_ID'),
                    "client_secret": os.getenv('GOOGLE_CLIENT_SECRET'),
                    "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                    "token_uri": "https://oauth2.googleapis.com/token",
                    "redirect_uris": ["urn:ietf:wg:oauth:2.0:oob"]
                }
            }

            flow = Flow.from_client_config(
                client_config,
                scopes=[
                    'https://www.googleapis.com/auth/gmail.send',
                    'https://www.googleapis.com/auth/gmail.readonly',
                    'https://www.googleapis.com/auth/userinfo.email',
                    'openid'
                ],
                redirect_uri='urn:ietf:wg:oauth:2.0:oob'
            )

        flow.fetch_token(code=code)
        credentials = flow.credentials

        # Try to get email from id_token
        email = None
        if hasattr(credentials, 'id_token') and credentials.id_token:
            email = credentials.id_token.get('email')

        return {
            'access_token': credentials.token,
            'refresh_token': credentials.refresh_token,
            'token_expiry': credentials.expiry.isoformat() if credentials.expiry else None,
            'email': email
        }
