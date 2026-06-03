"""Run terracart test harness via Playwright and print results."""
import asyncio, json, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
from playwright.async_api import async_playwright

URL = "http://127.0.0.1:7731/test/harness.html"
TIMEOUT_MS = 60_000   # 60 s for full suite

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()

        # Collect console errors
        console_errs = []
        page.on("console", lambda m: console_errs.append(f"[{m.type}] {m.text}") if m.type in ("error","warning") else None)
        page.on("pageerror", lambda e: console_errs.append(f"[pageerror] {e}"))

        await page.goto(URL, timeout=TIMEOUT_MS)

        # Wait until the summary div is populated (non-empty text)
        await page.wait_for_function(
            "() => document.getElementById('summary') && document.getElementById('summary').textContent.trim().length > 0",
            timeout=TIMEOUT_MS
        )

        # Extract results
        results = await page.evaluate("""() => {
            const cases = [];
            for (const el of document.querySelectorAll('#cases .case')) {
                const errEl = el.querySelector('.err');
                cases.push({
                    pass: el.classList.contains('pass'),
                    text: el.childNodes[0]?.textContent?.trim() || el.textContent.trim(),
                    err: errEl ? errEl.textContent.trim() : null
                });
            }
            const summary = document.getElementById('summary').textContent.trim();
            return { cases, summary };
        }""")

        await browser.close()

        # Print
        for c in results["cases"]:
            icon = "PASS" if c["pass"] else "FAIL"
            print(f"  {icon} {c['text']}")
            if c["err"]:
                for line in c["err"].split("\n"):
                    print(f"      {line}")

        print()
        print(results["summary"])

        if console_errs:
            print("\n--- Console errors ---")
            for e in console_errs[:30]:
                print(" ", e)

        failed = sum(1 for c in results["cases"] if not c["pass"])
        sys.exit(0 if failed == 0 else 1)

asyncio.run(main())
