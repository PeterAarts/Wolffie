<template>
  <div class="sdk-view">
    <!-- Header bar -->
    <div class="sdk-header">
      <div class="sdk-header__left">
        <span class="sdk-header__title">
          <i class="fa-light fa-code sdk-header__icon" />
          API Reference
        </span>
        <span class="sdk-header__badge">OpenAPI 3.0</span>
      </div>
      <div class="sdk-header__right">
        <a
          href="/sdk/swagger.json"
          target="_blank"
          class="sdk-header__link"
          title="Download swagger.json"
        >
          <i class="fa-light fa-download" />
          swagger.json
        </a>
      </div>
    </div>

    <!-- Swagger UI mount point -->
    <div id="wolffie-swagger" />
  </div>
</template>

<script setup>
import { onMounted, onBeforeUnmount } from 'vue'
import SwaggerUIBundle from 'swagger-ui-dist/swagger-ui-es-bundle'
import 'swagger-ui-dist/swagger-ui.css'

let ui = null

onMounted(() => {
  ui = SwaggerUIBundle({
    url:        '/sdk/swagger.json',
    dom_id:     '#wolffie-swagger',
    deepLinking: true,

    presets: [
      SwaggerUIBundle.presets.apis,
    ],

    // Layout without Swagger's own topbar — we use our own header
    layout: 'BaseLayout',

    // UX defaults
    docExpansion:            'list',
    defaultModelsExpandDepth: 1,
    defaultModelExpandDepth:  2,
    filter:                  true,
    tryItOutEnabled:         false,
    displayRequestDuration:  true,
    showExtensions:          true,
    showCommonExtensions:    true,
    persistAuthorization:    true,
    syntaxHighlight:         false,
  })
})

onBeforeUnmount(() => {
  ui = null
})
</script>

<style>
/* ─────────────────────────────────────────────────────────────────────────────
 * Swagger UI overrides — all colours reference Wolffie CSS tokens from
 * main.css so they automatically follow the active theme (Default/Olive/Ocean).
 *
 * NOTE: these rules must be UNSCOPED so they reach Swagger's injected DOM.
 * The .sdk-view prefix provides enough containment.
 * ───────────────────────────────────────────────────────────────────────── */

/* ── Hide Swagger's own topbar ───────────────────────────────────────────── */
.sdk-view .swagger-ui .topbar { display: none !important; }

/* ── Root background ─────────────────────────────────────────────────────── */
.sdk-view           {background: var(--color-bg-primary);min-height: calc(100vh - 4rem);font-family: var(--font-family);}

/* ── Our custom header bar ───────────────────────────────────────────────── */
.sdk-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.75rem 1.5rem;
  background: var(--color-bg-secondary);
  border-bottom: 1px solid var(--color-border);
}

.sdk-header__left {
  display: flex;
  align-items: center;
  gap: 0.625rem;
}

.sdk-header__icon {
  color: var(--color-text-secondary);
  font-size: 1rem;
}

.sdk-header__title {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--color-text-primary);
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.sdk-header__badge {
  font-size: 0.6875rem;
  font-weight: 600;
  background: var(--color-secondary-100);
  color: var(--color-text-secondary);
  border: 1px solid var(--color-border);
  padding: 0.125rem 0.5rem;
  border-radius: var(--radius-lg);
}

.sdk-header__right {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.sdk-header__link {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  font-size: 0.8rem;
  color: var(--color-text-secondary);
  text-decoration: none;
  transition: color 0.15s;
}
.sdk-header__link:hover { color: var(--color-primary); }

/* ── Swagger wrapper padding ─────────────────────────────────────────────── */
#wolffie-swagger {
  padding: 1.5rem 2rem 4rem;
  max-width: 1200px;
  margin: 0 auto;
}

/* ── Info block ──────────────────────────────────────────────────────────── */
.sdk-view .swagger-ui .info {
  margin-bottom: 1.5rem !important;
}
.sdk-view .swagger-ui .info .title {
  font-family: var(--font-family) !important;
  font-size: 1.5rem !important;
  font-weight: 700 !important;
  color: var(--color-text-primary) !important;
}
.sdk-view .swagger-ui .info p,
.sdk-view .swagger-ui .info li,
.sdk-view .swagger-ui .info table td {
  font-family: var(--font-family) !important;
  color: var(--color-text-secondary) !important;
}
.sdk-view .swagger-ui .info a {
  color: var(--color-primary) !important;
}
.sdk-view .swagger-ui .info .description p {
  color: var(--color-text-secondary) !important;
  font-size: 0.875rem !important;
}
.sdk-view .swagger-ui .info hgroup.main h2.title small {
  color: var(--color-text-tertiary) !important;
}

