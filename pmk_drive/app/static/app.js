"use strict";

const BASE = document.body.dataset.base;
const i18n = window.PMK_I18N;
const t = i18n.t;
const $ = (s, el = document) => el.querySelector(s),
  $$ = (s, el = document) => [...el.querySelectorAll(s)];
const paths = {
  plus: "M12 5v14M5 12h14",
  upload: "M12 16V3m-5 5 5-5 5 5M4 15v5h16v-5",
  download: "M12 3v13m-5-5 5 5 5-5M4 17v4h16v-4",
  drive: "M5 3h14l3 17H2L5 3Zm-2 12h18M7 18h1m8 0h1",
  folder: "M3 7h6l2-3h5l3 3h2v13H3V7Z",
  "folder-plus": "M3 7h6l2-3h5l3 3h2v13H3V7Zm9 3v7m-3-3h6",
  clock: "M12 8v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
  star: "m12 3 2.8 5.8 6.4.9-4.6 4.5 1.1 6.3L12 17.5l-5.7 3 1.1-6.3L2.8 9.7l6.4-.9L12 3Z",
  link: "m10 13 4-4M8 16l-1 1a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0m0 2 1-1a4 4 0 0 1 6 6l-5 5a4 4 0 0 1-6 0",
  trash: "M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7",
  cloud: "M6 18a5 5 0 0 1-1-10 7 7 0 0 1 13-1 5.5 5.5 0 0 1 0 11H6Z",
  search: "M15 15l6 6M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z",
  list: "M8 5h13M8 12h13M8 19h13M3 5h1m-1 7h1m-1 7h1",
  grid: "M3 3h7v7H3V3Zm11 0h7v7h-7V3ZM3 14h7v7H3v-7Zm11 0h7v7h-7v-7Z",
  menu: "M3 6h18M3 12h18M3 18h18",
  more: "M12 5h.01M12 12h.01M12 19h.01",
  chevron: "m9 5 7 7-7 7",
  close: "m6 6 12 12M6 18 18 6",
  edit: "m14 4 6 6M3 21l5-1L21 7l-5-5L3 15v6Z",
  move: "M3 7h6l2-3h5l3 3h2v13H3V7Zm5 7h8m-3-3 3 3-3 3",
  restore: "M3 4v6h6M3 10a9 9 0 1 1 0 6",
  check: "m5 12 4 4L20 5",
  logout: "M9 3H3v18h6m5-16 7 7-7 7M7 12h14",
  users:
    "M15 21v-3a5 5 0 0 0-10 0v3m11-10a4 4 0 0 1 5 4v6M13 6a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z",
  home: "m3 10 9-7 9 7v11H3V10Zm6 11v-8h6v8",
};
const icon = (n) =>
  `<svg class="icon" aria-hidden="true" viewBox="0 0 24 24"><path d="${paths[n] || paths.drive}"/></svg>`;
$$("[data-icon]").forEach((el) => (el.outerHTML = icon(el.dataset.icon)));
const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c],
  );
const state = {
  user: null,
  parent: null,
  view: "drive",
  q: "",
  type: "all",
  layout: localStorage.getItem("pmk-layout") || "list",
  items: [],
  stats: {
    bytes: 0,
    files: 0,
  },
  folders: [],
  selected: new Set(),
  sort: "name",
  asc: true,
};
const titles = {
  drive: "내 드라이브",
  recent: "최근 파일",
  starred: "중요 파일",
  shared: "링크로 공유 중",
  trash: "휴지통",
};
let refreshSequence = 0,
  toastTimer,
  searchTimer,
  jobs = [];
