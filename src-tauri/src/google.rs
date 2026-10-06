use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use chrono::{Duration as Days, Utc};
use keyring::Entry;
use rand::{rngs::OsRng, RngCore};
use reqwest::{blocking::Client, redirect::Policy, StatusCode, Url};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    fs,
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex, MutexGuard,
    },
    thread,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, State};

const SCOPES: &str = "https://www.googleapis.com/auth/calendar.calendarlist.readonly https://www.googleapis.com/auth/calendar.events.readonly";
const TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
const CACHE_LIMIT: u64 = 4 * 1024 * 1024;
const SYNC_SECONDS: u64 = 600;
const CREDENTIAL_SERVICE: &str = "ClassDock.GoogleOAuth";

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoogleError {
    pub code: String,
    pub message: String,
}
type GResult<T> = Result<T, GoogleError>;
fn failure(code: &str, message: &str) -> GoogleError {
    GoogleError {
        code: code.into(),
        message: message.into(),
    }
}
fn network_error(_: reqwest::Error) -> GoogleError {
    failure("network", "无法连接 Google，请检查网络或代理后重试。")
}
// 密钥类型不实现 Debug，令牌不进入前端或日志。
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientConfig {
    client_id: String,
    #[serde(default)]
    client_secret: String,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Credentials {
    client: ClientConfig,
    #[serde(default)]
    refresh_token: Option<String>,
    #[serde(default)]
    connection_id: String,
}
struct AccessToken {
    value: String,
    expires: Instant,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarInfo {
    pub id: String,
    pub name: String,
    pub time_zone: String,
    pub primary: bool,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoogleSnapshot {
    pub calendar: CalendarInfo,
    pub events: Vec<Value>,
    pub last_sync_time: String,
    #[serde(default)]
    pub warning: Option<GoogleError>,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CacheFile {
    version: u8,
    connection_id: String,
    snapshot: GoogleSnapshot,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GoogleStatus {
    configured: bool,
    connected: bool,
    authorizing: bool,
    selected_calendar_id: Option<String>,
    last_sync_time: Option<String>,
    error: Option<GoogleError>,
}
#[derive(Default)]
struct Inner {
    last_attempt: Option<Instant>,
    credentials: Option<Credentials>,
    access: Option<AccessToken>,
    calendars: Vec<CalendarInfo>,
    cache: Option<GoogleSnapshot>,
    error: Option<GoogleError>,
}
pub struct GoogleService {
    inner: Mutex<Inner>,
    busy: AtomicBool,
    auth_pending: AtomicBool,
    generation: AtomicU64,
    http: Client,
    cache_path: PathBuf,
}
struct BusyGuard<'a>(&'a AtomicBool);
impl Drop for BusyGuard<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}
impl GoogleService {
    pub fn new(directory: PathBuf) -> Result<Self, std::io::Error> {
        let http = Client::builder()
            .https_only(true)
            .redirect(Policy::none())
            .timeout(Duration::from_secs(20))
            .connect_timeout(Duration::from_secs(10))
            .user_agent(concat!("ClassDock/", env!("CARGO_PKG_VERSION")))
            .build()
            .map_err(|_| std::io::Error::other("无法初始化 Google HTTPS 客户端"))?;
        let cache_path = directory.join("google-calendar-cache.json");
        let mut inner = Inner::default();
        match read_credentials() {
            Ok(credentials) => inner.credentials = credentials,
            Err(error) => inner.error = Some(error),
        }
        if let Some(credentials) = &inner.credentials {
            if credentials.refresh_token.is_some() {
                match read_cache(&cache_path, &credentials.connection_id) {
                    Ok(cache) => inner.cache = cache,
                    Err(error) => inner.error = Some(error),
                }
            }
        }
        Ok(Self {
            inner: Mutex::new(inner),
            busy: AtomicBool::new(false),
            auth_pending: AtomicBool::new(false),
            generation: AtomicU64::new(0),
            http,
            cache_path,
        })
    }
    fn lock(&self) -> GResult<MutexGuard<'_, Inner>> {
        self.inner
            .lock()
            .map_err(|_| failure("state", "Google 日历状态异常，请重启课程表。"))
    }
    fn begin(&self) -> GResult<BusyGuard<'_>> {
        self.busy
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .map_err(|_| failure("busy", "Google 操作正在进行，请稍后重试。"))?;
        Ok(BusyGuard(&self.busy))
    }
    fn check_generation(&self, generation: u64) -> GResult<()> {
        if self.generation.load(Ordering::SeqCst) != generation {
            return Err(failure("cancelled", "Google 操作已取消。"));
        }
        Ok(())
    }
    fn status(&self) -> GResult<GoogleStatus> {
        let inner = self.lock()?;
        Ok(GoogleStatus {
            configured: inner.credentials.is_some(),
            connected: inner
                .credentials
                .as_ref()
                .is_some_and(|c| c.refresh_token.is_some()),
            authorizing: self.auth_pending.load(Ordering::SeqCst),
            selected_calendar_id: inner.cache.as_ref().map(|c| c.calendar.id.clone()),
            last_sync_time: inner.cache.as_ref().map(|c| c.last_sync_time.clone()),
            error: inner.error.clone(),
        })
    }
    fn configure(&self, client: ClientConfig) -> GResult<GoogleStatus> {
        let busy = self.begin()?;
        let client = validate_client(client)?;
        let mut inner = self.lock()?;
        if inner
            .credentials
            .as_ref()
            .is_some_and(|c| c.refresh_token.is_some())
        {
            return Err(failure(
                "connected",
                "请先退出当前 Google 连接，再修改 OAuth 客户端。",
            ));
        }
        let credentials = Credentials {
            client,
            refresh_token: None,
            connection_id: String::new(),
        };
        write_credentials(&credentials)?;
        self.generation.fetch_add(1, Ordering::SeqCst);
        *inner = Inner {
            credentials: Some(credentials),
            ..Inner::default()
        };
        drop(inner);
        drop(busy);
        self.status()
    }
    fn connect(&self) -> GResult<GoogleStatus> {
        let busy = self.begin()?;
        self.auth_pending.store(true, Ordering::SeqCst);
        let auth_guard = BusyGuard(&self.auth_pending);
        let generation = self.generation.load(Ordering::SeqCst);
        let client = self
            .lock()?
            .credentials
            .as_ref()
            .ok_or_else(|| failure("configuration", "请先配置桌面 OAuth Client ID。"))?
            .client
            .clone();
        let listener = TcpListener::bind(("127.0.0.1", 0))
            .map_err(|_| failure("callback", "无法打开本地授权回调端口。"))?;
        listener
            .set_nonblocking(true)
            .map_err(|_| failure("callback", "无法初始化授权回调。"))?;
        let port = listener
            .local_addr()
            .map_err(|_| failure("callback", "无法读取回调端口。"))?
            .port();
        let redirect = format!("http://127.0.0.1:{port}/oauth2/callback");
        let state = random_string(32);
        let verifier = random_string(64);
        let url = authorization_url(&client.client_id, &redirect, &state, &verifier)?;
        open::that(url.as_str())
            .map_err(|_| failure("browser", "无法打开系统浏览器，请检查默认浏览器设置。"))?;
        let deadline = Instant::now() + Duration::from_secs(180);
        let mut code = None;
        let mut attempts = 0;
        while Instant::now() < deadline {
            self.check_generation(generation)?;
            match listener.accept() {
                Ok((mut stream, _)) => {
                    attempts += 1;
                    if attempts > 128 {
                        return Err(failure("callback", "授权回调请求过多，请重试。"));
                    }
                    match read_callback(&mut stream, port, &state) {
                        Ok(Callback::Code(value)) => {
                            respond(&mut stream, true);
                            code = Some(value);
                            break;
                        }
                        Ok(Callback::Denied) => {
                            respond(&mut stream, true);
                            return Err(failure(
                                "denied",
                                "你取消了 Google 授权，现有课程没有改动。",
                            ));
                        }
                        Err(_) => respond(&mut stream, false),
                    }
                }
                Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                    thread::sleep(Duration::from_millis(50))
                }
                Err(_) => return Err(failure("callback", "读取 Google 回调失败，请重试。")),
            }
        }
        let code =
            code.ok_or_else(|| failure("timeout", "Google 登录等待超过 3 分钟，请重新登录。"))?;
        self.check_generation(generation)?;
        let mut form = vec![
            ("client_id", client.client_id.as_str()),
            ("code", code.as_str()),
            ("code_verifier", verifier.as_str()),
            ("redirect_uri", redirect.as_str()),
            ("grant_type", "authorization_code"),
        ];
        if !client.client_secret.is_empty() {
            form.push(("client_secret", &client.client_secret));
        }
        let tokens = token_response(
            self.http
                .post(TOKEN_URL)
                .form(&form)
                .send()
                .map_err(network_error)?,
        )?;
        let refresh = tokens
            .refresh_token
            .clone()
            .filter(|s| !s.is_empty())
            .ok_or_else(|| {
                failure(
                    "token",
                    "未获得离线授权令牌，请重新登录并允许日历读取权限。",
                )
            })?;
        let mut inner = self.lock()?;
        self.check_generation(generation)?;
        let credentials = Credentials {
            client,
            refresh_token: Some(refresh),
            connection_id: random_string(32),
        };
        // 新连接使用独立标识，成功写入凭据后不再有可失败的数据切换步骤。
        write_credentials(&credentials)?;
        *inner = Inner {
            credentials: Some(credentials),
            access: Some(tokens.access()),
            ..Inner::default()
        };
        drop(inner);
        drop(auth_guard);
        drop(busy);
        self.status()
    }
    fn credentials(&self) -> GResult<Credentials> {
        self.lock()?
            .credentials
            .clone()
            .filter(|c| c.refresh_token.is_some())
            .ok_or_else(|| failure("login", "请先登录 Google 账号。"))
    }
    fn access(&self, credentials: &Credentials, generation: u64, force: bool) -> GResult<String> {
        if !force {
            if let Some(access) = &self.lock()?.access {
                if access.expires > Instant::now() + Duration::from_secs(60) {
                    return Ok(access.value.clone());
                }
            }
        }
        let credentials = {
            let inner = self.lock()?;
            self.check_generation(generation)?;
            inner
                .credentials
                .clone()
                .filter(|c| c.connection_id == credentials.connection_id)
                .ok_or_else(|| failure("cancelled", "Google 连接已更改，请重新操作。"))?
        };
        let refresh = credentials
            .refresh_token
            .as_deref()
            .ok_or_else(|| failure("login", "请重新登录 Google。"))?;
        let mut form = vec![
            ("client_id", credentials.client.client_id.as_str()),
            ("grant_type", "refresh_token"),
            ("refresh_token", refresh),
        ];
        if !credentials.client.client_secret.is_empty() {
            form.push(("client_secret", &credentials.client.client_secret));
        }
        let tokens = token_response(
            self.http
                .post(TOKEN_URL)
                .form(&form)
                .send()
                .map_err(network_error)?,
        )?;
        let value = tokens.access_token.clone();
        let mut inner = self.lock()?;
        self.check_generation(generation)?;
        if let Some(refresh) = &tokens.refresh_token {
            let mut updated = credentials.clone();
            updated.refresh_token = Some(refresh.clone());
            write_credentials(&updated)?;
            inner.credentials = Some(updated);
        }
        inner.access = Some(tokens.access());
        Ok(value)
    }
    fn get_json(&self, url: Url, credentials: &Credentials, generation: u64) -> GResult<Value> {
        self.check_generation(generation)?;
        let access = self.access(credentials, generation, false)?;
        let mut response = self
            .http
            .get(url.clone())
            .bearer_auth(access)
            .send()
            .map_err(network_error)?;
        if response.status() == StatusCode::UNAUTHORIZED {
            let access = self.access(credentials, generation, true)?;
            response = self
                .http
                .get(url)
                .bearer_auth(access)
                .send()
                .map_err(network_error)?;
        }
        if !response.status().is_success() {
            return Err(api_error(response.status()));
        }
        limited_json(response)
    }
    fn list(&self) -> GResult<Vec<CalendarInfo>> {
        let _busy = self.begin()?;
        let generation = self.generation.load(Ordering::SeqCst);
        let credentials = self.credentials()?;
        let mut calendars = Vec::new();
        let mut next: Option<String> = None;
        let mut seen = HashSet::new();
        let deadline = Instant::now() + Duration::from_secs(90);
        for _ in 0..20 {
            if Instant::now() > deadline {
                return Err(failure("timeout", "日历列表加载超时，请重试。"));
            }
            let mut url =
                Url::parse("https://www.googleapis.com/calendar/v3/users/me/calendarList")
                    .expect("固定 Google URL");
            url.query_pairs_mut().append_pair("maxResults", "250")
                .append_pair("fields", "items(id,summary,summaryOverride,timeZone,primary,accessRole,deleted),nextPageToken");
            if let Some(token) = &next {
                url.query_pairs_mut().append_pair("pageToken", token);
            }
            let value = self.get_json(url, &credentials, generation)?;
            calendars.extend(calendar_page(&value)?);
            if calendars.len() > 1000 {
                return Err(failure("limit", "Google 日历过多，暂只支持 1000 个日历。"));
            }
            next = page_token(&value, &mut seen)?;
            if next.is_none() {
                calendars.sort_by(|a, b| b.primary.cmp(&a.primary).then(a.name.cmp(&b.name)));
                let mut inner = self.lock()?;
                self.check_generation(generation)?;
                inner.calendars = calendars.clone();
                inner.error = None;
                return Ok(calendars);
            }
        }
        Err(failure("limit", "Google 日历分页超过限制，请稍后重试。"))
    }
    fn fetch_events(
        &self,
        calendar: &CalendarInfo,
        credentials: &Credentials,
        generation: u64,
    ) -> GResult<GoogleSnapshot> {
        let mut events = Vec::new();
        let mut next: Option<String> = None;
        let mut seen = HashSet::new();
        let min = (Utc::now() - Days::days(8)).to_rfc3339();
        let max = (Utc::now() + Days::days(91)).to_rfc3339();
        let deadline = Instant::now() + Duration::from_secs(120);
        for _ in 0..30 {
            if Instant::now() > deadline {
                return Err(failure("timeout", "Google 课程同步超时，请重试。"));
            }
            let mut url = events_url(&calendar.id)?;
            url.query_pairs_mut().append_pair("singleEvents", "true").append_pair("orderBy", "startTime")
                .append_pair("showDeleted", "false").append_pair("maxResults", "2500")
                .append_pair("timeMin", &min).append_pair("timeMax", &max)
                .append_pair("fields", "items(id,summary,status,start,end,location,description,recurringEventId),nextPageToken");
            if let Some(token) = &next {
                url.query_pairs_mut().append_pair("pageToken", token);
            }
            let value = self.get_json(url, credentials, generation)?;
            let items = response_items(&value)?;
            events.extend(items.iter().cloned());
            if events.len() > 5000 {
                return Err(failure(
                    "limit",
                    "Google 课程超过 5000 节，请选用单独的课程日历。",
                ));
            }
            next = page_token(&value, &mut seen)?;
            if next.is_none() {
                return Ok(GoogleSnapshot {
                    calendar: calendar.clone(),
                    events,
                    last_sync_time: Utc::now().to_rfc3339(),
                    warning: None,
                });
            }
        }
        Err(failure(
            "limit",
            "Google 课程分页超过限制，请缩小日历内容。",
        ))
    }
    fn store_snapshot(
        &self,
        snapshot: GoogleSnapshot,
        credentials: &Credentials,
        generation: u64,
    ) -> GResult<GoogleSnapshot> {
        let mut inner = self.lock()?;
        self.check_generation(generation)?;
        let cache = CacheFile {
            version: 1,
            connection_id: credentials.connection_id.clone(),
            snapshot: snapshot.clone(),
        };
        write_cache(&self.cache_path, &cache)?;
        inner.cache = Some(snapshot.clone());
        inner.error = None;
        Ok(snapshot)
    }
    fn select(&self, id: String) -> GResult<GoogleSnapshot> {
        let _busy = self.begin()?;
        let generation = self.generation.load(Ordering::SeqCst);
        let credentials = self.credentials()?;
        let calendar = self
            .lock()?
            .calendars
            .iter()
            .find(|c| c.id == id)
            .cloned()
            .ok_or_else(|| failure("selection", "请先刷新日历列表，然后选择可读取的日历。"))?;
        let snapshot = self.fetch_events(&calendar, &credentials, generation)?;
        // 新日历完整保存成功后才切换，失败时保留原选择与课程。
        self.store_snapshot(snapshot, &credentials, generation)
    }
    fn load(&self, force: bool) -> GResult<Option<GoogleSnapshot>> {
        let _busy = match self.begin() {
            Ok(guard) => guard,
            Err(_) if !force => return Ok(self.lock()?.cache.clone()),
            Err(error) => return Err(error),
        };
        let (cache, credentials, generation, recent_attempt) = {
            let inner = self.lock()?;
            let Some(credentials) = inner
                .credentials
                .clone()
                .filter(|c| c.refresh_token.is_some())
            else {
                return Ok(None);
            };
            let Some(cache) = inner.cache.clone() else {
                return Ok(None);
            };
            (
                cache,
                credentials,
                self.generation.load(Ordering::SeqCst),
                inner
                    .last_attempt
                    .is_some_and(|t| t.elapsed() < Duration::from_secs(SYNC_SECONDS)),
            )
        };
        if !force && (cache_fresh(&cache) || recent_attempt) {
            return Ok(Some(cache));
        }
        match self
            .fetch_events(&cache.calendar, &credentials, generation)
            .and_then(|snapshot| self.store_snapshot(snapshot, &credentials, generation))
        {
            Ok(snapshot) => Ok(Some(snapshot)),
            Err(error) => {
                let mut inner = self.lock()?;
                self.check_generation(generation)?;
                let mut offline = cache;
                offline.warning = Some(error.clone());
                inner.cache = Some(offline.clone());
                inner.error = Some(error);
                inner.last_attempt = Some(Instant::now());
                Ok(Some(offline))
            }
        }
    }
    fn disconnect(&self) -> GResult<GoogleStatus> {
        let _busy = self.begin()?;
        // 注销与登录和同步互斥，避免旧撤销请求使新登录的令牌失效。
        let mut inner = self.lock()?;
        self.generation.fetch_add(1, Ordering::SeqCst);
        let previous = inner.credentials.clone();
        if let Some(credentials) = &previous {
            let clean = Credentials {
                client: credentials.client.clone(),
                refresh_token: None,
                connection_id: String::new(),
            };
            write_credentials(&clean)?;
            *inner = Inner {
                credentials: Some(clean),
                ..Inner::default()
            };

            if let Err(error) = remove_cache(&self.cache_path) {
                inner.error = Some(error);
            }
        }
        drop(inner);
        if let Some(token) = previous.and_then(|c| c.refresh_token) {
            let revoked = self
                .http
                .post("https://oauth2.googleapis.com/revoke")
                .timeout(Duration::from_secs(8))
                .form(&[("token", token)])
                .send()
                .is_ok_and(|r| r.status().is_success());
            if !revoked {
                self.lock()?.error = Some(failure("revoke", "本机连接已退出；Google 端撤销未能确认，可在 Google 账号安全设置中移除 ClassDock 授权。"));
            }
        }
        self.status()
    }
}

