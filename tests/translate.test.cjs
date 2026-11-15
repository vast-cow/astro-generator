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
    disabled: /\bdisabled\b/.test(attributes),
    hidden: /\bhidden\b/.test(attributes),
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
    dispatchEvent(event) { return this.listeners[event.type]?.(event); },
    click() { return this.dispatchEvent({ type: "click" }); },
    replaceChildren() { this.children = []; },
    append(...children) { this.children.push(...children); }
  };
}

function app({
  storage = new Map(),
  href = "http://localhost/index.html",
  localStorage = {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value)
  }
} = {}) {
  const elements = {};
  for (const match of html.matchAll(/<\w+\b([^>]*\bid="([^"]+)"[^>]*)>/g)) {
    elements[match[2]] = element(match[1]);
    elements[match[2]].id = match[2];
  }
  for (const match of html.matchAll(/<button\b[^>]*\bid="([^"]+)"[^>]*>([^<]*)<\/button>/g)) {
    elements[match[1]].textContent = match[2].trim();
  }
  const buttons = [...html.matchAll(/<button\b([^>]*data-tab="[^"]+"[^>]*)>/g)]
    .map(match => element(match[1]));
  const alerts = [];
  const copied = [];
  const downloads = [];
  const context = vm.createContext({
    window: { location: new URL(href) },
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
    Blob, TextDecoder, Uint8Array, AbortController,
    localStorage,
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
  edit(instance.elements.apiEndpoint, `https://provider.test/v1/${endpoint}`);
  edit(instance.elements.apiModel, "default-model");
  edit(instance.elements.translationModel, translationModel);
  edit(instance.elements.apiKey, "test-key");
}

function edit(field, value, type = "input") {
  field.value = value;
  field.dispatchEvent({ type });
}

function stored(instance, tab, pathname = "/index.html") {
  return JSON.parse(instance.storage.get(`astro-blog-generator:${pathname}:${tab}`));
}

function assertRestored(instance, ids) {
  const reloaded = app({ storage: instance.storage });
  for (const id of ids) {
    assert.equal(reloaded.elements[id].value, instance.elements[id].value, id);
  }
  return reloaded;
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

function deferred() {
  let resolve, reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function assertTranslationIdle(elements) {
  assert.equal(elements.translatePost.disabled, false);
  assert.equal(elements.translatePost.textContent, "Translate");
  assert.equal(elements.cancelTranslation.hidden, true);
  assert.equal(elements.cancelTranslation.disabled, true);
  assert.equal(elements.copyFromBlog.disabled, false);
  assert.equal(elements.translationInput.readOnly, false);
  assert.equal(elements.targetLanguage.disabled, false);
  assert.equal(elements.translationFilename.readOnly, false);
}

test("all editable tab fields save on input and change and restore after reload", () => {
  const instance = app();
  const fields = {
    blog: {
      content: "# Draft\n\n本文", date: "2026-11-15T09:30", title: "Draft title",
      englishTitle: "Draft post", description: "Draft description", filename: "custom.md"
    },
    translate: {
      translationFilename: "translation.md", translationInput: original, targetLanguage: "Japanese"
    },
    config: {
      apiEndpoint: "https://provider.test/v1/responses", apiKey: "test-key",
      apiModel: "summary-model", translationModel: "translator"
    }
  };
  const configNames = { apiEndpoint: "endpoint", apiKey: "apiKey", apiModel: "model", translationModel: "translationModel" };
  const editableIds = [...html.matchAll(/<(input|textarea)\b([^>]*)>/g)]
    .filter(([, , attributes]) => !/\breadonly\b/.test(attributes))
    .map(([, , attributes]) => attributes.match(/\bid="([^"]+)"/)[1]);
  assert.deepEqual(Object.values(fields).flatMap(Object.keys).sort(), editableIds.sort());
  for (const [tab, values] of Object.entries(fields)) {
    for (const [id, value] of Object.entries(values)) {
      for (const type of ["input", "change"]) {
        edit(instance.elements[id], value, type);
        assert.equal(stored(instance, tab)[configNames[id] || id], value);
        assertRestored(instance, [id]);
        // Empty values must replace saved values, rather than falling back to defaults.
        edit(instance.elements[id], "", type);
        assert.equal(stored(instance, tab)[configNames[id] || id], "");
        assertRestored(instance, [id]);
      }
      edit(instance.elements[id], value);
    }
  }
  assertRestored(instance, editableIds);
  assert.equal(instance.elements.saveConfig, undefined);
  assert.equal(instance.elements.configStatus, undefined);
});

test("missing saved data preserves defaults without writing storage", () => {
  const { elements, storage } = app();
  assert.match(elements.date.value, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  assert.equal(elements.targetLanguage.value, "English");
  for (const id of ["content", "title", "englishTitle", "description", "filename", "output",
    "translationInput", "translationFilename", "translationOutput", "apiEndpoint", "apiKey", "apiModel", "translationModel"]) {
    assert.equal(elements[id].value, "", id);
  }
  assert.equal(storage.size, 0);
});

test("all tab storage is isolated by pathname and shared across query strings and fragments", () => {
  const storage = new Map();
  const first = app({ storage, href: "https://example.test/one/?draft=1#blog" });
  const second = app({ storage, href: "https://example.test/two/" });
  for (const [instance, suffix] of [[first, "one"], [second, "two"]]) {
    edit(instance.elements.content, `Blog ${suffix}`);
    edit(instance.elements.translationInput, `Translate ${suffix}`);
    edit(instance.elements.apiKey, `key-${suffix}`);
  }
  assert.deepEqual([...storage.keys()].sort(), ["/one/", "/two/"].flatMap(pathname =>
    ["blog", "config", "translate"].map(tab => `astro-blog-generator:${pathname}:${tab}`)).sort());
  for (const suffix of ["one", "two"]) {
    const reloaded = app({ storage, href: `https://example.test/${suffix}/?draft=2#config` });
    assert.equal(reloaded.elements.content.value, `Blog ${suffix}`);
    assert.equal(reloaded.elements.translationInput.value, `Translate ${suffix}`);
    assert.equal(reloaded.elements.apiKey.value, `key-${suffix}`);
  }
});

test("legacy configuration migrates at the same URL and newer values take priority", () => {
  const legacyKey = "astro-blog-generator:http://localhost/index.html:config";
  const legacy = { endpoint: "https://provider.test/v1/responses", apiKey: "old-key", model: "old-model" };
  const storage = new Map([[legacyKey, JSON.stringify(legacy)]]);
  const instance = app({ storage, href: "http://localhost/index.html?query=1#config" });
  assert.equal(instance.elements.apiEndpoint.value, legacy.endpoint);
  assert.equal(instance.elements.apiKey.value, legacy.apiKey);
  assert.equal(instance.elements.apiModel.value, legacy.model);
  assert.equal(instance.elements.translationModel.value, "");
  assert.deepEqual(stored(instance, "config"), { ...legacy, translationModel: "" });
  edit(instance.elements.apiKey, "");
  edit(instance.elements.apiModel, "new-model");
  edit(instance.elements.translationModel, "new-translator");
  const reloaded = assertRestored(instance, ["apiEndpoint", "apiKey", "apiModel", "translationModel"]);
  assert.equal(reloaded.elements.apiKey.value, "");
  assert.equal(storage.get(legacyKey), JSON.stringify(legacy));
  const otherPage = app({ storage, href: "http://localhost/other.html" });
  assert.equal(otherPage.elements.apiKey.value, "");
  assert.equal(otherPage.elements.apiModel.value, "");
  // Also retain a legacy translation model when the new record is corrupt.
  storage.set(legacyKey, JSON.stringify({ ...legacy, translationModel: "legacy-translator" }));
  storage.set("astro-blog-generator:/index.html:config", "{broken");
  const recovered = app({ storage });
  assert.equal(recovered.elements.translationModel.value, "legacy-translator");
  assertRestored(recovered, ["apiEndpoint", "apiKey", "apiModel", "translationModel"]);
});

test("invalid storage is ignored per tab and valid string fields restore independently", () => {
  for (const invalid of ["{broken", "null", "[]", "42", '"text"', "true"]) {
    const storage = new Map(["blog", "translate", "config"].map(tab =>
      [`astro-blog-generator:/index.html:${tab}`, invalid]));
    const instance = app({ storage });
    assert.equal(instance.elements.content.value, "");
    assert.equal(instance.elements.targetLanguage.value, "English");
    assert.match(instance.elements.date.value, /^\d{4}-/);
    edit(instance.elements.content, "Recovered draft");
    assertRestored(instance, ["content"]);
  }
  const storage = new Map([
    ["astro-blog-generator:/index.html:blog", JSON.stringify({ content: "Valid draft", date: null, title: 42, output: {} })],
    ["astro-blog-generator:/index.html:translate", JSON.stringify({ translationInput: false, targetLanguage: ["Japanese"] })],
    ["astro-blog-generator:/index.html:config", JSON.stringify({ endpoint: "https://provider.test", apiKey: {}, model: 42 })]
  ]);
  const instance = app({ storage });
  assert.equal(instance.elements.content.value, "Valid draft");
  assert.match(instance.elements.date.value, /^\d{4}-/);
  assert.equal(instance.elements.title.value, "");
  assert.equal(instance.elements.output.value, "");
  assert.equal(instance.elements.translationInput.value, "");
  assert.equal(instance.elements.targetLanguage.value, "English");
  assert.equal(instance.elements.apiEndpoint.value, "https://provider.test");
  assert.equal(instance.elements.apiKey.value, "");
  assert.equal(instance.elements.apiModel.value, "");
});

test("blocked reads and full storage do not interrupt editing, generation, or AI operations", async () => {
  for (const blockReads of [true, false]) {
    const instance = app({ localStorage: {
      getItem() { if (blockReads) throw new Error("Storage blocked"); return null; },
      setItem() { throw new Error("Storage unavailable or full"); }
    } });
    const { elements, context } = instance;
    configure(instance);
    edit(elements.content, "# Draft title\n\nArticle body");
    elements.generate.click();
    assert.equal(elements.title.value, "Draft title");
    assert.match(elements.output.value, /Article body/);
    context.fetch = async () => streamed("AI result");
    await elements.generateEnglishTitle.click();
    assert.equal(elements.englishTitle.value, "AI result");
    elements.copyFromBlog.click();
    await elements.translatePost.click();
    assert.equal(elements.translationStatus.textContent, "Translation complete.");
    assert.ok(elements.translationOutput.value.endsWith("AI result"));
    assertTranslationIdle(elements);
  }
});

test("extraction, generation, and Copy from Blog persist without linking the tabs", () => {
  const instance = app();
  const { elements } = instance;
  edit(elements.translationInput, "Independent input");
  edit(elements.translationFilename, "independent.md");
  edit(elements.content, "# Extracted title\n\nBody");
  elements.extractTitle.click();
  assertRestored(instance, ["title", "content"]);
  elements.generate.click();
  const reloaded = assertRestored(instance, ["title", "content", "date", "filename", "output",
    "translationInput", "translationFilename"]);
  assert.equal(reloaded.elements.translationInput.value, "Independent input");
  assert.equal(reloaded.elements.translationFilename.value, "independent.md");
  instance.storage.set("astro-blog-generator:/index.html:translate", JSON.stringify({
    translationOutput: "Old translation"
  }));
  const copied = app({ storage: instance.storage });
  copied.elements.copyFromBlog.click();
  const afterCopy = assertRestored(copied, ["translationInput", "translationFilename", "translationOutput"]);
  assert.equal(afterCopy.elements.translationInput.value, elements.output.value);
  assert.equal(afterCopy.elements.translationFilename.value, elements.filename.value);
  assert.equal(afterCopy.elements.translationOutput.value, "");
  edit(afterCopy.elements.content, "Changed Blog");
  afterCopy.elements.generate.click();
  const independent = assertRestored(afterCopy, ["content", "translationInput", "translationFilename"]);
  assert.equal(independent.elements.translationInput.value, elements.output.value);
});

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
  assert.equal(elements.cancelTranslation.hidden, true);
  assert.equal(elements.cancelTranslation.disabled, true);
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
    assert.equal(instance.elements.cancelTranslation.hidden, true);
    assert.equal(instance.elements.cancelTranslation.disabled, true);
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
    assert.equal(elements.cancelTranslation.hidden, false);
    assert.equal(elements.cancelTranslation.disabled, false);
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
    assertRestored(instance, ["translationOutput"]);
    assert.match(elements.translationTitleProgress.textContent, /Título/);
    assert.match(elements.translationDescriptionProgress.textContent, /Descrição/);
    const remainder = original.slice(original.indexOf("\n\n- [A link]"));
    bodyController.enqueue(encoder.encode(event(remainder, endpoint === "responses")));
    bodyController.close();
    await translating;
    assert.equal(calls.length, 3);
    assert.equal(elements.translationStatus.textContent, "Translation complete.");
    assertTranslationIdle(elements);
    assert.equal(elements.translatePost.disabled, false);
    assert.equal(elements.copyFromBlog.disabled, false);
    assert.equal(elements.translationInput.readOnly, false);
    assert.equal(elements.translationFilename.value, "renamed-during-translation.md");
    assert.equal(elements.translationInput.value, input);
    assert.ok(elements.translationOutput.value.endsWith("\n## Traduzido" + remainder));
    assert.ok(elements.translationOutput.value.includes(original.slice(original.indexOf("pubDatetime:"), original.indexOf("---\n\n"))));
    assert.equal(elements.output.value, original);
    assert.equal(elements.filename.value, "blog-name.md");
    assertRestored(instance, [
      "translationFilename", "translationInput", "targetLanguage", "translationOutput"
    ]);
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

for (const endpoint of ["chat/completions", "responses"]) {
  for (const [index, component] of ["title", "description", "body"].entries()) {
    test(`${endpoint}: cancel during ${component} stops the stream, retains output, and allows retry`, async () => {
      const instance = app();
      const { elements, context } = instance;
      configure(instance, endpoint);
      elements.translationInput.value = original;
      elements.translationFilename.value = "translation.md";
      const signals = [];
      let streamCancelled = false;
      const responses = endpoint === "responses";
      context.fetch = async (_, options) => {
        signals.push(options.signal);
        if (signals.length <= index) return streamed(`Completed ${signals.length}`, responses);
        return new Response(new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode(event(`Partial ${component}`, responses)));
          },
          cancel() { streamCancelled = true; }
        }), { headers: { "Content-Type": "text/event-stream" } });
      };

      const translating = elements.translatePost.click();
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(signals.length, index + 1);
      assert.equal(elements.translationStatus.textContent, `Translating ${component}...`);
      assert.match(elements.translationOutput.value, new RegExp(`Partial ${component}`));
      assert.equal(elements.cancelTranslation.hidden, false);
      assert.equal(elements.cancelTranslation.disabled, false);
      const partialOutput = elements.translationOutput.value;
      const progress = ["translationTitleProgress", "translationDescriptionProgress", "translationBodyProgress"]
        .map(id => elements[id].textContent);

      elements.cancelTranslation.click();
      // Controls recover synchronously, before the aborted request settles.
      assertTranslationIdle(elements);
      assert.equal(elements.translationStatus.textContent, "Translation cancelled.");
      assert.equal(elements.translationFilename.value, "translation.md");
      assert.ok(signals.every(signal => signal === signals[0] && signal.aborted));
      assert.equal(streamCancelled, true);
      await translating;
      assert.equal(signals.length, index + 1);
      assert.equal(elements.translationOutput.value, partialOutput);
      const reloaded = assertRestored(instance, ["translationOutput", "translationInput", "translationFilename"]);
      assertTranslationIdle(reloaded.elements);
      assert.deepEqual(["translationTitleProgress", "translationDescriptionProgress", "translationBodyProgress"]
        .map(id => elements[id].textContent), progress);
      assert.equal(elements.translationStatus.textContent, "Translation cancelled.");

      let retriedRequests = 0;
      context.fetch = async (_, options) => {
        retriedRequests++;
        assert.notEqual(options.signal, signals[0]);
        assert.equal(options.signal.aborted, false);
        return streamed(`Retry ${retriedRequests}`, responses);
      };
      await elements.translatePost.click();
      assert.equal(retriedRequests, 3);
      assert.equal(elements.translationStatus.textContent, "Translation complete.");
      assert.match(elements.translationOutput.value, /title: "Retry 1"/);
      assert.match(elements.translationOutput.value, /description: "Retry 2"/);
      assert.ok(elements.translationOutput.value.endsWith("Retry 3"));
      assertTranslationIdle(elements);
      elements.cancelTranslation.click();
      assert.equal(elements.translationStatus.textContent, "Translation complete.");
    });
  }
}

test("cancelling while connecting aborts fetch without displaying an API error", async () => {
  const instance = app();
  const { elements, context } = instance;
  configure(instance);
  elements.translationInput.value = original;
  let signal;
  let requests = 0;
  context.fetch = (_, options) => new Promise((resolve, reject) => {
    requests++;
    signal = options.signal;
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
  const translating = elements.translatePost.click();
  assert.equal(elements.translationTitleProgress.textContent, "Connecting...");
  assert.equal(elements.cancelTranslation.hidden, false);
  elements.cancelTranslation.click();
  assert.equal(signal.aborted, true);
  assertTranslationIdle(elements);
  await translating;
  assert.equal(requests, 1);
  assert.equal(elements.translationStatus.textContent, "Translation cancelled.");
  assert.equal(elements.translationTitleProgress.textContent, "Connecting...");
  assert.equal(elements.translationOutput.value, original);
});

for (const lateResult of ["stream", "JSON", "error"]) {
  test(`late ${lateResult} from a cancelled translation cannot modify a new running translation`, async () => {
    const instance = app();
    const { elements, context } = instance;
    configure(instance);
    elements.translationInput.value = original;
    const late = deferred();
    let oldSignal;
    let oldRequests = 0;
    context.fetch = async (_, options) => {
      oldRequests++;
      oldSignal = options.signal;
      // Simulate a provider that ignores abort, including a pending JSON body.
      return lateResult === "JSON" ? {
        ok: true,
        headers: new Headers({ "Content-Type": "application/json" }),
        json: () => late.promise
      } : late.promise;
    };
    const cancelledRun = elements.translatePost.click();
    await new Promise(resolve => setImmediate(resolve));
    elements.cancelTranslation.click();
    assert.equal(oldSignal.aborted, true);
    assertTranslationIdle(elements);

    let newRequests = 0;
    let newBody;
    let newStreamCancelled = false;
    context.fetch = async () => {
      newRequests++;
      if (newRequests < 3) return streamed(`New ${newRequests}`);
      return new Response(new ReadableStream({
        start(controller) {
          newBody = controller;
          controller.enqueue(encoder.encode(event("New body")));
        },
        cancel() { newStreamCancelled = true; }
      }), { headers: { "Content-Type": "text/event-stream" } });
    };
    const newRun = elements.translatePost.click();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(newRequests, 3);
    const newOutput = elements.translationOutput.value;
    const newProgress = ["translationTitleProgress", "translationDescriptionProgress", "translationBodyProgress"]
      .map(id => elements[id].textContent);
    if (lateResult === "error") late.reject(new Error("Late provider failure"));
    else if (lateResult === "JSON") late.resolve({ choices: [{ message: { content: "STALE JSON" } }] });
    else late.resolve(streamed("STALE stream"));
    await cancelledRun;

    assert.equal(oldRequests, 1);
    assert.equal(elements.translationOutput.value, newOutput);
    assertRestored(instance, ["translationOutput"]);
    assert.deepEqual(["translationTitleProgress", "translationDescriptionProgress", "translationBodyProgress"]
      .map(id => elements[id].textContent), newProgress);
    assert.equal(elements.translationStatus.textContent, "Translating body...");
    assert.equal(elements.translatePost.disabled, true);
    assert.equal(elements.cancelTranslation.hidden, false);
    assert.equal(elements.cancelTranslation.disabled, false);
    assert.equal(elements.copyFromBlog.disabled, true);
    assert.equal(elements.translationInput.readOnly, true);
    assert.equal(elements.targetLanguage.disabled, true);
    assert.equal(newStreamCancelled, false);

    newBody.close();
    await newRun;
    assert.equal(elements.translationOutput.value, newOutput);
    assert.equal(elements.translationStatus.textContent, "Translation complete.");
    assertTranslationIdle(elements);
  });
}

test("cancelling Translate leaves a concurrent Blog AI request running", async () => {
  const instance = app();
  const { elements, context } = instance;
  configure(instance);
  elements.title.value = "Blog title";
  elements.translationInput.value = original;
  let blogBody;
  let blogCancelled = false;
  let requests = 0;
  context.fetch = async (_, options) => {
    requests++;
    if (requests === 1) {
      assert.equal(options.signal, undefined);
      return new Response(new ReadableStream({
        start(controller) { blogBody = controller; },
        cancel() { blogCancelled = true; }
      }), { headers: { "Content-Type": "text/event-stream" } });
    }
    assert.equal(options.signal.aborted, false);
    return new Response(new ReadableStream(), { headers: { "Content-Type": "text/event-stream" } });
  };
  const blogRun = elements.generateEnglishTitle.click();
  const translationRun = elements.translatePost.click();
  await new Promise(resolve => setImmediate(resolve));
  elements.cancelTranslation.click();
  await translationRun;
  assert.equal(requests, 2);
  assert.equal(blogCancelled, false);
  assert.equal(elements.generateEnglishTitle.disabled, true);
  blogBody.enqueue(encoder.encode(event("Translated Blog title")));
  blogBody.close();
  await blogRun;
  assert.equal(elements.englishTitle.value, "Translated Blog title");
  assert.equal(elements.generateEnglishTitle.disabled, false);
  assert.equal(elements.translationStatus.textContent, "Translation cancelled.");
  assertTranslationIdle(elements);
});

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
  assertRestored(instance, ["translationOutput"]);
  assert.equal(instance.elements.translatePost.disabled, false);
  assert.equal(instance.elements.copyFromBlog.disabled, false);
  assert.equal(instance.elements.translationInput.readOnly, false);
  assertTranslationIdle(instance.elements);
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
  assertRestored(instance, ["englishTitle"]);
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
  assertRestored(instance, ["description"]);
  assert.equal(stored(instance, "config").translationModel, "translator");
  assertRestored(instance, [
    "content", "date", "title", "englishTitle", "description", "filename", "output",
    "apiEndpoint", "apiKey", "apiModel", "translationModel"
  ]);
  // Selecting another candidate also saves without a user input event.
  elements.descriptionOptionsList.children[1].children[1].click();
  assert.equal(elements.description.value, "Three");
  assertRestored(instance, ["description"]);
});
