<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";

const capabilityState = ref(document.documentElement.getAttribute("data-imgcaps") ?? "missing");
const detectedState = ref<string>();
const renderedBackground = ref("Waiting for the capability runtime…");
const formatPreview = ref<HTMLElement>();

const expectedFormat = computed(() => {
  const tokens = new Set(capabilityState.value.split(/\s+/));

  if (!tokens.has("ready")) {
    return "Pending";
  }

  if (tokens.has("avif")) {
    return "AVIF";
  }

  if (tokens.has("webp")) {
    return "WebP";
  }

  return "PNG";
});

const renderedFormat = computed(() => {
  const value = renderedBackground.value;

  if (/\.avif(?:[?"')]|$)/i.test(value)) {
    return "AVIF";
  }

  if (/\.webp(?:[?"')]|$)/i.test(value)) {
    return "WebP";
  }

  if (/\.png(?:[?"')]|$)/i.test(value)) {
    return "PNG";
  }

  return capabilityState.value === "pending" ? "Suppressed" : "Unknown";
});

let observer: MutationObserver | undefined;

function readBrowserState(): void {
  capabilityState.value = document.documentElement.getAttribute("data-imgcaps") ?? "missing";

  if (capabilityState.value.startsWith("ready") && detectedState.value === undefined) {
    detectedState.value = capabilityState.value;
  }

  void nextTick(updateRenderedBackground);
}

function updateRenderedBackground(): void {
  renderedBackground.value =
    formatPreview.value === undefined
      ? "Format preview is not mounted"
      : getComputedStyle(formatPreview.value).backgroundImage;
}

function forceState(state: string): void {
  document.documentElement.setAttribute("data-imgcaps", state);
}

function restoreDetectedState(): void {
  if (detectedState.value !== undefined) {
    forceState(detectedState.value);
  }
}

onMounted(() => {
  observer = new MutationObserver(readBrowserState);
  observer.observe(document.documentElement, {
    attributeFilter: ["data-imgcaps"],
  });
  readBrowserState();
});

onBeforeUnmount(() => {
  observer?.disconnect();
});
</script>

<template>
  <main class="page-shell">
    <section class="intro">
      <p class="eyebrow">Live integration example</p>
      <h1>Vue 3 + Vite, selected by the browser.</h1>
      <p class="lede">
        This background starts as <code>format-sample.png</code>. imgfmt generates sibling AVIF and
        WebP candidates, installs the capability runtime, and exposes only the selected URL.
      </p>
    </section>

    <section class="demo-grid">
      <article class="visual-card">
        <div
          ref="formatPreview"
          class="format-preview"
          role="img"
          aria-label="Selected imgfmt test pattern"
        >
          <div class="format-label">
            <span>Rendered candidate</span>
            <strong>{{ renderedFormat }}</strong>
          </div>
        </div>
        <div class="legend" aria-label="Test image color legend">
          <span><i class="swatch swatch--png"></i>PNG</span>
          <span><i class="swatch swatch--webp"></i>WebP</span>
          <span><i class="swatch swatch--avif"></i>AVIF</span>
        </div>
      </article>

      <article class="diagnostics">
        <div>
          <p class="label">Root capability state</p>
          <code class="state">{{ capabilityState }}</code>
        </div>

        <div class="result-row">
          <div>
            <p class="label">Expected</p>
            <strong>{{ expectedFormat }}</strong>
          </div>
          <div>
            <p class="label">Computed CSS</p>
            <strong>{{ renderedFormat }}</strong>
          </div>
        </div>

        <div>
          <p class="label">Computed background-image</p>
          <code class="computed-value">{{ renderedBackground }}</code>
        </div>

        <div>
          <p class="label">Preview capability states</p>
          <div class="state-buttons">
            <button type="button" @click="forceState('ready')">PNG fallback</button>
            <button type="button" @click="forceState('ready webp')">WebP</button>
            <button type="button" @click="forceState('ready avif')">AVIF</button>
            <button type="button" @click="forceState('ready avif webp')">AVIF + WebP</button>
            <button
              type="button"
              :disabled="detectedState === undefined"
              @click="restoreDetectedState"
            >
              Restore detected
            </button>
          </div>
        </div>
      </article>
    </section>

    <footer>
      Open DevTools → Network and filter by <code>format-sample</code>. A used background should
      request one candidate after the capability state becomes ready.
    </footer>
  </main>
</template>

<style>
:root {
  color: #15233b;
  background: #f4f7fb;
  font-family:
    Inter,
    ui-sans-serif,
    system-ui,
    -apple-system,
    BlinkMacSystemFont,
    "Segoe UI",
    sans-serif;
  font-synthesis: none;
  text-rendering: optimizeLegibility;
}

* {
  box-sizing: border-box;
}

body {
  min-width: 320px;
  min-height: 100vh;
  margin: 0;
}

button,
code {
  font: inherit;
}

button {
  color: inherit;
}
</style>

<style scoped>
.page-shell {
  width: min(1120px, calc(100% - 40px));
  margin: 0 auto;
  padding: 72px 0 44px;
}

.intro {
  max-width: 760px;
}

.eyebrow,
.label {
  margin: 0;
  color: #60708a;
  font-size: 0.75rem;
  font-weight: 750;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

h1 {
  max-width: 720px;
  margin: 12px 0 18px;
  color: #11213a;
  font-size: clamp(2.5rem, 7vw, 5.8rem);
  font-weight: 780;
  letter-spacing: -0.065em;
  line-height: 0.94;
}

.lede {
  max-width: 660px;
  margin: 0;
  color: #52627a;
  font-size: clamp(1rem, 2vw, 1.2rem);
  line-height: 1.7;
}

.lede code,
footer code {
  color: #7a3ff2;
  font-weight: 700;
}

.demo-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.35fr) minmax(300px, 0.65fr);
  gap: 18px;
  margin-top: 48px;
}

.visual-card,
.diagnostics {
  overflow: hidden;
  border: 1px solid #dce3ee;
  border-radius: 24px;
  background: rgb(255 255 255 / 82%);
  box-shadow: 0 22px 60px rgb(34 48 72 / 10%);
}

.visual-card {
  padding: 14px;
}

.format-preview {
  display: grid;
  min-height: 460px;
  place-items: end start;
  overflow: hidden;
  border-radius: 16px;
  background:
    linear-gradient(180deg, transparent 40%, rgb(12 21 38 / 58%)),
    url("./assets/format-sample.png") center / cover no-repeat;
}

.format-label {
  display: grid;
  gap: 4px;
  padding: 28px;
  color: white;
  text-shadow: 0 2px 24px rgb(0 0 0 / 30%);
}

.format-label span {
  font-size: 0.82rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.format-label strong {
  font-size: clamp(2.4rem, 6vw, 4.8rem);
  letter-spacing: -0.055em;
  line-height: 1;
}

.legend {
  display: flex;
  flex-wrap: wrap;
  gap: 18px;
  padding: 18px 10px 6px;
  color: #52627a;
  font-size: 0.85rem;
  font-weight: 650;
}

.legend span {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.swatch {
  width: 10px;
  height: 10px;
  border-radius: 50%;
}

.swatch--png {
  background: #f26f5b;
}

.swatch--webp {
  background: #21a179;
}

.swatch--avif {
  background: #7a3ff2;
}

.diagnostics {
  display: grid;
  align-content: start;
  gap: 28px;
  padding: 28px;
}

.state {
  display: block;
  margin-top: 10px;
  overflow-wrap: anywhere;
  color: #7a3ff2;
  font-size: 1.05rem;
  font-weight: 760;
}

.result-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}

.result-row strong {
  display: block;
  margin-top: 8px;
  color: #11213a;
  font-size: 1.35rem;
}

.computed-value {
  display: block;
  max-height: 128px;
  margin-top: 10px;
  padding: 12px;
  overflow: auto;
  border-radius: 12px;
  color: #34445d;
  background: #edf2f8;
  font-size: 0.78rem;
  line-height: 1.55;
  overflow-wrap: anywhere;
}

.state-buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
}

button {
  padding: 9px 12px;
  border: 1px solid #d5deea;
  border-radius: 999px;
  background: white;
  cursor: pointer;
  font-size: 0.78rem;
  font-weight: 680;
  transition:
    border-color 160ms ease,
    color 160ms ease,
    transform 160ms ease;
}

button:hover:not(:disabled) {
  border-color: #7a3ff2;
  color: #6b2ee8;
  transform: translateY(-1px);
}

button:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

footer {
  padding: 28px 6px 0;
  color: #60708a;
  font-size: 0.9rem;
  line-height: 1.65;
}

@media (width <= 800px) {
  .page-shell {
    width: min(100% - 24px, 640px);
    padding-top: 42px;
  }

  .demo-grid {
    grid-template-columns: 1fr;
  }

  .format-preview {
    min-height: 390px;
  }
}
</style>
