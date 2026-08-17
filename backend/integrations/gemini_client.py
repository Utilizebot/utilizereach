"""
Google Gemini API Client for AI Email Generation
Handles personalized email content generation with smart company research
"""

import os
import json
import re
from typing import Dict, Optional
from decimal import Decimal

import google.generativeai as genai


class GeminiClient:
    """Gemini API client for generating personalized email content"""

    def __init__(self, api_key: Optional[str] = None):
        """
        Initialize Gemini client

        Args:
            api_key: Gemini API key (defaults to environment variable)
        """
        self.api_key = api_key or os.getenv('GEMINI_API_KEY')
        if not self.api_key:
            raise ValueError("GEMINI_API_KEY not provided")

        # Configure Gemini
        genai.configure(api_key=self.api_key)
        # Use gemini-flash-latest which automatically uses the latest stable flash model
        self.model = genai.GenerativeModel('gemini-flash-latest')

        # Cost tracking (per 1M tokens)
        self.input_cost_per_million = 0.075  # USD
        self.output_cost_per_million = 0.30  # USD

    def should_research_company(self, company_name: str, industry: Optional[str] = None) -> bool:
        """
        Ask AI if it needs to research the company website

        Args:
            company_name: Company name
            industry: Industry (optional, helps context)

        Returns:
            True if research needed, False otherwise
        """
        prompt = f"""Can you understand what {company_name} does based on the company name alone?

Company name: {company_name}
{f"Industry: {industry}" if industry else ""}

Answer with only YES or NO.
- YES if the company name clearly indicates what they do
- NO if you need more information about their business

Answer:"""

        try:
            response = self.model.generate_content(prompt)
            answer = response.text.strip().upper()

            # Return True if we should research (answer is NO)
            return 'NO' in answer

        except Exception as e:
            # On error, skip research to save costs
            print(f"Error checking if research needed: {e}")
            return False

    def generate_email(
        self,
        user_prompt: str,
        lead_data: Dict,
        company_research: Optional[str] = None,
        cta_links: Optional[Dict[str, str]] = None,
        sender_name: Optional[str] = None
    ) -> Dict:
        """
        Generate personalized email content using Gemini

        Args:
            user_prompt: User's AI prompt template
            lead_data: Lead information dict with keys:
                - decision_maker_name
                - decision_maker_title
                - company_name
                - industry
                - location
                - source_url (website)
            company_research: Optional company research text

        Returns:
            Dict with:
                - subject: Email subject line
                - body_html: HTML email body
                - body_text: Plain text email body
                - generation_cost: Cost in USD
                - tokens_used: Dict with input/output token counts
        """
        # Build the complete prompt
        full_prompt = self._build_email_prompt(
            user_prompt,
            lead_data,
            company_research,
            cta_links,
            sender_name
        )

        try:
            # Generate content
            response = self.model.generate_content(full_prompt)

            # Extract JSON response
            email_content = self._parse_email_response(response.text)

            # Calculate cost
            cost_info = self._calculate_cost(response)

            return {
                'subject': email_content['subject'],
                'body_html': email_content['body_html'],
                'body_text': email_content['body_text'],
                'generation_cost': cost_info['cost'],
                'tokens_used': cost_info['tokens']
            }

        except Exception as e:
            raise Exception(f"Failed to generate email: {str(e)}")

    @staticmethod
    def _build_email_prompt(
        user_prompt: str,
        lead_data: Dict,
        company_research: Optional[str],
        cta_links: Optional[Dict[str, str]] = None,
        sender_name: Optional[str] = None
    ) -> str:
        """Build complete prompt for Gemini"""

        # Replace placeholders in user prompt
        personalized_prompt = user_prompt
        for key, value in lead_data.items():
            if value:
                personalized_prompt = personalized_prompt.replace(f"{{{key}}}", str(value))
                personalized_prompt = personalized_prompt.replace(f"{{{{{key}}}}}", str(value))

        # Extract lead info with NO placeholders allowed
        name = lead_data.get('name') or lead_data.get('decision_maker_name') or 'there'
        title = lead_data.get('title') or lead_data.get('decision_maker_title') or 'professional'
        company = lead_data.get('company') or lead_data.get('company_name') or 'the company'
        industry = lead_data.get('industry') or ''

        prompt = f"""You are an expert B2B sales copywriter writing a NATURAL, HUMAN cold email.

{personalized_prompt}

Recipient Details:
- Name: {name}
- Title: {title}
- Company: {company}
- Industry: {industry if industry else 'Not specified'}
- Location: {lead_data.get('location', 'Not specified')}
- Website: {lead_data.get('source_url', 'Not specified')}

CRITICAL RULE: NEVER use placeholders like [your company], [your industry], [name] in the output.
If any field says "Not specified", write the email WITHOUT mentioning that field.

{f"Company Research:{company_research}" if company_research else ""}

Sender Name: {sender_name if sender_name else "the sender"}

Call-to-Action Links (MUST include these in the email):
{GeminiClient._format_cta_links(cta_links) if cta_links else "- Include a general call-to-action to schedule a call or reply"}

CRITICAL REQUIREMENTS:

**Tone & Style:**
1. Write like a REAL HUMAN typing a quick, genuine email, not a marketing message
2. NO corporate jargon or salesy language ("leverage", "solutions", "cutting-edge", "game-changer")
3. NO buzzwords or marketing speak
4. Sound like the specific person named below is writing it themselves
5. Be specific and concrete, not vague and generic
6. Show you actually know who they are (their role, company, and its context) and match your tone to their seniority
7. WRITE IN THE SENDER'S OWN VOICE: the sender's personality, role and focus are described above. Let that shape the wording, sentence length, structure and warmth. Two different senders should read like two different people, never like the same template.
8. STRICT: NEVER use an em dash (—) or en dash (–) anywhere. Use a comma, a period, or rewrite the sentence. Also avoid semicolons in favor of shorter sentences.
9. Vary sentence length. A short opener, a couple of natural sentences, a clear ask. Contractions are good (I'm, you're, we've).

**Structure:**
7. Keep it SHORT - 80-120 words max (3-4 short paragraphs)
8. Start with a genuine observation or connection, NOT a sales pitch
9. One clear value proposition in the middle (what's in it for them)
10. Simple, direct CTA at the end

**Personalization:**
11. Use recipient's name naturally in opening (e.g., "Hi {lead_data.get('decision_maker_name', 'there')},")
12. Reference their specific role, company, or industry context
13. Make it feel like you wrote THIS email specifically for THEM

**Email Signature:**
14. End with just the sender's first name: "{sender_name if sender_name else 'Best'}"
15. NO "[Your Name]" or placeholders
16. NO company signatures or formal sign-offs
17. Just: "Best,\n{sender_name if sender_name else 'the team'}"

**Call-to-action:**
18. Include the call-to-action link ONCE, woven naturally into a sentence. Never repeat the same link and never add a second link.
19. Use a simple inline HTML link, NOT a button
20. Make the ask feel low-pressure and helpful (for a senior person, offer a short call or a look, don't demand)

**Subject Line:**
21. Short (4-7 words), specific, and intriguing
22. NO clickbait, NO "Re:" tricks, NO emojis
23. Should relate to recipient's actual context

STYLE GUIDE (do not copy wording, only the human feel):
- Open with a specific, genuine line tied to THIS person and company, never a generic hook.
- One clear reason this is relevant to them, in plain language, no hype.
- A single, low-pressure ask with the one link.
- Sign off simply with just the sender's first name.
- Only write about what the sender's company actually offers (described above). Do not invent products, prices, or claims.
- Match register to the reader: for a senior executive at a listed company, be respectful, concise and peer-to-peer, not a junior sales pitch.
- Remember: no em dashes, no buzzwords, sound like a real person.

Return ONLY valid JSON in this exact format:
{{
  "subject": "Your compelling subject line here",
  "body_html": "<p>Your HTML email body here</p>",
  "body_text": "Your plain text version here"
}}

JSON Response:"""

        return prompt

    @staticmethod
    def _format_cta_links(cta_links: Dict[str, str]) -> str:
        """Format CTA links for the prompt"""
        formatted = []
        for label, url in cta_links.items():
            formatted.append(f"- {label}: {url}")
        return "\n".join(formatted)

    @staticmethod
    def _parse_email_response(response_text: str) -> Dict:
        """Parse Gemini response and extract JSON"""
        try:
            # Try to find JSON in response
            json_match = re.search(r'\{.*\}', response_text, re.DOTALL)
            if json_match:
                json_str = json_match.group(0)
                email_data = json.loads(json_str)

                # Validate required fields
                required_fields = ['subject', 'body_html', 'body_text']
                for field in required_fields:
                    if field not in email_data:
                        raise ValueError(f"Missing required field: {field}")

                return email_data
            else:
                raise ValueError("No JSON found in response")

        except json.JSONDecodeError as e:
            raise ValueError(f"Invalid JSON in response: {e}")

    def _calculate_cost(self, response) -> Dict:
        """Calculate generation cost from response"""
        try:
            # Get token counts from response metadata
            usage_metadata = response.usage_metadata

            input_tokens = usage_metadata.prompt_token_count
            output_tokens = usage_metadata.candidates_token_count

            # Calculate cost
            input_cost = (input_tokens / 1_000_000) * self.input_cost_per_million
            output_cost = (output_tokens / 1_000_000) * self.output_cost_per_million
            total_cost = input_cost + output_cost

            return {
                'cost': round(total_cost, 6),
                'tokens': {
                    'input': input_tokens,
                    'output': output_tokens,
                    'total': input_tokens + output_tokens
                }
            }

        except Exception as e:
            # If we can't calculate exact cost, return estimate
            print(f"Error calculating cost: {e}")
            return {
                'cost': 0.0001,  # Default estimate
                'tokens': {
                    'input': 500,
                    'output': 200,
                    'total': 700
                }
            }

    def calculate_optimal_send_time(
        self,
        recipient_data: Dict,
        timezone: str
    ) -> Dict:
        """
        Use AI to determine optimal send time for recipient

        Args:
            recipient_data: Dict with industry, title, location
            timezone: Recipient timezone

        Returns:
            Dict with best_hour (0-23) and reason
        """
        prompt = f"""Given the following recipient profile, suggest the best hour to send a B2B email.

Recipient Profile:
- Timezone: {timezone}
- Industry: {recipient_data.get('industry', 'Unknown')}
- Job Title: {recipient_data.get('decision_maker_title', 'Unknown')}
- Location: {recipient_data.get('location', 'Unknown')}

Consider:
- When do professionals in this role typically check email?
- What's the typical work schedule in this industry?
- What time zone are they in?

Return ONLY valid JSON:
{{
  "best_hour": 9,
  "reason": "Brief explanation"
}}

Note: best_hour should be in 24-hour format (0-23) in their local timezone.

JSON Response:"""

        try:
            response = self.model.generate_content(prompt)
            result = self._parse_email_response(response.text)

            # Validate hour
            hour = result.get('best_hour', 9)
            if not isinstance(hour, int) or hour < 0 or hour > 23:
                hour = 9  # Default to 9 AM

            return {
                'best_hour': hour,
                'reason': result.get('reason', 'Optimal business hours')
            }

        except Exception as e:
            print(f"Error calculating optimal send time: {e}")
            # Default to 9 AM
            return {
                'best_hour': 9,
                'reason': 'Default morning send time'
            }

    def test_connection(self) -> bool:
        """
        Test Gemini API connection

        Returns:
            True if connection successful
        """
        try:
            response = self.model.generate_content("Say 'OK' if you can read this.")
            return 'OK' in response.text.upper()
        except Exception as e:
            print(f"Gemini API test failed: {e}")
            return False


