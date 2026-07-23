/* Knowledge base for the REU assistant chatbot.
   This is the retrieval corpus for a small, lexical RAG pipeline. The site is
   small, so a curated set of self-contained "chunks" (one fact cluster each)
   gives more reliable retrieval than blindly splitting HTML. Each chunk is
   phrased so it makes sense on its own when handed to the language model.

   To extend the assistant's knowledge, add entries here (or append to
   data/knowledge.extra.json — see loadExtraChunks below). Keep each chunk
   focused on a single topic and include the words a student would actually
   search for. */

'use strict';

const fs = require('fs');
const path = require('path');

/** @typedef {{ id:string, title:string, url:string, tags:string[], text:string }} Chunk */

/** Base corpus, derived from the site's own pages (the source of truth). */
const BASE_CHUNKS = [
  {
    id: 'overview',
    title: 'What the program is',
    url: '/',
    tags: ['overview', 'about', 'what is reu', 'nsf', 'program'],
    text: `This is an NSF Research Experiences for Undergraduates (REU) Site hosted at the University of Arkansas at Little Rock (UA Little Rock). Ten undergraduate students from institutions across the United States join active faculty research groups for a ten-week, in-residence summer research program. The Site's common focus is data-driven discovery and emerging technologies: connecting nanoscale materials research with data science, visualization, and secure computing. No prior research experience is required and there is no application fee. The program is pending an NSF award.`,
  },
  {
    id: 'glance',
    title: 'Program at a glance',
    url: '/',
    tags: ['stipend', 'housing', 'meals', 'duration', 'participants', 'format', 'summary', 'money', 'pay'],
    text: `Program at a glance: Host is UA Little Rock. Fields are materials science, data science, and computing. There are 10 participants per year. Format is summer, in residence. Duration is 10 weeks. The stipend is $700 per week (7,000 dollars total for the ten weeks). Housing and meals are provided. Contact: reu@ualr.edu.`,
  },
  {
    id: 'dates',
    title: 'Key dates and timeline (Summer 2027)',
    url: '/faq.html',
    tags: ['dates', 'deadline', 'timeline', 'when', 'apply open', 'decisions', 'schedule'],
    text: `Timeline for the Summer 2027 cohort: Applications open November 1, 2026. The application deadline is February 15, 2027 at 11:59 p.m. Central Time, and all materials, including both reference contacts, are due then. All decisions are announced by March 20, 2027; offers go out on a rolling basis and every applicant receives a decision by that date. The program runs in residence from June 1 to August 6, 2027, ending with the research symposium.`,
  },
  {
    id: 'apply-requirements',
    title: 'What the application asks for',
    url: '/faq.html',
    tags: ['apply', 'application', 'requirements', 'transcript', 'references', 'statement', 'how to apply'],
    text: `The application asks for: a free applicant account with a verified email so you can track your status; contact details and confirmation of NSF eligibility; your institution, degree program, and academic year; a ranked choice of the project areas; a personal statement of 300 to 600 words (read for curiosity, not polish); an unofficial transcript as a PDF (there is no GPA cutoff); and the names and emails of two references, who are contacted directly (no letters for you to chase). You can apply through this website or via NSF ETAP at etap.nsf.gov; both routes receive identical consideration.`,
  },
  {
    id: 'eligibility',
    title: 'Who is eligible',
    url: '/eligibility.html',
    tags: ['eligibility', 'eligible', 'citizen', 'international', 'community college', 'transfer', 'who can apply'],
    text: `Eligibility follows NSF solicitation 23-601. You are eligible if you are a U.S. citizen, U.S. national, or U.S. permanent resident, AND you are enrolled in a degree program (part time or full time) leading to a bachelor's or associate degree. Community college and associate-degree students are fully eligible and strongly encouraged. First- and second-year students are encouraged. Students transferring between institutions, and enrolled at neither during the intervening summer, are permitted, as are recent high-school graduates already accepted to an undergraduate institution but not yet started. You are NOT eligible if you have already received your bachelor's degree and are no longer enrolled as an undergraduate, or if you are an international student without U.S. citizenship, national status, or permanent residency. The citizenship rule is an NSF-wide requirement for all REU Sites.`,
  },
  {
    id: 'gpa',
    title: 'GPA and research experience',
    url: '/faq.html',
    tags: ['gpa', 'cutoff', 'grades', 'experience', 'never done research', 'beginner'],
    text: `There is no GPA cutoff. The transcript is used to understand your preparation, not to filter by a number; the personal statement and references carry more weight. Students who have never done research are emphatically encouraged to apply, because NSF encourages involving students at earlier stages and selection is based on potential, not prior output.`,
  },
  {
    id: 'funding',
    title: 'Funding and costs',
    url: '/eligibility.html',
    tags: ['funding', 'stipend', 'cost', 'travel', 'tuition', 'fee', 'taxes', 'pay', 'salary'],
    text: `The program is fully funded. Research stipend is $700 per week for 10 weeks ($7,000 total), paid biweekly across the summer rather than as a lump sum. Housing (a furnished on-campus residence hall), meals via a weekly allowance, round-trip travel to Little Rock, and laboratory use fees are all provided as NSF participant support costs. There is no application fee and no tuition is required. NSF forbids charging students for access to common campus facilities. The stipend is a research training stipend, not a salary, so participants are not employees. Stipend funds may be taxable; NSF points students to the IRS Tax Benefits for Education page.`,
  },
  {
    id: 'research-areas',
    title: 'Research project areas',
    url: '/research.html',
    tags: ['research', 'projects', 'areas', 'topics', 'themes', 'labs', 'what will i do'],
    text: `Applicants rank six project areas and are matched with a mentor whose active work fits their interests: (1) Nanotechnology and advanced materials, in the Center for Integrative Nanotechnology Sciences; (2) Nanomedicine and bioengineering, including tissue regeneration, with partners such as the University of Arkansas for Medical Sciences; (3) Data science and analytics, including statistical modeling and machine learning; (4) Immersive visualization and extended reality, in the Emerging Analytics Center which has a CAVE environment; (5) Cybersecurity and resilient computing, including trustworthy machine learning; and (6) Applied mathematics and computational modeling.`,
  },
  {
    id: 'weekly',
    title: 'What a summer looks like week by week',
    url: '/research.html',
    tags: ['schedule', 'week', 'activities', 'seminar', 'symposium', 'what happens'],
    text: `Week 1 is orientation (program expectations, code of conduct, training in responsible and ethical conduct of research) plus a skills bootcamp. Weeks 2 to 8 are full-time research with your mentor and group, a weekly cohort seminar, and professional-development workshops on graduate school, careers, and scientific communication. Week 9 is a writing workshop with poster and talk preparation and practice presentations. Week 10 is the final research symposium where every student presents. After the summer, mentors continue interacting during the academic year, with conference travel support, recommendation letters, graduate-school guidance, and publication support where results warrant.`,
  },
  {
    id: 'facilities',
    title: 'Research environment and facilities',
    url: '/research.html',
    tags: ['facilities', 'labs', 'centers', 'environment', 'university', 'where'],
    text: `UA Little Rock is a metropolitan public research university (R2, high research activity). Research spans the Donaghey College of Science, Technology, Engineering, and Mathematics and the university's 20-plus research centers. Students work directly in the Center for Integrative Nanotechnology Sciences (electron microscopy, scanning probe microscopy, X-ray diffraction, optical spectroscopy) and the George W. Donaghey Emerging Analytics Center (immersive visualization and extended reality, including a CAVE), plus departmental labs in biology, chemistry, physics and astronomy, earth sciences, mathematics and statistics, and computer science.`,
  },
  {
    id: 'mentoring',
    title: 'Mentoring and mentor training',
    url: '/research.html',
    tags: ['mentor', 'mentoring', 'mentor training', 'supervision', 'recommendation letters', 'publication', 'after the summer'],
    text: `Research mentors are drawn from faculty across the Donaghey College of STEM and the university's research centers, selected for expertise and a documented history of involving undergraduates in research, including publishing with undergraduate coauthors. All mentors complete structured training before the summer, covering research supervision and professional conduct, as the solicitation requires. The program monitors mentoring quality through program-level check-ins during the summer, so mentoring is supervised, not assumed. Mentoring continues after the summer to the extent practicable: academic-year interaction connecting the research to your course of study, recommendation letters, graduate-school guidance, and support toward publication when results warrant.`,
  },
  {
    id: 'conduct',
    title: 'Code of conduct, harassment policy, and orientation',
    url: '/research.html',
    tags: ['code of conduct', 'harassment', 'sexual harassment', 'sexual assault', 'safe', 'inclusive', 'orientation', 'reporting', 'off-site'],
    text: `Every participant (REU students, faculty, postdocs, graduate students, and other research mentors) attends an orientation covering expectations of behavior for a safe, respectful, inclusive, and harassment-free environment. The orientation reviews the university's policy addressing sexual harassment, other forms of harassment, and sexual assault, including reporting and complaint procedures. NSF does not tolerate harassment where NSF-funded activities take place; see NSF's harassment policies at nsf.gov/od/oecr/harassment.jsp. For any off-campus or off-site research, the university certifies a plan for a safe and inclusive working environment, per PAPPG Chapter II.E.9.`,
  },
  {
    id: 'selection',
    title: 'Recruitment and how selection works',
    url: '/eligibility.html',
    tags: ['selection', 'recruitment', 'how are students chosen', 'diversity', 'committee'],
    text: `A faculty committee reviews every complete application against the personal statement, preparation relative to opportunity, references, and fit with the project areas. At least half of participants are recruited from institutions where STEM research opportunities are limited, including two-year colleges, and a significant fraction come from outside UA Little Rock — a minimum commitment with no upper limit, so a cohort composed entirely of external students would fully satisfy it. Outreach reaches diverse talent through community college partners, minority-serving institutions, and EPSCoR networks. Selection complies with Federal and NSF non-discrimination statutes and regulations (PAPPG Chapter XI.A); race, ethnicity, sex, age, and disability status are never eligibility criteria.`,
  },
  {
    id: 'accommodations',
    title: 'Disability accommodations',
    url: '/faq.html',
    tags: ['disability', 'accommodations', 'accessibility', 'fased'],
    text: `Accommodations for research and residential life are provided; request them early by emailing reu@ualr.edu so arrangements are ready before you arrive. NSF's Facilitation Awards for Scientists and Engineers with Disabilities (FASED) mechanism can additionally fund special assistance or equipment for work on NSF-supported projects.`,
  },
  {
    id: 'credit',
    title: 'Academic credit and transfers',
    url: '/faq.html',
    tags: ['credit', 'academic credit', 'transfer', 'transferring'],
    text: `Academic credit is optional; the solicitation permits offering credit as an option, but it is never required and you are never charged tuition to participate. Students transferring schools over the summer are not disqualified: the solicitation explicitly permits students transferring from one institution to another who are enrolled at neither during the intervening summer.`,
  },
  {
    id: 'contact',
    title: 'Contact information',
    url: '/',
    tags: ['contact', 'email', 'phone', 'address', 'reach', 'question', 'help'],
    text: `Contact the REU Program Office at reu@ualr.edu or (501) 916-3000. Mailing address: Donaghey College of Science, Technology, Engineering, and Mathematics, University of Arkansas at Little Rock, 2801 S. University Ave., Little Rock, AR 72204. The Principal Investigator's direct contact information is published upon award notification. The program answers every prospective applicant, faculty advisor, and community college partner.`,
  },
  {
    id: 'account',
    title: 'Applicant accounts and email verification',
    url: '/account.html',
    tags: ['account', 'sign up', 'register', 'login', 'verify', 'password', 'email verification'],
    text: `To apply you create a free applicant account with your email and a password (at least 10 characters), then verify your email with a six-digit code that is emailed to you. Your account lets you track your application status. Your affiliation (UA Little Rock student vs. external) is derived from your verified email domain. You may submit one application per cycle.`,
  },
];

