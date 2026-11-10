const loginForm = document.querySelector("#login-form");
const registerForm = document.querySelector("#register-form");
const title = document.querySelector("#form-title");
const eyebrow = document.querySelector("#form-eyebrow");
const subtitle = document.querySelector("#form-subtitle");
const loginSwitch = document.querySelector("#login-switch");
const registerSwitch = document.querySelector("#register-switch");
const statusMessage = document.querySelector("#status-message");
const signedIn = document.querySelector("#signed-in");
const signOutButton = document.querySelector("#sign-out");
let activeSession = null;

function setView(view) {
  signedIn.hidden = true;
  document.querySelector("#beta-badge").hidden = true;
  document.querySelector("#admin-badge").hidden = true;
  const isRegister = view === "register";
  loginForm.hidden = isRegister;
  registerForm.hidden = !isRegister;
  loginSwitch.hidden = isRegister;
  registerSwitch.hidden = !isRegister;
  eyebrow.textContent = isRegister ? "欢迎加入" : "欢迎回来";
  title.textContent = isRegister ? "创建你的账户" : "登录你的账户";
  subtitle.textContent = isRegister ? "几步开启你的豆豆空间" : "继续探索属于你的豆豆空间";
  document.title = `${isRegister ? "注册" : "登录"} · 豆豆ai`;
  statusMessage.hidden = true;
  statusMessage.textContent = "";
}

document.querySelectorAll("[data-view]").forEach((button) => {
  button.addEventListener("click", () => setView(button.dataset.view));
});

document.querySelectorAll("[data-toggle-for]").forEach((button) => {
  button.addEventListener("click", () => {
    const input = document.getElementById(button.dataset.toggleFor);
    const reveal = input.type === "password";
    input.type = reveal ? "text" : "password";
    button.setAttribute("aria-pressed", String(reveal));
    button.setAttribute("aria-label", reveal ? "隐藏密码" : "显示密码");
    input.focus();
  });
});

function showMessage(message, isError = false) {
  statusMessage.textContent = message;
  statusMessage.classList.toggle("is-error", isError);
  statusMessage.hidden = false;
}

function setFormBusy(form, busy) {
  const button = form.querySelector(".primary-button");
  button.disabled = busy;
  button.setAttribute("aria-busy", String(busy));
}

async function callAuth(action, credentials) {
  const config = window.DOUDOU_SUPABASE;
  if (!config?.url || !config?.publishableKey) {
    throw new Error("Supabase 配置不完整，请检查 config.js。");
  }

  const response = await fetch(`${config.url.replace(/\/$/, "")}/functions/v1/username-auth`, {
    method: "POST",
    headers: {
      apikey: config.publishableKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ action, ...credentials }),
    signal: AbortSignal.timeout(30000),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "暂时无法连接账号服务，请稍后重试。");
  return result;
}

function publishSession(session, user) {
  activeSession = session;
  window.doudouAuth = Object.freeze({
    getSession: () => activeSession,
    signOut,
  });
  window.dispatchEvent(new CustomEvent("doudou:auth", { detail: { session, user } }));
}

function friendlyError(error) {
  if (error.name === "TimeoutError" || error.name === "AbortError") return "连接超时，请稍后重试。";
  if (error instanceof TypeError) return "网络连接失败，请检查网络后重试。";
  return error.message || "操作失败，请稍后重试。";
}

async function signOut() {
  signOutButton.disabled = true;
  try {
    if (activeSession) {
      const response = await fetch(`${window.DOUDOU_SUPABASE.url}/auth/v1/logout?scope=local`, {
        method: "POST",
        headers: { apikey: window.DOUDOU_SUPABASE.publishableKey, Authorization: `Bearer ${activeSession.access_token}` },
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok && response.status !== 401 && response.status !== 403) throw new Error("退出失败，请重试。");
    }
    activeSession = null;
    loginForm.reset();
    setView("login");
    showMessage("已退出登录。");
    window.dispatchEvent(new CustomEvent("doudou:auth", { detail: { session: null, user: null } }));
  } catch (error) {
    showMessage(friendlyError(error), true);
  } finally {
    signOutButton.disabled = false;
  }
}
signOutButton.addEventListener("click", signOut);

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setFormBusy(loginForm, true);
  statusMessage.hidden = true;
  const form = new FormData(loginForm);
  try {
    const result = await callAuth("login", {
      username: form.get("username"),
      password: form.get("password"),
    });
    publishSession(result.session, result.user);
    loginForm.reset();
    loginForm.hidden = true;
    loginSwitch.hidden = true;
    signedIn.hidden = false;
    eyebrow.textContent = "已登录";
    title.textContent = "欢迎来到豆豆ai";
    subtitle.textContent = result.user?.user_metadata?.username || "豆豆朋友";
    document.title = "我的账户 · 豆豆ai";
    // Badges come only from the server-owned membership record.
    document.querySelector("#beta-badge").hidden = result.membership?.is_beta !== true;
    document.querySelector("#admin-badge").hidden = result.membership?.is_admin !== true;
    document.querySelector("#membership-copy").textContent = result.membership?.is_beta === true
      ? "感谢你在正式上线前加入。你的内测用户标记将永久保留。"
      : "欢迎来到豆豆ai，一起期待更多灵感发芽。";
    showMessage("登录成功，欢迎回来。");
  } catch (error) {
    showMessage(friendlyError(error), true);
  } finally {
    setFormBusy(loginForm, false);
  }
});

registerForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setFormBusy(registerForm, true);
  statusMessage.hidden = true;
  const form = new FormData(registerForm);
  const username = form.get("username");
  try {
    await callAuth("register", {
      username,
      password: form.get("password"),
    });
    registerForm.reset();
    setView("login");
    document.querySelector("#login-username").value = username || "";
    showMessage("账户已创建，请使用刚才设置的用户名和密码登录。");
  } catch (error) {
    showMessage(friendlyError(error), true);
  } finally {
    setFormBusy(registerForm, false);
  }
});
