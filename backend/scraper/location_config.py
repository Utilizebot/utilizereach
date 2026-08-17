"""
Location Configuration System for Flexible Lead Scraper
Allows scraping in any country/region by providing location-specific settings
"""

from dataclasses import dataclass, field
from typing import List, Dict
import re


@dataclass
class LocationConfig:
    """Configuration for a specific geographic location"""

    # Basic identifiers
    name: str  # Display name (e.g., "Malaysia", "Singapore", "United Kingdom")
    country_code: str  # ISO country code for SerpAPI (e.g., "my", "sg", "gb", "us")

    # SerpAPI parameters
    language: str = "en"  # Language code (e.g., "en", "zh", "ms")
    google_domain: str = "google.com"  # Google domain to use

    # Location-specific data
    major_cities: List[str] = field(default_factory=list)  # List of major cities/locations
    domain_extensions: List[str] = field(default_factory=list)  # Country TLDs (e.g., [".my", ".com.my"])
    business_suffixes: List[str] = field(default_factory=list)  # Legal entity types (e.g., ["Sdn Bhd", "Ltd"])

    # Phone number regex pattern for this region
    phone_pattern: str = r'\+?\d{1,4}[-\s]?\d{1,4}[-\s]?\d{3,4}[-\s]?\d{4}'

    # Contact page keywords in local language
    contact_keywords: List[str] = field(default_factory=lambda: ['contact', 'about', 'team'])

    def __post_init__(self):
        """Normalize data after initialization"""
        # Convert all lists to lowercase for case-insensitive matching
        self.major_cities = [city.lower() for city in self.major_cities]
        self.domain_extensions = [ext.lower() for ext in self.domain_extensions]
        self.business_suffixes = [suffix.lower() for suffix in self.business_suffixes]
        self.contact_keywords = [keyword.lower() for keyword in self.contact_keywords]

    def get_serpapi_params(self) -> Dict[str, str]:
        """Get SerpAPI parameters for this location"""
        return {
            "gl": self.country_code,
            "hl": self.language,
            "location": self.name,
            "google_domain": self.google_domain
        }

    def is_local_domain(self, url: str) -> bool:
        """Check if URL is from this location's domains"""
        url_lower = url.lower()
        return any(domain in url_lower for domain in self.domain_extensions)

    def has_location_indicator(self, text: str) -> bool:
        """Check if text contains indicators of this location"""
        text_lower = text.lower()

        # Check for location name
        if self.name.lower() in text_lower:
            return True

        # Check for major cities
        if any(city in text_lower for city in self.major_cities):
            return True

        # Check for business suffixes
        if any(suffix in text_lower for suffix in self.business_suffixes):
            return True

        return False

    def get_phone_regex(self) -> re.Pattern:
        """Get compiled regex pattern for phone numbers"""
        return re.compile(self.phone_pattern)


# ==============================================================================
# PRESET LOCATION CONFIGURATIONS
# ==============================================================================

def get_malaysia_config() -> LocationConfig:
    """Malaysia-specific configuration (original default)"""
    return LocationConfig(
        name="Malaysia",
        country_code="my",
        language="en",
        google_domain="google.com.my",
        major_cities=[
            'kuala lumpur', 'kl', 'selangor', 'penang', 'pulau pinang',
            'johor', 'johor bahru', 'jb', 'melaka', 'malacca',
            'perak', 'ipoh', 'pahang', 'kuantan', 'kelantan', 'kota bharu',
            'terengganu', 'kuala terengganu', 'sabah', 'kota kinabalu',
            'sarawak', 'kuching', 'putrajaya', 'cyberjaya', 'labuan',
            'petaling jaya', 'pj', 'shah alam', 'subang jaya',
            'klang', 'georgetown', 'butterworth', 'muar', 'batu pahat',
            'skudai', 'iskandar puteri', 'nusajaya', 'senai'
        ],
        domain_extensions=['.my', '.com.my', '.net.my', '.org.my', '.edu.my'],
        business_suffixes=['sdn bhd', 'berhad', 'sendirian berhad'],
        phone_pattern=r'(\+?60[-\s]?)?(\d{1,2}[-\s]?)?\d{3,4}[-\s]?\d{4}',
        contact_keywords=['contact', 'about', 'team', 'hubungi', 'hubungi kami']
    )


