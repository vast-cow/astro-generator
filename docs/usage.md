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
   **Body** progress areas as responses stream in.
6. Wait for **Translation complete.**, then select and copy the finished
   Markdown from **Output**.

Title, description, and body are translated in that order with three separate
streaming API requests. Each uses the target language and the configured
**Translation model**, falling back to **Model** when it is empty. Both supported
endpoint types work without requiring structured JSON output for translation.

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
Copy from Blog is also disabled until the request finishes. File name remains
editable.

Translate's File name and Input start empty and remain independent of Blog.
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
4. Enter the model name accepted by that provider.
5. Optionally enter a **Translation model** for all translation requests. Leave
   it empty to use **Model** for translations as well as descriptions.
6. Select **Save configuration**.

Description generation always uses **Model**. Both models share the endpoint
and API key, so the endpoint must support both. A translation model API error
is displayed without retrying with the default model.

Return to the **Blog** tab to use **Translate with AI** or **Generate with AI**,
or open **Translate** to translate a complete generated post.
The provider must allow cross-origin requests from the page's origin and must
support the request format used by its selected endpoint. Structured JSON
output support is required for description generation.

### Security and privacy

API configuration, including the API key, is stored in the browser's
`localStorage` and scoped to the page URL. API requests are sent directly from
the browser to the configured endpoint; this project does not include a proxy
or backend.

Use a restricted, revocable key intended for client-side use. Do not use a
privileged production key on a shared computer or a publicly accessible
browser profile. Article text is sent to the configured provider when an AI
feature is used, subject to that provider's privacy and retention policies.
