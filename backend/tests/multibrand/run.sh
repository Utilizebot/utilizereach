#!/usr/bin/env bash
# Run the multi-brand isolation suite inside the backend image (host network,
# so 127.0.0.1 reaches the local API and the test Postgres).
#
#   tests/multibrand/run.sh                    # pytest if available (installed on the fly), else plain runner
#   MB_RUNNER=plain tests/multibrand/run.sh -x # force the no-pytest runner, stop at first failing check
#   MB_IMAGE=utilizereach-backend:latest MB_API=http://127.0.0.1:8000 tests/multibrand/run.sh
#
# Extra arguments go to pytest (or run_isolation.py). All MB_* variables are
# passed through (see README.md).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND="$(cd "$HERE/../.." && pwd)"
IMAGE="${MB_IMAGE:-mb-backend:base}"
MODE="${MB_RUNNER:-auto}"   # auto | pytest | plain

exec docker run --rm --network host --user "$(id -u):$(id -g)" \
  -e HOME=/tmp -e PYTHONDONTWRITEBYTECODE=1 \
  -e MB_API -e MB_OWNER_DSN -e MB_APP_DSN -e MB_TIMEOUT -e MB_STRICT -e MB_KEEP_FIXTURES \
  -e MB_REPORT -e MB_JWT_SECRET -e MB_TEST_PASSWORD -e MB_BRAND_CACHE_WAIT -e MB_BRAND1_SLUG \
  -v "$BACKEND":/app -w /app --entrypoint sh "$IMAGE" -c '
    mode="$0"
    if [ "$mode" != plain ] && ! python -c "import pytest" 2>/dev/null; then
      pip install -q --disable-pip-version-check --target /tmp/mbpy pytest >/dev/null 2>&1 || true
      export PYTHONPATH="/tmp/mbpy${PYTHONPATH:+:$PYTHONPATH}"
    fi
    if [ "$mode" != plain ] && python -c "import pytest" 2>/dev/null; then
      exec python -m pytest tests/multibrand -q -p no:cacheprovider "$@"
    fi
    [ "$mode" = pytest ] && { echo "pytest unavailable" >&2; exit 2; }
    exec python tests/multibrand/run_isolation.py "$@"
  ' "$MODE" "$@"
