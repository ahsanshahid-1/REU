# Structured content slots (Aug 6 mentor/research deliverable)

These JSON files are the **content slots** that drive the "published upon award"
treatment on the public pages (Requirement 18.2–18.4, Requirement 2.6). They are
served statically at `/content/*.json` and read by `public/js/site.js`.

## How the slot behaves

Each file holds a JSON **array**.

- **Empty array `[]`** (the current, pre-award state): the page keeps the
  consistent **"Published upon NSF award notification."** withheld statement that
  is already present in the raw HTML. No JavaScript is required for that statement
  to show, so it is visible even with JS disabled (Requirement 17.5).
- **Populated array**: `site.js` renders the finalized content in place of the
  withheld statement. This is a pure data drop-in — **no code change** is needed to
  publish the Aug 6 deliverable. Just replace `[]` with the real entries and flip
  the matching rows in `../../CONTENT.md` to `finalized`.

Finalized content replaces the placeholder **only when it is actually finalized**
(a populated array). Leaving a file as `[]` keeps the withheld treatment
(Requirement 18.2).

## Schemas

### `mentors.json` — named mentor profiles (`named-mentor-profiles`)

```json
[
  {
    "name": "Dr. Jane Doe",
    "title": "Associate Professor of Materials Science",
    "area": "Nanotechnology and advanced materials",
    "focus": "One or two sentences describing the mentor's active research.",
    "mentoring": "Undergraduate mentoring record (students advised, undergraduate coauthors, etc.)."
  }
]
```

### `projects.json` — detailed example projects (`research-project-details`)

```json
[
  {
    "area": "Data science and analytics",
    "title": "Example project title",
    "description": "One paragraph describing a representative student project in this area."
  }
]
```

## Keep the Assistant in sync

When these slots are populated, mirror the same finalized content into
`../../data/knowledge.extra.json` (Task 8.3) so the chatbot and the pages stay
consistent.
