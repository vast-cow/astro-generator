const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const html = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const original = `---
title: "Original title"
description: 'An author''s description'
pubDatetime: 2026-11-15T09:30:00+09:00 # keep this exact date
tags:
  - astro
  - translation
draft: false
custom:
  title: Nested title
---

## Heading

- [A link](https://example.com)
- ![Alt text](/images/photo.png)

Inline \`const x = 1\`.

\`\`\`js
console.log("keep code");
\`\`\`
`;

function element(attributes = "") {
  const classes = new Set(attributes.match(/class="([^"]*)"/)?.[1].split(" ") || []);
  return {
    value: attributes.match(/value="([^"]*)"/)?.[1] || "",
    readOnly: /\breadonly\b/.test(attributes),
    disabled: false,
    textContent: "",
    style: {},
    dataset: { tab: attributes.match(/data-tab="([^"]*)"/)?.[1] },
    children: [],
    listeners: {},
    classList: {
      contains: name => classes.has(name),
      toggle(name, on) { if (on) classes.add(name); else classes.delete(name); }
    },
    addEventListener(event, callback) { this.listeners[event] = callback; },
    click() { return this.listeners.click?.(); },
    replaceChildren() { this.children = []; },
    append(...children) { this.children.push(...children); }
  };
}

function app() {
  const elements = {};
  for (const match of html.matchAll(/<\w+\b([^>]*\bid="([^"]+)"[^>]*)>/g)) {
    elements[match[2]] = element(match[1]);
    elements[match[2]].id = match[2];
  }
  const buttons = [...html.matchAll(/<button\b([^>]*data-tab="[^"]+"[^>]*)>/g)]
    .map(match => element(match[1]));
  const storage = new Map();
  const alerts = [];
  const copied = [];
  const downloads = [];
  const context = vm.createContext({
    window: { location: { href: "http://localhost/index.html" } },
    document: {
      getElementById: id => elements[id],
      querySelectorAll: selector => selector === ".tab-button" ? buttons :
        [elements.blog, elements.config, elements.translate],
      createElement: tag => {
        const node = element();
        if (tag === "a") node.click = () => downloads.push(node);
        return node;
      }
    },
    navigator: { clipboard: { writeText: async text => copied.push(text) } },
    URL: { createObjectURL: () => "blob:test", revokeObjectURL() {} },
    Blob, TextDecoder, Uint8Array,
    localStorage: {
      getItem: key => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, value)
    },
    alert: message => alerts.push(message),
    console: { error() {} },
    setTimeout() {},
    fetch: () => { throw new Error("Unexpected API request"); }
  });
  vm.runInContext(script, context);
  return {
    context, elements, buttons, alerts, copied, downloads, storage,
    run: code => vm.runInContext(code, context)
  };
}

function configure(instance, endpoint = "chat/completions", translationModel = "translator") {
  instance.elements.apiEndpoint.value = `https://provider.test/v1/${endpoint}`;
  instance.elements.apiModel.value = "default-model";
  instance.elements.translationModel.value = translationModel;
  instance.elements.apiKey.value = "test-key";
}

const encoder = new TextEncoder();
function event(content, responses = false) {
  return `data: ${JSON.stringify(responses ?
    { type: "response.output_text.delta", delta: content } :
    { choices: [{ delta: { content } }] })}\r\n\r\n`;
}

function streamed(content, responses = false) {
  const bytes = encoder.encode(": heartbeat\r\n\r\n" + event(content, responses) + "data: [DONE]");
  return new Response(new ReadableStream({
    start(controller) {
      // Exercise split UTF-8 characters, SSE lines, and an unterminated EOF line.
      for (let index = 0; index < bytes.length; index += 3) controller.enqueue(bytes.slice(index, index + 3));
      controller.close();
    }
  }), { headers: { "Content-Type": "text/event-stream" } });
}

test("tabs are ordered Blog, Translate, Config with Blog active by default", () => {
  const { elements, buttons } = app();
  assert.deepEqual(buttons.map(button => button.dataset.tab), ["blog", "translate", "config"]);
  for (const button of buttons) {
    const isBlog = button.dataset.tab === "blog";
    assert.equal(button.classList.contains("active"), isBlog);
    assert.equal(elements[button.dataset.tab].classList.contains("active"), isBlog);
  }
  for (const button of buttons) {
    button.click();
    for (const other of buttons) {
      assert.equal(other.classList.contains("active"), other === button);
      assert.equal(elements[other.dataset.tab].classList.contains("active"), other === button);
    }
  }
});

test("Translate fields are editable, independent, and preserved across tab switches and Blog generation", () => {
  const instance = app();
  const { elements, buttons } = instance;
  elements.output.value = original;
  elements.filename.value = "20261115-original.md";
  buttons[1].click();
  assert.equal(elements.translationFilename.value, "");
  assert.equal(elements.translationInput.value, "");
  assert.equal(elements.translationFilename.readOnly, false);
  assert.equal(elements.translationInput.readOnly, false);
  assert.equal(elements.targetLanguage.value, "English");
  elements.translationFilename.value = "manual-name.md";
  elements.translationInput.value = "Edited copy";
  assert.equal(elements.filename.value, "20261115-original.md");
  assert.equal(elements.output.value, original);
  buttons[0].click();
  elements.content.value = "New Blog content";
  elements.title.value = "New title";
  elements.englishTitle.value = "New post";
  elements.description.value = "New description";
  elements.date.value = "2026-11-15T09:30";
  elements.generate.click();
  assert.equal(elements.filename.value, "20261115-new-post.md");
  assert.match(elements.output.value, /New Blog content/);
  for (const index of [1, 2, 1, 0, 1, 1]) {
    buttons[index].click();
    assert.equal(elements.translationFilename.value, "manual-name.md");
    assert.equal(elements.translationInput.value, "Edited copy");
  }
});

test("Copy from Blog replaces both fields only on click, without changing Blog or starting translation", () => {
  const { elements, buttons } = app();
  elements.filename.value = "20261115-original.md";
  elements.output.value = original;
  elements.translationFilename.value = "manual-name.md";
  elements.translationInput.value = "Manual input";
  elements.translationOutput.value = "Previous translation";
  elements.translationStatus.textContent = "Translation complete.";
  for (const id of ["translationTitleProgress", "translationDescriptionProgress", "translationBodyProgress"]) {
    elements[id].textContent = "Previous progress";
    elements[id].style.display = "block";
  }
  buttons[1].click();
  assert.equal(elements.translationInput.value, "Manual input");
  elements.copyFromBlog.click();
  assert.equal(elements.translationFilename.value, "20261115-original.md");
  assert.equal(elements.translationInput.value, original);
  assert.equal(elements.filename.value, "20261115-original.md");
  assert.equal(elements.output.value, original);
  assert.equal(elements.translationOutput.value, "");
  assert.equal(elements.translationStatus.textContent, "");
  assert.equal(elements.translatePost.disabled, false);
  for (const id of ["translationTitleProgress", "translationDescriptionProgress", "translationBodyProgress"]) {
    assert.equal(elements[id].textContent, "");
    assert.equal(elements[id].style.display, "none");
  }
  elements.filename.value = "updated-blog.md";
  elements.output.value = "Updated Blog output";
  buttons[0].click();
  buttons[1].click();
  assert.equal(elements.translationFilename.value, "20261115-original.md");
  assert.equal(elements.translationInput.value, original);
  elements.copyFromBlog.click();
  assert.equal(elements.translationFilename.value, "updated-blog.md");
  assert.equal(elements.translationInput.value, "Updated Blog output");
  assert.equal(elements.filename.value, "updated-blog.md");
  assert.equal(elements.output.value, "Updated Blog output");
  elements.filename.value = "";
  elements.output.value = "";
  elements.copyFromBlog.click();
  assert.equal(elements.translationFilename.value, "");
  assert.equal(elements.translationInput.value, "");
});

test("frontmatter replacement preserves every other field, Markdown, comments, and CRLF", () => {
  const instance = app();
  instance.context.source = original.replace(/\n/g, "\r\n");
  const parsed = instance.run("parseTranslationDocument(source)");
  assert.equal(parsed.fields.title.value, "Original title");
  assert.equal(parsed.fields.description.value, "An author's description");
  assert.equal(parsed.fields.pubDatetime.value, "2026-11-15T09:30:00+09:00 # keep this exact date");
  instance.context.parsed = parsed;
  instance.context.translated = { title: 'A "quote": \\ path\nnew line', description: "日本語\u2028text" };
  const output = instance.run("reconstructTranslation(parsed, translated)");
  assert.equal(output, instance.context.source
    .replace('"Original title"', '"A \\"quote\\": \\\\ path\\nnew line"')
    .replace("'An author''s description'", '"日本語\\u2028text"'));
});

test("plain, quoted, folded, and literal YAML text are decoded for translation", () => {
  const instance = app();
  const cases = [
    ['Hello world # comment', "Hello world"],
    ['"  Keep spaces  " # comment', "  Keep spaces  "],
    [String.raw`"A \"quote\", \u65e5\x21 and \n line"`, 'A "quote", 日! and \n line'],
    ["'It''s YAML'", "It's YAML"],
    [">-\n  First line\n  second line", "First line second line"],
    [">-\n  First paragraph\n\n  Second paragraph", "First paragraph\nSecond paragraph"],
    ["|+\n  First line\n\n", "First line\n\n\n"],
    ["|\n  First line\n  second line", "First line\nsecond line\n"],
    ["|", ""],
    ["Text\n  # An indented comment", "Text"],
    ['"First line\n  second line"', "First line second line"],
    ["First line\n  second line", "First line second line"]
  ];
  for (const [scalar, expected] of cases) {
    instance.context.source = `---\ntitle: ${scalar}\ndescription: Text\npubDatetime: 'unchanged'\n---\nBody`;
    const parsed = instance.run("parseTranslationDocument(source)");
    assert.equal(parsed.fields.title.value, expected, scalar);
    instance.context.parsed = parsed;
    const output = instance.run('reconstructTranslation(parsed, { title: "Translated" })');
    assert.match(output, /title: "Translated"/);
    assert.match(output, /pubDatetime: 'unchanged'/);
  }
});

test("invalid frontmatter and unsupported text values fail before making requests", async () => {
  const instance = app();
  configure(instance);
  for (const source of ["No frontmatter", "---\ntitle: Hi\n---\nBody",
    original.replace('title: "Original title"', 'title: [not, a, string]'),
    original.replace('title: "Original title"', 'title: One\ntitle: Two')]) {
    instance.elements.translationInput.value = source;
    await instance.elements.translatePost.click();
    assert.match(instance.elements.translationStatus.textContent, /^Error:/);
    assert.equal(instance.elements.translatePost.disabled, false);
  }
});

for (const endpoint of ["chat/completions", "responses"]) {
  test(`${endpoint}: three requests use edited input, target language, model, and streaming output`, async () => {
    const instance = app();
    const { elements, context } = instance;
    configure(instance, endpoint, endpoint === "responses" ? "" : "translator");
    elements.filename.value = "blog-name.md";
    elements.output.value = original;
    elements.translationFilename.value = "manual-translation.md";
    elements.translationInput.value = original.replace("Original title", "Edited title").replace("## Heading", "## Edited heading");
    const input = elements.translationInput.value;
    elements.targetLanguage.value = "Brazilian Portuguese";
    const calls = [];
    let bodyController;
    let bodyStarted;
    const bodyReady = new Promise(resolve => { bodyStarted = resolve; });
    context.fetch = async (url, options) => {
      const request = JSON.parse(options.body);
      calls.push(request);
      assert.equal(options.headers.Authorization, "Bearer test-key");
      assert.equal(request.model, endpoint === "responses" ? "default-model" : "translator");
      assert.equal(request.stream, true);
      assert.equal(request.response_format, undefined);
      assert.equal(request.text, undefined);
      const prompt = request.input || request.messages[0].content;
      assert.match(prompt, /into Brazilian Portuguese/);
      const component = ["title", "description", "body"][calls.length - 1];
      assert.match(prompt, new RegExp(`Source ${component}:`));
      if (component === "title") {
        assert.match(prompt, /Edited title/);
        assert.doesNotMatch(prompt, /Original title|author's description/);
        return streamed('Título: "traduzido"', endpoint === "responses");
      }
      assert.match(elements.translationOutput.value, /title: "Título: \\"traduzido\\""/);
      if (component === "description") {
        assert.match(prompt, /An author's description/);
        return streamed("Descrição", endpoint === "responses");
      }
      assert.match(prompt, /## Edited heading/);
      assert.ok(prompt.endsWith("\n\n" + elements.translationInput.value.split("---\n")[2]));
      assert.match(prompt, /Do not translate or change code/);
      const response = new Response(new ReadableStream({
        start(controller) { bodyController = controller; }
      }), { headers: { "Content-Type": "text/event-stream" } });
      bodyStarted();
      return response;
    };

    const translating = elements.translatePost.click();
    await bodyReady;
    assert.equal(elements.translatePost.disabled, true);
    assert.equal(elements.copyFromBlog.disabled, true);
    assert.equal(elements.translationInput.readOnly, true);
    assert.equal(elements.translationFilename.readOnly, false);
    elements.translationFilename.value = "renamed-during-translation.md";
    elements.copyFromBlog.click();
    instance.buttons[0].click();
    instance.buttons[2].click();
    instance.buttons[1].click();
    assert.equal(elements.translationInput.value, input);
    assert.equal(elements.translationFilename.value, "renamed-during-translation.md");
    bodyController.enqueue(encoder.encode(event("\n## Traduzido", endpoint === "responses")));
    await new Promise(resolve => setImmediate(resolve));
    assert.match(elements.translationBodyProgress.textContent, /## Traduzido/);
    assert.ok(elements.translationOutput.value.endsWith("\n## Traduzido"));
    assert.match(elements.translationTitleProgress.textContent, /Título/);
    assert.match(elements.translationDescriptionProgress.textContent, /Descrição/);
    const remainder = original.slice(original.indexOf("\n\n- [A link]"));
    bodyController.enqueue(encoder.encode(event(remainder, endpoint === "responses")));
    bodyController.close();
    await translating;
    assert.equal(calls.length, 3);
    assert.equal(elements.translationStatus.textContent, "Translation complete.");
    assert.equal(elements.translatePost.disabled, false);
    assert.equal(elements.copyFromBlog.disabled, false);
    assert.equal(elements.translationInput.readOnly, false);
    assert.equal(elements.translationFilename.value, "renamed-during-translation.md");
    assert.equal(elements.translationInput.value, input);
    assert.ok(elements.translationOutput.value.endsWith("\n## Traduzido" + remainder));
    assert.ok(elements.translationOutput.value.includes(original.slice(original.indexOf("pubDatetime:"), original.indexOf("---\n\n"))));
    assert.equal(elements.output.value, original);
    assert.equal(elements.filename.value, "blog-name.md");
    const translatedOutput = elements.translationOutput.value;
    const titleProgress = elements.translationTitleProgress.textContent;
    instance.buttons[0].click();
    instance.buttons[2].click();
    instance.buttons[1].click();
    assert.equal(elements.translationFilename.value, "renamed-during-translation.md");
    assert.equal(elements.translationInput.value, input);
    assert.equal(elements.translationOutput.value, translatedOutput);
    assert.equal(elements.translationStatus.textContent, "Translation complete.");
    assert.equal(elements.translationTitleProgress.textContent, titleProgress);
  });
}

test("errors retain partial output, identify the component, and allow retry", async () => {
  const instance = app();
  configure(instance);
  instance.elements.translationInput.value = original;
  let requests = 0;
  instance.context.fetch = async () => ++requests === 1 ? streamed("Translated title") :
    new Response("Provider error", { status: 429 });
  await instance.elements.translatePost.click();
  assert.match(instance.elements.translationStatus.textContent, /Error translating description: API error 429/);
  assert.match(instance.elements.translationStatus.textContent, /Output is incomplete/);
  assert.match(instance.elements.translationOutput.value, /Translated title/);
  assert.equal(requests, 2);
  assert.equal(instance.elements.translatePost.disabled, false);
  assert.equal(instance.elements.copyFromBlog.disabled, false);
  assert.equal(instance.elements.translationInput.readOnly, false);
  instance.context.fetch = async () => streamed("Retried");
  await instance.elements.translatePost.click();
  assert.equal(instance.elements.translationStatus.textContent, "Translation complete.");
});

test("failed, incomplete, empty, and truncated API streams report errors", async () => {
  for (const data of [
    { type: "response.failed", response: { error: { message: "Failed response" } } },
    { type: "response.incomplete" },
    { choices: [{ delta: {}, finish_reason: "length" }] },
    { error: { message: "Stream error" } },
    { choices: [{ delta: { content: "" } }] }
  ]) {
    const instance = app();
    configure(instance);
    instance.elements.translationInput.value = original;
    instance.context.fetch = async () => new Response(`data: ${JSON.stringify(data)}\n\n`, {
      headers: { "Content-Type": "text/event-stream" }
    });
    await instance.elements.translatePost.click();
    assert.match(instance.elements.translationStatus.textContent, /Error translating title/);
    assert.equal(instance.elements.translatePost.disabled, false);
  }
});

test("Blog generation, AI features, configuration, copy, and download still work", async () => {
  const instance = app();
  const { elements, context } = instance;
  elements.content.value = '# Original title\n\nBody with "quotes"';
  elements.englishTitle.value = "My First Post!";
  elements.description.value = 'A "description"';
  elements.date.value = "2026-11-15T09:30";
  elements.generate.click();
  assert.equal(elements.title.value, "Original title");
  assert.equal(elements.content.value, 'Body with "quotes"');
  assert.equal(elements.filename.value, "20261115-my-first-post.md");
  assert.match(elements.output.value, /pubDatetime: 2026-11-15T09:30:00[+-]\d\d:\d\d/);
  await elements.copy.click();
  elements.download.click();
  assert.equal(instance.copied[0], elements.output.value);
  assert.equal(instance.downloads[0].download, elements.filename.value);
  configure(instance);
  context.fetch = async (_, options) => {
    assert.equal(JSON.parse(options.body).model, "translator");
    return streamed("English title");
  };
  await elements.generateEnglishTitle.click();
  assert.equal(elements.englishTitle.value, "English title");
  context.fetch = async (_, options) => {
    const request = JSON.parse(options.body);
    assert.equal(request.model, "default-model");
    assert.equal(request.response_format.type, "json_schema");
    return streamed(JSON.stringify({ descriptions: [
      { description: "One", recommendation: 3 },
      { description: "Two", recommendation: 5 },
      { description: "Three", recommendation: 4 }
    ] }));
  };
  await elements.generateDescription.click();
  assert.equal(elements.description.value, "Two");
  elements.saveConfig.click();
  assert.equal(JSON.parse([...instance.storage.values()][0]).translationModel, "translator");
});
