# Development and deployment

## Deployment

The GitHub Actions workflow publishes `public/` directly when a push to `main`
changes `public/**` or `.github/workflows/pages.yml`. It uses
`actions/checkout@v7`, `actions/upload-pages-artifact@v5`, and
`actions/deploy-pages@v5` on GitHub-hosted `ubuntu-latest` with Node.js 24.

The `pages` concurrency group protects the active deployment from newer runs.
GitHub keeps one pending run and replaces it if another run arrives.

Each run makes at most two deployment attempts. If the first fails, the workflow
waits 30 seconds and retries using the same `github-pages` artifact. Cancelling
the workflow skips any remaining retry steps. If either attempt succeeds, its
URL appears on the `github-pages` environment. If both attempts fail, the job
fails and both errors remain in the Actions logs.

To deploy manually, open **Actions** → **Deploy GitHub Pages (public)** →
**Run workflow**, select `main`, and start the run. If both attempts fail, review
their logs, check [GitHub Status](https://www.githubstatus.com/) for a Pages
incident, and confirm **Settings** → **Pages** uses **GitHub Actions** as the
source. If Pages reports a deployment is still in progress, wait for it to
finish. Use **Run workflow** to deploy the current `main` in a fresh run with its
own artifact.

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
responses. They cover tab order, independent Translate fields, explicit copying
from Blog, edits preserved across tab switches and translation, source-preserving
frontmatter replacement, three independent requests, both endpoint formats,
partial streaming updates, errors and retries, model selection, and existing Blog
features. Clipboard tests verify Blog's **Copy** action and the removal of its
download button, along with exact Translate output copying and the disabled state
after clearing. Persistence coverage includes input/change events, restoration after
reload, pathname isolation, empty values and defaults, legacy configuration
migration, invalid or unavailable storage, button and AI updates, and partial
streamed output after cancellation. Cancellation coverage includes all three steps
on both endpoint types, aborting while connecting or streaming, retained partial
output, immediate control restoration, retries, late responses and errors during
a new translation, and isolation from concurrent Blog AI requests. Tests do not
call an external provider or require credentials.

After making changes, serve `public/` locally and verify:

- title extraction and frontmatter generation;
- filename normalization and local date handling;
- clipboard copying in Blog and Translate, including line breaks, trailing
  spaces, and the disabled Translate **Copy** button when **Output** is empty;
- automatic saving and restoration of all tabs after reload, including generated
  output, independent Translate fields, and configuration without a save button;
- light and dark color schemes;
- explicit Copy from Blog, independent filename and input edits, tab switching,
  per-component streaming progress, reconstructed output, and error states;
- cancellation during each translation step, preserved partial output, restored
  controls, and starting a new translation; and
- AI requests against each supported endpoint type, when credentials are
  available.

## License

No license file is currently included. All rights remain with the repository
owner unless a license is added.
