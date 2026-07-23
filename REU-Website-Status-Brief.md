# REU Recruitment Website — Status Brief

**Program:** NSF Research Experiences for Undergraduates (REU) Site — UA Little Rock (solicitation NSF 23-601)
**Prepared for:** Program leadership / business review
**Status:** Working prototype, on track for the August 10 deadline

---

## 1. In one paragraph

We have a complete, working recruitment website for the REU program. Prospective students
can learn about the program, check their eligibility, create an account, and submit a full
application with a transcript — end to end. Program staff can review, download, and export
those applications through a private admin view. The site reflects NSF's requirements for a
national, inclusive REU Site, and it is built to expand into a participant showcase after the
award. What remains before launch is finalizing a small amount of program content (mentor
names, specific project write-ups) and connecting it to the university's email system.

---

## 2. What a prospective student can do today

- **Understand the program** across four clear pages: Overview, Research, Eligibility & Funding,
  and Dates & FAQ.
- **See if they qualify** — NSF eligibility rules stated in plain language (citizenship,
  enrollment, community-college and transfer students, and who is not eligible).
- **See the full funding picture** — stipend, housing, meals, travel, and "no fees, no tuition."
- **Create an account and verify their email**, then **submit a complete application**:
  personal statement, ranked project interests, two references, and a transcript upload.
- **Get a confirmation number** immediately and a copy by email.
- **Ask questions any time** via a built-in assistant that answers from the site's own content.
- **Apply either through our site or through NSF's national application system** — both are
  presented as equal options.

## 3. What program staff can do today

- Sign in to a **private review area** with a secure staff key.
- **See every application** at a glance, including a breakdown of how many candidates come from
  our own campus versus other institutions (a metric NSF cares about).
- **Open any application, download the transcript, and export the whole pool to a spreadsheet**
  for committee review.

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

- The application, account, email, admin, and assistant functions are covered by an **automated
  test suite that runs clean**, so we can make changes with confidence that nothing breaks.
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

## 6. What's left before we go live

Three focused items, none of them large:

1. **Finalize program content (targeted for Aug 6).** Named mentor profiles and detailed project
   descriptions are the main gap. The site is built so this content drops into pre-marked slots
   without any rework. Until then, those spots show a consistent "published upon award" note
   rather than blanks or placeholders.
2. **Connect real email.** Today, in our testing setup, verification codes appear on screen for
   convenience. For launch we connect the site to the university's email system (or a standard
   email service) so codes and confirmations actually reach applicants. This is a configuration
   step, not new development.
3. **Deploy on university-appropriate hosting with a web address.** For a live program handling
   student data, this should sit on university-managed infrastructure with secure (HTTPS) access.
   The site is packaged to hand off to campus IT, and we've documented the required steps —
   including NSF's requirement to provide the live web address to the program officer within
   90 days of the award.

---

## 7. Suggested talking points for the meeting

- "The recruitment site is functionally complete and tested — a student can go from learning about
  the program to a submitted application today."
- "It's built directly against NSF's REU expectations, so it doubles as evidence of our
  recruitment and communication plan for reviewers."
- "The only remaining work is finalizing mentor/project content, turning on real email, and
  deploying on campus infrastructure — all planned and low-risk."
- "Sensitive student data handling and accessibility are built in, with formal university sign-off
  as the expected next checkpoint before we collect real applications."

---

## 8. Timeline

| Item | Status | Target |
|------|--------|--------|
| Working site (info, accounts, application, admin, assistant) | Complete | — |
| Quality/accessibility/security groundwork | Complete | — |
| Finalized mentor & project content | Pending team input | Aug 6 |
| Real email connected | Configuration step | Before launch |
| Deployed on campus hosting + URL to NSF | Ready to hand off | Within 90 days of award |
| Proposal deadline | On track | Aug 10 |