/* ── Server selector / scheme container ──────────────────────────────────── */
.sdk-view .swagger-ui .scheme-container {
  background: var(--color-bg-secondary) !important;
  border: 1px solid var(--color-border) !important;
  border-radius: var(--radius-xl) !important;
  box-shadow: none !important;
  padding: 0.75rem 1rem !important;
  margin-bottom: 1.5rem !important;
}
.sdk-view .swagger-ui .scheme-container label {
  font-family: var(--font-family) !important;
  color: var(--color-text-secondary) !important;
  font-size: 0.75rem !important;
  font-weight: 500 !important;
  text-transform: uppercase !important;
  letter-spacing: 0.06em !important;
}
.sdk-view .swagger-ui select {
  font-family: var(--font-family) !important;
  background: var(--color-bg-primary) !important;
  color: var(--color-text-primary) !important;
  border: 1px solid var(--color-border-dark) !important;
  border-radius: var(--radius-sm) !important;
  font-size: 0.8125rem !important;
  padding: 0.375rem 0.625rem !important;
}

/* ── Authorize button ────────────────────────────────────────────────────── */
.sdk-view .swagger-ui .btn.authorize {
  font-family: var(--font-family) !important;
  background: var(--color-primary) !important;
  border-color: var(--color-primary) !important;
  color: var(--color-bg-primary) !important;
  font-weight: 600 !important;
  font-size: 0.8125rem !important;
  border-radius: var(--radius-sm) !important;
  padding: 0.4375rem 0.875rem !important;
}
.sdk-view .swagger-ui .btn.authorize svg {
  fill: var(--color-bg-primary) !important;
}

/* ── Tag section headings ────────────────────────────────────────────────── */
.sdk-view .swagger-ui .opblock-tag {
  font-family: var(--font-family) !important;
  border-bottom: 1px solid var(--color-border) !important;
  color: var(--color-text-primary) !important;
  font-size: 0.9375rem !important;
  font-weight: 600 !important;
  margin: 0.25rem 0 !important;
  padding: 0.75rem 0 !important;
}
.sdk-view .swagger-ui .opblock-tag:hover {
  background: var(--color-secondary-subtle) !important;
}
.sdk-view .swagger-ui .opblock-tag small {
  font-family: var(--font-family) !important;
  color: var(--color-text-tertiary) !important;
  font-weight: 400 !important;
}

/* ── Operation blocks ────────────────────────────────────────────────────── */
.sdk-view .swagger-ui .opblock {
  border-radius: var(--radius-xl) !important;
  border: 1px solid var(--color-border) !important;
  background: var(--color-bg-secondary) !important;
  box-shadow: none !important;
  margin: 0.375rem 0 !important;
}

/* Method accent colours — left border + subtle tint */
.sdk-view .swagger-ui .opblock.opblock-get {
  border-left: 3px solid var(--color-load) !important;
  background: color-mix(in srgb, var(--color-load) 4%, var(--color-bg-secondary)) !important;
}
.sdk-view .swagger-ui .opblock.opblock-post {
  border-left: 3px solid var(--color-battery) !important;
  background: color-mix(in srgb, var(--color-battery) 4%, var(--color-bg-secondary)) !important;
}
.sdk-view .swagger-ui .opblock.opblock-put {
  border-left: 3px solid var(--color-solar) !important;
  background: color-mix(in srgb, var(--color-solar) 4%, var(--color-bg-secondary)) !important;
}
.sdk-view .swagger-ui .opblock.opblock-patch {
  border-left: 3px solid var(--color-grid) !important;
  background: color-mix(in srgb, var(--color-grid) 4%, var(--color-bg-secondary)) !important;
}
.sdk-view .swagger-ui .opblock.opblock-delete {
  border-left: 3px solid var(--color-error) !important;
  background: color-mix(in srgb, var(--color-error) 4%, var(--color-bg-secondary)) !important;
}

