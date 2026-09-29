"""Capture the deck screenshots from a running FlowCare instance.

Start the app first, then run this. Output lands in deck/screens/, which is
what add_brand_and_screens.py reads. Every image in the deck comes from here
rather than from a mock-up.
"""
import os
import re

from playwright.sync_api import sync_playwright

B = os.environ.get("FLOWCARE_BASE_URL", "http://127.0.0.1:3000")
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "screens")
DESK = {"width": 1440, "height": 900}
MOB  = {"width": 390, "height": 844}

SHOTS = [
    ("/",                    "01-landing.png",        None,      DESK, False),
    ("/",                    "01b-landing-full.png",  None,      DESK, True),
    ("/get-started",         "02-role-choice.png",    None,      DESK, False),
    ("/patient/signup",      "03-patient-signup.png", None,      DESK, False),
    ("/staff/register",      "04-staff-register.png", None,      DESK, False),
    ("/patient/login",       "05-patient-login.png",  None,      DESK, False),
    ("/patient",             "06-patient-dash.png",   "patient", DESK, False),
    ("/hospitals",           "07-discovery.png",      "patient", DESK, False),
    ("/hospitals/baner-ridge-multispecialty", "08-hospital-detail.png","patient", DESK, False),
    ("/appointments/new",    "09-booking.png",        "patient", DESK, False),
    ("/appointments",        "10-appointments.png",   "patient", DESK, False),
    ("/assistant",           "11-assistant.png",      "patient", DESK, False),
    ("/care",                "12-care.png",           "patient", DESK, False),
    ("/staff",               "13-staff-dash.png",     "admin",   DESK, False),
    ("/staff/queue",         "14-staff-queue.png",    "admin",   DESK, False),
    ("/staff/appointments",  "15-staff-appts.png",    "admin",   DESK, False),
    ("/staff/team",          "16-staff-team.png",     "admin",   DESK, False),
    ("/",                    "17-landing-mobile.png", None,      MOB,  False),
    ("/patient",             "18-patient-mobile.png", "patient", MOB,  False),
    ("/get-started",         "19-role-mobile.png",    None,      MOB,  False),
]

with sync_playwright() as p:
    br = p.chromium.launch(args=["--no-sandbox","--disable-gpu","--disable-dev-shm-usage"])

    # discover a real hospital id
    c = br.new_context(viewport=DESK)
    c.add_cookies([{"name":"fc_demo_user","value":"patient","url":B}])
    pg = c.new_page(); pg.goto(B+"/hospitals", wait_until="networkidle", timeout=60000)
    hrefs = pg.eval_on_selector_all("a[href^='/hospitals/']", "els=>els.map(e=>e.getAttribute('href'))")
    hosp = next((h for h in hrefs if re.match(r"^/hospitals/[^/?#]+$", h or "")), None)
    print("hospital detail ->", hosp)
    c.close()

    for path, name, acct, vp, full in SHOTS:
        if path == "__HOSPITAL__":
            if not hosp: print("SKIP hospital detail"); continue
            path = hosp
        ctx = br.new_context(viewport=vp, device_scale_factor=2)
        if acct:
            ctx.add_cookies([{"name":"fc_demo_user","value":acct,"url":B}])
        pg = ctx.new_page()
        try:
            r = pg.goto(B+path, wait_until="networkidle", timeout=60000)
            st = r.status if r else "?"
        except Exception as e:
            print("WARN", path, str(e)[:80])
            r = pg.goto(B+path, wait_until="domcontentloaded", timeout=60000); st = r.status if r else "?"
        pg.wait_for_timeout(2000)
        pg.screenshot(path=os.path.join(OUT, name), full_page=full)
        print(f"  {st}  {name}  <- {path}")
        ctx.close()
    br.close()
print("DONE")
