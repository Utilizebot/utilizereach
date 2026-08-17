"""
CSV Generator

Generate CSV files from scraping results
Supports both Raw CSV and Verified Leads CSV formats
"""

import os
import csv
from typing import List, Dict, Any
from pathlib import Path
from utils.email_verifier import is_quality_lead, format_verified_lead


def generate_csv_from_results(job_id: str, results: List[Dict[str, Any]]) -> str:
    """
    Generate CSV file from scraping results

    Args:
        job_id: Job UUID
        results: List of result dictionaries

    Returns:
        Path to generated CSV file
    """
    # Create storage directory if it doesn't exist
    storage_path = os.getenv("CSV_STORAGE_PATH", "./storage/csv_files")
    Path(storage_path).mkdir(parents=True, exist_ok=True)

    # Generate filename
    filename = f"leads_{job_id}.csv"
    filepath = os.path.join(storage_path, filename)

    # CSV headers
    headers = [
        "Company Name",
        "Contact Name",
        "Contact Title",
        "Email",
        "Phone",
        "Source URL",
        "Relevance Score",
    ]

    # Write CSV
    with open(filepath, "w", newline="", encoding="utf-8") as csvfile:
        writer = csv.DictWriter(
            csvfile,
            fieldnames=[
                "company_name",
                "decision_maker_name",
                "decision_maker_title",
                "email",
                "phone",
                "source_url",
                "url_score",
            ],
        )

        # Write header with display names
        csvfile.write(",".join(headers) + "\n")

        # Write data
        for result in results:
            writer.writerow(
                {
                    "company_name": result.get("company_name") or "",
                    "decision_maker_name": result.get("decision_maker_name") or "",
                    "decision_maker_title": result.get("decision_maker_title") or "",
                    "email": result.get("email") or "",
                    "phone": result.get("phone") or "",
                    "source_url": result.get("source_url") or "",
                    "url_score": result.get("url_score") or result.get("relevance_score") or "",
                }
            )

    return filepath


def get_csv_filepath(job_id: str) -> str:
    """
    Get CSV filepath for a job

    Args:
        job_id: Job UUID

    Returns:
        Expected filepath
    """
    storage_path = os.getenv("CSV_STORAGE_PATH", "./storage/csv_files")
    filename = f"leads_{job_id}.csv"
    return os.path.join(storage_path, filename)


def initialize_csv_file(job_id: str) -> str:
    """
    Initialize CSV file with headers (for progressive writing)

    Args:
        job_id: Job UUID

    Returns:
        Path to CSV file
    """
    storage_path = os.getenv("CSV_STORAGE_PATH", "./storage/csv_files")
    Path(storage_path).mkdir(parents=True, exist_ok=True)

    filename = f"leads_{job_id}.csv"
    filepath = os.path.join(storage_path, filename)

    # Write headers only
    headers = [
        "Company Name",
        "Contact Name",
        "Contact Title",
        "Email",
        "Phone",
        "Source URL",
        "Relevance Score",
    ]

    with open(filepath, "w", newline="", encoding="utf-8") as csvfile:
        csvfile.write(",".join(headers) + "\n")

    return filepath


def append_leads_to_csv(job_id: str, leads: List[Dict[str, Any]]) -> None:
    """
    Append leads to existing CSV file (progressive writing)

    Args:
        job_id: Job UUID
        leads: List of lead dictionaries to append
    """
    filepath = get_csv_filepath(job_id)

    # Append to existing file
    with open(filepath, "a", newline="", encoding="utf-8") as csvfile:
        writer = csv.DictWriter(
            csvfile,
            fieldnames=[
                "company_name",
                "decision_maker_name",
                "decision_maker_title",
                "email",
                "phone",
                "source_url",
                "url_score",
            ],
        )

        # Write data rows
        for lead in leads:
            writer.writerow(
                {
                    "company_name": lead.get("company") or "",
                    "decision_maker_name": lead.get("name") or "",
                    "decision_maker_title": lead.get("title") or "",
                    "email": lead.get("email") or "",
                    "phone": lead.get("phone") or "",
                    "source_url": lead.get("url") or "",
                    "url_score": lead.get("score") or "",
                }
            )


# ==================== VERIFIED LEADS CSV FUNCTIONS ====================


