# Development and deployment

## Deployment

The included GitHub Actions workflow publishes the contents of `public/` to
GitHub Pages whenever relevant changes are pushed to `main`. It can also be
started manually with `workflow_dispatch`.

For another static host, deploy `public/index.html` as the site's entry point.
No server-side runtime or environment variables are required.

## Project structure

```text
.
├── .github/workflows/pages.yml   # GitHub Pages deployment
├── public/index.html            # Application markup, styles, and JavaScript
├── docs/                        # Usage, configuration, and development
├── tests/translate.test.cjs      # Dependency-free regression tests
└── README.md
```

## Development

Keep the application dependency-free unless a build system is deliberately
introduced. Run the regression suite with Node.js 22 or later:

```sh
node --test tests/translate.test.cjs
```

The tests run the application script with a minimal DOM fixture and mock API
responses. They cover tab initialization and edits, source-preserving frontmatter
replacement, three independent requests, both endpoint formats, partial streaming
updates, errors and retries, model selection, and existing Blog features. Tests do
not call an external provider or require credentials.

After making changes, serve `public/` locally and verify:

- title extraction and frontmatter generation;
- filename normalization and local date handling;
- clipboard and file download actions;
- light and dark color schemes;
- Translate input handoff, manual edits, per-component streaming progress,
  reconstructed output, and error states; and
- AI requests against each supported endpoint type, when credentials are
  available.

## License

No license file is currently included. All rights remain with the repository
owner unless a license is added.