def get_singapore_config() -> LocationConfig:
    """Singapore-specific configuration"""
    return LocationConfig(
        name="Singapore",
        country_code="sg",
        language="en",
        google_domain="google.com.sg",
        major_cities=[
            'singapore', 'central', 'raffles place', 'marina bay',
            'orchard', 'jurong', 'woodlands', 'tampines', 'punggol',
            'sentosa', 'changi', 'tuas', 'sembawang', 'yishun'
        ],
        domain_extensions=['.sg', '.com.sg', '.edu.sg', '.org.sg'],
        business_suffixes=['pte ltd', 'private limited', 'ltd', 'llp'],
        phone_pattern=r'(\+?65[-\s]?)?\d{4}[-\s]?\d{4}',
        contact_keywords=['contact', 'about', 'team', 'enquiry', 'enquiries']
    )


def get_uk_config() -> LocationConfig:
    """United Kingdom configuration"""
    return LocationConfig(
        name="United Kingdom",
        country_code="gb",
        language="en",
        google_domain="google.co.uk",
        major_cities=[
            'london', 'manchester', 'birmingham', 'leeds', 'glasgow',
            'edinburgh', 'liverpool', 'bristol', 'sheffield', 'newcastle',
            'nottingham', 'southampton', 'leicester', 'coventry', 'belfast',
            'cardiff', 'bradford', 'brighton', 'plymouth', 'reading'
        ],
        domain_extensions=['.uk', '.co.uk', '.org.uk', '.ac.uk'],
        business_suffixes=['ltd', 'limited', 'plc', 'llp', 'llc'],
        phone_pattern=r'(\+?44[-\s]?)?(\(0\)\s?)?[\d\s]{10,13}',
        contact_keywords=['contact', 'about', 'team', 'get in touch']
    )


def get_us_config() -> LocationConfig:
    """United States configuration"""
    return LocationConfig(
        name="United States",
        country_code="us",
        language="en",
        google_domain="google.com",
        major_cities=[
            'new york', 'los angeles', 'chicago', 'houston', 'phoenix',
            'philadelphia', 'san antonio', 'san diego', 'dallas', 'san jose',
            'austin', 'jacksonville', 'fort worth', 'columbus', 'charlotte',
            'san francisco', 'indianapolis', 'seattle', 'denver', 'boston',
            'portland', 'detroit', 'memphis', 'nashville', 'baltimore'
        ],
        domain_extensions=['.us'],  # Note: Most US sites use .com which is global
        business_suffixes=['inc', 'corp', 'llc', 'ltd', 'co'],
        phone_pattern=r'(\+?1[-\s]?)?(\(\d{3}\)|\d{3})[-\s]?\d{3}[-\s]?\d{4}',
        contact_keywords=['contact', 'about', 'team', 'reach us']
    )


def get_germany_config() -> LocationConfig:
    """Germany configuration"""
    return LocationConfig(
        name="Germany",
        country_code="de",
        language="de",
        google_domain="google.de",
        major_cities=[
            'berlin', 'hamburg', 'munich', 'münchen', 'cologne', 'köln',
            'frankfurt', 'stuttgart', 'düsseldorf', 'dortmund', 'essen',
            'leipzig', 'bremen', 'dresden', 'hannover', 'nuremberg',
            'duisburg', 'bochum', 'wuppertal', 'bielefeld', 'bonn'
        ],
        domain_extensions=['.de'],
        business_suffixes=['gmbh', 'ag', 'kg', 'ohg', 'gbr', 'ug'],
        phone_pattern=r'(\+?49[-\s]?)?(\(0\))?[\d\s]{10,14}',
        contact_keywords=['kontakt', 'über uns', 'team', 'impressum']
    )


