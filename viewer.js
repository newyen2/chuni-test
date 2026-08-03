"use strict";

const CHUNI_ORIGIN = "https://chunithm-net-eng.com";
const CACHE_PREFIX = "chuni_records_cache_v2_";
const LEGACY_MASTER_CACHE_KEY = "chuni_master_records_cache_v1";
const CACHE_MAX_AGE = 24 * 60 * 60 * 1000;
const REQUEST_TIMEOUT = 60 * 1000;

const DIFFICULTIES = Object.freeze({
    BAS: { label: "Basic", displayLabel: "BASIC" },
    ADV: { label: "Advanced", displayLabel: "ADVANCED" },
    EXP: { label: "Expert", displayLabel: "EXPERT" },
    MAS: { label: "Master", displayLabel: "MASTER" },
    ULT: { label: "Ultima", displayLabel: "ULTIMA" }
});

const DIFFICULTY_KEYS = Object.freeze(Object.keys(DIFFICULTIES));

let chuniWindow = null;
let bridgeReady = false;
let activeBatch = null;
let currentRecords = [];
let sortKey = null;
let sortDirection = "ascending";

const pendingRequests = new Map();
const recordsByDifficulty = new Map();
const loadedDataByDifficulty = new Map();
const selectedDifficulties = new Set(DIFFICULTY_KEYS);

const statusElement = document.querySelector("#status");
const recordsElement = document.querySelector("#records");
const requestButton = document.querySelector("#requestRecords");
const copyBridgeCodeButton = document.querySelector("#copyBridgeCode");
const bridgeCodeElement = document.querySelector("#bridgeCode");
const selectAllButton = document.querySelector("#selectAllDifficulties");
const clearAllButton = document.querySelector("#clearAllDifficulties");
const filterInputs = Array.from(
    document.querySelectorAll(".difficulty-filter-input")
);
const dataStatusBadges = Array.from(
    document.querySelectorAll(".data-status-badge")
);
const sortButtons = Array.from(document.querySelectorAll(".sort-button"));
const textCollator = new Intl.Collator("zh-Hant", {
    numeric: true,
    sensitivity: "base"
});

function getDifficultyLabel(difficulty) {
    return DIFFICULTIES[difficulty]?.label ?? difficulty;
}

