# REU Recruitment Website — Status Brief

**Program:** SURE-AI — NSF Research Experiences for Undergraduates (REU) Site, UA Little Rock (NSF 23-601)
**Prepared for:** Program leadership / business review
**Status:** Working site with finalized SURE-AI content; published to the project GitHub repository

---

## 1. In one paragraph

We have a complete, working recruitment website for the SURE-AI REU program — a fully funded,
eight-week summer program for a cohort of 10 in efficient, secure, and trustworthy AI. Prospective
students can learn about the program, check their eligibility, review the (tentative) timeline, and
are routed to **NSF ETAP** to apply — applications are handled entirely through NSF's Education &
Training Application, not on this site. The site presents the five SURE-AI research pathways and
the named faculty mentors, reflects NSF's requirements for a national, inclusive REU Site, and is
built to expand into a participant showcase after the award. Program and application dates are shown
as tentative and subject to change until confirmed. The site is live on UA Little Rock's CRC
infrastructure at reu.crc.ualr.edu.

---

## 2. What a prospective student can do today

- **Understand the program** across four clear pages: Overview, Research, Eligibility & Funding,
  and Dates & FAQ.
- **See if they qualify** — NSF eligibility rules stated in plain language (citizenship,
  enrollment, community-college and transfer students, and who is not eligible).
- **See the full funding picture** — stipend, housing, meals, travel, and "no fees, no tuition."
- **Apply through NSF ETAP.** Applications are accepted only through NSF's Education & Training
  Application (ETAP) at etap.nsf.gov; the site directs every applicant there and no longer collects
  applications on-site.
- **See the tentative timeline.** Program and application dates are presented as tentative and
  subject to change, with the exact application window and program dates to be posted once confirmed.
- **Ask questions any time** via a built-in assistant that answers from the site's own content.

## 3. How applications are reviewed

- **Applications are submitted and managed in NSF ETAP.** ETAP maintains the national applicant
  pool and is where staff review applicants, so intake and committee review happen in NSF's system
  rather than on our site.
- The site's role is recruitment and information: it drives a broad, diverse pool of applicants to
  ETAP and answers their questions.

> A private on-site review panel (staff key, per-application view, transcript download, CSV export
> with the campus-vs-external breakdown) still exists in the codebase from the earlier build, but it
> is not part of the current ETAP-based workflow and is not linked from the site.

---

## 4. Why this matters for the NSF proposal

The site was built specifically around what NSF reviewers look for in an REU Site:

- **National, inclusive recruitment** — the site states our commitment to recruit broadly,
  including from community colleges and institutions with limited research opportunities, and
  documents non-discrimination compliance.
- **High-quality mentoring** — mentor selection, training, and ongoing support are described.
- **Student safety** — code of conduct, harassment policy, and orientation are covered, with the
  required links to NSF policy.
- **Transparency on funding and eligibility** — everything a student needs to decide is on one site.
- **Future-ready** — after the award, the site is designed to showcase the cohort's participants
  and outcomes, which supports future renewals.

---

## 5. Quality and reliability

We didn't just build features — we verified them.

- The public content, assistant, and remaining backend functions are covered by an **automated
  test suite that runs clean** (194 tests pass), so we can make changes with confidence that
  nothing breaks.
- **Accessibility** was addressed throughout: the site works with screen readers and keyboard
  navigation, meets recognized color-contrast standards in both light and dark modes, and the
  core information remains readable even if a browser has scripting turned off.
- **Security and privacy basics are in place**: passwords are stored securely, sessions are
  protected, staff access is gated behind a key, and the application intentionally keeps sensitive
  student information out of exports and any future public showcase.
- **Data is durable** — applications and uploaded transcripts are stored so they survive restarts
  and maintenance.

> Note on standards: full accessibility conformance and any formal security or privacy review
> (FERPA/IRB) should still go through the university's normal process before real applicant data
> is collected. The groundwork is done; sign-off is a separate, expected step.

---

## 6. Status and what's left

- **Live.** The site is deployed on UA Little Rock's CRC infrastructure at reu.crc.ualr.edu and
  routes all applicants to NSF ETAP.
- **Dates.** Program and application dates are shown as tentative and will be updated on the site
  as soon as they are confirmed (applications expected to open around January 2027).
- **Because applications go through ETAP,** the site does not collect student PII on-site, so the
  on-site email/verification and database-hosting steps are no longer on the critical path.
- **NSF requirement:** furnish the live web address to the cognizant NSF program officer within
  90 days of award notification.

---

## 7. Suggested talking points for the meeting

- "The recruitment site is live on CRC infrastructure and routes every applicant to NSF ETAP, the
  national application system NSF wants Sites to use."
- "It's built directly against NSF's REU expectations, so it doubles as evidence of our
  recruitment and communication plan for reviewers."
- "Applications are handled in NSF ETAP, so we're not collecting student PII on our own site —
  that simplifies privacy/FERPA considerations."
- "Dates are posted as tentative and will be updated the moment they're confirmed."

---

## 8. Timeline

| Item | Status | Target |
|------|--------|--------|
| Working site (info, assistant) routing applicants to NSF ETAP | Complete & live | — |
| Quality/accessibility groundwork | Complete | — |
| Finalized SURE-AI mentor & project content | Complete | — |
| Deployed on CRC infrastructure (reu.crc.ualr.edu) | Live | — |
| Confirm & publish exact program/application dates | Pending (tentative shown) | When NSF/ETAP confirms |
| Furnish live URL to NSF program officer | Pending | Within 90 days of award |