def get_australia_config() -> LocationConfig:
    """Australia configuration"""
    return LocationConfig(
        name="Australia",
        country_code="au",
        language="en",
        google_domain="google.com.au",
        major_cities=[
            'sydney', 'melbourne', 'brisbane', 'perth', 'adelaide',
            'gold coast', 'newcastle', 'canberra', 'sunshine coast',
            'wollongong', 'hobart', 'geelong', 'townsville', 'cairns'
        ],
        domain_extensions=['.au', '.com.au', '.net.au', '.org.au'],
        business_suffixes=['pty ltd', 'limited', 'ltd', 'pty'],
        phone_pattern=r'(\+?61[-\s]?)?(\(0\))?[\d\s]{9,12}',
        contact_keywords=['contact', 'about', 'team', 'get in touch']
    )


def get_global_config() -> LocationConfig:
    """Global configuration (no geo-targeting)"""
    return LocationConfig(
        name="Global",
        country_code="",  # Empty = no geo restriction
        language="en",
        google_domain="google.com",
        major_cities=[],  # No specific cities
        domain_extensions=['.com', '.net', '.org', '.io'],
        business_suffixes=['inc', 'ltd', 'llc', 'corp', 'gmbh', 'pte ltd'],
        phone_pattern=r'\+?\d{1,4}[-\s]?\d{1,4}[-\s]?\d{3,4}[-\s]?\d{4}',
        contact_keywords=['contact', 'about', 'team']
    )


def get_canada_config() -> LocationConfig:
    """Canada configuration"""
    return LocationConfig(
        name="Canada",
        country_code="ca",
        language="en",
        google_domain="google.ca",
        major_cities=[
            'toronto', 'montreal', 'vancouver', 'calgary', 'edmonton',
            'ottawa', 'winnipeg', 'quebec city', 'hamilton', 'kitchener'
        ],
        domain_extensions=['.ca'],
        business_suffixes=['inc', 'ltd', 'corp', 'llc'],
        phone_pattern=r'(\+?1[-\s]?)?(\(\d{3}\)|\d{3})[-\s]?\d{3}[-\s]?\d{4}',
        contact_keywords=['contact', 'about', 'team']
    )


def get_france_config() -> LocationConfig:
    """France configuration"""
    return LocationConfig(
        name="France",
        country_code="fr",
        language="fr",
        google_domain="google.fr",
        major_cities=[
            'paris', 'marseille', 'lyon', 'toulouse', 'nice',
            'nantes', 'strasbourg', 'montpellier', 'bordeaux', 'lille'
        ],
        domain_extensions=['.fr'],
        business_suffixes=['sarl', 'sas', 'sa', 'eurl'],
        phone_pattern=r'(\+?33[-\s]?)?(\(0\))?[\d\s]{9,11}',
        contact_keywords=['contact', 'à propos', 'équipe']
    )


def get_spain_config() -> LocationConfig:
    """Spain configuration"""
    return LocationConfig(
        name="Spain",
        country_code="es",
        language="es",
        google_domain="google.es",
        major_cities=[
            'madrid', 'barcelona', 'valencia', 'seville', 'zaragoza',
            'málaga', 'murcia', 'palma', 'bilbao', 'alicante'
        ],
        domain_extensions=['.es'],
        business_suffixes=['sl', 'sa', 'slu'],
        phone_pattern=r'(\+?34[-\s]?)?[\d\s]{9,11}',
        contact_keywords=['contacto', 'acerca de', 'equipo']
    )


