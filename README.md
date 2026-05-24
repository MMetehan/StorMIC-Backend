# StorMIC Signaling Server

> **[English](#english) | [Türkçe](#türkçe)**
>
> ![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)

---

<a name="english"></a>

## English

### Overview

This is the WebSocket signaling server for StorMIC. Its only job is to help two peers find each other and exchange the connection metadata (SDP offers/answers and ICE candidates) needed to establish a direct WebRTC connection. Once peers are connected, this server is completely out of the loop — no audio, video, chat, or files pass through it.

**No message storage. No user accounts. No persistence of any kind.**  
All state is in-memory. When the last member leaves a channel, the channel is deleted.

The client is configured to connect to your own instance of this server. See [`StorMIC/README.md`](https://github.com/MMetehan/StorMIC/blob/main/README.md) for how to bake the URL into the client build via `.env`.

---

### How It Works

```
Client A ──ws──► Server ──ws──► Client B
         join/signal relay only

Once WebRTC is established:
Client A ◄──────── WebRTC P2P ────────► Client B
         (audio, video, chat, files)
```

1. Client connects via WebSocket and sends `join` with a channel code, username, and intent
2. Server adds the client to the channel, returns the list of existing peers
3. Clients exchange `signal` messages (SDP + ICE) through the server
4. Once WebRTC connects directly, the server only handles join/leave events
5. When a client disconnects, the server notifies remaining members via `peer-left`

---

### WebSocket Message Protocol

All messages are JSON.

#### Client → Server

| Message  | Fields                       | Description                                                         |
| -------- | ---------------------------- | ------------------------------------------------------------------- |
| `join`   | `code`, `username`, `intent` | Join or create a channel. `intent` is `"create"` or `"join"`        |
| `signal` | `to`, `data`                 | Relay a signal (offer, answer, or ICE candidate) to a specific peer |

#### Server → Client

| Message       | Fields         | Description                                                |
| ------------- | -------------- | ---------------------------------------------------------- |
| `peers`       | `peers[]`      | List of existing members on join (array of `{ username }`) |
| `peer-joined` | `username`     | A new peer joined the channel                              |
| `peer-left`   | `username`     | A peer disconnected                                        |
| `signal`      | `from`, `data` | A relayed signal from another peer                         |
| `error`       | `code`         | Error condition (see below)                                |

#### Error Codes

| Code                | Meaning                                                  |
| ------------------- | -------------------------------------------------------- |
| `CHANNEL_NOT_FOUND` | `intent: "join"` but the channel does not exist          |
| `USERNAME_TAKEN`    | The requested username is already in use in this channel |

---

### Running Locally

**Prerequisites:** Node.js ≥ 18

```bash
npm install
npm start           # production
npm run dev         # development (auto-restart on file changes)
```

The server listens on port `3000` by default. Override with the `PORT` environment variable:

```bash
PORT=8080 npm start
```

#### Health check

`GET /health` returns `200 OK` with body `ok`. Used by uptime monitors and platforms like Render.com.

---

### Environment Variables

| Variable | Default | Description           |
| -------- | ------- | --------------------- |
| `PORT`   | `3000`  | TCP port to listen on |

---

### Deploying Your Own Server

#### Option 1 — Render.com (recommended, free tier available)

A `render.yaml` is included for automatic deployment:

1. Fork or push this repository to GitHub
2. Go to [render.com](https://render.com) → **New** → **Blueprint**
3. Connect your GitHub repo — Render will detect `render.yaml` automatically
4. Click **Apply** — the server will be running in ~60 seconds
5. Copy the `.onrender.com` URL Render assigns to your service

Then set it as your signal URL in `client/.env`:

```
STORMIC_SIGNAL_URL=wss://your-service-name.onrender.com
```

> **Free tier note:** Render's free tier spins the service down after 15 minutes of inactivity. The StorMIC client handles this gracefully with exponential backoff reconnection. Upgrade to a paid instance to avoid cold starts.

#### Option 2 — Heroku

A `Procfile` is included:

```bash
heroku create your-app-name
git subtree push --prefix server heroku main
# or push the whole repo if Heroku is pointed at the server/ subdirectory
```

Then set your signal URL in `client/.env`:

```
STORMIC_SIGNAL_URL=wss://your-app-name.herokuapp.com
```

#### Option 3 — Any VPS or cloud server

```bash
# On your server
git clone <repo>
cd server
npm install
PORT=443 node index.js   # or use a process manager like PM2
```

Using a reverse proxy (nginx/Caddy) with a TLS certificate is strongly recommended so the URL is `wss://` rather than `ws://`. Browsers and Electron apps in production will refuse mixed-content WebSocket connections over plain `ws://` when the app was built expecting secure connections.

**Example nginx config:**

```nginx
server {
    listen 443 ssl;
    server_name signal.yourdomain.com;

    ssl_certificate     /etc/letsencrypt/live/signal.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/signal.yourdomain.com/privkey.pem;

    location / {
        proxy_pass         http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade $http_upgrade;
        proxy_set_header   Connection "upgrade";
        proxy_set_header   Host $host;
    }
}
```

Then set your signal URL in `client/.env`:

```
STORMIC_SIGNAL_URL=wss://signal.yourdomain.com
```

#### Option 4 — PM2 (process manager for always-on Node.js)

```bash
npm install -g pm2
pm2 start index.js --name stormic-server
pm2 save
pm2 startup   # auto-restart on server reboot
```

---

### Connecting the Client

Once your server is running, open `client/.env` and set:

```
STORMIC_SIGNAL_URL=wss://your-server-address
```

Then build the client:

```bash
cd ..          # project root
make win       # or make mac / make linux
```

See [`StorMIC/README.md`](https://github.com/MMetehan/StorMIC/blob/main/README.md) for the full build and `.env` setup guide.

---

### Dependencies

| Package | Version | Purpose          |
| ------- | ------- | ---------------- |
| `ws`    | ^8.18   | WebSocket server |

No database, no authentication, no external services.

---

### License

[MIT](LICENSE) © 2026 StorMIC

---

<br>
<br>

---

<a name="türkçe"></a>

## Türkçe

### Genel Bakış

Bu, StorMIC'in WebSocket sinyal sunucusudur. Tek görevi, iki kullanıcının birbirini bulmasına ve doğrudan WebRTC bağlantısı kurabilmek için gereken bağlantı meta verilerini (SDP teklif/yanıtları ve ICE adayları) paylaşmasına yardımcı olmaktır. Kullanıcılar birbirine bağlandıktan sonra bu sunucu tamamen devre dışı kalır — ses, video, sohbet veya dosyaların hiçbiri bu sunucudan geçmez.

**Mesaj depolama yok. Kullanıcı hesabı yok. Hiçbir kalıcı veri tutulmaz.**  
Tüm durum bellekte tutulur. Kanaldan son üye ayrıldığında kanal silinir.

İstemci, bu sunucunun kendi kurulumuna bağlanacak şekilde yapılandırılır. URL'yi istemci binary'sine `.env` aracılığıyla nasıl gömeceğini öğrenmek için [`StorMIC/README.md`](https://github.com/MMetehan/StorMIC/blob/main/README.md) dosyasına bak.

---

### Nasıl Çalışır

```
İstemci A ──ws──► Sunucu ──ws──► İstemci B
           yalnızca join/signal aktarımı

WebRTC bağlantısı kurulduktan sonra:
İstemci A ◄────── WebRTC P2P ──────► İstemci B
          (ses, video, sohbet, dosyalar)
```

1. İstemci WebSocket ile bağlanır ve `join` mesajı gönderir (kanal kodu, kullanıcı adı, niyet)
2. Sunucu istemciyi kanala ekler ve mevcut kullanıcı listesini döndürür
3. İstemciler SDP + ICE mesajlarını sunucu üzerinden birbirine iletir
4. WebRTC doğrudan bağlandıktan sonra sunucu yalnızca katılma/ayrılma olaylarını yönetir
5. İstemci bağlantısı kesildiğinde sunucu kalan üyelere `peer-left` ile bildirir

---

### WebSocket Mesaj Protokolü

Tüm mesajlar JSON formatındadır.

#### İstemci → Sunucu

| Mesaj    | Alanlar                      | Açıklama                                                           |
| -------- | ---------------------------- | ------------------------------------------------------------------ |
| `join`   | `code`, `username`, `intent` | Kanala katıl veya oluştur. `intent`: `"create"` veya `"join"`      |
| `signal` | `to`, `data`                 | Belirli bir kullanıcıya sinyal (teklif, yanıt veya ICE adayı) ilet |

#### Sunucu → İstemci

| Mesaj         | Alanlar        | Açıklama                                                         |
| ------------- | -------------- | ---------------------------------------------------------------- |
| `peers`       | `peers[]`      | Kanala katılınca mevcut üyelerin listesi (`{ username }` dizisi) |
| `peer-joined` | `username`     | Yeni bir kullanıcı kanala katıldı                                |
| `peer-left`   | `username`     | Bir kullanıcı bağlantısını kesti                                 |
| `signal`      | `from`, `data` | Başka bir kullanıcıdan iletilen sinyal                           |
| `error`       | `code`         | Hata durumu (aşağıya bakın)                                      |

#### Hata Kodları

| Kod                 | Anlam                                             |
| ------------------- | ------------------------------------------------- |
| `CHANNEL_NOT_FOUND` | `intent: "join"` ama kanal mevcut değil           |
| `USERNAME_TAKEN`    | İstenen kullanıcı adı bu kanalda zaten kullanımda |

---

### Yerel Çalıştırma

**Gereksinimler:** Node.js ≥ 18

```bash
npm install
npm start           # prodüksiyon
npm run dev         # geliştirme (dosya değişikliklerinde otomatik yeniden başlatma)
```

Sunucu varsayılan olarak `3000` portunu dinler. `PORT` ortam değişkeni ile geçersiz kılınabilir:

```bash
PORT=8080 npm start
```

#### Sağlık kontrolü

`GET /health` isteği `200 OK` ve `ok` gövdesi döner. Uptime monitörleri ve Render.com gibi platformlar tarafından kullanılır.

---

### Ortam Değişkenleri

| Değişken | Varsayılan | Açıklama             |
| -------- | ---------- | -------------------- |
| `PORT`   | `3000`     | Dinlenecek TCP portu |

---

### Kendi Sunucunu Kurma

#### Seçenek 1 — Render.com (önerilen, ücretsiz katman mevcut)

Otomatik deployment için `render.yaml` dahildir:

1. Bu repoyu GitHub'a fork'la veya push'la
2. [render.com](https://render.com) → **New** → **Blueprint** adımına git
3. GitHub reponla bağlan — Render `render.yaml`'ı otomatik algılar
4. **Apply**'a tıkla — sunucu ~60 saniyede çalışır hale gelir
5. Render'ın servisine atadığı `.onrender.com` URL'sini kopyala

Ardından `client/.env` dosyasına ekle:

```
STORMIC_SIGNAL_URL=wss://servis-adin.onrender.com
```

> **Ücretsiz katman notu:** Render'ın ücretsiz katmanı 15 dakika hareketsizlik sonrasında servisi kapatır. StorMIC istemcisi bunu üstel geri çekilmeli yeniden bağlanma ile sorunsuz yönetir. Soğuk başlatmayı önlemek için ücretli katmana geç.

#### Seçenek 2 — Heroku

`Procfile` dahildir:

```bash
heroku create uygulama-adin
git subtree push --prefix server heroku main
```

Ardından `client/.env` dosyasına ekle:

```
STORMIC_SIGNAL_URL=wss://uygulama-adin.herokuapp.com
```

#### Seçenek 3 — Herhangi bir VPS veya bulut sunucusu

```bash
# Sunucunda
git clone <repo>
cd server
npm install
PORT=443 node index.js   # veya PM2 gibi bir process manager kullan
```

TLS sertifikasıyla bir reverse proxy (nginx/Caddy) kullanmak şiddetle tavsiye edilir; böylece URL `ws://` yerine `wss://` olur. Üretim ortamındaki tarayıcılar ve Electron uygulamaları, güvenli bağlantı beklentisiyle oluşturulmuş olduklarında düz `ws://` üzerinden karma içerikli WebSocket bağlantılarını reddeder.

**Örnek nginx yapılandırması:**

```nginx
server {
    listen 443 ssl;
    server_name signal.alanadiniz.com;

    ssl_certificate     /etc/letsencrypt/live/signal.alanadiniz.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/signal.alanadiniz.com/privkey.pem;

    location / {
        proxy_pass         http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade $http_upgrade;
        proxy_set_header   Connection "upgrade";
        proxy_set_header   Host $host;
    }
}
```

Ardından `client/.env` dosyasına ekle:

```
STORMIC_SIGNAL_URL=wss://signal.alanadiniz.com
```

#### Seçenek 4 — PM2 (her zaman açık Node.js için process manager)

```bash
npm install -g pm2
pm2 start index.js --name stormic-server
pm2 save
pm2 startup   # sunucu yeniden başlatıldığında otomatik çalışma
```

---

### İstemciyi Bağlama

Sunucun çalışmaya başladıktan sonra `client/.env` dosyasını aç ve şunu gir:

```
STORMIC_SIGNAL_URL=wss://sunucu-adresin
```

Ardından istemcinin build'ini al:

```bash
cd ..          # proje kökü
make win       # veya make mac / make linux
```

Tam build ve `.env` kurulum kılavuzu için [`StorMIC/README.md`](https://github.com/MMetehan/StorMIC/blob/main/README.md) dosyasına bak.

---

### Bağımlılıklar

| Paket | Sürüm | Amaç               |
| ----- | ----- | ------------------ |
| `ws`  | ^8.18 | WebSocket sunucusu |

Veritabanı yok, kimlik doğrulama yok, harici servis yok.

---

### Lisans

[MIT](LICENSE) © 2026 StorMIC
