"use strict";

const MUSIC_API_URL = "https://api.chunirec.net/2.0/music/showall.json";
const MUSIC_API_TOKEN = "a36ab264d2f2ed2a570d613e70020f195629d95bcb1c9357ab2990b02e9018173dfb717c19544825bae5ea14402ec293ac146766a13d7cded3d1a0a0bdddb68a";
const MUSIC_CACHE_KEY = "chuni_music_catalog_jp2_v1";
const MUSIC_PAGE_SIZE = 100;

let musicCatalog = [];
let filteredMusicCatalog = [];
let currentMusicPage = 1;

const musicCacheStatusElement = document.querySelector("#musicCacheStatus");
const refreshMusicButton = document.querySelector("#refreshMusicData");
const musicRequestStatusElement = document.querySelector("#musicRequestStatus");
const musicSearchInput = document.querySelector("#musicSearch");
const musicResultSummaryElement = document.querySelector("#musicResultSummary");
const musicRecordsElement = document.querySelector("#musicRecords");
const previousMusicPageButton = document.querySelector("#previousMusicPage");
const nextMusicPageButton = document.querySelector("#nextMusicPage");
const musicPageIndicatorElement = document.querySelector("#musicPageIndicator");
const textCollator = new Intl.Collator("zh-Hant", {
    numeric: true,
    sensitivity: "base"
});

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

function saveMusicCatalogToCache(songs) {
    const cache = {
        region: "jp2",
        savedAt: Date.now(),
        songs
    };

    try {
        localStorage.setItem(MUSIC_CACHE_KEY, JSON.stringify(cache));
        return cache.savedAt;
    } catch (error) {
        console.error("寫入歌曲 LocalStorage 快取失敗：", error);
        return null;
    }
}

function loadMusicCatalogFromCache() {
    let rawCache;

    try {
        rawCache = localStorage.getItem(MUSIC_CACHE_KEY);
    } catch (error) {
        console.error("讀取歌曲 LocalStorage 快取失敗：", error);
        return null;
    }

    if (!rawCache) {
        return null;
    }

    try {
        const cache = JSON.parse(rawCache);

        if (
            !cache
            || cache.region !== "jp2"
            || !Number.isFinite(cache.savedAt)
            || !Array.isArray(cache.songs)
        ) {
            throw new Error("歌曲快取格式不正確");
        }

        return cache;
    } catch (error) {
        console.error("解析歌曲 LocalStorage 快取失敗：", error);

        try {
            localStorage.removeItem(MUSIC_CACHE_KEY);
        } catch (removeError) {
            console.error("移除損壞的歌曲快取失敗：", removeError);
        }

        return null;
    }
}

function normalizeMusicCatalog(songs) {
    return songs
        .filter(song => (
            song
            && typeof song === "object"
            && song.meta
            && typeof song.meta === "object"
        ))
        .sort((left, right) => textCollator.compare(
            String(left.meta.title ?? ""),
            String(right.meta.title ?? "")
        ));
}

function createTextCell(text) {
    const cell = document.createElement("td");
    cell.textContent = text;
    return cell;
}

function createMusicTitleCell(meta) {
    const cell = document.createElement("td");
    cell.className = "music-title-cell";

    const title = document.createElement("strong");
    title.textContent = meta.title ?? "";

    const id = document.createElement("small");
    id.textContent = `ID：${meta.id ?? "—"}`;

    cell.append(title, id);
    return cell;
}

function createChartCell(chart) {
    const cell = document.createElement("td");
    cell.className = "chart-cell";

    if (!chart || typeof chart !== "object") {
        cell.textContent = "—";
        return cell;
    }

    const level = document.createElement("strong");
    level.textContent = `Lv. ${chart.level ?? "—"}`;

    const details = document.createElement("small");
    const constant = chart.is_const_unknown
        ? "定數未知"
        : `定數 ${chart.const ?? "—"}`;
    const maxCombo = Number.isFinite(Number(chart.maxcombo))
        ? `／${Number(chart.maxcombo).toLocaleString()} Combo`
        : "";
    details.textContent = `${constant}${maxCombo}`;

    cell.append(level, details);
    return cell;
}