fn validate_client(mut client: ClientConfig) -> GResult<ClientConfig> {
    client.client_id = client.client_id.trim().into();
    client.client_secret = client.client_secret.trim().into();
    if client.client_id.len() > 512
        || !client.client_id.ends_with(".apps.googleusercontent.com")
        || !client
            .client_id
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b".-_".contains(&c))
        || client.client_secret.len() > 1024
        || client.client_secret.contains(['\r', '\n'])
    {
        return Err(failure(
            "configuration",
            "请输入 Google Cloud 的桌面应用 Client ID，客户端密钥可选。",
        ));
    }
    Ok(client)
}
fn credential_entry() -> GResult<Entry> {
    Entry::new(CREDENTIAL_SERVICE, "desktop-client")
        .map_err(|_| failure("storage", "无法访问 Windows 凭据管理器。"))
}
fn read_credentials() -> GResult<Option<Credentials>> {
    match credential_entry()?.get_password() {
        Ok(text) => {
            let credentials: Credentials = serde_json::from_str(&text).map_err(|_| {
                failure("storage", "已保存的 Google 配置损坏，请在设置中重新配置。")
            })?;
            validate_client(credentials.client.clone())?;
            Ok(Some(credentials))
        }
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(_) => Err(failure("storage", "读取 Windows 凭据管理器失败。")),
    }
}
fn write_credentials(credentials: &Credentials) -> GResult<()> {
    let text = serde_json::to_string(credentials)
        .map_err(|_| failure("storage", "无法编码 Google 授权信息。"))?;
    credential_entry()?.set_password(&text).map_err(|_| {
        failure(
            "storage",
            "Google 授权未能保存到 Windows 凭据管理器，现有连接没有被覆盖。",
        )
    })
}
fn read_cache(path: &Path, connection: &str) -> GResult<Option<GoogleSnapshot>> {
    let file = match fs::File::open(path) {
        Ok(file) => file,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err(failure("cache", "Google 离线课程缓存无法读取。")),
    };
    let mut text = Vec::new();
    file.take(CACHE_LIMIT + 1)
        .read_to_end(&mut text)
        .map_err(|_| failure("cache", "Google 缓存读取失败。"))?;
    if text.len() as u64 > CACHE_LIMIT {
        return Err(failure("cache", "Google 缓存文件超过限制，请重新同步。"));
    }
    let cache: CacheFile = serde_json::from_slice(&text)
        .map_err(|_| failure("cache", "Google 缓存损坏，请重新选择日历。"))?;
    if cache.version != 1 || cache.connection_id != connection {
        return Ok(None);
    }
    if cache.snapshot.events.len() > 5000 {
        return Err(failure("cache", "Google 缓存课程数量异常。"));
    }
    Ok(Some(cache.snapshot))
}
fn write_cache(path: &Path, cache: &CacheFile) -> GResult<()> {
    let data =
        serde_json::to_vec(cache).map_err(|_| failure("cache", "Google 课程缓存编码失败。"))?;
    if data.len() as u64 > CACHE_LIMIT {
        return Err(failure(
            "limit",
            "Google 课程缓存超过 4 MB，请选用独立课程日历。",
        ));
    }
    fs::create_dir_all(
        path.parent()
            .ok_or_else(|| failure("cache", "缓存路径无效。"))?,
    )
    .map_err(|_| failure("cache", "无法创建 Google 缓存目录。"))?;
    let temporary = path.with_extension("tmp");
    fs::write(&temporary, data)
        .map_err(|_| failure("cache", "Google 缓存保存失败，可能空间不足。"))?;
    fs::rename(&temporary, path)
        .map_err(|_| failure("cache", "Google 缓存替换失败，原缓存仍保留。"))
}
fn remove_cache(path: &Path) -> GResult<()> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(_) => Err(failure("cache", "Google 缓存未能清除，请重试退出连接。")),
    }
}
fn cache_fresh(cache: &GoogleSnapshot) -> bool {
    chrono::DateTime::parse_from_rfc3339(&cache.last_sync_time).is_ok_and(|t| {
        let seconds = (Utc::now() - t.with_timezone(&Utc)).num_seconds();
        (0..SYNC_SECONDS as i64).contains(&seconds)
    })
}
fn random_string(bytes: usize) -> String {
    let mut data = vec![0; bytes];
    OsRng.fill_bytes(&mut data);
    URL_SAFE_NO_PAD.encode(data)
}
fn challenge(verifier: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}
fn authorization_url(client: &str, redirect: &str, state: &str, verifier: &str) -> GResult<Url> {
    let mut url = Url::parse("https://accounts.google.com/o/oauth2/v2/auth")
        .map_err(|_| failure("configuration", "授权地址无效。"))?;
    let challenge = challenge(verifier);
    url.query_pairs_mut().extend_pairs([
        ("client_id", client),
        ("redirect_uri", redirect),
        ("response_type", "code"),
        ("scope", SCOPES),
        ("state", state),
        ("code_challenge", &challenge),
        ("code_challenge_method", "S256"),
        ("access_type", "offline"),
        ("prompt", "consent select_account"),
    ]);
    Ok(url)
}
enum Callback {
    Code(String),
    Denied,
}
fn parse_callback(request: &str, port: u16, expected_state: &str) -> GResult<Callback> {
    let invalid = || failure("callback", "授权回调校验失败。");
    let mut lines = request.split("\r\n");
    let first = lines.next().ok_or_else(invalid)?;
    let parts: Vec<_> = first.split_whitespace().collect();
    if parts.len() != 3 || parts[0] != "GET" || !parts[2].starts_with("HTTP/1.") {
        return Err(invalid());
    }
    let host = format!("127.0.0.1:{port}");
    if !lines.any(|line| {
        line.split_once(':')
            .is_some_and(|(name, value)| name.eq_ignore_ascii_case("host") && value.trim() == host)
    }) {
        return Err(invalid());
    }
    let url = Url::parse(&format!("http://{host}{}", parts[1])).map_err(|_| invalid())?;
    if url.path() != "/oauth2/callback" || !parts[1].starts_with("/oauth2/callback?") {
        return Err(invalid());
    }
    let pairs: Vec<_> = url.query_pairs().collect();
    let states: Vec<_> = pairs.iter().filter(|(name, _)| name == "state").collect();
    if states.len() != 1 || !constant_equal(states[0].1.as_bytes(), expected_state.as_bytes()) {
        return Err(invalid());
    }
    let codes: Vec<_> = pairs.iter().filter(|(name, _)| name == "code").collect();
    let errors: Vec<_> = pairs.iter().filter(|(name, _)| name == "error").collect();
    if errors.len() == 1 && codes.is_empty() {
        return Ok(Callback::Denied);
    }
    if codes.len() != 1 || !errors.is_empty() || codes[0].1.is_empty() || codes[0].1.len() > 4096 {
        return Err(invalid());
    }
    Ok(Callback::Code(codes[0].1.to_string()))
}
fn constant_equal(left: &[u8], right: &[u8]) -> bool {
    if left.len() != right.len() {
        return false;
    }
    left.iter()
        .zip(right)
        .fold(0, |diff, (a, b)| diff | (a ^ b))
        == 0
}
fn read_callback(stream: &mut TcpStream, port: u16, state: &str) -> GResult<Callback> {
    stream
        .set_read_timeout(Some(Duration::from_secs(1)))
        .map_err(|_| failure("callback", "回调读取失败。"))?;
    let mut bytes = Vec::new();
    let mut buffer = [0u8; 1024];
    let deadline = Instant::now() + Duration::from_secs(2);
    while bytes.len() < 8192 && Instant::now() < deadline {
        let count = stream
            .read(&mut buffer)
            .map_err(|_| failure("callback", "回调读取超时。"))?;
        if count == 0 {
            break;
        }
        bytes.extend_from_slice(&buffer[..count]);
        if bytes.windows(4).any(|w| w == b"\r\n\r\n") {
            break;
        }
    }
    if bytes.len() >= 8192 {
        return Err(failure("callback", "回调请求过长。"));
    }
    let request = std::str::from_utf8(&bytes).map_err(|_| failure("callback", "回调编码无效。"))?;
    parse_callback(request, port, state)
}
fn respond(stream: &mut TcpStream, accepted: bool) {
    let _ = stream.set_write_timeout(Some(Duration::from_secs(1)));
    let body = if accepted {
        "<!doctype html><meta charset=utf-8><title>ClassDock</title><p>已收到授权结果。请返回 ClassDock 查看连接状态，可以关闭此页面。</p>"
    } else {
        "<!doctype html><meta charset=utf-8><title>ClassDock</title><p>此请求未通过授权校验。请返回 Google 登录页面继续操作。</p>"
    };
    let status = if accepted {
        "200 OK"
    } else {
        "400 Bad Request"
    };
    let response = format!("HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nCache-Control: no-store\r\nContent-Security-Policy: default-src 'none'; frame-ancestors 'none'\r\nConnection: close\r\n\r\n{body}", body.len());
    let _ = stream.write_all(response.as_bytes());
}
#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    token_type: String,
    expires_in: u64,
    refresh_token: Option<String>,
    scope: Option<String>,
}
impl TokenResponse {
    fn access(&self) -> AccessToken {
        AccessToken {
            value: self.access_token.clone(),
            expires: Instant::now() + Duration::from_secs(self.expires_in.min(86400)),
        }
    }
}
fn token_response(response: reqwest::blocking::Response) -> GResult<TokenResponse> {
    let status = response.status();
    let value = limited_json(response)?;
    if !status.is_success() {
        return Err(match value.get("error").and_then(Value::as_str) {
            Some("invalid_grant") => failure("login", "Google 授权已过期或被撤销，请重新登录。"),
            Some("invalid_client") | Some("unauthorized_client") => failure(
                "configuration",
                "OAuth 客户端配置不正确，请检查桌面 Client ID 和客户端密钥。",
            ),
            _ => api_error(status),
        });
    }
    validate_tokens(value)
}
fn validate_tokens(value: Value) -> GResult<TokenResponse> {
    let tokens: TokenResponse =
        serde_json::from_value(value).map_err(|_| failure("response", "Google 令牌响应无效。"))?;
    if tokens.access_token.is_empty()
        || tokens.access_token.len() > 8192
        || !tokens.token_type.eq_ignore_ascii_case("bearer")
        || tokens.expires_in < 60
        || tokens.expires_in > 86400
        || tokens
            .refresh_token
            .as_ref()
            .is_some_and(|s| s.is_empty() || s.len() > 2048)
    {
        return Err(failure("response", "Google 返回的访问令牌格式无效。"));
    }
    if let Some(scopes) = &tokens.scope {
        if !SCOPES
            .split_whitespace()
            .all(|required| scopes.split_whitespace().any(|scope| scope == required))
        {
            return Err(failure(
                "permission",
                "请允许读取日历列表与课程事件两项权限，然后重新登录。",
            ));
        }
    }
    Ok(tokens)
}
fn limited_json(response: reqwest::blocking::Response) -> GResult<Value> {
    let mut body = Vec::new();
    response
        .take(CACHE_LIMIT + 1)
        .read_to_end(&mut body)
        .map_err(|_| failure("network", "Google 响应读取中断，请重试。"))?;
    if body.len() as u64 > CACHE_LIMIT {
        return Err(failure("limit", "Google 响应超过大小限制。"));
    }
    serde_json::from_slice(&body)
        .map_err(|_| failure("response", "Google 返回了无效数据，请稍后重试。"))
}
fn api_error(status: StatusCode) -> GoogleError {
    match status.as_u16() {
        401 => failure("login", "Google 授权失效，请重新登录。"),
        403 => failure(
            "permission",
            "Google 拒绝读取：请检查 Calendar API 是否启用、日历读取权限和 Workspace 管理员限制。",
        ),
        404 => failure("calendar", "Google 日历已删除或无法访问，请重新选择日历。"),
        429 => failure("quota", "Google 请求频率受限，请稍后同步。"),
        500..=599 => failure("server", "Google 服务暂时不可用，稍后重试。"),
        _ => failure("request", "Google 请求失败，请检查配置后重试。"),
    }
}
fn page_token(value: &Value, seen: &mut HashSet<String>) -> GResult<Option<String>> {
    let Some(token) = value.get("nextPageToken") else {
        return Ok(None);
    };
    let token = token
        .as_str()
        .filter(|s| !s.is_empty() && s.len() <= 4096)
        .ok_or_else(|| failure("response", "Google 分页标识无效。"))?
        .to_owned();
    if !seen.insert(token.clone()) {
        return Err(failure("response", "Google 重复返回相同分页，已停止同步。"));
    }
    Ok(Some(token))
}
fn response_items(value: &Value) -> GResult<&[Value]> {
    if !value.is_object() {
        return Err(failure("response", "Google 响应格式无效。"));
    }
    match value.get("items") {
        None => Ok(&[]),
        Some(Value::Array(items)) => Ok(items),
        _ => Err(failure("response", "Google 响应列表格式无效。")),
    }
}
fn calendar_page(value: &Value) -> GResult<Vec<CalendarInfo>> {
    let items = response_items(value)?;
    let mut calendars = Vec::new();
    for item in items {
        if item.get("deleted").and_then(Value::as_bool) == Some(true)
            || item.get("accessRole").and_then(Value::as_str) == Some("freeBusyReader")
        {
            continue;
        }
        let id = item
            .get("id")
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty() && s.len() <= 2048)
            .ok_or_else(|| failure("response", "Google 日历标识无效。"))?;
        calendars.push(CalendarInfo {
            id: id.into(),
            name: item
                .get("summaryOverride")
                .or_else(|| item.get("summary"))
                .and_then(Value::as_str)
                .unwrap_or("未命名日历")
                .into(),
            time_zone: item
                .get("timeZone")
                .and_then(Value::as_str)
                .unwrap_or("UTC")
                .into(),
            primary: item
                .get("primary")
                .and_then(Value::as_bool)
                .unwrap_or(false),
        });
    }
    Ok(calendars)
}
fn events_url(calendar: &str) -> GResult<Url> {
    let mut url =
        Url::parse("https://www.googleapis.com/calendar/v3/calendars/").expect("固定 Google URL");
    url.path_segments_mut()
        .map_err(|_| failure("configuration", "事件地址无效。"))?
        .pop_if_empty()
        .push(calendar)
        .push("events");
    Ok(url)
}
fn notify(app: &AppHandle) {
    if app.emit("google-calendar-changed", ()).is_err() {
        eprintln!("Google 日历更新通知发送失败，请手动刷新课程表。");
    }
}
async fn blocking<T: Send + 'static>(
    task: impl FnOnce() -> GResult<T> + Send + 'static,
) -> GResult<T> {
    tauri::async_runtime::spawn_blocking(task)
        .await
        .map_err(|_| failure("task", "Google 后台任务异常，请重试。"))?
}
#[tauri::command]
pub async fn google_status(service: State<'_, Arc<GoogleService>>) -> GResult<GoogleStatus> {
    let service = service.inner().clone();
    blocking(move || service.status()).await
}
#[tauri::command]
pub async fn google_configure(
    client: ClientConfig,
    app: AppHandle,
    service: State<'_, Arc<GoogleService>>,
) -> GResult<GoogleStatus> {
    let service = service.inner().clone();
    let result = blocking(move || service.configure(client)).await?;
    notify(&app);
    Ok(result)
}
#[tauri::command]
pub async fn google_connect(
    app: AppHandle,
    service: State<'_, Arc<GoogleService>>,
) -> GResult<GoogleStatus> {
    let service = service.inner().clone();
    let result = blocking(move || service.connect()).await;
    notify(&app);
    result
}
#[tauri::command]
pub fn google_cancel(service: State<'_, Arc<GoogleService>>) -> GResult<()> {
    let _inner = service.lock()?;
    service.generation.fetch_add(1, Ordering::SeqCst);
    Ok(())
}
#[tauri::command]
pub async fn google_calendars(
    service: State<'_, Arc<GoogleService>>,
) -> GResult<Vec<CalendarInfo>> {
    let service = service.inner().clone();
    blocking(move || service.list()).await
}
#[tauri::command]
pub async fn google_select(
    calendar_id: String,
    app: AppHandle,
    service: State<'_, Arc<GoogleService>>,
) -> GResult<GoogleSnapshot> {
    let service = service.inner().clone();
    let result = blocking(move || service.select(calendar_id)).await;
    notify(&app);
    result
}
#[tauri::command]
pub async fn google_load(
    force: bool,
    app: AppHandle,
    service: State<'_, Arc<GoogleService>>,
) -> GResult<Option<GoogleSnapshot>> {
    let service = service.inner().clone();
    let result = blocking(move || service.load(force)).await;
    if force {
        notify(&app);
    }
    result
}
#[tauri::command]
pub async fn google_disconnect(
    app: AppHandle,
    service: State<'_, Arc<GoogleService>>,
) -> GResult<GoogleStatus> {
    let service = service.inner().clone();
    let result = blocking(move || service.disconnect()).await?;
    notify(&app);
    Ok(result)
}
pub fn start_sync(service: Arc<GoogleService>, app: AppHandle) {
    thread::spawn(move || loop {
        thread::sleep(Duration::from_secs(SYNC_SECONDS));
        match service.load(true) {
            Ok(Some(_)) => notify(&app),
            Ok(None) => (),
            Err(error) if error.code == "busy" => (),
            Err(_) => eprintln!("Google 后台同步未完成，可在设置中重试。"),
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn pkce_and_authorization_are_bound() {
        assert_eq!(
            challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
        let url = authorization_url(
            "fixture.apps.googleusercontent.com",
            "http://127.0.0.1:12345/oauth2/callback",
            "nonce",
            "verifier",
        )
        .unwrap_or_else(|_| panic!("授权URL"));
        assert_eq!(url.host_str(), Some("accounts.google.com"));
        let pairs: std::collections::HashMap<_, _> = url.query_pairs().collect();
        assert_eq!(pairs.get("state").map(|s| s.as_ref()), Some("nonce"));
        assert_eq!(
            pairs.get("code_challenge_method").map(|s| s.as_ref()),
            Some("S256")
        );
        assert!(!pairs.contains_key("client_secret"));
        assert_eq!(pairs.get("scope").map(|s| s.as_ref()), Some(SCOPES));
    }
    fn request(query: &str) -> String {
        format!("GET /oauth2/callback?{query} HTTP/1.1\r\nHost: 127.0.0.1:12345\r\n\r\n")
    }
    #[test]
    fn callback_requires_matching_state_host_path_and_one_code() {
        assert!(
            matches!(parse_callback(&request("state=nonce&code=one%2Ftwo"), 12345, "nonce"), Ok(Callback::Code(code)) if code == "one/two")
        );
        for invalid in [
            request("state=other&code=x"),
            request("state=nonce&state=nonce&code=x"),
            request("state=nonce&code=x&code=y"),
            request("state=nonce&code=x&error=denied"),
            request("state=nonce&code="),
            request("state=nonce&code=x").replace("127.0.0.1:12345", "attacker.example"),
            request("state=nonce&code=x").replace("GET", "POST"),
            request("state=nonce&code=x").replace("/oauth2/callback", "/other"),
        ] {
            assert!(parse_callback(&invalid, 12345, "nonce").is_err());
        }
        assert!(matches!(
            parse_callback(&request("state=nonce&error=access_denied"), 12345, "nonce"),
            Ok(Callback::Denied)
        ));
        assert!(parse_callback(&request("state=bad&error=access_denied"), 12345, "nonce").is_err());
    }
    #[test]
    fn permissions_token_limits_and_pagination_are_checked() {
        let token = json!({"access_token":"fixture", "token_type":"Bearer", "expires_in":3600, "scope":SCOPES});
        assert!(validate_tokens(token.clone()).is_ok());
        for (key, value) in [
            ("access_token", json!("")),
            ("token_type", json!("Basic")),
            ("expires_in", json!(1)),
            ("scope", json!("openid")),
        ] {
            let mut invalid = token.clone();
            invalid[key] = value;
            assert!(validate_tokens(invalid).is_err());
        }
        let mut seen = HashSet::new();
        let page = json!({"nextPageToken":"repeat"});
        assert!(page_token(&page, &mut seen).is_ok());
        assert!(page_token(&page, &mut seen).is_err());
        assert!(response_items(&json!({}))
            .unwrap_or_else(|_| panic!("空列表"))
            .is_empty());
        assert!(response_items(&json!({"items":null})).is_err());
    }
    #[test]
    fn calendar_ids_cannot_change_network_origin() {
        let url = events_url("https://evil.example/a?b#c").unwrap_or_else(|_| panic!("URL"));
        assert_eq!(url.host_str(), Some("www.googleapis.com"));
        assert!(url.query().is_none());
        assert!(url.fragment().is_none());
        assert!(url.path().contains("%2F"));
    }
    #[test]
    fn calendars_filter_deleted_and_freebusy() {
        let result = calendar_page(&json!({"items":[{"id":"keep","summary":"课程","timeZone":"Asia/Shanghai","primary":true},{"id":"gone","deleted":true},{"id":"busy","accessRole":"freeBusyReader"}]})).unwrap_or_else(|_| panic!("日历列表"));
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].id, "keep");
        assert!(result[0].primary);
    }
    #[test]
    fn disk_cache_isolated_by_connection_and_atomic_replacement() {
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../.tmp")
            .join(format!("google-test-{}.json", random_string(12)));
        let mut cache = CacheFile {
            version: 1,
            connection_id: "account-one".into(),
            snapshot: GoogleSnapshot {
                calendar: CalendarInfo {
                    id: "cal".into(),
                    name: "课程".into(),
                    time_zone: "UTC".into(),
                    primary: true,
                },
                events: vec![],
                last_sync_time: Utc::now().to_rfc3339(),
                warning: None,
            },
        };
        assert!(write_cache(&path, &cache).is_ok());
        assert!(read_cache(&path, "account-two")
            .unwrap_or_else(|_| panic!("读取"))
            .is_none());
        assert!(read_cache(&path, "account-one")
            .unwrap_or_else(|_| panic!("读取"))
            .is_some());
        cache.snapshot.calendar.id = "new-cal".into();
        assert!(write_cache(&path, &cache).is_ok());
        assert_eq!(
            read_cache(&path, "account-one")
                .unwrap_or_else(|_| panic!("读取"))
                .unwrap_or_else(|| panic!("缓存"))
                .calendar
                .id,
            "new-cal"
        );
        assert!(remove_cache(&path).is_ok());
    }
    #[test]
    fn busy_guard_and_generation_prevent_stale_commits() {
        let service = GoogleService {
            inner: Mutex::new(Inner::default()),
            busy: AtomicBool::new(false),
            auth_pending: AtomicBool::new(false),
            generation: AtomicU64::new(0),
            http: Client::new(),
            cache_path: PathBuf::from("unused"),
        };
        let guard = service.begin().unwrap_or_else(|_| panic!("guard"));
        assert!(service.begin().is_err());
        service.generation.fetch_add(1, Ordering::SeqCst);
        assert!(service.check_generation(0).is_err());
        drop(guard);
        assert!(service.begin().is_ok());
    }
}
