# FlowCare — Core Differentiating Feature Research

**Research status:** Evidence synthesis completed for an initial design decision.  
**Research date:** 3 October 2026 (Asia/Calcutta).  
**Geographic context supplied by the requester:** Gandharv Serenity / near Villoo Poonawala Hospital / PIN 411028. This was treated as a possible pilot context only. No claim about that locality, hospital, capacity, pricing, or deployment is made without a source.

> **Important scope note:** This report is a research and product-design document, not clinical advice, a market-availability guarantee, or proof that a particular Indian hospital would participate.

---

## Executive conclusion

The strongest evidence-backed direction is not another hospital directory, chatbot, booking form, or electronic record store. It is a **Closed-Loop, Capacity-Aware Care Access Exchange**:

> **A FlowCare system that turns a patient’s care request into a clinically appropriate, capacity-aware shortlist and then tracks the referral/appointment through acknowledgement, booking, arrival, service completion, and follow-up—across participating hospitals—without making the clinical decision itself.**

A simple representation is:

```text
Patient need + clinician/referrer input + patient constraints
        ↓
Capability and safety eligibility checks
        ↓
Live/dated hospital supply: service, slot, queue, cost band, accessibility, travel
        ↓
Explainable constrained shortlist
        ↓
Patient choice / clinician confirmation
        ↓
Referral and booking state machine
        ↓
Acknowledged → booked → reminded → arrived → seen → completed → follow-up closed
        ↓
Operational feedback: demand, capacity, delays, cancellations, unclosed referrals
```

This mechanism is meaningfully different from a normal healthcare app because it treats **the care journey as an operational state that must close**, rather than treating search, booking, and records as disconnected screens. The mechanism has strong international analogues: the NHS e-Referral Service supports provider choice, appointment booking, referral assessment, and worklists for appointment-slot problems; Canadian eConsult systems have been implemented and evaluated across regions; queueing, scheduling, no-show, and patient-flow research supplies the optimization logic. [R15–R16, R12–R14, R1–R10]

The India opportunity is more specific than “India has no digital health.” India has major digital-health infrastructure work, including ABDM’s consent-based, federated record exchange. Indian hospitals and researchers also use appointment systems, queue analysis, telemedicine, and referral programs. The evidence reviewed did **not** verify a national, cross-provider operational layer that combines current capacity, patient choice, referral state, appointment slot issues, queue/arrival state, cost/coverage constraints, and closed-loop follow-up across independent hospitals. This should be described as:

> **“A potentially important workflow-integration and multi-provider adoption gap; no verified national-scale deployment was found in this review.”**

It must not be described as “India has no such system.”

---

# 1. Research method and audit trail

## 1.1 Discovery and screening

A PubMed/MEDLINE screening workflow was run across 15 topic families:

- outpatient appointment scheduling;
- no-show prediction and interventions;
- patient flow and queues;
- hospital capacity and demand forecasting;
- referral coordination and care transitions;
- continuity of care and interoperability;
- patient navigation;
- cost/financial navigation;
- federated and privacy-preserving healthcare AI;
- digital twins and discrete-event simulation;
- FHIR/interoperability;
- dynamic scheduling and overbooking;
- digital/clinical care pathways;
- geographic access and travel burden;
- patient-flow implementation.

The search returned **293 unique PubMed records** after deduplication. A first-pass title/abstract screen marked **198 potentially relevant**, **87 as clinically or technically irrelevant to the mechanisms**, and **8 as background/unclear**. The full machine-readable screening log is saved as:

- [`pubmed_screened_sources.csv`](pubmed_screened_sources.csv)
- [`pubmed_screened_sources.json`](pubmed_screened_sources.json)

The screening log is a discovery audit trail, not a claim that every record was high-quality evidence. Final retention required a stable PubMed/PMCID/DOI/publisher identifier or an official government/institutional source, and a check that the source actually supported the statement used.

## 1.2 Evidence hierarchy used

1. Systematic reviews, umbrella reviews, meta-reviews, and high-quality implementation studies.
2. Prospective or real-world hospital/health-system evaluations.
3. Multicentre studies and validated models.
4. Official government/health-system documentation describing an operational service.
5. Single-site observational studies and research prototypes, used only for mechanism or feasibility—not for general prevalence claims.
6. Commercial material was used, at most, to locate a product or system; marketing claims were not treated as scientific evidence.

## 1.3 India-gap rule

The report distinguishes:

- verified Indian implementation;
- a limited Indian pilot or single-site study;
- a national digital-health building block;
- fragmented or manual workflow;
- no verified deployment found in the screened sources.

“Not found” is not treated as “does not exist.”

---

# 2. What the screened literature repeatedly showed

## 2.1 The recurring problem is not just finding a hospital

The literature repeatedly describes a chain of coupled operational problems:

- demand is variable and difficult to align with staff/resource capacity;
- patients wait at several linked stations, not just at the doctor;
- appointment no-shows and late arrivals distort capacity;
- referrals can be sent without a reliable closed-loop acknowledgement or booking state;
- patient flow interventions fail when they optimize one department while ignoring upstream/downstream constraints;
- records and information remain fragmented even where interoperability standards exist;
- navigation barriers include transport, language, cost, health literacy, and administrative complexity;
- predictive models are not enough unless a hospital workflow can act on the prediction.

A patient-flow review separates machine-learning work into demand forecasting, transfer/resource prediction, treatment-resource prediction, and length-of-stay/discharge prediction. It also argues for both institution-wide and patient-level views rather than one isolated model. [R8] A conceptual patient-flow model similarly warns that interventions which ignore interactions among hospital components provide an incomplete solution. [R9]

## 2.2 Indian evidence is not “nothing exists”

The Indian evidence reviewed includes:

- ABDM’s ABHA, Health Information Exchange–Consent Manager, and federated consent-based exchange architecture. [R18–R20]
- Government referral, telemedicine, NCD screening, and community-level navigation guidance. [R23, R21]
- Indian hospital studies measuring waiting time and patient flow, including a North Indian tertiary emergency outpatient department and studies of Indian hospital OPDs. [R11 and the India implementation references]
- Digital appointment and hospital information systems in particular institutions.

The key gap is therefore not a lack of all digital health. The more defensible gap is **cross-provider workflow integration and operational closure**: the reviewed evidence did not verify a national or broadly adopted service that connects the patient’s choice to current multi-hospital capacity, referral state, appointment-slot exceptions, arrival/queue status, affordability constraints, and follow-up completion.

## 2.3 A caution about AI

Several attractive ideas are actually model classes, not complete systems. A prediction can be accurate and still fail to improve care if:

- the hospital cannot change staffing or slots;
- the appointment inventory is stale;
- the referral has no owner after submission;
- the patient cannot travel or pay;
- the model is not calibrated across hospitals;
- the output is not explained or audited;
- the workflow does not record whether the recommended action occurred.

The strongest FlowCare direction is therefore a **workflow system with bounded analytics**, not an LLM-first product.

---

# 3. Candidate mechanism funnel

The 14 mechanism families below were investigated. Similar names were grouped to avoid counting duplicates as separate innovations.

| Mechanism family | Decision after screening | Reason |
|---|---|---|
| Hospital finder / personalized recommendation | Merge into the core access exchange | Too common as a standalone product; valuable only when tied to dated capacity, constraints, and closed-loop action. |
| Basic appointment booking | Reject as standalone | Common and does not solve stale capacity, referral leakage, or queue coupling. |
| Dynamic appointment scheduling | Retain inside Candidate 1 and Candidate 2 | Strong operations literature; needs hospital data and workflow authority. |
| Predictive wait-time display | Retain inside Candidate 1 | Useful but insufficient without a response mechanism when the prediction changes. |
| Queueing/resource optimization | Retain inside Candidate 1 and Candidate 6 | Strong mechanism evidence; single-department optimization can fail if system constraints are ignored. |
| No-show prediction / overbooking | Candidate 2 | Evidence-backed and prototypeable; safety/equity constraints are essential. |
| Closed-loop referral routing | Candidate 1 | International services show a real workflow pattern; India gap is likely integration/adoption rather than basic technology. |
| eConsult / asynchronous specialist advice | Candidate 1 or a later module | Strong Canadian evidence; must not become unsupervised clinical diagnosis. |
| Patient navigation | Candidate 3 | Strong evidence in cancer and access barriers; broad cross-condition generalization is less certain. |
| Longitudinal records / PHR | Conditional Candidate 7, not the core by itself | ABDM already defines this direction. FlowCare should integrate with it rather than claim it as new. |
| Cost-aware navigation | Candidate 4 | Important in India; data availability and price comparability are major limitations. |
| Federated learning across hospitals | Candidate 5 | Strong technical and multicentre research evidence; high partnership and governance burden. |
| Hospital digital twin / discrete-event simulation | Candidate 6 | Promising operations mechanism; much evidence remains prototype/simulation rather than proven live deployment. |
| Population demand forecasting | Merge into Candidate 1 or Candidate 6 | A component, not a patient-facing core system. |
| Geographic accessibility/travel burden | Merge into Candidate 1 and Candidate 4 | Useful constraint; not sufficiently differentiating alone. |

