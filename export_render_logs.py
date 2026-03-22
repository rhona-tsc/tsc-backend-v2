import os
import json
import time
import urllib.request
import urllib.parse
import urllib.error
import sys

api_key = os.environ.get("RENDER_API_KEY")
service_id = os.environ.get("SERVICE_ID")
owner_id = os.environ.get("OWNER_ID")
start_time = os.environ.get("START")
end_time = os.environ.get("END")

missing = [k for k, v in {
    "RENDER_API_KEY": api_key,
    "SERVICE_ID": service_id,
    "OWNER_ID": owner_id,
    "START": start_time,
    "END": end_time,
}.items() if not v]

if missing:
    print("Missing env vars:", ", ".join(missing))
    sys.exit(1)

all_logs = []
page = 1

def pick_message(log):
    for key in ("message", "msg", "text"):
        value = log.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return json.dumps(log, ensure_ascii=False)

while True:
    params = urllib.parse.urlencode({
        "ownerId": owner_id,
        "resource": service_id,
        "startTime": start_time,
        "endTime": end_time,
        "direction": "backward",
        "limit": 500,
    })

    url = f"https://api.render.com/v1/logs?{params}"
    req = urllib.request.Request(
        url,
        headers={
            "Accept": "application/json",
            "Authorization": f"Bearer {api_key}",
        },
    )

    for attempt in range(8):
        try:
            with urllib.request.urlopen(req) as resp:
                data = json.loads(resp.read().decode("utf-8"))
            break
        except urllib.error.HTTPError as e:
            if e.code == 429:
                wait = min(60, 5 * (attempt + 1))
                print(f"Rate limited on page {page}. Waiting {wait}s...")
                time.sleep(wait)
                continue
            raise
    else:
        raise RuntimeError(f"Failed after repeated retries on page {page}")

    logs = data.get("logs", [])
    all_logs.extend(logs)
    print(f"Fetched page {page}: {len(logs)} logs")

    with open("render-logs-progress.json", "w", encoding="utf-8") as f:
        json.dump(all_logs, f, indent=2, ensure_ascii=False)

    with open("render-logs-progress.txt", "w", encoding="utf-8") as f:
        for log in all_logs:
            ts = log.get("timestamp", "")
            level = log.get("level", "")
            source = log.get("source", "")
            message = pick_message(log).replace("\r", "")
            f.write(f"[{ts}] [{level}] [{source}] {message}\n")

    if not data.get("hasMore"):
        break

    start_time = data.get("nextStartTime")
    end_time = data.get("nextEndTime")
    page += 1

with open("render-logs-last-3-days.json", "w", encoding="utf-8") as f:
    json.dump(all_logs, f, indent=2, ensure_ascii=False)

with open("render-logs-last-3-days.txt", "w", encoding="utf-8") as f:
    for log in all_logs:
        ts = log.get("timestamp", "")
        level = log.get("level", "")
        source = log.get("source", "")
        message = pick_message(log).replace("\r", "")
        f.write(f"[{ts}] [{level}] [{source}] {message}\n")

print(f"\nSaved {len(all_logs)} total logs")
print("Created:")
print(" - render-logs-progress.json")
print(" - render-logs-progress.txt")
print(" - render-logs-last-3-days.json")
print(" - render-logs-last-3-days.txt")