function renderMusicCatalog() {
    musicRecordsElement.replaceChildren();

    const totalSongs = filteredMusicCatalog.length;
    const pageCount = Math.max(1, Math.ceil(totalSongs / MUSIC_PAGE_SIZE));
    currentMusicPage = Math.min(Math.max(currentMusicPage, 1), pageCount);

    if (totalSongs === 0) {
        const row = document.createElement("tr");
        row.className = "empty-row";

        const cell = document.createElement("td");
        cell.colSpan = 10;
        cell.textContent = musicCatalog.length > 0
            ? "找不到符合條件的歌曲"
            : "尚未取得歌曲資料";

        row.append(cell);
        musicRecordsElement.append(row);
        musicResultSummaryElement.textContent = musicCatalog.length > 0
            ? "0 首符合條件"
            : "0 首歌曲";
    } else {
        const startIndex = (currentMusicPage - 1) * MUSIC_PAGE_SIZE;
        const endIndex = Math.min(startIndex + MUSIC_PAGE_SIZE, totalSongs);
        const songsToRender = filteredMusicCatalog.slice(startIndex, endIndex);

        for (const song of songsToRender) {
            const meta = song.meta ?? {};
            const data = song.data ?? {};
            const row = document.createElement("tr");

            row.append(
                createMusicTitleCell(meta),
                createTextCell(meta.artist ?? ""),
                createTextCell(meta.genre ?? ""),
                createTextCell(meta.bpm ?? ""),
                createTextCell(meta.release ?? ""),
                createChartCell(data.BAS),
                createChartCell(data.ADV),
                createChartCell(data.EXP),
                createChartCell(data.MAS),
                createChartCell(data.ULT)
            );
            musicRecordsElement.append(row);
        }

        musicResultSummaryElement.textContent = (
            `${totalSongs.toLocaleString()} 首符合條件，`
            + `顯示第 ${(startIndex + 1).toLocaleString()}–${endIndex.toLocaleString()} 首`
        );
    }

    musicPageIndicatorElement.textContent = `第 ${currentMusicPage} / ${pageCount} 頁`;
    previousMusicPageButton.disabled = currentMusicPage <= 1;
    nextMusicPageButton.disabled = currentMusicPage >= pageCount;
}

function filterMusicCatalog() {
    const query = musicSearchInput.value.trim().toLocaleLowerCase("zh-TW");

    filteredMusicCatalog = query
        ? musicCatalog.filter(song => {
            const meta = song.meta ?? {};
            const searchableText = [
                meta.title,
                meta.artist,
                meta.genre,
                meta.id
            ]
                .filter(value => value !== null && value !== undefined)
                .join("\n")
                .toLocaleLowerCase("zh-TW");

            return searchableText.includes(query);
        })
        : [...musicCatalog];

    currentMusicPage = 1;
    renderMusicCatalog();
}

function setMusicCatalog(songs, source, savedAt) {
    musicCatalog = normalizeMusicCatalog(songs);
    musicSearchInput.disabled = false;
    musicSearchInput.value = "";
    filteredMusicCatalog = [...musicCatalog];
    currentMusicPage = 1;

    const sourceLabel = source === "network"
        ? "API 最新資料"
        : "LocalStorage 快取";
    musicCacheStatusElement.textContent = (
        `已從${sourceLabel}載入 ${musicCatalog.length.toLocaleString()} 首歌曲；`
        + `資料時間：${formatCacheTime(savedAt)}`
    );
    renderMusicCatalog();
}

function getRateLimitHeader(response, name) {
    return response.headers.get(`X-RateLimit-${name}`)
        ?? response.headers.get(`X-Rate-Limit-${name}`);
}

