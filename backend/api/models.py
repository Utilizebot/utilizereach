"""
Pydantic Models for API

Request/Response models for type validation
"""

from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime


# Request Models

class StartScrapingJobRequest(BaseModel):
    """Request to start a new scraping job"""
    search_query: str = Field(..., min_length=3, description="Search query for lead generation")
    location: str = Field(..., description="Target location/country code")
    num_queries: int = Field(10, ge=5, le=20, description="Number of search queries to generate")
    industry: Optional[str] = Field(None, description="Optional industry filter")


# Response Models

class ScrapingJobResponse(BaseModel):
    """Response for a scraping job"""
    id: str
    job_name: str
    search_query: str
    location: str
    num_queries: int
    industry: Optional[str] = None
    status: str  # Required, cannot be None
    progress: int = 0
    current_step: Optional[str] = None
    leads_found: int = 0  # Total raw leads found
    brevo_ready_count: int = 0  # Number of Brevo-ready leads (filtered)
    csv_file_path: Optional[str] = None  # Raw CSV file path
    brevo_csv_file_path: Optional[str] = None  # Brevo-ready CSV file path
    error_message: Optional[str] = None
    started_at: Optional[datetime] = None
    completed_at: Optional[str] = None
    created_at: Optional[datetime] = None
    celery_task_id: Optional[str] = None

    class Config:
        from_attributes = True
        # Allow population by field name or alias
        populate_by_name = True


class StartJobResponse(BaseModel):
    """Response after starting a job"""
    job_id: str
    status: str
    message: str


class JobListResponse(BaseModel):
    """List of jobs with pagination"""
    jobs: List[ScrapingJobResponse]
    total: int
    limit: int
    offset: int


class LeadResult(BaseModel):
    """Individual lead result"""
    id: str
    company_name: Optional[str]
    decision_maker_name: Optional[str]
    decision_maker_title: Optional[str]
    email: Optional[str]
    phone: Optional[str]
    source_url: Optional[str]
    url_score: Optional[int]
    is_executive: bool
    created_at: datetime

    class Config:
        from_attributes = True


class ProgressUpdate(BaseModel):
    """Progress update for WebSocket"""
    progress: int
    current_step: str
    total_leads_found: int
