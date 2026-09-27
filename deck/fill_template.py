"""
Fill the official CURIOUSPARC 2026 template with FlowCare content.

Nothing is redrawn: the template's own shapes, groups, colours and fonts are
kept, and only the text inside specific textboxes is replaced. Content comes
only from flowcare/docs/pitch-fact-sheet.md.
"""
import copy
from pptx import Presentation

SRC = "template.pptx"
OUT = "FlowCare-CuriousParc-2026.pptx"


def set_text(shape, lines):
    """Replace a textbox's text, keeping each paragraph's own formatting."""
    if isinstance(lines, str):
        lines = [lines]
    tf = shape.text_frame
    body = tf._txBody
    tmpl = tf.paragraphs[-1]._p
    while len(tf.paragraphs) < len(lines):
        body.append(copy.deepcopy(tmpl))
    while len(tf.paragraphs) > len(lines):
        body.remove(tf.paragraphs[-1]._p)
    for para, line in zip(tf.paragraphs, lines):
        runs = para.runs
        if not runs:
            continue
        runs[0].text = line
        for r in runs[1:]:
            r._r.getparent().remove(r._r)


prs = Presentation(SRC)
S = list(prs.slides)


def shapes_by_id(slide):
    return {sh.shape_id: sh for sh in slide.shapes}


CONTENT = {
    # ---------------------------------------------------------- 01 cover
    1: {
        22: "FlowCare",
        23: "Find a hospital you can actually get an appointment at — and see "
            "where every fact on the screen came from.",
    },

    # ------------------------------------- 02 problem statement & gaps
    2: {
        5: "Four findings from published studies — every figure graded and "
           "sourced. Three widely-quoted industry stats were excluded.",
        23: "Hospital information fails at the moment it matters. A review "
            "of 10,504 directory listings found 48.7% had at least one "
            "inaccuracy, and a secret-shopper study obtained an appointment "
            "only 18% of the time. Patients still travel on a phone number "
            "nobody has checked, to a department that may not take their "
            "case, on a day that may already be full.",
        32: "People choosing a hospital for planned outpatient care, and the "
            "family members who do it on their behalf — often for a parent, "
            "from another city. Pune first: 60 real hospitals are already "
            "seeded. Hospital staff are users too. They get somewhere to "
            "publish their own charges, timings and access details, and to "
            "date-stamp them, instead of letting a directory guess.",
        41: "Discovery has moved to the phone, and AI assistants now answer "
            "health questions with unsourced confidence. The physical gap "
            "has not closed: in a study of 45 patients, 91% could not reach "
            "their destination inside a hospital from signage alone. And 40 "
            "to 80% of what a clinician says is forgotten immediately, so "
            "people travel with instructions already incomplete.",
        50: "Directories show a fact with no origin and no date. Ratings get "
            "blended into one number, although they correlate poorly below "
            "about 15 reviews and a third of listings have none. Opening "
            "hours are presented as availability. Accessibility is claimed "
            "rather than audited: a PwD-led audit of 35 government hospitals "
            "scored accessible toilets at 4%.",
    },

    # --------------------------------------- 03 solution & key features
    3: {
        5: "One sentence, then the four things FlowCare actually does.",
        16: "We solve unreliable hospital information by dating and sourcing "
            "every fact, so patients can choose a hospital with confidence.",
        21: "Search, compare and request an appointment in one flow, on a phone.",
        26: "Plain-language assistant that proposes; you confirm before "
            "anything is booked.",
        31: "Every fact carries its source, its verifier and the date checked.",
        36: "60 Pune hospitals from OpenStreetMap; a new city is an import, "
            "not a rebuild.",
        40: [
            "Discovery — search, map, compare side by side, no ranking",
            "Provenance — source, verifier and date on every single fact",
            "Assistant — it proposes, you confirm; the model never writes",
            "Care partner — scoped, expiring, revocable read-only access",
        ],
        42: "Fewer wasted trips: you can see what is verified, what has gone "
            "stale, and whether an appointment is actually possible.",
    },

    # ------------------------------------------ 04 technology & innovation
    4: {
        5: "How the system works, and the part that is hard to copy.",
        17: "Plain language, or the ordinary filters",
        22: "Zod validates, then Postgres is queried",
        27: "Extracts intent only, never SQL",
        32: "A proposal you confirm, then a request",
        36: [
            "Next.js 15 App Router · TypeScript · Tailwind",
            "Route handlers proxy Google Places and the AI providers",
            "Supabase Postgres — 40 tables, RLS on every one of them",
            "Writes go through SECURITY DEFINER functions, never tables",
            "Zod validation · Vitest · Vercel, Mumbai region",
            "341 tests passing, 75 of them against the real database",
        ],
        40: "Directories show facts with no origin and no date. FlowCare "
            "stores provenance per field, each with its own expiry, so stale "
            "data gets labelled, not hidden — and no trust score papers over "
            "it. The AI proposes; only a human confirmation writes.",
        41: "Hard to copy: provenance lives in the schema, not in the UI.",
    },

    # ---------------------------------------- 05 prototype / demo & status
    5: {
        5: "What already works today, and what does not.",
        17: "SEARCH",
        22: "COMPARE",
        27: "CONFIRM",
        32: "TRACK",
        35: "PROTOTYPE — RUNS LOCALLY, TESTED, NOT YET DEPLOYED",
        36: "[Paste screenshot: hospital profile]",
        37: "Use one real screenshot from the running app — never a mock-up or a redraw.",
    },

    # --------------------------------------------------- 06 roadmap & impact
    6: {
        5: "Where this goes next, and what it would take.",
        18: "Built and tested locally — 341 tests, none skipped",
        23: "Deploy, move discovery onto the live database",
        28: "One Pune hospital verifying and dating its own facts",
        33: "More cities — adding one is an import, not a rebuild",
        37: [
            "Fewer wasted trips: every fact is dated and sourced",
            "Families can help without sharing a login or a history",
            "Nothing measured yet — zero patients have used it",
        ],
        41: [
            "Technical: built and tested; deploying is a Vercel push",
            "Cost: free tiers, and users can bring their own AI key",
            "Data: OpenStreetMap under ODbL; Google terms respected",
            "Blocker: the discovery layer still reads demo data",
        ],
    },

    # --------------------------------------------------- 07 team & partners
    7: {
        5: "The people behind FlowCare, and the challenge's official partners.",
        29: "Roles to show: Product • Engineering • Data & AI • Design • Research",
    },

    # -------------------------------------------------------- 08 thank you
    8: {
        6: "FlowCare",
        7: "Every fact shows where it came from — so nobody chooses blind.",
    },
}

for sn, items in CONTENT.items():
    by_id = shapes_by_id(S[sn - 1])
    for sid, text in items.items():
        if sid not in by_id:
            raise SystemExit(f"slide {sn}: no shape id {sid}")
        set_text(by_id[sid], text)

prs.save(OUT)
print("saved", OUT, "-", len(prs.slides._sldIdLst), "slides")
