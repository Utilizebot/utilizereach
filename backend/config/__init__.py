"""
Configuration module for Marketing AI backend
Loads team and company configuration from JSON files
"""

import os
import json
from pathlib import Path
from typing import List, Dict, Any

# Default team config path
CONFIG_DIR = Path(__file__).parent
TEAM_CONFIG_FILE = CONFIG_DIR / "team_config.json"


def load_team_config() -> Dict[str, Any]:
    """
    Load team configuration from JSON file

    Returns:
        Dict containing company info and email team members
    """
    config_file = os.getenv("TEAM_CONFIG_FILE", str(TEAM_CONFIG_FILE))

    try:
        with open(config_file, 'r') as f:
            return json.load(f)
    except FileNotFoundError:
        print(f"Warning: Team config file not found at {config_file}, using defaults")
        return get_default_config()
    except json.JSONDecodeError as e:
        print(f"Warning: Invalid JSON in team config file: {e}, using defaults")
        return get_default_config()


def get_default_config() -> Dict[str, Any]:
    """Return default configuration"""
    return {
        "company": {
            "name": "Your Company",
            "website": "https://www.yourcompany.com",
            "industry": "Technology"
        },
        "emailTeam": [
            {
                "email": "sales@yourcompany.com",
                "name": "Sales Team",
                "title": "Sales Representative",
                "persona": "professional and helpful",
                "focus": "customer success"
            }
        ]
    }


def get_email_team() -> List[Dict[str, str]]:
    """
    Get list of email team members

    Returns:
        List of team member dicts with email, name, title, persona, focus
    """
    config = load_team_config()
    return config.get("emailTeam", [])


def get_company_info() -> Dict[str, str]:
    """
    Get company information

    Returns:
        Dict with company name, website, industry
    """
    config = load_team_config()
    return config.get("company", {})


# Cache the config on module load
_cached_config = None

def get_config() -> Dict[str, Any]:
    """Get cached config or load if not cached"""
    global _cached_config
    if _cached_config is None:
        _cached_config = load_team_config()
    return _cached_config


def reload_config():
    """Force reload of config from file"""
    global _cached_config
    _cached_config = load_team_config()
    return _cached_config
