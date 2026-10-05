# Ops scripts — outreach automation

These scripts run the outreach pipeline outside the web app. They are meant to be
executed by **host cron**: each run copies the script into the `backend` container
(`docker compose cp`) and executes it there with `PYTHONPATH=/app`, so the scripts use
the app's own modules for the database and Gmail tokens. They contain no secrets.
`ops/` is the canonical location of these scripts in this repository.

| Script | Example schedule (host cron, UTC) | What it does |
|---|---|---|
| `run_senders.py` | `0 1 * * *` | Multi-brand launcher: starts one `smart_sender.py` process per active brand with sending enabled (`brands.sender.sending_enabled`), in parallel, each with its own `BRAND_ID`. Copy it next to `smart_sender.py`. |
| `smart_sender.py` | (started by `run_senders.py`) | Paced warmup sender for ONE brand (`BRAND_ID`; unset = brand 1). Prefers an active campaign (AI-personalized or A/B variants, per segment), else the template drip over `SEGMENTS` (brand 1 only, disabled with `AI_ONLY=1`). Daily cap, one email every `MIN_GAP`–`MAX_GAP` seconds, business hours only (`START_HOUR`–`END_HOUR`, `TZ_OFFSET_HOURS`, default UTC+8), self-balances across personas, MX-verifies before sending, UTM-tags links. Idempotent. `SEND=0` is a dry run. |
| `bounce_handler.py` | `0 12 * * *` | For every active brand with a mailbox: scans the inbox for hard bounces, marks `sent_emails` bounced, excludes the address and adds it to `global_suppression`. `APPLY=1` to write. |
| `reply_handler.py` | `0 */2 * * *` | For every active brand with a mailbox: matches inbound messages to `sent_emails` by `gmail_thread_id`, records `email_replies` and sets `replied_at`/`status='replied'`. Skips the brand's own addresses and mailer-daemon. `APPLY=1` to write; notifies `NOTIFY_TO` / `brands.sender.reply_notify_to`. |
| `ai_preview.py` | manual | Generates (does not send) AI intro emails for a `SEGMENT` so you can review the copy. |
| `multibrand_rollback.sh` | manual | Restores a pre-upgrade database dump and checks out the previous release. |

See `docs/MULTIBRAND.md` for the per-brand settings (`brands.sender`) these scripts read.

## Example crontab

```cron
# sender (all brands)
0 1 * * *    cd /path/to/utilizereach && docker compose cp ops/smart_sender.py backend:/tmp/smart_sender.py && docker compose cp ops/run_senders.py backend:/tmp/run_senders.py && docker compose exec -T -e SEND=1 -e DAILY_CAP=20 -e ALERT_TO=alerts@example.com -e PYTHONPATH=/app backend python /tmp/run_senders.py >> /var/log/utilizereach/sender.log 2>&1
# bounces + replies
0 12 * * *   cd /path/to/utilizereach && docker compose cp ops/bounce_handler.py backend:/tmp/bounce_handler.py && docker compose exec -T -e APPLY=1 -e PYTHONPATH=/app backend python /tmp/bounce_handler.py >> /var/log/utilizereach/bounces.log 2>&1
0 */2 * * *  cd /path/to/utilizereach && docker compose cp ops/reply_handler.py backend:/tmp/reply_handler.py && docker compose exec -T -e APPLY=1 -e NOTIFY_TO=alerts@example.com -e PYTHONPATH=/app backend python /tmp/reply_handler.py >> /var/log/utilizereach/replies.log 2>&1
```

Do not delete the sender lock files (`/tmp/smart_sender_<slug>.lock`) before a run:
they are `flock` locks and are released automatically when a run exits.

## Editing a shared crontab safely
If the host crontab also holds other jobs, never edit it with
`crontab -l | ... | crontab -` (a mid-pipe failure wipes everything). Instead:
`crontab -l > /tmp/ct.txt`, check it is non-empty, edit the file, then `crontab /tmp/ct.txt`.
