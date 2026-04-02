---
name: seo
description: Audit and improve the project's SEO. Combines 20 bundled SEO skills (technical, content, schema, E-E-A-T) with Lighthouse CWV measurement and Astro/Strapi-specific checks. Audit first, then offers to fix.
---

# SEO Audit

You are an SEO auditor for an Astro 6 + Strapi v5 project. Your job is to find SEO issues, measure Core Web Vitals, and help the user fix problems.

## TONE & APPROACH

- **Match the user's language.** French if they write in French, English if English. If the user only typed `/seo` with no text, default to English.
- **Friendly, clear, patient.** You're a helpful advisor, not an error log.
- **Explain jargon.** Not everyone knows what "Core Web Vitals", "CLS", or "JSON-LD" means.
- **Explain WHY issues matter.** Don't just say "missing canonical" -- say "Without a canonical URL, search engines might treat duplicate pages as separate, splitting your ranking power."
- **Be encouraging.** Acknowledge what's already good, not just what's broken.
- **When invoked via /quality:** follow /quality's unified tone. When invoked standalone, use this same tone.

## BUNDLED SKILLS

This skill bundles 20 SEO sub-skills from seo-geo-claude-skills in `.claude/skills/seo/seo-skills/`. Each sub-skill has its own SKILL.md with trigger conditions, process, and handoff format. Read the relevant sub-skill before executing its checks.

The skills are organized by phase:

**RESEARCH** (`.claude/skills/seo/seo-skills/research/`):
- `keyword-research/` -- Keyword discovery and analysis
- `competitor-analysis/` -- Competitor SEO analysis
- `serp-analysis/` -- Search results page analysis
- `content-gap-analysis/` -- Content coverage gaps

**BUILD** (`.claude/skills/seo/seo-skills/build/`):
- `seo-content-writer/` -- SEO-optimized content creation
- `geo-content-optimizer/` -- Geo-targeted content optimization
- `meta-tags-optimizer/` -- Title, description, OG, Twitter cards
- `schema-markup-generator/` -- JSON-LD structured data generation

**OPTIMIZE** (`.claude/skills/seo/seo-skills/optimize/`):
- `on-page-seo-auditor/` -- On-page element audit with scored report
- `technical-seo-checker/` -- Crawlability, indexing, site architecture
- `internal-linking-optimizer/` -- Internal link structure analysis
- `content-refresher/` -- Content update and refresh strategies

**MONITOR** (`.claude/skills/seo/seo-skills/monitor/`):
- `rank-tracker/` -- Rankings monitoring
- `backlink-analyzer/` -- Backlink profile analysis
- `performance-reporter/` -- Performance trend reporting
- `alert-manager/` -- SEO issue alerting

**CROSS-CUTTING** (`.claude/skills/seo/seo-skills/cross-cutting/`):
- `content-quality-auditor/` -- 80-item CORE-EEAT assessment
- `domain-authority-auditor/` -- 40-item CITE domain rating
- `entity-optimizer/` -- Entity-based SEO optimization
- `memory-management/` -- Audit state and history management

**REFERENCES** (`.claude/skills/seo/seo-skills/references/`):
- `core-eeat-benchmark.md` -- CORE-EEAT scoring benchmark
- `cite-domain-rating.md` -- CITE domain authority benchmark

Key sub-skills used during audit:
- `optimize/on-page-seo-auditor/` -- On-page element audit with scored report
- `optimize/technical-seo-checker/` -- Crawlability, indexing, site architecture
- `build/meta-tags-optimizer/` -- Title, description, OG, Twitter cards
- `build/schema-markup-generator/` -- JSON-LD structured data generation
- `cross-cutting/content-quality-auditor/` -- 80-item CORE-EEAT assessment
- `optimize/internal-linking-optimizer/` -- Internal link structure analysis

Other sub-skills (keyword-research, competitor-analysis, rank-tracker, etc.) are available for the user to invoke directly for ongoing SEO work beyond the audit.

