"use strict";

const CHUNI_ORIGIN = "https://chunithm-net-eng.com";
const CACHE_PREFIX = "chuni_records_cache_v2_";
const LEGACY_MASTER_CACHE_KEY = "chuni_master_records_cache_v1";
const CACHE_MAX_AGE = 24 * 60 * 60 * 1000;

const DIFFICULTIES = Object.freeze({
    BAS: { label: "Basic" },
    ADV: { label: "Advanced" },
    EXP: { label: "Expert" },
    MAS: { label: "Master" },
    ULT: { label: "Ultima" }
});

let activeDifficulty = "MAS";
let chuniWindow = null;
let bridgeReady = false;
let currentRecords = [];
let sortKey = null;
let sortDirection = "ascending";

const pendingRequests = new Map();
const statusElement = document.querySelector("#status");
const recordsElement = document.querySelector("#records");
const difficultyTitleElement = document.querySelector("#difficultyTitle");
const requestButton = document.querySelector("#requestRecords");
const copyBridgeCodeButton = document.querySelector("#copyBridgeCode");
const bridgeCodeElement = document.querySelector("#bridgeCode");
const tabs = Array.from(document.querySelectorAll(".difficulty-tab"));
const sortButtons = Array.from(document.querySelectorAll(".sort-button"));
const textCollator = new Intl.Collator("zh-Hant", {
    numeric: true,
    sensitivity: "base"
});

function getDifficultyLabel(difficulty) {
    return DIFFICULTIES[difficulty]?.label ?? difficulty;
}

function getCacheKey(difficulty) {
    return `${CACHE_PREFIX}${difficulty}`;
}

function setStatus(message, isError = false) {
    statusElement.textContent = message;
    statusElement.classList.toggle("error", isError);
}

async function copyBridgeCode() {
    const code = bridgeCodeElement.textContent.trim();

    try {
        await navigator.clipboard.writeText(code);
    } catch (error) {
        const textArea = document.createElement("textarea");
        textArea.value = code;
        textArea.setAttribute("readonly", "");
        textArea.style.position = "fixed";
        textArea.style.opacity = "0";
        document.body.append(textArea);
        textArea.select();

        const copied = document.execCommand("copy");
        textArea.remove();

        if (!copied) {
            console.error("複製 bridge 程式碼失敗：", error);
            copyBridgeCodeButton.textContent = "複製失敗，請手動選取";
            return;
        }
    }

    copyBridgeCodeButton.textContent = "已複製！";

    window.setTimeout(() => {
        copyBridgeCodeButton.textContent = "複製程式碼";
    }, 1800);
}

function getRecordStatus(record) {
    return [record.clear, record.clear2]
        .filter(Boolean)
        .join(" ");
}

function getSortValue(record, key) {
    switch (key) {
        case "score": {
            const score = Number(record.score);
            return Number.isFinite(score) ? score : null;
        }

        case "status":
            return getRecordStatus(record);

        case "idx":
            return String(record.idx ?? "").trim();

        case "title":
        default:
            return String(record.title ?? "").trim();
    }
}

function compareRecords(leftRecord, rightRecord) {
    const leftValue = getSortValue(leftRecord, sortKey);
    const rightValue = getSortValue(rightRecord, sortKey);
    const leftEmpty = leftValue === null || leftValue === "";
    const rightEmpty = rightValue === null || rightValue === "";

    // 沒有內容的欄位固定排在最後面，避免降冪時跑到最前方。
    if (leftEmpty !== rightEmpty) {
        return leftEmpty ? 1 : -1;
    }

    if (leftEmpty && rightEmpty) {
        return 0;
    }

    const comparison = sortKey === "score"
        ? leftValue - rightValue
        : textCollator.compare(String(leftValue), String(rightValue));

    return sortDirection === "ascending"
        ? comparison
        : -comparison;
}

function updateSortHeaders() {
    for (const button of sortButtons) {
        const selected = button.dataset.sortKey === sortKey;
        const header = button.closest("th");
        const indicator = button.querySelector(".sort-indicator");

        header.setAttribute(
            "aria-sort",
            selected ? sortDirection : "none"
        );

        indicator.textContent = selected
            ? sortDirection === "ascending" ? "↑" : "↓"
            : "↕";
    }
}

function resetSorting() {
    sortKey = null;
    sortDirection = "ascending";
    updateSortHeaders();
}

