# Usage and configuration

## Generate a post

1. Enter or paste the article Markdown into **Content**.
2. Adjust **Writing date and time** if needed. It starts at the local time when
   the page loads.
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
request fails, the status identifies the component and marks Output incomplete.
Partial results remain visible. A stream must confirm completion for each
component before the translation is complete. Correct the issue and select
Translate to retry all three requests. Input, target language, and Copy from Blog
are locked until translation finishes or is cancelled. File name remains editable.

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

## Open output in another tab

In **Config**, set **Blog link URL** and **Translate link URL** to their
respective absolute HTTP or HTTPS destinations. Both settings start empty and
save automatically. A URL without placeholders opens as entered, including
any existing query parameters and fragment.

Add placeholders anywhere in the path, query, or fragment. Each occurrence
uses the corresponding value from the tab whose link you open.

- `{filename}` inserts the filename with leading and trailing whitespace removed.
- `{content}` inserts the complete Markdown, including frontmatter.
- `{filenameEncoded}` and `{contentEncoded}` apply `encodeURIComponent` to the
  same values. Use the encoded placeholders to preserve line breaks and keep
  reserved characters such as `&` or `#` inside the value.

For example, set **Blog link URL** to
`https://example.test/import/{filenameEncoded}?body={contentEncoded}`
and **Translate link URL** to
`https://example.test/translate?file={filenameEncoded}&body={contentEncoded}`.

Select **Open in new tab** below **Generated output** or **Output**. If the
expanded URL exceeds 7,000 characters after normalization, the generator
expands the template again with both content placeholders empty. The complete
Markdown stays visible and saved in the generator.

Both links require a valid destination and a filename. Blog also requires
generated output, and Translate requires a completed translation.

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

**Writing date and time** defaults to the local time at each page load. All other
fields in **Blog**, **Translate**, and **Config** save to browser `localStorage`
as they change and restore when you reopen or reload the page. This includes
extracted titles, AI-generated titles and descriptions, filenames, generated
Markdown, and translation output, including partial streamed results. Clearing a
saved field also saves its empty value. **Target language** defaults to `English`
when there is no saved value.

Each tab has its own record, scoped to the browser origin and page pathname:
`astro-blog-generator:${location.pathname}:blog`,
`astro-blog-generator:${location.pathname}:translate`, and
`astro-blog-generator:${location.pathname}:config`. Different paths keep separate
values; query strings and fragments do not change the storage scope. Previously
saved configuration from the same page URL is migrated automatically when no
valid configuration record exists for the new key.

Restoration does not generate a post, copy Blog fields to Translate, or resume AI
requests. Progress displays and status messages are temporary. Translate saves
its completion flag with its output so finished translations can be opened after
reload. Interrupted, failed, or older output without a completion flag remains
visible with the link disabled. Starting a translation, clearing Translate, or
selecting **Copy from Blog** resets the flag.

If storage is blocked, full, or contains invalid data, the application continues
to work. Valid saved string fields are restored where possible; unavailable or
invalid values keep their defaults. Changes cannot persist while storage is
unavailable. Clear this page's localStorage records to discard saved fields.

### Security and privacy

The browser's `localStorage` holds article text, generated results, and the API
key for the page path. API requests are sent directly from the browser to the
configured endpoint; this project does not include a proxy or backend.

Use a restricted, revocable key intended for client-side use. Do not use a
privileged production key on a shared computer or a publicly accessible
browser profile. Article text is sent to the configured provider when an AI
feature is used, subject to that provider's privacy and retention policies.
