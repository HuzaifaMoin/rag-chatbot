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

// The streamed version of FAKE_ANSWER, as Server-Sent Events.
function sse(event: string, data: object) {
  return `event: ${event}
data: ${JSON.stringify(data)}

`;
}
const FAKE_STREAM = [
  sse("step", { node: "retrieve", label: "Searching your documents", status: "running" }),
  sse("step", { node: "retrieve", label: "Searching your documents", status: "done", detail: "1 passage found" }),
  sse("step", { node: "generate", label: "Writing the answer", status: "running" }),
  sse("token", { text: "Solar panels last " }),
  sse("token", { text: "about **25 years** [1]." }),
  sse("step", { node: "generate", label: "Writing the answer", status: "done" }),
  sse("step", { node: "finalize", label: "Adding citations", status: "done" }),
  sse("done", FAKE_ANSWER),
].join("");

async function fakeTheLLM(page: Page) {
  await page.route("**/api/chat/stream", (route) =>
    route.fulfill({ contentType: "text/event-stream", body: FAKE_STREAM }),
  );
  await page.route("**/api/chat", (route) => route.fulfill({ json: FAKE_ANSWER }));
  await page.route("**/api/feedback", (route) => route.fulfill({ status: 204 }));
}

test("a new user can sign up, upload, chat, vote, delete and log out", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
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
    // Uploads start as soon as a file is chosen, and a toast confirms it.
    await expect(page.getByRole("status").filter({ hasText: "Uploaded solar-notes.txt" })).toBeVisible();
    const list = page.getByRole("list", { name: "Your documents" });
    await expect(list.getByText("solar-notes.txt")).toBeVisible();
    await expect(list.getByText(/Ready · \d+ chunk/)).toBeVisible({ timeout: 60_000 });
  });

  await test.step("ask a question and see the answer with its source", async () => {
    await fakeTheLLM(page);
    await nav.getByRole("link", { name: "Chat", exact: true }).click();
    // The sources panel lists the uploaded document, ticked.
    const sources = page.getByRole("complementary", { name: "Your sources" });
    await expect(sources.getByRole("checkbox")).toBeChecked();
    await expect(page.getByText("Searching 1 of 1 document")).toBeVisible();
    await page.getByPlaceholder(/Ask a question/).fill("How long do solar panels last?");
    await page.keyboard.press("Enter");

    // The agent's steps fold into one line once the answer is done; click to open them.
    const stepsToggle = page.getByRole("button", { name: /✓ 3 steps/ });
    await expect(stepsToggle).toBeVisible();
    await stepsToggle.click();
    await expect(page.getByText("1 passage found")).toBeVisible();

    // Markdown is rendered: **25 years** becomes bold text, not asterisks.
    await expect(page.locator("strong", { hasText: "25 years" })).toBeVisible();
    await expect(page.getByText("**")).toHaveCount(0);
    // Next.js keeps visited pages in the DOM (hidden): the home page's preview card has this text too.
    await expect(page.getByText("From your documents").filter({ visible: true })).toBeVisible();
    const answerSources = page.getByRole("list", { name: "Sources for this answer" });
    await expect(answerSources.getByText("solar-notes.txt")).toBeVisible();

    // The [1] in the answer is a chip; hovering it previews the quoted passage.
    await page.getByRole("button", { name: /^Source 1:/ }).hover();
    await expect(page.getByRole("tooltip").filter({ visible: true })).toContainText(
      "A typical solar panel lasts about 25 years.",
    );
  });

  await test.step("copy and regenerate the answer", async () => {
    await page.getByRole("button", { name: "Copy" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Copied to clipboard" })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("25 years");

    await page.getByRole("button", { name: "Regenerate" }).click();
    // Still one question and one answer (the old answer was replaced, not added to).
    await expect(page.locator("strong", { hasText: "25 years" })).toHaveCount(1);
  });

  await test.step("rate the answer, with a reason after thumbs down", async () => {
    await page.getByRole("button", { name: "Bad answer" }).click();
    await page.getByLabel("What was wrong with this answer?").fill("Missing detail");
    await page.getByRole("button", { name: "Send", exact: true }).first().click();
    await expect(page.getByRole("status").filter({ hasText: "Thanks, that helps" })).toBeVisible();

    const thumbsUp = page.getByRole("button", { name: "Good answer" });
    await thumbsUp.click();
    await expect(thumbsUp).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByText("Thanks for the feedback")).toBeVisible();
  });

  await test.step("theme toggle cycles System -> Light -> Dark -> System", async () => {
    const toggle = nav.getByRole("button", { name: /^Theme:/ });
    await toggle.click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await toggle.click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await toggle.click();
    await expect(page.locator("html")).not.toHaveAttribute("data-theme", /.+/);
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

test("on a phone, the sources panel slides in from a button", async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  // Sign up straight through the API (the first test already covers the sign-up form).
  const response = await request.post("http://localhost:8000/api/auth/register", {
    data: { email: `e2e-mobile-${Date.now()}@example.com`, password: "e2e-password-123" },
  });
  const { access_token } = await response.json();
  await page.addInitScript((token) => localStorage.setItem("rag_token", token), access_token);

  await page.goto("/chat");
  await expect(page.getByRole("complementary", { name: "Your sources" })).toBeHidden();
  await page.getByRole("button", { name: /^Sources/ }).click();
  const drawer = page.getByRole("dialog", { name: "Sources" });
  await expect(drawer.getByText("No documents yet")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
});
