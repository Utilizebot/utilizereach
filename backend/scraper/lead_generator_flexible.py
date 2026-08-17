#!/usr/bin/env python3
"""
Flexible Lead Generation Script - Decision Maker Finder
Extracts emails, names, titles, and phone numbers with focus on executives
Supports ANY geographic location through LocationConfig system

Usage:
    python lead_generator_flexible.py '<search query>' [num_queries] [location]

Examples:
    python lead_generator_flexible.py 'manufacturing automation' 10 malaysia
    python lead_generator_flexible.py 'warehouse robotics' 10 singapore
    python lead_generator_flexible.py 'logistics companies' 10 uk
    python lead_generator_flexible.py 'factory automation' 10 global

    # Or omit num_queries to use default (10)
    python lead_generator_flexible.py 'manufacturing automation' malaysia
"""

import os
import re
import time
import json
from typing import List, Dict, Tuple, Optional
from urllib.parse import urljoin, urlparse
from pathlib import Path
import requests
from bs4 import BeautifulSoup
from serpapi import GoogleSearch
import pandas as pd
from dotenv import load_dotenv
import validators

from .location_config import LocationConfig, get_location_config, list_available_locations

# Load environment variables from Docker config volume if available
config_env = Path("/app/config/.env")
if config_env.exists():
    load_dotenv(config_env)
else:
    load_dotenv()


