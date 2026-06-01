const http = require('http');
const { WebSocketServer } = require('ws');

const PORT              = process.env.PORT || 3000;
const MAX_CHANNEL_PEERS = Number(process.env.MAX_CHANNEL_PEERS) || 16;

// ── ICE sunucu yapılandırması (env override destekli) ──────────
const ICE_SERVERS = (() => {
  const list = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
  ];
  const turnUrl  = process.env.TURN_URL;
  const turnUser = process.env.TURN_USERNAME;
  const turnCred = process.env.TURN_CREDENTIAL;
  if (turnUrl && turnUser && turnCred) {
    list.push({ urls: turnUrl.split(','), username: turnUser, credential: turnCred });
  } else {
    // Açık röle — üretim ortamında kendi TURN sunucunuzu kullanın
    list.push({
      urls: [
        'turn:openrelay.metered.ca:80',
        'turn:openrelay.metered.ca:443',
        'turns:openrelay.metered.ca:443',
      ],
      username:   'openrelayproject',
      credential: 'openrelayproject',
    });
  }
  return list;
})();

// ── HTTP sunucusu ─────────────────────────────────────────────
const httpServer = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', channels: channels.size, peers: totalPeers }));
    return;
  }

  if (req.url === '/config') {
    // İstemciler bağlantı kurmadan önce bu endpoint'i çekerek ICE yapılandırmasını alır.
    // TURN kimlik bilgileri sunucu üzerinden yönetildiğinden istemciyi yeniden derlemek gerekmez.
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ iceServers: ICE_SERVERS }));
    return;
  }

  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ server: httpServer });

// channelCode -> Set<ws>
const channels = new Map();
let totalPeers = 0; // /health için ayrı sayaç tutulur, Map iterate etmek yerine

// Boş kanallar için silinme zamanlayıcıları (30 saniyelik tolerans)
const channelCleanupTimers = new Map();

function broadcast(channel, message, exclude = null) {
  const members = channels.get(channel);
  if (!members) return;
  const data = JSON.stringify(message);
  for (const client of members) {
    if (client !== exclude && client.readyState === 1) {
      client.send(data);
    }
  }
}

// ── Heartbeat: her 10 saniyede ping → yanıt gelmezse bağlantı kapat ──────────
const PING_INTERVAL = 10_000;

const heartbeat = setInterval(() => {
  wss.clients.forEach(ws => {
    if (!ws.isAlive) {
      ws.terminate();
      return;
    }
    ws.isAlive = false;
    ws.ping();
  });
}, PING_INTERVAL);

wss.on('close', () => clearInterval(heartbeat));

wss.on('connection', (ws) => {
  ws.channelCode = null;
  ws.username    = null;
  ws.isAlive     = true;

  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    switch (msg.type) {
      case 'join': {
        const { code, username, intent } = msg;
        if (!code || !username) return;

        // Zaten başka bir kanaldaysa önce oradan çıkar (yeniden bağlanma race'i)
        if (ws.channelCode && ws.channelCode !== code) {
          const oldMembers = channels.get(ws.channelCode);
          if (oldMembers) {
            oldMembers.delete(ws);
            console.log(`[${ws.channelCode}] ${ws.username} moved to another channel (${oldMembers.size} remaining)`);
            if (oldMembers.size === 0) {
              channels.delete(ws.channelCode);
            } else {
              broadcast(ws.channelCode, { type: 'peer-left', username: ws.username });
            }
          }
          ws.channelCode = null;
          ws.username    = null;
        }

        // 'join' niyetinde kanal yoksa hata döndür
        if (intent === 'join' && !channels.has(code)) {
          ws.send(JSON.stringify({ type: 'error', code: 'CHANNEL_NOT_FOUND' }));
          return;
        }

        if (!channels.has(code)) channels.set(code, new Set());
        const members = channels.get(code);

        // Kanal kapasitesi kontrolü
        if (members.size >= MAX_CHANNEL_PEERS) {
          ws.send(JSON.stringify({ type: 'error', code: 'CHANNEL_FULL' }));
          return;
        }

        // Bu kanal için bekleyen temizleme zamanlayıcısını iptal et
        if (channelCleanupTimers.has(code)) {
          clearTimeout(channelCleanupTimers.get(code));
          channelCleanupTimers.delete(code);
        }

        // Aynı kullanıcı adı kontrolü: ölü bağlantıysa temizle, canlıysa hata ver
        const stale = [...members].find(m => m.username === username);
        if (stale) {
          if (stale.readyState === 1) {
            ws.send(JSON.stringify({ type: 'error', code: 'USERNAME_TAKEN' }));
            return;
          }
          members.delete(stale);
        }

        ws.channelCode = code;
        ws.username = username;

        const peers = [];
        for (const m of members) peers.push({ username: m.username });
        ws.send(JSON.stringify({ type: 'peers', peers }));

        members.add(ws);
        totalPeers++;
        broadcast(code, { type: 'peer-joined', username }, ws);
        console.log(`[${code}] ${username} joined (${members.size}/${MAX_CHANNEL_PEERS})`);
        break;
      }

      case 'signal': {
        const { to, data } = msg;
        const members = channels.get(ws.channelCode);
        if (!members) return;
        for (const m of members) {
          if (m.username === to) {
            m.send(JSON.stringify({ type: 'signal', from: ws.username, data }));
            break;
          }
        }
        break;
      }
    }
  });

  ws.on('close', () => {
    const { channelCode, username } = ws;
    if (!channelCode) return;

    const members = channels.get(channelCode);
    if (!members) return;

    members.delete(ws);
    totalPeers = Math.max(0, totalPeers - 1);
    console.log(`[${channelCode}] ${username} left (${members.size} remaining)`);

    if (members.size === 0) {
      const t = setTimeout(() => {
        if (channels.get(channelCode)?.size === 0) {
          channels.delete(channelCode);
          console.log(`[${channelCode}] Channel destroyed (empty)`);
        }
        channelCleanupTimers.delete(channelCode);
      }, 30_000);
      channelCleanupTimers.set(channelCode, t);
    } else {
      broadcast(channelCode, { type: 'peer-left', username });
    }
  });
});

httpServer.listen(PORT, () => {
  console.log(`StorMIC signaling server running on port ${PORT}`);
});

// ── Graceful shutdown (BUG-10) ────────────────────────────────
function gracefulShutdown(signal) {
  console.log(`\n[${signal}] Shutting down gracefully...`);
  channelCleanupTimers.forEach(t => clearTimeout(t));
  channelCleanupTimers.clear();
  clearInterval(heartbeat);
  wss.clients.forEach(ws => ws.close(1001, 'Server shutting down'));
  wss.close(() => {
    httpServer.close(() => {
      console.log('Server closed.');
      process.exit(0);
    });
  });
  // Force exit if graceful shutdown hangs
  setTimeout(() => process.exit(1), 5000);
}
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT',  () => gracefulShutdown('SIGINT'));
