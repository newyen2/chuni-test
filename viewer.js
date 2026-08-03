"use strict";

const CHUNI_ORIGIN =
    "https://chunithm-net-eng.com";

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

        /*
         * 使用 textContent，不使用 innerHTML，
         * 避免歌曲名稱被當成 HTML。
         */
        titleCell.textContent =
            record.title ?? "";

        scoreCell.textContent =
            Number(record.score).toLocaleString();

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
        if (!chuniWindow || chuniWindow.closed) {
            setStatus(
                "請先使用上方按鈕開啟 CHUNITHM-NET。",
                true
            );
            return;
        }

        if (!bridgeReady) {
            setStatus(
                "尚未偵測到 bridge，但仍嘗試發送請求。"
            );
        } else {
            setStatus("正在取得 Master 成績……");
        }

        chuniWindow.postMessage(
            {
                source: "chuni-simple-viewer",
                action: "request",
                requestId: crypto.randomUUID(),
                payload: {
                    target: "allRecord",
                    difficulty: "MAS"
                }
            },
            CHUNI_ORIGIN
        );
    });

window.addEventListener("message", event => {
    /*
     * 只接受來自 CHUNITHM-NET 的訊息。
     */
    if (event.origin !== CHUNI_ORIGIN) {
        return;
    }

    /*
     * 若已經保存 CHUNITHM 視窗，
     * 也確認訊息來自該視窗。
     */
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
        message.source !== "chuni-simple-bridge"
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
                return;
            }

            if (!Array.isArray(message.data)) {
                setStatus(
                    "Bridge 回傳的資料格式不正確。",
                    true
                );
                return;
            }

            renderRecords(message.data);

            setStatus(
                `已取得 ${message.data.length} 筆 Master 成績。`
            );
            break;
    }
});