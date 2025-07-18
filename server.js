const http = require('http');
const WebSocket = require('ws');

// Port server HTTP
const PORT = process.env.PORT || 10000;

// Dữ liệu hiện tại
let currentData = {
    phien_truoc: null,
    ket_qua: "",
    Dice: [],
    phien_hien_tai: null,
    du_doan: "",
    do_tin_cay: "N/A",
    cau: "",
    ngay: "",
    Id: "@ghetvietcode - Rinkivana"
};

// Lịch sử pattern T/X dạng chuỗi (dùng để hiển thị 'cầu')
let patternHistory = "";
// Lịch sử kết quả dạng mảng (dùng cho thuật toán dự đoán mới)
let fullHistory = [];

/**
 * Cập nhật lịch sử và hiển thị cầu
 * @param {string} result - 't' hoặc 'x'
 */
function updatePatternHistory(result) {
    if (patternHistory.length >= 20) {
        patternHistory = patternHistory.slice(1);
    }
    patternHistory += result;
    currentData.cau = patternHistory;
}

/**
 * THUẬT TOÁN DỰ ĐOÁN MỚI
 * @param {string[]} history - Mảng lịch sử kết quả, ví dụ: ["Tài", "Xỉu", "Tài"]
 * @returns {string} - "Tài" hoặc "Xỉu"
 */
function predictNext(history) {
    // 1. Điều kiện khởi đầu
    if (history.length < 4) return history.at(-1) || "Tài";

    const last = history.at(-1);

    // 2. Cầu bệt (4 kết quả cuối giống nhau)
    if (history.slice(-4).every(k => k === last)) return last;

    // 3. Cầu 2-2 (ví dụ: Xỉu, Xỉu, Tài, Tài)
    if (
        history.length >= 4 &&
        history.at(-1) === history.at(-2) &&
        history.at(-3) === history.at(-4) &&
        history.at(-1) !== history.at(-3)
    ) {
        return last === "Tài" ? "Xỉu" : "Tài";
    }

    // 4. Cầu 1-2-1 (ví dụ: Tài, Xỉu, Xỉu, Tài)
    const last4 = history.slice(-4);
    if (last4[0] !== last4[1] && last4[1] === last4[2] && last4[2] !== last4[3]) {
        return last === "Tài" ? "Xỉu" : "Tài";
    }

    // 5. Cầu lặp 3-3 (ví dụ: T-X-T-T-X-T)
    const pattern = history.slice(-6, -3).toString();
    const latest = history.slice(-3).toString();
    if (pattern === latest) return history.at(-1);

    // 6. Quy tắc lỗi (sẽ không bao giờ chạy với chỉ 2 kết quả T/X)
    if (new Set(history.slice(-3)).size === 3) {
        return Math.random() < 0.5 ? "Tài" : "Xỉu";
    }

    // 7. Mặc định: Chống lại kết quả đa số
    const count = history.reduce((acc, val) => {
        acc[val] = (acc[val] || 0) + 1;
        return acc;
    }, {});
    // Sửa lỗi: thêm `|| 0` để tránh lỗi khi một bên chưa xuất hiện
    return (count["Tài"] || 0) > (count["Xỉu"] || 0) ? "Xỉu" : "Tài";
}


// Thông tin WebSocket
const WS_URL = "wss://websocket.atpman.net/websocket";
const HEADERS = {
    "Host": "websocket.atpman.net",
    "Origin": "https://play.789club.sx",
    "User-Agent": "Mozilla/5.0",
    "Accept-Encoding": "gzip, deflate, br, zstd",
    "Accept-Language": "vi-VN,vi;q=0.9",
    "Pragma": "no-cache",
    "Cache-Control": "no-cache"
};

let lastEventId = 19;

