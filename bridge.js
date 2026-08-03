(() => {
    "use strict";

    /*
     * 必須改成你的 GitHub Pages origin。
     * 不要加入 /repository-name。
     */
    const VIEWER_ORIGIN =
        "https://newyen2.github.io";

    const BRIDGE_SOURCE =
        "chuni-simple-bridge";

    const VIEWER_SOURCE =
        "chuni-simple-viewer";

    /*
     * 防止同一頁重複執行。
     */
    if (window.chuniSimpleBridgeInstalled) {
        console.log(
            "CHUNI Simple Bridge 已經啟動。"
        );
        return;
    }

    window.chuniSimpleBridgeInstalled = true;

    function getCookie(name) {
        for (
            const cookie of
            document.cookie.split(";")
        ) {
            const separatorIndex =
                cookie.indexOf("=");

            if (separatorIndex === -1) {
                continue;
            }

            const rawKey = cookie
                .slice(0, separatorIndex)
                .trim();

            const rawValue = cookie
                .slice(separatorIndex + 1);

            if (
                decodeURIComponent(rawKey) === name
            ) {
                return decodeURIComponent(rawValue);
            }
        }

        return "";
    }

    function parseScore(scoreText) {
        const normalized = scoreText
            .replace(/,/g, "")
            .trim();

        const score = Number(normalized);

        return Number.isFinite(score)
            ? score
            : -1;
    }

    function getClearStatus(iconArea) {
        if (!iconArea) {
            return {
                clear: "",
                clear2: ""
            };
        }

        const clear =
            iconArea.querySelector(
                'img[src*="alljustice"]'
            )
                ? "AJ"
                : iconArea.querySelector(
                    'img[src*="fullcombo"]'
                )
                    ? "FC"
                    : "";

        let clear2 = "";

        if (
            iconArea.querySelector(
                'img[src*="catastrophy"]'
            )
        ) {
            clear2 = "CTS";
        } else if (
            iconArea.querySelector(
                'img[src*="brave"]'
            )
        ) {
            clear2 = "BRV";
        } else if (
            iconArea.querySelector(
                'img[src*="absolute"]'
            )
        ) {
            clear2 = "ABS";
        } else if (
            iconArea.querySelector(
                'img[src*="hard"]'
            )
        ) {
            clear2 = "HRD";
        } else if (
            iconArea.querySelector(
                'img[src*="clear"]'
            )
        ) {
            clear2 = "CLR";
        }

        return {
            clear,
            clear2
        };
    }

    async function fetchMasterRecords() {
        const token = getCookie("_t");

        if (!token) {
            throw new Error(
                "找不到 _t Token，請確認已登入。"
            );
        }

        const formData = new FormData();

        formData.append("genre", "99");
        formData.append("token", token);

        const response = await fetch(
            "/mobile/record/musicGenre/sendMaster",
            {
                method: "POST",
                body: formData,
                credentials: "same-origin",
                headers: {
                    "Cache-Control": "no-cache"
                }
            }
        );

        if (
            response.status === 405 ||
            response.status === 503
        ) {
            throw new Error(
                `服務暫時不可用：HTTP ${response.status}`
            );
        }

        if (!response.ok) {
            throw new Error(
                `請求失敗：HTTP ${response.status}`
            );
        }

        if (response.url.includes("/error")) {
            throw new Error(
                "CHUNITHM-NET 拒絕了請求。"
            );
        }

        const html = await response.text();

        const documentResult =
            new DOMParser().parseFromString(
                html,
                "text/html"
            );

        const containers =
            documentResult.querySelectorAll(
                ".box01.w420"
            );

        const recordContainer =
            containers[1];

        if (!recordContainer) {
            throw new Error(
                "回傳頁面中找不到成績列表。"
            );
        }

        const forms = Array.from(
            recordContainer.querySelectorAll("form")
        );

        return forms
            .map(form => {
                const title =
                    form.querySelector(
                        ".music_title"
                    )?.textContent
                        ?.trim() ?? "";

                const scoreText =
                    form.querySelector(
                        ".text_b"
                    )?.textContent ?? "";

                const iconArea =
                    form.querySelector(
                        ".play_musicdata_icon"
                    );

                const {
                    clear,
                    clear2
                } = getClearStatus(iconArea);

                const idx =
                    form.querySelector(
                        'input[name="idx"]'
                    )?.value ?? "";

                return {
                    title,
                    score:
                        parseScore(scoreText),
                    difficulty: "MAS",
                    clear,
                    clear2,
                    idx
                };
            })
            .filter(record => record.title);
    }

    function sendMessage(
        targetWindow,
        targetOrigin,
        message
    ) {
        targetWindow?.postMessage(
            {
                source: BRIDGE_SOURCE,
                ...message
            },
            targetOrigin
        );
    }

    window.addEventListener(
        "message",
        async event => {
            /*
             * 最重要的安全檢查：
             * 只接受自己的 GitHub Pages。
             */
            if (
                event.origin !== VIEWER_ORIGIN
            ) {
                return;
            }

            const message = event.data;

            if (
                !message ||
                typeof message !== "object" ||
                message.source !== VIEWER_SOURCE ||
                message.action !== "request"
            ) {
                return;
            }

            if (
                message.payload?.target !==
                "allRecord"
            ) {
                return;
            }

            if (
                message.payload?.difficulty !==
                "MAS"
            ) {
                return;
            }

            const requestId =
                message.requestId;

            try {
                const records =
                    await fetchMasterRecords();

                sendMessage(
                    event.source,
                    event.origin,
                    {
                        action: "response",
                        requestId,
                        ok: true,
                        data: records
                    }
                );
            } catch (error) {
                console.error(error);

                sendMessage(
                    event.source,
                    event.origin,
                    {
                        action: "response",
                        requestId,
                        ok: false,
                        error:
                            error instanceof Error
                                ? error.message
                                : String(error)
                    }
                );
            }
        }
    );

    /*
     * 告訴 opener：bridge 已經啟動。
     */
    if (
        window.opener &&
        !window.opener.closed
    ) {
        sendMessage(
            window.opener,
            VIEWER_ORIGIN,
            {
                action: "ready"
            }
        );
    }

    console.log(
        "CHUNI Simple Bridge 已啟動。"
    );
})();