function toast(message) {
  $("#toast").textContent = t(message);
  $("#toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($("#toast").hidden = true), 4500);
}
async function api(path, options = {}) {
  const headers = {
    "X-PMK-Request": "1",
    "Accept-Language": i18n.language(),
    ...options.headers,
  };
  if (options.body && typeof options.body !== "string") {
    options.body = JSON.stringify(options.body);
    headers["Content-Type"] = "application/json";
  }
  const response = await fetch(BASE + "/api" + path, {
    ...options,
    headers,
  });
  if (!response.ok) {
    let message = t("요청을 처리할 수 없습니다.");
    try {
      const data = await response.json();
      message =
        typeof data.detail === "string"
          ? data.detail
          : t("입력값을 확인해 주세요.");
    } catch {}
    if (response.status === 401 && state.user) {
      state.user = null;
      showLogin();
    }
    const error = new Error(t(message));
    error.status = response.status;
    throw error;
  }
  return response.json();
}
function bytes(n) {
  if (!n) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(4, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toLocaleString(i18n.locale(), {
    maximumFractionDigits: i > 1 ? 1 : 0,
  })} ${units[i]}`;
}
function date(n) {
  return new Date(n * 1000).toLocaleDateString(i18n.locale(), {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}
function fileType(name) {
  const ext = name.split(".").pop().toLowerCase();
  if (["xlsx", "xls", "csv", "ods"].includes(ext))
    return ["excel", "X", t("스프레드시트")];
  if (["ppt", "pptx"].includes(ext)) return ["ppt", "P", t("프레젠테이션")];
  if (ext === "pdf") return ["pdf", "PDF", t("PDF 문서")];
  if (["doc", "docx", "txt", "hwp"].includes(ext))
    return ["doc", "D", t("문서")];
  return ["other", ext.slice(0, 3).toUpperCase(), t("파일")];
}
function fileIcon(name) {
  const [cls, label] = fileType(name);
  return `<span class="file-type ${cls}">${esc(label)}</span>`;
}
function dialog(title, body, submit, action = t("확인")) {
  const d = $("#dialog");
  $("#dialog-content").innerHTML =
    `<h2>${esc(title)}</h2>${body}<div class="form-error" role="alert"></div><div class="dialog-actions"><button type="button" class="button" id="dialog-cancel">${t("취소")}</button>${submit ? `<button type="submit" class="button primary">${esc(action)}</button>` : ""}</div>`;
  $("#dialog-cancel").onclick = () => d.close();
  $("#dialog-form").onsubmit = async (e) => {
    e.preventDefault();
    const b = $("button[type=submit]", d);
    if (b) b.disabled = true;
    try {
      await submit(new FormData(e.target));
      d.close();
    } catch (err) {
      $(".form-error", d).textContent = err.message;
    } finally {
      if (b) b.disabled = false;
    }
  };
  if (!d.open) d.showModal();
  setTimeout(() => $("input,select,button", d)?.focus(), 30);
}
async function refresh() {
  const sequence = ++refreshSequence;
  const query = new URLSearchParams({
    view: state.view,
    q: state.q,
    type: state.type,
  });
  if (state.parent) query.set("parent_id", state.parent);
  try {
    const data = await api("/nodes?" + query);
    if (sequence !== refreshSequence) return;
    state.items = data.items;
    state.folders = data.folders;
    state.selected.clear();
    state.stats = data.stats;
    renderStats();
    render();
    if (data.items.length >= data.limit)
      toast(t("최대 2,000개 항목을 표시합니다. 검색으로 범위를 좁혀 주세요."));
  } catch (err) {
    toast(err.message);
  }
}
function navigate(view = "drive", parent = null) {
  state.view = view;
  state.parent = parent;
  state.q = "";
  $("#search").value = "";
  state.type = "all";
  $(".sidebar").classList.remove("open");
  history.replaceState(
    null,
    "",
    BASE +
      "/#" +
      new URLSearchParams({
        view,
        parent: parent || "",
      }),
  );
  refresh();
}
function render() {
  const current = state.folders.find((f) => f.id === state.parent);
  $("#page-title").textContent = state.q
    ? t("“{query}” 검색 결과", {
        query: state.q,
      })
    : state.view === "drive" && current
      ? current.name
      : t(titles[state.view]);
  $("#page-description").textContent =
    state.view === "trash"
      ? t("삭제한 파일과 폴더를 복원할 수 있습니다.")
      : state.view === "shared"
        ? t("만료 기한이 있는 링크로 파일을 공유합니다.")
        : state.view === "starred"
          ? t("자주 찾는 파일을 가까이 두세요.")
          : t("함께 쓰는 파일, 한곳에서 깔끔하게.");
  $$("[data-view]").forEach((b) =>
    b.classList.toggle("active", b.dataset.view === state.view),
  );
  $$("[data-type]").forEach((b) =>
    b.classList.toggle("active", b.dataset.type === state.type),
  );
  $("#list-view").classList.toggle("selected", state.layout === "list");
  $("#grid-view").classList.toggle("selected", state.layout === "grid");
  $("#item-count").textContent = t("{count}개 항목", {
    count: state.items.length,
  });
  const allow = state.view === "drive";
  $("#new-folder").hidden = !allow;
  $("#upload-button").hidden = !allow;
  $(".drop-hint").hidden = !allow;
  renderTree();
  renderBreadcrumbs();
  renderSelection();
  let sorted = [...state.items].sort((a, b) => {
    let c =
      state.sort === "name"
        ? a.name.localeCompare(b.name, i18n.language())
        : a[state.sort] - b[state.sort];
    return state.asc ? c : -c;
  });
  if (state.view === "recent") sorted.sort((a, b) => b.updated - a.updated);
  const folders = sorted.filter((n) => n.kind === "folder");
  const files = sorted.filter((n) => n.kind === "file");
  $("#folder-section").innerHTML = folders.length
    ? `<div class="section-heading"><h2>${t("폴더")} <span>${folders.length}</span></h2></div><div class="folder-grid">${folders
        .map(
          (n) =>
            `<div class="folder-card" data-id="${n.id}" role="group">${icon("folder")}<button class="folder-name" data-open="${n.id}">${esc(n.name)}<small>${esc(n.owner)} · ${date(n.updated)}</small></button><button class="icon-button" data-menu="${n.id}" aria-label="${esc(
              t("{name} 메뉴", {
                name: n.name,
              }),
            )}">${icon("more")}</button></div>`,
        )
        .join("")}</div>`
    : "";
  if (!state.items.length) {
    $("#files-section").innerHTML =
      `<div class="empty"><div class="empty-icon">${icon(state.q ? "search" : state.view === "trash" ? "trash" : "folder")}</div><h3>${state.q ? t("일치하는 파일이 없습니다") : state.view === "trash" ? t("휴지통이 비어 있습니다") : state.view === "starred" ? t("중요한 파일을 표시해 보세요") : state.view === "shared" ? t("공유 중인 링크가 없습니다") : t("첫 번째 파일을 추가해 보세요")}</h3><p>${state.q ? t("다른 검색어로 다시 검색해 주세요.") : state.view === "drive" ? `${t("새 폴더로 업무를 정리하고")}<br>${t("팀과 함께 사용할 파일을 업로드하세요.")}` : t("파일 메뉴에서 필요한 작업을 선택할 수 있습니다.")}</p>${state.view === "drive" && !state.q ? '<button class="button primary" id="empty-upload">' + icon("upload") + `${t("파일 업로드")}</button>` : ""}</div>`;
    $("#empty-upload")?.addEventListener("click", () =>
      $("#file-input").click(),
    );
    return;
  }
  const heading = `<div class="section-heading"><h2>${state.view === "recent" ? t("최근 파일") : t("파일")} <span>${files.length}</span></h2><button class="icon-button" id="sort-toggle" aria-label="${t("정렬 방향 변경")}">${icon("list")}</button></div>`;
  $("#files-section").innerHTML = files.length
    ? heading +
      (state.layout === "grid"
        ? `<div class="grid-files">${files
            .map(
              (n) =>
                `<article class="file-card" data-id="${n.id}"><div class="file-preview">${fileIcon(n.name)}</div><div class="file-card-bottom"><input type="checkbox" data-select="${n.id}" aria-label="${esc(
                  t("{name} 선택", {
                    name: n.name,
                  }),
                )}"><div><button class="file-name" data-open="${n.id}">${esc(n.name)}</button><small>${bytes(n.size)} · ${date(n.updated)}</small></div><button class="icon-button" data-menu="${n.id}" aria-label="${esc(
                  t("{name} 메뉴", {
                    name: n.name,
                  }),
                )}">${icon("more")}</button></div></article>`,
            )
            .join("")}</div>`
        : `<div class="table-wrap"><table class="file-table"><thead><tr><th><input type="checkbox" id="select-all" aria-label="${t("모든 파일 선택")}"></th><th><button data-sort="name">${t("이름")} ${state.sort === "name" ? (state.asc ? "↑" : "↓") : ""}</button></th><th><button data-sort="updated">${t("수정한 날짜")}</button></th><th><button data-sort="size">${t("파일 크기")}</button></th><th>${t("소유자")}</th><th></th></tr></thead><tbody>${files
            .map(
              (n) =>
                `<tr data-id="${n.id}"><td><input type="checkbox" data-select="${n.id}" aria-label="${esc(
                  t("{name} 선택", {
                    name: n.name,
                  }),
                )}"></td><td><div class="file-cell">${fileIcon(n.name)}<div class="file-text"><button class="file-name" data-open="${n.id}">${esc(n.name)} ${n.starred ? '<span class="starred-mark">★</span>' : ""}</button><small>${fileType(n.name)[2]}</small></div></div></td><td>${date(n.updated)}</td><td>${bytes(n.size)}</td><td><span class="owner"><i>${esc(n.owner.slice(0, 1))}</i>${esc(n.owner)}</span></td><td><button class="icon-button" data-menu="${n.id}" aria-label="${esc(
                  t("{name} 메뉴", {
                    name: n.name,
                  }),
                )}">${icon("more")}</button></td></tr>`,
            )
            .join("")}</tbody></table></div>`)
    : "";
  $("#select-all")?.addEventListener("change", (e) => {
    state.selected = new Set(e.target.checked ? files.map((n) => n.id) : []);
    renderSelection();
  });
  $("#sort-toggle")?.addEventListener("click", () => {
    state.asc = !state.asc;
    render();
  });
}
function renderTree() {
  function branch(parent, depth) {
    if (depth > 8) return "";
    return state.folders
      .filter((f) => f.parent_id === parent)
      .map(
        (f) =>
          `<button class="tree-folder" data-folder="${f.id}" style="padding-left:${12 + depth * 12}px">${icon("folder")}<span>${esc(f.name)}</span></button>${branch(f.id, depth + 1)}`,
      )
      .join("");
  }
  $("#folder-tree").innerHTML =
    branch(null, 0) ||
    `<div class="tree-empty">${t("새 폴더를 만들면")}<br>${t("이곳에서 빠르게 찾을 수 있어요.")}</div>`;
}
function renderBreadcrumbs() {
  let chain = [],
    id = state.parent;
  while (id) {
    const f = state.folders.find((n) => n.id === id);
    if (!f) break;
    chain.unshift(f);
    id = f.parent_id;
  }
  $("#breadcrumbs").innerHTML =
    `<button data-breadcrumb="">${icon("home")}</button>${icon("chevron")}<button data-breadcrumb="">${state.view === "drive" ? t("내 드라이브") : t(titles[state.view])}</button>` +
    chain
      .map(
        (f) =>
          icon("chevron") +
          `<button data-breadcrumb="${f.id}">${esc(f.name)}</button>`,
      )
      .join("");
}
function renderSelection() {
  const count = state.selected.size;
  $("#selection-bar").hidden = !count;
  $("#selection-bar").innerHTML = `<span>${t("{count}개 선택됨", {
    count,
  })}</span><button data-bulk="${state.view === "trash" ? "restore" : "download"}">${icon(state.view === "trash" ? "restore" : "download")}${state.view === "trash" ? t("복원") : t("다운로드")}</button>${state.view !== "trash" ? '<button data-bulk="trash">' + icon("trash") + `${t("휴지통으로 이동")}</button>` : ""}<button data-bulk="clear" aria-label="${t("선택 해제")}">${icon("close")}</button>`;
  $$("[data-select]").forEach(
    (el) => (el.checked = state.selected.has(el.dataset.select)),
  );
  $$("[data-id]").forEach((el) =>
    el.classList.toggle("selected", state.selected.has(el.dataset.id)),
  );
}
function showContext(nid, anchor) {
  const n = state.items.find((n) => n.id === nid);
  if (!n) return;
  const actions =
    state.view === "trash"
      ? [["restore", "restore", t("복원")]]
      : [
          ...(n.kind === "file"
            ? [
                ["download", "download", t("다운로드")],
                ["share", "link", t("공유 링크")],
              ]
            : [["open", "folder", t("폴더 열기")]]),
          [
            "star",
            "star",
            n.starred ? t("중요 파일에서 해제") : t("중요 파일로 표시"),
          ],
          ["rename", "edit", t("이름 변경")],
          ["move", "move", t("이동")],
          ["trash", "trash", t("휴지통으로 이동")],
        ];
  const menu = $("#context-menu");
  menu.innerHTML = actions
    .map(
      ([action, i, label]) =>
        `<button data-action="${action}" data-target="${nid}" class="${action === "trash" ? "danger" : ""}">${icon(i)}${label}</button>`,
    )
    .join("");
  menu.hidden = false;
  const r = anchor.getBoundingClientRect();
  menu.style.left =
    Math.max(10, Math.min(r.right - 190, innerWidth - 205)) + "px";
  menu.style.top =
    Math.max(10, Math.min(r.bottom + 5, innerHeight - menu.offsetHeight - 12)) +
    "px";
}
function download(nid) {
  const a = document.createElement("a");
  a.href = BASE + "/api/nodes/" + nid + "/download";
  a.download = "";
  document.body.appendChild(a);
  a.click();
  a.remove();
}
async function action(type, nid) {
  const n = state.items.find((n) => n.id === nid);
  if (!n) return;
  if (type === "open") {
    navigate("drive", nid);
    return;
  }
  if (type === "download") {
    download(nid);
    return;
  }
  if (type === "rename") {
    dialog(
      t("이름 변경"),
      `<label class="field">${t("새 이름")}<input name="name" value="${esc(n.name)}" required maxlength="240"></label>`,
      async (data) => {
        await api("/nodes/" + nid, {
          method: "PATCH",
          body: {
            name: data.get("name"),
          },
        });
        await refresh();
        toast(t("이름을 변경했습니다."));
      },
      t("변경"),
    );
    return;
  }
  if (type === "move") {
    const excluded = new Set([nid]);
    let changed = true;
    while (changed) {
      changed = false;
      state.folders.forEach((f) => {
        if (excluded.has(f.parent_id) && !excluded.has(f.id)) {
          excluded.add(f.id);
          changed = true;
        }
      });
    }
    const options = state.folders.filter((f) => !excluded.has(f.id));
    function fullName(f) {
      let names = [f.name],
        p = f.parent_id;
      while (p) {
        const next = state.folders.find((x) => x.id === p);
        if (!next) break;
        names.unshift(next.name);
        p = next.parent_id;
      }
      return names.join(" / ");
    }
    dialog(
      t("폴더로 이동"),
      `<p>${esc(
        t("{name}의 새 위치를 선택하세요.", {
          name: n.name,
        }),
      )}</p><label class="field">${t("대상 폴더")}<select name="parent"><option value="">${t("내 드라이브")}</option>${options.map((f) => `<option value="${f.id}">${esc(fullName(f))}</option>`).join("")}</select></label>`,
      async (data) => {
        await api("/nodes/" + nid, {
          method: "PATCH",
          body: {
            parent_id: data.get("parent") || null,
          },
        });
        await refresh();
        toast(t("이동했습니다."));
      },
      t("이동"),
    );
    return;
  }
  if (type === "share") {
    await shareDialog(n);
    return;
  }
  if (type === "trash") {
    dialog(
      t("휴지통으로 이동"),
      `<p>${esc(
        t(
          n.kind === "folder"
            ? t(
                "\u201C{name}\u201D 및 하위 항목을 휴지통으로 이동합니다. 나중에 복원할 수 있습니다.",
              )
            : t(
                "\u201C{name}\u201D을 휴지통으로 이동합니다. 나중에 복원할 수 있습니다.",
              ),
          {
            name: n.name,
          },
        ),
      )}</p>`,
      async () => {
        await api("/nodes/" + nid, {
          method: "DELETE",
        });
        await refresh();
        toast(t("휴지통으로 이동했습니다."));
      },
      t("이동"),
    );
    return;
  }
  await api("/nodes/" + nid + "/" + (type === "star" ? "star" : "restore"), {
    method: "POST",
  });
  await refresh();
  toast(
    type === "restore"
      ? t("복원했습니다.")
      : t("중요 파일 표시를 변경했습니다."),
  );
}
async function shareDialog(n) {
  const existing = await api("/nodes/" + n.id + "/shares");
  dialog(
    t("파일 공유"),
    `<p><strong>${esc(n.name)}</strong><br>${t("링크를 가진 사람은 로그인 없이 이 파일을 다운로드할 수 있습니다.")}</p><label class="field">${t("링크 유효 기간")}<select name="days"><option value="7">${t("7일")}</option><option value="1">${t("1일")}</option><option value="30">${t("30일")}</option></select></label><div id="generated-link"></div><div id="existing-links">${existing
      .map(
        (s) =>
          `<div class="share-existing"><span>${t("{date}까지 유효한 링크", {
            date: date(s.expires),
          })}</span><button type="button" data-revoke="${s.id}">${t("공유 해제")}</button></div>`,
      )
      .join("")}</div>`,
    null,
  );
  $(".dialog-actions").insertAdjacentHTML(
    "afterbegin",
    `<button type="button" class="button primary" id="create-link">${t("링크 만들기")}</button>`,
  );
  $("#dialog-cancel").textContent = t("닫기");
  $("#create-link").onclick = async (e) => {
    e.target.disabled = true;
    try {
      const result = await api("/nodes/" + n.id + "/shares", {
        method: "POST",
        body: {
          days: Number($("[name=days]").value),
        },
      });
      $("#generated-link").innerHTML =
        `<div class="share-link"><input readonly aria-label="${t("공유 링크")}" value="${esc(result.url)}"><button type="button" class="button" id="copy-link">${t("복사")}</button></div>`;
      $("#copy-link").onclick = async () => {
        try {
          await navigator.clipboard.writeText(result.url);
          toast(t("공유 링크를 복사했습니다."));
        } catch {
          $("#generated-link input").select();
          toast(t("선택된 링크를 복사해 주세요."));
        }
      };
      $("#existing-links").insertAdjacentHTML(
        "afterbegin",
        `<div class="share-existing"><span>${t("새로 만든 링크")}</span><button type="button" data-revoke="${result.id}">${t("공유 해제")}</button></div>`,
      );
      await refresh();
    } catch (err) {
      toast(err.message);
    } finally {
      e.target.disabled = false;
    }
  };
}
function newFolder() {
  if (state.view !== "drive") navigate("drive");
  dialog(
    t("새 폴더"),
    `<label class="field">${t("폴더 이름")}<input name="name" placeholder="${t("예: 2026 사업 계획")}" required maxlength="240" autocomplete="off"></label>`,
    async (data) => {
      await api("/folders", {
        method: "POST",
        body: {
          name: data.get("name"),
          parent_id: state.parent,
        },
      });
      await refresh();
      toast(t("폴더를 만들었습니다."));
    },
    t("만들기"),
  );
}
function showLogin() {
  $("#shell").hidden = true;
  $("#auth").hidden = false;
  $("#auth").innerHTML =
    `<div class="auth-card login-card">${languagePicker()}<a class="brand" href="${BASE}/"><img src="${BASE}/static/logo.svg" alt=""><span>PMK <strong>Drive</strong></span></a><form id="login-form"><label class="field"><span data-i18n="아이디">${t("아이디")}</span><input name="username" autocomplete="username" aria-label="${t("아이디")}" data-i18n-aria-label="아이디" required></label><label class="field"><span data-i18n="비밀번호">${t("비밀번호")}</span><input type="password" name="password" autocomplete="current-password" aria-label="${t("비밀번호")}" data-i18n-aria-label="비밀번호" required></label><div class="form-error" role="alert"></div><button class="button primary" type="submit"><span data-i18n="로그인">${t("로그인")}</span>${icon("chevron")}</button></form></div>`;
  $("#login-form").onsubmit = async (e) => {
    e.preventDefault();
    const button = $("button", e.target);
    button.disabled = true;
    try {
      const form = new FormData(e.target);
      await api("/login", {
        method: "POST",
        body: Object.fromEntries(form),
      });
      await start();
    } catch (err) {
      $(".form-error", e.target).textContent = err.message;
    } finally {
      button.disabled = false;
    }
  };
}
function accountMenu() {
  dialog(
    t("계정"),
    `<p>${esc(state.user.display_name)} · ${esc(state.user.username)}<br>${t("모든 팀원은 이 공간에서 파일을 함께 관리합니다.")}</p>${state.user.role === "admin" ? '<button type="button" class="button" id="add-member">' + icon("users") + `${t("팀원 계정 추가")}</button>` : ""}`,
    null,
  );
  $(".dialog-actions").insertAdjacentHTML(
    "afterbegin",
    `<button type="button" id="logout" class="button">${t("로그아웃")}</button>`,
  );
  $("#dialog-cancel").textContent = t("닫기");
  $("#logout").onclick = async () => {
    jobs.forEach(pauseJob);
    await api("/logout", {
      method: "POST",
    });
    $("#dialog").close();
    state.user = null;
    jobs = [];
    renderJobs();
    showLogin();
  };
  $("#add-member")?.addEventListener("click", () =>
    dialog(
      t("팀원 계정 추가"),
      `<p>${t("새 팀원은 모든 파일을 업로드\xB7다운로드하고 관리할 수 있습니다.")}</p><label class="field">${t("이름")}<input name="display_name" required maxlength="80"></label><label class="field">${t("아이디")}<input name="username" required maxlength="80" autocomplete="off"></label><label class="field">${t("초기 비밀번호")}<input name="password" type="password" required minlength="12" maxlength="256" autocomplete="new-password" placeholder="${t("12자 이상")}"></label>`,
      async (data) => {
        await api("/members", {
          method: "POST",
          body: Object.fromEntries(data),
        });
        toast(t("팀원 계정을 추가했습니다."));
      },
      t("계정 추가"),
    ),
  );
}
function renderJobs() {
  const panel = $("#upload-panel");
  panel.hidden = !jobs.length;
  panel.innerHTML = `<div class="upload-panel-head"><span>${t(
    "업로드 {done} / {total} 완료",
    {
      done: jobs.filter((j) => j.status === "done").length,
      total: jobs.length,
    },
  )}</span><button class="icon-button" id="hide-uploads" aria-label="${t("업로드 창 접기")}">${icon("close")}</button></div><div class="upload-jobs">${jobs
    .map(
      (j, i) =>
        `<div class="upload-job"><div class="upload-job-name"><span>${esc(j.name)}</span><span>${j.status === "done" ? "✓" : Math.floor(j.progress || 0) + "%"}</span>${["uploading", "queued"].includes(j.status) ? `<button data-pause="${i}">${t("일시정지")}</button>` : ["paused", "error", "pending"].includes(j.status) ? `<button data-resume="${i}">${t("재개")}</button><button data-cancel="${i}">${t("취소")}</button>` : ""}</div><p>${esc(
          t(j.message) ||
            {
              queued: t("대기 중"),
              uploading: t("업로드 중"),
              done: bytes(j.size) + t(" \xB7 업로드 완료"),
              paused: t("일시정지됨"),
              pending: t("같은 파일을 선택하면 이어서 업로드합니다."),
            }[j.status] ||
            "",
        )}</p><div class="progress-track"><div class="progress-fill" style="width:${Math.min(100, j.progress || 0)}%"></div></div></div>`,
    )
    .join("")}</div>`;
  $("#hide-uploads").onclick = () => (panel.hidden = true);
  $$("[data-pause]").forEach(
    (b) =>
      (b.onclick = () => {
        pauseJob(jobs[+b.dataset.pause]);
        renderJobs();
      }),
  );
  $$("[data-resume]").forEach(
    (b) =>
      (b.onclick = () => {
        const j = jobs[+b.dataset.resume];
        if (j.file) uploadFile(j);
        else {
          toast(t("중단된 파일과 동일한 파일을 선택해 주세요."));
          state.parent = j.parent;
          $("#file-input").click();
        }
      }),
  );
  $$("[data-cancel]").forEach(
    (b) =>
      (b.onclick = async () => {
        const j = jobs[+b.dataset.cancel];
        try {
          if (j.running) await j.running;
          if (j.id)
            await api("/uploads/" + j.id, {
              method: "DELETE",
            });
          jobs = jobs.filter((x) => x !== j);
          renderJobs();
        } catch (err) {
          toast(err.message);
        }
      }),
  );
}
function pauseJob(job) {
  if (job.status === "done") return;
  job.paused = true;
  job.status = "paused";
  job.xhrs?.forEach((x) => x.abort());
}
async function fingerprint(file) {
  const block = 256 * 1024;
  const input = new Blob([
    file.slice(0, block),
    file.slice(Math.max(block, file.size - block)),
    `${file.name}|${file.size}|${file.lastModified}`,
  ]);
  const hash = await crypto.subtle.digest("SHA-256", await input.arrayBuffer());
  return [...new Uint8Array(hash)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
function putChunk(url, blob, direct, job, number, progress) {
  return new Promise((resolve, reject) => {
    if (job.paused) return reject(new Error(t("일시정지됨")));
    const xhr = new XMLHttpRequest();
    job.xhrs.add(xhr);
    xhr.open("PUT", url);
    if (!direct) xhr.setRequestHeader("X-PMK-Request", "1");
    xhr.timeout = 180000;
    xhr.upload.onprogress = (e) => {
      progress.set(number, e.loaded);
      job.progress = job.size
        ? ([...progress.values()].reduce((a, b) => a + b, 0) / job.size) * 100
        : 0;
      renderJobs();
    };
    xhr.onload = () => {
      job.xhrs.delete(xhr);
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(
            new Error(t("전송에 실패했습니다. 연결을 확인하고 재개해 주세요.")),
          );
    };
    xhr.onerror =
      xhr.ontimeout =
      xhr.onabort =
        () => {
          job.xhrs.delete(xhr);
          reject(
            new Error(
              job.paused
                ? t("일시정지됨")
                : t("네트워크 연결을 확인하고 재개해 주세요."),
            ),
          );
        };
    xhr.send(blob);
  });
}
async function uploadFile(job) {
  if (job.running) await job.running;
  if (job.status === "done") return;
  job.paused = false;
  job.status = "uploading";
  job.message = "";
  job.xhrs = new Set();
  renderJobs();
  job.running = (async () => {
    try {
      if (!job.id) {
        const hash = await fingerprint(job.file);
        const started = await api("/uploads", {
          method: "POST",
          body: {
            name: job.name,
            size: job.size,
            mime: job.file.type || "application/octet-stream",
            parent_id: job.parent,
            fingerprint: hash,
          },
        });
        job.id = started.id;
      }
      const status = await api("/uploads/" + job.id);
      if (status.assembled) {
        await api("/uploads/" + job.id + "/complete", {
          method: "POST",
        });
        job.status = "done";
        job.progress = 100;
        await refresh();
        return;
      }
      const size = status.part_size,
        count = Math.max(1, Math.ceil(job.size / size)),
        done = new Set(status.parts.map((p) => p.number)),
        progress = new Map(status.parts.map((p) => [p.number, p.size]));
      let cursor = 1;
      async function worker() {
        while (cursor <= count && !job.paused) {
          const part = cursor++;
          if (done.has(part)) continue;
          const chunk = job.file.slice(
            (part - 1) * size,
            Math.min(part * size, job.size),
          );
          let success = false;
          for (let retry = 0; retry < 3 && !job.paused; retry++) {
            try {
              const signed = await api(`/uploads/${job.id}/parts/${part}`, {
                method: "POST",
              });
              await putChunk(
                signed.url,
                chunk,
                signed.direct,
                job,
                part,
                progress,
              );
              success = true;
              break;
            } catch (err) {
              if (job.paused || retry === 2) throw err;
              await new Promise((r) => setTimeout(r, 500 * 2 ** retry));
            }
          }
          if (!success) throw new Error(t("일시정지됨"));
        }
      }
      const workers = await Promise.allSettled(
        Array.from(
          {
            length: 3,
          },
          worker,
        ),
      );
      const failed = workers.find((r) => r.status === "rejected");
      if (failed) throw failed.reason;
      if (job.paused) {
        job.status = "paused";
        return;
      }
      await api("/uploads/" + job.id + "/complete", {
        method: "POST",
      });
      job.status = "done";
      job.progress = 100;
      job.message = "";
      await refresh();
    } catch (err) {
      job.status = job.paused ? "paused" : "error";
      job.message = err.message;
    } finally {
      renderJobs();
    }
  })();
  await job.running;
  job.running = null;
}
async function addFiles(files) {
  if (!state.user) return;
  if (state.view !== "drive") {
    toast(t("내 드라이브에서 업로드할 폴더를 선택해 주세요."));
    return;
  }
  const added = [];
  for (const file of files) {
    if (file.size > state.user.max_file_size) {
      toast(
        t("{name}: 최대 {size}까지 업로드할 수 있습니다.", {
          name: file.name,
          size: bytes(state.user.max_file_size),
        }),
      );
      continue;
    }
    let job = jobs.find(
      (j) =>
        j.name === file.name &&
        j.size === file.size &&
        j.parent === state.parent &&
        j.status !== "done",
    );
    if (job) {
      if (job.running || job.status === "uploading") continue;
      job.file = file;
      /* Verify file identity through the server before resuming an existing job. */
      job.id = null;
      job.status = "queued";
      job.message = "";
    } else {
      job = {
        file,
        name: file.name,
        size: file.size,
        parent: state.parent,
        status: "queued",
        progress: 0,
      };
      jobs.push(job);
    }
    added.push(job);
  }
  renderJobs();
  for (const j of added) if (!j.paused) await uploadFile(j);
}
async function publicShare(token) {
  $("#auth").hidden = false;
  const card = `<div class="auth-card">${languagePicker()}<a class="brand" href="${BASE}/"><img src="${BASE}/static/logo.svg" alt=""><span>PMK <strong>Drive</strong></span></a>`;
  try {
    const info = await api("/shared/" + encodeURIComponent(token));
    $("#auth").innerHTML =
      card +
      `<h1>${t("파일이 도착했어요.")}</h1><p>${t("PMK Drive에서 공유한 파일입니다.")}</p><div class="share-file">${fileIcon(info.name)}<div><strong>${esc(info.name)}</strong><small>${bytes(info.size)} · ${date(info.updated)}</small></div></div><a class="button primary" href="${BASE}/api/shared/${encodeURIComponent(token)}/download">${icon("download")}${t("파일 다운로드")}</a><p class="auth-note">${t("공유 링크는 정해진 기간 동안만 사용할 수 있습니다.")}</p></div>`;
  } catch (err) {
    $("#auth").innerHTML =
      card +
      `<h1>${t("링크를 사용할 수 없습니다.")}</h1><p>${esc(err.message)}</p></div>`;
  }
}
async function start() {
  try {
    state.user = await api("/me");
    $("#auth").hidden = true;
    $("#shell").hidden = false;
    $("#account").textContent = state.user.display_name.slice(0, 1);
    renderStats();
    const hash = new URLSearchParams(location.hash.slice(1));
    state.view = titles[hash.get("view")] ? hash.get("view") : "drive";
    state.parent = hash.get("parent") || null;
    await refresh();
    const pending = await api("/uploads");
    jobs = pending.map((j) => ({
      ...j,
      parent: j.parent_id,
      status: "pending",
      progress: 0,
    }));
    renderJobs();
  } catch {
    showLogin();
  }
}
document.addEventListener("click", async (e) => {
  const b = e.target.closest("button");
  if (!e.target.closest("#context-menu") && !e.target.closest("[data-menu]"))
    $("#context-menu").hidden = true;
  if (!b) return;
  if (b.dataset.language) {
    setLanguage(b.dataset.language);
    return;
  }
  try {
    if (b.dataset.view) navigate(b.dataset.view);
    if (b.dataset.folder) navigate("drive", b.dataset.folder);
    if ("breadcrumb" in b.dataset)
      navigate("drive", b.dataset.breadcrumb || null);
    if (b.dataset.type) {
      state.type = b.dataset.type;
      await refresh();
    }
    if (b.dataset.menu) showContext(b.dataset.menu, b);
    if (b.dataset.open) {
      const n = state.items.find((n) => n.id === b.dataset.open);
      if (state.view === "trash") await action("restore", n.id);
      else if (n.kind === "folder") navigate("drive", n.id);
      else await action("download", n.id);
    }
    if (b.dataset.action) {
      $("#context-menu").hidden = true;
      await action(b.dataset.action, b.dataset.target);
    }
    if (b.dataset.sort) {
      state.asc = state.sort === b.dataset.sort ? !state.asc : true;
      state.sort = b.dataset.sort;
      render();
    }
    if (b.dataset.revoke) {
      await api("/shares/" + b.dataset.revoke, {
        method: "DELETE",
      });
      b.closest(".share-existing").remove();
      $("#generated-link").innerHTML = "";
      toast(t("공유를 해제했습니다."));
      await refresh();
    }
    if (b.dataset.bulk) {
      const ids = [...state.selected];
      if (b.dataset.bulk === "clear") {
        state.selected.clear();
        renderSelection();
      } else if (b.dataset.bulk === "download") {
        for (const id of ids) {
          download(id);
          await new Promise((r) => setTimeout(r, 250));
        }
      } else if (b.dataset.bulk === "trash") {
        dialog(
          t("선택한 파일 삭제"),
          `<p>${t("{count}개 파일을 휴지통으로 이동합니다.", {
            count: ids.length,
          })}</p>`,
          async () => {
            for (const id of ids)
              await api("/nodes/" + id, {
                method: "DELETE",
              });
            await refresh();
          },
          t("이동"),
        );
      } else {
        for (const id of ids)
          await api("/nodes/" + id + "/restore", {
            method: "POST",
          });
        await refresh();
      }
    }
  } catch (err) {
    toast(err.message);
  }
});
document.addEventListener("change", (e) => {
  const el = e.target;
  if (el.dataset.select) {
    el.checked
      ? state.selected.add(el.dataset.select)
      : state.selected.delete(el.dataset.select);
    renderSelection();
  }
});
$("#new-folder").onclick = $("#side-folder").onclick = newFolder;
$("#upload-main").onclick = () => {
  if (state.view !== "drive") navigate("drive");
  $("#file-input").click();
};
$("#upload-button").onclick = () => $("#file-input").click();
$("#file-input").onchange = (e) => {
  addFiles([...e.target.files]);
  e.target.value = "";
};
$("#account").onclick = accountMenu;
$("#search").oninput = (e) => {
  state.q = e.target.value;
  clearTimeout(searchTimer);
  searchTimer = setTimeout(refresh, 220);
};
$("#list-view").onclick = () => {
  state.layout = "list";
  localStorage.setItem("pmk-layout", "list");
  render();
};
$("#grid-view").onclick = () => {
  state.layout = "grid";
  localStorage.setItem("pmk-layout", "grid");
  render();
};
$("#mobile-menu").onclick = () => $(".sidebar").classList.toggle("open");
document.addEventListener("keydown", (e) => {
  if (
    e.key === "/" &&
    !["INPUT", "TEXTAREA"].includes(document.activeElement.tagName) &&
    !$("#dialog").open &&
    state.user
  ) {
    e.preventDefault();
    $("#search").focus();
  }
  if (e.key === "Escape") {
    $("#context-menu").hidden = true;
    $(".sidebar").classList.remove("open");
  }
});
let dragDepth = 0;
document.addEventListener("dragenter", (e) => {
  if (
    !e.dataTransfer.types.includes("Files") ||
    !state.user ||
    state.view !== "drive"
  )
    return;
  e.preventDefault();
  dragDepth++;
  $("#drop-overlay").hidden = false;
});
document.addEventListener("dragover", (e) => {
  if (e.dataTransfer.types.includes("Files")) e.preventDefault();
});
document.addEventListener("dragleave", () => {
  if (--dragDepth <= 0) {
    dragDepth = 0;
    $("#drop-overlay").hidden = true;
  }
});
document.addEventListener("drop", (e) => {
  e.preventDefault();
  dragDepth = 0;
  $("#drop-overlay").hidden = true;
  if (e.dataTransfer.files.length) addFiles([...e.dataTransfer.files]);
});
window.addEventListener("beforeunload", (e) => {
  if (jobs.some((j) => j.status === "uploading")) {
    e.preventDefault();
    e.returnValue = "";
  }
});
const shareMatch = location.pathname.match(/\/s\/([^/]+)$/);
i18n.localize(document);
if (shareMatch) publicShare(shareMatch[1]);
else start();
function languagePicker() {
  return `<div class="language-picker" role="group" aria-label="Language"><button type="button" data-language="ko" lang="ko" aria-pressed="${i18n.language() === "ko"}">한국어</button><button type="button" data-language="en" lang="en" aria-pressed="${i18n.language() === "en"}">EN</button></div>`;
}
function renderStats() {
  $("#storage-used").textContent = t("{size} 사용 중", {
    size: bytes(state.stats.bytes),
  });
  $("#footer-status").textContent = t("총 {count}개 파일 · 팀 공유 공간", {
    count: state.stats.files.toLocaleString(i18n.locale()),
  });
  if (state.user)
    $("#storage-description").textContent = t(
      state.user.storage !== "local"
        ? "클라우드 스토리지에 보관됩니다."
        : "서버 저장소에 보관됩니다.",
    );
}
function setLanguage(language) {
  if (!i18n.setLanguage(language)) return;
  i18n.localize(document);
  // Never reload: keep active transfers, folder, search, selection and login inputs.
  $("#context-menu").hidden = true;
  $("#toast").hidden = true;
  if (state.user) {
    renderStats();
    render();
    renderSelection();
    const hidden = $("#upload-panel").hidden;
    renderJobs();
    $("#upload-panel").hidden = hidden;
  } else if (shareMatch) publicShare(shareMatch[1]);
  $$(".form-error").forEach((el) => (el.textContent = t(el.textContent)));
}
