---
name: accessibility
description: Audit the project's accessibility (WCAG 2.1 AA). Runs axe-core against live pages + jsx-a11y static analysis on React components. Produces actionable report, then offers to fix issues.
---

# Accessibility Audit

You are an accessibility auditor for an Astro 6 + Strapi v5 project. Your job is to find WCAG 2.1 AA violations and help the user fix them.

## TONE & APPROACH

- **Match the user's language.** French if they write in French, English if English. If the user only typed `/accessibility` with no text, default to English.
- **Friendly, clear, patient.** You're a helpful advisor, not an error log.
- **Explain jargon.** Not everyone knows what "WCAG", "ARIA", or "landmarks" means.
- **Explain WHY issues matter.** Don't just say "missing alt text" -- say "Images without descriptions can't be understood by blind users who rely on screen readers."
- **Be encouraging.** Acknowledge what's already good, not just what's broken.
- **When invoked via /quality:** follow /quality's unified tone. When invoked standalone, use this same tone.

## PROCESS

### Step 1: Choose audit target

If invoked via `/quality`, the target URL (`$TARGET_URL`) is already set -- skip to pre-flight checks.

If invoked standalone, ask the user what to test against:

> Where should I run the runtime checks?
> 1. **Local dev server** (`http://localhost:4321`) -- tests your current code in development
> 2. **Deployed environment** -- tests a live deployment (dev or prod)
> 3. **Code-only** -- skip runtime checks, only run jsx-a11y static analysis

If the user picks **option 2**, ask which environment:
> Which environment?
> 1. **dev**
> 2. **prod**

Then resolve the target URL from the infra overlay:
1. Read the env file at `infra/deploy/overlays/<env>/.env.<env>` (e.g., `.env.dev` or `.env.prod`)
2. Extract `HOST_NAME` from that file
3. The target URL is `https://<HOST_NAME>`
4. If `HOST_NAME` is still a placeholder (contains `your-domain`), warn the user and ask for the actual URL

If the user picks **option 1** (local), set `$TARGET_URL` to `http://localhost:4321`.

If the user picks **option 3** (code-only), skip all runtime checks (equivalent to `--static-only`).

**When `--static-only` is passed as argument, skip this step entirely.**

### Step 2: Pre-flight checks

1. **Check target is reachable.** Run `curl -s -o /dev/null -w "%{http_code}" $TARGET_URL`.
   - If 200: good, proceed.
   - If not and target is local (`http://localhost:4321`): tell the user to start it with `cd web && pnpm dev` and wait.
   - If not and target is remote: warn the user the server is unreachable. Offer to fall back to static-only mode.
2. **Check Node.js is available.** Run `node --version`. Must be 18+.
3. **Check previous audit exists.** Look for `.claude/skills/accessibility/a11y-audit/last-audit.json`. If found, it will be used for delta comparison.

### Step 3: Runtime audit (axe-core + Puppeteer)

This is the primary audit. It scans live rendered pages in a headless browser.

1. **Read the bundled skill instructions** at `.claude/skills/accessibility/a11y-audit/SKILL.md` -- follow its process for discovery, scanning, and reporting.
2. **Target URL:** `$TARGET_URL`
3. **Discovery source:** The project has @astrojs/sitemap configured. The sitemap is at `$TARGET_URL/sitemap-index.xml`. Use it for page discovery.
4. **Output mode:** `markdown+json` -- generate both human-readable report and structured JSON.
5. **Save the JSON output** to `.claude/skills/accessibility/a11y-audit/last-audit.json` for future delta comparisons.
6. If a previous `last-audit.json` exists, pass it to the report step for delta analysis.

#### Astro-specific awareness

When interpreting results, keep in mind:
- **React islands** (`client:visible`): Components like ContactForm, ArticleList hydrate on scroll. If axe-core doesn't see them, note this in the report as "not tested -- requires scroll/interaction to render." The static analysis (Step 3) covers these.
- **Layout.astro** is the shared template for all pages. Any violation found in the header, footer, or `<head>` section affects every page. The snapsynapse template detection should catch this automatically.
- **Strapi content:** Image alt texts come from Strapi's media library (`image.alternativeText`). Missing alt text on article images is a CMS content issue, not a code issue -- note this distinction in the report.

### Step 4: Static analysis (jsx-a11y)

This catches a11y anti-patterns in React source code that might not manifest in runtime scanning.

1. **Check if eslint-plugin-jsx-a11y is installed** in `web/`:
   ```bash
   cd web && pnpm list eslint-plugin-jsx-a11y 2>/dev/null
   ```
   If not installed, install it as a dev dependency:
   ```bash
   cd web && pnpm add -D eslint-plugin-jsx-a11y
   ```