def get_verified_csv_filepath(job_id: str) -> str:
    """
    Get verified leads CSV filepath for a job

    Args:
        job_id: Job UUID

    Returns:
        Expected filepath for verified leads CSV
    """
    storage_path = os.getenv("CSV_STORAGE_PATH", "./storage/csv_files")
    filename = f"verified_leads_{job_id}.csv"
    return os.path.join(storage_path, filename)


def initialize_verified_csv_file(job_id: str) -> str:
    """
    Initialize verified leads CSV file with headers (for progressive writing)

    Format: EMAIL, FIRSTNAME, LASTNAME, COMPANY, JOB_TITLE, INDUSTRY, PHONE, VERIFICATION_SCORE

    Args:
        job_id: Job UUID

    Returns:
        Path to verified leads CSV file
    """
    storage_path = os.getenv("CSV_STORAGE_PATH", "./storage/csv_files")
    Path(storage_path).mkdir(parents=True, exist_ok=True)

    filename = f"verified_leads_{job_id}.csv"
    filepath = os.path.join(storage_path, filename)

    # Verified leads CSV headers
    headers = ["EMAIL", "FIRSTNAME", "LASTNAME", "COMPANY", "JOB_TITLE", "INDUSTRY", "PHONE", "VERIFICATION_SCORE"]

    with open(filepath, "w", newline="", encoding="utf-8") as csvfile:
        csvfile.write(",".join(headers) + "\n")

    return filepath


def append_leads_to_verified_csv(job_id: str, leads: List[Dict[str, Any]], verify_mx: bool = True) -> int:
    """
    Append verified leads to verified CSV file (progressive writing)

    Filters leads to only include verified ones:
    - Valid email format
    - MX record exists (domain can receive email)
    - Not generic email (info@, sales@, etc.)
    - Not disposable email
    - Has executive/decision maker title

    Args:
        job_id: Job UUID
        leads: List of lead dictionaries to filter and append
        verify_mx: Whether to check MX records (slower but more accurate)

    Returns:
        Number of verified leads appended
    """
    filepath = get_verified_csv_filepath(job_id)
    verified_count = 0

    # Convert leads to normalized format and verify
    verified_leads = []
    for lead in leads:
        # Normalize lead format for verification
        normalized_lead = {
            'email': lead.get('email'),
            'company_name': lead.get('company'),
            'contact_title': lead.get('title'),
            'contact_name': lead.get('name'),
            'decision_maker_title': lead.get('title'),
            'decision_maker_name': lead.get('name'),
            'phone': lead.get('phone'),
            'is_executive': False,  # Will be determined by title
        }

        # Check if lead is quality (verified)
        is_quality, verification_result = is_quality_lead(normalized_lead, verify_mx=verify_mx)

        if is_quality:
            # Add verification score to lead
            normalized_lead['verification_score'] = verification_result.get('verification_score', 0)
            # Format for export
            formatted_lead = format_verified_lead(normalized_lead)
            verified_leads.append(formatted_lead)

    # Append to existing file
    if verified_leads:
        with open(filepath, "a", newline="", encoding="utf-8") as csvfile:
            writer = csv.DictWriter(
                csvfile,
                fieldnames=["EMAIL", "FIRSTNAME", "LASTNAME", "COMPANY", "JOB_TITLE", "INDUSTRY", "PHONE", "VERIFICATION_SCORE"],
            )

            # Write data rows
            for lead in verified_leads:
                writer.writerow(lead)
                verified_count += 1

    return verified_count


# ==================== LEGACY ALIASES (for backwards compatibility) ====================

# Keep old function names as aliases during transition
def get_brevo_csv_filepath(job_id: str) -> str:
    """Alias for get_verified_csv_filepath (backwards compatibility)"""
    return get_verified_csv_filepath(job_id)


def initialize_brevo_csv_file(job_id: str) -> str:
    """Alias for initialize_verified_csv_file (backwards compatibility)"""
    return initialize_verified_csv_file(job_id)


def append_leads_to_brevo_csv(job_id: str, leads: List[Dict[str, Any]]) -> int:
    """Alias for append_leads_to_verified_csv (backwards compatibility)"""
    return append_leads_to_verified_csv(job_id, leads, verify_mx=True)