---

# 4. Comparison matrix: strongest final candidates

This is a trade-off matrix, not an arbitrary numerical ranking.

| Candidate | Evidence | Real-world proof | India situation found | Prototype feasibility | Main differentiator | Main constraint |
|---|---|---|---|---|---|---|
| **1. Closed-Loop, Capacity-Aware Care Access Exchange** | Strong across scheduling, queues, referrals, eConsult, and patient-flow literature | Strong international workflow analogues; NHS e-RS and Canadian eConsult are verified | India has ABDM/referral/telemedicine building blocks and local studies, but no verified national cross-provider operational exchange in this review | High for a simulated multi-hospital MVP; medium for real deployment | Closes the entire access/referral loop instead of only listing or booking | Requires participating hospitals to provide reliable status/capacity events |
| **2. Equity-Safe No-Show and Appointment Resilience Layer** | Strong systematic-review and validation evidence | Prospective predictive overbooking and reminder studies exist | Indian appointment/no-show systems exist, but no verified national equity-aware predictive scheduling deployment found | High with synthetic data | Combines prediction with opt-in recovery, not punitive blocking | Overbooking can harm patients if uncertainty, fairness, and urgent access are mishandled |
| **3. Barrier-Aware Patient Navigation and Task Closure** | Strong for cancer navigation; moderate outside cancer | Multisite and system-wide navigation implementations verified | Human/community navigation exists in public-health guidance; digitized cross-provider closure not verified at national scale | High for a rules/task MVP | Tracks barriers and unresolved tasks, not just messages/reminders | Human staffing, reimbursement, privacy, and role boundaries |
| **4. Cost- and Coverage-Aware Episode Planner** | Moderate; financial navigation evidence is more condition-specific | Financial navigation and cost conversations are implemented in some systems, but a unified multi-hospital engine is less well verified | OOPE remains material; no verified national real-time cross-provider episode-cost planner found in this review | Medium; requires transparent price/coverage data | Makes affordability a first-class constraint alongside time and distance | Prices, insurance benefits, package inclusions, and availability change and may be opaque |
| **5. Privacy-Preserving Multi-Hospital Operations Intelligence** | Strong technical/multicentre FL evidence | EXAM and hospital-network FL studies verify practical collaboration, mainly clinical prediction | No verified Indian multi-hospital federated operations network found in this review | Low-to-medium for a prototype; low for production without partners | Lets hospitals learn network-level patterns without pooling raw records | Governance, heterogeneity, security, validation, and hospital participation |
| **6. Hospital Operations Digital Twin / What-If Sandbox** | Moderate and rapidly growing; many prototypes | Some operational/training implementations verified, but causal live outcome evidence is limited | No verified Indian system-wide hospital digital twin deployment found in this review | Medium for a simulated OPD/queue environment | Lets hospitals test staffing/slot policies before changing live operations | High data/integration burden; most evidence is simulation or prototype |
| **7. Consent-Based Care-Transition Packet on ABDM Rails** | Strong interoperability/consent rationale | ABDM is a verified Indian digital public infrastructure; SMART/FHIR implementations are verified internationally | This is already an Indian national direction, so it is not a clean standalone differentiator | Medium | FlowCare could make the exchanged record operationally useful at a referral/appointment handoff | Novelty is low if it is only a PHR/record viewer; requires ABDM conformance and consent |
| **8. Clinician-Gated eConsult and Referral Assessment Exchange** | Strong systematic-review and regional implementation evidence | Canada and NHS evidence verified | Indian telemedicine/referral programs exist; no verified national specialist eConsult closure layer found in this review | Medium | Reduces unnecessary physical referral and supports referral quality without autonomous diagnosis | Requires clinician participation, remuneration, liability rules, and scope control |

The best candidates are not mutually exclusive. Candidate 1 can contain the safest, most useful subset of Candidates 2–4 and can later use Candidates 5–6 as the intelligence layer.

---

# 5. Candidate 1 — Closed-Loop, Capacity-Aware Care Access Exchange

## 5.1 One-line explanation

FlowCare coordinates a patient’s access journey across participating hospitals using dated capability, capacity, queue, cost, travel, accessibility, and referral-state data, then keeps ownership until the episode reaches a defined terminal state.

## 5.2 Healthcare problem

A normal hospital app often stops at “here are hospitals” or “here are appointment slots.” That leaves several failure modes:

- a service appears available but the slot is stale;
- a referral is sent but no provider acknowledges it;
- the patient cannot find a clinically appropriate alternative when a slot disappears;
- the patient is booked but waits unpredictably because the queue is not visible;
- the appointment is completed but a follow-up/referral is not closed;
- the patient selects a hospital based on distance while cost, accessibility, or capacity makes the choice unrealistic.

The literature on patient flow, queueing, appointment scheduling, and referrals treats these as linked system problems rather than separate app features. Queueing research identifies arrival rate, service rate, and variation in both as important determinants of waiting. [R7] Patient-flow reviews similarly argue that local interventions can miss interactions between components. [R8–R10]

## 5.3 Existing international evidence

### NHS England — e-Referral Service, United Kingdom

NHS England’s official guidance describes a service in which a referral can enter a bookable service or a referral-assessment/triage service. The referring clinician can shortlist appropriate services, the patient can choose, and the provider can accept, redirect, or change the appointment. When no slot is available, the service has an appointment-slot-issue workflow and provider worklist rather than silently ending the journey. [R15–R16]

This is a **real operational service**, not merely a research prototype. The official documentation does not prove that every referral is successful or that FlowCare could reproduce NHS governance; it does verify the workflow pattern.

### Canada — eConsult and closed-loop referral infrastructure

The Champlain BASE eConsult service in Ontario was evaluated in multiple studies and replicated in a new Ontario region. The implementation study reported specialist responses in a median of 1.1 days, with 75% answered within four days in that regional sample; the paper also assessed implementation using RE-AIM. [R13] A systematic review identified 36 worldwide electronic-consultation studies and examined effects on access, costs, and care. [R12] Canada’s official agreements also describe moves toward closed-loop electronic referral and consult services to support surgical/referral wait-time reporting. [C5]

These are not identical to a cross-hospital capacity exchange. They verify pieces of the mechanism: asynchronous specialist advice, referral status, provider communication, and operational wait-time information.

## 5.4 Underlying mechanism

```text
1. Request / referral
   - patient goal, specialty, location, time constraints
   - clinician-supplied priority or referral information where required

2. Eligibility and capability layer
   - hospital offers the service
   - clinician/hospital has accepted the referral type
   - accessibility/language/insurance constraints are represented

3. Supply and state layer
   - slot inventory timestamp
   - estimated queue/wait band
   - referral acknowledgement state
   - provider response deadline
   - cancellation / reschedule / slot-issue state

4. Constrained choice layer
   - show several feasible options, not an opaque one-shot ranking
   - explain which constraints each option satisfies
   - never infer a diagnosis or clinical urgency autonomously

5. Closed-loop orchestration
   - submit / acknowledge / request-more-information / accept / redirect
   - patient chooses or clinician confirms
   - book / reschedule / cancel
   - check-in / queue state / completion / follow-up task

6. Feedback layer
   - measure stale slot rate, referral age, time-to-acknowledge,
     time-to-book, abandonment, wait variance, no-show, and closure rate
```

The differentiating object is a **care-access state machine** and an auditable, consented operational graph—not a chatbot answer.

## 5.5 Research evidence

### Queueing for healthcare — Palvannan and Teow, 2012, *Journal of Medical Systems*

- **Identifier:** PMID 20703697; DOI 10.1007/s10916-010-9499-7.
- **Finding used:** Explains how patient demand, service rate, and variation affect queues and waiting.
- **FlowCare relevance:** The engine should display uncertainty and manage capacity, not only sort hospitals by distance.

### Machine learning in patient flow: a review — El-Bouri et al., 2021, *Progress in Biomedical Engineering*

- **Identifier:** PMID 34738074.
- **Finding used:** Organizes patient-flow ML into demand, transfers, resource requirements, and length-of-stay/discharge prediction; emphasizes both whole-institution and patient-level views.
- **FlowCare relevance:** Supports a layered architecture rather than a single “wait-time model.”

### Patient Flow Within Hospitals: A Conceptual Model — Leviner and Debbie, 2020, *Nursing Science Quarterly*

- **Identifier:** PMID 31795886; DOI 10.1177/0894318419881981.
- **Finding used:** Argues that flow interventions must consider interactions among hospital components.
- **FlowCare relevance:** A multi-hospital exchange should not optimize an outpatient slot while ignoring diagnostics, admission, discharge, or referral handoff capacity.

