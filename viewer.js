"use strict";

const CHUNI_ORIGIN =
    "https://chunithm-net-eng.com";

const CACHE_KEY =
    "chuni_master_records_cache_v1";

const CACHE_MAX_AGE =
    24 * 60 * 60 * 1000; // 24 小時

let chuniWindow = null;
let bridgeReady = false;

const statusElement =
    document.querySelector("#status");

const recordsElement =
    document.querySelector("#records");

function setStatus(message, isError = false) {
    statusElement.textContent = message;
    statusElement.classList.toggle(
        "error",
        isError
    );
}

function renderRecords(records) {
    recordsElement.replaceChildren();

    for (const record of records) {
        const row = document.createElement("tr");

        const titleCell =
            document.createElement("td");

        const scoreCell =
            document.createElement("td");

        const clearCell =
            document.createElement("td");

        const idxCell =
            document.createElement("td");

        titleCell.textContent =
            record.title ?? "";

        const score = Number(record.score);

        scoreCell.textContent =
            Number.isFinite(score)
                ? score.toLocaleString()
                : "";

        clearCell.textContent =
            [record.clear, record.clear2]
                .filter(Boolean)
                .join(" ");

        idxCell.textContent =
            record.idx ?? "";

        row.append(
            titleCell,
            scoreCell,
            clearCell,
            idxCell
        );

        recordsElement.append(row);
    }
}

/*
 * 把成績與儲存時間寫入 localStorage。
 */
function saveRecordsToCache(records) {
    const cache = {
        savedAt: Date.now(),
        records
    };

    try {
        localStorage.setItem(
            CACHE_KEY,
            JSON.stringify(cache)
        );

        return true;
    } catch (error) {
        console.error(
            "寫入 localStorage 失敗：",
            error
        );

        return false;
    }
}

/*
 * 讀取 localStorage。
 *
 * allowExpired = false：
 *   超過 24 小時就視為沒有快取。
 *
 * allowExpired = true：
 *   即使過期也回傳，可用於顯示舊資料。
 */
function loadRecordsFromCache(
    allowExpired = false
) {
    let rawCache;

    try {
        rawCache =
            localStorage.getItem(CACHE_KEY);
    } catch (error) {
        console.error(
            "讀取 localStorage 失敗：",
            error
        );

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
            throw new Error(
                "快取資料格式不正確"
            );
        }

        const age =
            Date.now() - cache.savedAt;

        const expired =
            age >= CACHE_MAX_AGE;

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
        console.error(
            "解析快取失敗：",
            error
        );

        /*
         * 快取損壞時直接清除。
         */
        localStorage.removeItem(CACHE_KEY);

        return null;
    }
}

function clearRecordsCache() {
    localStorage.removeItem(CACHE_KEY);
}

function formatCacheTime(timestamp) {
    return new Date(timestamp).toLocaleString(
        "zh-TW",
        {
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit"
        }
    );
}

/*
 * 嘗試直接使用 24 小時內的快取。
 */
function showFreshCache() {
    const cache =
        loadRecordsFromCache(false);

    if (!cache) {
        return false;
    }

    renderRecords(cache.records);

    setStatus(
        `已從本機快取載入 ${cache.records.length} 筆資料，`
        + `更新時間：${formatCacheTime(cache.savedAt)}`
    );

    return true;
}

document
    .querySelector("#openChuni")
    .addEventListener("click", () => {
        chuniWindow = window.open(
            `${CHUNI_ORIGIN}/mobile/home/`,
            "chuniBridgeWindow"
        );

        if (!chuniWindow) {
            setStatus(
                "瀏覽器阻擋了彈出視窗。",
                true
            );

            return;
        }

        bridgeReady = false;

        setStatus(
            "已開啟 CHUNITHM-NET，請登入並執行 bridge 工具。"
        );
    });

document
    .querySelector("#requestMaster")
    .addEventListener("click", () => {
        /*
         * 優先使用一天內的 localStorage。
         */
        if (showFreshCache()) {
            return;
        }

        /*
         * 沒有有效快取，才需要向 bridge 要資料。
         */
        if (!chuniWindow || chuniWindow.closed) {
            setStatus(
                "沒有一天內的快取，請先開啟 CHUNITHM-NET。",
                true
            );

            return;
        }

        if (!bridgeReady) {
            setStatus(
                "尚未偵測到 bridge，但仍嘗試發送請求。"
            );
        } else {
            setStatus(
                "快取不存在或已超過一天，正在重新取得 Master 成績……"
            );
        }

        chuniWindow.postMessage(
            {
                source: "chuni-simple-viewer",
                action: "request",
                requestId:
                    crypto.randomUUID(),
                payload: {
                    target: "allRecord",
                    difficulty: "MAS"
                }
            },
            CHUNI_ORIGIN
        );
    });

window.addEventListener(
    "message",
    event => {
        if (
            event.origin !== CHUNI_ORIGIN
        ) {
            return;
        }

        if (
            chuniWindow &&
            event.source !== chuniWindow
        ) {
            return;
        }

        const message = event.data;

        if (
            !message ||
            typeof message !== "object" ||
            message.source !==
                "chuni-simple-bridge"
        ) {
            return;
        }

        switch (message.action) {
            case "ready":
                bridgeReady = true;

                setStatus(
                    "Bridge 已連線，可以取得成績。"
                );
                break;

            case "response":
                if (!message.ok) {
                    setStatus(
                        `取得失敗：${message.error}`,
                        true
                    );

                    /*
                     * 網路取得失敗時，可以退回顯示
                     * 已過期的快取。
                     */
                    const expiredCache =
                        loadRecordsFromCache(true);

                    if (expiredCache) {
                        renderRecords(
                            expiredCache.records
                        );

                        setStatus(
                            `重新取得失敗，暫時顯示舊快取。`
                            + `快取時間：`
                            + formatCacheTime(
                                expiredCache.savedAt
                            ),
                            true
                        );
                    }

                    return;
                }

                if (
                    !Array.isArray(message.data)
                ) {
                    setStatus(
                        "Bridge 回傳的資料格式不正確。",
                        true
                    );

                    return;
                }

                renderRecords(message.data);

                const saved =
                    saveRecordsToCache(
                        message.data
                    );

                if (saved) {
                    setStatus(
                        `已取得並快取 `
                        + `${message.data.length} `
                        + `筆 Master 成績。`
                    );
                } else {
                    setStatus(
                        `已取得 `
                        + `${message.data.length} `
                        + `筆成績，但無法寫入快取。`,
                        true
                    );
                }

                break;
        }
    }
);

/*
 * 頁面開啟時立即嘗試顯示一天內的快取。
 */
showFreshCache();