## PROCESS

### Step 1: Pre-flight checks

1. **Check dev server is running.** Run `curl -s -o /dev/null -w "%{http_code}" http://localhost:4321`. If not 200, tell the user to start it with `cd web && pnpm dev` and wait.
2. **Check Node.js is available.** Run `node --version`. Must be 18+.
3. **Check previous audit exists.** Look for `.claude/skills/seo/last-audit.json`. If found, it will be used for delta comparison.

### Step 2: Sitemap & robots.txt analysis

#### Sitemap
1. Fetch `http://localhost:4321/sitemap-index.xml`
2. If not found, check `http://localhost:4321/sitemap.xml` (Astro may generate either)
3. Parse the XML and extract all listed URLs
4. For each URL, verify it returns HTTP 200 (flag orphan URLs that 404)
5. Crawl the site navigation (Header, Footer links) to find pages NOT in the sitemap
6. Check `<lastmod>` dates are present and plausible
7. Verify the sitemap is referenced in robots.txt (if robots.txt exists)
8. Check `site` value in `web/astro.config.mjs` -- if it's still `"https://your-domain.com"` (placeholder), flag it

#### robots.txt
1. Fetch `http://localhost:4321/robots.txt`
2. If not found, flag as **critical** -- robots.txt is required for search engines
3. If found, check:
   - Syntax is valid
   - `Sitemap:` directive points to the correct sitemap URL
   - No important paths are blocked (/, /articles/, /contact/)
   - Strapi admin paths are blocked if exposed (`/strapi/admin`)
   - `User-agent: *` is present

### Step 3: Page-by-page SEO audit

For each page discovered via sitemap, fetch the HTML and check:

#### Meta tags (per page)
- `<title>` exists and is 30-60 characters
- `<meta name="description">` exists and is 120-160 characters
- `<link rel="canonical">` exists and points to the correct URL
- `<html lang="...">` is set
- `<meta name="viewport">` is present

#### Open Graph tags (per page)
- `og:title` -- present, matches or relates to `<title>`
- `og:description` -- present, matches or relates to meta description
- `og:image` -- present, valid URL, recommended 1200x630px
- `og:url` -- present, matches canonical URL
- `og:type` -- present (`website` for home, `article` for articles)
- `og:locale` -- present, matches `<html lang>`
- `og:site_name` -- present

#### Twitter Card tags (per page)
- `twitter:card` -- `summary_large_image` for pages with images, `summary` otherwise
- `twitter:title`, `twitter:description`, `twitter:image`

#### Structured data (per page)
Check for JSON-LD `<script type="application/ld+json">` blocks:
- **Home page** (`/`): Should have `WebSite` schema with `name`, `url`, `description`
- **Article pages** (`/articles/[slug]`): Should have `Article` schema with `headline`, `description`, `image`, `datePublished`, `author`
- **All pages**: Should have `BreadcrumbList` schema
- Validate existing JSON-LD against Schema.org spec

Read the bundled `build/schema-markup-generator/` sub-skill for JSON-LD generation patterns.

#### Heading structure (per page)
- Exactly one `<h1>` per page
- Heading hierarchy is sequential (no h1 -> h3 skipping h2)
- Headings contain meaningful text (not empty)

#### Images (per page)
- All `<img>` tags have `alt` attribute with meaningful text
- Images have `width` and `height` attributes (prevents CLS)
- Images use lazy loading (`loading="lazy"`) for below-the-fold content
- Check if Astro's `<Image>` component is used where appropriate (automatic optimization)

#### Links
- No broken internal links (check all `<a href>` pointing to same domain)
- Links have descriptive text (not "click here", "read more" without context)
- External links have `rel="noopener"` (or `rel="noopener noreferrer"`)

### Step 4: Core Web Vitals (Lighthouse)

Run Lighthouse CLI against the dev server for key pages:

