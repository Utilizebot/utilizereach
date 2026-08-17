"""
Add progress callback support to FlexibleLeadGenerator

This extends the scraper with real-time progress tracking for Celery integration
"""

def scrape_leads_with_progress(self, base_query: str, num_queries: int = 10, progress_callback=None, save_callback=None):
    """
    Run lead generation with progress callbacks and progressive saving

    Args:
        base_query: Search query
        num_queries: Number of queries to generate
        progress_callback: Callback function(current, total, message, leads_so_far)
        save_callback: Callback function(leads_list) to save leads immediately after each website

    Returns:
        List of lead dictionaries
    """
    import time

    def report_progress(step, total_steps, message, leads=0):
        """Helper to report progress"""
        if progress_callback:
            progress_callback(step, total_steps, message, leads)

    # Total steps: Generate queries + Fetch URLs + Filter + Scrape (counted per URL batch)
    total_steps = num_queries + 3  # queries + fetch + filter + scrape summary
    current_step = 0

    # Step 1: Generate queries
    current_step += 1
    report_progress(current_step, total_steps, f"Generating {num_queries} search queries...")
    queries = self.generate_search_queries(base_query, num_queries)

    # Step 2: Fetch URLs (with progress per query)
    all_urls = []
    for i, query in enumerate(queries, 1):
        current_step += 1
        report_progress(
            current_step,
            total_steps,
            f"Fetching URLs for query {i}/{len(queries)}: {query[:50]}..."
        )

        try:
            location_params = self.location.get_serpapi_params()
            params = {
                "q": query,
                "api_key": self.serpapi_key,
                "num": min(self.max_urls_per_query, 100),
                "engine": "google",
                **location_params
            }

            if not self.location.country_code:
                params.pop('gl', None)
                params.pop('location', None)

            from serpapi import GoogleSearch
            import validators

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

            time.sleep(1)
        except Exception as e:
            print(f"Error fetching query {i}: {e}")
            continue

    # Step 3: Filter URLs
    current_step += 1
    report_progress(current_step, total_steps, f"Filtering {len(all_urls)} URLs...")
    filtered_urls = self.filter_urls(all_urls)

    # Step 4: Scrape websites (with progress per URL)
    current_step += 1
    report_progress(current_step, total_steps, f"Scraping {len(filtered_urls)} websites...")

    results = []
    for i, url_data in enumerate(filtered_urls, 1):
        # Update progress every 5 URLs or last URL
        if i % 5 == 0 or i == len(filtered_urls):
            report_progress(
                current_step,
                total_steps,
                f"Scraping website {i}/{len(filtered_urls)}...",
                len(results)
            )

        url = url_data['url']
        contacts = self.scrape_website(url)

        # Collect leads from this website
        website_leads = []

        # Create entries for each email found
        for email in contacts['emails']:
            result = {
                'email': email,
                'company': url_data['title'].split('|')[0].split('-')[0].strip() if url_data['title'] else '',
                'name': '',
                'title': '',
                'phone': ', '.join(contacts['phones']) if contacts['phones'] else '',
                'url': url,
                'score': url_data['score'],
            }

            # Try to match email with a person
            email_prefix = email.split('@')[0].lower()
            for person in contacts['people']:
                person_name_parts = person['name'].lower().split()
                if any(part in email_prefix for part in person_name_parts):
                    result['name'] = person['name']
                    result['title'] = person['title']
                    break

            website_leads.append(result)

        # Also add executives without matched emails
        for person in contacts['people']:
            if person['is_executive']:
                existing = any(r.get('name') == person['name'] for r in website_leads)
                if not existing:
                    website_leads.append({
                        'email': '',
                        'company': url_data['title'].split('|')[0].split('-')[0].strip() if url_data['title'] else '',
                        'name': person['name'],
                        'title': person['title'],
                        'phone': ', '.join(contacts['phones']) if contacts['phones'] else '',
                        'url': url,
                        'score': url_data['score'],
                    })

        # PROGRESSIVE SAVE: Save leads immediately after each website
        if save_callback and website_leads:
            try:
                save_callback(website_leads)
                print(f"  ✓ Saved {len(website_leads)} leads from {url[:50]}...")
            except Exception as e:
                print(f"  ✗ Failed to save leads from {url[:50]}: {e}")

        # Add to results for CSV generation at the end
        results.extend(website_leads)

        time.sleep(1)

    # Final progress
    report_progress(total_steps, total_steps, "Completed scraping", len(results))

    return results


# Monkey-patch the method onto FlexibleLeadGenerator
# This will be imported in the Celery task
def add_progress_support():
    """Add progress callback method to FlexibleLeadGenerator"""
    from .lead_generator_flexible import FlexibleLeadGenerator
    FlexibleLeadGenerator.scrape_leads_with_progress = scrape_leads_with_progress
