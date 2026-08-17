#!/bin/bash

# ============================================
# Marketing AI - Deployment Script
# ============================================
# Usage: ./deploy.sh [command]
# Commands: setup, start, stop, restart, logs, ssl
# ============================================

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
PROJECT_NAME="marketing_ai"
DOMAIN="${DOMAIN:-your-domain.com}"

echo_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

echo_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

echo_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if Docker is installed
check_docker() {
    if ! command -v docker &> /dev/null; then
        echo_error "Docker is not installed. Please install Docker first."
        exit 1
    fi
    if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
        echo_error "Docker Compose is not installed. Please install Docker Compose first."
        exit 1
    fi
}

# Setup environment
setup() {
    echo_info "Setting up deployment environment..."

    # Create necessary directories
    mkdir -p nginx/ssl
    mkdir -p certbot/www
    mkdir -p certbot/conf
    mkdir -p backend/storage/csv_files

    # Check if .env exists in backend
    if [ ! -f "backend/.env" ]; then
        echo_warn "backend/.env not found. Creating from template..."
        if [ -f "backend/.env.example" ]; then
            cp backend/.env.example backend/.env
            echo_warn "Please edit backend/.env with your actual values!"
        else
            echo_error "No .env.example found. Please create backend/.env manually."
        fi
    fi

    # Check if .gmail_tokens exists
    if [ ! -f "backend/.gmail_tokens" ]; then
        echo_warn "backend/.gmail_tokens not found. Gmail integration may not work."
        echo_warn "Copy your .gmail_tokens file to backend/.gmail_tokens"
    fi

    echo_info "Setup complete!"
}

# Start services
start() {
    echo_info "Starting all services..."
    # Use production compose file to ensure correct env vars
    docker compose -f docker-compose.yml -f docker-compose.production.yml up -d --build
    docker restart marketing_nginx 2>/dev/null || true
    echo_info "Services started!"
    echo_info "Frontend: http://$DOMAIN"
    echo_info "Backend API: http://$DOMAIN/api"
    echo_info "API Docs: http://$DOMAIN/api/docs"
}

# Stop services
stop() {
    echo_info "Stopping all services..."
    docker compose down
    echo_info "Services stopped!"
}

# Restart services
restart() {
    echo_info "Restarting all services..."
    docker compose down
    # Use production compose file to ensure correct env vars
    docker compose -f docker-compose.yml -f docker-compose.production.yml up -d --build
    docker restart marketing_nginx 2>/dev/null || true
    echo_info "Services restarted!"
}

# View logs
logs() {
    SERVICE=${1:-""}
    if [ -z "$SERVICE" ]; then
        docker compose logs -f
    else
        docker compose logs -f "$SERVICE"
    fi
}

# Setup SSL with Let's Encrypt
ssl() {
    echo_info "Setting up SSL certificate for $DOMAIN..."

    # Stop nginx temporarily
    docker compose stop nginx

    # Get certificate
    docker compose run --rm certbot certonly \
        --webroot \
        --webroot-path=/var/www/certbot \
        -d "$DOMAIN" \
        -d "www.$DOMAIN" \
        --email "admin@$DOMAIN" \
        --agree-tos \
        --no-eff-email

    # Restart nginx
    docker compose start nginx

    echo_info "SSL certificate installed!"
    echo_warn "Remember to uncomment HTTPS section in nginx/nginx.conf"
}

# Renew SSL certificate
ssl_renew() {
    echo_info "Renewing SSL certificate..."
    docker compose run --rm certbot renew
    docker compose exec nginx nginx -s reload
    echo_info "SSL certificate renewed!"
}

# Show status
status() {
    echo_info "Service status:"
    docker compose ps
}

# Main command handler
case "${1:-help}" in
    setup)
        check_docker
        setup
        ;;
    start)
        check_docker
        start
        ;;
    stop)
        check_docker
        stop
        ;;
    restart)
        check_docker
        restart
        ;;
    logs)
        check_docker
        logs "$2"
        ;;
    ssl)
        check_docker
        ssl
        ;;
    ssl-renew)
        check_docker
        ssl_renew
        ;;
    status)
        check_docker
        status
        ;;
    *)
        echo "Marketing AI Deployment Script"
        echo ""
        echo "Usage: ./deploy.sh [command]"
        echo ""
        echo "Commands:"
        echo "  setup      - Initial setup (create directories, check files)"
        echo "  start      - Start all services"
        echo "  stop       - Stop all services"
        echo "  restart    - Restart all services"
        echo "  logs       - View logs (optionally specify service: logs backend)"
        echo "  ssl        - Setup SSL certificate with Let's Encrypt"
        echo "  ssl-renew  - Renew SSL certificate"
        echo "  status     - Show service status"
        echo ""
        echo "Environment variables:"
        echo "  DOMAIN     - Your domain name (default: your-domain.com)"
        echo ""
        echo "Example:"
        echo "  DOMAIN=myapp.com ./deploy.sh start"
        ;;
esac