/* Method badge pills */
.sdk-view .swagger-ui .opblock .opblock-summary-method {
  font-family: var(--font-family) !important;
  font-weight: 700 !important;
  font-size: 0.6875rem !important;
  letter-spacing: 0.03em !important;
  min-width: 64px !important;
  text-align: center !important;
  border-radius: var(--radius-sm) !important;
}
.sdk-view .swagger-ui .opblock.opblock-get    .opblock-summary-method { background: var(--color-load)    !important; color: #fff !important; }
.sdk-view .swagger-ui .opblock.opblock-post   .opblock-summary-method { background: var(--color-battery) !important; color: #fff !important; }
.sdk-view .swagger-ui .opblock.opblock-put    .opblock-summary-method { background: var(--color-solar)   !important; color: #000 !important; }
.sdk-view .swagger-ui .opblock.opblock-patch  .opblock-summary-method { background: var(--color-grid)    !important; color: #fff !important; }
.sdk-view .swagger-ui .opblock.opblock-delete .opblock-summary-method { background: var(--color-error)   !important; color: #fff !important; }

/* Summary path + description */
.sdk-view .swagger-ui .opblock .opblock-summary-path {
  font-family: 'Courier New', monospace !important;
  font-size: 0.8125rem !important;
  color: var(--color-text-primary) !important;
}
.sdk-view .swagger-ui .opblock .opblock-summary-path__deprecated {
  color: var(--color-text-tertiary) !important;
}
.sdk-view .swagger-ui .opblock .opblock-summary-description {
  font-family: var(--font-family) !important;
  font-size: 0.75rem !important;
  color: var(--color-text-secondary) !important;
}
.sdk-view .swagger-ui .opblock-summary {
  background: transparent !important;
  border-radius: var(--radius-xl) !important;
}

/* Lock icon (secured routes) */
.sdk-view .swagger-ui .opblock-summary-lock {
  fill: var(--color-text-tertiary) !important;
}

/* ── Expanded block body ─────────────────────────────────────────────────── */
.sdk-view .swagger-ui .opblock-body {
  background: var(--color-bg-primary) !important;
  border-top: 1px solid var(--color-border) !important;
}
.sdk-view .swagger-ui .opblock-section-header {
  background: transparent !important;
  border-bottom: 1px solid var(--color-border) !important;
}
.sdk-view .swagger-ui .opblock-section-header label,
.sdk-view .swagger-ui .opblock-section-header h4 {
  font-family: var(--font-family) !important;
  color: var(--color-text-tertiary) !important;
  font-size: 0.6875rem !important;
  font-weight: 700 !important;
  text-transform: uppercase !important;
  letter-spacing: 0.07em !important;
}

/* ── Parameters table ────────────────────────────────────────────────────── */
.sdk-view .swagger-ui table thead tr td,
.sdk-view .swagger-ui table thead tr th {
  font-family: var(--font-family) !important;
  color: var(--color-text-tertiary) !important;
  font-size: 0.75rem !important;
  border-bottom: 1px solid var(--color-border) !important;
}
.sdk-view .swagger-ui .parameter__name {
  font-family: 'Courier New', monospace !important;
  color: var(--color-text-primary) !important;
  font-size: 0.8125rem !important;
}
.sdk-view .swagger-ui .parameter__type {
  font-family: var(--font-family) !important;
  color: var(--color-load) !important;
  font-size: 0.75rem !important;
}
.sdk-view .swagger-ui .parameter__deprecated {
  color: var(--color-error) !important;
}
.sdk-view .swagger-ui .parameter__in {
  color: var(--color-text-tertiary) !important;
  font-size: 0.6875rem !important;
}
.sdk-view .swagger-ui table.model tr td {
  font-family: var(--font-family) !important;
  color: var(--color-text-secondary) !important;
}

/* ── Response block ──────────────────────────────────────────────────────── */
.sdk-view .swagger-ui .response-col_status {
  font-family: var(--font-family) !important;
  color: var(--color-success) !important;
  font-weight: 700 !important;
}
.sdk-view .swagger-ui .responses-table .response-col_description {
  font-family: var(--font-family) !important;
  color: var(--color-text-secondary) !important;
}
.sdk-view .swagger-ui .response-col_links {
  color: var(--color-text-tertiary) !important;
}

/* ── Code / JSON blocks ──────────────────────────────────────────────────── */
.sdk-view .swagger-ui .highlight-code,
.sdk-view .swagger-ui .microlight {
  font-family: 'Rubik',monospace !important;
  background: var(--color-secondary-100) !important;
  border: 1px solid var(--color-border) !important;
  border-radius: var(--radius-sm) !important;
  color: var(--color-text-primary) !important;
  font-size: 0.8rem !important;
  line-height: 1.6 !important;
  font-weight: 600;
}
.sdk-view .swagger-ui .model-box {
  background: var(--color-secondary-50) !important;
  border: 1px solid var(--color-border) !important;
  border-radius: var(--radius-sm) !important;
}

/* ── Try-it-out inputs ───────────────────────────────────────────────────── */
.sdk-view .swagger-ui input[type=text],
.sdk-view .swagger-ui input[type=email],
.sdk-view .swagger-ui input[type=password],
.sdk-view .swagger-ui textarea {
  font-family: var(--font-family) !important;
  background: var(--color-secondary-50) !important;
  border: none !important;
  border-bottom: 1px solid var(--color-secondary-200) !important;
  border-radius: var(--radius-sm) !important;
  color: var(--color-text-primary) !important;
  font-size: 0.8125rem !important;
  padding: 0.4375rem 0.75rem !important;
}
.sdk-view .swagger-ui input[type=text]:focus,
.sdk-view .swagger-ui textarea:focus {
  border-color: var(--color-secondary-400) !important;
  outline: none !important;
  box-shadow: none !important;
}

/* ── Execute button ──────────────────────────────────────────────────────── */
.sdk-view .swagger-ui .btn.execute {
  font-family: var(--font-family) !important;
  background: var(--color-primary) !important;
  border-color: var(--color-primary) !important;
  color: var(--color-bg-primary) !important;
  font-weight: 600 !important;
  font-size: 0.8125rem !important;
  border-radius: var(--radius-sm) !important;
  padding: 0.4375rem 0.875rem !important;
}

/* ── Generic buttons ─────────────────────────────────────────────────────── */
.sdk-view .swagger-ui .btn {
  font-family: var(--font-family) !important;
  border-radius: var(--radius-sm) !important;
  font-size: 0.8125rem !important;
  transition: opacity 0.15s !important;
}
.sdk-view .swagger-ui .btn:hover { opacity: 0.85 !important; }

/* ── Authorize modal ─────────────────────────────────────────────────────── */
.sdk-view .swagger-ui .dialog-ux .modal-ux {
  background: var(--color-bg-secondary) !important;
  border: 1px solid var(--color-border) !important;
  border-radius: var(--radius-xl) !important;
  box-shadow: none !important;
}
.sdk-view .swagger-ui .dialog-ux .modal-ux-header {
  background: var(--color-bg-secondary) !important;
  border-bottom: 1px solid var(--color-border) !important;
  border-radius: var(--radius-xl) var(--radius-xl) 0 0 !important;
}
.sdk-view .swagger-ui .dialog-ux .modal-ux-header h3 {
  font-family: var(--font-family) !important;
  color: var(--color-text-primary) !important;
  font-size: 1rem !important;
  font-weight: 600 !important;
}
.sdk-view .swagger-ui .dialog-ux .modal-ux-content p,
.sdk-view .swagger-ui .dialog-ux .modal-ux-content h4,
.sdk-view .swagger-ui .dialog-ux .modal-ux-content label {
  font-family: var(--font-family) !important;
  color: var(--color-text-secondary) !important;
}
.sdk-view .swagger-ui .dialog-ux .modal-ux-content label b {
  color: var(--color-text-primary) !important;
}

/* ── Markdown content ────────────────────────────────────────────────────── */
.sdk-view .swagger-ui .markdown p,
.sdk-view .swagger-ui .markdown li,
.sdk-view .swagger-ui .renderedMarkdown p {
  font-family: var(--font-family) !important;
  color: var(--color-text-secondary) !important;
  font-size: 0.875rem !important;
}
.sdk-view .swagger-ui .markdown code,
.sdk-view .swagger-ui .renderedMarkdown code {
  font-family: 'Courier New', monospace !important;
  background: var(--color-secondary-100) !important;
  padding: 0.1em 0.35em !important;
  border-radius: var(--radius-sm) !important;
  font-size: 0.8em !important;
  color: var(--color-text-primary) !important;
}

/* ── Models section ──────────────────────────────────────────────────────── */
.sdk-view .swagger-ui section.models {
  border: 1px solid var(--color-border) !important;
  border-radius: var(--radius-xl) !important;
  background: var(--color-bg-secondary) !important;
}
.sdk-view .swagger-ui section.models h4 {
  font-family: var(--font-family) !important;
  color: var(--color-text-primary) !important;
  font-size: 0.875rem !important;
  font-weight: 600 !important;
}
.sdk-view .swagger-ui .model-title {
  font-family: 'Courier New', monospace !important;
  color: var(--color-text-primary) !important;
}
.sdk-view .swagger-ui .model {
  font-family: 'Courier New', monospace !important;
  color: var(--color-text-secondary) !important;
}
.sdk-view .swagger-ui .prop-type {
  color: var(--color-load) !important;
}
.sdk-view .swagger-ui .prop-format {
  color: var(--color-text-tertiary) !important;
}

/* ── Filter input ────────────────────────────────────────────────────────── */
.sdk-view .swagger-ui .operation-filter-input {
  font-family: var(--font-family) !important;
  background: var(--color-secondary-50) !important;
  border: none !important;
  border-bottom: 1px solid var(--color-secondary-200) !important;
  border-radius: var(--radius-sm) !important;
  color: var(--color-text-primary) !important;
  font-size: 0.8125rem !important;
}
</style>