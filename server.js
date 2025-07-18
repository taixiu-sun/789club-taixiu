const express = require('express');
const cors = require('cors');
const WebSocket = require('ws');

const app = express();

const allowedOrigins = [
  'https://tooltxwanin.site',
  'http://localhost:3000'
];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('CORS không được phép'));
    }
  }
}));

// Dữ liệu hiển thị ra frontend
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

let history = [];
let lastEventId = 19;

// Hàm dự đoán kết quả tiếp theo
function predictNext(history) {
  if (history.length < 4) return history.at(-1) || "Tài";

  const last = history.at(-1);
  if (history.slice(-4).every(k => k === last)) return last;

  if (
    history.length >= 4 &&
    history.at(-1) === history.at(-2) &&
    history.at(-3) === history.at(-4) &&
    history.at(-1) !== history.at(-3)
  ) {
    return last === "Tài" ? "Xỉu" : "Tài";
  }

  const last4 = history.slice(-4);
  if (last4[0] !== last4[1] && last4[1] === last4[2] && last4[2] !== last4[3]) {
    return last === "Tài" ? "Xỉu" : "Tài";
  }

  const pattern = history.slice(-6, -3).toString();
  const latest = history.slice(-3).toString();
  if (pattern === latest) return history.at(-1);

  if (new Set(history.slice(-3)).size === 3) {
    return Math.random() < 0.5 ? "Tài" : "Xỉu";
  }

  const count = history.reduce((acc, val) => {
    acc[val] = (acc[val] || 0) + 1;
    return acc;
  }, {});

  return (count["Tài"] || 0) > (count["Xỉu"] || 0) ? "Xỉu" : "Tài";
}

// Gói tin WebSocket
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

function connectWebSocket() {
  const ws = new WebSocket("wss://websocket.atpman.net/websocket", {
    headers: {
      "Host": "websocket.atpman.net",
      "Origin": "https://play.789club.sx",
      "User-Agent": "Mozilla/5.0"
    }
  });

  ws.on('open', () => {
    console.log("[WS] Đã kết nối.");
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

          history.push(ketqua);
          if (history.length > 100) history.shift();

          const prediction = predictNext(history);
          const dateVN = new Date().toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });

          currentData = {
            phien_truoc: sid,
            ket_qua: ketqua,
            Dice: [d1, d2, d3],
            phien_hien_tai: sid + 1,
            du_doan: prediction,
            do_tin_cay: "N/A",
            cau: history.slice(-10).map(k => k === "Tài" ? "T" : "X").join(''),
            ngay: dateVN,
            Id: "@ghetvietcode - Rinkivana"
          };

          console.log(`[✔️] Phiên ${sid} → ${ketqua} | Dự đoán tiếp: ${prediction}`);
        }
      }
    } catch (err) {
      console.error("[ERR] Không đọc được tin nhắn:", err.message);
    }
  });

  ws.on('close', () => {
    console.log("[WS] Mất kết nối. Thử lại sau 3s...");
    setTimeout(connectWebSocket, 3000);
  });

  ws.on('error', (err) => {
    console.error("[WS] Lỗi:", err.message);
    ws.close();
  });
}

// ✅ Route API
app.get('/api/taixiu', (req, res) => {
  res.json(currentData);
});

app.get('/', (req, res) => {
  res.send(`<h2>789Club API</h2><p>Server đang hoạt động!</p><a href="/api/taixiu">Xem dữ liệu JSON</a>`);
});

// ✅ Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`[INFO] Server chạy tại cổng ${PORT}`);
  connectWebSocket();
});
