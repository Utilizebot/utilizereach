"""
Scraper API Router

Endpoints for lead scraping operations
"""

from fastapi import APIRouter, Depends, HTTPException, Response
from fastapi.responses import FileResponse
from typing import List, Optional
import sys
import os

# Add parent directory to import path
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from api.models import (
    StartScrapingJobRequest,
    StartJobResponse,
    ScrapingJobResponse,
    JobListResponse,
    LeadResult,
)
from api.dependencies import get_current_user
from database.operations import (
    create_scraping_job,
    get_jobs_by_user,
    count_jobs_by_user,
    get_job_by_id,
    get_results_by_job,
    get_active_api_key_for_user,
)
from celery_app.tasks import scrape_leads

router = APIRouter(prefix="/api/scraper", tags=["scraper"])


@router.post("/start-job", response_model=StartJobResponse)
async def start_scraping_job(
    request: StartScrapingJobRequest,
    current_user: dict = Depends(get_current_user)
):
    """
    Start a new lead scraping job

    - Validates user authentication
    - Gets active API key for user
    - Creates job in database
    - Starts Celery background task
    - Returns job ID
    """
    try:
        # Get active API key for user
        api_key = get_active_api_key_for_user(current_user["id"])

        if not api_key:
            raise HTTPException(
                status_code=400,
                detail="No active SerpAPI key found. Please add an API key in Settings."
            )

        # Create job record
        job = create_scraping_job(
            sales_rep_id=current_user["id"],
            search_query=request.search_query,
            location=request.location,
            num_queries=request.num_queries,
            job_name=f"Lead Scraping: {request.search_query[:30]}",
            industry=request.industry,
            api_key_used=api_key["id"],
        )

        # Start Celery task
        task = scrape_leads.delay(
            job_id=job["id"],
            search_query=request.search_query,
            location=request.location,
            num_queries=request.num_queries,
            api_key=api_key["api_key_encrypted"],  # Pass the actual API key
            industry=request.industry,
        )

        return StartJobResponse(
            job_id=job["id"],
            status="pending",
            message="Scraping job started successfully"
        )

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to start job: {str(e)}")


@router.get("/jobs", response_model=JobListResponse)
async def get_jobs(
    limit: int = 20,
    offset: int = 0,
    status: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    """
    Get list of scraping jobs for current user

    - Supports pagination
    - Optional status filter
    """
    try:
        jobs = get_jobs_by_user(
            sales_rep_id=current_user["id"],
            limit=limit,
            offset=offset,
            status=status
        )

        total = count_jobs_by_user(
            sales_rep_id=current_user["id"],
            status=status
        )

        print(f"[DEBUG] Retrieved {len(jobs)} jobs from database")
        if jobs:
            print(f"[DEBUG] First job keys: {jobs[0].keys()}")
            print(f"[DEBUG] First job data: {jobs[0]}")

        return JobListResponse(
            jobs=jobs,
            total=total,
            limit=limit,
            offset=offset
        )

    except Exception as e:
        import traceback
        print(f"[ERROR] Failed to get jobs: {str(e)}")
        print(traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"Failed to get jobs: {str(e)}")


@router.get("/jobs/{job_id}", response_model=ScrapingJobResponse)
async def get_job_details(
    job_id: str,
    current_user: dict = Depends(get_current_user)
):
    """
    Get details of a specific job

    - Returns job status, progress, results
    """
    try:
        job = get_job_by_id(job_id)

        if not job:
            raise HTTPException(status_code=404, detail="Job not found")

        # Check if user owns this job
        if job["started_by"] != current_user["id"]:
            raise HTTPException(status_code=403, detail="Access denied")

        return job

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get job: {str(e)}")


@router.get("/jobs/{job_id}/results", response_model=List[LeadResult])
async def get_job_results(
    job_id: str,
    current_user: dict = Depends(get_current_user)
):
    """
    Get all lead results for a job

    - Returns list of leads with contact info
    """
    try:
        # Check if user owns this job
        job = get_job_by_id(job_id)

        if not job:
            raise HTTPException(status_code=404, detail="Job not found")

        if job["started_by"] != current_user["id"]:
            raise HTTPException(status_code=403, detail="Access denied")

        # Get results
        results = get_results_by_job(job_id)

        return results

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get results: {str(e)}")


@router.get("/jobs/{job_id}/download")
async def download_csv(
    job_id: str,
    current_user: dict = Depends(get_current_user)
):
    """
    Download CSV file for a completed job

    - Returns CSV file
    """
    try:
        # Check if user owns this job
        job = get_job_by_id(job_id)

        if not job:
            raise HTTPException(status_code=404, detail="Job not found")

        if job["started_by"] != current_user["id"]:
            raise HTTPException(status_code=403, detail="Access denied")

        # Check if job is completed
        if job["status"] != "completed":
            raise HTTPException(status_code=400, detail="Job not completed yet")

        # Check if CSV exists
        csv_path = job.get("csv_file_path")

        if not csv_path or not os.path.exists(csv_path):
            raise HTTPException(status_code=404, detail="CSV file not found")

        # Return file
        return FileResponse(
            path=csv_path,
            filename=f"leads_{job_id}.csv",
            media_type="text/csv"
        )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to download CSV: {str(e)}")


@router.get("/jobs/{job_id}/download-verified")
async def download_verified_csv(
    job_id: str,
    current_user: dict = Depends(get_current_user)
):
    """
    Download verified leads CSV file for a completed job

    - Returns filtered CSV with only verified leads (MX record check, executive title)
    - Format: EMAIL, FIRSTNAME, LASTNAME, COMPANY, JOB_TITLE, INDUSTRY, PHONE, VERIFICATION_SCORE
    """
    try:
        # Check if user owns this job
        job = get_job_by_id(job_id)

        if not job:
            raise HTTPException(status_code=404, detail="Job not found")

        if job["started_by"] != current_user["id"]:
            raise HTTPException(status_code=403, detail="Access denied")

        # Check if job is completed
        if job["status"] != "completed":
            raise HTTPException(status_code=400, detail="Job not completed yet")

        # Check if verified CSV exists (try new path first, then legacy brevo path)
        verified_csv_path = job.get("verified_csv_file_path") or job.get("brevo_csv_file_path")

        if not verified_csv_path or not os.path.exists(verified_csv_path):
            raise HTTPException(status_code=404, detail="Verified leads CSV file not found")

        # Return file
        return FileResponse(
            path=verified_csv_path,
            filename=f"verified_leads_{job_id}.csv",
            media_type="text/csv"
        )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to download verified CSV: {str(e)}")


# Legacy endpoint for backwards compatibility
@router.get("/jobs/{job_id}/download-brevo")
async def download_brevo_csv_legacy(
    job_id: str,
    current_user: dict = Depends(get_current_user)
):
    """
    Legacy endpoint - redirects to download-verified

    Kept for backwards compatibility with existing integrations
    """
    return await download_verified_csv(job_id, current_user)