def get_italy_config() -> LocationConfig:
    """Italy configuration"""
    return LocationConfig(
        name="Italy",
        country_code="it",
        language="it",
        google_domain="google.it",
        major_cities=[
            'rome', 'milan', 'naples', 'turin', 'palermo',
            'genoa', 'bologna', 'florence', 'bari', 'venice'
        ],
        domain_extensions=['.it'],
        business_suffixes=['srl', 'spa', 'snc', 'sas'],
        phone_pattern=r'(\+?39[-\s]?)?[\d\s]{9,12}',
        contact_keywords=['contatti', 'chi siamo', 'team']
    )


def get_netherlands_config() -> LocationConfig:
    """Netherlands configuration"""
    return LocationConfig(
        name="Netherlands",
        country_code="nl",
        language="nl",
        google_domain="google.nl",
        major_cities=[
            'amsterdam', 'rotterdam', 'the hague', 'utrecht', 'eindhoven',
            'tilburg', 'groningen', 'almere', 'breda', 'nijmegen'
        ],
        domain_extensions=['.nl'],
        business_suffixes=['bv', 'nv', 'vof'],
        phone_pattern=r'(\+?31[-\s]?)?(\(0\))?[\d\s]{9,11}',
        contact_keywords=['contact', 'over ons', 'team']
    )


def get_uae_config() -> LocationConfig:
    """United Arab Emirates configuration"""
    return LocationConfig(
        name="United Arab Emirates",
        country_code="ae",
        language="en",
        google_domain="google.ae",
        major_cities=[
            'dubai', 'abu dhabi', 'sharjah', 'ajman', 'ras al khaimah',
            'fujairah', 'umm al quwain', 'al ain'
        ],
        domain_extensions=['.ae', '.co.ae'],
        business_suffixes=['llc', 'fze', 'fz-llc', 'pjsc'],
        phone_pattern=r'(\+?971[-\s]?)?[\d\s]{9,11}',
        contact_keywords=['contact', 'about', 'team']
    )


def get_india_config() -> LocationConfig:
    """India configuration"""
    return LocationConfig(
        name="India",
        country_code="in",
        language="en",
        google_domain="google.co.in",
        major_cities=[
            'mumbai', 'delhi', 'bangalore', 'hyderabad', 'chennai',
            'kolkata', 'pune', 'ahmedabad', 'jaipur', 'surat'
        ],
        domain_extensions=['.in', '.co.in'],
        business_suffixes=['pvt ltd', 'limited', 'llp'],
        phone_pattern=r'(\+?91[-\s]?)?[\d\s]{10,12}',
        contact_keywords=['contact', 'about', 'team']
    )


def get_china_config() -> LocationConfig:
    """China configuration"""
    return LocationConfig(
        name="China",
        country_code="cn",
        language="zh",
        google_domain="google.com",  # Note: Google not available in China, but for reference
        major_cities=[
            'beijing', 'shanghai', 'guangzhou', 'shenzhen', 'chengdu',
            'hangzhou', 'wuhan', 'xi\'an', 'tianjin', 'nanjing'
        ],
        domain_extensions=['.cn', '.com.cn'],
        business_suffixes=['ltd', 'co ltd'],
        phone_pattern=r'(\+?86[-\s]?)?[\d\s]{11,13}',
        contact_keywords=['contact', '联系', '关于']
    )


def get_japan_config() -> LocationConfig:
    """Japan configuration"""
    return LocationConfig(
        name="Japan",
        country_code="jp",
        language="ja",
        google_domain="google.co.jp",
        major_cities=[
            'tokyo', 'osaka', 'yokohama', 'nagoya', 'sapporo',
            'fukuoka', 'kobe', 'kyoto', 'kawasaki', 'hiroshima'
        ],
        domain_extensions=['.jp', '.co.jp'],
        business_suffixes=['kk', 'gk', 'yk'],  # 株式会社, 合同会社, etc.
        phone_pattern=r'(\+?81[-\s]?)?(\(0\))?[\d\s-]{10,13}',
        contact_keywords=['contact', '連絡先', 'お問い合わせ']
    )


