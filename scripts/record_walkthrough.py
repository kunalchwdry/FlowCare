"""
Records the FlowCare walkthrough against a running server, with each scene
held for exactly as long as its narration clip, so picture and voice line up
without post-hoc stretching.

Everything filmed is the real application: the facility record is read live
from the Supabase project, and the one simulated part (appointment slots for
the two rows the database itself labels [TEST]) is disclosed on screen by the
banner in every frame.

    export LD_LIBRARY_PATH=/home/user/.cache/chromedeps/root/usr/lib/x86_64-linux-gnu:\
/home/user/.cache/chromedeps/root/lib/x86_64-linux-gnu
    python3 scripts/record_walkthrough.py
"""
import re
import sys
import time
from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:3000"
OUT = "/home/user/deck/video/raw"
W, H = 1440, 900
TEST_HOSPITAL = "e593813b-f278-4d6f-a5fe-f127716cb7a2"

# Seconds each scene must last: the duration of its voice-over clip, plus a
# small tail so the next line does not start on a hard cut.
SCENES = {
    "intro": 18.2,
    "search": 19.0,
    "profile": 16.4,
    "compare": 12.6,
    "assistant": 18.0,
    "booking": 11.5,
    "receipt": 19.7,
}

_t0 = None
_budget = 0.0


def start(page):
    global _t0
    _t0 = time.monotonic()


def end_scene(page, name):
    """Idle until this scene has consumed its full narration budget."""
    global _budget
    _budget += SCENES[name]
    remaining = _budget - (time.monotonic() - _t0)
    while remaining > 0:
        page.wait_for_timeout(min(400, int(remaining * 1000)))
        remaining = _budget - (time.monotonic() - _t0)


def glide(page, total=700, step=110, pause=90):
    moved = 0
    while moved < total:
        page.mouse.wheel(0, step)
        page.wait_for_timeout(pause)
        moved += step


def main():
    with sync_playwright() as pw:
        browser = pw.chromium.launch(
            args=["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"]
        )
        ctx = browser.new_context(
            viewport={"width": W, "height": H},
            record_video_dir=OUT,
            record_video_size={"width": W, "height": H},
        )
        p = ctx.new_page()

        # ---- 1. Discover + the provenance banner -------------------------
        p.goto(f"{BASE}/hospitals", wait_until="networkidle")
        start(p)
        p.wait_for_timeout(4200)
        glide(p, total=320, step=80, pause=110)
        p.wait_for_timeout(1500)
        p.mouse.wheel(0, -400)
        p.wait_for_timeout(1200)
        p.locator("header select").first.select_option(label="Patient")
        p.wait_for_timeout(2600)
        end_scene(p, "intro")

        # ---- 2. Searching the live record --------------------------------
        box = p.locator("input[type='search'], input[placeholder*='earch']").first
        box.click()
        box.type("Aditya", delay=190)
        p.wait_for_timeout(3600)
        box.fill("")
        p.wait_for_timeout(800)
        box.type("cardiology", delay=165)
        p.wait_for_timeout(3600)
        box.fill("")
        p.wait_for_timeout(1400)
        end_scene(p, "search")

        # ---- 3. A real hospital profile ----------------------------------
        p.goto(f"{BASE}/hospitals", wait_until="networkidle")
        p.wait_for_timeout(900)
        p.locator("a[href^='/hospitals/']").filter(
            has_text=re.compile("Hospital", re.I)
        ).first.click()
        p.wait_for_load_state("networkidle")
        p.wait_for_timeout(1800)
        glide(p, total=1600, step=120, pause=105)
        p.wait_for_timeout(1400)
        glide(p, total=1500, step=120, pause=105)
        end_scene(p, "profile")

        # ---- 4. Compare, as a table and not a leaderboard ----------------
        p.goto(f"{BASE}/hospitals", wait_until="networkidle")
        p.wait_for_timeout(700)
        toggles = p.locator("button[aria-label^='Add ']")
        for i in range(min(3, toggles.count())):
            toggles.nth(i).click()
            p.wait_for_timeout(520)
        p.goto(f"{BASE}/hospitals/compare", wait_until="networkidle")
        p.wait_for_timeout(2600)
        glide(p, total=650, step=110, pause=100)
        end_scene(p, "compare")

        # ---- 5. The assistant and its evidence trail ---------------------
        p.goto(f"{BASE}/assistant", wait_until="networkidle")
        p.wait_for_timeout(1300)
        ta = p.locator("textarea, input[type='text']").first
        if ta.count():
            ta.click()
            ta.type("cardiology hospital in Baner with wheelchair access", delay=62)
            p.wait_for_timeout(900)
            btn = p.get_by_role("button", name=re.compile("ask|search|find", re.I)).first
            if btn.count():
                btn.click()
                p.wait_for_timeout(3000)
                glide(p, total=900, step=120, pause=100)
        end_scene(p, "assistant")

        # ---- 6. Booking that completes -----------------------------------
        p.goto(f"{BASE}/appointments/new?hospital={TEST_HOSPITAL}", wait_until="networkidle")
        p.wait_for_timeout(2300)
        p.get_by_role("button", name=re.compile("^Request ")).first.click()
        p.wait_for_timeout(1300)
        reason = p.locator("input[id^='reason-']").first
        reason.click()
        reason.type("follow-up on last month's visit", delay=68)
        p.wait_for_timeout(1500)
        end_scene(p, "booking")

        # ---- 7. Requested, not confirmed ---------------------------------
        p.get_by_role("button", name="Request this slot").click()
        p.wait_for_url(re.compile(r"/appointments/apt-"), timeout=20000)
        p.wait_for_timeout(3600)
        glide(p, total=450, step=110, pause=105)
        p.wait_for_timeout(2000)
        p.goto(f"{BASE}/appointments", wait_until="networkidle")
        p.wait_for_timeout(4200)
        p.goto(f"{BASE}/hospitals/saved", wait_until="networkidle")
        p.wait_for_timeout(2600)
        end_scene(p, "receipt")

        video = p.video.path() if p.video else None
        ctx.close()
        browser.close()
        print(video or "no video captured")


if __name__ == "__main__":
    sys.exit(main())
