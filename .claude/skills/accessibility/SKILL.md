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

### Step 1: Pre-flight checks

1. **Check dev server is running.** Run `curl -s -o /dev/null -w "%{http_code}" http://localhost:4321`. If not 200, tell the user to start it with `cd web && pnpm dev` and wait.
2. **Check Node.js is available.** Run `node --version`. Must be 18+.
3. **Check previous audit exists.** Look for `.claude/skills/accessibility/a11y-audit/last-audit.json`. If found, it will be used for delta comparison.

### Step 2: Runtime audit (axe-core + Puppeteer)

This is the primary audit. It scans live rendered pages in a headless browser.

1. **Read the bundled skill instructions** at `.claude/skills/accessibility/a11y-audit/SKILL.md` -- follow its process for discovery, scanning, and reporting.
2. **Target URL:** `http://localhost:4321`
3. **Discovery source:** The project has @astrojs/sitemap configured. The sitemap is at `http://localhost:4321/sitemap-index.xml`. Use it for page discovery.
4. **Output mode:** `markdown+json` -- generate both human-readable report and structured JSON.
5. **Save the JSON output** to `.claude/skills/accessibility/a11y-audit/last-audit.json` for future delta comparisons.
6. If a previous `last-audit.json` exists, pass it to the report step for delta analysis.

#### Astro-specific awareness

When interpreting results, keep in mind:
- **React islands** (`client:visible`): Components like ContactForm, ArticleList hydrate on scroll. If axe-core doesn't see them, note this in the report as "not tested -- requires scroll/interaction to render." The static analysis (Step 3) covers these.
- **Layout.astro** is the shared template for all pages. Any violation found in the header, footer, or `<head>` section affects every page. The snapsynapse template detection should catch this automatically.
- **Strapi content:** Image alt texts come from Strapi's media library (`image.alternativeText`). Missing alt text on article images is a CMS content issue, not a code issue -- note this distinction in the report.

### Step 3: Static analysis (jsx-a11y)

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

### Step 4: Present the report

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

### Step 5: Offer to fix

After presenting the report, ask:

> "Would you like me to fix any of these issues? I can address them by priority:
> 1. Fix all critical & serious issues
> 2. Fix specific issues (tell me which)
> 3. No fixes -- I'll keep the report for reference"

**When fixing:**
- For code issues (missing ARIA, landmark structure, heading hierarchy): edit the Astro/React source files directly.
- For Tailwind contrast issues: adjust colors in `web/src/styles/app.css` `@theme` block, noting it may affect the design.
- For Strapi content issues (missing alt text): tell the user to fix it in the Strapi admin panel -- don't modify Strapi data.
- For Layout.astro issues: warn that changes affect all pages, confirm before proceeding.
- After fixing, **automatically re-run the audit** (not ask -- just do it). Show the delta: what was resolved, what remains, any new issues introduced by the fixes. This gives the user immediate feedback on the impact of the changes.

## ARGUMENTS

The skill accepts an optional argument:

- No argument: full audit (runtime + static)
- `--static-only`: skip runtime scanning, only run jsx-a11y on React components (useful when dev server is not running)
- `--runtime-only`: skip jsx-a11y, only run axe-core scanning
- `--fix`: skip the report presentation, go straight to fixing all critical & serious issues (for CI/automated use)
- `--delta`: only show what changed since last audit (requires previous last-audit.json)

$ARGUMENTS
