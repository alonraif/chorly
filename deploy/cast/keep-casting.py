"""Keeps a web page up on a Nest Hub during the day. The Hub drops casts by itself, so this puts it back."""
import json
import os
import subprocess
import sys
import time
from datetime import datetime

HUB_IP = os.environ.get("HUB_IP", "")
DISPLAY_URL = os.environ.get("DISPLAY_URL", "")
CAST_FROM = os.environ.get("CAST_FROM", "07:00")
CAST_UNTIL = os.environ.get("CAST_UNTIL", "21:00")
CHECK_SECONDS = 30
COMMAND_TIMEOUT = 30
OUR_APP = "DashCast"
# Backdrop is the Hub's ambient screen. Anything else is someone using it, so it's left alone.
IDLE_APPS = (None, "", "Backdrop")


def catt(*args):
    result = subprocess.run(
        ["catt", "-d", HUB_IP, *args],
        capture_output=True,
        text=True,
        timeout=COMMAND_TIMEOUT,
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or f"catt {args[0]} failed")
    return result.stdout


def running_app():
    info = json.loads(catt("info", "-j"))
    # catt exits cleanly with {} when it can't reach the Hub, which must not read as idle.
    if not info:
        raise RuntimeError(f"Can't reach the Hub at {HUB_IP}")
    return info.get("display_name")


def in_hours(now):
    # Zero-padded HH:MM compares correctly as text.
    return CAST_FROM <= now.strftime("%H:%M") < CAST_UNTIL


def check():
    app = running_app()
    if in_hours(datetime.now()):
        if app in IDLE_APPS:
            print(f"{datetime.now():%H:%M} idle, casting the board", flush=True)
            catt("cast_site", DISPLAY_URL)
    elif app == OUR_APP:
        print(f"{datetime.now():%H:%M} outside hours, taking the board down", flush=True)
        catt("stop")


def main():
    if not HUB_IP or not DISPLAY_URL:
        sys.exit("Set HUB_IP and DISPLAY_URL in .env")
    print(f"Casting to {HUB_IP} from {CAST_FROM} to {CAST_UNTIL}", flush=True)
    while True:
        try:
            check()
        except (RuntimeError, ValueError, subprocess.TimeoutExpired) as err:
            print(f"{datetime.now():%H:%M} {err}", flush=True)
        time.sleep(CHECK_SECONDS)


main()
