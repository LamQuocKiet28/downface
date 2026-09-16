const form = document.querySelector("#download-form");
const urlInput = document.querySelector("#video-url");
const message = document.querySelector("#form-message");
const pasteButton = document.querySelector("#paste-button");
const resultsPanel = document.querySelector("#results-panel");
const formatList = document.querySelector("#format-list");
const videoTitle = document.querySelector("#video-title");
const videoMeta = document.querySelector("#video-meta");
const videoThumbnail = document.querySelector("#video-thumbnail");
const API_URL = "https://downface-api.onrender.com";
const platformButtons = document.querySelectorAll("[data-platform]");
const platformLabels = {
  facebook: "Facebook",
  tiktok: "TikTok",
  youtube: "YouTube",
  douyin: "Douyin",
};

function detectPlatform(value) {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    if (hostname.includes("facebook") || hostname === "fb.watch") return "facebook";
    if (hostname.includes("tiktok")) return "tiktok";
    if (hostname.includes("youtube") || hostname === "youtu.be") return "youtube";
    if (hostname.includes("douyin")) return "douyin";
  } catch {
    return null;
  }
  return null;
}

function selectPlatform(platform) {
  platformButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.platform === platform);
  });
  urlInput.placeholder = `Dán liên kết ${platformLabels[platform]} vào đây...`;
}

platformButtons.forEach((button) => {
  button.addEventListener("click", () => selectPlatform(button.dataset.platform));
});

function showMessage(text, type = "") {
  message.textContent = text;
  message.className = `form-message ${type}`.trim();
}

pasteButton.addEventListener("click", async () => {
  try {
    const text = await navigator.clipboard.readText();
    if (!text) {
      showMessage("Clipboard hiện không có liên kết nào.");
      return;
    }
    urlInput.value = text;
    urlInput.focus();
    showMessage("Đã dán liên kết. Bạn có thể bắt đầu tải.", "success");
  } catch {
    urlInput.focus();
    showMessage("Hãy dán liên kết bằng Ctrl + V.");
  }
});

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const value = urlInput.value.trim();
  let url;

  try {
    url = new URL(value);
  } catch {
    showMessage("Vui lòng dán một liên kết đầy đủ, bắt đầu bằng https://.");
    urlInput.focus();
    return;
  }

  const platform = detectPlatform(value);
  if (!platform) {
    showMessage("Liên kết chưa được hỗ trợ. Hãy dùng Facebook, TikTok, YouTube hoặc Douyin.");
    urlInput.focus();
    return;
  }

  const button = form.querySelector(".download-button");
  button.disabled = true;
  button.querySelector("span").textContent = "Đang phân tích...";
  resultsPanel.hidden = true;
  showMessage("Đang lấy các chất lượng video...", "success");

  fetch(`${API_URL}/api/formats`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: value }),
  })
    .then(async (response) => {
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.message || "Không thể tải video từ liên kết này.");
      }
      return response.json();
    })
    .then((data) => {
      videoTitle.textContent = data.title;
      videoMeta.textContent = data.duration ? `Thời lượng ${Math.round(data.duration)} giây · ${platformLabels[platform]}` : `Nội dung công khai trên ${platformLabels[platform]}`;
      if (data.thumbnail) {
        videoThumbnail.src = data.thumbnail;
        videoThumbnail.hidden = false;
      } else {
        videoThumbnail.hidden = true;
      }
      formatList.replaceChildren();
      data.formats.forEach((format) => {
        const option = document.createElement("button");
        option.className = "format-option";
        option.type = "button";
        const kind = format.type.startsWith("audio") ? `Tải xuống ${format.label}` : "Tải xuống MP4";
        option.innerHTML = `<span>↓ ${kind} <b>${format.label}</b></span><span>→</span>`;
        option.addEventListener("click", () => downloadFormat(value, format, option));
        formatList.append(option);
      });
      resultsPanel.hidden = false;
      showMessage("Đã tìm thấy các chất lượng. Hãy chọn một lựa chọn để tải.", "success");
    })
    .catch((error) => {
      showMessage(error instanceof TypeError
        ? "Không thể kết nối máy chủ tải xuống. Máy chủ có thể đang khởi động, hãy thử lại sau 30 giây."
        : error.message);
    })
    .finally(() => {
      button.disabled = false;
      button.querySelector("span").textContent = "Tải video";
    });
});

async function downloadFormat(url, format, option) {
  option.disabled = true;
  option.classList.add("loading");
  option.querySelector("span").firstChild.textContent = "Đang tải... ";
  try {
    const response = await fetch(`${API_URL}/api/download`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url,
        formatId: format.id,
        audioFormat: format.type === "audio-mp3" ? "mp3" : undefined,
      }),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.message || "Không thể tải lựa chọn này.");
    }
    const blob = await response.blob();
    const filename = response.headers.get("Content-Disposition")?.match(/filename="([^"]+)"/)?.[1] || "facebook-video.mp4";
    const downloadUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = downloadUrl;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(downloadUrl);
    showMessage("Tải video thành công. Hãy kiểm tra thư mục Downloads.", "success");
  } catch (error) {
    showMessage(error instanceof TypeError
      ? "Không thể kết nối máy chủ tải xuống. Máy chủ có thể đang khởi động, hãy thử lại sau 30 giây."
      : error.message);
  } finally {
    option.disabled = false;
    option.classList.remove("loading");
    option.querySelector("span").firstChild.textContent = "↓ Tải xuống ";
  }
}
