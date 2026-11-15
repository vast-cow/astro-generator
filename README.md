# Astro Blog Post Generator

A dependency-free browser tool for generating and translating Astro blog posts.
It creates YAML frontmatter and date-prefixed filenames, offers AI title and
description assistance, and translates complete posts into any language.

The application lives in [`public/index.html`](public/index.html) and runs as a
static site without a build step. It supports light/dark mode and streaming
OpenAI-compatible Chat Completions and Responses endpoints.

## Run locally

```sh
python3 -m http.server 8000 --directory public
```

Open <http://localhost:8000>.

## Usage

1. In **Blog**, enter Markdown, a writing date, a title, an English title for the
   filename, and a description. Select **Generate**, then **Copy** or **Download .md**.
2. To use AI features, enter the endpoint, key, and model in **Config**. An optional
   **Translation model** overrides **Summary generation model** for translations.
3. In **Translate**, enter **File name** and **Input**, or select **Copy from Blog**
   to copy the current Blog filename and generated document. These fields stay
   independent and persist when switching tabs. Enter a **Target language**
   (default: `English`) and select **Translate**. When complete, copy the translated
   Markdown from **Output**. The original Blog and publication date stay unchanged.

AI features send text directly to the configured provider and store configuration,
including the API key, in browser localStorage. Basic post generation needs no API.

See [usage, translation, and API configuration](docs/usage.md) for details and
[development, testing, and deployment](docs/development.md) for maintenance guidance.
