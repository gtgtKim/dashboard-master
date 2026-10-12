"use strict";
// Explicit interface strings only. File names, folder names and user input are never translated.
window.PMK_I18N = (() => {
  const en = {
    " · 업로드 완료": " · Uploaded",
    "0 B 사용 중": "0 B used",
    "12자 이상": "At least 12 characters",
    "1일": "1 day",
    "30일": "30 days",
    "7일": "7 days",
    "Excel, PowerPoint, PDF 및 모든 파일 형식":
      "Excel, PowerPoint, PDF and all file types",
    "PDF 문서": "PDF document",
    "PMK Drive 홈": "PMK Drive home",
    "PMK Drive에서 공유한 파일입니다.": "A file shared through PMK Drive.",
    "{count}개 선택됨": "Selected: {count}",
    "{count}개 파일을 휴지통으로 이동합니다.": "Move {count} files to Trash.",
    "{count}개 항목": "Items: {count}",
    "{date}까지 유효한 링크": "Expires on {date}",
    "{name} 메뉴": "Menu for {name}",
    "{name} 선택": "Select {name}",
    "{name}: 최대 {size}까지 업로드할 수 있습니다.":
      "{name}: The upload limit is {size}.",
    "{name}의 새 위치를 선택하세요.": "Choose a new location for {name}.",
    "{size} 사용 중": "{size} used",
    "“{name}” 및 하위 항목을 휴지통으로 이동합니다. 나중에 복원할 수 있습니다.":
      "Move “{name}” and its contents to Trash? You can restore them later.",
    "“{name}”을 휴지통으로 이동합니다. 나중에 복원할 수 있습니다.":
      "Move “{name}” to Trash? You can restore it later.",
    "“{query}” 검색 결과": "Search results for “{query}”",
    "같은 위치에 동일한 이름이 있습니다. 이름을 변경해 주세요.":
      "An item with this name already exists here. Choose another name.",
    "같은 파일을 선택하면 이어서 업로드합니다.":
      "Select the same file to resume uploading.",
    "격자 보기": "Grid view",
    계정: "Account",
    "계정 메뉴": "Account menu",
    "계정 추가": "Add account",
    "공유 공간": "Shared space",
    "공유 링크": "Share link",
    "공유 링크가 만료되었거나 더 이상 사용할 수 없습니다.":
      "This share link has expired or is no longer available.",
    "공유 링크는 정해진 기간 동안만 사용할 수 있습니다.":
      "This share link is available until it expires.",
    "공유 링크는 파일에서 만들 수 있습니다.":
      "Share links can only be created for files.",
    "공유 링크를 복사했습니다.": "Share link copied.",
    "공유 중인 링크가 없습니다": "No active share links",
    "공유 해제": "Revoke link",
    "공유를 해제했습니다.": "Share link revoked.",
    "관리자만 팀원을 추가할 수 있습니다.":
      "Only administrators can add team members.",
    "내 드라이브": "My Drive",
    "내 드라이브에서 업로드할 폴더를 선택해 주세요.":
      "Choose an upload folder in My Drive.",
    "네트워크 연결을 확인하고 재개해 주세요.":
      "Check your connection, then resume the upload.",
    "다른 검색어로 다시 검색해 주세요.": "Try a different search term.",
    다운로드: "Download",
    닫기: "Close",
    "대기 중": "Queued",
    "대상 폴더": "Destination folder",
    "대상은 폴더여야 합니다.": "The destination must be a folder.",
    "드라이브 탐색": "Drive navigation",
    "드라이브에서 파일 및 폴더 검색": "Search files and folders",
    로그아웃: "Sign out",
    로그인: "Sign in",
    "로그인 시도가 너무 많습니다. 15분 후 다시 시도해 주세요.":
      "Too many sign-in attempts. Try again in 15 minutes.",
    "로그인이 필요합니다.": "Please sign in to continue.",
    "링크 만들기": "Create link",
    "링크 유효 기간": "Link expiry",
    "링크로 공유 중": "Shared links",
    "링크를 가진 사람은 로그인 없이 이 파일을 다운로드할 수 있습니다.":
      "Anyone with this link can download the file without signing in.",
    "링크를 사용할 수 없습니다.": "This link is unavailable.",
    만들기: "Create",
    "만료 기한이 있는 링크로 파일을 공유합니다.":
      "Share files with links that expire.",
    메뉴: "Menu",
    "모든 팀원은 이 공간에서 파일을 함께 관리합니다.":
      "All team members can manage files in this shared space.",
    "모든 파일 선택": "Select all files",
    "목록 보기": "List view",
    문서: "Documents",
    변경: "Save",
    복사: "Copy",
    복원: "Restore",
    "복원했습니다.": "Restored.",
    비밀번호: "Password",
    "비밀번호는 12자 이상이어야 합니다.":
      "Passwords must be at least 12 characters long.",
    "삭제한 파일과 폴더를 복원할 수 있습니다.":
      "Restore deleted files and folders here.",
    "상위 폴더를 먼저 복원해 주세요.": "Restore the parent folder first.",
    "새 이름": "New name",
    "새 팀원은 모든 파일을 업로드·다운로드하고 관리할 수 있습니다.":
      "New members can upload, download and manage all files.",
    "새 폴더": "New folder",
    "새 폴더로 업무를 정리하고": "Create folders to organize your work",
    "새 폴더를 만들면": "Create a folder",
    "새로 만든 링크": "New share link",
    "새로 업로드": "New upload",
    "서명된 스토리지 URL로 업로드해 주세요.":
      "Upload using the signed storage URL.",
    "서버 저장소에 보관됩니다.": "Stored on the server.",
    "선택 해제": "Clear selection",
    "선택된 링크를 복사해 주세요.": "Copy the selected link.",
    "선택한 파일 삭제": "Move selected files to Trash",
    소유자: "Owner",
    "수정한 날짜": "Last modified",
    "스토리지 요청에 실패했습니다. 연결 설정을 확인하거나 다시 시도해 주세요.":
      "The storage request failed. Check the connection settings or try again.",
    "스토리지가 변경되어 업로드를 재개할 수 없습니다.":
      "Storage has changed, so this upload cannot be resumed.",
    스프레드시트: "Spreadsheets",
    아이디: "Username",
    "아이디 또는 비밀번호가 올바르지 않습니다.":
      "Incorrect username or password.",
    "업로드 {done} / {total} 완료": "Uploads: {done} / {total} complete",
    "업로드 조각 크기가 맞지 않습니다.":
      "The upload chunk has an incorrect size.",
    "업로드 조각이 완전하지 않습니다.": "The upload chunk is incomplete.",
    "업로드 중": "Uploading",
    "업로드 창 접기": "Hide uploads",
    "업로드가 아직 완료되지 않았습니다. 파일을 다시 선택해 이어서 업로드해 주세요.":
      "The upload is incomplete. Select the same file to resume.",
    "예: 2026 사업 계획": "Example: 2026 Business Plan",
    "요청을 처리할 수 없습니다.": "The request could not be completed.",
    "이곳에서 빠르게 찾을 수 있어요.": "to find it here quickly.",
    이동: "Move",
    "이동했습니다.": "Moved.",
    이름: "Name",
    "이름 변경": "Rename",
    "이름은 1~240바이트여야 하며 /, \\ 또는 제어 문자를 포함할 수 없습니다.":
      "Names must be 1–240 bytes and cannot contain slashes or control characters.",
    "이름을 변경했습니다.": "Renamed.",
    일시정지: "Pause",
    일시정지됨: "Paused",
    "일치하는 파일이 없습니다": "No matching files",
    "입력값을 확인해 주세요.": "Check the values you entered.",
    "자주 찾는 파일을 가까이 두세요.":
      "Keep frequently used files close at hand.",
    "잘못된 업로드 조각 번호입니다.": "Invalid upload chunk number.",
    재개: "Resume",
    "저장 공간": "Storage",
    "전송에 실패했습니다. 연결을 확인하고 재개해 주세요.":
      "The upload failed. Check your connection and resume.",
    "전체 파일": "All files",
    "정렬 방향 변경": "Change sort direction",
    "중단된 파일과 동일한 파일을 선택해 주세요.":
      "Select the original file to resume the upload.",
    "중요 파일": "Starred",
    "중요 파일 표시를 변경했습니다.": "Star updated.",
    "중요 파일로 표시": "Add to Starred",
    "중요 파일에서 해제": "Remove from Starred",
    "중요한 파일을 표시해 보세요": "Star your important files",
    "진행 중인 업로드가 없습니다.": "No active upload was found.",
    "첫 번째 파일을 추가해 보세요": "Add your first file",
    "초기 비밀번호": "Initial password",
    "총 {count}개 파일 · 팀 공유 공간": "Files: {count} · Shared workspace",
    "최근 파일": "Recent files",
    "최대 2,000개 항목을 표시합니다. 검색으로 범위를 좁혀 주세요.":
      "Showing up to 2,000 items. Use search to narrow the results.",
    취소: "Cancel",
    "클라우드 스토리지에 보관됩니다.": "Stored in cloud storage.",
    "팀 드라이브": "Team Drive",
    "팀 작업 공간": "TEAM WORKSPACE",
    "팀과 함께 사용할 파일을 업로드하세요.":
      "and upload files to share with your team.",
    "팀원 계정 추가": "Add team member",
    "팀원 계정을 추가했습니다.": "Team member added.",
    "팀의 모든 파일을 연결합니다.": "Your team's files, connected.",
    파일: "Files",
    "파일 공유": "Share file",
    "파일 다운로드": "Download file",
    "파일 또는 폴더를 찾을 수 없습니다.":
      "The file or folder could not be found.",
    "파일 메뉴에서 필요한 작업을 선택할 수 있습니다.":
      "Open a file menu to choose an action.",
    "파일 업로드": "Upload files",
    "파일 저장소": "File storage",
    "파일 크기": "File size",
    "파일을 놓아 업로드하세요": "Drop files to upload",
    "파일을 이곳으로 드래그하여 업로드하세요": "Drag files here to upload",
    "파일이 도착했어요.": "A file has been shared with you.",
    폴더: "Folders",
    "폴더 열기": "Open folder",
    "폴더 이름": "Folder name",
    "폴더는 직접 다운로드할 수 없습니다.":
      "Folders cannot be downloaded directly.",
    "폴더로 이동": "Move to folder",
    "폴더로 정리하고, 파일을 안전하게 공유하는 PMK 팀 드라이브":
      "Organize and share your team's files with PMK Drive.",
    "폴더를 만들었습니다.": "Folder created.",
    "폴더를 자기 자신이나 하위 폴더로 이동할 수 없습니다.":
      "A folder cannot be moved into itself or one of its subfolders.",
    프레젠테이션: "Presentations",
    "필요한 파일을, 필요한 순간에.": "The right file, when you need it.",
    "함께 쓰는 파일, 한곳에서 깔끔하게.":
      "Your team's files, organized in one place.",
    "허용되지 않은 요청입니다.": "This request is not allowed.",
    "허용된 파일 크기를 초과했습니다.": "This file exceeds the upload limit.",
    "현재 폴더에 파일을 추가합니다":
      "Files will be added to the current folder",
    확인: "Confirm",
    휴지통: "Trash",
    "휴지통으로 이동": "Move to Trash",
    "휴지통으로 이동했습니다.": "Moved to Trash.",
    "휴지통이 비어 있습니다": "Trash is empty",
  };
  const reverse = new Map(
    Object.entries(en).map(([ko, english]) => [english, ko]),
  );
  let saved = null;
  try {
    saved = localStorage.getItem("pmk-language");
  } catch {}
  const requested = new URL(location.href).searchParams.get("lang");
  let current = ["ko", "en"].includes(requested)
    ? requested
    : ["ko", "en"].includes(saved)
      ? saved
      : "ko";
  try {
    localStorage.setItem("pmk-language", current);
  } catch {}
  function t(source, values = {}) {
    const key = reverse.get(source) || source || "";
    const translated = current === "en" ? en[key] || key : key;
    return translated.replace(/\{(\w+)\}/g, (match, name) =>
      Object.hasOwn(values, name) ? String(values[name]) : match,
    );
  }
  function localize(root) {
    document.documentElement.lang = current;
    root
      .querySelectorAll("[data-i18n]")
      .forEach((el) => (el.textContent = t(el.dataset.i18n)));
    for (const attr of ["aria-label", "placeholder", "content"]) {
      root
        .querySelectorAll(`[data-i18n-${attr}]`)
        .forEach((el) =>
          el.setAttribute(attr, t(el.getAttribute(`data-i18n-${attr}`))),
        );
    }
    root
      .querySelectorAll("[data-language]")
      .forEach((el) =>
        el.setAttribute(
          "aria-pressed",
          String(el.dataset.language === current),
        ),
      );
  }
  function setLanguage(language) {
    if (!["ko", "en"].includes(language) || language === current) return false;
    current = language;
    try {
      localStorage.setItem("pmk-language", language);
    } catch {}
    const url = new URL(location.href);
    if (url.searchParams.has("lang")) {
      url.searchParams.set("lang", language);
      history.replaceState(null, "", url);
    }
    return true;
  }
  return {
    t,
    localize,
    setLanguage,
    language: () => current,
    locale: () => (current === "en" ? "en-US" : "ko-KR"),
  };
})();
