"use strict";
(() => {
  const i18n = window.PMK_I18N;
  i18n.localize(document);
  document.querySelectorAll("[data-language]").forEach((button) => {
    button.addEventListener("click", () => {
      if (i18n.setLanguage(button.dataset.language)) i18n.localize(document);
    });
  });
})();
