/* Run against a disposable local instance. Supply PLAYWRIGHT_BASE_URL and
   PMK_TEST_USERNAME/PMK_TEST_PASSWORD for a dedicated test account elsewhere. */
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const base =
  process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:8090/pmk_drive";
const output = process.env.PMK_TEST_OUTPUT || "work";
fs.mkdirSync(output, { recursive: true });
(async () => {
  const browser = await chromium.launch({
    headless: true,
    channel: process.env.PLAYWRIGHT_CHANNEL || "chrome",
  });
  const context = await browser.newContext({
    viewport: { width: 1360, height: 920 },
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const checks = [];
  try {
    await page.goto(base + "/");
    await page.locator("#login-form").waitFor();
    assert.equal(await page.locator(".login-card h1,.login-card p").count(), 0);
    assert.equal(await page.locator("#login-form input").count(), 2);
    await page.locator("[name=username]").fill("typed-value");
    await page.locator("[name=password]").fill("keep-this-input");
    await page.locator("#auth [data-language=en]").click();
    assert.equal(await page.locator("html").getAttribute("lang"), "en");
    assert.equal(
      await page.locator("[name=username]").inputValue(),
      "typed-value",
    );
    assert.equal(
      await page.locator("[name=password]").inputValue(),
      "keep-this-input",
    );
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page
      .getByText("Incorrect username or password.", { exact: true })
      .waitFor();
    await page.locator("#auth [data-language=ko]").click();
    await page
      .getByText("아이디 또는 비밀번호가 올바르지 않습니다.", { exact: true })
      .waitFor();
    await page.locator("#auth [data-language=en]").click();
    await page.reload();
    await page.getByRole("button", { name: "Sign in", exact: true }).waitFor();
    checks.push(
      "minimal login",
      "bilingual labels and API errors",
      "form inputs survive language switch",
      "language persists across reload",
    );
    await page.screenshot({ path: output + "/login-en.png" });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(250);
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await page.screenshot({ path: output + "/login-mobile-en.png" });
    await page.locator("#auth [data-language=ko]").click();
    await page.screenshot({ path: output + "/login-ko.png" });
    await page.setViewportSize({ width: 1360, height: 920 });
    await page
      .locator("[name=username]")
      .fill(process.env.PMK_TEST_USERNAME || "admin");
    await page
      .locator("[name=password]")
      .fill(process.env.PMK_TEST_PASSWORD || "test-password-12345");
    await page.getByRole("button", { name: "로그인", exact: true }).click();
    await page.locator("#shell").waitFor({ state: "visible" });
    await page.locator("#shell [data-language=en]").click();
    await page
      .getByRole("heading", { name: "My Drive", exact: true })
      .waitFor();
    await page.locator("#new-folder").click();
    await page
      .getByRole("heading", { name: "New folder", exact: true })
      .waitFor();
    const folderName = "내 드라이브 " + Date.now();
    await page.locator("#dialog [name=name]").fill(folderName);
    await page.getByRole("button", { name: "Create", exact: true }).click();
    await page
      .getByRole("button", { name: folderName, exact: false })
      .first()
      .waitFor();
    await page.locator(".folder-name").filter({ hasText: folderName }).click();
    await page
      .getByRole("heading", { name: folderName, exact: true })
      .waitFor();
    let delayed = false;
    await page.route("**/api/uploads/*/parts/*", async (route) => {
      if (!delayed) {
        delayed = true;
        await new Promise((resolve) => setTimeout(resolve, 900));
      }
      await route.continue();
    });
    await page.locator("#file-input").setInputFiles({
      name: "파일.xlsx",
      mimeType: "application/octet-stream",
      buffer: Buffer.from("language-test"),
    });
    await page.locator("[data-pause]").waitFor();
    await page.locator("#shell [data-language=ko]").click();
    await page
      .locator(".upload-panel-head")
      .filter({ hasText: "업로드 1 / 1 완료" })
      .waitFor();
    await page.locator("#shell [data-language=en]").click();
    await page
      .locator(".upload-panel-head")
      .filter({ hasText: "Uploads: 1 / 1 complete" })
      .waitFor();
    checks.push("active upload survives language switch");
    await page.locator("[data-select]").check();
    await page.locator("#shell [data-language=ko]").click();
    await page.getByText("1개 선택됨", { exact: true }).waitFor();
    assert(await page.locator("[data-select]").isChecked());
    assert.equal(await page.locator("#page-title").innerText(), folderName);
    assert.equal(await page.locator(".file-name").innerText(), "파일.xlsx");
    await page.locator("#shell [data-language=en]").click();
    await page.getByText("Selected: 1", { exact: true }).waitFor();
    await page.locator("[data-menu]").click();
    await page.getByRole("button", { name: "Share link", exact: true }).click();
    await page
      .getByRole("heading", { name: "Share file", exact: true })
      .waitFor();
    await page.locator("#create-link").click();
    await page.locator("#generated-link input").waitFor();
    const link = await page.locator("#generated-link input").inputValue();
    const anon = await browser.newContext();
    const sharedPage = await anon.newPage();
    await sharedPage.goto(link);
    await sharedPage.locator("#auth [data-language=en]").click();
    await sharedPage
      .getByRole("link", { name: "Download file", exact: true })
      .waitFor();
    assert.equal(
      await sharedPage.locator(".share-file strong").innerText(),
      "파일.xlsx",
    );
    const response = await anon.request.get(
      await sharedPage
        .getByRole("link", { name: "Download file", exact: true })
        .getAttribute("href")
        .then((x) => new URL(x, base).href),
    );
    assert.equal((await response.body()).toString(), "language-test");
    await sharedPage.locator("#auth [data-language=ko]").click();
    await sharedPage
      .getByRole("link", { name: "파일 다운로드", exact: true })
      .waitFor();
    await anon.close();
    await page.locator("#dialog-cancel").click();
    await page.locator("#hide-uploads").click();
    await page.locator("#search").fill("파일");
    await page
      .getByRole("heading", { name: "Search results for “파일”", exact: true })
      .waitFor();
    await page.locator("#shell [data-language=ko]").click();
    assert.equal(await page.locator("#search").inputValue(), "파일");
    await page
      .getByRole("heading", { name: "“파일” 검색 결과", exact: true })
      .waitFor();
    await page.locator("#shell [data-language=en]").click();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(350);
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await page.screenshot({
      path: output + "/drive-mobile-en.png",
      fullPage: true,
    });
    checks.push(
      "bilingual drive and dialogs",
      "upload status localized",
      "selection folder and search preserved",
      "user file and folder names unchanged",
      "bilingual shared page and download",
      "mobile layout",
    );
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ checks, consoleErrors: errors }));
    fs.writeFileSync(
      output + "/localization-validation.json",
      JSON.stringify({ checks, consoleErrors: errors }, null, 2),
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
