# Astro Blog Post Generator

A small, dependency-free browser tool for turning Markdown into an Astro blog
post. It adds YAML frontmatter, creates a date-prefixed filename, and can use an
OpenAI-compatible API to translate titles and suggest article descriptions.

The complete application lives in [`public/index.html`](public/index.html), so
it can be served as a static site without a build step.

## Features

- Generates Markdown with `title`, `description`, and `pubDatetime`
  frontmatter.
- Extracts the first level-one Markdown heading as the title and removes that
  heading from the article body.
- Produces filenames in the form `YYYYMMDD-english-title.md`.
- Copies the generated post to the clipboard or downloads it as a `.md` file.
- Translates a title into English with an OpenAI-compatible API.
- Generates three description candidates, scores them, and lets you select the
  best option.
- Supports both Chat Completions-style `/v1/chat/completions` endpoints and
  Responses-style `/v1/responses` endpoints, including streamed responses.
- Adapts to the browser's light or dark color scheme.

## Run locally

There are no packages to install or assets to compile. Serve the repository's
`public` directory with any static file server. For example, with Python:

```sh
python3 -m http.server 8000 --directory public
```

Then open <http://localhost:8000>.

Opening `public/index.html` directly may work for the basic generator, but a
local HTTP server is recommended because browser security rules can restrict
clipboard access and API requests from `file://` pages.

## Usage

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

## AI configuration

The AI features are optional; Markdown generation, copying, and downloading do
not require an API.

1. Open the **Config** tab.
2. Enter the complete OpenAI-compatible endpoint, such as
   `https://api.openai.com/v1/responses` or
   `https://api.openai.com/v1/chat/completions`.
3. Enter an API key if the endpoint requires one.
4. Enter the model name accepted by that provider.
5. Select **Save configuration**.

Return to the **Blog** tab to use **Translate with AI** or **Generate with AI**.
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

## Deployment

The included GitHub Actions workflow publishes the contents of `public/` to
GitHub Pages whenever relevant changes are pushed to `main`. It can also be
started manually with `workflow_dispatch`.

For another static host, deploy `public/index.html` as the site's entry point.
No server-side runtime or environment variables are required.

## Project structure

```text
.
├── .github/workflows/pages.yml  # GitHub Pages deployment
├── public/index.html            # Application markup, styles, and JavaScript
└── README.md
```

## Development

Keep the application dependency-free unless a build system is deliberately
introduced. After making changes, serve `public/` locally and verify:

- title extraction and frontmatter generation;
- filename normalization and local date handling;
- clipboard and file download actions;
- light and dark color schemes; and
- AI requests against each supported endpoint type, when credentials are
  available.

## License

No license file is currently included. All rights remain with the repository
owner unless a license is added.