class CompanyResearcher:
    """Helper class for researching company websites"""

    @staticmethod
    def research_company(website_url: str, company_name: str) -> Optional[str]:
        """
        Scrape and analyze company website for context

        Args:
            website_url: Company website URL
            company_name: Company name

        Returns:
            Research summary or None if failed
        """
        try:
            import requests
            from bs4 import BeautifulSoup

            # Fetch website
            headers = {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
            response = requests.get(website_url, headers=headers, timeout=10)
            response.raise_for_status()

            # Parse HTML
            soup = BeautifulSoup(response.content, 'html.parser')

            # Extract key information
            research = []

            # Get title
            if soup.title:
                research.append(f"Page Title: {soup.title.string}")

            # Get meta description
            meta_desc = soup.find('meta', attrs={'name': 'description'})
            if meta_desc and meta_desc.get('content'):
                research.append(f"Description: {meta_desc['content']}")

            # Get main headings
            h1_tags = soup.find_all('h1', limit=3)
            if h1_tags:
                headings = [h1.get_text(strip=True) for h1 in h1_tags]
                research.append(f"Main Headings: {', '.join(headings)}")

            # Get first few paragraphs
            paragraphs = soup.find_all('p', limit=5)
            if paragraphs:
                text_snippets = []
                for p in paragraphs:
                    text = p.get_text(strip=True)
                    if len(text) > 50:  # Only substantial paragraphs
                        text_snippets.append(text[:200])
                if text_snippets:
                    research.append(f"Content: {' '.join(text_snippets)}")

            if research:
                return "\n".join(research)
            else:
                return None

        except Exception as e:
            print(f"Error researching company {company_name}: {e}")
            return None