function renderCurrentRecords() {
    recordsElement.replaceChildren();

    if (currentRecords.length === 0) {
        const row = document.createElement("tr");
        row.className = "empty-row";

        const cell = document.createElement("td");
        cell.colSpan = 4;
        cell.textContent = "這個難度目前沒有成績";

        row.append(cell);
        recordsElement.append(row);
        return;
    }

    const recordsToRender = sortKey
        ? currentRecords
            .map((record, originalIndex) => ({ record, originalIndex }))
            .sort((left, right) => (
                compareRecords(left.record, right.record)
                || left.originalIndex - right.originalIndex
            ))
            .map(item => item.record)
        : currentRecords;

    for (const record of recordsToRender) {
        const row = document.createElement("tr");
        const titleCell = document.createElement("td");
        const scoreCell = document.createElement("td");
        const clearCell = document.createElement("td");
        const idxCell = document.createElement("td");

        titleCell.textContent = record.title ?? "";

        const score = Number(record.score);
        scoreCell.textContent = Number.isFinite(score)
            ? score.toLocaleString()
            : "";

        clearCell.textContent = getRecordStatus(record);
        idxCell.textContent = record.idx ?? "";

        row.append(titleCell, scoreCell, clearCell, idxCell);
        recordsElement.append(row);
    }
}

function renderRecords(records) {
    currentRecords = [...records];
    renderCurrentRecords();
}

function saveRecordsToCache(difficulty, records) {
    const cache = {
        difficulty,
        savedAt: Date.now(),
        records
    };

    try {
        localStorage.setItem(getCacheKey(difficulty), JSON.stringify(cache));
        return true;
    } catch (error) {
        console.error("寫入 localStorage 失敗：", error);
        return false;
    }
}

function loadRecordsFromCache(difficulty, allowExpired = false) {
    let rawCache;

    try {
        rawCache = localStorage.getItem(getCacheKey(difficulty));

        // 讓舊版已儲存的 Master 成績可以繼續使用。
        if (!rawCache && difficulty === "MAS") {
            rawCache = localStorage.getItem(LEGACY_MASTER_CACHE_KEY);
        }
    } catch (error) {
        console.error("讀取 localStorage 失敗：", error);
        return null;
    }

    if (!rawCache) {
        return null;
    }

    try {
        const cache = JSON.parse(rawCache);

        if (
            !cache ||
            typeof cache !== "object" ||
            !Number.isFinite(cache.savedAt) ||
            !Array.isArray(cache.records)
        ) {
            throw new Error("快取資料格式不正確");
        }

        const age = Date.now() - cache.savedAt;
        const expired = age >= CACHE_MAX_AGE;

        if (expired && !allowExpired) {
            return null;
        }

        return {
            records: cache.records,
            savedAt: cache.savedAt,
            age,
            expired
        };
    } catch (error) {
        console.error("解析快取失敗：", error);

        try {
            localStorage.removeItem(getCacheKey(difficulty));
        } catch (removeError) {
            console.error("移除損壞快取失敗：", removeError);
        }

        return null;
    }
}

function formatCacheTime(timestamp) {
    return new Date(timestamp).toLocaleString("zh-TW", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit"
    });
}

function showFreshCache(difficulty) {
    const cache = loadRecordsFromCache(difficulty, false);

    if (!cache) {
        return false;
    }

    renderRecords(cache.records);
    setStatus(
        `已從快取載入 ${cache.records.length} 筆 ${getDifficultyLabel(difficulty)} 成績，`
        + `更新時間：${formatCacheTime(cache.savedAt)}`
    );
    return true;
}

function selectDifficulty(difficulty, { focus = false } = {}) {
    if (!DIFFICULTIES[difficulty]) {
        return;
    }

    activeDifficulty = difficulty;
    resetSorting();
    const label = getDifficultyLabel(difficulty);

    difficultyTitleElement.textContent = label;
    requestButton.textContent = `取得 ${label} 成績`;

    for (const tab of tabs) {
        const selected = tab.dataset.difficulty === difficulty;
        tab.setAttribute("aria-selected", String(selected));
        tab.tabIndex = selected ? 0 : -1;

        if (selected && focus) {
            tab.focus();
        }
    }

    if (!showFreshCache(difficulty)) {
        renderRecords([]);
        setStatus(`尚未載入 ${label} 成績`);
    }
}