### A systematic review of triage-related interventions to improve patient flow in emergency departments — Oredsson et al., 2011

- **Identifier:** PMID 21771339.
- **Finding used:** Reviews controlled evidence on flow-related interventions and measures such as waiting time, length of stay, and patients leaving without being seen.
- **FlowCare relevance:** Supports measuring workflow outcomes rather than claiming that a digital interface itself improves care.

### NHS e-Referral Service guidance

- **Official source:** NHS England Digital, [joint guidance](https://digital.nhs.uk/services/e-referral-service/joint-guidance-on-the-use-of-the-nhs-e-referral-service) and [appointment-slot-issue guidance](https://digital.nhs.uk/services/e-referral-service/document-library/managing-and-minimising-appointment-slot-issues).
- **Finding used:** Documents real provider choice, booking, referral-assessment, redirection, deferred booking, and worklist states.
- **FlowCare relevance:** Provides a verified international workflow model for “no orphaned referral” behavior.

## 5.6 India situation

### What exists

- ABDM provides a national consent-based, federated architecture for exchanging health information; its HIE-CM documentation describes longitudinal record linking and consent-mediated exchange. [R18–R20]
- Government programs include referral, telemedicine, NCD screening, and community-level referral/navigation processes. [R21, R23]
- Indian hospital studies have measured queue and waiting-time patterns. A North Indian tertiary emergency outpatient study measured arrival patterns, waiting locations, and sources of delay; it reported that the study’s patient flow problem required a multifaceted hospital-wide approach. [R11]
- Single-site Indian work has applied queueing analysis to OPD operations. This is evidence of local research/implementation interest, not evidence of national adoption. [India source in Appendix]

### What was not verified

- No verified Indian national service equivalent to the full NHS e-RS referral/appointment-slot worklist was found in the screened sources.
- No verified national cross-hospital exchange was found that combines live appointment supply, queue/arrival state, referral acknowledgement, cost/coverage constraints, and completion/follow-up state.
- Private hospital networks may have proprietary scheduling/referral tools. Their scale and technical mechanisms were **not sufficiently verified** for this report.

### Defensible gap statement

India appears to have **digital-health rails and local operational studies, but the cross-provider operational closure layer remains an evidence gap in this review**. This is a workflow-integration/adoption hypothesis, not proof of absence.

## 5.7 FlowCare adaptation

FlowCare already has a hospital directory/search experience, appointment concepts, messages, and a hospital portal. A future access exchange could add:

- a canonical service/capability registry;
- time-stamped slot and queue observations;
- referral/appointment state transitions;
- patient constraints: travel radius, language/accessibility, time window, cost band, coverage;
- hospital-side worklist for pending/referral-slot issues;
- patient-visible status and escalation deadlines;
- post-visit closure and follow-up tasks;
- event logs for measurement and audit.

The AI assistant should only translate a user’s natural language into an allowed request schema. The selection engine should use validated data and explainable rules/optimization, not generated hospital claims.

## 5.8 Required data

### FlowCare can realistically collect in an MVP

- patient-selected locality or optional coarse geolocation;
- preferred time window, language, accessibility needs, travel limit;
- hospital service/capability records;
- manually entered or simulated slot inventory;
- appointment request and state transitions;
- patient-reported cost band or “ask hospital” flag;
- anonymized event timestamps for requests, acknowledgements, bookings, cancellations, and closure.

### Requires hospital/partner integration

- live appointment inventory;
- queue token or estimated waiting time;
- clinician/service capacity and closure rules;
- referral acknowledgement and redirection;
- insurance eligibility and package inclusion;
- clinical referral content and priority;
- FHIR/ABDM conformance and consent transactions;
- reliable completion and follow-up events.

## 5.9 Prototype feasibility

### Hackathon MVP

Use two or three simulated hospitals around a Pune test locality. Each hospital publishes:

- capabilities;
- slot inventory with timestamps;
- queue band;
- accessibility/language fields;
- cost band with an explicit “estimate, not guarantee” label.

Demonstrate:

1. A request generates three feasible options.
2. One slot expires; the patient is offered the next feasible option.
3. A referral enters a “pending acknowledgement” worklist.
4. A provider accepts or redirects it.
5. The patient sees the state transition and a deadline.
6. A completed visit creates a follow-up task.

### Full real-world system

Requires hospital contracts, standards/conformance work, data-quality SLAs, consent/privacy design, clinical governance, payment/insurance integration, call-centre or navigator operations, and evaluation over time.

## 5.10 Existing alternatives and differentiation

- NHS e-RS verifies a mature referral/choice/booking workflow, so FlowCare must not claim to invent the idea.
- Canadian eConsult verifies asynchronous specialist-access pathways.
- Hospital portals and appointment marketplaces implement pieces of booking and messaging.
- ABDM provides India’s consent-based record-exchange rails.

FlowCare’s potential difference is **combining dated operational supply, patient constraints, referral/slot exceptions, and closure across independent participating hospitals**, while keeping clinical decisions with clinicians and hospitals. Whether this is truly differentiated in a specific Indian market must be validated through a competitor/product audit; it is not established by this literature review alone.

## 5.11 Risks and limitations

- **Data freshness:** stale slots create false confidence; every availability value needs a timestamp and expiry policy.
- **Clinical safety:** no autonomous diagnosis or urgency classification; clinical priority must be clinician-supplied or clearly absent.
- **Operational ownership:** every referral state needs an accountable hospital worklist owner.
- **Equity:** optimizing travel/time can disadvantage patients with poor connectivity, disability, language barriers, or low digital literacy; retain assisted/offline routes.
- **Privacy:** minimize data, use consent, separate operational identifiers from clinical data, and avoid exposing referral details to untrusted providers.
- **Commercial conflict:** a paid/private provider must not be ranked as clinically better merely because it participates or pays.
- **Liability:** FlowCare must label slot, price, wait, and travel information as estimates unless contractually verified.
- **Adoption:** hospitals may not expose capacity or may lack interoperable systems.
- **Failure mode:** if no live signal exists, the system must downgrade to “last updated” information rather than invent a current wait.

## 5.12 Evidence confidence: **Strong for the mechanism; Moderate for the India-gap hypothesis**

The scheduling/queue/referral mechanisms have systematic reviews and real operational examples. The precise claim that India lacks a broad cross-provider operational exchange is not directly established by one national survey; it remains a carefully bounded finding from official architecture documents and the sources screened.

---

# 6. Candidate 2 — Equity-Safe No-Show and Appointment Resilience Layer

## 6.1 One-line explanation

Predict attendance risk to protect scarce slots, then respond with reminders, flexible rescheduling, wait-list offers, and human support—not automatic denial or punitive overbooking.

## 6.2 Healthcare problem

No-shows waste capacity and create longer waits. But a naive risk score can penalize people who face transport, language, work, cost, disability, or unstable-contact barriers. The mechanism must optimize the appointment system while expanding recovery options.

## 6.3 International evidence and mechanism

A systematic literature review of no-shows synthesized 727 articles and analyzed factors associated with missed appointments. [R1] A prospective Veterans Administration endoscopy study validated a predictive overbooking model that identified high-risk no-shows and offered their appointments to other patients on short notice. [R2] A randomized outpatient reminder study compared staff reminders, automated reminders, and no reminders; it demonstrates that the intervention—not merely the prediction—matters. [R3]

Mechanism:

```text
Historical appointment events + lead time + service type + patient-selected preferences
        ↓
Calibrated attendance-risk estimate with subgroup audit
        ↓
Action ladder:
  reminder → confirm/change time → offer transport/language help
  → release a slot to opt-in wait list → cautious operational overbooking only if safe
        ↓
Observe actual attendance, cancellation, lateness, and harm signals
        ↓
Recalibrate; never use a risk score as a clinical eligibility or access-denial rule
```

## 6.4 India situation

Indian online appointment systems and hospital attendance studies exist, but the review did not verify a national, transparent, equity-audited predictive overbooking service. That is an “implementation not verified” finding, not proof of absence. The safe opportunity is not “AI predicts unreliable patients”; it is **resilient capacity plus patient support**.

## 6.5 FlowCare adaptation and data

- Current appointment/request data can support a synthetic prototype.
- Hospital partnerships are required for actual slot release, waitlists, attendance, and staffing constraints.
- Do not use caste, religion, inferred income, diagnosis, or other sensitive attributes as penalty variables.
- Use interpretable operational features: lead time, prior cancellation history, confirmation state, appointment type, and requested reminder channel.
- Provide appeal and rescheduling rather than blocking.

## 6.6 MVP versus full system

**MVP:** simulated 50-slot clinic, attendance probabilities, opt-in waitlist, reminder/reschedule state machine, calibration/fairness dashboard, and comparison of no-overbooking, naive overbooking, and constrained policy.

**Full system:** real-time EHR/scheduler integration, consented communication, multilingual support, safe capacity rules, clinical/service-specific constraints, and prospective evaluation.

## 6.7 Alternatives, risks, confidence

Alternatives include ordinary reminders, online booking, and clinic-specific overbooking rules. FlowCare’s difference would be auditable, patient-supportive recovery rather than a hidden risk score.

Risks include discrimination, double-booking, emergency/urgent access harm, feedback loops, privacy, and staff distrust. Evidence confidence is **Strong for no-show factors and interventions; Moderate for a safe, India-scaled implementation gap**.

### Key evidence

- Dantas LF et al. “No-shows in appointment scheduling — a systematic literature review.” *Health Policy*, 2018. PMID 29482948; DOI 10.1016/j.healthpol.2018.02.002. [PubMed](https://pubmed.ncbi.nlm.nih.gov/29482948/)
- Reid MW et al. “Preventing Endoscopy Clinic No-Shows: Prospective Validation of a Predictive Overbooking Model.” *The American Journal of Gastroenterology*, 2016. PMID 27377518; DOI 10.1038/ajg.2016.269. [PubMed](https://pubmed.ncbi.nlm.nih.gov/27377518/)
- Parikh A et al. “The effectiveness of outpatient appointment reminder systems in reducing no-show rates.” *The American Journal of Medicine*, 2010. PMID 20569761; DOI 10.1016/j.amjmed.2009.11.022. [PubMed](https://pubmed.ncbi.nlm.nih.gov/20569761/)
- Huang YL, Bach SM. “Appointment Lead Time Policy Development to Improve Patient Access to Care.” *Applied Clinical Informatics*, 2016. PMID 27757471; DOI 10.4338/ACI-2016-03-RA-0044. [PubMed](https://pubmed.ncbi.nlm.nih.gov/27757471/)

---

# 7. Candidate 3 — Barrier-Aware Patient Navigation and Task Closure

## 7.1 One-line explanation

Give each eligible patient a visible, consented care-navigation plan that identifies non-clinical barriers and assigns/records tasks until the next care step is completed.

## 7.2 Healthcare problem

Patients can receive a clinically appropriate referral and still fail to complete care because of transport, cost, language, disability, work, documentation, appointment confusion, or lack of follow-up. A reminder is not the same as navigation.

## 7.3 Existing international evidence

The 2023 umbrella review by Chan et al. synthesized systematic reviews across the cancer continuum. It reports evidence for improved screening participation and reduced time from screening to diagnosis and diagnosis to treatment initiation, while also noting that much of the evidence comes from the United States and that evidence across countries and economic contexts is limited. [R24]

A 2024 systematic review of navigation in cancer treatment included 59 articles and found positive effects on several care-quality indicators, but it also highlights variation in roles and implementation. [R25] A 2026 report describes a system-wide nurse-navigation program across Northwell Health’s 26-hospital system, with navigators coordinating referrals, appointments, ancillary services, and psychosocial support; this is a verified implementation report, not proof that every health system can reproduce the result. [R26]

Mechanism:

```text
Referral/appointment event + patient-reported barriers
        ↓
Navigation needs assessment
        ↓
Task plan with owner, due date, channel, consent, escalation route
        ↓
Patient / navigator / hospital completes tasks
        ↓
Evidence of completion or documented exception
        ↓
Next care step is opened; unresolved barriers remain visible
```

## 7.4 India situation

India is not a blank slate. NHM guidance describes ASHAs assisting patients with navigation through facilities and referral centres, and national programs include referral and follow-up structures. [R23] The 12th Common Review Mission report also records weaknesses in referral and follow-up mechanisms in several states and poor documentation/back-referral in the reviewed program context. [R21]

Therefore, the precise opportunity is not “invent navigation in India.” It is:

> **Digitally close and measure navigation tasks across participating facilities while supporting human/community navigation where digital access is weak.**

A nationwide digital cross-provider navigation implementation was not sufficiently verified in the screened sources.

## 7.5 FlowCare adaptation

FlowCare could add a barrier/task layer to an access exchange:

- “needs wheelchair-accessible entrance”; 
- “needs Marathi/Hindi communication”; 
- “needs cost/coverage confirmation”; 
- “needs help obtaining referral documents”; 
- “needs transport or caregiver-compatible time”; 
- “needs a follow-up appointment after discharge.”

The system must not infer sensitive barriers from demographics. Patients or authorized navigators should state them, and the patient should control sharing.

## 7.6 Data and feasibility

**MVP data:** self-reported barriers, appointment/referral state, task owner, timestamp, consent, completion proof, escalation.  
**Partner data:** hospital navigator worklists, transport availability, financial-assistance workflow, referral documents, completion status.

**MVP:** one pathway (for example, non-emergency specialist referral), rules-based task checklist, navigator role, missed-deadline escalation, and dashboard of open/closed tasks.  
**Full system:** trained navigators, multilingual/offline channels, integration with ABDM/referral systems, reimbursement, and prospective equity evaluation.

## 7.7 Alternatives, risks, confidence

Alternatives include nurse navigation, community health workers, call centres, and patient portals. FlowCare could differ by making the handoff and barrier state portable across participating hospitals, not by replacing navigators with a chatbot.

Risks include role ambiguity, sensitive social data exposure, false reassurance, under-resourcing of human work, and inequitable digital access. Evidence confidence is **Strong for targeted patient navigation, Moderate for broad non-cancer scale and India adoption gap**.

### Key evidence

- Chan RJ et al. “Patient navigation across the cancer care continuum: An overview of systematic reviews and emerging literature.” *CA: A Cancer Journal for Clinicians*, 2023. PMID 37358040; DOI 10.3322/caac.21788. [PubMed](https://pubmed.ncbi.nlm.nih.gov/37358040/)
- Chen M et al. “Patient Navigation in Cancer Treatment: A Systematic Review.” *Current Oncology Reports*, 2024. PMID 38581470. [PubMed](https://pubmed.ncbi.nlm.nih.gov/38581470/)
- Hohenleitner JT et al. “Implementing a System-Wide Comprehensive Cancer Navigation Program in a Rapidly Expanding Health System.” *JCO Oncology Practice*, 2026. PMID 41926720; DOI 10.1200/OP-25-01088. [PubMed](https://pubmed.ncbi.nlm.nih.gov/41926720/)
- Ver Hoeve ES et al. “Implementing patient navigation programs: Considerations and lessons learned from the Alliance to Advance Patient-Centered Cancer Care.” *Cancer*, 2022. PMID 35579501; DOI 10.1002/cncr.34251. [PubMed](https://pubmed.ncbi.nlm.nih.gov/35579501/)

---

# 8. Candidate 4 — Cost- and Coverage-Aware Episode Planner

## 8.1 One-line explanation

Treat affordability and financial uncertainty as explicit care-access constraints, while clearly separating verified prices, estimates, coverage rules, and patient-reported information.

## 8.2 Healthcare problem

A geographically convenient appointment may not be feasible if consultation, diagnostics, package exclusions, travel, medicines, or repeat visits create unaffordable total episode cost. India’s National Health Accounts report an OOPE share of **39.4% of total health expenditure in 2021–22**. [R22] This statistic describes national health spending composition; it does not prove that every patient experiences the same burden.

## 8.3 International evidence and mechanism

Financial navigation has been studied particularly in oncology and chronic disease. The mechanism is not merely a “price comparison” screen:

```text
Care pathway or service request
        ↓
Expected service bundle + likely repeat steps + travel/ancillary costs
        ↓
Coverage/eligibility and uncertainty labels
        ↓
Lower-cost clinically appropriate alternatives / assistance task
        ↓
Patient chooses with transparent trade-offs
        ↓
Actual cost feedback improves future estimates
```

A unified, live, multi-hospital episode-cost system was not sufficiently verified as a mature international standard. This candidate is therefore less evidence-mature than the access-exchange mechanism.

## 8.4 India situation

The financial need is well supported by official OOPE data, and public schemes/insurance programs exist. What was not verified in the searched sources is a broadly adopted, cross-provider, real-time care-episode cost planner that reliably combines hospital prices, diagnostics, medicines, coverage, travel, and follow-up. Price transparency and package comparability are likely to be uneven, but a national quantification of that implementation gap was not located; state this as **not sufficiently verified**.

## 8.5 FlowCare adaptation and data

**Can collect:** patient budget range, preferred public/private/insurance route, travel cost proxy, hospital-published consultation/diagnostic estimates, user-confirmed quotes, assistance tasks.  
**Needs partners:** package definitions, insurer eligibility, preauthorization, negotiated prices, medicine/diagnostic bundles, final billing feedback.

**MVP:** compare two or three explicitly labelled cost scenarios for one non-emergency pathway, show uncertainty, and never represent an estimate as a bill.  
**Full system:** payer/hospital APIs, verified price catalogs, claims integration, financial counsellors, and audits for steering/bias.

## 8.6 Alternatives, risks, confidence

Alternatives include insurance portals, hospital package pages, government scheme portals, and financial counsellors. FlowCare’s possible difference is episode-level reasoning across time, travel, and follow-up—not a single consultation price.

Risks include outdated prices, steering toward cheaper but clinically inappropriate care, privacy of financial data, insurer conflicts, and false precision. Evidence confidence is **Moderate for the problem; Limited-to-Moderate for a unified technical mechanism and India gap**.

---

# 9. Candidate 5 — Privacy-Preserving Multi-Hospital Operations Intelligence

## 9.1 One-line explanation

Hospitals collaboratively learn operational models without pooling raw patient-level records, with local validation and governance at every site.

## 9.2 Existing international evidence

The EXAM study used federated learning across 20 institutes to predict future oxygen requirements using vital signs, laboratory data, and chest X-rays. The study reports that data remained at participating sites and that the model was externally validated at three Massachusetts hospitals. [R28]

A five-hospital Mount Sinai study compared local, pooled, and federated models for COVID-19 mortality prediction; federated models improved over local models at multiple sites but did not simply eliminate the performance difference from pooled data. [R29] A 2021 paper on routine implementation specifications identifies consortium definition, architecture, clinical-study definition, data collection, initialization, training, and results sharing as implementation steps. [R27]

A 2024 paper describes multi-hospital and multi-pharma collaborations moving federated learning toward production-grade solutions, while still emphasizing stakeholder and privacy requirements. [R31]

## 9.3 Mechanism for FlowCare

For non-clinical operations, each hospital could locally compute features such as:

- arrivals by time/service;
- appointment lead time;
- slot utilization;
- queue delay bands;
- cancellations/no-shows;
- referral ageing;
- completion/follow-up closure;
- staffing/resource availability.

A central coordinator receives model updates or aggregate statistics, not raw records. A global model forecasts network demand or identifies transferable operational patterns. Local hospitals validate the model against their own data before acting.

```text
Hospital A local data ─┐
Hospital B local data ─┼→ local model/update → secure aggregation → network model
Hospital C local data ─┘                                  ↓
                         local validation + human approval + monitored rollout
```

## 9.4 India situation

ABDM’s federated architecture is about consent-based health-information exchange, not the same as federated learning. No verified Indian multi-hospital federated operations-learning deployment was found in this review. This is a high-value research direction but should not be claimed as a ready student product.

## 9.5 MVP/full system, data, risks

**MVP:** three synthetic hospitals, different local data distributions, a federated demand/no-show model, comparison with local-only models, subgroup drift checks, and a “do not deploy if calibration fails” gate.

**Full system:** secure aggregation, attack resistance, data-schema mapping, hospital governance, auditability, model monitoring, incident response, and prospective operational evaluation.

Risks include model poisoning, leakage through updates, distribution shift, unfair performance for small hospitals, incentives, legal agreements, and confusion between operational prediction and clinical decision-making. Evidence confidence is **Strong for the technical mechanism; Limited-to-Moderate for routine operational deployment in India**.

### Key evidence

- Dayan I et al. “Federated learning for predicting clinical outcomes in patients with COVID-19.” *Nature Medicine*, 2021. DOI 10.1038/s41591-021-01506-3. [Nature](https://www.nature.com/articles/s41591-021-01506-3)
- Rieke N et al. “The future of digital health with federated learning.” *npj Digital Medicine*, 2020. PMID 33015372. [PubMed](https://pubmed.ncbi.nlm.nih.gov/33015372/)
- Lamer A et al. “Specifications for the Routine Implementation of Federated Learning in Hospitals Networks.” *Studies in Health Technology and Informatics*, 2021. PMID 34042719; DOI 10.3233/SHTI210134. [PubMed](https://pubmed.ncbi.nlm.nih.gov/34042719/)
- Wang X et al. “Federated Learning of Electronic Health Records to Improve Mortality Prediction in Hospitalized Patients With COVID-19: Machine Learning Approach.” *JMIR Medical Informatics*, 2021. PMID 33400679. [PubMed](https://pubmed.ncbi.nlm.nih.gov/33400679/)

---

# 10. Candidate 6 — Hospital Operations Digital Twin / What-If Sandbox

## 10.1 One-line explanation

Create a time-synchronized simulation of hospital flow so managers can test staffing, slot, routing, and discharge policies before changing live operations.

## 10.2 Existing evidence

A 2022 rapid literature review characterized digital twins for healthcare management as an emerging topic rather than a mature universal solution. [R32] Recent research proposes digital-twin workflows for critical-care or ED operations, but authors often distinguish simulation/prototype from live clinical deployment. A 2025 npj Digital Medicine paper describes a health digital-twin framework for discrete-event simulation-based critical-care workflows and shows how event capture can track process tasks; it also discusses limitations and implementation considerations. [R34]

A 2026 paper proposes an AI-driven digital twin for patient flow and scheduling using real-life datasets, but the authors explicitly describe it as a simulation rather than a complete real-life implementation. [R35] A 2026 study describes a digital-twin virtual hospital platform used for IT-outage response training at Yongin Severance Hospital in South Korea, with 60 multidisciplinary participants and simulated outpatient workflows. This verifies a real training implementation, not proof of improved routine patient outcomes. [R36]

## 10.3 Mechanism

```text
Operational event stream
(arrival, triage, service start/end, resource state, discharge)
        ↓
State-estimation layer
        ↓
Discrete-event simulation / digital twin
        ↓
What-if policies
(staff shift, slot template, queue routing, diagnostic sequence)
        ↓
Compare wait, throughput, utilization, overtime, equity, safety constraints
        ↓
Human manager chooses; live system changes only through approved workflow
```

The essential safety property is that the twin tests policies off-line or in a controlled environment; it does not autonomously change clinical treatment.

## 10.4 India situation and feasibility

No verified Indian hospital-wide digital-twin deployment was found in the screened sources. This does not prove absence. Indian queue studies show that local event measurement and process redesign are relevant, but that is not equivalent to a digital twin.

**MVP:** model registration → consultation → diagnostic → pharmacy/discharge for one outpatient service using synthetic or de-identified event logs; show how different slot templates affect waiting and staff idle time.  
**Full system:** event interfaces, near-real-time synchronization, validated simulation, safety/operational governance, and change-management.

Evidence confidence is **Moderate for the mechanism, Limited for proven live clinical/operational outcomes and India adoption**.

### Key evidence

- ElKefi S, Asan O. “Digital twins for managing health care systems: rapid literature review.” *Journal of Medical Internet Research*, 2022. DOI 10.2196/37641. [Publisher](https://www.jmir.org/2022/8/e37641)
- Kuruppu Appuhamilage GDK et al. “A health digital twin framework for discrete event simulation based optimised critical care workflows.” *npj Digital Medicine*, 2025. DOI 10.1038/s41746-025-01738-4. [Nature](https://www.nature.com/articles/s41746-025-01738-4)
- Balthasar SV et al. “An intelligent digital twin framework with AI-driven optimization for patient flow and clinical scheduling in smart healthcare systems.” *Frontiers in Digital Health*, 2026. PMID 42528795. [PubMed](https://pubmed.ncbi.nlm.nih.gov/42528795/)
- “Digital Twin-Based Virtual Hospital Platform for IT Outage Disaster Response Training: Implementation and Evaluation Study.” *Journal of Medical Internet Research*, 2026. PMID 42242699. [PubMed](https://pubmed.ncbi.nlm.nih.gov/42242699/)

---

# 11. Candidate 7 — Consent-Based Care-Transition Packet on ABDM Rails

## 11.1 One-line explanation

At a referral or hospital transition, FlowCare requests only the minimum consented, structured information needed for the next provider to continue the episode safely and operationally.

## 11.2 Why this is not a clean standalone differentiator

ABDM’s official material already defines:

- ABHA as an identifier for linking health records;
- HIE-CM for consent-based exchange;
- a federated architecture in which records remain with their source providers;
- PHR/longitudinal record access and sharing.

[R18–R20] Internationally, SMART on FHIR describes a platform designed to allow medical applications to work across EHR systems using web standards, authorization, and standardized clinical data models. [R17]

Therefore “FlowCare stores a longitudinal health record” would be a Category 1/2 idea, not the core innovation. FlowCare could still add value by implementing a **care-transition packet** that is workflow-specific: referral reason, current task state, appointment status, patient consent, accessibility/cost constraints, and explicit next action. But this requires ABDM/FHIR conformance and hospital participation.

## 11.3 India gap and evidence

The official ABDM documents show that the national architecture exists, while also explaining that provider systems remain responsible for creating/storing records and that interoperability depends on participating digital systems. [R18–R20] The same architecture documents discuss variation in digitization and provider software. A separate national survey of actual hospital-level workflow completion was not located in this review; the level of active use by each type of facility is **not sufficiently verified**.

The differentiator, if any, is not record storage. It is **using consented information to prevent an operationally lost referral or incomplete care transition**.

## 11.4 Evidence confidence

- Interoperability/consent mechanism: **Strong**.
- Novelty of standalone record layer in India: **Low**.
- Novelty of workflow-specific transition closure: **Moderate but requires implementation research**.

---

# 12. Candidate 8 — Clinician-Gated eConsult and Referral Assessment Exchange

## 12.1 One-line explanation

Allow a primary-care or referring clinician to send a structured question to a specialist for advice, triage, or referral routing before a physical appointment is booked—without autonomous diagnosis.

## 12.2 Evidence and mechanism

A systematic review of electronic consultation systems found 36 studies and evaluated access, population impact, and cost. [R12] Champlain BASE implementation studies reported rapid specialist response and reduced or redirected traditional referrals in selected contexts. [R13–R14, R39–R40]

```text
Referrer question + structured context
        ↓
Specialist advice / request for more information / appropriate referral route
        ↓
Patient and referrer see next action
        ↓
If physical appointment needed: capacity-aware booking and closed-loop status
```

The clinical gate is essential: the specialist or authorized clinician, not the FlowCare model, decides whether the advice is sufficient or an in-person referral is needed.

## 12.3 India situation

Indian government telemedicine and referral programs are verified, including historical telemedicine networks and NCD referral/navigation guidance. [R23 and official NHM references] A verified national specialist eConsult service with the same documented operational scale and closed-loop referral behavior as the Canadian examples was not found in this review. This should be described as **not sufficiently verified**, not absent.

## 12.4 FlowCare feasibility, risks, confidence

**MVP:** structured non-emergency referral question, clinician inbox, response options, patient-visible status, and referral/booking continuation. Use synthetic clinician accounts; do not provide medical answers via an LLM.

**Full system:** professional identity, remuneration, consent, clinical governance, response-time rules, medico-legal policy, EHR/ABDM integration, and audit.

Evidence confidence is **Strong for asynchronous specialist-access mechanism; Moderate for India gap and operational scale**.

### Key evidence

- Liddy C et al. “Electronic consultation systems: worldwide prevalence and their impact on patient care—a systematic review.” *Family Practice*, 2016. PMID 27075028; DOI 10.1093/fampra/cmw024. [PubMed](https://pubmed.ncbi.nlm.nih.gov/27075028/)
- Liddy C et al. “Evaluating the Implementation of The Champlain BASE eConsult Service in a New Region of Ontario, Canada: A Cross-Sectional Study.” *Healthcare Policy*, 2017. PMID 29274229; DOI 10.12927/hcpol.2017.25320. [PubMed](https://pubmed.ncbi.nlm.nih.gov/29274229/)
- “Prevention of delayed referrals through the Champlain BASE eConsult service.” *Canadian Family Physician*, 2017. PMID 28807973. [PubMed](https://pubmed.ncbi.nlm.nih.gov/28807973/)
- “Improving Access to Chronic Pain Services Through eConsultation: A Cross-Sectional Study of the Champlain BASE eConsult Service.” *Pain Medicine*, 2016. PMID 27040667; DOI 10.1093/pm/pnw038. [PubMed](https://pubmed.ncbi.nlm.nih.gov/27040667/)

---

# 13. Detailed India-gap findings

## 13.1 Digital records and interoperability

**Verified:** ABDM’s official material describes a consent-based, federated exchange architecture, HIE-CM, ABHA-linked records, and longitudinal PHR access. [R18–R20]

**Implication:** A generic patient record is not a defensible differentiator. FlowCare should treat ABDM/FHIR as an integration boundary and focus its innovation on operational coordination and task closure.

**Uncertainty:** This review did not establish the percentage of Indian hospitals actively connected for every document type or the quality/completeness of exchanged data at each facility. “National infrastructure exists” does not mean “every patient’s journey is interoperable.”

## 13.2 Waiting and queues

**Verified:** Indian hospital studies measure long waits, queue locations, peak arrivals, and bottlenecks. [R11 and the India sources in Appendix]

**Implication:** The problem is real and locally relevant, including for a Pune pilot context, but no unsupported claim is made about Villoo Poonawala Hospital or Gandharv Serenity.

**Uncertainty:** A single hospital study cannot establish national waiting-time prevalence or prove that a particular optimization policy will work elsewhere.

## 13.3 Referrals and navigation

**Verified:** NHM guidance includes referral, follow-up, and ASHA navigation roles. Government review material records weak referral/follow-up/documentation in some reviewed settings. [R21, R23]

**Implication:** FlowCare should augment and coordinate human referral/navigation work rather than market itself as replacing it.

**Uncertainty:** The reviewed government documents do not provide a complete, current map of private and public digital referral workflows across India.

## 13.4 Affordability

**Verified:** MoHFW NHA material reports OOPE at 39.4% of total health expenditure in 2021–22. [R22]

**Implication:** Cost is a plausible first-class access constraint, but FlowCare should not show false precision or claim that cheaper care is clinically equivalent.

**Uncertainty:** A national, comparable, real-time provider price dataset suitable for FlowCare was not verified.

## 13.5 Privacy-preserving network intelligence

**Verified internationally:** federated learning has been used in multi-institution research such as EXAM and in hospital-network studies. [R27–R31]

**India:** no verified Indian multi-hospital federated operational-intelligence deployment was found in this review. This is a search result, not proof of nonexistence.

---

# 14. FlowCare architectural implications

If FlowCare pursues Candidate 1, the system should be built around these primitives rather than around a chatbot:

## 14.1 Capability registry

A versioned record of what a hospital/service actually offers, with source, verification status, effective date, and expiry. A directory claim without freshness is not capacity.

## 14.2 Supply signal

A slot, queue, or service-capacity signal must contain:

- source;
- timestamp;
- confidence/quality state;
- expected expiry;
- whether it is bookable, requestable, or only informational.

## 14.3 Care-access state machine

At minimum:

```text
requested
→ clinically/administratively screened
→ options offered
→ patient/clinician selected
→ referral submitted
→ acknowledged
→ information requested / accepted / redirected
→ slot offered
→ booked
→ reminder / reschedule / cancel
→ arrived / no-show
→ service completed
→ follow-up open / closed
```

## 14.4 Consent and data minimization

Use a minimum necessary handoff. A hospital should not receive unrelated records merely because it is on the network. ABDM/HIE-CM should be considered for future integration rather than reimplemented casually.

## 14.5 Explainable constrained optimization

The system should show:

- which constraint each option satisfies;
- which data are live versus stale;
- whether cost is verified or estimated;
- why an option was excluded;
- what happens if the slot disappears.

## 14.6 Human override and audit

Hospital staff and patients need a visible override/appeal path. The system should log who changed a referral state, when, and why. Clinical priority must remain under authorized clinical governance.

## 14.7 Safe AI boundary

LLMs may help parse free-text requests into an allowed schema or summarize administrative status. They should not:

- diagnose;
- assign clinical urgency without a clinician;
- invent hospital capabilities, costs, slots, or wait times;
- write unrestricted database queries;
- autonomously redirect a clinically sensitive referral.

---

# 15. Recommended investigation path (without declaring a winner)

## Next investigation 1: Candidate 1, but narrow the pilot

Prototype one **non-emergency specialty referral/appointment pathway** across two simulated or partner hospitals near the supplied Pune locality. Measure:

- time from request to acknowledgement;
- time from acknowledgement to booking;
- stale-slot rate;
- referral abandonment;
- reschedule success;
- arrival/no-show;
- patient-reported clarity;
- staff workload;
- equity by language/accessibility/digital-channel choice.

The key question is not “can we build a recommender?” It is “can we demonstrate that an operational state remains owned until the next care step is completed?”

## Next investigation 2: Candidate 3, barrier/task closure

Run a small navigator-assisted study with one referral pathway. Compare a reminder-only flow with a task-closure flow. Document which barriers are common, which need human support, and which data hospitals will actually share.

## Next investigation 3: Candidate 2, no-show resilience

Use synthetic or de-identified appointment events. Test reminders, rescheduling, opt-in waitlists, and constrained capacity recovery. Do not start with automatic overbooking. First demonstrate safety, calibration, and equitable recovery.

Candidate 5 or 6 should be investigated as a later platform layer, not as the first patient-facing product unless FlowCare has hospital partners and the required event data.

---

# 16. Research conclusion

## A. Research landscape summary

The 293 unique PubMed records screened and the official/institutional sources reviewed show a mature body of work on scheduling, queues, no-shows, referral access, patient navigation, interoperability, and privacy-preserving learning. The evidence is less mature for end-to-end systems that connect all these mechanisms across independent hospitals.

A recurring pattern is that local optimization is easier to publish than system-wide adoption. Models can predict demand, no-shows, transfers, or length of stay, but operational benefit requires timely data, a responsible human/team, a policy response, and measurement of what happened afterward.

## B. Biggest healthcare-system opportunities

1. **Referral and appointment closure:** reduce the number of requests that become invisible after submission.
2. **Capacity-aware access:** coordinate supply, queue uncertainty, travel, accessibility, and patient time constraints.
3. **Barrier-aware navigation:** convert social/administrative barriers into owned tasks with completion state.
4. **Equity-safe capacity recovery:** use no-show knowledge to support patients and recover unused slots without exclusion.
5. **Affordable episode planning:** represent financial uncertainty transparently rather than showing isolated prices.
6. **Network learning without raw-data pooling:** a longer-term technical opportunity if governance and partners exist.
7. **Simulation before intervention:** test policy changes against realistic hospital-flow models before disrupting live care.

## C. Strongest evidence-backed directions

- Scheduling and queueing have strong theoretical, empirical, and implementation evidence, but the difficult part is data freshness and cross-department coordination.
- Closed-loop referrals and eConsult have verified international deployments and are understandable to hospitals and patients.
- Patient navigation has strong targeted evidence, especially in cancer care; broad generalization needs more local implementation research.
- No-show intervention evidence is strong, but predictive overbooking requires explicit safety and equity controls.
- Federated learning has strong technical/multicentre proof, but production governance is much harder than a research prototype.
- Digital twins are promising for what-if operations but remain less clinically/operationally validated than the underlying queueing and scheduling methods.
- Longitudinal health records are already a major ABDM direction and should be integrated with, not claimed as, FlowCare’s core novelty.

## D. FlowCare design implications

FlowCare should be fundamentally built around **care-access state and closure**, not around a chatbot. The assistant can be one interface into the system, but the durable product value should live in:

- current and dated operational truth;
- explicit constraints;
- explainable options;
- consented handoffs;
- provider worklists;
- patient-visible state;
- completion/follow-up evidence;
- measurable feedback loops.

The differentiator is potentially a **networked access coordination layer** that can start with one specialty and two hospitals, then scale as data and trust grow.

## E. Final decision framing

The evidence does not justify declaring one universal winner. It does justify choosing a strategic center:

> **FlowCare should investigate a Closed-Loop, Capacity-Aware Care Access Exchange first, with barrier-aware navigation and safe no-show resilience as its first two extensions.**

That direction has the clearest combination of real healthcare-system problem, international workflow proof, measurable mechanisms, a bounded India implementation gap, and a hackathon-scale MVP. Its main risk is not the algorithm; it is obtaining reliable partner data and changing operational ownership.

---

# 17. Anti-hallucination verification pass

- **Genuine sources?** The academic sources retained have PubMed, PMCID, DOI, journal, or publisher identifiers; official claims link to government/health-system pages.
- **Does each source support the claim?** Claims were limited to abstracts, official descriptions, or implementation details visible in the cited source. Unsupported outcome extrapolations were removed.
- **Prototype vs deployment separated?** Yes. Digital-twin and federated-learning sections explicitly separate research/simulation from live or multicentre implementation.
- **India absence claims avoided?** Yes. The report uses “no verified deployment found in this review,” “fragmented,” “limited,” or “not sufficiently verified.”
- **Commercial marketing treated as evidence?** No. Commercial examples are not used as proof of effectiveness.
- **Clinical safety preserved?** The proposed system does not diagnose or assign urgency autonomously; clinical decisions remain with authorized providers.
- **Exact local hospital claims?** None made about Gandharv Serenity or Villoo Poonawala Hospital.
- **Model/statistics invented?** No. The OOPE figure is from the Ministry of Health and Family Welfare source; paper findings are tied to identifiers.

---

# 18. Audit counts

- **Sources screened:** 293 unique PubMed records, plus official government and health-system sources.
- **High-quality sources retained:** 42 sources for the synthesis (peer-reviewed reviews/studies, verified implementation reports, and official government/health-system publications).
- **International implementations verified:** 9 operational, multicentre, or institutional implementation examples/patterns: NHS e-RS; the original Champlain BASE eConsult service; its Mississauga Halton expansion; BASE eConsult Manitoba; Northwell’s 26-hospital navigation program; the 20-institute EXAM federated-learning study; the five-hospital Mount Sinai federated-learning study; a critical-care digital-twin workflow framework; and Yongin Severance’s digital-twin outage-response training platform. These are not all equivalent in maturity—several are research demonstrations or training systems rather than routine production care.
- **India implementations identified:** 8 infrastructure/study examples or categories, including ABDM HIE-CM/ABHA/PHR architecture, NHM referral/telemedicine/NCD navigation guidance, Indian hospital queue/waiting-time studies, and local digital appointment/HMIS evidence. This count includes infrastructure and studies, not proof of national adoption.
- **Candidate mechanisms investigated:** 14 mechanism families after grouping duplicates.
- **Final candidates:** 8, with Candidate 1 recommended as the central system direction for deeper investigation.

---

# Appendix A — Key verified sources

The references below are intentionally limited to the sources used for major claims. The complete screening log is in [`pubmed_screened_sources.csv`](pubmed_screened_sources.csv).

**R1.** Dantas LF, Fleck JL, Cyrino Oliveira FL, Hamacher S. “No-shows in appointment scheduling — a systematic literature review.” *Health Policy*. 2018. PMID 29482948. DOI 10.1016/j.healthpol.2018.02.002. https://pubmed.ncbi.nlm.nih.gov/29482948/

**R2.** Reid MW, May FP, Martinez B, et al. “Preventing Endoscopy Clinic No-Shows: Prospective Validation of a Predictive Overbooking Model.” *The American Journal of Gastroenterology*. 2016. PMID 27377518. DOI 10.1038/ajg.2016.269. https://pubmed.ncbi.nlm.nih.gov/27377518/

**R3.** Parikh A, Gupta K, Wilson AC, et al. “The effectiveness of outpatient appointment reminder systems in reducing no-show rates.” *The American Journal of Medicine*. 2010. PMID 20569761. DOI 10.1016/j.amjmed.2009.11.022. https://pubmed.ncbi.nlm.nih.gov/20569761/

**R4.** Huang YL, Marcak J. “Grid Patient Appointment Template Design to Improve Scheduling Effectiveness.” *Journal of Healthcare Engineering*. 2015. PMID 26288889. DOI 10.1260/2040-2295.6.2.239. https://pubmed.ncbi.nlm.nih.gov/26288889/

**R5.** Chenl PS, Robielos RA, Palaña PK, Valencia PL, Chen GY. “Scheduling Patients’ Appointments: Allocation of Healthcare Service Using Simulation Optimization.” *Journal of Healthcare Engineering*. 2015. PMID 26288890. DOI 10.1260/2040-2295.6.2.259. https://pubmed.ncbi.nlm.nih.gov/26288890/

**R6.** Huang YL, Bach SM. “Appointment Lead Time Policy Development to Improve Patient Access to Care.” *Applied Clinical Informatics*. 2016. PMID 27757471. DOI 10.4338/ACI-2016-03-RA-0044. https://pubmed.ncbi.nlm.nih.gov/27757471/

**R7.** Palvannan RK, Teow KL. “Queueing for healthcare.” *Journal of Medical Systems*. 2012. PMID 20703697. DOI 10.1007/s10916-010-9499-7. https://pubmed.ncbi.nlm.nih.gov/20703697/

**R8.** El-Bouri R, Taylor T, Youssef A, Zhu T, Clifton DA. “Machine learning in patient flow: a review.” *Progress in Biomedical Engineering*. 2021. PMID 34738074. https://pubmed.ncbi.nlm.nih.gov/34738074/

**R9.** Leviner S, Debbie T. “Patient Flow Within Hospitals: A Conceptual Model.” *Nursing Science Quarterly*. 2020. PMID 31795886. DOI 10.1177/0894318419881981. https://pubmed.ncbi.nlm.nih.gov/31795886/

**R10.** Oredsson S, Jonsson H, Rognes J, et al. “A systematic review of triage-related interventions to improve patient flow in emergency departments.” *Scandinavian Journal of Trauma, Resuscitation and Emergency Medicine*. 2011. PMID 21771339. https://pubmed.ncbi.nlm.nih.gov/21771339/

**R11.** Tiwari Y, Goel S, Singh A. “Arrival time pattern and waiting time distribution of patients in the emergency outpatient department of a tertiary level health care institution of North India.” *Journal of Emergencies, Trauma, and Shock*. 2014;7(3):160–165. DOI 10.4103/0974-2700.136855. https://pmc.ncbi.nlm.nih.gov/articles/PMC4126114/

**R12.** Liddy C, Drosinis P, Keely E. “Electronic consultation systems: worldwide prevalence and their impact on patient care—a systematic review.” *Family Practice*. 2016. PMID 27075028. DOI 10.1093/fampra/cmw024. https://pubmed.ncbi.nlm.nih.gov/27075028/

**R13.** Liddy C, Moroz I, Mihan A, et al. “Evaluating the Implementation of The Champlain BASE™ eConsult Service in a New Region of Ontario, Canada: A Cross-Sectional Study.” *Healthcare Policy*. 2017. PMID 29274229. DOI 10.12927/hcpol.2017.25320. https://pubmed.ncbi.nlm.nih.gov/29274229/

**R14.** Liddy C, Moroz I, Mihan A, et al. “What are the cost savings associated with providing access to specialist care through the Champlain BASE eConsult service? A costing evaluation.” *BMJ Open*. 2016. PMID 27338880. https://pubmed.ncbi.nlm.nih.gov/27338880/

**R15.** NHS England Digital. “Joint guidance on the use of the NHS e-Referral Service.” Official guidance. https://digital.nhs.uk/services/e-referral-service/joint-guidance-on-the-use-of-the-nhs-e-referral-service

**R16.** NHS England Digital. “Appointment slot issues within the NHS e-Referral Service.” Official guidance. https://digital.nhs.uk/services/e-referral-service/document-library/managing-and-minimising-appointment-slot-issues

**R17.** Mandel JC, Kreda DA, Mandl KD, Kohane IS, Ramoni RB. “SMART on FHIR: a standards-based, interoperable apps platform for electronic health records.” *JAMIA*. 2016. PMID 26911829. DOI 10.1093/jamia/ocv189. https://pubmed.ncbi.nlm.nih.gov/26911829/

**R18.** National Health Authority, Government of India. “Health Information Exchange Consent Manager (HIE-CM).” Official ABDM document. https://abdm.gov.in/strapicms/uploads/ABDM_HIE_CM_ea5d4c0559.pdf

**R19.** National Health Authority, Government of India. “Frequently Asked Questions.” Official ABDM FAQ covering ABHA, consent, federated architecture, and HIE-CM. https://abdm.gov.in/faq/1000

**R20.** National Health Authority, Government of India. “A brief guide on ABDM and its various building blocks.” Official ABDM document. https://abdm.gov.in/strapicms/uploads/ABDM_Building_Blocks_v8_3_External_Version_eabbc5c0f3_4_a96f40c645_5716a684de_b344369144.pdf

**R21.** National Health Mission, Government of India. “12th Common Review Mission Report.” Official report; includes observations on referral, follow-up, and documentation in reviewed settings. https://nhm.gov.in/New_Updates_2018/Monitoring/CRM/12th/12th-CRM_Report.pdf

**R22.** Ministry of Health and Family Welfare, Government of India. “Steps taken by the Government to reduce Out-of-Pocket Health Expenditure.” Includes NHA 2021–22 OOPE share. https://www.mohfw.gov.in/?q=en/pressrelease-165

**R23.** National Health Mission, Government of India. “Operational Guidelines for Common Non-Communicable Diseases.” Includes referral/follow-up and ASHA navigation roles. https://nhm.gov.in/images/pdf/NHM/NHM-Guidelines/Operational_Guidelines_NCDs.pdf

**R24.** Chan RJ, Milch VE, Crawford-Williams F, et al. “Patient navigation across the cancer care continuum: An overview of systematic reviews and emerging literature.” *CA: A Cancer Journal for Clinicians*. 2023. PMID 37358040. DOI 10.3322/caac.21788. https://pubmed.ncbi.nlm.nih.gov/37358040/

**R25.** Chen M, Wu VS, Falk D, et al. “Patient Navigation in Cancer Treatment: A Systematic Review.” *Current Oncology Reports*. 2024. PMID 38581470. https://pubmed.ncbi.nlm.nih.gov/38581470/

**R26.** Hohenleitner JT, et al. “Implementing a System-Wide Comprehensive Cancer Navigation Program in a Rapidly Expanding Health System.” *JCO Oncology Practice*. 2026. PMID 41926720. DOI 10.1200/OP-25-01088. https://pubmed.ncbi.nlm.nih.gov/41926720/

**R27.** Lamer A, Filiot A, Bouillard Y, et al. “Specifications for the Routine Implementation of Federated Learning in Hospitals Networks.” *Studies in Health Technology and Informatics*. 2021. PMID 34042719. DOI 10.3233/SHTI210134. https://pubmed.ncbi.nlm.nih.gov/34042719/

**R28.** Dayan I, Roth HR, Zhong A, et al. “Federated learning for predicting clinical outcomes in patients with COVID-19.” *Nature Medicine*. 2021;27:1735–1743. DOI 10.1038/s41591-021-01506-3. https://www.nature.com/articles/s41591-021-01506-3

**R29.** Vaid A et al. “Federated Learning of Electronic Health Records to Improve Mortality Prediction in Hospitalized Patients With COVID-19: Machine Learning Approach.” *JMIR Medical Informatics*. 2021. PMID 33400679; DOI 10.1093/jamia/ocaa172. https://pubmed.ncbi.nlm.nih.gov/33400679/

**R30.** Rieke N, Hancox J, Li W, et al. “The future of digital health with federated learning.” *npj Digital Medicine*. 2020. PMID 33015372. https://pubmed.ncbi.nlm.nih.gov/33015372/

**R31.** Hagestedt I, et al. “Toward a tipping point in federated learning in healthcare and life sciences.” *Patterns*. 2024. PMID 39568469; PMCID PMC11573894. https://pubmed.ncbi.nlm.nih.gov/39568469/

**R32.** ElKefi S, Asan O. “Digital twins for managing health care systems: rapid literature review.” *Journal of Medical Internet Research*. 2022. DOI 10.2196/37641. https://doi.org/10.2196/37641

**R33.** Balthasar SV, Marappan S, Ravi L. “An intelligent digital twin framework with AI-driven optimization for patient flow and clinical scheduling in smart healthcare systems.” *Frontiers in Digital Health*. 2026. PMID 42528795. https://pubmed.ncbi.nlm.nih.gov/42528795/

**R34.** Kuruppu Appuhamilage GDK, Hussain M, Zaman M, et al. “A health digital twin framework for discrete event simulation based optimised critical care workflows.” *npj Digital Medicine*. 2025. DOI 10.1038/s41746-025-01738-4. https://www.nature.com/articles/s41746-025-01738-4

**R35.** “Digital Twin-Based Virtual Hospital Platform for IT Outage Disaster Response Training: Implementation and Evaluation Study.” 2026. PMID 42242699. https://pubmed.ncbi.nlm.nih.gov/42242699/

**R36.** Woodcock EW. “Barriers to and Facilitators of Automated Patient Self-scheduling for Health Care Organizations: Scoping Review.” 2022. PMID 35014968. https://pubmed.ncbi.nlm.nih.gov/35014968/

**R37.** Huang YL, Bach SM. “Appointment Lead Time Policy Development to Improve Patient Access to Care.” PMID 27757471. https://pubmed.ncbi.nlm.nih.gov/27757471/

**R38.** Liddy C et al. “Prevention of delayed referrals through the Champlain BASE eConsult service.” *Canadian Family Physician*. 2017. PMID 28807973. https://pubmed.ncbi.nlm.nih.gov/28807973/

**R39.** Liddy C et al. “Improving Access to Chronic Pain Services Through eConsultation: A Cross-Sectional Study of the Champlain BASE eConsult Service.” *Pain Medicine*. 2016. PMID 27040667. DOI 10.1093/pm/pnw038. https://pubmed.ncbi.nlm.nih.gov/27040667/

**R40.** Séroussi B, Jaulent MC, Lehmann CU. “Health Information Technology Challenges to Support Patient-Centered Care Coordination.” *Yearbook of Medical Informatics*. 2015. PMID 26123912. DOI 10.15265/IY-2015-028. https://pubmed.ncbi.nlm.nih.gov/26123912/

**R41.** Briatore A et al. “Causes of appointment attendance, nonattendance, and cancellation in outpatient consultations at a university hospital.” *International Journal of Health Planning and Management*. 2020. PMID 31448466. DOI 10.1002/hpm.2890. https://pubmed.ncbi.nlm.nih.gov/31448466/

**R42.** Zhao P, Yoo I, Lavoie J, Lavoie BJ, Simoes E. “Web-Based Medical Appointment Systems: A Systematic Review.” *Journal of Medical Internet Research*. 2017. PMID 28446422. DOI 10.2196/medinform.3669. https://pubmed.ncbi.nlm.nih.gov/28446422/

**Official India/health-system sources used in addition to the retained academic references:** National Health Authority ABDM FAQ and HIE-CM/building-block documents; Ministry of Health and Family Welfare NHA material; National Health Mission NCD and Common Review Mission documents; NHS England e-RS guidance; Health Canada electronic-referral and wait-time material. All are linked inline or in the relevant sections above.

---

## Final note on uncertainty

The most important unverified question is not whether the technology can be coded. It is whether Indian hospitals in the intended pilot geography will provide reliable, timestamped operational data and accept shared responsibility for referral/appointment closure. That must be tested through stakeholder interviews and a small, instrumented pilot before FlowCare claims a system-level outcome.
