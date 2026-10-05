"""Launch one smart_sender process per brand (multi-brand cron entry point).

Lists the ACTIVE brands whose brands.sender.sending_enabled is true (brand 1
defaults to true, every other brand to false until enabled), then starts
    [python -u <this dir>/smart_sender.py]   with env BRAND_ID=<brand id>
for each of them IN PARALLEL (inheriting the rest of the environment: SEND,
DAILY_CAP, MIN_GAP ...). Every child output line is prefixed with [slug].
Waits for all of them and exits non-zero if any child failed.

Env (besides what the senders read):
  ONLY_BRANDS   optional comma-separated slugs/ids to restrict the run. In a
                dry run (SEND!=1) a brand named here is run even when it is
                not sending-enabled yet, so a new brand can be rehearsed.
  SEND          passed through to the senders (SEND=0 = dry run)

Cron copies this file AND smart_sender.py into the same directory of the
backend container and runs this one (PYTHONPATH=/app).
"""
import os, sys, signal, subprocess, threading

sys.path.insert(0, "/app")
from database import brands as brandcat

HERE = os.path.dirname(os.path.abspath(__file__))
SENDER = os.path.join(HERE, "smart_sender.py")
_print_lock = threading.Lock()


def _out(line):
    with _print_lock:
        sys.stdout.write(line if line.endswith("\n") else line + "\n")
        sys.stdout.flush()


def _truthy(v):
    return v if isinstance(v, bool) else str(v).strip().lower() in ("1", "true", "yes", "on")


def sending_enabled(brand):
    """brands.sender.sending_enabled; default true for brand 1, false otherwise."""
    return _truthy(brandcat.sender_value(brand, "sending_enabled", None, brandcat.is_default_brand(brand)))


def brands_to_run():
    dry = os.getenv("SEND", "0") != "1"
    only = {x.strip().lower() for x in (os.getenv("ONLY_BRANDS") or "").split(",") if x.strip()}
    picked = []
    for b in brandcat.list_brands(active_only=True):
        if only and b["slug"].lower() not in only and str(b["id"]).lower() not in only:
            continue
        if sending_enabled(b) or (dry and only):
            picked.append(b)
        else:
            _out(f"[launcher] skip '{b['slug']}': sending disabled (brands.sender.sending_enabled)")
    return picked


def _pump(proc, slug):
    for raw in iter(proc.stdout.readline, b""):
        _out(f"[{slug}] " + raw.decode("utf-8", "replace").rstrip("\n"))
    proc.stdout.close()


def main():
    if not os.path.isfile(SENDER):
        _out(f"[launcher] smart_sender.py not found next to run_senders.py ({SENDER})")
        return 2
    brands = brands_to_run()
    if not brands:
        _out("[launcher] no active brand with sending enabled — nothing to do")
        return 0
    _out(f"[launcher] starting {len(brands)} sender(s): " + ", ".join(b["slug"] for b in brands))

    children = []   # (slug, proc, pump thread)
    for b in brands:
        env = dict(os.environ)
        env["BRAND_ID"] = str(b["id"])
        env["PYTHONUNBUFFERED"] = "1"
        proc = subprocess.Popen([sys.executable, "-u", SENDER], env=env, cwd=HERE,
                                stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        t = threading.Thread(target=_pump, args=(proc, b["slug"]), daemon=True)
        t.start()
        children.append((b["slug"], proc, t))

    def _forward(signum, _frame):
        for _slug, p, _t in children:
            if p.poll() is None:
                try:
                    p.send_signal(signum)
                except OSError:
                    pass
    signal.signal(signal.SIGTERM, _forward)
    signal.signal(signal.SIGINT, _forward)

    failed = []
    for slug, proc, t in children:
        rc = proc.wait()
        t.join(timeout=10)
        _out(f"[launcher] '{slug}' exited with code {rc}")
        if rc != 0:
            failed.append(slug)
    if failed:
        _out(f"[launcher] FAILED: {', '.join(failed)}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
