(() => {
    "use strict";

    // GitHub Pages 的 origin，不包含 repository path。
    const VIEWER_ORIGIN = "https://newyen2.github.io";
    const BRIDGE_SOURCE = "chuni-simple-bridge";
    const VIEWER_SOURCE = "chuni-simple-viewer";

    const DIFFICULTY_ENDPOINTS = Object.freeze({
        BAS: "sendBasic",
        ADV: "sendAdvanced",
        EXP: "sendExpert",
        MAS: "sendMaster",
        ULT: "sendUltima"
    });

    if (window.chuniSimpleBridgeInstalled) {
        console.log("CHUNI Simple Bridge 已經安裝。");
        return;
    }

    window.chuniSimpleBridgeInstalled = true;

    function getCookie(name) {
        for (const cookie of document.cookie.split(";")) {
            const separatorIndex = cookie.indexOf("=");

            if (separatorIndex === -1) {
                continue;
            }

            const rawKey = cookie.slice(0, separatorIndex).trim();
            const rawValue = cookie.slice(separatorIndex + 1);

            if (decodeURIComponent(rawKey) === name) {
                return decodeURIComponent(rawValue);
            }
        }

        return "";
    }

    function parseScore(scoreText) {
        const normalized = scoreText.replace(/,/g, "").trim();
        const score = Number(normalized);
        return Number.isFinite(score) ? score : -1;
    }

    function getClearStatus(iconArea) {
        if (!iconArea) {
            return { clear: "", clear2: "" };
        }

        const clear = iconArea.querySelector('img[src*="alljustice"]')
            ? "AJ"
            : iconArea.querySelector('img[src*="fullcombo"]')
                ? "FC"
                : "";

        let clear2 = "";

        if (iconArea.querySelector('img[src*="catastrophy"]')) {
            clear2 = "CTS";
        } else if (iconArea.querySelector('img[src*="brave"]')) {
            clear2 = "BRV";
        } else if (iconArea.querySelector('img[src*="absolute"]')) {
            clear2 = "ABS";
        } else if (iconArea.querySelector('img[src*="hard"]')) {
            clear2 = "HRD";
        } else if (iconArea.querySelector('img[src*="clear"]')) {
            clear2 = "CLR";
        }

        return { clear, clear2 };
    }

    async function fetchRecords(difficulty) {
        const endpoint = DIFFICULTY_ENDPOINTS[difficulty];

        if (!endpoint) {
            throw new Error(`不支援的難度：${difficulty}`);
        }

        const token = getCookie("_t");

        if (!token) {
            throw new Error("找不到 _t Token，請確認已登入。");
        }

        const formData = new FormData();
        formData.append("genre", "99");
        formData.append("token", token);

        const response = await fetch(
            `/mobile/record/musicGenre/${endpoint}`,
            {
                method: "POST",
                body: formData,
                credentials: "same-origin",
                headers: {
                    "Cache-Control": "no-cache"
                }
            }
        );

        if (response.status === 405 || response.status === 503) {
            throw new Error(`伺服器暫時無法處理，HTTP ${response.status}`);
        }

        if (!response.ok) {
            throw new Error(`請求失敗，HTTP ${response.status}`);
        }

        if (response.url.includes("/error")) {
            throw new Error("CHUNITHM-NET 回傳錯誤頁面。");
        }

        const html = await response.text();
        const documentResult = new DOMParser().parseFromString(html, "text/html");
        const containers = documentResult.querySelectorAll(".box01.w420");
        const recordContainer = containers[1];

        if (!recordContainer) {
            throw new Error("回傳頁面中找不到成績區塊。");
        }

        const forms = Array.from(recordContainer.querySelectorAll("form"));

        return forms
            .map(form => {
                const title = form.querySelector(".music_title")
                    ?.textContent
                    ?.trim() ?? "";
                const scoreText = form.querySelector(".text_b")?.textContent ?? "";
                const iconArea = form.querySelector(".play_musicdata_icon");
                const { clear, clear2 } = getClearStatus(iconArea);
                const idx = form.querySelector('input[name="idx"]')?.value ?? "";

                return {
                    title,
                    score: parseScore(scoreText),
                    difficulty,
                    clear,
                    clear2,
                    idx
                };
            })
            .filter(record => record.title);
    }

    function sendMessage(targetWindow, targetOrigin, message) {
        targetWindow?.postMessage(
            {
                source: BRIDGE_SOURCE,
                ...message
            },
            targetOrigin
        );
    }

    window.addEventListener("message", async event => {
        if (event.origin !== VIEWER_ORIGIN) {
            return;
        }

        const message = event.data;

        if (
            !message ||
            typeof message !== "object" ||
            message.source !== VIEWER_SOURCE ||
            message.action !== "request" ||
            message.payload?.target !== "allRecord"
        ) {
            return;
        }

        const difficulty = message.payload?.difficulty;

        if (!DIFFICULTY_ENDPOINTS[difficulty]) {
            sendMessage(event.source, event.origin, {
                action: "response",
                requestId: message.requestId,
                difficulty,
                ok: false,
                error: `不支援的難度：${difficulty}`
            });
            return;
        }

        try {
            const records = await fetchRecords(difficulty);

            sendMessage(event.source, event.origin, {
                action: "response",
                requestId: message.requestId,
                difficulty,
                ok: true,
                data: records
            });
        } catch (error) {
            console.error(error);

            sendMessage(event.source, event.origin, {
                action: "response",
                requestId: message.requestId,
                difficulty,
                ok: false,
                error: error instanceof Error ? error.message : String(error)
            });
        }
    });

    if (window.opener && !window.opener.closed) {
        sendMessage(window.opener, VIEWER_ORIGIN, {
            action: "ready"
        });
    }

    console.log("CHUNI Simple Bridge 已安裝。");
})();