def get_south_korea_config() -> LocationConfig:
    """South Korea configuration"""
    return LocationConfig(
        name="South Korea",
        country_code="kr",
        language="ko",
        google_domain="google.co.kr",
        major_cities=[
            'seoul', 'busan', 'incheon', 'daegu', 'daejeon',
            'gwangju', 'suwon', 'ulsan', 'changwon', 'seongnam'
        ],
        domain_extensions=['.kr', '.co.kr'],
        business_suffixes=['co ltd', 'inc'],
        phone_pattern=r'(\+?82[-\s]?)?(\(0\))?[\d\s-]{9,12}',
        contact_keywords=['contact', '연락처', '회사소개']
    )


def get_thailand_config() -> LocationConfig:
    """Thailand configuration"""
    return LocationConfig(
        name="Thailand",
        country_code="th",
        language="th",
        google_domain="google.co.th",
        major_cities=[
            'bangkok', 'chiang mai', 'pattaya', 'phuket', 'nakhon ratchasima',
            'hat yai', 'udon thani', 'surat thani', 'khon kaen', 'nakhon si thammarat'
        ],
        domain_extensions=['.th', '.co.th'],
        business_suffixes=['co ltd', 'limited'],
        phone_pattern=r'(\+?66[-\s]?)?[\d\s-]{9,11}',
        contact_keywords=['contact', 'ติดต่อ', 'เกี่ยวกับ']
    )


def get_indonesia_config() -> LocationConfig:
    """Indonesia configuration"""
    return LocationConfig(
        name="Indonesia",
        country_code="id",
        language="id",
        google_domain="google.co.id",
        major_cities=[
            'jakarta', 'surabaya', 'bandung', 'medan', 'semarang',
            'makassar', 'palembang', 'tangerang', 'depok', 'bekasi'
        ],
        domain_extensions=['.id', '.co.id'],
        business_suffixes=['pt', 'cv', 'tbk'],
        phone_pattern=r'(\+?62[-\s]?)?[\d\s-]{9,12}',
        contact_keywords=['contact', 'kontak', 'tentang']
    )


def get_philippines_config() -> LocationConfig:
    """Philippines configuration"""
    return LocationConfig(
        name="Philippines",
        country_code="ph",
        language="en",
        google_domain="google.com.ph",
        major_cities=[
            'manila', 'quezon city', 'davao', 'cebu', 'zamboanga',
            'antipolo', 'pasig', 'taguig', 'cagayan de oro', 'makati'
        ],
        domain_extensions=['.ph', '.com.ph'],
        business_suffixes=['inc', 'corp', 'co'],
        phone_pattern=r'(\+?63[-\s]?)?[\d\s-]{10,12}',
        contact_keywords=['contact', 'about', 'team']
    )


def get_vietnam_config() -> LocationConfig:
    """Vietnam configuration"""
    return LocationConfig(
        name="Vietnam",
        country_code="vn",
        language="vi",
        google_domain="google.com.vn",
        major_cities=[
            'ho chi minh city', 'hanoi', 'da nang', 'hai phong', 'can tho',
            'bien hoa', 'vung tau', 'nha trang', 'hue', 'buon ma thuot'
        ],
        domain_extensions=['.vn', '.com.vn'],
        business_suffixes=['jsc', 'llc', 'co ltd'],
        phone_pattern=r'(\+?84[-\s]?)?[\d\s-]{9,11}',
        contact_keywords=['contact', 'liên hệ', 'về chúng tôi']
    )


def get_new_zealand_config() -> LocationConfig:
    """New Zealand configuration"""
    return LocationConfig(
        name="New Zealand",
        country_code="nz",
        language="en",
        google_domain="google.co.nz",
        major_cities=[
            'auckland', 'wellington', 'christchurch', 'hamilton', 'tauranga',
            'napier', 'dunedin', 'palmerston north', 'nelson', 'rotorua'
        ],
        domain_extensions=['.nz', '.co.nz'],
        business_suffixes=['ltd', 'limited', 'llp'],
        phone_pattern=r'(\+?64[-\s]?)?[\d\s-]{9,11}',
        contact_keywords=['contact', 'about', 'team']
    )


