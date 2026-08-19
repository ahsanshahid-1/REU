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
    text: `This is an NSF Research Experiences for Undergraduates (REU) Site hosted at the University of Arkansas at Little Rock (UA Little Rock). Known as SURE-AI (Summer Undergraduate Research Experience in AI), it brings ten undergraduate students from institutions across the United States into active faculty research groups for an eight-week, in-residence summer research program. The Site's common focus is efficient, secure, and trustworthy artificial intelligence: edge and multimodal AI, cyber defense, immersive analytics, and hardware-aware deployment. No prior research experience is required and there is no application fee. The program is pending an NSF award.`,
  },
  {
    id: 'glance',
    title: 'Program at a glance',
    url: '/',
    tags: ['stipend', 'housing', 'meals', 'duration', 'participants', 'format', 'summary', 'money', 'pay'],
    text: `Program at a glance: Host is UA Little Rock. Fields are artificial intelligence, cybersecurity, and data science. There are 10 participants per year. Format is summer, in residence. Duration is 8 weeks. The stipend is $700 per week ($5,600 total for the eight weeks). Housing and meals are provided. Contact: reu@ualr.edu.`,
  },
  {
    id: 'dates',
    title: 'Key dates and timeline (tentative)',
    url: '/faq.html',
    tags: ['dates', 'deadline', 'timeline', 'when', 'apply open', 'decisions', 'schedule'],
    text: `All program and application dates are currently tentative and subject to change; the exact dates will be posted on the website once they are confirmed. Applications are accepted only through NSF ETAP (etap.nsf.gov) and are expected to open around January 2027. The application deadline and decision dates are set on NSF ETAP and will be posted here once announced. The program is an eight-week, in-residence experience ending with a research symposium; program dates are tentative, currently targeted around December 2026, and subject to change. Check the website or NSF ETAP for the confirmed application window and program dates.`,
  },
  {
    id: 'apply-requirements',
    title: 'How to apply and what the application asks for',
    url: '/faq.html',
    tags: ['apply', 'application', 'requirements', 'transcript', 'references', 'statement', 'how to apply', 'etap'],
    text: `Applications are accepted only through NSF ETAP at etap.nsf.gov. There is no separate application form or account on this website, and there is no application fee. In ETAP you provide: contact details and confirmation of NSF eligibility; your institution, degree program, and academic year; a ranked choice of the project areas; a personal statement of 300 to 600 words (read for curiosity, not polish); an unofficial transcript as a PDF (there is no GPA cutoff); and the names and emails of two references, who are contacted directly (no letters for you to chase). To apply, go to NSF ETAP (etap.nsf.gov). Application dates are tentative and will be posted on the website once confirmed.`,
  },
  {
    id: 'eligibility',
    title: 'Who is eligible',
    url: '/eligibility.html',
    tags: ['eligibility', 'eligible', 'citizen', 'international', 'community college', 'transfer', 'who can apply'],
    text: `Eligibility follows the NSF REU program rules (NSF 23-601). You are eligible if you are a U.S. citizen, U.S. national, or U.S. permanent resident, AND you are enrolled in a degree program (part time or full time) leading to a bachelor's or associate degree. Community college and associate-degree students are fully eligible and strongly encouraged. First- and second-year students are encouraged. Students transferring between institutions, and enrolled at neither during the intervening summer, are permitted, as are recent high-school graduates already accepted to an undergraduate institution but not yet started. You are NOT eligible if you have already received your bachelor's degree and are no longer enrolled as an undergraduate, or if you are an international student without U.S. citizenship, national status, or permanent residency. The citizenship rule is an NSF-wide requirement for all REU Sites.`,
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
    text: `The program is fully funded. Research stipend is $700 per week for 8 weeks ($5,600 total), paid biweekly across the summer rather than as a lump sum. Housing (a furnished on-campus residence hall), meals via a weekly allowance, round-trip travel to Little Rock, and laboratory use fees are all provided as NSF participant support costs. There is no application fee and no tuition is required. NSF forbids charging students for access to common campus facilities. The stipend is a research training stipend, not a salary, so participants are not employees. Stipend funds may be taxable; NSF points students to the IRS Tax Benefits for Education page.`,
  },
  {
    id: 'research-areas',
    title: 'Research project areas',
    url: '/research.html',
    tags: ['research', 'projects', 'areas', 'topics', 'themes', 'labs', 'what will i do'],
    text: `Applicants rank five research pathways in efficient, secure, and trustworthy AI and are matched with a faculty mentor whose active work fits their interests: (1) communication-efficient federated adaptation at the edge; (2) efficient multimodal AI from local GPU to edge and optional FPGA; (3) data-quality-aware adaptive and explainable cyber defense; (4) trustworthy immersive, wearable, and visual-analytics AI, using the Emerging Analytics Center's CAVE and VR/MR resources; and (5) robust learned space-optical communications with hardware-aware deployment. Each pathway has a confirmed baseline and a complete fallback.`,
  },
  {
    id: 'weekly',
    title: 'What a summer looks like week by week',
    url: '/research.html',
    tags: ['schedule', 'week', 'activities', 'seminar', 'symposium', 'what happens'],
    text: `The eight-week program runs in three phases. Weeks 1-2 are orientation (program expectations, code of conduct, training in responsible and ethical conduct of research) and a skills bootcamp, plus literature analysis, question refinement, and baseline replication. Weeks 3-6 are sustained team research with your mentor, taking increasing ownership of a bounded intervention, ablation, robustness study, deployment comparison, or failure analysis, with a weekly cohort exchange and professional-development workshops on graduate school, careers, and scientific communication. Weeks 7-8 cover final validation, documentation, scientific writing, poster and oral communication, the final research symposium where every student presents, and continuation planning. Scope gates fall at Weeks 2, 5, and 7. After the summer, mentors continue interacting during the academic year, with conference travel support, recommendation letters, graduate-school guidance, and publication support where results warrant.`,
  },
  {
    id: 'facilities',
    title: 'Research environment and facilities',
    url: '/research.html',
    tags: ['facilities', 'labs', 'centers', 'environment', 'university', 'where'],
    text: `UA Little Rock is a metropolitan public research university. Research spans the Donaghey College of Science, Technology, Engineering, and Mathematics and the university's research centers. SURE-AI students use institutional GPU/HPC and edge hardware (including Jetson AGX Orin kits), the George W. Donaghey Emerging Analytics Center (immersive visualization and extended reality, including a CAVE, plus VR/MR and Project Aria), the CORE Center for cybersecurity and cyber simulation, the Center for Advanced Research in Entity Resolution and Information Quality (ERIQ) for data quality and provenance, and Arkansas Space Grant models for space-optical communications.`,
  },
  {
    id: 'mentoring',
    title: 'Mentoring and mentor training',
    url: '/research.html',
    tags: ['mentor', 'mentoring', 'mentor training', 'supervision', 'recommendation letters', 'publication', 'after the summer'],
    text: `Research mentors are drawn from faculty across the Donaghey College of STEM and the university's research centers, selected for expertise and a documented history of involving undergraduates in research, including publishing with undergraduate coauthors. All mentors complete structured training before the summer, covering research supervision and professional conduct, as NSF requires. The program monitors mentoring quality through program-level check-ins during the summer, so mentoring is supervised, not assumed. Mentoring continues after the summer to the extent practicable: academic-year interaction connecting the research to your course of study, recommendation letters, graduate-school guidance, and support toward publication when results warrant.`,
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
    text: `Academic credit is optional; NSF permits offering credit as an option, but it is never required and you are never charged tuition to participate. Students transferring schools over the summer are not disqualified: NSF explicitly permits students transferring from one institution to another who are enrolled at neither during the intervening summer.`,
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
    title: 'Where to apply (NSF ETAP account)',
    url: '/faq.html',
    tags: ['account', 'sign up', 'register', 'login', 'apply', 'etap', 'where to apply'],
    text: `This website does not have its own applicant account or application form. Applications are submitted only through NSF ETAP at etap.nsf.gov, where you create your account and track your application status. Go to etap.nsf.gov to start. Application dates are tentative and subject to change and will be posted on the website once confirmed.`,
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
