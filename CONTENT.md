# Placeholder Content Register

_Requirement 18.1 — the documented, enumerable list of every `Placeholder_Content` location on
the REU Recruitment Site, with its current state and its resolution path._

This register is the single source of truth for provisional content. It exists so that nothing
bracketed or empty ships, and so reviewers can see exactly which details are finalized, which are
intentionally withheld until the NSF award, and which remain in an intermediate state.

## How to read this register

Every `Placeholder_Content` location has exactly one **state**, and the state drives how the
public site presents it (Requirement 18.2–18.4):

| State | Meaning | Presentation on the Public_Site |
|-------|---------|---------------------------------|
| **finalized** | The detail is confirmed. | Show the finalized content in place of the placeholder (Req 18.2). |
| **withheld-until-award** | The detail is intentionally not published before the NSF award. | Show the consistent **"Published upon NSF award notification."** statement — never an empty or bracketed placeholder (Req 18.3). |
| **intermediate** | Neither finalized nor explicitly withheld. | Continue to present the existing `Placeholder_Content` text (Req 18.4). |

**Pages referenced** (all under `REU/public/`): `index.html` (Overview), `research.html`
(Research), `eligibility.html` (Eligibility & Funding), `faq.html` (Dates & FAQ). Shared regions
(footer fine print, contact block) repeat across pages and are noted as such.

## Register

| Key | Page / Location | Current text on the page | State | Resolution path |
|-----|-----------------|--------------------------|-------|-----------------|
| `award-status` | `index.html` — topbar ticker + `role="note"` label; footer NSF paragraph (all pages) | "program pending NSF award"; "This program is **proposed** as a Research Experiences for Undergraduates (REU) Site under the NSF REU program (NSF 23-601). **Upon award**, this material will be based upon work supported by the National Science Foundation." | `withheld-until-award` | On NSF award notification, replace the "pending NSF award" indicator with an "NSF-funded, Award #\_\_\_\_" statement and switch the footer to the active "based upon work supported by" acknowledgment (Req 1.5). |
| `pi-name` | Not printed on any page (no PI is named anywhere in the public HTML) | _(absent — intentionally not present)_ | `withheld-until-award` | Add the PI name to the contact block and mentor roster when the award is finalized. Until then, no name is shown (Req 18.1, 18.3). |
| `pi-direct-contact` | `index.html` and `faq.html` — `#contact` block; footer fine print (all pages) | "The Principal Investigator's direct contact information is published upon award notification."; footer: "Named mentor profiles and the PI contact are published upon award." | `withheld-until-award` | On award, publish the PI's direct email/phone in the contact block. Consistent "published upon award" statement is shown until then (Req 18.3). |
| `named-mentor-profiles` | `research.html` — `#mentors` cards; footer fine print (index/eligibility/faq) | Research page: seven named faculty/mentoring profiles (Drs. Elfikky, Basu, Milanova, Talburt, Spann, Zhang, and Michael E. Moore) with roles and expertise. Footer (other pages): "the final roster is confirmed upon NSF award notification." | `finalized` (Research page) | Names are **published** on the Research page, reflecting the proposed Senior/Key Personnel. The shared footer note on the other pages still defers the *award-time* final-roster confirmation (Req 2.6). |
| `research-project-details` | `research.html` — `#activities` cards | Five research pathways, each with a full description, faculty leads, and an illustration | `finalized` | Published on the Research page with the five SURE-AI pathways (Req 2.6). |
| `program-dates` | `index.html` — topbar/hero ("Summer 2027", open Nov 1 2026, close Feb 15 2027); `faq.html` — `#dates` timeline (open Nov 1 2026; deadline Feb 15 2027 11:59 p.m. CT; decisions Mar 20 2027; program Jun 1–Jul 24 2027, an 8-week cohort) | "applications open Nov 1, 2026 and close Feb 15, 2027"; timeline entries for open / deadline / decisions / in-residence dates | `finalized` | Displayed as-is. Calendar dates are placeholders sized to the 8-week program and should be confirmed; if they shift, update the topbar, hero kicker, and FAQ timeline together (Req 7.1). |
| `program-contact-email` | All pages — `#contact` block, "Email the program team" button, "program at a glance" card, `mailto:` links; mirrored in `lib/knowledge.js` | `reu@ualr.edu` | `finalized` | Single consistent value used site-wide. Verified by a content check that no other contact address appears (Req 18.5). |
| `program-phone` | `index.html` and `faq.html` — `#contact` block | "(501) 916-3000" (general UA Little Rock campus number) | `finalized` | General campus line, safe to publish pre-award. Replace with a direct program line if/when one is assigned. |
| `research-fields` | `index.html` — "program at a glance" card | "Artificial intelligence, cybersecurity, data science" | `finalized` | Fixed program content describing the Site's fields (SURE-AI). No change expected (Req 1.3). |
| `common-intellectual-focus` | `index.html` — `#overview` | "efficient, secure, and trustworthy artificial intelligence — edge and multimodal AI, cyber defense, immersive analytics, and hardware-aware deployment" | `finalized` | Fixed program content; the shared cohort theme (Req 2.2). |
| `research-project-areas` | `research.html` — `#activities` cards | Five SURE-AI research pathways with summaries: Communication-efficient federated adaptation at the edge; Efficient multimodal AI from local GPU to edge and optional FPGA; Data-quality-aware adaptive and explainable cyber defense; Trustworthy immersive, wearable, and visual-analytics AI; Robust learned space-optical communications with hardware-aware deployment | `finalized` | The pathway set, summaries, and named faculty leads are finalized program content (Req 2.1). |
| `cohort-size` | `index.html` — hero, "program at a glance" ("10 per year"), `#overview` | "cohort of 10 students"; "10 per year"; "ten students" | `finalized` | Fixed program content: planned cohort of 10 (Req 1.1). |
| `stipend-amount` | `index.html` — "program at a glance"; `eligibility.html` — `#support` funding table | "$700 / week", "$5,600" for 8 weeks | `finalized` | Follows NSF's expected rate; fixed unless NSF guidance changes (Req 6.1). Calendar dates and total are placeholders pending confirmation. |
| `showcase-section` | `eligibility.html` — `#evaluation` ("After the program begins, this website expands to showcase the cohort…") | Statement that the site will expand to a participant showcase | `intermediate` | Forward-looking statement only; the Showcase_Section itself is a post-deadline phase (Req 19, Task 13) and stays hidden/forthcoming until cohort data exists. |

## Summary of states

- **finalized (10):** `program-dates`, `program-contact-email`, `program-phone`, `research-fields`,
  `common-intellectual-focus`, `research-project-areas`, `cohort-size`, `stipend-amount`,
  `named-mentor-profiles` (published on the Research page), `research-project-details`.
- **withheld-until-award (3):** `award-status`, `pi-name`, `pi-direct-contact`.
- **intermediate (1):** `showcase-section`.

## Notes for maintainers

- The **"Published upon NSF award notification."** wording must be identical everywhere a
  `withheld-until-award` item appears (Req 18.3). Task 8.2 introduces a shared snippet so the
  wording cannot drift.
- Named faculty profiles and the five research pathways are **published** on the Research page and
  mirrored in `lib/knowledge.js` / `data/knowledge.extra.json` for the Assistant, so the page and the
  knowledge base stay consistent.
- When a `withheld-until-award` item is finalized, change its state to `finalized` here **and**
  populate the corresponding slot/content — finalized content replaces a placeholder only when
  the detail is actually finalized (Req 18.2).
- The single program contact email (`reu@ualr.edu`) is defined once and referenced everywhere;
  do not introduce a second contact address (Req 18.5).