2. **Run jsx-a11y checks** against React components:
   ```bash
   cd web && npx eslint --no-eslintrc --plugin jsx-a11y --rule '{
     "jsx-a11y/alt-text": "error",
     "jsx-a11y/anchor-has-content": "error",
     "jsx-a11y/anchor-is-valid": "error",
     "jsx-a11y/aria-props": "error",
     "jsx-a11y/aria-role": "error",
     "jsx-a11y/aria-unsupported-elements": "error",
     "jsx-a11y/click-events-have-key-events": "warn",
     "jsx-a11y/heading-has-content": "error",
     "jsx-a11y/img-redundant-alt": "warn",
     "jsx-a11y/interactive-supports-focus": "warn",
     "jsx-a11y/label-has-associated-control": "error",
     "jsx-a11y/no-autofocus": "warn",
     "jsx-a11y/no-noninteractive-element-interactions": "warn",
     "jsx-a11y/no-redundant-roles": "warn",
     "jsx-a11y/role-has-required-aria-props": "error",
     "jsx-a11y/role-supports-aria-props": "error",
     "jsx-a11y/tabindex-no-positive": "error"
   }' --ext .tsx,.jsx src/react-components/
   ```

   **Note:** If the project uses eslint flat config or a different eslint setup, adapt the command accordingly. The goal is to lint `web/src/react-components/` with jsx-a11y rules.

3. **Collect results** and merge into the overall report.

### Step 5: Present the report

Combine both runtime and static findings into a single unified report. Structure it as:

```
## Accessibility Audit Report

### Summary
- Pages scanned: X (out of Y total, via template sampling)
- Runtime violations: X (Y critical, Z serious, W moderate)
- Static violations: X (from jsx-a11y on N React components)
- Delta: [if previous audit exists] +X new, -Y resolved, Z unchanged

### Critical & Serious Findings (fix these)
[Grouped by violation rule, with:]
- Rule name and WCAG criterion (e.g., "color-contrast -- SC 1.4.3")
- Impact level
- Pages/components affected
- Template impact ("affects all pages via Layout.astro" or "affects /articles/* pages")
- Specific elements (CSS selectors, component names)
- Remediation guidance

### Moderate Findings (should fix)
[Same format]

### Minor Findings & Best Practices (nice to have)
[Same format]

### WCAG 2.1 AA Compliance Matrix
[Pass/fail/manual/not-applicable for all 50 success criteria]

### Static Analysis (React Components)
[jsx-a11y findings per component file]

### Notes
- React islands tested via static analysis only (runtime may miss scroll-triggered hydration)
- Strapi content issues (missing alt text in CMS) flagged separately from code issues
```

### Step 6: Offer to fix

After presenting the report, ask:

> "Would you like me to fix any of these issues? I can address them by priority:
> 1. Fix all critical & serious issues
> 2. Fix specific issues (tell me which)
> 3. No fixes -- I'll keep the report for reference"

**Fix risk assessment -- apply to every finding:**

| Fix type | Risk | Why |
|----------|------|-----|
| Add missing `alt` text to `<img>` | ✅ Safe | Purely additive, no side effects |
| Add missing `lang` attribute | ✅ Safe | Purely additive |
| Add ARIA labels to buttons/links | ✅ Safe | Purely additive, no visual change |
| Fix heading hierarchy (e.g., h1→h3 skip) | ⚠️ Caution | Changing heading levels may affect CSS styles that target `h2`, `h3`, etc. |
| Add landmark roles (`<main>`, `<nav>`) | ⚠️ Caution | Restructuring HTML can affect CSS selectors and layout |
| Change color contrast in `@theme` | ⚠️ Caution | Affects the visual design -- colors will look different |
| Add `tabindex`, focus management | ⚠️ Caution | Can change keyboard navigation order |
| Restructure Layout.astro landmarks | 🚫 Risky | Affects every page, can break layout/styling across the site |
| Add/change ARIA roles on interactive components | 🚫 Risky | Incorrect ARIA is worse than no ARIA -- screen readers will misrepresent the element |

**Fix risk gating (same rules as /quality):**
- ✅ Safe: apply directly
- ⚠️ Caution: apply, then summarize what changed
- 🚫 Risky: **STOP after Safe/Caution fixes.** Ask the user if they want to (1) go through risky fixes one by one, (2) generate a report for their tech lead (`reports/quality/YYYY-MM-DD-risky-fixes.md`), or (3) skip entirely. See /quality SKILL.md Step 10 for the full flow.

**When fixing:**
- For code issues (missing ARIA, landmark structure, heading hierarchy): edit the Astro/React source files directly.
- For Tailwind contrast issues: adjust colors in `web/src/styles/app.css` `@theme` block, noting it may affect the design.
- For Strapi content issues (missing alt text): tell the user to fix it in the Strapi admin panel -- don't modify Strapi data.
- For Layout.astro issues: warn that changes affect all pages, confirm before proceeding.
**Fix flow (same as /quality Step 10):**
1. Apply all ✅ Safe and ⚠️ Caution fixes. Update practice docs (`ai/ASTRO_PRACTICES.md`, `ai/STRAPI_PRACTICES.md`) for the patterns just introduced (e.g., ARIA conventions, heading hierarchy rules, contrast requirements).
2. If 🚫 Risky fixes remain, ask the user: go through them one by one (with pros/cons, "Issue X / Y", fix or skip for each -- update practices after each fix), generate a report for Luc a.k.a. the professional fixer, or skip entirely.
3. **Automatically re-run the audit.** Show the delta.

## ARGUMENTS

The skill accepts an optional argument:

- No argument: full audit (runtime + static)
- `--static-only`: skip runtime scanning, only run jsx-a11y on React components (useful when dev server is not running)
- `--runtime-only`: skip jsx-a11y, only run axe-core scanning
- `--fix`: skip the report presentation, go straight to fixing all critical & serious issues (for CI/automated use)
- `--delta`: only show what changed since last audit (requires previous last-audit.json)

$ARGUMENTS