/** Load optional extra chunks from data/knowledge.extra.json if present.
    Format: an array of { id, title, url, tags, text } objects. */
function loadExtraChunks() {
  try {
    const p = path.join(__dirname, '..', 'data', 'knowledge.extra.json');
    if (!fs.existsSync(p)) return [];
    const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((c) => c && typeof c.text === 'string' && c.text.trim());
  } catch (e) {
    console.warn('[chatbot] could not load knowledge.extra.json:', e.message);
    return [];
  }
}

const CHUNKS = BASE_CHUNKS.concat(loadExtraChunks());

// ---------- lexical retrieval ----------
const STOPWORDS = new Set(
  ('a an the and or but of to in on for with at by from is are was were be been being this that ' +
    'these those it its as do does did can could will would should i you your we our they them my me ' +
    'if then so than about into over under out up down what when where who whom which how why does ' +
    'have has had not no yes get got need want know tell explain more most any some all am pm').split(
    /\s+/
  )
);

function tokenize(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter((t) => t && t.length > 1 && !STOPWORDS.has(t));
}

// Precompute a term set for each chunk (title + tags weighted higher).
const INDEX = CHUNKS.map((c) => {
  const bodyTerms = tokenize(c.text);
  const boostTerms = tokenize(c.title + ' ' + (c.tags || []).join(' '));
  const freq = new Map();
  const bump = (t, w) => freq.set(t, (freq.get(t) || 0) + w);
  bodyTerms.forEach((t) => bump(t, 1));
  boostTerms.forEach((t) => bump(t, 3)); // titles/tags matter more
  return { chunk: c, freq };
});

/**
 * Retrieve the top-k most relevant knowledge chunks for a query.
 * Simple term-overlap scoring with title/tag boosting. Returns [] if nothing
 * meaningfully matches, which the caller uses to decide on a fallback answer.
 * @param {string} query
 * @param {number} k
 * @returns {Chunk[]}
 */
function retrieve(query, k = 3) {
  const qTerms = tokenize(query);
  if (!qTerms.length) return [];
  const scored = INDEX.map(({ chunk, freq }) => {
    let score = 0;
    const seen = new Set();
    for (const t of qTerms) {
      if (freq.has(t) && !seen.has(t)) {
        score += freq.get(t);
        seen.add(t);
      }
    }
    return { chunk, score };
  })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
  return scored.map((s) => s.chunk);
}

module.exports = { CHUNKS, retrieve, tokenize };