def get_brazil_config() -> LocationConfig:
    """Brazil configuration"""
    return LocationConfig(
        name="Brazil",
        country_code="br",
        language="pt",
        google_domain="google.com.br",
        major_cities=[
            'são paulo', 'rio de janeiro', 'brasília', 'salvador', 'fortaleza',
            'belo horizonte', 'manaus', 'curitiba', 'recife', 'porto alegre'
        ],
        domain_extensions=['.br', '.com.br'],
        business_suffixes=['ltda', 'sa', 'eireli'],
        phone_pattern=r'(\+?55[-\s]?)?[\d\s-]{10,12}',
        contact_keywords=['contato', 'sobre', 'equipe']
    )


def get_mexico_config() -> LocationConfig:
    """Mexico configuration"""
    return LocationConfig(
        name="Mexico",
        country_code="mx",
        language="es",
        google_domain="google.com.mx",
        major_cities=[
            'mexico city', 'guadalajara', 'monterrey', 'puebla', 'tijuana',
            'león', 'juárez', 'zapopan', 'mérida', 'san luis potosí'
        ],
        domain_extensions=['.mx', '.com.mx'],
        business_suffixes=['sa de cv', 'srl de cv'],
        phone_pattern=r'(\+?52[-\s]?)?[\d\s-]{10,12}',
        contact_keywords=['contacto', 'acerca de', 'equipo']
    )


# ==============================================================================
# LOCATION REGISTRY
# ==============================================================================

LOCATION_PRESETS = {
    # Asia-Pacific
    'malaysia': get_malaysia_config,
    'singapore': get_singapore_config,
    'australia': get_australia_config,
    'new_zealand': get_new_zealand_config,
    'nz': get_new_zealand_config,
    'india': get_india_config,
    'china': get_china_config,
    'japan': get_japan_config,
    'south_korea': get_south_korea_config,
    'korea': get_south_korea_config,
    'thailand': get_thailand_config,
    'indonesia': get_indonesia_config,
    'philippines': get_philippines_config,
    'vietnam': get_vietnam_config,

    # Europe
    'uk': get_uk_config,
    'united_kingdom': get_uk_config,
    'germany': get_germany_config,
    'deutschland': get_germany_config,
    'france': get_france_config,
    'spain': get_spain_config,
    'italy': get_italy_config,
    'netherlands': get_netherlands_config,
    'holland': get_netherlands_config,

    # Middle East
    'uae': get_uae_config,
    'united_arab_emirates': get_uae_config,
    'dubai': get_uae_config,

    # Americas
    'us': get_us_config,
    'usa': get_us_config,
    'united_states': get_us_config,
    'canada': get_canada_config,
    'brazil': get_brazil_config,
    'mexico': get_mexico_config,

    # Global
    'global': get_global_config,
    'worldwide': get_global_config,
}


def get_location_config(location: str) -> LocationConfig:
    """
    Get location configuration by name

    Args:
        location: Location name (case-insensitive)
                  e.g., "malaysia", "Singapore", "UK", "USA", "global"

    Returns:
        LocationConfig instance

    Raises:
        ValueError: If location is not found
    """
    location_key = location.lower().strip()

    if location_key not in LOCATION_PRESETS:
        available = ', '.join(sorted(set(LOCATION_PRESETS.keys())))
        raise ValueError(
            f"Unknown location: '{location}'. "
            f"Available presets: {available}"
        )

    return LOCATION_PRESETS[location_key]()


def list_available_locations() -> List[str]:
    """Get list of all available location presets"""
    # Return unique location names
    unique_locations = set()
    for key, func in LOCATION_PRESETS.items():
        config = func()
        unique_locations.add(config.name)

    return sorted(unique_locations)