function requestRecords(difficulty) {
    const label = getDifficultyLabel(difficulty);

    if (!chuniWindow || chuniWindow.closed) {
        setStatus("尚未開啟官方頁面，請先開啟 CHUNITHM-NET。", true);
        return;
    }

    setStatus(
        bridgeReady
            ? `正在取得 ${label} 成績…`
            : "正在等待 bridge；若已貼上工具，請稍候再試。"
    );

    const requestId = crypto.randomUUID();
    pendingRequests.set(requestId, difficulty);

    chuniWindow.postMessage(
        {
            source: "chuni-simple-viewer",
            action: "request",
            requestId,
            payload: {
                target: "allRecord",
                difficulty
            }
        },
        CHUNI_ORIGIN
    );
}

for (const tab of tabs) {
    tab.addEventListener("click", () => {
        selectDifficulty(tab.dataset.difficulty);
    });

    tab.addEventListener("keydown", event => {
        const currentIndex = tabs.indexOf(tab);
        let nextIndex = null;

        if (event.key === "ArrowRight") {
            nextIndex = (currentIndex + 1) % tabs.length;
        } else if (event.key === "ArrowLeft") {
            nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
        } else if (event.key === "Home") {
            nextIndex = 0;
        } else if (event.key === "End") {
            nextIndex = tabs.length - 1;
        }

        if (nextIndex !== null) {
            event.preventDefault();
            selectDifficulty(tabs[nextIndex].dataset.difficulty, { focus: true });
        }
    });
}

for (const button of sortButtons) {
    button.addEventListener("click", () => {
        const selectedKey = button.dataset.sortKey;

        if (sortKey === selectedKey) {
            sortDirection = sortDirection === "ascending"
                ? "descending"
                : "ascending";
        } else {
            sortKey = selectedKey;
            sortDirection = "ascending";
        }

        updateSortHeaders();
        renderCurrentRecords();
    });
}

document.querySelector("#openChuni").addEventListener("click", () => {
    chuniWindow = window.open(
        `${CHUNI_ORIGIN}/mobile/home/`,
        "chuniBridgeWindow"
    );

    if (!chuniWindow) {
        setStatus("無法開啟視窗，請允許瀏覽器顯示彈出式視窗。", true);
        return;
    }

    bridgeReady = false;
    setStatus("已開啟 CHUNITHM-NET，登入後請在官方頁面執行 bridge 工具。 ");
});

requestButton.addEventListener("click", () => {
    requestRecords(activeDifficulty);
});

copyBridgeCodeButton.addEventListener("click", copyBridgeCode);

window.addEventListener("message", event => {
    if (event.origin !== CHUNI_ORIGIN) {
        return;
    }

    const message = event.data;

    if (
        !message ||
        typeof message !== "object" ||
        message.source !== "chuni-simple-bridge"
    ) {
        return;
    }

    // 以實際收到 bridge 訊息的官方視窗重新綁定。
    // 某些瀏覽器經過登入重新導向後，原本 window.open 回傳的
    // WindowProxy 不一定能通過嚴格物件比對。
    chuniWindow = event.source;

    if (message.action === "ready") {
        bridgeReady = true;
        setStatus("Bridge 已就緒，請選擇難度並取得成績。");
        return;
    }

    if (message.action !== "response") {
        return;
    }

    const difficulty = pendingRequests.get(message.requestId)
        ?? message.difficulty;
    pendingRequests.delete(message.requestId);

    if (!DIFFICULTIES[difficulty]) {
        return;
    }

    const label = getDifficultyLabel(difficulty);

    if (!message.ok) {
        if (difficulty !== activeDifficulty) {
            return;
        }

        const expiredCache = loadRecordsFromCache(difficulty, true);

        if (expiredCache) {
            renderRecords(expiredCache.records);
            setStatus(
                `取得 ${label} 成績失敗，顯示較舊的快取資料。`
                + `快取時間：${formatCacheTime(expiredCache.savedAt)}`,
                true
            );
        } else {
            setStatus(`取得 ${label} 成績失敗：${message.error}`, true);
        }

        return;
    }

    if (!Array.isArray(message.data)) {
        if (difficulty === activeDifficulty) {
            setStatus("Bridge 回傳的資料格式不正確。", true);
        }
        return;
    }

    const saved = saveRecordsToCache(difficulty, message.data);

    if (difficulty !== activeDifficulty) {
        return;
    }

    renderRecords(message.data);
    setStatus(
        saved
            ? `已取得並快取 ${message.data.length} 筆 ${label} 成績。`
            : `已取得 ${message.data.length} 筆 ${label} 成績，但無法寫入快取。`,
        !saved
    );
});

selectDifficulty(activeDifficulty);