class FlexibleLeadGenerator:
    """Lead generator with flexible location targeting"""

    def __init__(self, location_config: LocationConfig):
        """
        Initialize lead generator with location configuration

        Args:
            location_config: LocationConfig instance for geographic targeting
        """
        self.location = location_config
        self.serpapi_key = os.getenv('SERPAPI_KEY')
        self.max_urls_per_query = int(os.getenv('MAX_URLS_PER_QUERY', 100))
        self.min_url_score = int(os.getenv('MIN_URL_SCORE', 6))
        self.request_timeout = int(os.getenv('REQUEST_TIMEOUT', 10))
        self.user_agent = os.getenv('USER_AGENT',
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36')

        if not self.serpapi_key:
            raise ValueError("SERPAPI_KEY not found in environment variables")

        self.session = requests.Session()
        self.session.headers.update({'User-Agent': self.user_agent})

        # Email pattern (universal)
        self.email_pattern = re.compile(
            r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b'
        )

        # Phone pattern from location config
        self.phone_pattern = self.location.get_phone_regex()

        # Decision maker titles (universal)
        self.executive_titles = [
            'ceo', 'chief executive', 'president', 'founder', 'owner',
            'cto', 'chief technology', 'vp technology', 'director technology',
            'coo', 'chief operating', 'vp operations', 'director operations',
            'vp engineering', 'director engineering', 'head of engineering',
            'vp manufacturing', 'director manufacturing', 'plant manager',
            'vp supply chain', 'director logistics', 'warehouse manager',
            'cfo', 'chief financial', 'vp finance',
            'procurement manager', 'purchasing director', 'buyer',
            'managing director', 'md', 'general manager', 'gm'
        ]

    def generate_search_queries(self, base_query: str, num_queries: int = 5) -> List[str]:
        """
        Generate comprehensive location-focused queries targeting decision makers

        Enhanced to generate MORE queries than original hardcoded version for better results
        """
        print(f"\n[1/6] Generating {num_queries}+ search queries for {self.location.name}")
        print(f"  Base query: '{base_query}'")

        words = base_query.lower().split()
        business_type = []
        location_mention = []

        # Check if location is already in the query
        has_location = self.location.name.lower() in base_query.lower()
        has_city = any(city in base_query.lower() for city in self.location.major_cities)

        if len(words) > 1 and words[-1].istitle():
            location_mention.append(words[-1])
            business_type = words[:-1]
        else:
            business_type = words

        business = ' '.join(business_type)
        loc_suffix = ' '.join(location_mention) if location_mention else ''

        queries = []

        # 1. Base query with location (if not already present)
        if has_location or self.location.country_code == "":
            queries.append(base_query)
        else:
            queries.append(f"{base_query} {self.location.name}")

        # 2. Business suffix variations (use ALL suffixes, not just 2)
        if self.location.business_suffixes:
            # First suffix with "contact"
            if len(self.location.business_suffixes) > 0:
                suffix1 = self.location.business_suffixes[0]
                queries.append(f"{business} {suffix1} {self.location.name} {loc_suffix} contact")
            # Second suffix with "email" for variation
            if len(self.location.business_suffixes) > 1:
                suffix2 = self.location.business_suffixes[1]
                queries.append(f"{business} {suffix2} {self.location.name} {loc_suffix} email")

        # 3. Executive-focused queries
        queries.append(f"{business} {self.location.name} {loc_suffix} CEO email address")
        queries.append(f"{business} {self.location.name} {loc_suffix} managing director contact")

        # 4. Major city variations (use TOP 2 cities for better coverage)
        if self.location.major_cities:
            # Primary city
            if len(self.location.major_cities) > 0:
                city1 = self.location.major_cities[0]
                queries.append(f"{business} {city1} {loc_suffix} directors")

            # Secondary city (for more comprehensive results)
            if len(self.location.major_cities) > 1:
                city2 = self.location.major_cities[1]
                queries.append(f"{business} {city2} {loc_suffix} executive contact")

        # 5. Leadership team query
        queries.append(f"{business} {self.location.name} {loc_suffix} leadership team")

        # 6. Domain-specific searches (use TOP 2 domains if available)
        if self.location.domain_extensions:
            relevant_domains = [d for d in self.location.domain_extensions
                              if d not in ['.com', '.net', '.org']]  # Skip generic domains

            if len(relevant_domains) > 0:
                domain1 = relevant_domains[0].replace('.', '')
                queries.append(f"site:{domain1} {business} {loc_suffix} contact")

            if len(relevant_domains) > 1:
                domain2 = relevant_domains[1].replace('.', '')
                queries.append(f"site:{domain2} {business} {loc_suffix} email")

        # 7. Remove duplicates but DON'T limit yet - keep all quality queries
        queries = list(dict.fromkeys(queries))

        # 8. Only limit if we have too many (keep best ones)
        # For better results, we want MORE queries not fewer
        # Original had 10 queries, let's match or exceed that
        if len(queries) > num_queries:
            # Keep the most important ones if we must limit
            # But ideally, increase num_queries parameter for better results
            print(f"  Note: Generated {len(queries)} queries, limiting to {num_queries}")
            print(f"  💡 Tip: Use higher num_queries (e.g., 10-15) for better coverage!")
            queries = queries[:num_queries]

        for i, q in enumerate(queries, 1):
            print(f"  {i}. {q}")

        if len(queries) < 10 and self.location.country_code != "":
            print(f"  ⚠️  Only {len(queries)} queries generated. Original had 10+.")
            print(f"  💡 Consider using num_queries=10 for better results!")

        return queries

    def fetch_urls_from_serpapi(self, queries: List[str]) -> List[Dict[str, str]]:
        """Fetch URLs from SerpAPI with location-specific geo-targeting"""
        print(f"\n[2/6] Fetching URLs from SerpAPI (targeting: {self.location.name})...")
        all_urls = []

        for i, query in enumerate(queries, 1):
            print(f"  Query {i}/{len(queries)}: {query}")

            try:
                # Get location-specific SerpAPI parameters
                location_params = self.location.get_serpapi_params()

                params = {
                    "q": query,
                    "api_key": self.serpapi_key,
                    "num": min(self.max_urls_per_query, 100),
                    "engine": "google",
                    **location_params  # Apply location-specific params
                }

                # Only add geo params if country_code is set (skip for global)
                if not self.location.country_code:
                    # Global search - remove geo restrictions
                    params.pop('gl', None)
                    params.pop('location', None)

                search = GoogleSearch(params)
                results = search.get_dict()

                if "organic_results" in results:
                    for result in results["organic_results"]:
                        url = result.get("link")
                        title = result.get("title", "")

                        if url and validators.url(url):
                            all_urls.append({
                                'url': url,
                                'title': title,
                                'query': query
                            })

                print(f"    Found {len(results.get('organic_results', []))} URLs")
                time.sleep(1)

            except Exception as e:
                print(f"    Error: {e}")
                continue

        print(f"\n  Total URLs collected: {len(all_urls)}")
        return all_urls

    def score_url(self, url_data: Dict[str, str]) -> int:
        """Score URL with emphasis on location relevance and executive pages"""
        url = url_data['url'].lower()
        title = url_data['title'].lower()

        score = 5  # Base score

        # CRITICAL: Local domain boost (highest priority)
        is_local_domain = self.location.is_local_domain(url)
        if is_local_domain:
            score += 3  # Strong boost for local domains

        # Check for location indicators in URL/title
        if self.location.has_location_indicator(url) or self.location.has_location_indicator(title):
            score += 2

        # BOOST for executive/leadership pages (universal)
        executive_keywords = [
            'leadership', 'executive', 'management', 'team', 'about-us',
            'about', 'ceo', 'founder', 'director', 'officers'
        ]
        for keyword in executive_keywords:
            if keyword in url or keyword in title:
                score += 2
                break

        # Contact keywords (use location-specific + universal)
        all_contact_keywords = list(set(self.location.contact_keywords + ['contact', 'email']))
        for keyword in all_contact_keywords:
            if keyword in url or keyword in title:
                score += 1.5
                break

        # Business/industry signals
        business_keywords = [
            'manufacturing', 'warehouse', 'logistics', 'automation',
            'robotics', 'factory', 'operations', 'industrial'
        ]
        # Add location-specific business suffixes
        business_keywords.extend(self.location.business_suffixes)

        for keyword in business_keywords:
            if keyword in url or keyword in title:
                score += 1
                break

        # PENALIZE if no location indicators (unless global search)
        if self.location.country_code != "":  # Not a global search
            if not is_local_domain and not self.location.has_location_indicator(url + " " + title):
                score -= 2  # Likely not from target region

        # Negative signals (universal)
        social_media = [
            'facebook.com', 'twitter.com', 'linkedin.com', 'instagram.com',
            'youtube.com', 'reddit.com', 'tiktok.com'
        ]
        spam_keywords = ['login', 'register', 'shop', 'cart', 'product', 'blog', 'news']

        for platform in social_media:
            if platform in url:
                score -= 3
                break

        for keyword in spam_keywords:
            if keyword in url:
                score -= 1

        # Bad file extensions
        bad_extensions = ['.pdf', '.doc', '.jpg', '.png', '.zip']
        for ext in bad_extensions:
            if url.endswith(ext):
                score -= 2
                break

        return max(0, min(10, int(score)))

    def filter_urls(self, url_list: List[Dict[str, str]]) -> List[Dict[str, str]]:
        """Filter URLs based on scoring"""
        print(f"\n[3/6] Filtering URLs (keeping score >= {self.min_url_score})...")

        filtered = []
        for url_data in url_list:
            score = self.score_url(url_data)
            if score >= self.min_url_score:
                url_data['score'] = score
                filtered.append(url_data)

        print(f"  Filtered: {len(url_list)} -> {len(filtered)} URLs")
        return filtered

    def extract_contact_info(self, html: str, url: str) -> Dict:
        """Extract emails, names, titles, and phone numbers"""
        soup = BeautifulSoup(html, 'lxml')

        # Remove script and style elements
        for script in soup(["script", "style"]):
            script.decompose()

        text = soup.get_text()

        # Extract emails
        emails = set(self.email_pattern.findall(text))
        filtered_emails = set()
        for email in emails:
            if not any(ext in email.lower() for ext in ['.png', '.jpg', '.gif', '.css', '.js']):
                if not any(word in email.lower() for word in ['example.', 'test@', 'noreply@', 'privacy@', 'legal@']):
                    filtered_emails.add(email)

        # Extract phone numbers using location-specific pattern
        phones = set(self.phone_pattern.findall(text))
        # Clean phone numbers
        cleaned_phones = set()
        for phone in phones:
            if isinstance(phone, tuple):
                phone = ''.join(phone)
            # Only keep if it looks like a real phone
            phone = phone.strip()
            if len(phone) >= 10:
                cleaned_phones.add(phone)

        # Extract people with titles (decision makers)
        people = self.extract_people_with_titles(soup, text)

        return {
            'emails': filtered_emails,
            'phones': cleaned_phones,
            'people': people
        }

    def extract_people_with_titles(self, soup: BeautifulSoup, text: str) -> List[Dict]:
        """Extract names and titles of decision makers"""
        people = []

        # Common patterns for name + title
        patterns = [
            # "John Smith, CEO" or "John Smith - CEO"
            r'([A-Z][a-z]+\s+[A-Z][a-z]+)\s*[,\-–]\s*([A-Z][a-zA-Z\s]+(?:CEO|CTO|COO|CFO|President|VP|Director|Manager|Chief|Head|Owner|Founder))',
            # "CEO: John Smith" or "CEO - John Smith"
            r'(CEO|CTO|COO|CFO|President|VP|Director|Manager|Chief|Head|Owner|Founder)[:\-–]\s*([A-Z][a-z]+\s+[A-Z][a-z]+)',
            # "John Smith\nCEO" (newline separated)
            r'([A-Z][a-z]+\s+[A-Z][a-z]+)\s*\n\s*([A-Z][a-zA-Z\s]+(?:CEO|CTO|COO|CFO|President|VP|Director|Manager|Chief|Head|Owner|Founder))',
        ]

        for pattern in patterns:
            matches = re.findall(pattern, text, re.MULTILINE)
            for match in matches:
                if len(match) == 2:
                    name, title = match
                    name = name.strip()
                    title = title.strip()

                    # Check if title contains executive keywords
                    if any(exec_title in title.lower() for exec_title in self.executive_titles):
                        people.append({
                            'name': name,
                            'title': title,
                            'is_executive': True
                        })

        # Try to find structured data (JSON-LD, schema.org)
        scripts = soup.find_all('script', type='application/ld+json')
        for script in scripts:
            try:
                data = json.loads(script.string)
                if isinstance(data, dict):
                    # Look for Person schema
                    if data.get('@type') == 'Person':
                        name = data.get('name', '')
                        title = data.get('jobTitle', '')
                        if name and title:
                            people.append({
                                'name': name,
                                'title': title,
                                'is_executive': any(exec_title in title.lower() for exec_title in self.executive_titles)
                            })
            except:
                pass

        return people

    def scrape_website(self, url: str) -> Dict:
        """Scrape website for all contact info"""
        all_contacts = {
            'emails': set(),
            'phones': set(),
            'people': []
        }

        try:
            # Fetch main page
            response = self.session.get(url, timeout=self.request_timeout)
            response.raise_for_status()

            # Extract from main page
            contacts = self.extract_contact_info(response.text, url)
            all_contacts['emails'].update(contacts['emails'])
            all_contacts['phones'].update(contacts['phones'])
            all_contacts['people'].extend(contacts['people'])

            # Find and scrape executive/team/contact pages
            soup = BeautifulSoup(response.text, 'lxml')
            # Use location-specific contact keywords + universal ones
            priority_keywords = list(set(
                self.location.contact_keywords +
                ['leadership', 'executive', 'management', 'team', 'about']
            ))

            for link in soup.find_all('a', href=True):
                href = link['href'].lower()
                link_text = link.get_text().lower()

                if any(keyword in href or keyword in link_text for keyword in priority_keywords):
                    contact_url = urljoin(url, link['href'])

                    if urlparse(contact_url).netloc == urlparse(url).netloc:
                        try:
                            contact_response = self.session.get(contact_url, timeout=self.request_timeout)
                            contact_response.raise_for_status()

                            contacts = self.extract_contact_info(contact_response.text, contact_url)
                            all_contacts['emails'].update(contacts['emails'])
                            all_contacts['phones'].update(contacts['phones'])
                            all_contacts['people'].extend(contacts['people'])

                            time.sleep(0.5)
                        except:
                            pass

        except Exception as e:
            pass

        return all_contacts

    def scrape_urls(self, url_list: List[Dict[str, str]]) -> List[Dict[str, any]]:
        """Scrape all URLs and extract contact info"""
        print(f"\n[4/6] Scraping {len(url_list)} websites for decision-maker contacts...")

        results = []

        for i, url_data in enumerate(url_list, 1):
            url = url_data['url']
            print(f"  [{i}/{len(url_list)}] {url[:60]}...")

            contacts = self.scrape_website(url)

            # Create entries for each email found
            for email in contacts['emails']:
                result = {
                    'email': email,
                    'source_url': url,
                    'page_title': url_data['title'],
                    'search_query': url_data['query'],
                    'url_score': url_data['score'],
                    'phone': ', '.join(contacts['phones']) if contacts['phones'] else '',
                    'decision_maker_name': '',
                    'decision_maker_title': '',
                    'is_executive': False,
                    'location': self.location.name
                }

                # Try to match email with a person
                email_prefix = email.split('@')[0].lower()
                for person in contacts['people']:
                    person_name_parts = person['name'].lower().split()
                    # Check if email contains name parts
                    if any(part in email_prefix for part in person_name_parts):
                        result['decision_maker_name'] = person['name']
                        result['decision_maker_title'] = person['title']
                        result['is_executive'] = person['is_executive']
                        break

                results.append(result)

            # Also add people without matched emails
            for person in contacts['people']:
                if person['is_executive']:
                    # Check if we already have this person
                    existing = False
                    for r in results:
                        if r['decision_maker_name'] == person['name']:
                            existing = True
                            break

                    if not existing:
                        results.append({
                            'email': '',  # No email found for this person yet
                            'source_url': url,
                            'page_title': url_data['title'],
                            'search_query': url_data['query'],
                            'url_score': url_data['score'],
                            'phone': ', '.join(contacts['phones']) if contacts['phones'] else '',
                            'decision_maker_name': person['name'],
                            'decision_maker_title': person['title'],
                            'is_executive': person['is_executive'],
                            'location': self.location.name
                        })

            if contacts['emails'] or contacts['people']:
                print(f"    Found {len(contacts['emails'])} email(s), {len(contacts['phones'])} phone(s), {len(contacts['people'])} people")

            time.sleep(1)

        print(f"\n  Total contacts extracted: {len(results)}")
        return results

    def export_to_csv(self, results: List[Dict[str, any]], filename: str = None) -> str:
        """Export results with priority to executives"""
        if filename is None:
            # Generate filename with location
            safe_location = self.location.name.replace(' ', '_').lower()
            filename = f'executive_leads_{safe_location}.csv'

        print(f"\n[5/6] Exporting to {filename}...")

        if not results:
            print("  No results to export!")
            return None

        df = pd.DataFrame(results)

        # Remove complete duplicates
        df = df.drop_duplicates()

        # Sort: Executives first, then by url_score
        df = df.sort_values(['is_executive', 'url_score'], ascending=[False, False])

        df.to_csv(filename, index=False)

        executive_count = df['is_executive'].sum()
        print(f"  Exported {len(df)} contacts ({executive_count} executives) to {filename}")

        return filename

    def run(self, base_query: str, num_queries: int = 10):
        """Run the flexible lead generation workflow"""
        print("="*70)
        print("FLEXIBLE LEAD GENERATION - DECISION MAKER FINDER")
        print("="*70)
        print(f"Input: {base_query}")
        print(f"Location: {self.location.name}")
        print(f"Target: {num_queries} location-focused search queries (default: 10 for optimal results)")
        if self.location.country_code:
            print(f"Geo-targeting: {self.location.google_domain}")
        else:
            print(f"Geo-targeting: Global (no restrictions)")

        start_time = time.time()

        # Step 1: Generate queries
        queries = self.generate_search_queries(base_query, num_queries)

        # Step 2: Fetch URLs from SerpAPI
        urls = self.fetch_urls_from_serpapi(queries)

        # Step 3: Filter URLs
        filtered_urls = self.filter_urls(urls)

        # Step 4: Scrape websites
        results = self.scrape_urls(filtered_urls)

        # Step 5: Export to CSV
        output_file = self.export_to_csv(results)

        elapsed_time = time.time() - start_time

        print("\n" + "="*70)
        print("SUMMARY")
        print("="*70)
        print(f"Location: {self.location.name}")
        print(f"Search queries generated: {len(queries)}")
        print(f"URLs fetched: {len(urls)}")
        print(f"URLs after filtering: {len(filtered_urls)}")
        print(f"Total contacts extracted: {len(results)}")

        executives = [r for r in results if r.get('is_executive', False)]
        print(f"Decision makers identified: {len(executives)}")

        with_email = [r for r in results if r.get('email', '')]
        print(f"Contacts with email: {len(with_email)}")

        with_phone = [r for r in results if r.get('phone', '')]
        print(f"Contacts with phone: {len(with_phone)}")

        print(f"Time elapsed: {elapsed_time:.2f} seconds")
        print(f"Output file: {output_file}")
        print("="*70)


def main():
    """Main entry point"""
    import sys

    if len(sys.argv) < 2:
        print("Usage: python lead_generator_flexible.py '<search query>' [num_queries] [location]")
        print("\nDefaults: num_queries=10, location=malaysia")
        print("\nExamples:")
        print("  python lead_generator_flexible.py 'manufacturing companies automation' 10 malaysia")
        print("  python lead_generator_flexible.py 'warehouse automation directors' 10 singapore")
        print("  python lead_generator_flexible.py 'robotics companies executives' 10 uk")
        print("  python lead_generator_flexible.py 'logistics automation' 10 global")
        print("\n  # Or use defaults (10 queries, Malaysia)")
        print("  python lead_generator_flexible.py 'manufacturing automation'")
        print("\nNote: Use 10-15 queries for comprehensive results (matches or exceeds original)")
        print("\nAvailable locations:")
        for loc in list_available_locations():
            print(f"  - {loc}")
        sys.exit(1)

    base_query = sys.argv[1]
    num_queries = int(sys.argv[2]) if len(sys.argv) > 2 else 10  # Default: 10 for better results (matches original)
    location_name = sys.argv[3] if len(sys.argv) > 3 else 'malaysia'  # Default to Malaysia for backwards compatibility

    try:
        # Get location configuration
        location_config = get_location_config(location_name)
        print(f"\n✓ Using location preset: {location_config.name}")

        # Create generator
        generator = FlexibleLeadGenerator(location_config)

        # Run scraping
        generator.run(base_query, num_queries)

    except ValueError as e:
        print(f"\nError: {e}")
        print("\nAvailable locations:")
        for loc in list_available_locations():
            print(f"  - {loc}")
        sys.exit(1)
    except Exception as e:
        print(f"\nError: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()
