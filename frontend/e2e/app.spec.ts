import { expect, test, type Page } from "@playwright/test";

// One new user's whole journey: sign up -> upload -> chat -> vote -> delete -> log out.
//
// Real: frontend, backend, database, embeddings.
// Faked in the browser: /api/chat and /api/feedback. The real chat needs the Groq LLM
// (CI has no keys on purpose); answer quality is covered by the evals instead.

const FAKE_ANSWER = {
  answer: "Solar panels last about **25 years** [1].",
  source: "documents",
  citations: [
    {
      label: "1",
      type: "document",
      snippet: "A typical solar panel lasts about 25 years.",
      filename: "solar-notes.txt",
      page: null,
      title: null,
      url: null,
    },
  ],
  grounded: true,
  tools_used: [],
  thread_id: "e2e-thread",
  run_id: "00000000-0000-4000-8000-000000000001",
  latency_ms: 1234,
};

async function fakeTheLLM(page: Page) {
  await page.route("**/api/chat", (route) => route.fulfill({ json: FAKE_ANSWER }));
  await page.route("**/api/feedback", (route) => route.fulfill({ status: 204 }));
}

test("a new user can sign up, upload, chat, vote, delete and log out", async ({ page }) => {
  const email = `e2e-${Date.now()}@example.com`;
  const nav = page.getByRole("banner");

  await test.step("visitor home page", async () => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Chat with your documents" })).toBeVisible();
    await expect(page.getByText("Answers with citations")).toBeVisible();
    await page.getByRole("link", { name: "Get started" }).click();
    await expect(page).toHaveURL(/\/login$/);
  });

  await test.step("sign up", async () => {
    await page.getByRole("button", { name: "No account? Sign up" }).click();
    await page.getByPlaceholder("Email").fill(email);
    await page.getByPlaceholder(/Password/).fill("e2e-password-123");
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(nav.getByText(email)).toBeVisible();
  });

  await test.step("upload a document and wait until it's ready", async () => {
    await nav.getByRole("link", { name: "Documents", exact: true }).click();
    await expect(page.getByText("No documents yet")).toBeVisible();
    await page.locator('input[type="file"]').setInputFiles({
      name: "solar-notes.txt",
      mimeType: "text/plain",
      buffer: Buffer.from(
        "Solar panels convert sunlight into electricity. A typical panel lasts about 25 years.",
      ),
    });
    await page.getByRole("button", { name: "Upload" }).click();
    await expect(page.getByText("solar-notes.txt")).toBeVisible();
    await expect(page.getByText(/Ready · \d+ chunk/)).toBeVisible({ timeout: 60_000 });
  });

  await test.step("ask a question and see the answer with its source", async () => {
    await fakeTheLLM(page);
    await nav.getByRole("link", { name: "Chat", exact: true }).click();
    await page.getByPlaceholder(/Ask a question/).fill("How long do solar panels last?");
    await page.keyboard.press("Enter");

    // Markdown is rendered: **25 years** becomes bold text, not asterisks.
    await expect(page.locator("strong", { hasText: "25 years" })).toBeVisible();
    await expect(page.getByText("**")).toHaveCount(0);
    await expect(page.getByText("From your documents")).toBeVisible();
    // Next.js keeps recently visited pages in the DOM (hidden) for instant back-navigation,
    // so the Documents page's "solar-notes.txt" still exists: only look at visible text.
    await expect(page.getByText("solar-notes.txt").filter({ visible: true })).toBeVisible();
  });

  await test.step("rate the answer", async () => {
    const thumbsUp = page.getByRole("button", { name: "Good answer" });
    await thumbsUp.click();
    await expect(thumbsUp).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByText("Thanks for the feedback")).toBeVisible();
  });

  await test.step("delete the document", async () => {
    await nav.getByRole("link", { name: "Documents", exact: true }).click();
    page.once("dialog", (dialog) => dialog.accept()); // the "Delete solar-notes.txt?" popup
    await page.getByRole("button", { name: "Delete" }).click();
    await expect(page.getByText("No documents yet")).toBeVisible();
  });

  await test.step("log out, and protected pages send you to login", async () => {
    await nav.getByRole("button", { name: "Log out" }).click();
    await expect(page).toHaveURL(/\/login$/);
    await page.goto("/chat");
    await expect(page).toHaveURL(/\/login$/);
  });
});