function getDifficultyDisplayLabel(difficulty) {
    return DIFFICULTIES[difficulty]?.displayLabel ?? difficulty;
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
        case "difficulty":
            return DIFFICULTY_KEYS.indexOf(record.difficulty);

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

    if (leftEmpty !== rightEmpty) {
        return leftEmpty ? 1 : -1;
    }

    if (leftEmpty && rightEmpty) {
        return 0;
    }

    const numericSort = sortKey === "score" || sortKey === "difficulty";
    const comparison = numericSort
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

function renderCurrentRecords() {
    recordsElement.replaceChildren();

    if (currentRecords.length === 0) {
        const row = document.createElement("tr");
        row.className = "empty-row";

        const cell = document.createElement("td");
        cell.colSpan = 5;
        cell.textContent = selectedDifficulties.size === 0
            ? "請至少選擇一個顯示難度"
            : "所選難度目前沒有已取得的成績";

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
        const difficultyCell = document.createElement("td");
        const titleCell = document.createElement("td");
        const scoreCell = document.createElement("td");
        const clearCell = document.createElement("td");
        const idxCell = document.createElement("td");

        difficultyCell.textContent = getDifficultyDisplayLabel(record.difficulty);
        titleCell.textContent = record.title ?? "";

        const score = Number(record.score);
        scoreCell.textContent = Number.isFinite(score)
            ? score.toLocaleString()
            : "";

        clearCell.textContent = getRecordStatus(record);
        idxCell.textContent = record.idx ?? "";

        row.append(
            difficultyCell,
            titleCell,
            scoreCell,
            clearCell,
            idxCell
        );
        recordsElement.append(row);
    }
}

function rebuildCurrentRecords() {
    currentRecords = DIFFICULTY_KEYS
        .filter(difficulty => selectedDifficulties.has(difficulty))
        .flatMap(difficulty => recordsByDifficulty.get(difficulty) ?? []);

    renderCurrentRecords();
}

function syncSelectedDifficulties() {
    selectedDifficulties.clear();

    for (const input of filterInputs) {
        if (input.checked) {
            selectedDifficulties.add(input.value);
        }
    }

    rebuildCurrentRecords();
}

function setAllDifficultyFilters(checked) {
    for (const input of filterInputs) {
        input.checked = checked;
    }

    syncSelectedDifficulties();
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

function normalizeRecords(difficulty, records) {
    return records.map(record => ({
        ...record,
        difficulty
    }));
}

function setDifficultyData(
    difficulty,
    records,
    source,
    savedAt = Date.now()
) {
    recordsByDifficulty.set(
        difficulty,
        normalizeRecords(difficulty, records)
    );
    loadedDataByDifficulty.set(difficulty, {
        source,
        savedAt
    });
}

function updateLoadedDifficultyStatus() {
    const sourceLabels = {
        network: "最新",
        cache: "快取",
        "expired-cache": "舊快取"
    };

    for (const badge of dataStatusBadges) {
        const difficulty = badge.dataset.difficulty;
        const loadedData = loadedDataByDifficulty.get(difficulty);
        const label = getDifficultyDisplayLabel(difficulty);

        badge.classList.toggle("loaded", Boolean(loadedData));

        if (!loadedData) {
            badge.textContent = `○ ${label} 尚未取得`;
            badge.removeAttribute("title");
            continue;
        }

        const sourceLabel = sourceLabels[loadedData.source] ?? "已取得";
        badge.textContent = `✓ ${label}（${sourceLabel}）`;
        badge.title = `資料時間：${formatCacheTime(loadedData.savedAt)}`;
    }
}

function loadAllFreshCaches() {
    const loadedDifficulties = [];

    for (const difficulty of DIFFICULTY_KEYS) {
        const cache = loadRecordsFromCache(difficulty, false);

        if (!cache) {
            continue;
        }

        setDifficultyData(
            difficulty,
            cache.records,
            "cache",
            cache.savedAt
        );
        loadedDifficulties.push(getDifficultyDisplayLabel(difficulty));
    }

    updateLoadedDifficultyStatus();
    rebuildCurrentRecords();

    if (loadedDifficulties.length > 0) {
        setStatus(`已從 LocalStorage 載入：${loadedDifficulties.join("、")}`);
    } else {
        setStatus("尚未取得成績資料");
    }
}

function finalizeBatch(batch) {
    if (activeBatch?.id !== batch.id) {
        return;
    }

    window.clearTimeout(batch.timeoutId);
    requestButton.disabled = false;
    activeBatch = null;

    if (batch.failed.length === 0) {
        const totalRecords = DIFFICULTY_KEYS.reduce(
            (sum, difficulty) => (
                sum + (recordsByDifficulty.get(difficulty)?.length ?? 0)
            ),
            0
        );
        setStatus(`已取得所有難度成績，共 ${totalRecords} 筆。`);
        return;
    }

    const failedLabels = batch.failed
        .map(item => getDifficultyDisplayLabel(item.difficulty))
        .join("、");
    setStatus(
        `取得完成：成功 ${batch.succeeded.length}/${DIFFICULTY_KEYS.length}；`
        + `失敗難度：${failedLabels}。`,
        true
    );
}

function markBatchResponse(batchId, difficulty, succeeded, error = "") {
    const batch = activeBatch;

    if (!batch || batch.id !== batchId) {
        return;
    }

    batch.completed.add(difficulty);

    if (succeeded) {
        batch.succeeded.push(difficulty);
    } else {
        batch.failed.push({ difficulty, error });
    }

    if (batch.completed.size === DIFFICULTY_KEYS.length) {
        finalizeBatch(batch);
        return;
    }

    setStatus(
        `正在取得所有難度成績（${batch.completed.size}/${DIFFICULTY_KEYS.length}）…`
    );
    sendNextBatchRequest(batch);
}

function handleBatchTimeout(batchId) {
    const batch = activeBatch;

    if (!batch || batch.id !== batchId) {
        return;
    }

    for (const [requestId, request] of pendingRequests) {
        if (request.batchId !== batchId) {
            continue;
        }

        pendingRequests.delete(requestId);
    }

    for (const difficulty of DIFFICULTY_KEYS) {
        if (!batch.completed.has(difficulty)) {
            batch.completed.add(difficulty);
            batch.failed.push({
                difficulty,
                error: "等待回應逾時"
            });
        }
    }

    finalizeBatch(batch);
}

function sendNextBatchRequest(batch) {
    if (activeBatch?.id !== batch.id) {
        return;
    }

    const difficulty = batch.remaining.shift();

    if (!difficulty) {
        return;
    }

    const requestId = crypto.randomUUID();
    pendingRequests.set(requestId, {
        difficulty,
        batchId: batch.id
    });

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

function requestAllRecords() {
    if (!chuniWindow || chuniWindow.closed) {
        setStatus("尚未開啟官方頁面，請先開啟 CHUNITHM-NET。", true);
        return;
    }

    const batchId = crypto.randomUUID();
    const batch = {
        id: batchId,
        completed: new Set(),
        succeeded: [],
        failed: [],
        remaining: [...DIFFICULTY_KEYS],
        timeoutId: null
    };

    activeBatch = batch;
    requestButton.disabled = true;
    setStatus(
        bridgeReady
            ? `正在取得所有難度成績（0/${DIFFICULTY_KEYS.length}）…`
            : "正在等待 bridge 並送出所有難度請求…"
    );

    batch.timeoutId = window.setTimeout(
        () => handleBatchTimeout(batchId),
        REQUEST_TIMEOUT
    );
    sendNextBatchRequest(batch);
}

for (const input of filterInputs) {
    input.addEventListener("change", syncSelectedDifficulties);
}

selectAllButton.addEventListener("click", () => {
    setAllDifficultyFilters(true);
});

clearAllButton.addEventListener("click", () => {
    setAllDifficultyFilters(false);
});

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
    setStatus("已開啟 CHUNITHM-NET，登入後請在官方頁面執行 bridge 工具。");
});

requestButton.addEventListener("click", requestAllRecords);
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

    chuniWindow = event.source;

    if (message.action === "ready") {
        bridgeReady = true;

        if (!activeBatch) {
            setStatus("Bridge 已就緒，可取得所有難度成績。");
        }
        return;
    }

    if (message.action !== "response") {
        return;
    }

    const request = pendingRequests.get(message.requestId);
    pendingRequests.delete(message.requestId);

    if (!request || !DIFFICULTIES[request.difficulty]) {
        return;
    }

    const { difficulty, batchId } = request;
    let succeeded = false;
    let errorMessage = message.error ?? "未知錯誤";

    if (message.ok && Array.isArray(message.data)) {
        const saved = saveRecordsToCache(difficulty, message.data);
        setDifficultyData(difficulty, message.data, "network");
        succeeded = true;

        if (!saved) {
            console.warn(`${getDifficultyLabel(difficulty)} 成績無法寫入快取。`);
        }
    } else {
        const expiredCache = loadRecordsFromCache(difficulty, true);

        if (expiredCache && !recordsByDifficulty.has(difficulty)) {
            setDifficultyData(
                difficulty,
                expiredCache.records,
                "expired-cache",
                expiredCache.savedAt
            );
        }
    }

    updateLoadedDifficultyStatus();
    rebuildCurrentRecords();
    markBatchResponse(batchId, difficulty, succeeded, errorMessage);
});

updateSortHeaders();
loadAllFreshCaches();