// Message đăng nhập + subscribe
const LOGIN_MESSAGE = [
    1, "MiniGame", "thatoidimoo11233", "112233",
    {
        info: JSON.stringify({
            ipAddress: "2405:4802:18c2:5990:3f0:c150:861d:5427",
            userId: "6ba5b041-a68d-4468-95d3-0bb2d8674512",
            username: "S8_thatoidimoo11233",
            timestamp: 1752497763866,
            refreshToken: "c6c49a4ff8ca49ac87fcaf2543a96221.6f17553681b74176a4ebeb77f475f443"
        }),
        signature: "5F953D843B438DD810A98D903AD3623CE98AED1745C3925EEAFD2A5BEB4D86A24ED0B97129E6AAB5DA1C3F73C2A236AE06D08EDDD937991260DFEA543E8F1C8818A651BDF4204E97A53F0461B306A95A6D7D56F435326270E9E4CB8084BB93969BFD4DB3CA8E519D079324E47110BCC23AB2139508D9E762407B76DE542D6E68"
    }
];

const SUBSCRIBE_TX_RESULT = [6, "MiniGame", "taixiuUnbalancedPlugin", { cmd: 2000 }];
const SUBSCRIBE_LOBBY = [6, "MiniGame", "lobbyPlugin", { cmd: 10001 }];

// Kết nối và xử lý WebSocket
function connectWebSocket() {
    const ws = new WebSocket(WS_URL, { headers: HEADERS });

    ws.on('open', () => {
        console.log("✅ Đã kết nối WebSocket");
        ws.send(JSON.stringify(LOGIN_MESSAGE));

        setTimeout(() => {
            ws.send(JSON.stringify(SUBSCRIBE_TX_RESULT));
            ws.send(JSON.stringify(SUBSCRIBE_LOBBY));
        }, 1000);

        setInterval(() => ws.send("2"), 10000);
        setInterval(() => ws.send(JSON.stringify(SUBSCRIBE_TX_RESULT)), 30000);
        setInterval(() => ws.send(JSON.stringify([7, "Simms", lastEventId, 0, { id: 0 }])), 15000);
    });

    ws.on('message', (msg) => {
        try {
            const data = JSON.parse(msg);

            if (Array.isArray(data)) {
                if (data[0] === 7 && data[1] === "Simms" && Number.isInteger(data[2])) {
                    lastEventId = data[2];
                }

                if (data[1]?.cmd === 2006) {
                    const { sid, d1, d2, d3 } = data[1];
                    const tong = d1 + d2 + d3;
                    const ketqua = tong >= 11 ? "Tài" : "Xỉu";
                    const diceArray = [d1, d2, d3];
                    
                    // Cập nhật lịch sử cho thuật toán mới
                    fullHistory.push(ketqua);
                    
                    // Cập nhật dữ liệu để trả về API
                    currentData.phien_truoc = currentData.phien_hien_tai;
                    currentData.phien_hien_tai = sid;
                    currentData.Dice = diceArray;
                    currentData.ket_qua = ketqua;

                    // Cập nhật chuỗi cầu để hiển thị
                    const resultTX = ketqua === "Tài" ? 't' : 'x';
                    updatePatternHistory(resultTX);

                    // Lấy dự đoán từ thuật toán mới
                    const duDoan = predictNext(fullHistory);
                    currentData.du_doan = duDoan;
                    currentData.ngay = new Date().toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });

                    console.log("🎲", currentData);
                }
            }
        } catch (err) {
            console.error("❌ Lỗi message:", err.message);
        }
    });

    ws.on('close', () => {
        console.log("🔌 WebSocket bị đóng. Kết nối lại sau 5s…");
        setTimeout(connectWebSocket, 5000);
    });

    ws.on('error', (err) => {
        console.error("❌ Lỗi WebSocket:", err.message);
    });
}

// HTTP server có hỗ trợ CORS cho https://tooltxwanin.site
const server = http.createServer((req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "https://tooltxwanin.site");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
    }

    if (req.url === "/taixiu") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(currentData));
    } else {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Không tìm thấy");
    }
});

// Khởi chạy server
server.listen(PORT, () => {
    console.log(`🌐 Server đang chạy tại http://localhost:${PORT}`);
    connectWebSocket();
});