function getRateLimitMessage(response) {
    const remaining = getRateLimitHeader(response, "Remaining");
    const limit = getRateLimitHeader(response, "Limit");
    const reset = getRateLimitHeader(response, "Reset");

    if (!remaining) {
        return "";
    }

    const resetTime = Number(reset);
    const resetText = Number.isFinite(resetTime)
        ? `，重設時間：${formatCacheTime(resetTime * 1000)}`
        : "";

    return ` API 剩餘次數：${remaining}/${limit ?? "120"}${resetText}`;
}

async function refreshMusicCatalog() {
    refreshMusicButton.disabled = true;
    musicRequestStatusElement.classList.remove("error");
    musicRequestStatusElement.textContent = "正在從 chunirec API 刷新歌曲資料…";

    const url = new URL(MUSIC_API_URL);
    url.searchParams.set("region", "jp2");
    url.searchParams.set("token", MUSIC_API_TOKEN);

    try {
        const response = await fetch(url, {
            method: "GET",
            cache: "no-store",
            credentials: "omit"
        });
        const rateLimitMessage = getRateLimitMessage(response);

        if (!response.ok) {
            let apiMessage = "";

            try {
                const errorData = await response.json();
                apiMessage = errorData?.error?.message
                    ?? errorData?.message
                    ?? "";
            } catch {
                apiMessage = "";
            }

            throw new Error(apiMessage || `API 回應 HTTP ${response.status}`);
        }

        const songs = await response.json();

        if (!Array.isArray(songs)) {
            throw new Error("API 回傳的歌曲資料格式不正確");
        }

        const savedAt = saveMusicCatalogToCache(songs);
        setMusicCatalog(songs, "network", savedAt ?? Date.now());
        musicRequestStatusElement.textContent = savedAt
            ? `歌曲資料已刷新並保存至 LocalStorage。${rateLimitMessage}`
            : `歌曲資料已刷新，但 LocalStorage 儲存失敗。${rateLimitMessage}`;
        musicRequestStatusElement.classList.toggle("error", !savedAt);
    } catch (error) {
        console.error("刷新 chunirec 歌曲資料失敗：", error);
        musicRequestStatusElement.textContent = (
            `刷新失敗：${error instanceof Error ? error.message : String(error)}`
            + (musicCatalog.length > 0 ? "；目前繼續顯示快取資料。" : "")
        );
        musicRequestStatusElement.classList.add("error");
    } finally {
        refreshMusicButton.disabled = false;
    }
}

async function requestPersistentStorage() {
    if (!navigator.storage?.persist) {
        return;
    }

    try {
        await navigator.storage.persist();
    } catch (error) {
        console.warn("無法要求瀏覽器永久保存歌曲快取：", error);
    }
}

function loadCachedMusicCatalog() {
    const cache = loadMusicCatalogFromCache();

    if (!cache) {
        renderMusicCatalog();
        return false;
    }

    setMusicCatalog(cache.songs, "cache", cache.savedAt);
    return true;
}

refreshMusicButton.addEventListener("click", refreshMusicCatalog);
musicSearchInput.addEventListener("input", filterMusicCatalog);

previousMusicPageButton.addEventListener("click", () => {
    if (currentMusicPage <= 1) {
        return;
    }

    currentMusicPage -= 1;
    renderMusicCatalog();
});

nextMusicPageButton.addEventListener("click", () => {
    const pageCount = Math.max(
        1,
        Math.ceil(filteredMusicCatalog.length / MUSIC_PAGE_SIZE)
    );

    if (currentMusicPage >= pageCount) {
        return;
    }

    currentMusicPage += 1;
    renderMusicCatalog();
});

const hasCachedMusicCatalog = loadCachedMusicCatalog();
requestPersistentStorage();

if (!hasCachedMusicCatalog) {
    refreshMusicCatalog();
}
