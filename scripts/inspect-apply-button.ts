// One-shot diagnostic: open a LinkedIn job URL with the user's existing
// Chrome profile, find the apply button, and dump everything our detector
// looks at — outerHTML of the button + its container, attributes, classes,
// inner SVG/IMG hrefs/alts. Run with:
//   npx tsx scripts/inspect-apply-button.ts <linkedin_job_url>
import { chromium } from "playwright";
import { homedir } from "os";
import { join } from "path";

const PROFILE = join(homedir(), ".jobbot-chrome");

async function main() {
  const url = process.argv[2];
  if (!url) {
    console.error("usage: tsx scripts/inspect-apply-button.ts <linkedin job url>");
    process.exit(1);
  }

  const ctx = await chromium.launchPersistentContext(PROFILE, {
    headless: false,
    channel: "chrome",
    args: ["--disable-blink-features=AutomationControlled"],
  });
  const page = await ctx.newPage();
  console.log(`opening ${url}`);
  await page.goto(url, { waitUntil: "domcontentloaded" });

  // Give LinkedIn a moment to hydrate the right-hand panel
  await page.waitForTimeout(8000);

  const stateReport = await page.evaluate(() => {
    return {
      finalUrl: location.href,
      title: document.title,
      bodyTextSnippet: document.body.innerText.slice(0, 600),
      buttonCount: document.querySelectorAll("button").length,
      anchorCount: document.querySelectorAll("a").length,
      hasSignInForm: !!document.querySelector("form[action*='login' i], input[type='password']"),
      hasJoinPrompt: !!document.querySelector("[class*='join' i], [data-test*='join' i]"),
      allButtonAriaLabels: Array.from(document.querySelectorAll("button"))
        .map((b) => (b.getAttribute("aria-label") || b.textContent || "").replace(/\s+/g, " ").trim())
        .filter(Boolean)
        .slice(0, 25),
    };
  });
  console.log("\n=== page state ===");
  console.log(JSON.stringify(stateReport, null, 2));

  const report = await page.evaluate(() => {
    type Found = {
      idx: number;
      tag: string;
      className: string;
      ariaLabel: string;
      textContent: string;
      outerHTML: string;
      icons: Array<{ tag: string; outerHTML: string; classList: string; src?: string; alt?: string; href?: string }>;
      ancestors: string[];
    };

    // Localized words for "apply" across the common LinkedIn UI languages.
    // Also matches the new English rebrand "LinkedIn Apply".
    const applyRe =
      /apply|başvur|solicit|candidat|postul|bewerb|sollicit|応募|지원/i;

    const buttons = Array.from(
      document.querySelectorAll<HTMLElement>("button, a[role='button'], a")
    );
    const found: Found[] = [];
    buttons.forEach((b, idx) => {
      const text = (b.textContent || "").replace(/\s+/g, " ").trim();
      const aria = (b.getAttribute("aria-label") || "").trim();
      // Match localized apply text, ANY apply-related class, or a LinkedIn
      // icon descendant (works regardless of language).
      const matches =
        applyRe.test(text) ||
        applyRe.test(aria) ||
        /apply/i.test(b.className) ||
        !!b.querySelector(
          "svg use[href*='linkedin' i], svg[aria-label*='linkedin' i], img[alt*='linkedin' i], img[src*='linkedin' i], [class*='linkedin' i]"
        );
      if (!matches) return;

      const iconEls = Array.from(b.querySelectorAll<HTMLElement>("svg, img, use, [class*='icon']"));
      const icons = iconEls.slice(0, 6).map((el) => ({
        tag: el.tagName.toLowerCase(),
        outerHTML: el.outerHTML.slice(0, 300),
        classList: Array.from(el.classList).join(" "),
        src: el.getAttribute("src") || undefined,
        alt: el.getAttribute("alt") || undefined,
        href: el.getAttribute("href") || el.getAttribute("xlink:href") || undefined,
      }));

      const ancestors: string[] = [];
      let cur: HTMLElement | null = b;
      for (let i = 0; i < 4 && cur; i++) {
        const parent: HTMLElement | null = cur.parentElement;
        if (!parent) break;
        ancestors.push(`${parent.tagName.toLowerCase()}.${Array.from(parent.classList).join(".")}`);
        cur = parent;
      }

      found.push({
        idx,
        tag: b.tagName.toLowerCase(),
        className: b.className,
        ariaLabel: aria,
        textContent: text,
        outerHTML: b.outerHTML.slice(0, 800),
        icons,
        ancestors,
      });
    });
    return found;
  });

  console.log(`\nfound ${report.length} apply-related button(s)\n`);
  report.forEach((r, i) => {
    console.log(`── candidate ${i + 1} ─────────────────`);
    console.log(`  tag      : ${r.tag}`);
    console.log(`  class    : ${r.className}`);
    console.log(`  ariaLabel: ${r.ariaLabel}`);
    console.log(`  text     : ${r.textContent}`);
    console.log(`  ancestors: ${r.ancestors.join(" › ")}`);
    if (r.icons.length) {
      console.log(`  icons (${r.icons.length}):`);
      r.icons.forEach((ic, j) => {
        console.log(`    [${j}] <${ic.tag}> class="${ic.classList}" src=${ic.src ?? "—"} alt=${ic.alt ?? "—"} href=${ic.href ?? "—"}`);
        console.log(`        ${ic.outerHTML.replace(/\s+/g, " ")}`);
      });
    } else {
      console.log("  icons    : (none)");
    }
    console.log(`  outerHTML: ${r.outerHTML.replace(/\s+/g, " ").slice(0, 500)}`);
    console.log();
  });

  await ctx.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