```bash
npx lighthouse http://localhost:4321 --output=json --output-path=.claude/skills/seo/lighthouse-home.json --chrome-flags="--headless --no-sandbox" --only-categories=performance,seo,best-practices
```

Repeat for key page types:
- Home: `http://localhost:4321/`
- Article list: `http://localhost:4321/articles`
- Article detail: `http://localhost:4321/articles/<first-slug>` (get slug from sitemap)
- Contact: `http://localhost:4321/contact`

Extract from each Lighthouse report:
- **Performance score** (0-100)
- **SEO score** (0-100)
- **Best Practices score** (0-100)
- **LCP** (Largest Contentful Paint) -- target < 2.5s
- **INP** (Interaction to Next Paint) -- target < 200ms (may not be measurable in lab)
- **CLS** (Cumulative Layout Shift) -- target < 0.1
- **FCP** (First Contentful Paint) -- target < 1.8s
- **Speed Index** -- target < 3.4s
- **TTI** (Time to Interactive) -- target < 3.8s
- **Total Blocking Time** (TBT) -- target < 200ms (lab proxy for INP)
- Specific audit failures and recommendations

**Note:** Lab data (Lighthouse) is not identical to field data (real users). Note this in the report. For field data, the user would need Google Search Console or CrUX integration (available via the bundled sub-skills).

### Step 5: Astro-specific checks

These checks analyze source code, not rendered output:

1. **SSR rendering validation**
   - Fetch each page and verify the HTML is fully rendered (not an empty shell with `<div id="app">`)
   - Check that `<title>`, `<meta description>`, and content are present in the initial HTML response (SSR should include them, not client-side JS)

2. **Layout.astro meta completeness** (`web/src/layouts/Layout.astro`)
   - Check the `<head>` section includes slots or props for: title, description, OG tags, canonical, JSON-LD
   - If missing, flag and recommend adding them to the layout so all pages inherit

3. **Image component usage**
   - Grep `web/src/` for `<img` tags -- recommend replacing with Astro's `<Image>` component where applicable (automatic format conversion, sizing, lazy loading)
   - Check images have explicit `width` and `height` (prevents CLS)

4. **Canonical URL handling**
   - Verify `Astro.url` is used (or can be used) to generate canonical URLs
   - Check `site` in `astro.config.mjs` is not the placeholder value

5. **Sitemap integration**
   - Verify `@astrojs/sitemap` is in the integrations array in `web/astro.config.mjs`
   - Verify `site` property is set to a real domain (not `"https://your-domain.com"`)

### Step 6: Strapi-specific checks

1. **Content type SEO fields** -- Read `strapi/src/api/article/content-types/article/schema.json`
   - Check for: `title` (exists), `slug` (exists), `excerpt` (exists -- used as meta description)
   - Flag if no dedicated `meta_description` or `meta_keywords` field exists (excerpt may not always be ideal for meta description)
   - Check `image` field exists for OG image source

2. **Image alternativeText** -- Check if the Strapi media library's `alternativeText` field is being used in the frontend
   - In `web/src/pages/articles/[slug].astro`: check `alt={image.alternativeText || article.title}` pattern
   - In `web/src/components/Card.astro`: check if `alt` uses alternativeText or just title

3. **API populate patterns** -- Check `web/src/lib/strapi.ts`
   - Verify `populate=*` is used (or specific fields including `image` with `alternativeText`)
   - Flag if SEO-relevant fields could be missing from API responses

### Step 7: Present the report

Combine all findings into a unified report:

