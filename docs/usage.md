# Usage and configuration

## Generate a post

1. Enter or paste the article Markdown into **Content**.
2. Choose the writing date and time.
3. Enter a title, or start the article with a `# Heading` and select
   **Extract**.
4. Enter an English title. This is normalized into the filename slug.
5. Add a short description.
6. Select **Generate** to create the finished Markdown and filename.
7. Select **Copy** or **Download .md**.

For example, a title of `My First Post` and a date of January 15, 2026 produce
the filename `20260115-my-first-post.md`. The generated document has this
shape:

```md
---
title: "My First Post"
description: "A short introduction to the post."
pubDatetime: 2026-01-15T09:30:00+00:00
---

Article content goes here.
```

The date-time offset is derived from the browser's local timezone.

## Translate a post

1. Configure the API in **Config**. To use a Blog post as the source, generate it
   in **Blog** first.
2. Open **Translate**. Enter **File name** and **Input** manually, or select
   **Copy from Blog** to replace both with Blog's current File name and Generated
   output. Copying does not change Blog or start a translation.
3. Edit **File name** and **Input** as needed. Translation uses Translate's own
   Input, including any edits to the title, description, or article body. Your
   manually entered filename is preserved when translating.
4. Enter any language name in **Target language** (default: `English`), such as
   `Japanese` or `Brazilian Portuguese`.
5. Select **Translate**. Follow the separate **Title**, **Description**, and
   **Body** progress areas as responses stream in. Select **Cancel** at any point
   to stop the translation.
6. Wait for **Translation complete.**, then select and copy the finished
   Markdown from **Output**.

Title, description, and body are translated in that order with three separate
streaming API requests. Each uses the target language and the configured
**Translation model**, falling back to **Summary generation model** when it is
empty. Both supported endpoint types work without requiring structured JSON output
for translation.

Input must contain `---`-delimited YAML frontmatter with `title`, `description`,
and `pubDatetime`. Text fields support plain, quoted, and literal/folded block
strings. Unsupported text values, such as YAML aliases or collections, produce
an error before requests are sent. Other frontmatter is retained as source text:
`pubDatetime`, additional fields (including nested metadata), and their ordering
are preserved. Translated title and description are safely quoted as YAML.

The body prompt instructs the model to translate all natural-language text
without additions or omissions, preserve Markdown structure, and leave code,
URLs, image paths, and HTML markup unchanged. Review the model's translation
before publishing.

Output updates during each stream. Components that have not started retain
their original text, so wait for completion before using the document. If a
request fails, the status identifies the component and marks Output incomplete;
partial results remain visible. Correct the issue and select Translate to retry
all three requests. Input and target language are locked only while translating;
Copy from Blog is also disabled until translation finishes or is cancelled. File
name remains editable.

**Cancel** is available only while translating. It aborts the current request
and stream, skips all remaining steps, and displays **Translation cancelled.**
Output and progress generated so far remain visible; unfinished components may
still contain partial translations or their original text. The controls unlock
immediately. Select **Translate** to start again from Title without refreshing
the page. Late responses from the cancelled run cannot overwrite the new run,
and cancellation does not affect Blog's AI features.

Translate's File name and Input start empty unless saved values are available,
and remain independent of Blog.
Switching tabs preserves both fields, translation results, and progress, including
during an active translation. Editing or regenerating Blog does not affect
Translate, and editing or translating in Translate does not affect Blog. Only
selecting **Copy from Blog** replaces Translate's fields with Blog's current
values and clears prior translation results and progress.

## AI configuration

The AI features are optional; Markdown generation, copying, and downloading do
not require an API.

1. Open the **Config** tab.
2. Enter the complete OpenAI-compatible endpoint, such as
   `https://api.openai.com/v1/responses` or
   `https://api.openai.com/v1/chat/completions`.
3. Enter an API key if the endpoint requires one.
4. Enter the **Summary generation model** name accepted by that provider.
5. Optionally enter a **Translation model** for all translation requests. Leave
   it empty to use **Summary generation model** for translations as well as
   descriptions.

Configuration saves automatically as you edit; there is no Save configuration
button.

Description generation always uses **Summary generation model**. Both models share
the endpoint and API key, so the endpoint must support both. A translation model
API error is displayed without retrying with the default model.

Return to the **Blog** tab to use **Translate with AI** or **Generate with AI**,
or open **Translate** to translate a complete generated post.
The provider must allow cross-origin requests from the page's origin and must
support the request format used by its selected endpoint. Structured JSON
output support is required for description generation.

## Automatic saving

All fields in **Blog**, **Translate**, and **Config** save to browser `localStorage`
as they change and restore when you reopen or reload the page. This includes
extracted titles, AI-generated titles and descriptions, filenames, generated
Markdown, and translation output, including partial streamed results. Clearing a
field also saves its empty value. Without saved values, the writing date defaults
to the current local time and Target language defaults to `English`.

Each tab has its own record, scoped to the browser origin and page pathname:
`astro-blog-generator:${location.pathname}:blog`,
`astro-blog-generator:${location.pathname}:translate`, and
`astro-blog-generator:${location.pathname}:config`. Different paths keep separate
values; query strings and fragments do not change the storage scope. Previously
saved configuration from the same page URL is migrated automatically when no
valid configuration record exists for the new key.

Restoration does not generate a post, copy Blog fields to Translate, or resume AI
requests. Progress displays and request status are temporary; only field values
are restored. **Copy from Blog** remains the explicit way to replace Translate's
filename and input and clear its previous output.

If storage is blocked, full, or contains invalid data, the application continues
to work. Valid saved string fields are restored where possible; unavailable or
invalid values keep their defaults. Changes cannot persist while storage is
unavailable. Clear this page's localStorage records to discard saved fields.

### Security and privacy

All tab fields, including article text and the API key, are stored in the browser's
`localStorage` for the page path. API requests are sent directly from the browser
to the configured endpoint; this project does not include a proxy or backend.

Use a restricted, revocable key intended for client-side use. Do not use a
privileged production key on a shared computer or a publicly accessible
browser profile. Article text is sent to the configured provider when an AI
feature is used, subject to that provider's privacy and retention policies.
