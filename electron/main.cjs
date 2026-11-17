const { app, BrowserWindow, dialog, Menu, nativeTheme, session, shell } = require("electron");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");
const { spawn } = require("node:child_process");

const APP_ID = "com.agora.debate";
const AMBIENT_PROVIDER_ENV = [
  "AGORA_LLM_API_KEY",
  "AGORA_LLM_BASE_URL",
  "AGORA_LLM_MODEL",
  "AGORA_LLM_REASONING_EFFORT",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "OPENAI_MODEL",
  "DEEPSEEK_API_KEY",
  "OPENROUTER_API_KEY"
];

const EXTERNAL_HOSTS = new Set(["argdown.org", "www.argdown.org"]);

function isSameAppOrigin(url, appOrigin) {
  try {
    return new URL(url).origin === appOrigin;
  } catch {
    return false;
  }
}

function isAllowedExternal(url) {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === "https:" &&
      !parsed.username &&
      !parsed.password &&
      EXTERNAL_HOSTS.has(parsed.hostname.toLowerCase())
    );
  } catch {
    return false;
  }
}

function openAllowedExternal(url) {
  if (!isAllowedExternal(url)) return;
  void shell.openExternal(url).catch(() => undefined);
}

app.setName("Agora");
app.setAppUserModelId(APP_ID);

const isDev = !app.isPackaged;
let mainWindow = null;
let serverProcess = null;
let shuttingDown = false;
let logStream = null;

function userDataPath() {
  return app.getPath("userData");
}

function dataPath() {
  return path.join(userDataPath(), "data");
}

function appRoot() {
  return isDev ? path.join(__dirname, "..") : path.join(process.resourcesPath, "app");
}

function serverEntry() {
  return isDev ? path.join(__dirname, "server.cjs") : path.join(process.resourcesPath, "server", "server.cjs");
}

function logFile() {
  return path.join(userDataPath(), "agora.log");
}

function log(message) {
  const line = `[${new Date().toISOString()}] ${message}`;
  try {
    logStream?.write(`${line}\n`);
  } catch {
    // Logging must never prevent the app from starting.
  }
  if (isDev) console.log(line);
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => (port ? resolve(port) : reject(new Error("Could not reserve a local port."))));
    });
  });
}

function startServer(port) {
  fs.mkdirSync(dataPath(), { recursive: true });
  const env = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: "1",
    NODE_ENV: "production",
    HOST: "127.0.0.1",
    PORT: String(port),
    AGORA_DATA_DIR: dataPath(),
    AGORA_PACKAGED: isDev ? "0" : "1"
  };
  if (!isDev) {
    for (const name of AMBIENT_PROVIDER_ENV) delete env[name];
  }
  const child = spawn(process.execPath, [serverEntry()], {
    cwd: appRoot(),
    env,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"]
  });
  child.stdout?.on("data", (chunk) => log(`[server] ${String(chunk).trimEnd()}`));
  child.stderr?.on("data", (chunk) => log(`[server:error] ${String(chunk).trimEnd()}`));
  child.on("exit", (code, signal) => {
    if (shuttingDown) return;
    log(`Server exited unexpectedly (code ${code}, signal ${signal ?? "none"}).`);
    if (mainWindow && !mainWindow.isDestroyed()) {
      dialog.showErrorBox(
        "Agora stopped",
        `The local server exited unexpectedly.\n\nSee ${logFile()} for details.`
      );
      app.quit();
    }
  });
  return child;
}

function waitForServer(port, timeoutMs = 25000) {
  const started = Date.now();
  let settled = false;
  return new Promise((resolve, reject) => {
    const finish = (error) => {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else resolve();
    };
    const attempt = () => {
      if (settled) return;
      if (Date.now() - started > timeoutMs) {
        return finish(new Error(`The local server did not answer within ${timeoutMs / 1000} seconds.`));
      }
      const request = http.get(
        { host: "127.0.0.1", port, path: "/api/health", timeout: 1500 },
        (response) => {
          response.resume();
          if (response.statusCode === 200) return finish();
          setTimeout(attempt, 250);
        }
      );
      request.on("error", () => setTimeout(attempt, 250));
      request.on("timeout", () => {
        request.destroy();
        setTimeout(attempt, 250);
      });
    };
    attempt();
  });
}

async function preferredWindowTheme() {
  try {
    const cookies = await session.defaultSession.cookies.get({ name: "agora_theme" });
    const preference = cookies.find((cookie) => ["light", "dark"].includes(cookie.value))?.value;
    if (preference) return preference;
  } catch {
    // Fall back to the Windows appearance setting.
  }
  return nativeTheme.shouldUseDarkColors ? "dark" : "light";
}

async function createWindow() {
  const port = await freePort();
  const windowTheme = await preferredWindowTheme();
  log(`Starting Agora ${app.getVersion()} on 127.0.0.1:${port}`);
  log(`Data: ${dataPath()}`);
  serverProcess = startServer(port);
  await waitForServer(port);

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: windowTheme === "dark" ? "#15120e" : "#f4efe4",
    show: false,
    autoHideMenuBar: true,
    title: "Agora",
    icon: isDev ? path.join(__dirname, "..", "build", "icon.ico") : undefined,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  const appOrigin = `http://127.0.0.1:${port}`;
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openAllowedExternal(url);
    return { action: "deny" };
  });
  const guardNavigation = (event, url) => {
    if (isSameAppOrigin(url, appOrigin)) return;
    event.preventDefault();
    openAllowedExternal(url);
  };
  mainWindow.webContents.on("will-navigate", guardNavigation);
  mainWindow.webContents.on("will-redirect", guardNavigation);
  await mainWindow.loadURL(`${appOrigin}/`);
  log("Window loaded.");
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  app.on("before-quit", () => {
    shuttingDown = true;
    if (serverProcess && !serverProcess.killed) {
      serverProcess.kill();
      serverProcess = null;
    }
  });

  app.on("window-all-closed", () => app.quit());

  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);
    session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
    session.defaultSession.setPermissionCheckHandler(() => false);
    fs.mkdirSync(userDataPath(), { recursive: true });
    logStream = fs.createWriteStream(logFile(), { flags: "a" });
    try {
      await createWindow();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(`Startup failed: ${message}`);
      dialog.showErrorBox(
        "Agora could not start",
        `${message}\n\nLog: ${logFile()}`
      );
      app.quit();
    }
  });
}