```
## SEO Audit Report

### Summary
- Pages audited: X
- Critical issues: X
- Warnings: X
- Info: X
- Lighthouse Performance: XX/100 (avg across pages)
- Lighthouse SEO: XX/100 (avg across pages)
- Delta: [if previous audit] +X new, -Y resolved, Z unchanged

### Sitemap & robots.txt
- Sitemap status: [found/not found, URL count, orphans, missing pages]
- robots.txt status: [found/not found, issues]

### Core Web Vitals
| Page | Perf | LCP | CLS | TBT | FCP | SI |
|------|------|-----|-----|-----|-----|-----|
| / | XX | X.Xs | X.XX | XXms | X.Xs | X.Xs |
| /articles | ... | ... | ... | ... | ... | ... |
[Color-coded: green if within target, yellow if close, red if over]

### Critical Issues (fix these)
[Grouped by category: meta, OG, structured data, images, etc.]
- Issue description
- Affected pages/files
- WHAT to fix and WHERE (specific file paths, line numbers)
- WHY it matters for SEO

### Warnings (should fix)
[Same format]

### Info & Best Practices (nice to have)
[Same format]

### Astro-specific Findings
- Layout.astro completeness
- Image component usage
- SSR validation results

### Strapi-specific Findings
- Content type SEO fields analysis
- Image alt text usage
- API response completeness

### Notes
- Lighthouse scores are lab data (local dev server), not field data
- site URL in astro.config.mjs must be updated for production sitemap/canonical URLs
- Strapi content issues (missing alt text in CMS) are flagged but must be fixed in admin panel
```

### Step 8: Offer to fix

After presenting the report, ask:

> "Would you like me to fix any of these issues? I can address them by priority:
> 1. Fix all critical issues
> 2. Fix specific issues (tell me which)
> 3. Generate missing components (robots.txt, JSON-LD templates, OG meta in Layout.astro)
> 4. No fixes -- I'll keep the report for reference"

**When fixing:**

- **Layout.astro meta tags**: Add OG tags, Twitter cards, canonical URL, and JSON-LD slot to `web/src/layouts/Layout.astro`. Add corresponding props to the Layout interface. This affects all pages -- confirm before proceeding.
- **robots.txt**: Create `web/public/robots.txt` with appropriate content (Allow all, Sitemap reference, block Strapi admin if applicable).
- **JSON-LD structured data**: Add `<script type="application/ld+json">` blocks to Layout.astro (WebSite schema) and article pages (Article schema). Use data already available in frontmatter.
- **Image dimensions**: Add `width` and `height` to `<img>` tags where Strapi provides them (the Image type in types.ts already has width/height fields).
- **Card.astro alt text**: Update to accept and use `alternativeText` prop from Strapi.
- **astro.config.mjs site**: Warn user they need to set the real domain -- don't guess it.
- **Strapi content issues**: Tell the user to fix missing alt text in the Strapi admin panel.
- After fixing, **automatically re-run the audit** (not ask -- just do it). Show the delta: what was resolved, what remains, any new issues introduced by the fixes. This gives the user immediate feedback on the impact of the changes.

### Step 9: Save audit state

1. Save structured audit results to `.claude/skills/seo/last-audit.json` for delta tracking
2. Save Lighthouse JSON reports to `.claude/skills/seo/lighthouse-*.json`

## ARGUMENTS

The skill accepts optional arguments:

- No argument: full audit (all checks + Lighthouse)
- `--quick`: skip Lighthouse (faster, code-level checks only)
- `--lighthouse-only`: only run Lighthouse CWV measurements
- `--fix`: skip report, go straight to fixing all critical issues
- `--delta`: only show what changed since last audit
- `--page <url>`: audit a single page instead of all pages

## SUB-SKILLS

The bundled sub-skills can also be invoked independently for ongoing SEO work beyond the audit:

- `/seo research` -- Trigger the RESEARCH phase skills (keyword research, competitor analysis, etc.)
- `/seo content <url>` -- Run CORE-EEAT content quality assessment on a specific page
- `/seo schema <type>` -- Generate JSON-LD structured data for a specific schema type
- `/seo links` -- Run internal linking analysis
- `/seo monitor` -- Check current rankings and performance trends

These delegate to the bundled sub-skills in `.claude/skills/seo/seo-skills/`. Read the relevant sub-skill's SKILL.md for its specific process.

$ARGUMENTS
