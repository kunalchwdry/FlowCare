# FlowCare — CURIOUSPARC 2026 pitch deck

**Deliverable:** `FlowCare-CuriousParc-2026.pptx` — the **official template**
(`template.pptx`, 8 slides, 20″×11.25″) with FlowCare content typed into it.
Nothing was redrawn: every group, colour, icon, rule and footer from the
template is untouched, and only the text inside specific textboxes changed.

- `fill_template.py` — the content, keyed by slide and shape id. Re-run it
  after editing to regenerate the deck from a clean template.
- `preview.py` — rough PNG render (`preview/slide-NN.png`) for checking
  overflow without PowerPoint. DejaVu substitutes for Aptos, so treat the
  spacing as indicative only.

```
python fill_template.py     # template.pptx -> FlowCare-CuriousParc-2026.pptx
python preview.py           # -> preview/slide-01..08.png
```

## Slide by slide

| # | Template slide | What was filled |
|---|---|---|
| 01 | Cover | `FlowCare` + tagline. Team line left as placeholders. |
| 02 | Problem Statement & Current Gaps | The Problem / Target Users / Why Now? / Current Gaps, each with sourced figures |
| 03 | Our Solution & Key Features | One-sentence banner, Simple/Smart/Practical/Scalable, 4 key features, value for users |
| 04 | Technology & Innovation | Input → Process → Model → Output, tech stack, innovation gap & USP |
| 05 | Prototype / Demo & Status | Demo flow Search → Compare → Confirm → Track; status left on **PROTOTYPE** |
| 06 | Impact, Feasibility & Roadmap | MVP / Testing / Pilot / Scale, impact, feasibility |
| 07 | Team & Partners | Subtitle only — roster placeholders and partner logos left for you |
| 08 | Thank You | Project name and closing line; contact block left as placeholders |

## You still need to fill in

- **Slide 1 and 7:** team name, member names and roles.
- **Slide 5:** replace `[Paste screenshot: hospital profile]` with a **real**
  screenshot from the running app — not a mock-up.
- **Slide 7 and 8:** swap the partner text placeholders for the supplied logo
  files (the template says to).
- **Slide 8:** team email, phone, demo link / QR, repository link.

## Two judgement calls worth knowing

- **Status marker left on PROTOTYPE** (slide 5), not MVP. It is built and
  tested locally, but it is not deployed and nobody has used it, so PROTOTYPE
  is the honest rung. Move it if you disagree — but then the roadmap on slide
  6 needs to move with it.
- **No user, revenue or impact numbers anywhere.** Slide 6 says plainly that
  nothing has been measured and zero patients have used it. That is per the
  do-not-claim list in `flowcare/docs/pitch-fact-sheet.md`.

## Content sourcing

Every claim comes from `flowcare/docs/pitch-fact-sheet.md`, which is sourced
from `flowcare/docs/research/sources.md` (S01–S73, each graded with URL, date
and limitation). The figures used: 48.7% of 10,504 directory listings
inaccurate (S01), appointment obtained 18% of the time (S03), 91% could not
navigate by signage (S19), ratings correlate poorly below ~15 reviews
(S62–S64). Three widely-quoted industry statistics were excluded for having no
primary source, and slide 2 says so.
