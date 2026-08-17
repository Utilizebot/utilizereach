"""
Database Operations

CRUD operations for scraping jobs and results
"""

from typing import List, Dict, Optional, Any
from datetime import datetime
from .client import get_supabase_admin_client


def create_scraping_job(
    sales_rep_id: str,
    search_query: str,
    location: str,
    num_queries: int,
    job_name: str = "Lead Scraping",
    industry: Optional[str] = None,
    api_key_used: Optional[str] = None
) -> Dict[str, Any]:
    """
    Create a new scraping job

    Args:
        sales_rep_id: UUID of the sales representative
        search_query: Search query string
        location: Location/country code
        num_queries: Number of queries to run
        job_name: Name for the job
        industry: Optional industry filter
        api_key_used: Optional API key ID used

    Returns:
        Created job record
    """
    supabase = get_supabase_admin_client()

    job_data = {
        "started_by": sales_rep_id,  # Existing schema uses 'started_by'
        "job_name": job_name,
        "search_query": search_query,
        "location": location,
        "num_queries": num_queries,
        "industry": industry,
        "api_key_used": api_key_used,
        "status": "pending",
        "progress": 0,
        "leads_found": 0,
    }

    response = supabase.table("scraping_jobs").insert(job_data).execute()

    if response.data:
        return response.data[0]
    else:
        raise Exception(f"Failed to create scraping job: {response}")


def update_job_status(
    job_id: str,
    status: Optional[str] = None,
    **kwargs
) -> Dict[str, Any]:
    """
    Update job status and related fields

    Args:
        job_id: Job UUID
        status: New status (pending, running, completed, failed) - optional
        **kwargs: Additional fields to update (progress, current_step, etc.)

    Returns:
        Updated job record
    """
    supabase = get_supabase_admin_client()

    # Build update data - only include status if it's not None
    update_data = {**kwargs}
    if status is not None:
        update_data["status"] = status

    response = supabase.table("scraping_jobs").update(update_data).eq("id", job_id).execute()

    if response.data:
        return response.data[0]
    else:
        raise Exception(f"Failed to update job {job_id}: {response}")


def update_job_progress(
    job_id: str,
    progress: int,
    current_step: str,
    total_leads_found: Optional[int] = None
) -> Dict[str, Any]:
    """
    Update job progress (without changing status)

    Args:
        job_id: Job UUID
        progress: Progress percentage (0-100)
        current_step: Current step description
        total_leads_found: Total leads found so far

    Returns:
        Updated job record
    """
    update_data = {
        "progress": progress,
        "current_step": current_step,
    }

    if total_leads_found is not None:
        update_data["leads_found"] = total_leads_found  # Schema uses 'leads_found' not 'total_leads_found'

    # Call without status parameter to avoid overwriting it
    return update_job_status(job_id, **update_data)


def get_job_by_id(job_id: str) -> Optional[Dict[str, Any]]:
    """
    Get job by ID

    Args:
        job_id: Job UUID

    Returns:
        Job record or None
    """
    supabase = get_supabase_admin_client()

    response = supabase.table("scraping_jobs").select("*").eq("id", job_id).execute()

    if response.data and len(response.data) > 0:
        return response.data[0]
    else:
        return None


def get_jobs_by_user(
    sales_rep_id: str,
    limit: int = 20,
    offset: int = 0,
    status: Optional[str] = None
) -> List[Dict[str, Any]]:
    """
    Get jobs for a specific user

    Args:
        sales_rep_id: Sales rep UUID
        limit: Maximum number of records
        offset: Offset for pagination
        status: Optional status filter

    Returns:
        List of job records
    """
    supabase = get_supabase_admin_client()

    query = (
        supabase.table("scraping_jobs")
        .select("*")
        .eq("started_by", sales_rep_id)  # Existing schema uses 'started_by'
        .order("started_at", desc=True)
        .limit(limit)
        .offset(offset)
    )

    if status:
        query = query.eq("status", status)

    response = query.execute()

    return response.data or []


def count_jobs_by_user(sales_rep_id: str, status: Optional[str] = None) -> int:
    """
    Count total jobs for a user

    Args:
        sales_rep_id: Sales rep UUID
        status: Optional status filter

    Returns:
        Total count
    """
    supabase = get_supabase_admin_client()

    query = supabase.table("scraping_jobs").select("id", count="exact").eq("started_by", sales_rep_id)

    if status:
        query = query.eq("status", status)

    response = query.execute()

    return response.count or 0


def create_scraping_result(
    job_id: str,
    company_name: Optional[str] = None,
    contact_name: Optional[str] = None,
    contact_title: Optional[str] = None,
    email: Optional[str] = None,
    phone: Optional[str] = None,
    source_url: Optional[str] = None,
    relevance_score: Optional[int] = None,
    page_title: Optional[str] = None,
    search_query: Optional[str] = None,
    is_executive: bool = False
) -> Dict[str, Any]:
    """
    Create a scraping result (lead)

    Args:
        job_id: Parent job UUID
        company_name: Company name
        contact_name: Contact person name (decision_maker_name in schema)
        contact_title: Contact title (decision_maker_title in schema)
        email: Email address
        phone: Phone number
        source_url: Source URL
        relevance_score: Relevance score (url_score in schema)
        page_title: Page title
        search_query: Search query used
        is_executive: Whether contact is an executive

    Returns:
        Created result record
    """
    supabase = get_supabase_admin_client()

    result_data = {
        "job_id": job_id,
        "company_name": company_name,
        "decision_maker_name": contact_name,  # Schema uses decision_maker_name
        "decision_maker_title": contact_title,  # Schema uses decision_maker_title
        "email": email,
        "phone": phone,
        "source_url": source_url,
        "url_score": relevance_score,  # Schema uses url_score
        "page_title": page_title,
        "search_query": search_query,
        "is_executive": is_executive,
        "status": "new",  # Default status for new leads
    }

    response = supabase.table("scraped_leads").insert(result_data).execute()  # Table is scraped_leads

    if response.data:
        return response.data[0]
    else:
        raise Exception(f"Failed to create scraping result: {response}")


def get_results_by_job(job_id: str) -> List[Dict[str, Any]]:
    """
    Get all results for a job

    Args:
        job_id: Job UUID

    Returns:
        List of result records
    """
    supabase = get_supabase_admin_client()

    response = (
        supabase.table("scraped_leads")  # Table is scraped_leads
        .select("*")
        .eq("job_id", job_id)
        .order("url_score", desc=True)  # Schema uses url_score
        .execute()
    )

    return response.data or []


def get_active_api_key_for_user(sales_rep_id: str) -> Optional[Dict[str, Any]]:
    """
    Get an active SerpAPI key for a user

    Args:
        sales_rep_id: Sales rep UUID

    Returns:
        API key record or None
    """
    supabase = get_supabase_admin_client()

    response = (
        supabase.table("api_keys")
        .select("*")
        .eq("assigned_to", sales_rep_id)
        .eq("provider", "serpapi")
        .eq("is_active", True)
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )

    if response.data and len(response.data) > 0:
        return response.data[0]
    else:
        return None
