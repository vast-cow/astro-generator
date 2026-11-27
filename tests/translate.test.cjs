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
  const attrs = new Map([...attributes.matchAll(/([\w-]+)="([^"]*)"/g)]
    .map(([, name, value]) => [name, value]));
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
    get href() { return this.getAttribute("href") || ""; },
    set href(value) { this.setAttribute("href", value); },
    getAttribute: name => attrs.get(name) ?? null,
    setAttribute: (name, value) => attrs.set(name, value),
    removeAttribute: name => attrs.delete(name),
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
  dateConstructor = Date,
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
    URL: class extends URL {
      static createObjectURL() { return "blob:test"; }
      static revokeObjectURL() {}
    },
    Blob, TextDecoder, Uint8Array, AbortController, Date: dateConstructor,
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

test("persistent editable tab fields save on input and change and restore after reload", () => {
  const instance = app();
  const fields = {
    blog: {
      content: "# Draft\n\n本文", title: "Draft title",
      englishTitle: "Draft post", description: "Draft description", filename: "custom.md"
    },
    translate: {
      translationFilename: "translation.md", translationInput: original, targetLanguage: "Japanese"
    },
    config: {
      apiEndpoint: "https://provider.test/v1/responses", apiKey: "test-key",
      apiModel: "summary-model", translationModel: "translator",
      blogLinkUrl: "http://localhost:8000/blog?view=draft#editor",
      translateLinkUrl: "https://example.test/translate"
    }
  };
  const configNames = { apiEndpoint: "endpoint", apiKey: "apiKey", apiModel: "model", translationModel: "translationModel" };
  const editableIds = [...html.matchAll(/<(input|textarea)\b([^>]*)>/g)]
    .filter(([, , attributes]) => !/\breadonly\b/.test(attributes))
    .map(([, , attributes]) => attributes.match(/\bid="([^"]+)"/)[1])
    .filter(id => id !== "date");
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

test("writing date uses the local time of each load and is omitted from saved fields", () => {
  const key = "astro-blog-generator:/index.html:blog";
  const legacy = JSON.stringify({ content: "Saved draft", date: "2026-11-15T09:30" });
  const storage = new Map([[key, legacy]]);
  let now = new Date(2026, 10, 19, 14, 5);
  class LoadDate extends Date {
    constructor(value = now) { super(value); }
  }
  const instance = app({ storage, dateConstructor: LoadDate });
  const { elements } = instance;
  assert.equal(elements.date.value, "2026-11-19T14:05");
  assert.equal(elements.content.value, "Saved draft");
  edit(elements.date, "2026-11-16T10:45", "input");
  edit(elements.date, "2026-11-16T11:45", "change");
  assert.equal(storage.get(key), legacy);
  elements.generate.click();
  assert.equal(elements.filename.value, "20261116-post.md");
  assert.match(elements.output.value, /pubDatetime: 2026-11-16T11:45:00/);
  assert.equal(Object.hasOwn(stored(instance, "blog"), "date"), false);

  now = new Date(2026, 10, 20, 0, 10);
  const reloaded = app({ storage, dateConstructor: LoadDate });
  assert.equal(reloaded.elements.date.value, "2026-11-20T00:10");
  assert.equal(reloaded.elements.content.value, "Saved draft");
  assert.equal(reloaded.elements.output.value, elements.output.value);
});

test("missing saved data preserves defaults without writing storage", () => {
  const { elements, storage } = app();
  assert.match(elements.date.value, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  assert.equal(elements.targetLanguage.value, "English");
  for (const id of ["content", "title", "englishTitle", "description", "filename", "output",
    "translationInput", "translationFilename", "translationOutput", "apiEndpoint", "apiKey", "apiModel",
    "translationModel", "blogLinkUrl", "translateLinkUrl"]) {
    assert.equal(elements[id].value, "", id);
  }
  assert.equal(storage.size, 0);
});

function assertDisabledLink(link) {
  assert.equal(link.getAttribute("href"), null);
  assert.equal(link.getAttribute("aria-disabled"), "true");
}

const outputLinkTabs = [
  ["blog", "blogLinkUrl", "filename", "output", "blogOutputLink"],
  ["translate", "translateLinkUrl", "translationFilename", "translationOutput", "translationOutputLink"]
];

test("each output link requires its own valid URL, filename, and output and preserves a plain saved URL", () => {
  const filename = "  投稿 + & # %?.md  ";
  const markdown = original + "\n日本語 + & # %?=\n\n";
  for (const [tab, configId, filenameId, outputId, linkId] of outputLinkTabs) {
    const destination = `http://localhost:8000/${tab}?tag=%e6%97%a5&tag=%2B&filename=old&content=old%20body&bare#draft`;
    for (const hasOutput of [false, true]) {
      const storage = new Map([[`astro-blog-generator:/index.html:${tab}`, JSON.stringify({
        [filenameId]: filename,
        [outputId]: hasOutput ? markdown : "",
        ...(tab === "translate" && { translationComplete: true })
      })]]);
      const instance = app({ storage });
      const { elements } = instance;
      const link = elements[linkId];
      assertDisabledLink(link);
      edit(elements[tab === "blog" ? "translateLinkUrl" : "blogLinkUrl"], "https://other.test");
      assertDisabledLink(link);

      edit(elements[configId], destination);
      if (hasOutput) {
        assert.equal(link.getAttribute("aria-disabled"), "false");
        assert.equal(link.getAttribute("target"), "_blank");
        assert.equal(link.getAttribute("rel"), "noopener noreferrer");
        assert.equal(link.getAttribute("href"), destination);
        const reloaded = assertRestored(instance, [configId, filenameId, outputId]);
        assert.equal(reloaded.elements[linkId].href, link.href);
      } else {
        assertDisabledLink(link);
      }

      edit(elements[filenameId], " \t ");
      assertDisabledLink(link);
      edit(elements[filenameId], filename, "change");
      assert.equal(Boolean(link.href), hasOutput);
      for (const invalid of ["", "/local", "//example.test", "https:example.test",
        "https://", "https:///example.test", "https://\\example.test", "http://\tvalid.test",
        "\u00a0https://example.test", "http://[broken]", "ftp://example.test", "javascript:alert(1)",
        "/import/{filenameEncoded}?body={contentEncoded}", "https://[{filenameEncoded}]/import"]) {
        edit(elements[configId], invalid, "change");
        assertDisabledLink(link);
      }
    }
  }
});

test("both tabs expand all placeholders in one pass and save the original template", async () => {
  const filename = "  投稿 + & # %? {contentEncoded} $&.md  ";
  const body = "## 日本語\n\n- + & # %?= / {filenameEncoded} {content} $&\n\n";
  const instance = app();
  const { elements, context } = instance;
  configure(instance);
  for (const [tab, configId, filenameId, outputId, linkId] of outputLinkTabs) {
    const prefix = `https://example.test/${tab}`;
    const template = `${prefix}/{filenameEncoded}?body={contentEncoded}&file={filenameEncoded}` +
      "&copy={contentEncoded}#file={filename}&raw={content}&fileAgain={filename}&rawAgain={content}";
    edit(elements[configId], template);
    assertDisabledLink(elements[linkId]);

    if (tab === "blog") {
      edit(elements.title, "日本語");
      edit(elements.content, body);
      elements.generate.click();
    } else {
      edit(elements.translationInput, original);
      const responses = ["日本語", "説明", body];
      context.fetch = async () => streamed(responses.shift());
      await elements.translatePost.click();
    }
    edit(elements[filenameId], filename);

    const markdown = elements[outputId].value;
    assert.match(markdown, /^---\ntitle: "日本語"/);
    assert.ok(markdown.endsWith(body));
    const encodedFilename = encodeURIComponent(filename.trim());
    const encodedContent = encodeURIComponent(markdown);
    const expected = new URL(`${prefix}/${encodedFilename}?body=${encodedContent}&file=${encodedFilename}` +
      `&copy=${encodedContent}#file=${filename.trim()}&raw=${markdown}&fileAgain=${filename.trim()}&rawAgain=${markdown}`);
    const actual = new URL(elements[linkId].href);
    assert.equal(actual.href, expected.href);
    assert.equal(actual.searchParams.get("body"), markdown);
    assert.equal(actual.searchParams.get("file"), filename.trim());
    assert.equal(stored(instance, "config")[configId], template);
    const reloaded = assertRestored(instance, [configId, filenameId, outputId]);
    assert.equal(reloaded.elements[linkId].href, expected.href);
  }
});

test("both output links clear content placeholders only above 7,000 normalized URL characters", () => {
  const filename = "  投稿 + & #.md  ";
  const markdown = original + "\n## 日本語\n\n- 記号: + & # %?=\n\n";
  const oversizedValue = "x".repeat(7000);
  for (const [tab, configId, filenameId, outputId, linkId] of outputLinkTabs) {
    const prefix = `http://localhost:8000/${tab}`;
    const urlPrefix = `${prefix}/${encodeURIComponent(filename.trim())}?tag=%e6%97%a5&tag=%2B`;
    const expanded = (extra, content) => new URL(
      `${urlPrefix}&extra=${extra}&body=${encodeURIComponent(content)}#raw=${content}&name=${filename.trim()}`
    ).href;
    const padding = "x".repeat(7000 - expanded("", markdown).length);

    const instance = app({ storage: new Map([[`astro-blog-generator:/index.html:${tab}`, JSON.stringify({
      [filenameId]: filename, [outputId]: markdown,
      ...(tab === "translate" && { translationComplete: true })
    })]]) });
    const { elements } = instance;

    for (const extra of [padding, `${padding}x`, oversizedValue]) {
      const fullUrl = expanded(extra, markdown);
      const length = 7000 + extra.length - padding.length;
      assert.equal(fullUrl.length, length);
      const expected = length > 7000 ? expanded(extra, "") : fullUrl;
      const template = `${prefix}/${oversizedValue}/../{filenameEncoded}?tag=%e6%97%a5&tag=%2B` +
        `&extra=${extra}&body={contentEncoded}#raw={content}&name={filename}`;

      edit(elements[configId], template);
      assert.equal(elements[linkId].href, expected, `${tab} at ${length} normalized characters`);
      assert.equal(new URL(elements[linkId].href).searchParams.get("body"), length > 7000 ? "" : markdown);
      assert.equal(elements[linkId].getAttribute("aria-disabled"), "false");
      assert.equal(elements[outputId].value, markdown);
      assert.equal(stored(instance, tab)[outputId], markdown);
      assert.equal(assertRestored(instance, [configId, outputId]).elements[linkId].href, expected);
    }
  }
});

test("translation links stay disabled for interrupted, failed, and legacy output and enable after success", async () => {
  const saved = {
    translationFilename: " translation.md ",
    translationInput: original,
    translationOutput: original
  };
  const storage = new Map([["astro-blog-generator:/index.html:translate", JSON.stringify(saved)]]);
  const instance = app({ storage });
  const { elements, context } = instance;
  configure(instance);
  edit(elements.translateLinkUrl, "https://example.test/translation/{filenameEncoded}?body={contentEncoded}");
  assert.equal(elements.translationOutput.value, original);
  assertDisabledLink(elements.translationOutputLink);

  const finish = async () => {
    context.fetch = async () => streamed("Complete");
    await elements.translatePost.click();
    assert.equal(stored(instance, "translate").translationComplete, true);
    assert.equal(elements.translationOutputLink.getAttribute("aria-disabled"), "false");
    const reloaded = assertRestored(instance, ["translationOutput"]);
    assert.equal(reloaded.elements.translationOutputLink.href, elements.translationOutputLink.href);
  };
  const assertIncomplete = () => {
    assert.ok(elements.translationOutput.value);
    assert.equal(stored(instance, "translate").translationComplete, false);
    assertDisabledLink(elements.translationOutputLink);
    const reloaded = assertRestored(instance, ["translationOutput", "translateLinkUrl"]);
    assertDisabledLink(reloaded.elements.translationOutputLink);
  };
  await finish();

  const pending = deferred();
  context.fetch = () => pending.promise;
  const cancelled = elements.translatePost.click();
  assertIncomplete();
  elements.cancelTranslation.click();
  pending.resolve(streamed("Late response"));
  await cancelled;
  assertIncomplete();

  let requests = 0;
  context.fetch = async () => ++requests === 1 ? streamed("New title") :
    new Response("Provider error", { status: 429 });
  await elements.translatePost.click();
  assert.match(elements.translationOutput.value, /New title/);
  assertIncomplete();
  await finish();
});

test("Copy from Blog and Clear reset a previously completed translation link", () => {
  for (const button of ["copyFromBlog", "clearTranslate"]) {
    const storage = new Map([
      ["astro-blog-generator:/index.html:blog", JSON.stringify({ filename: "blog.md", output: original })],
      ["astro-blog-generator:/index.html:translate", JSON.stringify({
        translationFilename: "translation.md", translationOutput: original, translationComplete: true
      })],
      ["astro-blog-generator:/index.html:config", JSON.stringify({
        blogLinkUrl: "https://example.test/blog", translateLinkUrl: "https://example.test/translation"
      })]
    ]);
    const instance = app({ storage });
    const { elements } = instance;
    const blogHref = elements.blogOutputLink.href;
    assert.ok(elements.translationOutputLink.href);
    elements[button].click();
    assert.equal(elements.translationOutput.value, "");
    assert.equal(stored(instance, "translate").translationComplete, false);
    assertDisabledLink(elements.translationOutputLink);
    assert.equal(elements.blogOutputLink.href, blogHref);
    assertDisabledLink(assertRestored(instance, ["translationOutput"]).elements.translationOutputLink);
    elements.clearBlog.click();
    assertDisabledLink(elements.blogOutputLink);
  }
});

test("incomplete provider responses retain partial translation output with the link disabled", async () => {
  for (const [endpoint, incompleteResponse] of [
    ["chat/completions", () => new Response(event("Partial body"), {
      headers: { "Content-Type": "text/event-stream" }
    })],
    ["responses", () => new Response(event("Partial body", true), {
      headers: { "Content-Type": "text/event-stream" }
    })],
    ["responses", () => new Response(
      event("Partial body", true) + 'data: {"type":"error","message":"Provider error"}\n\n' +
        "data: [DONE]\n\n",
      { headers: { "Content-Type": "text/event-stream" } }
    )],
    ["chat/completions", () => Response.json({
      choices: [{ message: { content: "Partial body" }, finish_reason: "length" }]
    })],
    ["responses", () => Response.json({
      status: "incomplete", output: [{ content: [{ text: "Partial body" }] }]
    })]
  ]) {
    const instance = app();
    const { elements, context } = instance;
    configure(instance, endpoint);
    edit(elements.translateLinkUrl, "https://example.test/translate");
    edit(elements.translationFilename, "translation.md");
    edit(elements.translationInput, original);
    let requests = 0;
    context.fetch = async () => ++requests < 3
      ? streamed("Finished", endpoint === "responses") : incompleteResponse();

    await elements.translatePost.click();
    assert.match(elements.translationStatus.textContent, /Error translating body.*Output is incomplete/);
    assert.ok(elements.translationOutput.value.endsWith("Partial body"));
    assert.equal(stored(instance, "translate").translationComplete, false);
    assertDisabledLink(elements.translationOutputLink);
    assertDisabledLink(assertRestored(instance, ["translationOutput"]).elements.translationOutputLink);
  }
});

test("complete JSON provider responses enable the translation link", async () => {
  for (const [endpoint, data] of [
    ["chat/completions", {
      choices: [{ message: { content: "Finished" }, finish_reason: "stop" }]
    }],
    ["responses", {
      status: "completed", output: [{ content: [{ text: "Finished" }] }]
    }]
  ]) {
    const instance = app();
    const { elements, context } = instance;
    configure(instance, endpoint);
    edit(elements.translateLinkUrl, "https://example.test/translate");
    edit(elements.translationFilename, "translation.md");
    edit(elements.translationInput, original);
    context.fetch = async () => Response.json(data);

    await elements.translatePost.click();
    assert.equal(elements.translationStatus.textContent, "Translation complete.");
    assert.equal(stored(instance, "translate").translationComplete, true);
    assert.ok(elements.translationOutputLink.href);
  }
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
  assert.deepEqual(stored(instance, "config"), {
    ...legacy, translationModel: "", blogLinkUrl: "", translateLinkUrl: ""
  });
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
  const reloaded = assertRestored(instance, ["title", "content", "filename", "output",
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

test("each Clear button precedes the content and clears only its own tab across reloads", () => {
  const fields = {
    blog: {
      content: "Blog body", title: "Blog title",
      englishTitle: "English title", description: "Summary", filename: "blog.md", output: original
    },
    translate: {
      translationFilename: "translation.md", translationInput: original,
      targetLanguage: "Japanese", translationOutput: "Translated post"
    },
    config: { endpoint: "https://provider.test/v1/responses", model: "summary-model" }
  };
  for (const [tab, button, input, progressIds] of [
    ["blog", "clearBlog", "content", ["englishTitleAIProgress", "descriptionAIProgress"]],
    ["translate", "clearTranslate", "translationInput", ["translationTitleProgress",
      "translationDescriptionProgress", "translationBodyProgress"]]
  ]) {
    const storage = new Map(Object.entries(fields).map(([name, values]) =>
      [`astro-blog-generator:/index.html:${name}`, JSON.stringify(values)]));
    let now = new Date(2026, 10, 20, 23, 55);
    class ClearDate extends Date {
      constructor(value = now) { super(value); }
    }
    const instance = app({ storage, dateConstructor: ClearDate });
    const { elements } = instance;
    assert.equal(elements.date.value, "2026-11-20T23:55");
    const writingDate = "2026-11-19T09:30";
    const targetLanguage = "Brazilian Portuguese";
    edit(elements.date, writingDate);
    if (tab === "translate") edit(elements.targetLanguage, targetLanguage);
    const section = html.match(new RegExp(`<section id="${tab}"[^>]*>([\\s\\S]*?)</section>`))[1];
    assert.match(section, new RegExp(`id="${button}"[^>]*>Clear</button>[\\s\\S]*<label for="${input}"`));
    for (const id of progressIds) {
      elements[id].textContent = "Previous progress";
      elements[id].style.display = "block";
    }
    elements.descriptionOptions.style.display = "block";
    elements.descriptionOptionsList.append(element());
    elements.translationStatus.textContent = "Translation complete.";

    now = new Date(2026, 10, 21, 0, 7, 48);
    elements[button].click();

    const ids = Object.keys(fields[tab]);
    for (const id of ids) {
      assert.equal(elements[id].value, id === "targetLanguage" ? targetLanguage : "", id);
    }
    assertRestored(instance, ids);
    const otherTab = tab === "blog" ? "translate" : "blog";
    assert.deepEqual(stored(instance, otherTab), fields[otherTab]);
    for (const [id, value] of Object.entries(fields[otherTab])) {
      assert.equal(elements[id].value, value, id);
    }
    assert.deepEqual(stored(instance, "config"), fields.config);
    for (const id of progressIds) {
      assert.equal(elements[id].textContent, "");
      assert.equal(elements[id].style.display, "none");
    }
    if (tab === "blog") {
      assert.equal(elements.date.value, "2026-11-21T00:07");
      assert.equal(Object.hasOwn(stored(instance, "blog"), "date"), false);
      assert.equal(elements.descriptionOptions.style.display, "none");
      assert.equal(elements.descriptionOptionsList.children.length, 0);
      assert.equal(elements.translationStatus.textContent, "Translation complete.");
    } else {
      assert.equal(elements.date.value, writingDate);
      assert.equal(elements.translationStatus.textContent, "");
      assert.equal(elements.descriptionOptionsList.children.length, 1);
    }
  }
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
    const completion = endpoint === "responses" ? { type: "response.completed" } :
      { choices: [{ delta: {}, finish_reason: "stop" }] };
    bodyController.enqueue(encoder.encode("data: " + JSON.stringify(completion) + "\n\n"));
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

    newBody.enqueue(encoder.encode("data: [DONE]\n\n"));
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
      assert.equal(options.signal.aborted, false);
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

test("Clear aborts only its tab's requests and ignores late results after a retry", async () => {
  const instance = app();
  const { elements, context } = instance;
  configure(instance);
  edit(elements.title, "Blog title");
  edit(elements.content, "Blog body");
  edit(elements.translationInput, original);
  const requests = [];
  context.fetch = (_, { signal }) => {
    const response = deferred();
    requests.push({ signal, ...response });
    return response.promise;
  };

  const oldTitle = elements.generateEnglishTitle.click();
  const oldDescription = elements.generateDescription.click();
  const oldTranslation = elements.translatePost.click();
  elements.clearTranslate.click();
  assert.equal(requests[2].signal.aborted, true);
  assert.equal(requests[0].signal.aborted, false);
  assert.equal(requests[1].signal.aborted, false);
  assertTranslationIdle(elements);
  assert.equal(elements.translationOutput.value, "");
  assert.equal(elements.translationStatus.textContent, "");

  edit(elements.targetLanguage, "English");
  edit(elements.translationInput, original);
  const newTranslation = elements.translatePost.click();
  elements.clearBlog.click();
  assert.equal(requests[0].signal.aborted, true);
  assert.equal(requests[1].signal.aborted, true);
  assert.equal(requests[3].signal.aborted, false);
  assert.equal(elements.generateEnglishTitle.disabled, false);
  assert.equal(elements.generateDescription.disabled, false);

  edit(elements.title, "New Blog title");
  const newTitle = elements.generateEnglishTitle.click();
  requests[0].resolve(streamed("Stale title"));
  requests[1].reject(new Error("Stale error"));
  requests[2].resolve(streamed("Stale translation"));
  await Promise.all([oldTitle, oldDescription, oldTranslation]);
  assert.equal(elements.englishTitle.value, "");
  assert.equal(elements.generateEnglishTitle.disabled, true);
  assert.equal(elements.englishTitleAIProgress.textContent, "Connecting...");
  assert.equal(elements.descriptionAIProgress.textContent, "");
  assert.equal(elements.description.value, "");
  assert.equal(elements.translationOutput.value, original);

  elements.clearTranslate.click();
  requests[3].resolve(streamed("Stale retry"));
  requests[4].resolve(streamed("New English title"));
  await Promise.all([newTranslation, newTitle]);
  assert.equal(elements.translationOutput.value, "");
  assert.equal(elements.englishTitle.value, "New English title");
  assertRestored(instance, ["description", "englishTitle", "translationOutput"]);
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
    "content", "title", "englishTitle", "description", "filename", "output",
    "apiEndpoint", "apiKey", "apiModel", "translationModel"
  ]);
  // Selecting another candidate also saves without a user input event.
  elements.descriptionOptionsList.children[1].children[1].click();
  assert.equal(elements.description.value, "Three");
  assertRestored(instance, ["description"]);
});

const batchDescriptions = JSON.stringify({ descriptions: [
  { description: "First candidate", recommendation: 2 },
  { description: "Best candidate", recommendation: 5 },
  { description: "Last candidate", recommendation: 4 }
] });
const batchResponses = ["Fresh English title", batchDescriptions, "Titre", "Résumé", "Texte"];

function batchApp() {
  const instance = app();
  const { elements } = instance;
  configure(instance);
  edit(elements.content, "# Draft heading\n\nBody with **Markdown**");
  edit(elements.title, "Previous title");
  edit(elements.englishTitle, "Previous English title");
  edit(elements.description, "Previous description");
  edit(elements.date, "2026-11-15T09:30");
  edit(elements.filename, "previous-blog.md");
  elements.output.value = original;
  edit(elements.translationFilename, "previous-translation.md");
  edit(elements.translationInput, "Previous translation input");
  edit(elements.targetLanguage, "French");
  return instance;
}

function assertRunAllIdle(elements) {
  assertTranslationIdle(elements);
  for (const id of ["runAll", "extractTitle", "generateEnglishTitle", "generateDescription",
    "generate", "copy", "download"]) {
    assert.equal(elements[id].disabled, false, id);
  }
  for (const id of ["content", "date", "title", "englishTitle", "description", "filename"]) {
    assert.equal(elements[id].readOnly, false, id);
  }
}

test("Run All sits below Content and translates the newly generated Markdown in the selected language", async () => {
  const instance = batchApp();
  const { elements, context, buttons } = instance;
  assert.match(html, /id="content"[^>]*><\/textarea>\s*<button id="runAll"[^>]*>Run All<\/button>[\s\S]*?<label for="date">/);
  const prompts = [];
  const firstResponse = deferred();
  context.fetch = async (_, options) => {
    const request = JSON.parse(options.body);
    const index = prompts.push(request.messages[0].content) - 1;
    if (index === 0) {
      assert.equal(elements.title.value, "Draft heading");
      assert.equal(elements.content.value, "Body with **Markdown**");
      return firstResponse.promise;
    }
    if (index === 1) {
      assert.equal(elements.englishTitle.value, batchResponses[0]);
      assert.equal(elements.filename.value, "previous-blog.md");
      assert.equal(elements.output.value, original);
      assert.equal(elements.translationInput.value, "Previous translation input");
      assert.equal(buttons[0].classList.contains("active"), true);
    } else {
      assert.equal(elements.filename.value, "20261115-fresh-english-title.md");
      assert.equal(elements.translationFilename.value, elements.filename.value);
      assert.equal(elements.translationInput.value, elements.output.value);
      assert.equal(buttons[1].classList.contains("active"), true);
      assert.equal(elements.translate.classList.contains("active"), true);
      assert.equal(elements.translationStatus.textContent, `Translating ${["title", "description", "body"][index - 2]}...`);
    }
    return streamed(batchResponses[index]);
  };

  const running = elements.runAll.click();
  await Promise.resolve();
  assert.equal(prompts.length, 1);
  for (const id of ["runAll", "extractTitle", "generateEnglishTitle", "generateDescription",
    "generate", "copyFromBlog", "translatePost", "copy", "download"]) {
    assert.equal(elements[id].disabled, true, id);
    elements[id].click();
  }
  assert.equal(elements.content.readOnly, true);
  assert.equal(prompts.length, 1);
  assert.equal(elements.output.value, original);
  assert.equal(elements.translationInput.value, "Previous translation input");
  assert.deepEqual(instance.copied, []);
  assert.deepEqual(instance.downloads, []);

  firstResponse.resolve(streamed(batchResponses[0]));
  await running;
  assert.equal(prompts.length, 5);
  assert.match(prompts[0], /into English:\n\nDraft heading\n$/);
  assert.ok(prompts[1].endsWith("Body with **Markdown**"));
  assert.match(prompts[2], /^Translate the following article title into French\.[\s\S]*\nDraft heading$/);
  assert.match(prompts[3], /^Translate the following article description into French\.[\s\S]*\nBest candidate$/);
  assert.match(prompts[4], /^Translate the following article body into French\.[\s\S]*\nBody with \*\*Markdown\*\*$/);
  assert.equal(elements.description.value, "Best candidate");
  assert.match(elements.output.value, /description: "Best candidate"/);
  assert.match(elements.translationOutput.value, /title: "Titre"\ndescription: "Résumé"/);
  assert.ok(elements.translationOutput.value.endsWith("Texte"));
  assert.equal(elements.targetLanguage.value, "French");
  assert.equal(elements.translationStatus.textContent, "Translation complete.");
  assert.equal(elements.runAllStatus.textContent, "Run All complete.");
  assertRunAllIdle(elements);
  elements.descriptionOptionsList.children[1].children[1].click();
  assert.equal(elements.description.value, "Last candidate");
});

test("Run All reports missing input and never forwards earlier generation results", async () => {
  const { elements, context } = batchApp();
  edit(elements.content, "Body without a heading");
  edit(elements.title, "");
  let requests = 0;
  context.fetch = async () => {
    requests++;
    return streamed(batchResponses[0]);
  };
  await elements.runAll.click();
  assert.match(elements.runAllStatus.textContent, /stopped at Extract/);
  assert.equal(requests, 0);
  assertRunAllIdle(elements);

  edit(elements.content, "# Title without a body");
  await elements.runAll.click();
  assert.match(elements.runAllStatus.textContent, /stopped at Description/);
  assert.equal(requests, 1);
  assert.equal(elements.output.value, original);
  assert.equal(elements.translationInput.value, "Previous translation input");
  assertRunAllIdle(elements);
});

for (const [failure, step, failureIndex, fail] of [
  ["English title API error", "English title", 0, () => new Response("Provider error", { status: 429 })],
  ["truncated English title stream", "English title", 0, () => new Response(event("Truncated title"), {
    headers: { "Content-Type": "text/event-stream" }
  })],
  ["empty English title", "English title", 0, () => streamed('""')],
  ["invalid description candidates", "Description", 1, () => streamed("Invalid candidates")],
  ["translation API error", "Translate", 3, () => new Response("Provider error", { status: 429 })]
]) {
  test(`Run All stops on ${failure} and can retry`, async () => {
    const { elements, context } = batchApp();
    let requests = 0;
    context.fetch = async () => {
      const index = requests++;
      return index === failureIndex ? fail() : streamed(batchResponses[index]);
    };
    await elements.runAll.click();
    assert.equal(requests, failureIndex + 1);
    assert.equal(elements.runAllStatus.textContent, `Run All stopped at ${step}.`);
    if (step === "Translate") {
      assert.match(elements.translationStatus.textContent, /Error translating description.*429/);
    } else {
      assert.equal(elements.output.value, original);
      assert.equal(elements.filename.value, "previous-blog.md");
      assert.equal(elements.translationInput.value, "Previous translation input");
      assert.equal(elements.translationFilename.value, "previous-translation.md");
    }
    assertRunAllIdle(elements);

    requests = 0;
    context.fetch = async () => streamed(batchResponses[requests++]);
    await elements.runAll.click();
    assert.equal(requests, 5);
    assert.equal(elements.title.value, "Draft heading");
    assert.equal(elements.runAllStatus.textContent, "Run All complete.");
    assertRunAllIdle(elements);
  });
}

for (const [index, step] of ["English title", "Description"].entries()) {
  test(`Blog Clear cancels Run All during ${step} and late results cannot affect a retry`, async () => {
    const { elements, context } = batchApp();
    const oldResponse = deferred();
    const pending = deferred();
    let oldRequests = 0;
    context.fetch = async (_, { signal }) => {
      if (oldRequests++ < index) return streamed(batchResponses[0]);
      pending.resolve(signal);
      return oldResponse.promise;
    };
    const oldRun = elements.runAll.click();
    const oldSignal = await pending.promise;
    elements.clearBlog.click();
    assert.equal(oldSignal.aborted, true);
    assert.equal(elements.runAllStatus.textContent, `Run All cancelled at ${step}.`);
    for (const id of ["content", "title", "englishTitle", "description", "filename", "output"]) {
      assert.equal(elements[id].value, "", id);
    }
    assert.equal(elements.translationInput.value, "Previous translation input");
    assertRunAllIdle(elements);

    edit(elements.title, "New manual title");
    edit(elements.content, "New content without a heading");
    let newRequests = 0;
    context.fetch = async () => streamed(batchResponses[newRequests++]);
    await elements.runAll.click();
    oldResponse.resolve(streamed(index === 0 ? "Stale English title" : batchDescriptions));
    await oldRun;
    assert.equal(oldRequests, index + 1);
    assert.equal(newRequests, 5);
    assert.equal(elements.title.value, "New manual title");
    assert.equal(elements.englishTitle.value, "Fresh English title");
    assert.match(elements.translationInput.value, /New content without a heading$/);
    assert.equal(elements.runAllStatus.textContent, "Run All complete.");
    assertRunAllIdle(elements);
  });
}

test("Translate Cancel stops Run All through the existing stream controls and allows another batch", async () => {
  const { elements, buttons, context } = batchApp();
  const pending = deferred();
  let requests = 0;
  let cancelled = false;
  context.fetch = async (_, { signal }) => {
    const index = requests++;
    if (index < 2) return streamed(batchResponses[index]);
    pending.resolve(signal);
    return new Response(new ReadableStream({
      start(controller) { controller.enqueue(encoder.encode(event("Partial title"))); },
      cancel() { cancelled = true; }
    }), { headers: { "Content-Type": "text/event-stream" } });
  };

  const running = elements.runAll.click();
  const signal = await pending.promise;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(elements.translate.classList.contains("active"), true);
  assert.equal(elements.translationStatus.textContent, "Translating title...");
  assert.match(elements.translationTitleProgress.textContent, /Partial title/);
  assert.equal(elements.cancelTranslation.hidden, false);
  elements.cancelTranslation.click();
  assert.equal(signal.aborted, true);
  assert.equal(cancelled, true);
  assert.equal(elements.runAllStatus.textContent, "Run All cancelled at Translate.");
  assert.equal(elements.translationStatus.textContent, "Translation cancelled.");
  assertRunAllIdle(elements);

  buttons[0].click();
  let retries = 0;
  context.fetch = async () => streamed(batchResponses[retries++]);
  await Promise.all([running, elements.runAll.click()]);
  assert.equal(requests, 3);
  assert.equal(retries, 5);
  assert.equal(elements.translationStatus.textContent, "Translation complete.");
  assert.equal(elements.runAllStatus.textContent, "Run All complete.");
  assertRunAllIdle(elements);
});

test("Run All is disabled while individual Blog AI or translation actions are running", async () => {
  const { elements, context } = batchApp();
  edit(elements.translationInput, original);
  const pending = [deferred(), deferred(), deferred()];
  let requests = 0;
  context.fetch = async () => pending[requests++]?.promise ?? streamed("Translated");
  const title = elements.generateEnglishTitle.click();
  const description = elements.generateDescription.click();
  const translation = elements.translatePost.click();
  assert.equal(requests, 3);
  assert.equal(elements.runAll.disabled, true);
  elements.runAll.click();
  assert.equal(requests, 3);

  pending[0].resolve(streamed(batchResponses[0]));
  pending[1].resolve(streamed(batchResponses[1]));
  await Promise.all([title, description]);
  assert.equal(elements.runAll.disabled, true);
  pending[2].resolve(streamed("Translated title"));
  await translation;
  assert.equal(requests, 5);
  assert.equal(elements.runAllStatus.textContent, "");
  assertRunAllIdle(elements);
});
